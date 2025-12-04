// Embedding service - requires 'embedding' feature due to protobuf conflict with ct2rs
// Enable with: cargo build --features embedding

#[cfg(feature = "embedding")]
pub mod service;
#[cfg(feature = "embedding")]
pub mod download;

#[cfg(feature = "embedding")]
pub use service::EmbeddingService;
#[cfg(feature = "embedding")]
pub use download::{download_embedding_model, EmbeddingModelConfig};

// Stub when embedding feature is disabled
#[cfg(not(feature = "embedding"))]
pub struct EmbeddingService;

#[cfg(not(feature = "embedding"))]
impl EmbeddingService {
    pub fn new<P: AsRef<std::path::Path>>(_model_path: P, _tokenizer_path: P) -> anyhow::Result<Self> {
        Err(anyhow::anyhow!("Embedding feature is disabled. Rebuild with --features embedding to enable."))
    }
    
    pub fn generate_embedding(&mut self, _text: &str) -> anyhow::Result<Vec<f32>> {
        Err(anyhow::anyhow!("Embedding feature is disabled"))
    }
    
    pub fn cosine_similarity(_a: &[f32], _b: &[f32]) -> f32 {
        0.0
    }
}
