// Candle Embedding Model Download
// Downloads nomic-embed-text-v1 model from Hugging Face

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
    /// Default config for nomic-embed-text-v1 (recommended)
    pub fn nomic_embed(models_dir: PathBuf) -> Self {
        let base_url = "https://huggingface.co/nomic-ai/nomic-embed-text-v1/resolve/main";
        let output_dir = models_dir.join("nomic-embed-text-v1");

        Self {
            model_name: "nomic-embed-text-v1".to_string(),
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

    /// Alternative: BGE-small-en (smaller and faster)
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
async fn download_file(
    url: &str,
    output_path: &PathBuf,
    progress_callback: Option<&Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<()> {
    println!("[Embedding Download] Downloading from: {}", url);
    println!("[Embedding Download] Output: {:?}", output_path);

    // Check if file already exists
    if output_path.exists() {
        let metadata = tokio::fs::metadata(output_path).await?;
        println!(
            "[Embedding Download] File already exists ({} bytes), skipping",
            metadata.len()
        );
        return Ok(());
    }

    // Create parent directory
    if let Some(parent) = output_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Download
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()?;

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

    println!(
        "[Embedding Download] All files for {} downloaded successfully",
        config.model_name
    );
    Ok(())
}
