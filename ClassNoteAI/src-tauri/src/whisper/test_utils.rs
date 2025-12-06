/**
 * Whisper 測試工具
 * 用於測試轉錄功能
 */
use crate::whisper::{transcribe, WhisperModel};
use anyhow::Result;

/// 測試轉錄功能
pub async fn test_transcription(
    model_path: &str,
    audio_data: &[i16],
    sample_rate: u32,
    initial_prompt: Option<&str>,
) -> Result<()> {
    println!("[測試] 開始測試轉錄功能");
    println!("[測試] 模型路徑: {}", model_path);
    println!(
        "[測試] 音頻樣本數: {}, 採樣率: {}Hz",
        audio_data.len(),
        sample_rate
    );

    // 加載模型
    let model = WhisperModel::load(model_path).await?;
    println!("[測試] 模型加載成功");

    // 執行轉錄
    let result =
        transcribe::transcribe_audio(&model, audio_data, sample_rate, initial_prompt, None).await?;

    // 輸出結果
    println!("[測試] 轉錄完成");
    println!("[測試] 轉錄文本: {}", result.text);
    println!("[測試] 片段數量: {}", result.segments.len());
    println!("[測試] 轉錄耗時: {}ms", result.duration_ms);
    println!("[測試] 檢測語言: {:?}", result.language);

    // 輸出每個片段
    for (i, segment) in result.segments.iter().enumerate() {
        println!(
            "[測試] 片段 {}: [{}ms - {}ms] {}",
            i + 1,
            segment.start_ms,
            segment.end_ms,
            segment.text
        );
    }

    Ok(())
}

/// 生成測試音頻數據（靜音）
pub fn generate_silent_audio(duration_seconds: u32, sample_rate: u32) -> Vec<i16> {
    let num_samples = duration_seconds * sample_rate;
    vec![0i16; num_samples as usize]
}

/// 生成測試音頻數據（正弦波）
pub fn generate_sine_wave(
    frequency: f32,
    duration_seconds: u32,
    sample_rate: u32,
    amplitude: f32,
) -> Vec<i16> {
    let num_samples = duration_seconds * sample_rate;
    let mut samples = Vec::with_capacity(num_samples as usize);

    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let sample = (t * frequency * 2.0 * std::f32::consts::PI).sin() * amplitude;
        samples.push((sample * 32767.0) as i16);
    }

    samples
}
