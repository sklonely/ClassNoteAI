/**
 * App Directories Module
 *
 * Provides unified access to application directories.
 * Works consistently in both development and packaged environments.
 *
 * All app data is stored under:
 * - macOS: ~/Library/Application Support/com.classnoteai/
 * - Windows: %APPDATA%/com.classnoteai/
 * - Linux: ~/.local/share/com.classnoteai/
 */
use std::path::PathBuf;

/// Bundle identifier for the app
pub const BUNDLE_ID: &str = "com.classnoteai";

/// Get the app data directory
///
/// Returns the platform-specific app data directory:
/// - macOS: ~/Library/Application Support/com.classnoteai/
/// - Windows: %APPDATA%/com.classnoteai/
/// - Linux: ~/.local/share/com.classnoteai/
pub fn get_app_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return Ok(home.join("Library/Application Support").join(BUNDLE_ID));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return Ok(PathBuf::from(appdata).join(BUNDLE_ID));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            return Ok(home.join(".local/share").join(BUNDLE_ID));
        }
    }

    Err("無法確定應用數據目錄".to_string())
}

/// Get the models directory
///
/// Returns: {app_data_dir}/models/
pub fn get_models_dir() -> Result<PathBuf, String> {
    Ok(get_app_data_dir()?.join("models"))
}

/// Get the translation models directory
///
/// Returns: {app_data_dir}/models/translation/
pub fn get_translation_models_dir() -> Result<PathBuf, String> {
    Ok(get_models_dir()?.join("translation"))
}

/// Get the Whisper models directory
///
/// Returns: {app_data_dir}/models/whisper/
pub fn get_whisper_models_dir() -> Result<PathBuf, String> {
    Ok(get_models_dir()?.join("whisper"))
}

/// Get the embedding models directory
///
/// Returns: {app_data_dir}/models/embedding/
pub fn get_embedding_models_dir() -> Result<PathBuf, String> {
    Ok(get_models_dir()?.join("embedding"))
}

/// Get the documents directory
///
/// Returns: {app_data_dir}/documents/
pub fn get_documents_dir() -> Result<PathBuf, String> {
    Ok(get_app_data_dir()?.join("documents"))
}

/// Get the audio directory
///
/// Returns: {app_data_dir}/audio/
pub fn get_audio_dir() -> Result<PathBuf, String> {
    Ok(get_app_data_dir()?.join("audio"))
}

/// Get the database file path
///
/// Returns: {app_data_dir}/classnoteai.db
pub fn get_database_path() -> Result<PathBuf, String> {
    Ok(get_app_data_dir()?.join("classnoteai.db"))
}

/// Get the setup complete marker file path
///
/// Returns: {app_data_dir}/setup_complete.json
pub fn get_setup_complete_path() -> Result<PathBuf, String> {
    Ok(get_app_data_dir()?.join("setup_complete.json"))
}

/// Get the cache directory
///
/// Returns: {app_data_dir}/cache/
pub fn get_cache_dir() -> Result<PathBuf, String> {
    Ok(get_app_data_dir()?.join("cache"))
}

/// Ensure a directory exists, creating it if necessary
pub fn ensure_dir_exists(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        std::fs::create_dir_all(path).map_err(|e| format!("無法創建目錄 {:?}: {}", path, e))?;
    }
    Ok(())
}

/// Initialize all app directories
///
/// Creates all necessary directories if they don't exist.
/// Should be called during app startup.
pub fn init_app_dirs() -> Result<(), String> {
    let dirs = [
        get_app_data_dir()?,
        get_models_dir()?,
        get_translation_models_dir()?,
        get_whisper_models_dir()?,
        get_embedding_models_dir()?,
        get_documents_dir()?,
        get_audio_dir()?,
        get_cache_dir()?,
    ];

    for dir in dirs {
        ensure_dir_exists(&dir)?;
    }

    println!(
        "[Paths] App directories initialized: {:?}",
        get_app_data_dir()?
    );
    Ok(())
}

/// Get storage usage for all app data
pub fn get_storage_usage() -> Result<StorageUsage, String> {
    let models_size = dir_size(&get_models_dir()?);
    let documents_size = dir_size(&get_documents_dir()?);
    let cache_size = dir_size(&get_cache_dir()?);
    let database_size = std::fs::metadata(get_database_path()?)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(StorageUsage {
        total: models_size + documents_size + cache_size + database_size,
        models: models_size,
        documents: documents_size,
        cache: cache_size,
        database: database_size,
    })
}

/// Storage usage information
#[derive(Debug, Clone, serde::Serialize)]
pub struct StorageUsage {
    pub total: u64,
    pub models: u64,
    pub documents: u64,
    pub cache: u64,
    pub database: u64,
}

/// Calculate directory size recursively
fn dir_size(path: &PathBuf) -> u64 {
    if !path.exists() {
        return 0;
    }

    walkdir::WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_app_data_dir() {
        let dir = get_app_data_dir();
        assert!(dir.is_ok());
        let path = dir.unwrap();
        assert!(path.to_string_lossy().contains(BUNDLE_ID));
    }

    #[test]
    fn test_get_models_dir() {
        let dir = get_models_dir();
        assert!(dir.is_ok());
        let path = dir.unwrap();
        assert!(path.to_string_lossy().contains("models"));
    }
}
