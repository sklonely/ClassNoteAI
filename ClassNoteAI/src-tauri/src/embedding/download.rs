use anyhow::Result;
use std::path::PathBuf;
use reqwest;
use tokio::io::AsyncWriteExt;

/// Embedding 模型下載配置
pub struct EmbeddingModelConfig {
    pub model_url: String,
    pub tokenizer_url: String,
    pub model_output: PathBuf,
    pub tokenizer_output: PathBuf,
}

impl EmbeddingModelConfig {
    pub fn default(models_dir: PathBuf) -> Self {
        let base_url = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main";
        
        Self {
            model_url: format!("{}/onnx/model.onnx", base_url),
            tokenizer_url: format!("{}/tokenizer.json", base_url),
            model_output: models_dir.join("all-MiniLM-L6-v2.onnx"),
            tokenizer_output: models_dir.join("all-MiniLM-L6-v2-tokenizer.json"),
        }
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
        println!("[Embedding Download] File already exists ({} bytes), skipping", metadata.len());
        return Ok(());
    }

    // Create parent directory
    if let Some(parent) = output_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Download
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()?;

    let response = client.get(url).send().await?;
    
    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Download failed: HTTP {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    println!("[Embedding Download] Total size: {:.2} MB", total_size as f64 / 1_000_000.0);

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

/// 下載 Embedding 模型（模型文件 + Tokenizer）
pub async fn download_embedding_model(
    config: &EmbeddingModelConfig,
    progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<()> {
    println!("[Embedding Download] Starting download...");

    // Download model file
    download_file(
        &config.model_url,
        &config.model_output,
        progress_callback.as_ref(),
    ).await?;

    // Download tokenizer file
    download_file(
        &config.tokenizer_url,
        &config.tokenizer_output,
        progress_callback.as_ref(),
    ).await?;

    println!("[Embedding Download] All files downloaded successfully");
    Ok(())
}
