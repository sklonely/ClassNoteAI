/**
 * Requirements Detection Module
 *
 * Handles detection of all system and application requirements:
 * - System: Homebrew, CMake, FFmpeg
 * - Models: Whisper, CTranslate2 translation model
 */
use crate::utils::command::no_window;
use serde::{Deserialize, Serialize};
use std::path::Path;

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

/// Check OS version (macOS or Windows)
///
/// - macOS: requires 11.0 (Big Sur) or later via `sw_vers -productVersion`.
/// - Windows: requires build 17763 (Windows 10 1809, WebView2 baseline) or
///   later. Parsed from `cmd /c ver`, which prints e.g.
///   `Microsoft Windows [Version 10.0.22631.4890]`.
pub fn check_os_version() -> RequirementStatus {
    #[cfg(target_os = "macos")]
    {
        match no_window("sw_vers").arg("-productVersion").output() {
            Ok(output) => {
                if output.status.success() {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let major: u32 = version
                        .split('.')
                        .next()
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

    #[cfg(target_os = "windows")]
    {
        // Minimum: Windows 10 1809 (build 17763) — WebView2 baseline.
        const MIN_BUILD: u32 = 17763;

        match no_window("cmd").args(["/c", "ver"]).output() {
            Ok(output) => {
                if !output.status.success() {
                    return RequirementStatus::Error(
                        "Failed to get Windows version".to_string(),
                    );
                }
                let raw = String::from_utf8_lossy(&output.stdout);
                // Expect `Microsoft Windows [Version 10.0.22631.4890]` on
                // English systems. On localized Windows the word "Version"
                // is translated (e.g. "版本" in zh-TW/zh-CN), so parse the
                // dot-separated version number inside the brackets instead
                // of relying on the keyword.
                let inside_brackets = raw
                    .split('[')
                    .nth(1)
                    .and_then(|s| s.split(']').next())
                    .unwrap_or("");

                let version_str = inside_brackets
                    .split_whitespace()
                    .find(|tok| {
                        tok.chars()
                            .all(|c| c.is_ascii_digit() || c == '.')
                            && tok.contains('.')
                    })
                    .unwrap_or("")
                    .to_string();

                let build: u32 = version_str
                    .split('.')
                    .nth(2)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);

                if build == 0 {
                    return RequirementStatus::Error(format!(
                        "Failed to parse Windows version: {}",
                        raw.trim()
                    ));
                }

                if build >= MIN_BUILD {
                    println!("[Setup] Windows version: {} (build {}) OK", version_str, build);
                    RequirementStatus::Installed
                } else {
                    RequirementStatus::Outdated {
                        current: version_str,
                        required: format!("10.0.{} (Windows 10 1809+)", MIN_BUILD),
                    }
                }
            }
            Err(e) => RequirementStatus::Error(format!("Failed to check Windows version: {}", e)),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        RequirementStatus::Installed // Other platforms (Linux etc.) — no check.
    }
}

/// Check available disk space on the drive hosting the app data directory.
pub fn check_disk_space(required_mb: u64) -> RequirementStatus {
    #[cfg(target_os = "macos")]
    {
        match no_window("df").args(["-m", "/"]).output() {
            Ok(output) => {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    if let Some(line) = output_str.lines().nth(1) {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 4 {
                            if let Ok(available_mb) = parts[3].parse::<u64>() {
                                if available_mb >= required_mb {
                                    println!(
                                        "[Setup] Disk space: {}MB available (need {}MB)",
                                        available_mb, required_mb
                                    );
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

    #[cfg(target_os = "windows")]
    {
        use std::path::Component;
        // Resolve the drive the app data lives on; fall back to "C:\".
        let probe_path: String = crate::paths::get_app_data_dir()
            .ok()
            .and_then(|p| {
                p.components().next().and_then(|c| match c {
                    Component::Prefix(pref) => {
                        Some(format!("{}\\", pref.as_os_str().to_string_lossy()))
                    }
                    _ => None,
                })
            })
            .unwrap_or_else(|| "C:\\".to_string());

        // Use [System.IO.DriveInfo] to get free bytes. Works on every
        // supported Windows build without needing wmic or fsutil.
        //
        // The probe path is passed as a PowerShell script-block parameter
        // (`& { param($p) ... } "<path>"`). The earlier form used
        // `$args[0]` inside a plain -Command string, but `$args` is ONLY
        // populated when PowerShell is invoked with -File (or a script
        // block) — under -Command "<string>" the trailing positional
        // arguments get tokenised as additional script statements, which
        // fails with `ParserError: UnexpectedToken 'C:\'`. This quirk
        // silently broke disk-space detection on every Windows install:
        // the PowerShell call exited 1, RequirementStatus became Error,
        // and the setup wizard showed "insufficient disk space" to users
        // who actually had hundreds of GB free (reported: 2026-04-18).
        //
        // Using a script block with `param($p)` explicitly binds the
        // positional arg to a variable, which works under both -Command
        // and -File, and cleanly sidesteps any interpretation of
        // backticks / $ / apostrophes that might appear in a Windows
        // path with an unusual username.
        match no_window("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "& { param($p) [System.IO.DriveInfo]::new($p).AvailableFreeSpace }",
                &probe_path,
            ])
            .output()
        {
            Ok(output) => {
                if !output.status.success() {
                    return RequirementStatus::Error(format!(
                        "Failed to check disk space: {}",
                        String::from_utf8_lossy(&output.stderr).trim()
                    ));
                }
                let trimmed = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .to_string();
                match trimmed.parse::<u64>() {
                    Ok(bytes) => {
                        let available_mb = bytes / 1024 / 1024;
                        if available_mb >= required_mb {
                            println!(
                                "[Setup] Disk space ({}): {}MB available (need {}MB)",
                                probe_path, available_mb, required_mb
                            );
                            RequirementStatus::Installed
                        } else {
                            RequirementStatus::Outdated {
                                current: format!("{}MB", available_mb),
                                required: format!("{}MB", required_mb),
                            }
                        }
                    }
                    Err(_) => RequirementStatus::Error(format!(
                        "Failed to parse disk space output: {}",
                        trimmed
                    )),
                }
            }
            Err(e) => RequirementStatus::Error(format!("Failed to check disk space: {}", e)),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        RequirementStatus::Installed
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
    #[cfg(target_os = "windows")]
    let os_req = Requirement {
        id: "os_version".to_string(),
        name: "Windows 版本".to_string(),
        description: "需要 Windows 10 1809 (build 17763) 或更高版本".to_string(),
        category: RequirementCategory::System,
        status: check_os_version(),
        is_optional: false,
        install_size_mb: 0,
        install_source: None,
    };
    #[cfg(target_os = "macos")]
    let os_req = Requirement {
        id: "os_version".to_string(),
        name: "macOS 版本".to_string(),
        description: "需要 macOS 11.0 (Big Sur) 或更高版本".to_string(),
        category: RequirementCategory::System,
        status: check_os_version(),
        is_optional: false,
        install_size_mb: 0,
        install_source: None,
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let os_req = Requirement {
        id: "os_version".to_string(),
        name: "作業系統版本".to_string(),
        description: "作業系統相容性檢查".to_string(),
        category: RequirementCategory::System,
        status: check_os_version(),
        is_optional: false,
        install_size_mb: 0,
        install_source: None,
    };
    requirements.push(os_req);

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
    // 使用統一路徑: {app_data}/models/whisper/
    let whisper_dir = crate::paths::get_whisper_models_dir()?;
    let whisper_status = check_whisper_model(&whisper_dir);
    println!("[Setup] Whisper model status: {:?}", whisper_status);

    requirements.push(Requirement {
        id: "whisper_model".to_string(),
        name: "Whisper 語音識別模型".to_string(),
        description: "用於語音轉錄的 AI 模型".to_string(),
        category: RequirementCategory::Model,
        status: whisper_status,
        is_optional: false,
        install_size_mb: 150,
        install_source: Some(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin".to_string(),
        ),
    });

    // Translation model - M2M100 for multilingual translation
    // 使用統一路徑: {app_data}/models/translation/
    let translation_dir = crate::paths::get_translation_models_dir()?;
    let translation_path = translation_dir.join("m2m100-418M-ct2-int8");
    let translation_status =
        check_model(&translation_path, &["model.bin", "shared_vocabulary.json"]);
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

    // Embedding model - BAAI/bge-small-en-v1.5 (standard BERT, Candle-compatible).
    // v0.5.2: replaced nomic-embed-text-v1, which uses the NomicBert architecture
    // that Candle's stock BertModel::load cannot decode. Cross-lingual
    // zh-query → en-content retrieval is handled by translating the query
    // upstream before embedding, so an English-only embedder is appropriate.
    let embedding_dir = crate::paths::get_embedding_models_dir()?;
    let embedding_path = embedding_dir.join("bge-small-en-v1.5");
    let embedding_status = check_model(
        &embedding_path,
        &["model.safetensors", "tokenizer.json", "config.json"],
    );
    println!("[Setup] Embedding model status: {:?}", embedding_status);

    requirements.push(Requirement {
        id: "embedding_model".to_string(),
        name: "BGE-small-en Embedding 模型".to_string(),
        description: "文本嵌入模型，用於 RAG 檢索與 PDF 對齊 (~33MB，標準 BERT)".to_string(),
        category: RequirementCategory::Model,
        status: embedding_status,
        is_optional: true, // Optional - PDF alignment feature
        install_size_mb: 33,
        install_source: Some("https://huggingface.co/BAAI/bge-small-en-v1.5".to_string()),
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
    fn test_check_disk_space() {
        let status = check_disk_space(1024);
        println!("Disk space status: {:?}", status);
    }

    /// Regression test: CI runners have hundreds of GB free, so a 1 MB
    /// required amount MUST return Installed on every platform.
    /// Anything else means the probe itself is broken — which is the
    /// exact bug we shipped in v0.5.2: PowerShell's `$args` variable
    /// doesn't work with `-Command` on Windows, so the subprocess
    /// exited non-zero with a `ParserError: UnexpectedToken 'C:\'`
    /// every time, and the wizard told every user with a 500 GB SSD
    /// that they had "insufficient disk space".
    ///
    /// Uses 1 MB because CI runners always have more than that —
    /// if THIS test fails on a dev machine it's a disk-space issue,
    /// not a probe issue.
    #[test]
    fn check_disk_space_returns_installed_when_space_clearly_available() {
        let status = check_disk_space(1);
        match status {
            RequirementStatus::Installed => {}
            other => panic!(
                "Expected Installed for a 1 MB requirement on any system with >1 MB free; got: {:?}",
                other
            ),
        }
    }

    #[test]
    fn test_check_os_version() {
        let status = check_os_version();
        println!("OS version status: {:?}", status);
    }
}
