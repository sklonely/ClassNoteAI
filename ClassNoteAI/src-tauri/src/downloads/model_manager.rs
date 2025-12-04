/**
 * Model Manager
 * 
 * Manages model downloads and availability for all model types.
 * Unified interface for Whisper, Translation, and Embedding models.
 */

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::paths;
use super::downloader::{download_and_extract_zip, DownloadProgress};

/// Model types supported by the application
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelType {
    Whisper,
    Translation,
    Embedding,
}

impl ModelType {
    /// Get the directory name for this model type
    pub fn dir_name(&self) -> &'static str {
        match self {
            Self::Whisper => "whisper",
            Self::Translation => "translation",
            Self::Embedding => "embedding",
        }
    }
    
    /// Get the base directory for this model type
    pub fn get_base_dir(&self) -> Result<PathBuf, String> {
        match self {
            Self::Whisper => paths::get_whisper_models_dir(),
            Self::Translation => paths::get_translation_models_dir(),
            Self::Embedding => paths::get_embedding_models_dir(),
        }
    }
}

/// Model configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub name: String,
    pub display_name: String,
    pub model_type: ModelType,
    pub download_url: String,
    pub expected_size_mb: u64,
    pub check_file: String,  // File to check for model completeness (e.g., "model.bin")
}

/// Get available translation models
pub fn get_translation_model_configs() -> Vec<ModelConfig> {
    vec![
        ModelConfig {
            name: "m2m100-418M-ct2-int8".to_string(),
            display_name: "M2M100 (多語言翻譯, int8)".to_string(),
            model_type: ModelType::Translation,
            download_url: "https://github.com/sklonely/ClassNoteAI/releases/download/v0.1.2-models/m2m100-418M-ct2-int8.zip".to_string(),
            expected_size_mb: 440,
            check_file: "model.bin".to_string(),
        },
    ]
}

/// Get the path to a specific model
pub fn get_model_path(model_type: ModelType, model_name: &str) -> Result<PathBuf, String> {
    Ok(model_type.get_base_dir()?.join(model_name))
}

/// Check if a model is available (downloaded and complete)
pub fn is_model_available(model_type: ModelType, model_name: &str, check_file: &str) -> bool {
    if let Ok(model_path) = get_model_path(model_type, model_name) {
        let check_path = model_path.join(check_file);
        check_path.exists()
    } else {
        false
    }
}

/// List all available models of a given type
pub fn list_available_models(model_type: ModelType) -> Result<Vec<String>, String> {
    let base_dir = model_type.get_base_dir()?;
    
    if !base_dir.exists() {
        return Ok(vec![]);
    }
    
    let entries = std::fs::read_dir(&base_dir)
        .map_err(|e| format!("無法讀取目錄: {}", e))?;
    
    let mut models = Vec::new();
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    models.push(name.to_string());
                }
            }
        }
    }
    
    models.sort();
    Ok(models)
}

/// Download a model
pub async fn download_model<F>(
    config: &ModelConfig,
    progress_callback: Option<F>,
) -> Result<PathBuf, String>
where
    F: Fn(DownloadProgress) + Send + Sync,
{
    let model_path = get_model_path(config.model_type, &config.name)?;
    
    // Check if already downloaded
    let check_path = model_path.join(&config.check_file);
    if check_path.exists() {
        println!("[ModelManager] 模型已存在: {:?}", model_path);
        return Ok(model_path);
    }
    
    // Ensure base directory exists
    let base_dir = config.model_type.get_base_dir()?;
    paths::ensure_dir_exists(&base_dir)?;
    
    // Download and extract
    println!("[ModelManager] 開始下載模型: {}", config.name);
    download_and_extract_zip(&config.download_url, &model_path, progress_callback).await?;
    
    // Verify download
    if !check_path.exists() {
        return Err(format!("下載後驗證失敗: {:?} 不存在", check_path));
    }
    
    println!("[ModelManager] 模型下載完成: {:?}", model_path);
    Ok(model_path)
}

/// Ensure a model is available, downloading if necessary
pub async fn ensure_model_available<F>(
    model_type: ModelType,
    model_name: &str,
    progress_callback: Option<F>,
) -> Result<PathBuf, String>
where
    F: Fn(DownloadProgress) + Send + Sync,
{
    // Find config for this model
    let configs = match model_type {
        ModelType::Translation => get_translation_model_configs(),
        _ => vec![], // TODO: Add Whisper and Embedding configs
    };
    
    let config = configs.iter()
        .find(|c| c.name == model_name)
        .ok_or_else(|| format!("未知的模型: {}", model_name))?;
    
    download_model(config, progress_callback).await
}

/// Delete a downloaded model to free up space
pub fn delete_model(model_type: ModelType, model_name: &str) -> Result<(), String> {
    let model_path = get_model_path(model_type, model_name)?;
    
    if model_path.exists() {
        std::fs::remove_dir_all(&model_path)
            .map_err(|e| format!("刪除模型失敗: {}", e))?;
        println!("[ModelManager] 已刪除模型: {:?}", model_path);
    }
    
    Ok(())
}

/// Get the size of a model in bytes
pub fn get_model_size(model_type: ModelType, model_name: &str) -> Result<u64, String> {
    let model_path = get_model_path(model_type, model_name)?;
    
    if !model_path.exists() {
        return Ok(0);
    }
    
    let size = walkdir::WalkDir::new(&model_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum();
    
    Ok(size)
}
