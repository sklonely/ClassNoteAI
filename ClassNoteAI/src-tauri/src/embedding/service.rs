// Candle-based Embedding Service
// Uses Candle ML framework instead of ONNX to avoid protobuf conflict with ct2rs

use anyhow::{anyhow, Result};
use std::path::Path;
use tokenizers::Tokenizer;

#[cfg(feature = "candle-embed")]
use candle_core::{DType, Device, Tensor};
#[cfg(feature = "candle-embed")]
use candle_nn::VarBuilder;
#[cfg(feature = "candle-embed")]
use candle_transformers::models::bert::{BertModel, Config};

/// Candle-based Embedding Service
pub struct EmbeddingService {
    #[cfg(feature = "candle-embed")]
    model: BertModel,
    tokenizer: Tokenizer,
    #[cfg(feature = "candle-embed")]
    device: Device,
}

impl EmbeddingService {
    /// Create a new embedding service from model and tokenizer paths
    ///
    /// # Arguments
    /// * `model_path` - Path to safetensors model file
    /// * `tokenizer_path` - Path to tokenizer.json file
    #[cfg(feature = "candle-embed")]
    pub fn new<P: AsRef<Path>>(model_path: P, tokenizer_path: P) -> Result<Self> {
        let model_path = model_path.as_ref();
        let tokenizer_path = tokenizer_path.as_ref();

        if !model_path.exists() {
            return Err(anyhow!("Model file not found: {:?}", model_path));
        }
        if !tokenizer_path.exists() {
            return Err(anyhow!("Tokenizer file not found: {:?}", tokenizer_path));
        }

        // Load Tokenizer
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| anyhow!("Failed to load tokenizer: {}", e))?;

        // Use CPU device (Metal support can be added later)
        let device = Device::Cpu;

        // Load config
        let config_path = model_path
            .parent()
            .ok_or_else(|| anyhow!("Invalid model path"))?
            .join("config.json");

        let config: Config = serde_json::from_str(
            &std::fs::read_to_string(&config_path)
                .map_err(|e| anyhow!("Failed to read config: {}", e))?,
        )
        .map_err(|e| anyhow!("Failed to parse config: {}", e))?;

        // Load model weights from safetensors
        let vb =
            unsafe { VarBuilder::from_mmaped_safetensors(&[model_path], DType::F32, &device)? };

        let model = BertModel::load(vb, &config)?;

        Ok(Self {
            model,
            tokenizer,
            device,
        })
    }

    /// Stub constructor when candle-embed feature is disabled
    #[cfg(not(feature = "candle-embed"))]
    pub fn new<P: AsRef<Path>>(_model_path: P, _tokenizer_path: P) -> Result<Self> {
        Err(anyhow!(
            "Candle embedding feature is disabled. Rebuild with --features candle-embed to enable."
        ))
    }

    /// Generate embedding for text
    #[cfg(feature = "candle-embed")]
    pub fn generate_embedding(&mut self, text: &str) -> Result<Vec<f32>> {
        // Tokenize
        let encoding = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| anyhow!("Tokenization failed: {}", e))?;

        let input_ids: Vec<u32> = encoding.get_ids().to_vec();
        let attention_mask: Vec<u32> = encoding.get_attention_mask().to_vec();
        let token_type_ids: Vec<u32> = encoding.get_type_ids().to_vec();

        let seq_len = input_ids.len();

        // Convert to tensors
        let input_ids = Tensor::new(&input_ids[..], &self.device)?.unsqueeze(0)?;
        let attention_mask_tensor = Tensor::new(&attention_mask[..], &self.device)?.unsqueeze(0)?;
        let token_type_ids = Tensor::new(&token_type_ids[..], &self.device)?.unsqueeze(0)?;

        // Forward pass
        let embeddings =
            self.model
                .forward(&input_ids, &token_type_ids, Some(&attention_mask_tensor))?;

        // Mean pooling with attention mask
        let (_, _, hidden_size) = embeddings.dims3()?;

        // Get attention mask as f32 for multiplication
        let mask = attention_mask_tensor.to_dtype(DType::F32)?;
        let mask_expanded = mask.unsqueeze(2)?.broadcast_as((1, seq_len, hidden_size))?;

        // Apply mask and sum
        let masked = embeddings.mul(&mask_expanded)?;
        let summed = masked.sum(1)?;

        // Count non-zero mask entries
        let mask_sum = mask.sum_all()?.to_scalar::<f32>()?;

        // Mean pooling
        let pooled = if mask_sum > 0.0 {
            summed.affine(1.0 / mask_sum as f64, 0.0)?
        } else {
            summed
        };

        // L2 normalize
        let norm = pooled.sqr()?.sum_all()?.sqrt()?.to_scalar::<f32>()?;
        let normalized = if norm > 0.0 {
            pooled.affine(1.0 / norm as f64, 0.0)?
        } else {
            pooled
        };

        // Convert to Vec<f32>
        let result: Vec<f32> = normalized.squeeze(0)?.to_vec1()?;
        Ok(result)
    }

    /// Stub when candle-embed feature is disabled
    #[cfg(not(feature = "candle-embed"))]
    pub fn generate_embedding(&mut self, _text: &str) -> Result<Vec<f32>> {
        Err(anyhow!("Candle embedding feature is disabled"))
    }

    /// Compute cosine similarity between two embeddings
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() {
            return 0.0;
        }
        let dot_product: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            0.0
        } else {
            dot_product / (norm_a * norm_b)
        }
    }
}
