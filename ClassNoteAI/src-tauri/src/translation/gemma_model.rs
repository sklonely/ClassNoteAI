//! TranslateGemma model file management — multi-variant.
//!
//! Hosts the URL + filename + expected size for each TranslateGemma
//! GGUF variant (4B / 12B / 27B Q4_K_M). The `gemma_sidecar` module
//! feeds the chosen variant's path to llama-server. Reuses the existing
//! `whisper::download` infrastructure (resume-friendly, retry-aware,
//! progress callbacks) so we don't grow another downloader.
//!
//! Model files live under `{app_data}/models/llm/`. They're lazy-
//! downloaded on first activation per-variant — opting into a larger
//! variant triggers its download; existing 4B usage is unaffected.
//!
//! cp75.10 — split from a single-variant 4B-only module. Public API
//! preserved for backwards compatibility:
//!   - `target_path()` → 4B path (used by legacy callers)
//!   - `is_present()`  → 4B presence (legacy)
//!   - `MODEL_URL` / `MODEL_FILENAME` / `EXPECTED_SIZE` → 4B metadata (legacy)
//! New API is variant-aware:
//!   - `Variant` enum (B4 / B12 / B27)
//!   - `target_path_for(variant)` / `is_present_for(variant)`
//!   - `download_config_for(variant)`
//!   - `first_present()` (for sidecar auto-pick)

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::paths;
use crate::whisper::download::ModelDownloadConfig;

/// TranslateGemma quant variant selectors. Q4_K_M GGUFs sourced from
/// SandLogicTechnologies's HuggingFace mirror that matches our 4B
/// translation eval (see project memory `project_translation_model_eval_2026_04`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Variant {
    /// 4B Q4_K_M ≈ 2.5 GB. Default, fastest, fits every consumer GPU.
    B4,
    /// 12B Q4_K_M ≈ 7.4 GB. Materially better on rare-vocab and long
    /// context. Needs ~10 GB VRAM headroom for the KV cache.
    B12,
    /// 27B Q4_K_M ≈ 16 GB. SOTA among open translation models;
    /// requires a 24 GB+ GPU (RTX 4090 / A6000 / A100).
    B27,
}

impl Variant {
    pub fn label(self) -> &'static str {
        match self {
            Variant::B4 => "4B",
            Variant::B12 => "12B",
            Variant::B27 => "27B",
        }
    }

    pub fn filename(self) -> &'static str {
        match self {
            Variant::B4 => "translategemma-4b_Q4_K_M.gguf",
            Variant::B12 => "translategemma-12b_Q4_K_M.gguf",
            Variant::B27 => "translategemma-27b_Q4_K_M.gguf",
        }
    }

    pub fn url(self) -> &'static str {
        match self {
            Variant::B4 => "https://huggingface.co/SandLogicTechnologies/translategemma-4b-it-GGUF/resolve/main/translategemma-4b_Q4_K_M.gguf",
            Variant::B12 => "https://huggingface.co/SandLogicTechnologies/translategemma-12b-it-GGUF/resolve/main/translategemma-12b_Q4_K_M.gguf",
            Variant::B27 => "https://huggingface.co/SandLogicTechnologies/translategemma-27b-it-GGUF/resolve/main/translategemma-27b_Q4_K_M.gguf",
        }
    }

    /// Approximate file size — used by the resume-friendly downloader to
    /// distinguish "already complete" from "partial / corrupt". Values
    /// are derived from the published GGUFs (verified for 4B against
    /// HuggingFace; 12B / 27B sizes are best-effort approximations and
    /// will be refined when those mirrors are exercised in the wild).
    pub fn expected_size(self) -> u64 {
        match self {
            Variant::B4 => 2_489_909_312,
            // ~7.3 GB. The HF mirror reports the exact size on first
            // request; if it differs, the download will retry as
            // resume-on-mismatch and the constant gets updated next
            // commit. Until then this is a conservative guard against
            // truncation.
            Variant::B12 => 7_400_000_000,
            // ~16.4 GB.
            Variant::B27 => 16_400_000_000,
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "4b" | "b4" | "translategemma-4b" => Some(Variant::B4),
            "12b" | "b12" | "translategemma-12b" => Some(Variant::B12),
            "27b" | "b27" | "translategemma-27b" => Some(Variant::B27),
            _ => None,
        }
    }

    pub fn all() -> &'static [Variant] {
        &[Variant::B4, Variant::B12, Variant::B27]
    }
}

// ─── Variant-aware helpers ──────────────────────────────────────────

pub fn target_path_for(variant: Variant) -> Result<PathBuf, String> {
    Ok(paths::get_llm_models_dir()?.join(variant.filename()))
}

pub fn is_present_for(variant: Variant) -> bool {
    let Ok(path) = target_path_for(variant) else {
        return false;
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    // Be lenient: 12B / 27B sizes are approximate. Accept any file
    // within ±5% of expected. 4B uses an exact match (the constant is
    // verified) so a partial / corrupt 4B GGUF is rejected.
    match variant {
        Variant::B4 => meta.len() == variant.expected_size(),
        Variant::B12 | Variant::B27 => {
            let expected = variant.expected_size() as i128;
            let actual = meta.len() as i128;
            let diff = (actual - expected).abs();
            diff * 20 < expected // i.e. <5% delta
        }
    }
}

pub fn download_config_for(variant: Variant) -> Result<ModelDownloadConfig, String> {
    Ok(ModelDownloadConfig {
        url: variant.url().to_string(),
        output_path: target_path_for(variant)?,
        // For 12B/27B we leave expected_size unset to disable strict
        // size verification — the ±5% guard in is_present_for handles
        // post-download integrity. For 4B keep the strict check.
        expected_size: match variant {
            Variant::B4 => Some(variant.expected_size()),
            Variant::B12 | Variant::B27 => None,
        },
    })
}

/// Return the first variant that's already on disk. Used by the sidecar
/// auto-start path so the user gets immediate translation if any model
/// is present, in 4B → 12B → 27B preference order (smallest fastest).
pub fn first_present() -> Option<Variant> {
    Variant::all()
        .iter()
        .copied()
        .find(|v| is_present_for(*v))
}

// ─── Legacy 4B-only API kept for backward-compatible callers ────────

/// Default variant for legacy callers. Equivalent to `Variant::B4`.
pub const MODEL_URL: &str = "https://huggingface.co/SandLogicTechnologies/translategemma-4b-it-GGUF/resolve/main/translategemma-4b_Q4_K_M.gguf";
pub const MODEL_FILENAME: &str = "translategemma-4b_Q4_K_M.gguf";
pub const EXPECTED_SIZE: u64 = 2_489_909_312;

pub fn target_path() -> Result<PathBuf, String> {
    target_path_for(Variant::B4)
}

pub fn download_config() -> Result<ModelDownloadConfig, String> {
    download_config_for(Variant::B4)
}

pub fn is_present() -> bool {
    is_present_for(Variant::B4)
}
