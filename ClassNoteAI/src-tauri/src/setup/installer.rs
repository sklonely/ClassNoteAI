use futures_util::StreamExt;
/**
 * Installer Module
 *
 * Handles automated installation of system dependencies and model downloads.
 * Uses Tauri events for progress reporting.
 */
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tokio::sync::mpsc;

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

// NOTE: Removed unused install functions:
// - install_homebrew() and install_with_brew()
// These were for development-time dependencies (Homebrew, CMake, FFmpeg)
// that end users don't need. The app is self-contained after packaging.

/// Download a file with progress reporting
pub async fn download_file(
    url: &str,
    dest: &Path,
    task_id: &str,
    task_name: &str,
    progress_tx: mpsc::Sender<Progress>,
) -> Result<(), String> {
    progress_tx
        .send(Progress::pending(task_id, task_name))
        .await
        .ok();

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
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
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

            let progress =
                Progress::in_progress(task_id, task_name, downloaded, total_size).with_speed(speed);

            progress_tx.send(progress).await.ok();

            last_progress_update = std::time::Instant::now();
            last_downloaded = downloaded;
        }
    }

    progress_tx
        .send(Progress::completed(task_id, task_name))
        .await
        .ok();
    Ok(())
}

/// Download and extract a model archive
pub async fn download_and_extract_model(
    url: &str,
    dest_dir: &Path,
    task_id: &str,
    task_name: &str,
    progress_tx: mpsc::Sender<Progress>,
) -> Result<(), String> {
    let temp_zip = dest_dir.with_extension("zip");

    // Download
    download_file(url, &temp_zip, task_id, task_name, progress_tx.clone()).await?;

    if is_cancelled() {
        tokio::fs::remove_file(&temp_zip).await.ok();
        return Err("Cancelled".to_string());
    }

    // Extract
    progress_tx
        .send(Progress::in_progress(task_id, task_name, 95, 100).with_message("正在解壓縮..."))
        .await
        .ok();

    // Use std::fs for zip extraction (sync operation)
    let zip_path = temp_zip.clone();
    let dest = dest_dir.to_path_buf();

    tokio::task::spawn_blocking(move || {
        let file =
            std::fs::File::open(&zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;

        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;

        std::fs::create_dir_all(&dest).map_err(|e| format!("Failed to create directory: {}", e))?;

        archive
            .extract(&dest)
            .map_err(|e| format!("Failed to extract: {}", e))?;

        // Clean up zip file
        std::fs::remove_file(&zip_path).ok();

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task error: {}", e))??;

    progress_tx
        .send(Progress::completed(task_id, task_name))
        .await
        .ok();
    Ok(())
}

/// Install all required components
pub async fn install_requirements(
    requirement_ids: Vec<String>,
    window: tauri::Window,
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

    for req_id in requirement_ids {
        if is_cancelled() {
            return Err("Installation cancelled by user".to_string());
        }

        match req_id.as_str() {
            // NOTE: Removed homebrew, cmake, ffmpeg install handlers
            // These are development dependencies, not needed for end users
            "whisper_model" => {
                // Whisper models are single .bin files from Hugging Face
                // 使用統一路徑: {app_data}/models/whisper/
                let whisper_dir = crate::paths::get_whisper_models_dir()?;
                std::fs::create_dir_all(&whisper_dir)
                    .map_err(|e| format!("創建目錄失敗: {}", e))?;

                let dest_file = whisper_dir.join("ggml-base.bin");
                download_file(
                    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
                    &dest_file,
                    "whisper_model",
                    "下載 Whisper 模型",
                    tx.clone(),
                )
                .await?;
            }
            "translation_model" => {
                // Translation model from GitHub Releases (ZIP file to extract)
                // 使用統一路徑: {app_data}/models/translation/
                let translation_dir = crate::paths::get_translation_models_dir()?;
                let dest = translation_dir.join("m2m100-418M-ct2-int8");
                download_and_extract_model(
                    "https://github.com/sklonely/ClassNoteAI/releases/download/v0.1.2-models/m2m100-418M-ct2-int8.zip",
                    &dest,
                    "translation_model",
                    "下載翻譯模型",
                    tx.clone()
                ).await?;
            }
            "embedding_model" => {
                // Embedding model from Hugging Face (individual files)
                // 使用統一路徑: {app_data}/models/embedding/
                let embedding_dir = crate::paths::get_embedding_models_dir()?;
                let dest_dir = embedding_dir.join("nomic-embed-text-v1");
                std::fs::create_dir_all(&dest_dir).map_err(|e| format!("創建目錄失敗: {}", e))?;

                let base_url = "https://huggingface.co/nomic-ai/nomic-embed-text-v1/resolve/main";
                let files = [
                    ("model.safetensors", "model.safetensors"),
                    ("tokenizer.json", "tokenizer.json"),
                    ("config.json", "config.json"),
                ];

                for (remote_file, local_file) in &files {
                    if is_cancelled() {
                        return Err("Installation cancelled by user".to_string());
                    }

                    let url = format!("{}/{}", base_url, remote_file);
                    let dest_file = dest_dir.join(local_file);

                    download_file(
                        &url,
                        &dest_file,
                        "embedding_model",
                        &format!("下載 Embedding 模型 ({})", local_file),
                        tx.clone(),
                    )
                    .await?;
                }
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
