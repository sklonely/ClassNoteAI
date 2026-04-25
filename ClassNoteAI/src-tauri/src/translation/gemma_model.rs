//! TranslateGemma 4B Q4_K_M model file management.
//!
//! Hosts the URL + filename + expected size for the GGUF that the
//! `gemma_sidecar` module feeds to llama-server. Reuses the existing
//! `whisper::download` infrastructure (resume-friendly, retry-aware,
//! progress callbacks) so we don't grow another downloader.
//!
//! Model file lives at `{app_data}/models/llm/translategemma-4b_Q4_K_M.gguf`
//! (≈ 2.5 GB). It's lazy-downloaded on first activation so the installer
//! stays slim — opting into TranslateGemma is what triggers the download.

use std::path::PathBuf;

use crate::paths;
use crate::whisper::download::ModelDownloadConfig;

/// HuggingFace mirror — same Q4_K_M build we benchmarked against M2M100
/// in the EN→ZH translation eval (see project memory `project_translation_model_eval_2026_04`).
pub const MODEL_URL: &str =
    "https://huggingface.co/SandLogicTechnologies/translategemma-4b-it-GGUF/resolve/main/translategemma-4b_Q4_K_M.gguf";

/// Local filename inside the LLM models dir.
pub const MODEL_FILENAME: &str = "translategemma-4b_Q4_K_M.gguf";

/// Approximate file size — used by the resume-friendly downloader to
/// distinguish "already complete" from "partial / corrupt". Source:
/// the published Q4_K_M GGUF on HuggingFace (verified manually).
pub const EXPECTED_SIZE: u64 = 2_489_909_312;

/// Resolve the absolute target path under app data. Caller is responsible
/// for creating the parent dir before download (the downloader does this
/// too as a safety net).
pub fn target_path() -> Result<PathBuf, String> {
    Ok(paths::get_llm_models_dir()?.join(MODEL_FILENAME))
}

/// Build the download config for the existing `whisper::download::download_model`
/// pipeline. Same retry/resume guarantees as our Whisper downloads.
pub fn download_config() -> Result<ModelDownloadConfig, String> {
    Ok(ModelDownloadConfig {
        url: MODEL_URL.to_string(),
        output_path: target_path()?,
        expected_size: Some(EXPECTED_SIZE),
    })
}

/// True if the model file is on disk at the expected size. Doesn't open
/// the file — just stats it. Cheap enough to call from settings UI render.
pub fn is_present() -> bool {
    let Ok(path) = target_path() else {
        return false;
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return false;
    };
    meta.is_file() && meta.len() == EXPECTED_SIZE
}
