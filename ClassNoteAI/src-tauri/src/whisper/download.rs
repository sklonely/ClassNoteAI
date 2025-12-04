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

/// Whisper Medium 模型下載配置
pub fn get_medium_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin".to_string(),
        output_path: output_dir.join("ggml-medium.bin"),
        expected_size: Some(1_500_000_000), // 約 1.5GB
    }
}

/// Whisper Large 模型下載配置
pub fn get_large_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".to_string(),
        output_path: output_dir.join("ggml-large.bin"),
        expected_size: Some(2_900_000_000), // 約 2.9GB
    }
}

/// Whisper Small (Quantized q5_1) 模型下載配置
/// 速度更快，內存佔用更低，精度損失極小
pub fn get_small_quantized_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin".to_string(),
        output_path: output_dir.join("ggml-small-q5.bin"),
        expected_size: Some(180_000_000), // 約 180MB (原版 466MB)
    }
}

/// Whisper Medium (Quantized q5_0) 模型下載配置
/// 平衡速度與精度的最佳選擇
pub fn get_medium_quantized_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-q5_0.bin".to_string(),
        output_path: output_dir.join("ggml-medium-q5.bin"),
        expected_size: Some(530_000_000), // 約 530MB (原版 1.5GB)
    }
}

/// 下載進度信息
#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
    pub speed_mbps: f64, // MB/s
    pub eta_seconds: Option<u64>, // 預估剩餘時間（秒）
}

