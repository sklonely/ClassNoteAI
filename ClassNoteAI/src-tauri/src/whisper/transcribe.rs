/**
 * Whisper 轉錄邏輯
 */
use anyhow::Result;
use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy};

use super::model::WhisperModel;

/// 轉錄結果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub segments: Vec<TranscriptionSegment>,
    pub language: Option<String>,
    pub duration_ms: u64,
}

/// 轉錄片段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

/// 轉錄選項
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionOptions {
    pub strategy: String, // "greedy" | "beam_search"
    pub beam_size: Option<i32>,
    pub patience: Option<f32>,
}

/// Normalise a user-facing language tag into what whisper.cpp expects.
///
/// whisper.cpp's language codes are ISO-639-1 two-letter tags ("en",
/// "zh", "ja"). The app's settings UI carries BCP-47-ish forms like
/// "zh-TW" / "zh-CN", plus the sentinel "auto" which means "let
/// whisper detect". This helper exists so callers can pass whatever
/// the UI has and get the right thing on the wire — and so future
/// devs don't silently regress back to hardcoding "en".
///
/// Returns `None` for `auto` / `None` / empty input (whisper will
/// then run its language detector on the first 30s of audio).
pub(crate) fn normalize_language(language: Option<&str>) -> Option<String> {
    let raw = language?.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("auto") {
        return None;
    }
    // Strip region subtag: "zh-TW" / "zh-cn" / "en-US" → "zh" / "en".
    let primary = raw
        .split(&['-', '_'][..])
        .next()
        .unwrap_or(raw)
        .to_lowercase();
    if primary.is_empty() {
        None
    } else {
        Some(primary)
    }
}

