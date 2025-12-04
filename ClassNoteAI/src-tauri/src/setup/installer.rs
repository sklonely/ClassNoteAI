/**
 * Installer Module
 * 
 * Handles automated installation of system dependencies and model downloads.
 * Uses Tauri events for progress reporting.
 */

use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::mpsc;
use futures_util::StreamExt;
use tauri::Emitter;

use super::progress::Progress;

// Global cancellation flag
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

/// Cancel the current installation
pub fn cancel_current_installation() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}

/// Reset the cancellation flag
fn reset_cancel_flag() {
    CANCEL_FLAG.store(false, Ordering::SeqCst);
}

/// Check if installation was cancelled
fn is_cancelled() -> bool {
    CANCEL_FLAG.load(Ordering::SeqCst)
}

/// Install Homebrew on macOS
pub async fn install_homebrew(
    progress_tx: mpsc::Sender<Progress>
) -> Result<(), String> {
    let task_id = "homebrew";
    let task_name = "安裝 Homebrew";
    
    progress_tx.send(Progress::pending(task_id, task_name)).await.ok();
    
    if is_cancelled() {
        return Err("Installation cancelled".to_string());
    }
    
    progress_tx.send(
        Progress::in_progress(task_id, task_name, 10, 100)
            .with_message("正在下載 Homebrew 安裝腳本...")
    ).await.ok();
    
    // Download and run Homebrew install script
    // Note: In a real implementation, this would need to handle the interactive nature
    // of the Homebrew installer. For now, we'll use a non-interactive approach.
    
    let output = Command::new("bash")
        .args([
            "-c",
            r#"NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)""#
        ])
        .output()
        .map_err(|e| format!("Failed to run Homebrew installer: {}", e))?;
    
    if is_cancelled() {
        return Err("Installation cancelled".to_string());
    }
    
    if output.status.success() {
        progress_tx.send(Progress::completed(task_id, task_name)).await.ok();
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr).to_string();
        progress_tx.send(Progress::failed(task_id, task_name, &error)).await.ok();
        Err(format!("Homebrew installation failed: {}", error))
    }
}

/// Install a package using Homebrew
pub async fn install_with_brew(
    package: &str,
    progress_tx: mpsc::Sender<Progress>
) -> Result<(), String> {
    let task_id = package;
    let task_name = format!("安裝 {}", package);
    
    progress_tx.send(Progress::pending(task_id, &task_name)).await.ok();
    
    if is_cancelled() {
        return Err("Installation cancelled".to_string());
    }
    
    progress_tx.send(
        Progress::in_progress(task_id, &task_name, 10, 100)
            .with_message(&format!("正在安裝 {}...", package))
    ).await.ok();
    
    let output = Command::new("brew")
        .args(["install", package])
        .output()
        .map_err(|e| format!("Failed to run brew install: {}", e))?;
    
    if is_cancelled() {
        return Err("Installation cancelled".to_string());
    }
    
    if output.status.success() {
        progress_tx.send(Progress::completed(task_id, &task_name)).await.ok();
        Ok(())
    } else {
        let error = String::from_utf8_lossy(&output.stderr).to_string();
        progress_tx.send(Progress::failed(task_id, &task_name, &error)).await.ok();
        Err(format!("{} installation failed: {}", package, error))
    }
}

/// Download a file with progress reporting
pub async fn download_file(
    url: &str,
    dest: &Path,
    task_id: &str,
    task_name: &str,
    progress_tx: mpsc::Sender<Progress>
) -> Result<(), String> {
    progress_tx.send(Progress::pending(task_id, task_name)).await.ok();
    
    if is_cancelled() {
        return Err("Download cancelled".to_string());
    }
    
    // Create parent directory if needed
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // Create HTTP client
    let client = reqwest::Client::new();
    let response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_progress_update = std::time::Instant::now();
    let mut last_downloaded: u64 = 0;
    
    // Create output file
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    let mut stream = response.bytes_stream();
    
    while let Some(chunk_result) = stream.next().await {
        if is_cancelled() {
            // Clean up partial file
            tokio::fs::remove_file(dest).await.ok();
            return Err("Download cancelled".to_string());
        }
        
        let chunk = chunk_result.map_err(|e| format!("Download error: {}", e))?;
        
        use tokio::io::AsyncWriteExt;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        
        downloaded += chunk.len() as u64;
        
        // Update progress every 100ms
        if last_progress_update.elapsed().as_millis() >= 100 {
            let elapsed = last_progress_update.elapsed().as_secs_f64();
            let speed = ((downloaded - last_downloaded) as f64 / elapsed) as u64;
            
            let progress = Progress::in_progress(task_id, task_name, downloaded, total_size)
                .with_speed(speed);
            
            progress_tx.send(progress).await.ok();
            
            last_progress_update = std::time::Instant::now();
            last_downloaded = downloaded;
        }
    }
    
    progress_tx.send(Progress::completed(task_id, task_name)).await.ok();
    Ok(())
}

