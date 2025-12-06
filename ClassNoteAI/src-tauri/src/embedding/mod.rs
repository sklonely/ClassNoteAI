// Candle-based Embedding Service
// Uses Candle ML framework instead of ONNX to avoid protobuf conflict with ct2rs
// Enable with: cargo build --features candle-embed

#[cfg(feature = "candle-embed")]
pub mod download;
#[cfg(feature = "candle-embed")]
pub mod service;

#[cfg(feature = "candle-embed")]
pub use download::{download_embedding_model, EmbeddingModelConfig};
#[cfg(feature = "candle-embed")]
pub use service::EmbeddingService;

// Stub when candle-embed feature is disabled
#[cfg(not(feature = "candle-embed"))]
pub struct EmbeddingService;

#[cfg(not(feature = "candle-embed"))]
impl EmbeddingService {
    pub fn new<P: AsRef<std::path::Path>>(
        _model_path: P,
        _tokenizer_path: P,
    ) -> anyhow::Result<Self> {
        Err(anyhow::anyhow!(
            "Candle embedding feature is disabled. Rebuild with --features candle-embed to enable."
        ))
    }

    pub fn generate_embedding(&mut self, _text: &str) -> anyhow::Result<Vec<f32>> {
        Err(anyhow::anyhow!("Candle embedding feature is disabled"))
    }

    pub fn cosine_similarity(_a: &[f32], _b: &[f32]) -> f32 {
        0.0
    }
}
