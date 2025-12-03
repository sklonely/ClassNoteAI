/**
 * Whisper 轉錄功能測試
 * 
 * 使用方法：
 * cargo test --test whisper_test -- --nocapture
 * 
 * 注意：需要先下載 Whisper Base 模型文件
 */

use classnoteai_lib::whisper::{WhisperModel, transcribe};
use std::path::Path;

#[tokio::test]
#[ignore] // 默認忽略，需要手動運行
async fn test_model_loading() {
    let model_path = "models/ggml-base.bin";
    
    if !Path::new(model_path).exists() {
        println!("[測試] 模型文件不存在: {}", model_path);
        println!("[測試] 請先下載 Whisper Base 模型");
        println!("[測試] 下載地址: https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin");
        return;
    }

    println!("[測試] 開始加載模型: {}", model_path);
    let result = WhisperModel::load(model_path).await;
    
    match result {
        Ok(model) => {
            println!("[測試] ✅ 模型加載成功");
            println!("[測試] 模型路徑: {}", model.get_model_path());
        }
        Err(e) => {
            println!("[測試] ❌ 模型加載失敗: {}", e);
            panic!("模型加載失敗");
        }
    }
}

#[tokio::test]
#[ignore] // 默認忽略，需要手動運行
async fn test_transcription_with_silence() {
    let model_path = "models/ggml-base.bin";
    
    if !Path::new(model_path).exists() {
        println!("[測試] 模型文件不存在，跳過測試");
        return;
    }

    println!("[測試] 測試靜音音頻轉錄");
    
    // 加載模型
    let model = WhisperModel::load(model_path).await.expect("模型加載失敗");
    
    // 生成 2 秒靜音音頻（16kHz, 16-bit, Mono）
    let sample_rate = 16000u32;
    let duration_seconds = 2u32;
    let audio_data: Vec<i16> = vec![0i16; (sample_rate * duration_seconds) as usize];
    
    println!("[測試] 音頻數據: {} 樣本, {}Hz", audio_data.len(), sample_rate);
    
    // 執行轉錄
    let result = transcribe::transcribe_audio(&model, &audio_data, sample_rate, None).await;
    
    match result {
        Ok(transcription) => {
            println!("[測試] ✅ 轉錄成功");
            println!("[測試] 轉錄文本: '{}'", transcription.text);
            println!("[測試] 片段數量: {}", transcription.segments.len());
            println!("[測試] 轉錄耗時: {}ms", transcription.duration_ms);
            
            // 靜音音頻應該產生很少或沒有文本
            assert!(transcription.text.trim().is_empty() || transcription.text.len() < 10);
        }
        Err(e) => {
            println!("[測試] ❌ 轉錄失敗: {}", e);
            panic!("轉錄失敗");
        }
    }
}

#[tokio::test]
#[ignore] // 默認忽略，需要手動運行
async fn test_transcription_with_initial_prompt() {
    let model_path = "models/ggml-base.bin";
    
    if !Path::new(model_path).exists() {
        println!("[測試] 模型文件不存在，跳過測試");
        return;
    }

    println!("[測試] 測試帶初始提示的轉錄");
    
    // 加載模型
    let model = WhisperModel::load(model_path).await.expect("模型加載失敗");
    
    // 生成簡單測試音頻（這裡使用靜音，實際應該使用真實音頻）
    let sample_rate = 16000u32;
    let duration_seconds = 2u32;
    let audio_data: Vec<i16> = vec![0i16; (sample_rate * duration_seconds) as usize];
    
    // 設置初始提示
    let initial_prompt = Some("ClassNote AI, Tauri, React, TypeScript, transcription, lecture");
    
    println!("[測試] 使用初始提示: {:?}", initial_prompt);
    
    // 執行轉錄
    let result = transcribe::transcribe_audio(&model, &audio_data, sample_rate, initial_prompt).await;
    
    match result {
        Ok(transcription) => {
            println!("[測試] ✅ 轉錄成功（帶初始提示）");
            println!("[測試] 轉錄文本: '{}'", transcription.text);
            println!("[測試] 轉錄耗時: {}ms", transcription.duration_ms);
        }
        Err(e) => {
            println!("[測試] ❌ 轉錄失敗: {}", e);
            panic!("轉錄失敗");
        }
    }
}

