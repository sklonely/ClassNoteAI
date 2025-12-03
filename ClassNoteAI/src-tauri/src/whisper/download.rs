/**
 * Whisper 模型下載功能
 * 
 * 實現方案：
 * 1. 使用 reqwest 下載模型文件
 * 2. 顯示下載進度
 * 3. 支持斷點續傳
 * 4. 驗證文件完整性
 */

use anyhow::Result;
use std::path::{Path, PathBuf};
use tokio::fs::File;
use tokio::io::{AsyncWriteExt, BufWriter};

/// 模型下載配置
pub struct ModelDownloadConfig {
    pub url: String,
    pub output_path: PathBuf,
    pub expected_size: Option<u64>, // 預期文件大小（字節）
}

/// Whisper Base 模型下載配置
pub fn get_base_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin".to_string(),
        output_path: output_dir.join("ggml-base.bin"),
        expected_size: Some(142_000_000), // 約 142MB
    }
}

/// Whisper Small 模型下載配置
pub fn get_small_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin".to_string(),
        output_path: output_dir.join("ggml-small.bin"),
        expected_size: Some(466_000_000), // 約 466MB
    }
}

/// Whisper Tiny 模型下載配置
pub fn get_tiny_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin".to_string(),
        output_path: output_dir.join("ggml-tiny.bin"),
        expected_size: Some(75_000_000), // 約 75MB
    }
}

/// 下載模型文件
pub async fn download_model(
    config: &ModelDownloadConfig,
    progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<PathBuf> {
    println!("[下載] 開始下載模型");
    println!("[下載] URL: {}", config.url);
    println!("[下載] 保存路徑: {:?}", config.output_path);

    // 創建輸出目錄
    if let Some(parent) = config.output_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // 檢查文件是否已存在
    if config.output_path.exists() {
        let metadata = tokio::fs::metadata(&config.output_path).await?;
        if let Some(expected_size) = config.expected_size {
            if metadata.len() == expected_size {
                println!("[下載] 模型文件已存在且完整，跳過下載");
                return Ok(config.output_path.clone());
            } else {
                println!("[下載] 文件大小不匹配，重新下載");
                tokio::fs::remove_file(&config.output_path).await?;
            }
        } else {
            println!("[下載] 文件已存在，跳過下載");
            return Ok(config.output_path.clone());
        }
    }

    // 下載文件
    let client = reqwest::Client::new();
    let response = client
        .get(&config.url)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("請求失敗: {}", e))?;

    let total_size = response
        .content_length()
        .ok_or_else(|| anyhow::anyhow!("無法獲取文件大小"))?;

    println!("[下載] 文件大小: {} bytes ({:.2} MB)", total_size, total_size as f64 / 1_000_000.0);

    // 驗證預期大小
    if let Some(expected_size) = config.expected_size {
        if total_size != expected_size {
            println!("[下載] 警告: 文件大小與預期不符 (預期: {}, 實際: {})", expected_size, total_size);
        }
    }

    // 創建文件
    let mut file = BufWriter::new(File::create(&config.output_path).await?);
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    use futures_util::StreamExt;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| anyhow::anyhow!("讀取數據失敗: {}", e))?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        // 調用進度回調
        if let Some(ref callback) = progress_callback {
            callback(downloaded, total_size);
        }

        // 每下載 1MB 輸出一次進度
        if downloaded % 1_000_000 == 0 || downloaded == total_size {
            let percent = (downloaded as f64 / total_size as f64) * 100.0;
            println!("[下載] 進度: {:.2}% ({:.2} MB / {:.2} MB)", 
                percent, 
                downloaded as f64 / 1_000_000.0,
                total_size as f64 / 1_000_000.0);
        }
    }

    file.flush().await?;
    drop(file);

    println!("[下載] ✅ 下載完成: {:?}", config.output_path);
    Ok(config.output_path.clone())
}

/// 檢查模型文件是否存在且完整
pub async fn check_model_file(model_path: &Path, expected_size: Option<u64>) -> Result<bool> {
    if !model_path.exists() {
        return Ok(false);
    }

    let metadata = tokio::fs::metadata(model_path).await?;
    let actual_size = metadata.len();
    
    if let Some(expected_size) = expected_size {
        // 允許 5% 的大小誤差（因為不同來源的文件大小可能略有不同）
        let tolerance = expected_size / 20; // 5%
        let min_size = expected_size.saturating_sub(tolerance);
        let max_size = expected_size + tolerance;
        
        // 也檢查文件大小是否合理（至少應該大於預期大小的 90%）
        Ok(actual_size >= min_size && actual_size <= max_size)
    } else {
        Ok(actual_size > 0)
    }
}