/// 轉錄音頻數據
pub async fn transcribe_audio(
    model: &WhisperModel,
    audio_data: &[i16],
    sample_rate: u32,
    initial_prompt: Option<&str>,
    language: Option<&str>,
    options: Option<TranscriptionOptions>,
) -> Result<TranscriptionResult> {
    println!(
        "[Whisper] 開始轉錄: 樣本數={}, 採樣率={}Hz",
        audio_data.len(),
        sample_rate
    );

    // 創建轉錄狀態
    let mut state = model
        .get_context()
        .create_state()
        .map_err(|e| anyhow::anyhow!("創建轉錄狀態失敗: {:?}", e))?;

    // 配置轉錄參數
    let mut params = if let Some(opts) = options {
        if opts.strategy == "beam_search" {
            let beam_size = opts.beam_size.unwrap_or(5);
            println!("[Whisper] 使用 Beam Search 策略 (beam_size={})", beam_size);
            let p = FullParams::new(SamplingStrategy::BeamSearch {
                beam_size: beam_size,
                patience: opts.patience.unwrap_or(1.0),
            });
            p
        } else {
            println!("[Whisper] 使用 Greedy 策略");
            FullParams::new(SamplingStrategy::Greedy { best_of: 1 })
        }
    } else {
        // 默認使用 Greedy
        println!("[Whisper] 使用默認 Greedy 策略");
        FullParams::new(SamplingStrategy::Greedy { best_of: 1 })
    };

    // 基本參數設置
    // 允許更多線程以提高性能（但不超過 8 個，避免過度使用 CPU）
    params.set_n_threads((num_cpus::get().min(8)) as i32);
    params.set_translate(false); // 不翻譯，只轉錄
                                 // Language selection. Prior to v0.5.2 this was hardcoded to "en" and
                                 // the UI's language setting was silently ignored — any user with a
                                 // Chinese or auto-detect preference still got English-only
                                 // transcription. Now the caller's preference flows through.
                                 //   None  → whisper.cpp auto-detect (first 30s)
                                 //   Some  → force that language (e.g. "en", "zh", "ja")
    let whisper_lang = normalize_language(language);
    match whisper_lang.as_deref() {
        Some(lang) => {
            println!("[Whisper] Language set to: {}", lang);
            params.set_language(Some(lang));
        }
        None => {
            println!("[Whisper] Language: auto-detect");
            // whisper-rs treats None as "auto" on the language field.
            params.set_language(None);
        }
    }
    params.set_suppress_blank(true); // 抑制空白
                                     // whisper-rs 0.16 renamed `set_suppress_non_speech_tokens` → `set_suppress_nst`.
    params.set_suppress_nst(true); // 抑制非語音標記

    // Phase 3 of speech-pipeline-v0.6.5 (#53): let whisper.cpp's own
    // filter drop low-confidence segments before they reach us. These
    // are the default thresholds recommended by the whisper reference
    // implementation — -1.0 for avg logprob, 0.6 for no-speech prob.
    // Segments that exceed them get re-decoded internally; if they
    // still fail, they're dropped from `full_n_segments()`.
    params.set_logprob_thold(-1.0);
    params.set_no_speech_thold(0.6);

    // 設置初始提示（如果提供）
    if let Some(prompt) = initial_prompt {
        println!("[Whisper] 使用初始提示: {}", prompt);
        params.set_initial_prompt(prompt);
    }

    // 保存語言字符串供後續使用
    let detected_language = whisper_lang.clone();

    // 將 i16 音頻數據轉換為 f32（Whisper 需要的格式）
    // i16 範圍: -32768 到 32767
    // f32 範圍: -1.0 到 1.0
    // 使用 32768.0 進行正規化以確保對稱性
    let mut audio_f32: Vec<f32> = audio_data
        .iter()
        .map(|&sample| sample as f32 / 32768.0)
        .collect();

    // 音頻正規化：確保音量在合適範圍內
    // 計算 RMS（均方根）來檢測音量
    let rms: f32 = audio_f32.iter().map(|&x| x * x).sum::<f32>() / audio_f32.len() as f32;
    let rms = rms.sqrt();

    // 如果音量太低（RMS < 0.01），進行增益調整
    // 目標 RMS 約為 0.1-0.3（合適的語音音量）
    if rms > 0.0 && rms < 0.01 {
        let gain = 0.2 / rms; // 目標 RMS 為 0.2
        let max_gain = 3.0; // 最大增益限制，避免過度放大噪音
        let gain = gain.min(max_gain);

        println!(
            "[Whisper] 音頻音量過低 (RMS={:.4})，應用增益: {:.2}x",
            rms, gain
        );
        audio_f32 = audio_f32
            .iter()
            .map(|&x| (x * gain).clamp(-1.0, 1.0))
            .collect();
    } else if rms > 0.5 {
        // 如果音量太高，進行衰減
        let gain = 0.3 / rms;
        println!(
            "[Whisper] 音頻音量過高 (RMS={:.4})，應用衰減: {:.2}x",
            rms, gain
        );
        audio_f32 = audio_f32
            .iter()
            .map(|&x| (x * gain).clamp(-1.0, 1.0))
            .collect();
    } else {
        println!("[Whisper] 音頻音量正常 (RMS={:.4})", rms);
    }

    // 執行轉錄
    let start_time = std::time::Instant::now();
    state
        .full(params, &audio_f32)
        .map_err(|e| anyhow::anyhow!("轉錄失敗: {:?}", e))?;

    let duration_ms = start_time.elapsed().as_millis() as u64;
    println!("[Whisper] 轉錄完成，耗時: {}ms", duration_ms);

    // 獲取轉錄結果。whisper-rs 0.16 重構了 segment API：
    //   - `full_n_segments()` 現在直接回傳 `c_int`（不再是 Result）
    //   - 用 `get_segment(i) -> Option<WhisperSegment>` 取段落物件
    //   - 文字: `seg.to_str()`，時間: `seg.start_timestamp()` /
    //     `seg.end_timestamp()` 皆回傳 centiseconds (i64)
    let num_segments = state.full_n_segments();
    let _ = sample_rate; // 單位轉換與 sample_rate 無關（見下）

    let mut segments = Vec::new();
    let mut full_text = String::new();

    // Phase 3 of speech-pipeline-v0.6.5 (#53): per-segment hallucination
    // guards. Configured once per call; cheap to evaluate per segment.
    // Settings override will land with the user-tunable quality panel
    // in a later phase — today everyone gets the conservative defaults.
    let guard_cfg = super::guards::GuardConfig::default();
    let mut dropped_count = 0usize;

    for i in 0..num_segments {
        let seg = state
            .get_segment(i)
            .ok_or_else(|| anyhow::anyhow!("獲取片段 {} 失敗", i))?;

        let segment_text = seg
            .to_str_lossy()
            .map_err(|e| anyhow::anyhow!("獲取片段文本失敗: {:?}", e))?
            .into_owned();

        // Centiseconds → milliseconds: × 10. Independent of sample rate.
        // Pre-0.6.0 bug here treated these as sample indices and
        // divided by sample_rate; see commit 05d000b.
        let start_ms = (seg.start_timestamp() * 10) as i64;
        let end_ms = (seg.end_timestamp() * 10) as i64;
        let trimmed = segment_text.trim();
        let no_speech_prob = seg.no_speech_probability();

        // Run the guards. A drop verdict is logged at warn level so
        // users reporting "my transcript is missing lines" can see in
        // diagnostics bundles what the filter removed and why.
        let verdict = super::guards::evaluate(trimmed, no_speech_prob, &guard_cfg);
        if verdict.should_drop() {
            dropped_count += 1;
            eprintln!(
                "[Whisper] dropped hallucinated segment [{}ms-{}ms]: {:?} | text={:?}",
                start_ms, end_ms, verdict, trimmed
            );
            continue;
        }

        segments.push(TranscriptionSegment {
            text: trimmed.to_string(),
            start_ms: start_ms as u64,
            end_ms: end_ms as u64,
        });

        if !full_text.is_empty() {
            full_text.push(' ');
        }
        full_text.push_str(trimmed);
    }

    if dropped_count > 0 {
        println!(
            "[Whisper] guards dropped {}/{} segments as likely hallucinations",
            dropped_count, num_segments
        );
    }

    // 使用設置的語言
    let language = detected_language;

    println!(
        "[Whisper] 轉錄結果: 文本長度={}, 片段數={}, 語言={:?}",
        full_text.len(),
        segments.len(),
        language.as_deref().unwrap_or("unknown")
    );

    Ok(TranscriptionResult {
        text: full_text,
        segments,
        language,
        duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test for the v0.5.2 bug where [`transcribe_audio`]
    /// hardcoded `params.set_language(Some("en"))` on every call,
    /// silently overriding whatever the UI had selected. Any user
    /// recording Chinese or Japanese content got English-only
    /// transcription.
    ///
    /// This test doesn't invoke whisper.cpp (that needs a real model
    /// file and an audio buffer — covered by nightly integration
    /// tests). Instead it pins the [`normalize_language`] contract
    /// that drives what eventually reaches whisper: any future refactor
    /// that breaks this mapping will fail CI instead of silently
    /// restoring the "every lecture is English" behaviour.
    #[test]
    fn normalize_language_preserves_bcp47_primary_subtag() {
        assert_eq!(normalize_language(Some("en")), Some("en".into()));
        assert_eq!(normalize_language(Some("zh")), Some("zh".into()));
        assert_eq!(normalize_language(Some("zh-TW")), Some("zh".into()));
        assert_eq!(normalize_language(Some("zh-CN")), Some("zh".into()));
        assert_eq!(normalize_language(Some("en-US")), Some("en".into()));
        assert_eq!(normalize_language(Some("ja_JP")), Some("ja".into()));
    }

    #[test]
    fn normalize_language_uppercases_are_lowercased() {
        // Whisper.cpp's language table is lower-case only — "ZH" or "EN"
        // from a sloppy caller must still work, not silently no-op.
        assert_eq!(normalize_language(Some("ZH")), Some("zh".into()));
        assert_eq!(normalize_language(Some("EN-us")), Some("en".into()));
    }

    #[test]
    fn normalize_language_auto_becomes_none_for_whisper_autodetect() {
        // "auto" is the UI sentinel for "let whisper pick". Returning
        // None tells the caller to pass None to params.set_language,
        // which activates whisper's built-in language detector.
        assert_eq!(normalize_language(Some("auto")), None);
        assert_eq!(normalize_language(Some("AUTO")), None);
        assert_eq!(normalize_language(Some("")), None);
        assert_eq!(normalize_language(Some("   ")), None);
        assert_eq!(normalize_language(None), None);
    }

    #[test]
    fn normalize_language_trims_whitespace() {
        assert_eq!(normalize_language(Some("  zh-TW  ")), Some("zh".into()));
    }
}
