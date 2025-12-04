pub mod service;
pub mod download;

pub use service::EmbeddingService;
pub use download::{download_embedding_model, EmbeddingModelConfig};
