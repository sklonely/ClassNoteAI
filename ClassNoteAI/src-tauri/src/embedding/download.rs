// Candle Embedding Model Download
//
// The active model in v0.5.2+ is BAAI/bge-small-en-v1.5. nomic-embed-
// text-v1 was the default before that but was architecturally
// incompatible with Candle's stock BertModel — see
// src-tauri/src/embedding/service.rs for the full story.

use anyhow::Result;
use reqwest;
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

/// Embedding 模型下載配置
pub struct EmbeddingModelConfig {
    pub model_name: String,
    pub files: Vec<(String, String)>, // (url, filename)
    pub output_dir: PathBuf,
}

impl EmbeddingModelConfig {
    /// Default config for BAAI/bge-small-en-v1.5 — the embedding model
    /// used by the app since v0.5.2. 384-d, ~33 MB, standard BERT
    /// (Candle-compatible). Cross-lingual queries are handled by
    /// translating the query to English before embedding, so an
    /// English-only encoder is appropriate here.
    pub fn bge_small(models_dir: PathBuf) -> Self {
        let base_url = "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main";
        let output_dir = models_dir.join("bge-small-en-v1.5");

        Self {
            model_name: "bge-small-en-v1.5".to_string(),
            files: vec![
                (
                    format!("{}/model.safetensors", base_url),
                    "model.safetensors".to_string(),
                ),
                (
                    format!("{}/tokenizer.json", base_url),
                    "tokenizer.json".to_string(),
                ),
                (
                    format!("{}/config.json", base_url),
                    "config.json".to_string(),
                ),
            ],
            output_dir,
        }
    }

    /// Legacy: all-MiniLM-L6-v2 (for backwards compatibility)
    pub fn minilm(models_dir: PathBuf) -> Self {
        let base_url = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main";
        let output_dir = models_dir.join("all-MiniLM-L6-v2");

        Self {
            model_name: "all-MiniLM-L6-v2".to_string(),
            files: vec![
                (
                    format!("{}/model.safetensors", base_url),
                    "model.safetensors".to_string(),
                ),
                (
                    format!("{}/tokenizer.json", base_url),
                    "tokenizer.json".to_string(),
                ),
                (
                    format!("{}/config.json", base_url),
                    "config.json".to_string(),
                ),
            ],
            output_dir,
        }
    }

    /// Get model path for EmbeddingService::new()
    pub fn model_path(&self) -> PathBuf {
        self.output_dir.join("model.safetensors")
    }

    /// Get tokenizer path for EmbeddingService::new()
    pub fn tokenizer_path(&self) -> PathBuf {
        self.output_dir.join("tokenizer.json")
    }
}

/// 下載單個文件
///
/// Handles the "partial download" case that bit us in v0.5.1: when a
/// previous run was killed mid-transfer, `output_path.exists()` returns
/// true but the file is truncated. The old code skipped on `exists()`
/// and the same partial file stayed on disk forever — every load
/// attempt then triggered the service-side size check, which just
/// pointed the user back at this downloader. Loop.
///
/// Fix: do a HEAD first to get Content-Length, and if the existing
/// file is materially smaller (<98%) treat it as corrupt and re-download.
async fn download_file(
    url: &str,
    output_path: &PathBuf,
    progress_callback: Option<&Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<()> {
    println!("[Embedding Download] Downloading from: {}", url);
    println!("[Embedding Download] Output: {:?}", output_path);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()?;

    // If something is already on disk, confirm it's actually complete
    // before skipping. A truncated safetensors passes exists() but
    // fails service.rs::new with a cryptic "cannot find tensor" error.
    if output_path.exists() {
        let metadata = tokio::fs::metadata(output_path).await?;
        let on_disk = metadata.len();

        // Probe remote Content-Length via HEAD. Some mirrors omit it;
        // in that case we fall back to the old "trust exists()" behaviour
        // rather than wastefully re-downloading a good file.
        let remote_size = match client.head(url).send().await {
            Ok(resp) if resp.status().is_success() => resp.content_length(),
            _ => None,
        };

        if let Some(expected) = remote_size {
            // Allow a tiny rounding tolerance (CDN gzip re-compress, etc.).
            let ratio = on_disk as f64 / expected.max(1) as f64;
            if ratio >= 0.98 {
                println!(
                    "[Embedding Download] File already exists and is complete ({} / {} bytes), skipping",
                    on_disk, expected
                );
                return Ok(());
            }
            println!(
                "[Embedding Download] Existing file is truncated ({} / {} bytes = {:.1}%), re-downloading",
                on_disk,
                expected,
                ratio * 100.0
            );
            // Remove the partial so we start clean.
            let _ = tokio::fs::remove_file(output_path).await;
        } else {
            println!(
                "[Embedding Download] File already exists ({} bytes), HEAD had no Content-Length — skipping",
                on_disk
            );
            return Ok(());
        }
    }

    // Create parent directory
    if let Some(parent) = output_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Download
    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "Download failed: HTTP {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    println!(
        "[Embedding Download] Total size: {:.2} MB",
        total_size as f64 / 1_000_000.0
    );

    let mut file = tokio::fs::File::create(output_path).await?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        if let Some(callback) = progress_callback {
            callback(downloaded, total_size);
        }
    }

    file.flush().await?;
    println!("[Embedding Download] Download complete: {:?}", output_path);

    Ok(())
}

/// 下載 Embedding 模型（所有必需文件）
pub async fn download_embedding_model(
    config: &EmbeddingModelConfig,
    progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<()> {
    println!(
        "[Embedding Download] Starting download for: {}",
        config.model_name
    );

    // Create output directory
    tokio::fs::create_dir_all(&config.output_dir).await?;

    // Download all files
    for (url, filename) in &config.files {
        let output_path = config.output_dir.join(filename);
        download_file(url, &output_path, progress_callback.as_ref()).await?;
    }

    // v0.5.2 upgrade-cleanup: if the old nomic-embed-text-v1 folder is
    // still sitting on disk from a pre-v0.5.2 install, delete it after
    // the new model has landed. 547 MB of dead weight per user otherwise.
    // Best-effort — logged-only on failure because the primary download
    // already succeeded and we don't want to block the "ready" state
    // on a disk cleanup quirk.
    if let Some(models_dir) = config.output_dir.parent() {
        let stale = models_dir.join("nomic-embed-text-v1");
        if stale.exists() {
            match tokio::fs::remove_dir_all(&stale).await {
                Ok(()) => println!(
                    "[Embedding Download] Cleaned up stale nomic-embed-text-v1 ({:?})",
                    stale
                ),
                Err(e) => println!(
                    "[Embedding Download] Could not remove stale nomic folder (non-fatal): {}",
                    e
                ),
            }
        }
    }

    println!(
        "[Embedding Download] All files for {} downloaded successfully",
        config.model_name
    );
    Ok(())
}
