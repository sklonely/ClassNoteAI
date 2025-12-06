pub mod installer;
pub mod progress;
/**
 * Setup Module - First-Run Environment Detection & Installation
 *
 * This module handles:
 * 1. System environment detection (Homebrew, CMake, FFmpeg)
 * 2. Model availability checking (Whisper, CTranslate2)
 * 3. Automated installation with progress reporting
 */
pub mod requirements;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Re-export commonly used types
pub use installer::{cancel_current_installation, install_requirements};
pub use requirements::{check_all_requirements, Requirement, RequirementStatus};

/// Overall setup status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupStatus {
    /// Whether all required components are installed
    pub is_complete: bool,
    /// List of all requirements and their status
    pub requirements: Vec<Requirement>,
    /// Total size to download (in MB)
    pub total_download_size_mb: u64,
    /// Estimated installation time (in minutes)
    pub estimated_time_minutes: u32,
}

/// Model information for download (may be used in future setup wizard)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub download_url: String,
    pub size_mb: u64,
    pub sha256: String,
    pub is_required: bool,
}

/// Get the application data directory
/// Note: Now uses the unified paths module
#[allow(dead_code)] // Kept for API compatibility
pub fn get_app_data_dir() -> Result<PathBuf, String> {
    crate::paths::get_app_data_dir()
}

/// Get the models directory
pub fn get_models_dir() -> Result<PathBuf, String> {
    crate::paths::get_models_dir()
}

/// Get the setup status file path
fn get_setup_status_file() -> Result<PathBuf, String> {
    crate::paths::get_setup_complete_path()
}

/// Check if setup has been completed
pub async fn is_setup_complete() -> Result<bool, String> {
    let status_file = get_setup_status_file()?;
    Ok(status_file.exists())
}

/// Save setup completion status
pub async fn save_setup_status(complete: bool) -> Result<(), String> {
    let status_file = get_setup_status_file()?;

    // Ensure parent directory exists
    if let Some(parent) = status_file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    if complete {
        let status = serde_json::json!({
            "complete": true,
            "completed_at": chrono::Utc::now().to_rfc3339(),
            "version": env!("CARGO_PKG_VERSION"),
        });

        std::fs::write(&status_file, serde_json::to_string_pretty(&status).unwrap())
            .map_err(|e| format!("Failed to save setup status: {}", e))?;
    } else {
        // Remove the status file to mark as incomplete
        if status_file.exists() {
            std::fs::remove_file(&status_file)
                .map_err(|e| format!("Failed to remove setup status: {}", e))?;
        }
    }

    Ok(())
}

/// Get the full setup status
pub async fn get_setup_status() -> Result<SetupStatus, String> {
    let requirements = check_all_requirements().await?;

    let is_complete = requirements
        .iter()
        .all(|r| r.is_optional || matches!(r.status, RequirementStatus::Installed));

    let total_download_size_mb: u64 = requirements
        .iter()
        .filter(|r| !matches!(r.status, RequirementStatus::Installed))
        .map(|r| r.install_size_mb)
        .sum();

    // Rough estimate: 10MB per minute at 1MB/s, plus 2 minutes for installations
    let estimated_time_minutes = (total_download_size_mb / 10).max(1) as u32 + 2;

    Ok(SetupStatus {
        is_complete,
        requirements,
        total_download_size_mb,
        estimated_time_minutes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_app_data_dir() {
        let dir = get_app_data_dir();
        assert!(dir.is_ok());
        println!("App data dir: {:?}", dir.unwrap());
    }
}
