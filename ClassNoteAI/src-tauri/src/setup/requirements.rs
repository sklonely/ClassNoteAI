/**
 * Requirements Detection Module
 * 
 * Handles detection of all system and application requirements:
 * - System: Homebrew, CMake, FFmpeg
 * - Models: Whisper, CTranslate2 translation model
 */

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Requirement category
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RequirementCategory {
    /// System-level dependencies (Homebrew, CMake)
    System,
    /// AI/ML models (Whisper, Translation)
    Model,
    /// Runtime dependencies
    Runtime,
}

/// Status of a requirement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RequirementStatus {
    /// Installed and ready
    Installed,
    /// Not installed
    NotInstalled,
    /// Installed but outdated
    Outdated { current: String, required: String },
    /// Error checking status
    Error(String),
}

/// A single requirement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Requirement {
    /// Unique identifier
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Description of what this requirement is for
    pub description: String,
    /// Category of the requirement
    pub category: RequirementCategory,
    /// Current status
    pub status: RequirementStatus,
    /// Whether this requirement is optional
    pub is_optional: bool,
    /// Estimated size in MB for installation
    pub install_size_mb: u64,
    /// Command or URL to install
    pub install_source: Option<String>,
}

// NOTE: Removed unused system dependency check functions:
// - command_exists(), get_brew_path(), check_homebrew(), check_cmake(), check_ffmpeg()
// These were for development-time dependencies that end users don't need.
// The app is self-contained after packaging.

/// Check macOS version
pub fn check_macos_version() -> RequirementStatus {
    #[cfg(target_os = "macos")]
    {
        match Command::new("sw_vers").arg("-productVersion").output() {
            Ok(output) => {
                if output.status.success() {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    // Parse major version
                    let major: u32 = version.split('.').next()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0);
                    
                    if major >= 11 {
                        println!("[Setup] macOS version: {} (OK)", version);
                        RequirementStatus::Installed
                    } else {
                        RequirementStatus::Outdated {
                            current: version,
                            required: "11.0".to_string(),
                        }
                    }
                } else {
                    RequirementStatus::Error("Failed to get macOS version".to_string())
                }
            }
            Err(e) => RequirementStatus::Error(format!("Failed to check macOS version: {}", e)),
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        RequirementStatus::Installed // Not applicable on other platforms
    }
}

/// Check available disk space
pub fn check_disk_space(required_mb: u64) -> RequirementStatus {
    #[cfg(target_os = "macos")]
    {
        match Command::new("df").args(["-m", "/"]).output() {
            Ok(output) => {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    // Parse df output (second line, 4th column is available)
                    if let Some(line) = output_str.lines().nth(1) {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 4 {
                            if let Ok(available_mb) = parts[3].parse::<u64>() {
                                if available_mb >= required_mb {
                                    println!("[Setup] Disk space: {}MB available (need {}MB)", available_mb, required_mb);
                                    return RequirementStatus::Installed;
                                } else {
                                    return RequirementStatus::Outdated {
                                        current: format!("{}MB", available_mb),
                                        required: format!("{}MB", required_mb),
                                    };
                                }
                            }
                        }
                    }
                    RequirementStatus::Error("Failed to parse disk space".to_string())
                } else {
                    RequirementStatus::Error("Failed to check disk space".to_string())
                }
            }
            Err(e) => RequirementStatus::Error(format!("Failed to check disk space: {}", e)),
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        RequirementStatus::Installed // Simplified check for other platforms
    }
}

/// Check if a model exists at the given path
pub fn check_model(model_path: &Path, expected_files: &[&str]) -> RequirementStatus {
    if !model_path.exists() {
        return RequirementStatus::NotInstalled;
    }
    
    // Check for expected files
    for file in expected_files {
        let file_path = model_path.join(file);
        if !file_path.exists() {
            return RequirementStatus::NotInstalled;
        }
    }
    
    RequirementStatus::Installed
}

