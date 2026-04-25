//! Legacy `whisper` module — only the resume-friendly model downloader
//! survives in v2. The Whisper-rs ASR backend (transcribe / model /
//! guards / WhisperService) was deleted alongside the rolling-buffer
//! transcription pipeline; ASR now lives in `crate::asr` (Parakeet
//! sidecar).
//!
//! `download.rs` stays because it's a generic resume-friendly downloader
//! with progress callbacks — `crate::translation::gemma_model` reuses
//! it for the TranslateGemma GGUF lazy-download flow. A future PR may
//! lift it into `crate::downloads` and rename this module out of
//! existence; for now keeping the import path preserves churn.

pub mod download;
