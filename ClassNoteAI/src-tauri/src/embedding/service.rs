use anyhow::{anyhow, Result};
use ndarray::{Array, Array1};
use ort::session::{Session, builder::GraphOptimizationLevel};
use ort::value::Value;
use std::path::Path;
use tokenizers::Tokenizer;

pub struct EmbeddingService {
    session: Session,
    tokenizer: Tokenizer,
}

impl EmbeddingService {
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

        // Load ONNX Model
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path)?;

        Ok(Self { session, tokenizer })
    }

    pub fn generate_embedding(&mut self, text: &str) -> Result<Vec<f32>> {
        // Tokenize
        let encoding = self.tokenizer.encode(text, true)
            .map_err(|e| anyhow!("Tokenization failed: {}", e))?;

        let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
        let attention_mask: Vec<i64> = encoding.get_attention_mask().iter().map(|&x| x as i64).collect();
        let token_type_ids: Vec<i64> = encoding.get_type_ids().iter().map(|&x| x as i64).collect();

        let batch_size = 1;
        let sequence_length = input_ids.len();

        let input_ids_array = Array::from_shape_vec((batch_size, sequence_length), input_ids)?;
        let attention_mask_array = Array::from_shape_vec((batch_size, sequence_length), attention_mask)?;
        let token_type_ids_array = Array::from_shape_vec((batch_size, sequence_length), token_type_ids)?;

        // Convert inputs to Values
        let input_ids_value = Value::from_array(input_ids_array)?;
        let attention_mask_value = Value::from_array(attention_mask_array.clone())?;
        let token_type_ids_value = Value::from_array(token_type_ids_array)?;

        // Run Inference
        let outputs = self.session.run(ort::inputs![
            "input_ids" => input_ids_value,
            "attention_mask" => attention_mask_value,
            "token_type_ids" => token_type_ids_value,
        ])?;

        // Extract Embeddings (last_hidden_state)
        // try_extract_tensor returns (shape, data)
        let (shape, data) = outputs["last_hidden_state"].try_extract_tensor::<f32>()?;
        
        // Shape is usually [batch_size, sequence_length, hidden_size]
        // We assume batch_size = 1
        let hidden_size = shape[2] as usize;
        let seq_len = shape[1] as usize;

        // Create Array from data for easier manipulation
        // We copy data to a new Array because we need to perform operations
        // data is a slice &[f32]
        let embeddings = Array::from_shape_vec((1, seq_len, hidden_size), data.to_vec())?;
        let embeddings = embeddings.slice(ndarray::s![0, .., ..]); // [seq, hidden]

        let mut pooled: Array1<f32> = Array::zeros((hidden_size,));
        let mut mask_sum = 0.0;

        for i in 0..seq_len {
             if attention_mask_array[[0, i]] == 1 {
                 let token_emb = embeddings.slice(ndarray::s![i, ..]);
                 pooled = pooled + &token_emb;
                 mask_sum += 1.0;
             }
        }

        if mask_sum > 0.0 {
            pooled = pooled / mask_sum;
        }

        // Normalize
        let norm = pooled.dot(&pooled).sqrt();
        let normalized = if norm > 0.0 { pooled / norm } else { pooled };

        Ok(normalized.to_vec())
    }

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
