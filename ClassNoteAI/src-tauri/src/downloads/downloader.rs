/**
 * Unified Downloader
 * 
 * Provides common download functionality with progress reporting.
 * Used by model_manager for all model downloads.
 */

use std::path::{Path, PathBuf};
use reqwest::Client;
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;

/// Download progress information
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
    pub speed_mbps: f64,
}

/// Download a file with progress reporting
pub async fn download_file<F>(
    url: &str,
    dest: &Path,
    progress_callback: Option<F>,
) -> Result<PathBuf, String>
where
    F: Fn(DownloadProgress) + Send + Sync,
{
    // Ensure parent directory exists
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("無法創建目錄: {}", e))?;
    }

    println!("[Downloader] 開始下載: {} -> {:?}", url, dest);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(1800)) // 30 minutes
        .build()
        .map_err(|e| format!("創建 HTTP 客戶端失敗: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下載請求失敗: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下載失敗: HTTP {}", response.status()));
    }

    let total_size = response
        .content_length()
        .ok_or_else(|| "無法獲取文件大小".to_string())?;

    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("創建文件失敗: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let start_time = std::time::Instant::now();
    let mut last_progress_time = start_time;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("讀取數據失敗: {}", e))?;
        
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("寫入文件失敗: {}", e))?;

        downloaded += chunk.len() as u64;

        // Report progress every 100ms or at completion
        let now = std::time::Instant::now();
        if now.duration_since(last_progress_time).as_millis() >= 100 || downloaded == total_size {
            last_progress_time = now;
            
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed_mbps = if elapsed > 0.0 {
                (downloaded as f64 / elapsed) / 1_000_000.0
            } else {
                0.0
            };

            let progress = DownloadProgress {
                downloaded,
                total: total_size,
                percent: (downloaded as f64 / total_size as f64) * 100.0,
                speed_mbps,
            };

            if let Some(ref callback) = progress_callback {
                callback(progress);
            }
        }
    }

    println!("[Downloader] 下載完成: {:?}", dest);
    Ok(dest.to_path_buf())
}

/// Download and extract a ZIP file
pub async fn download_and_extract_zip<F>(
    url: &str,
    dest_dir: &Path,
    progress_callback: Option<F>,
) -> Result<PathBuf, String>
where
    F: Fn(DownloadProgress) + Send + Sync,
{
    use std::fs::File;
    use zip::ZipArchive;

    // Create temp file for ZIP
    let zip_path = dest_dir.with_extension("zip");
    
    // Download the ZIP
    download_file(url, &zip_path, progress_callback).await?;
    
    println!("[Downloader] 開始解壓: {:?}", zip_path);
    
    // Ensure output directory exists
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("創建目錄失敗: {}", e))?;
    
    // Extract ZIP
    let file = File::open(&zip_path)
        .map_err(|e| format!("打開 ZIP 文件失敗: {}", e))?;
    
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("讀取 ZIP 文件失敗: {}", e))?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("讀取 ZIP 條目失敗: {}", e))?;
        
        // Get relative path, skipping top-level directory if present
        let raw_name = file.name().to_string();
        let path_parts: Vec<&str> = raw_name.split('/').collect();
        
        let relative_path = if path_parts.len() > 1 {
            path_parts[1..].join("/")
        } else {
            raw_name.clone()
        };
        
        if relative_path.is_empty() {
            continue;
        }
        
        let outpath = dest_dir.join(&relative_path);
        
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("創建目錄失敗: {}", e))?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("創建父目錄失敗: {}", e))?;
            }
            
            let mut outfile = File::create(&outpath)
                .map_err(|e| format!("創建文件失敗: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("寫入文件失敗: {}", e))?;
        }
    }
    
    // Remove ZIP file to save space
    std::fs::remove_file(&zip_path)
        .unwrap_or_else(|e| eprintln!("警告: 無法刪除 ZIP 文件: {}", e));
    
    println!("[Downloader] 解壓完成: {:?}", dest_dir);
    Ok(dest_dir.to_path_buf())
}
