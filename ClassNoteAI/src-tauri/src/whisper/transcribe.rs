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

/// 轉錄音頻數據
pub async fn transcribe_audio(
    model: &WhisperModel,
    audio_data: &[i16],
    sample_rate: u32,
    initial_prompt: Option<&str>,
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
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    // 基本參數設置
    params.set_n_threads((num_cpus::get().min(4)) as i32); // 限制線程數，避免過度使用 CPU
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
    let audio_f32: Vec<f32> = audio_data
        .iter()
        .map(|&sample| sample as f32 / 32768.0)
        .collect();

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