/// 下載模型文件（支持斷點續傳和自動重試）
pub async fn download_model(
    config: &ModelDownloadConfig,
    progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<PathBuf> {
    const MAX_RETRIES: u32 = 3;
    const RETRY_DELAY_SECS: u64 = 2;
    
    for attempt in 1..=MAX_RETRIES {
        match download_model_internal(config, progress_callback.as_ref()).await {
            Ok(path) => return Ok(path),
            Err(e) => {
                if attempt < MAX_RETRIES {
                    println!("[下載] 嘗試 {} 失敗: {}，{} 秒後重試...", attempt, e, RETRY_DELAY_SECS);
                    tokio::time::sleep(tokio::time::Duration::from_secs(RETRY_DELAY_SECS)).await;
                } else {
                    return Err(anyhow::anyhow!("下載失敗（已重試 {} 次）: {}", MAX_RETRIES, e));
                }
            }
        }
    }
    
    unreachable!()
}

/// 內部下載實現
async fn download_model_internal(
    config: &ModelDownloadConfig,
    progress_callback: Option<&Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<PathBuf> {
    println!("[下載] 開始下載模型");
    println!("[下載] URL: {}", config.url);
    println!("[下載] 保存路徑: {:?}", config.output_path);

    // 創建輸出目錄
    if let Some(parent) = config.output_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // 檢查文件是否已存在（支持斷點續傳）
    let mut downloaded: u64 = 0;
    let mut file = if config.output_path.exists() {
        let metadata = tokio::fs::metadata(&config.output_path).await?;
        let existing_size = metadata.len();
        
        if let Some(expected_size) = config.expected_size {
            if existing_size == expected_size {
                println!("[下載] 模型文件已存在且完整，跳過下載");
                return Ok(config.output_path.clone());
            } else if existing_size < expected_size {
                // 文件存在但不完整，支持斷點續傳
                println!("[下載] 發現不完整文件 ({:.2} MB)，繼續下載...", existing_size as f64 / 1_000_000.0);
                downloaded = existing_size;
                tokio::fs::OpenOptions::new()
                    .append(true)
                    .open(&config.output_path)
                    .await?
            } else {
                // 文件大小異常，重新下載
                println!("[下載] 文件大小異常，重新下載");
                tokio::fs::remove_file(&config.output_path).await?;
                File::create(&config.output_path).await?
            }
        } else {
            // 沒有預期大小，檢查文件是否為空
            if existing_size > 0 {
                println!("[下載] 文件已存在，跳過下載");
                return Ok(config.output_path.clone());
            }
            File::create(&config.output_path).await?
        }
    } else {
        File::create(&config.output_path).await?
    };

    // 下載文件（支持斷點續傳）
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 分鐘超時
        .build()
        .map_err(|e| anyhow::anyhow!("創建 HTTP 客戶端失敗: {}", e))?;
    
    // 如果已下載部分，使用 Range 請求繼續下載
    let mut request = client.get(&config.url);
    if downloaded > 0 {
        request = request.header("Range", format!("bytes={}-", downloaded));
        println!("[下載] 使用斷點續傳，從字節 {} 開始", downloaded);
    }
    
    let response = request
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("請求失敗: {}", e))?;

    let status = response.status();
    
    // 檢查是否支持斷點續傳
    if downloaded > 0 && status != 206 {
        // 服務器不支持 Range 請求，重新下載
        println!("[下載] 服務器不支持斷點續傳，重新下載");
        tokio::fs::remove_file(&config.output_path).await?;
        file = File::create(&config.output_path).await?;
        downloaded = 0;
    }
    
    let total_size = if downloaded > 0 && status == 206 {
        // 斷點續傳時，從 Content-Range 頭獲取總大小
        if let Some(range_header) = response.headers().get("Content-Range") {
            if let Ok(range_str) = range_header.to_str() {
                // 格式：bytes 200-1000/5000
                if let Some(slash_pos) = range_str.rfind('/') {
                    if let Ok(size) = range_str[slash_pos + 1..].parse::<u64>() {
                        size
                    } else {
                        // 如果無法解析，使用預期大小或從 Content-Length 推斷
                        config.expected_size.unwrap_or_else(|| {
                            response.content_length().unwrap_or(0) + downloaded
                        })
                    }
                } else {
                    config.expected_size.unwrap_or_else(|| {
                        response.content_length().unwrap_or(0) + downloaded
                    })
                }
            } else {
                config.expected_size.unwrap_or_else(|| {
                    response.content_length().unwrap_or(0) + downloaded
                })
            }
        } else {
            config.expected_size.unwrap_or_else(|| {
                response.content_length().unwrap_or(0) + downloaded
            })
        }
    } else {
        response.content_length().ok_or_else(|| anyhow::anyhow!("無法獲取文件大小"))?
    };

    println!("[下載] 文件大小: {} bytes ({:.2} MB)", total_size, total_size as f64 / 1_000_000.0);

    // 驗證預期大小
    if let Some(expected_size) = config.expected_size {
        if total_size != expected_size {
            println!("[下載] 警告: 文件大小與預期不符 (預期: {}, 實際: {})", expected_size, total_size);
        }
    }

    // 使用 BufWriter 提高寫入性能
    let mut file = BufWriter::new(file);
    let mut stream = response.bytes_stream();
    
    // 用於計算下載速度
    let start_time = std::time::Instant::now();
    let mut last_progress_time = start_time;
    let mut last_downloaded = downloaded;

    use futures_util::StreamExt;
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| anyhow::anyhow!("讀取數據失敗: {}", e))?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        // 計算下載速度和 ETA
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(last_progress_time);
        
        // 每 500ms 更新一次進度（避免過於頻繁）
        if elapsed.as_millis() >= 500 || downloaded == total_size {
            let downloaded_bytes = downloaded - last_downloaded;
            let speed_bps = if elapsed.as_secs() > 0 {
                downloaded_bytes as f64 / elapsed.as_secs() as f64
            } else {
                downloaded_bytes as f64 / elapsed.as_millis() as f64 * 1000.0
            };
            let speed_mbps = speed_bps / 1_000_000.0;
            
            let remaining = total_size.saturating_sub(downloaded);
            let eta_seconds = if speed_bps > 0.0 {
                Some((remaining as f64 / speed_bps) as u64)
            } else {
                None
            };
            
            let percent = (downloaded as f64 / total_size as f64) * 100.0;
            
            // 調用進度回調
            if let Some(ref callback) = progress_callback {
                callback(downloaded, total_size);
            }
            
            // 每下載 1MB 或每 500ms 輸出一次進度
            if downloaded % 1_000_000 == 0 || downloaded == total_size || elapsed.as_millis() >= 500 {
                if let Some(eta) = eta_seconds {
                    let eta_min = eta / 60;
                    let eta_sec = eta % 60;
                    println!("[下載] 進度: {:.2}% ({:.2} MB / {:.2} MB) - 速度: {:.2} MB/s - 剩餘: {}分{}秒", 
                        percent, 
                        downloaded as f64 / 1_000_000.0,
                        total_size as f64 / 1_000_000.0,
                        speed_mbps,
                        eta_min,
                        eta_sec);
                } else {
                    println!("[下載] 進度: {:.2}% ({:.2} MB / {:.2} MB) - 速度: {:.2} MB/s", 
                        percent, 
                        downloaded as f64 / 1_000_000.0,
                        total_size as f64 / 1_000_000.0,
                        speed_mbps);
                }
            }
            
            last_progress_time = now;
            last_downloaded = downloaded;
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
        println!("[檢查模型] 文件不存在: {:?}", model_path);
        return Ok(false);
    }

    let metadata = tokio::fs::metadata(model_path).await?;
    let actual_size = metadata.len();
    
    println!("[檢查模型] 文件路徑: {:?}", model_path);
    println!("[檢查模型] 實際大小: {} bytes ({:.2} MB)", actual_size, actual_size as f64 / 1_000_000.0);
    
    if let Some(expected_size) = expected_size {
        println!("[檢查模型] 預期大小: {} bytes ({:.2} MB)", expected_size, expected_size as f64 / 1_000_000.0);
        
        // 允許 10% 的大小誤差（因為不同來源的文件大小可能略有不同，特別是大型文件）
        let tolerance = expected_size / 10; // 10%
        let min_size = expected_size.saturating_sub(tolerance);
        let max_size = expected_size + tolerance;
        
        println!("[檢查模型] 容差範圍: {} - {} bytes ({:.2} - {:.2} MB)", 
            min_size, max_size, 
            min_size as f64 / 1_000_000.0, 
            max_size as f64 / 1_000_000.0);
        
        let is_valid = actual_size >= min_size && actual_size <= max_size;
        println!("[檢查模型] 檢查結果: {}", if is_valid { "通過" } else { "失敗" });
        
        Ok(is_valid)
    } else {
        println!("[檢查模型] 無預期大小，只檢查文件是否存在且非空");
        Ok(actual_size > 0)
    }
}

