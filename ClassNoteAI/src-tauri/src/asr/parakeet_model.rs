//! Nemotron streaming ASR model file management.
//!
//! Mirrors `translation::gemma_model` for the in-process Nemotron
//! engine. The model lives as 3-4 files in one directory; the
//! `parakeet-rs` crate's `Nemotron::from_pretrained(dir, …)` reads
//! all of them as soon as we point it at `model_dir(variant)`.
//!
//! Two variants ship side-by-side under separate subdirs so users
//! can A/B without losing either:
//!
//! ## INT8 (default) — ~852 MB total
//!
//! Mirror: `lokkju/nemotron-speech-streaming-en-0.6b-int8`
//!   * `tokenizer.model`     — 251 KB SentencePiece vocab
//!   * `decoder_joint.onnx`  — 11 MB joint network
//!   * `encoder.onnx`        — 840 MB graph + bundled weights (no
//!                              separate `.data` file — the int8
//!                              quantization shrunk weights enough
//!                              to fit inside the protobuf)
//!
//! Per the upstream report the WER delta vs FP32 is 8.01% vs 8.03% —
//! within rounding noise. The 65% size reduction is what makes this
//! the user-facing default.
//!
//! ## FP32 — ~2.51 GB total
//!
//! Mirror: `altunenes/parakeet-rs/nemotron-speech-streaming-en-0.6b`
//! (the maintainer's blessed bundle, what `examples/streaming.rs` is
//! hardcoded against).
//!   * `tokenizer.model`     — 251 KB
//!   * `decoder_joint.onnx`  — 36 MB
//!   * `encoder.onnx`        — 42 MB graph
//!   * `encoder.onnx.data`   — 2.44 GB external weights
//!
//! Kept as the "I want max accuracy" / debugging option. Loaded the
//! same way through `Nemotron::from_pretrained` — the crate auto-
//! detects whether external weight data is present.

use std::path::PathBuf;

use crate::paths;
use crate::whisper::download::ModelDownloadConfig;

/// Quantization variant. Renderer passes this as `"int8"` / `"fp32"`
/// strings via Tauri commands; serde handles the conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Variant {
    Int8,
    Fp32,
}

impl Variant {
    /// All variants in display order. Used by status commands and the
    /// auto-load setup hook so we don't drift if a third variant ever
    /// lands (int4 is the obvious next).
    pub const fn all() -> &'static [Variant] {
        &[Variant::Int8, Variant::Fp32]
    }

    /// Subdirectory under `{app_data}/models/`. Distinct names so
    /// both variants can be present simultaneously without one
    /// stomping the other.
    pub const fn dir_name(&self) -> &'static str {
        match self {
            Variant::Int8 => "parakeet-nemotron-int8",
            Variant::Fp32 => "parakeet-nemotron-fp32",
        }
    }

    /// HuggingFace base URL. Files are appended as `{base}/{filename}`.
    pub const fn base_url(&self) -> &'static str {
        match self {
            Variant::Int8 => {
                "https://huggingface.co/lokkju/nemotron-speech-streaming-en-0.6b-int8/resolve/main"
            }
            Variant::Fp32 => {
                "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-speech-streaming-en-0.6b"
            }
        }
    }

    /// File manifest. Sizes verified against HF's tree API on
    /// 2026-04-24; if these drift, the resume-friendly downloader will
    /// re-download from byte zero rather than corrupt-load.
    pub const fn files(&self) -> &'static [ModelFile] {
        match self {
            Variant::Int8 => INT8_FILES,
            Variant::Fp32 => FP32_FILES,
        }
    }

    /// Canonical lower-case label for logging / serialization.
    pub const fn label(&self) -> &'static str {
        match self {
            Variant::Int8 => "int8",
            Variant::Fp32 => "fp32",
        }
    }
}

/// One downloadable file from a model bundle.
pub struct ModelFile {
    pub name: &'static str,
    pub size: u64,
}

/// INT8 — 3 files, ~852 MB.
const INT8_FILES: &[ModelFile] = &[
    ModelFile { name: "tokenizer.model",    size: 251_056 },
    ModelFile { name: "decoder_joint.onnx", size: 10_962_697 },
    ModelFile { name: "encoder.onnx",       size: 880_555_453 },
];

/// FP32 — 4 files, ~2.51 GB.
const FP32_FILES: &[ModelFile] = &[
    ModelFile { name: "tokenizer.model",    size: 251_056 },
    ModelFile { name: "decoder_joint.onnx", size: 35_779_240 },
    ModelFile { name: "encoder.onnx",       size: 42_159_995 },
    ModelFile { name: "encoder.onnx.data",  size: 2_436_567_040 },
];

/// On-disk footprint of a fully downloaded variant.
pub fn total_size(variant: Variant) -> u64 {
    variant.files().iter().map(|f| f.size).sum()
}

/// Resolve the model directory under app data for one variant.
pub fn model_dir(variant: Variant) -> Result<PathBuf, String> {
    Ok(paths::get_models_dir()?.join(variant.dir_name()))
}

/// Download config for one specific file in one variant.
pub fn download_config_for(
    variant: Variant,
    file: &ModelFile,
) -> Result<ModelDownloadConfig, String> {
    let dir = model_dir(variant)?;
    Ok(ModelDownloadConfig {
        url: format!("{}/{}", variant.base_url(), file.name),
        output_path: dir.join(file.name),
        expected_size: Some(file.size),
    })
}

/// All download configs for one variant in size-ascending order
/// (small files first → fast failure on a wrong URL before we hit
/// the multi-GB tarpit).
pub fn all_download_configs(variant: Variant) -> Result<Vec<ModelDownloadConfig>, String> {
    variant
        .files()
        .iter()
        .map(|f| download_config_for(variant, f))
        .collect()
}

/// True iff every required file is on disk at the expected size.
pub fn is_present(variant: Variant) -> bool {
    let Ok(dir) = model_dir(variant) else { return false };
    variant.files().iter().all(|f| {
        let path = dir.join(f.name);
        match std::fs::metadata(&path) {
            Ok(meta) => meta.is_file() && meta.len() == f.size,
            Err(_) => false,
        }
    })
}

/// Bytes already on disk for one variant. Resume-aware (a half-
/// downloaded file counts up to its `size`, never more).
pub fn bytes_on_disk(variant: Variant) -> u64 {
    let Ok(dir) = model_dir(variant) else { return 0 };
    variant
        .files()
        .iter()
        .map(|f| {
            std::fs::metadata(dir.join(f.name))
                .map(|m| m.len().min(f.size))
                .unwrap_or(0)
        })
        .sum()
}

/// First variant that's fully present on disk, in display order
/// (INT8 wins over FP32 if both are downloaded — INT8 is faster).
/// Used by the setup hook to pick what to auto-load.
pub fn first_present() -> Option<Variant> {
    Variant::all().iter().copied().find(|v| is_present(*v))
}