/// Check all requirements and return their status
pub async fn check_all_requirements() -> Result<Vec<Requirement>, String> {
    let models_dir = super::get_models_dir()?;
    
    println!("[Setup] Models directory: {:?}", models_dir);
    
    let mut requirements = Vec::new();
    
    // System requirements
    requirements.push(Requirement {
        id: "macos_version".to_string(),
        name: "macOS 版本".to_string(),
        description: "需要 macOS 11.0 (Big Sur) 或更高版本".to_string(),
        category: RequirementCategory::System,
        status: check_macos_version(),
        is_optional: false,
        install_size_mb: 0,
        install_source: None,
    });
    
    requirements.push(Requirement {
        id: "disk_space".to_string(),
        name: "磁碟空間".to_string(),
        description: "需要至少 1GB 可用空間".to_string(),
        category: RequirementCategory::System,
        status: check_disk_space(1024),
        is_optional: false,
        install_size_mb: 0,
        install_source: None,
    });
    
    // NOTE: Removed system dependencies (Homebrew, CMake, FFmpeg)
    // These are only needed at development/compile time, not for end users.
    // The app is self-contained after packaging - whisper-rs and ct2rs
    // statically link their native dependencies.
    
    // Model requirements - check multiple possible whisper models
    // Models are stored directly in models_dir (e.g. models/ggml-base.bin)
    let whisper_status = check_whisper_model(&models_dir);
    println!("[Setup] Whisper model status: {:?}", whisper_status);
    
    requirements.push(Requirement {
        id: "whisper_model".to_string(),
        name: "Whisper 語音識別模型".to_string(),
        description: "用於語音轉錄的 AI 模型".to_string(),
        category: RequirementCategory::Model,
        status: whisper_status,
        is_optional: false,
        install_size_mb: 150,
        install_source: Some("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin".to_string()),
    });
    
    // Translation model - M2M100 for multilingual translation
    let translation_path = models_dir.join("ct2").join("m2m100-418M-ct2-int8");
    let translation_status = check_model(&translation_path, &["model.bin", "shared_vocabulary.json"]);
    println!("[Setup] Translation model status: {:?}", translation_status);
    
    requirements.push(Requirement {
        id: "translation_model".to_string(),
        name: "M2M100 翻譯模型".to_string(),
        description: "多語言翻譯模型 (CTranslate2 格式, ~440MB)".to_string(),
        category: RequirementCategory::Model,
        status: translation_status,
        is_optional: false, // Required for translation feature
        install_size_mb: 440,
        install_source: Some("https://github.com/sklonely/ClassNoteAI/releases/download/v0.1.2-models/m2m100-418M-ct2-int8.zip".to_string()),
    });
    
    Ok(requirements)
}

/// Check if any Whisper model exists
fn check_whisper_model(models_dir: &Path) -> RequirementStatus {
    // List of possible whisper model files (check any of them)
    let possible_models = [
        "ggml-base.bin",
        "ggml-small.bin",
        "ggml-medium.bin",
        "ggml-large.bin",
        "ggml-tiny.bin",
        "ggml-small-q5.bin",
        "ggml-medium-q5.bin",
    ];
    
    for model in &possible_models {
        let model_path = models_dir.join(model);
        if model_path.exists() {
            println!("[Setup] Found Whisper model: {:?}", model_path);
            return RequirementStatus::Installed;
        }
    }
    
    println!("[Setup] No Whisper model found in {:?}", models_dir);
    RequirementStatus::NotInstalled
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_check_homebrew() {
        let status = check_homebrew();
        println!("Homebrew status: {:?}", status);
    }
    
    #[test]
    fn test_check_cmake() {
        let status = check_cmake();
        println!("CMake status: {:?}", status);
    }
    
    #[test]
    fn test_check_disk_space() {
        let status = check_disk_space(1024);
        println!("Disk space status: {:?}", status);
    }
}