/// Download and extract a model archive
pub async fn download_and_extract_model(
    url: &str,
    dest_dir: &Path,
    task_id: &str,
    task_name: &str,
    progress_tx: mpsc::Sender<Progress>
) -> Result<(), String> {
    let temp_zip = dest_dir.with_extension("zip");
    
    // Download
    download_file(url, &temp_zip, task_id, task_name, progress_tx.clone()).await?;
    
    if is_cancelled() {
        tokio::fs::remove_file(&temp_zip).await.ok();
        return Err("Cancelled".to_string());
    }
    
    // Extract
    progress_tx.send(
        Progress::in_progress(task_id, task_name, 95, 100)
            .with_message("正在解壓縮...")
    ).await.ok();
    
    // Use std::fs for zip extraction (sync operation)
    let zip_path = temp_zip.clone();
    let dest = dest_dir.to_path_buf();
    
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&zip_path)
            .map_err(|e| format!("Failed to open zip: {}", e))?;
        
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Failed to read zip: {}", e))?;
        
        std::fs::create_dir_all(&dest)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        
        archive.extract(&dest)
            .map_err(|e| format!("Failed to extract: {}", e))?;
        
        // Clean up zip file
        std::fs::remove_file(&zip_path).ok();
        
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;
    
    progress_tx.send(Progress::completed(task_id, task_name)).await.ok();
    Ok(())
}

/// Install all required components
pub async fn install_requirements(
    requirement_ids: Vec<String>,
    window: tauri::Window
) -> Result<(), String> {
    reset_cancel_flag();
    
    let (tx, mut rx) = mpsc::channel::<Progress>(32);
    
    // Spawn a task to forward progress to frontend
    let window_clone = window.clone();
    tokio::spawn(async move {
        while let Some(progress) = rx.recv().await {
            window_clone.emit("setup-progress", &progress).ok();
        }
    });
    
    let models_dir = super::get_models_dir()?;
    
    for req_id in requirement_ids {
        if is_cancelled() {
            return Err("Installation cancelled by user".to_string());
        }
        
        match req_id.as_str() {
            "homebrew" => {
                install_homebrew(tx.clone()).await?;
            }
            "cmake" => {
                install_with_brew("cmake", tx.clone()).await?;
            }
            "ffmpeg" => {
                install_with_brew("ffmpeg", tx.clone()).await?;
            }
            "whisper_model" => {
                let dest = models_dir.join("whisper");
                download_and_extract_model(
                    "https://github.com/YOUR_ORG/ClassNoteAI-Models/releases/download/v1.0.0/whisper-base-ggml.zip",
                    &dest,
                    "whisper_model",
                    "下載 Whisper 模型",
                    tx.clone()
                ).await?;
            }
            "translation_model" => {
                let dest = models_dir.join("ct2").join("opus-mt-en-zh");
                download_and_extract_model(
                    "https://github.com/YOUR_ORG/ClassNoteAI-Models/releases/download/v1.0.0/opus-mt-en-zh-ct2.zip",
                    &dest,
                    "translation_model",
                    "下載翻譯模型",
                    tx.clone()
                ).await?;
            }
            _ => {
                println!("[Setup] Unknown requirement: {}", req_id);
            }
        }
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_cancel_flag() {
        reset_cancel_flag();
        assert!(!is_cancelled());
        
        cancel_current_installation().unwrap();
        assert!(is_cancelled());
        
        reset_cancel_flag();
        assert!(!is_cancelled());
    }
}
