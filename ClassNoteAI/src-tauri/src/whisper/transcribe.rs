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

/// 轉錄音頻數據
pub async fn transcribe_audio(
    model: &WhisperModel,
    audio_data: &[i16],
    sample_rate: u32,
    initial_prompt: Option<&str>,
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
                patience: opts.patience.unwrap_or(1.0) 
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
    let language_str = "en"; // 設置語言為英文
    params.set_language(Some(language_str));
    params.set_suppress_blank(true); // 抑制空白
    params.set_suppress_non_speech_tokens(true); // 抑制非語音標記

    // 設置初始提示（如果提供）
    if let Some(prompt) = initial_prompt {
        println!("[Whisper] 使用初始提示: {}", prompt);
        params.set_initial_prompt(prompt);
    }

    // 保存語言字符串供後續使用
    let detected_language = Some(language_str.to_string());

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
    let rms: f32 = audio_f32.iter()
        .map(|&x| x * x)
        .sum::<f32>() / audio_f32.len() as f32;
    let rms = rms.sqrt();
    
    // 如果音量太低（RMS < 0.01），進行增益調整
    // 目標 RMS 約為 0.1-0.3（合適的語音音量）
    if rms > 0.0 && rms < 0.01 {
        let gain = 0.2 / rms; // 目標 RMS 為 0.2
        let max_gain = 3.0; // 最大增益限制，避免過度放大噪音
        let gain = gain.min(max_gain);
        
        println!("[Whisper] 音頻音量過低 (RMS={:.4})，應用增益: {:.2}x", rms, gain);
        audio_f32 = audio_f32.iter().map(|&x| (x * gain).clamp(-1.0, 1.0)).collect();
    } else if rms > 0.5 {
        // 如果音量太高，進行衰減
        let gain = 0.3 / rms;
        println!("[Whisper] 音頻音量過高 (RMS={:.4})，應用衰減: {:.2}x", rms, gain);
        audio_f32 = audio_f32.iter().map(|&x| (x * gain).clamp(-1.0, 1.0)).collect();
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

    // 獲取轉錄結果
    let num_segments = state
        .full_n_segments()
        .map_err(|e| anyhow::anyhow!("獲取片段數量失敗: {:?}", e))?;

    let mut segments = Vec::new();
    let mut full_text = String::new();

    for i in 0..num_segments {
        let segment_text = state
            .full_get_segment_text(i)
            .map_err(|e| anyhow::anyhow!("獲取片段文本失敗: {:?}", e))?;

        let start_timestamp = state
            .full_get_segment_t0(i)
            .map_err(|e| anyhow::anyhow!("獲取片段開始時間失敗: {:?}", e))?;

        let end_timestamp = state
            .full_get_segment_t1(i)
            .map_err(|e| anyhow::anyhow!("獲取片段結束時間失敗: {:?}", e))?;

        // 轉換時間戳（從樣本數轉換為毫秒）
        let start_ms = (start_timestamp * 1000) / sample_rate as i64;
        let end_ms = (end_timestamp * 1000) / sample_rate as i64;

        segments.push(TranscriptionSegment {
            text: segment_text.trim().to_string(),
            start_ms: start_ms as u64,
            end_ms: end_ms as u64,
        });

        if !full_text.is_empty() {
            full_text.push(' ');
        }
        full_text.push_str(&segment_text.trim());
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

