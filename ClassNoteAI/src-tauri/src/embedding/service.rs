// Candle-based Embedding Service
// Uses Candle ML framework instead of ONNX to avoid protobuf conflict with ct2rs

use anyhow::{anyhow, Result};
use std::path::Path;
use tokenizers::Tokenizer;
use serde::Deserialize;

#[cfg(feature = "candle-embed")]
use candle_core::{DType, Device, Tensor};
#[cfg(feature = "candle-embed")]
use candle_nn::VarBuilder;
#[cfg(feature = "candle-embed")]
use candle_transformers::models::bert::{BertModel, Config};

/// Nomic 模型配置格式 (使用 n_embd 等字段)
#[derive(Debug, Deserialize)]
struct NomicConfig {
    n_embd: Option<usize>,
    n_layer: Option<usize>,
    n_head: Option<usize>,
    n_inner: Option<usize>,
    n_positions: Option<usize>,
    vocab_size: Option<usize>,
    layer_norm_epsilon: Option<f64>,
    // 標準 BERT 字段 (作為後備)
    hidden_size: Option<usize>,
    num_hidden_layers: Option<usize>,
    num_attention_heads: Option<usize>,
    intermediate_size: Option<usize>,
    max_position_embeddings: Option<usize>,
}

impl NomicConfig {
    /// 轉換為標準 BERT Config JSON
    fn to_bert_config_json(&self) -> String {
        let hidden_size = self.hidden_size.or(self.n_embd).unwrap_or(768);
        let num_hidden_layers = self.num_hidden_layers.or(self.n_layer).unwrap_or(12);
        let num_attention_heads = self.num_attention_heads.or(self.n_head).unwrap_or(12);
        let intermediate_size = self.intermediate_size.or(self.n_inner).unwrap_or(3072);
        let max_position_embeddings = self.max_position_embeddings.or(self.n_positions).unwrap_or(512);
        let vocab_size = self.vocab_size.unwrap_or(30522);
        let layer_norm_eps = self.layer_norm_epsilon.unwrap_or(1e-12);

        format!(r#"{{
            "hidden_size": {},
            "num_hidden_layers": {},
            "num_attention_heads": {},
            "intermediate_size": {},
            "hidden_act": "gelu",
            "hidden_dropout_prob": 0.0,
            "attention_probs_dropout_prob": 0.0,
            "max_position_embeddings": {},
            "type_vocab_size": 2,
            "initializer_range": 0.02,
            "layer_norm_eps": {},
            "vocab_size": {},
            "pad_token_id": 0,
            "model_type": "bert"
        }}"#, hidden_size, num_hidden_layers, num_attention_heads, 
            intermediate_size, max_position_embeddings, layer_norm_eps, vocab_size)
    }
}

/// Pick the best-available Candle device for BGE embedding. Tries GPU
/// backends before CPU; any init failure falls back silently. Matches
/// the ct2rs pattern in `translation::ctranslate2::load_model`.
///
/// Important: this is called once, at service construction. The
/// returned device is kept on the service and used for every tensor
/// thereafter (model weights + each batch's input_ids). Falling back
/// to CPU mid-run would require reloading the model, so we only try
/// the GPU path at startup — if it works there, it works for the
/// life of the process.
#[cfg(feature = "candle-embed")]
fn select_embedding_device() -> Device {
    #[cfg(feature = "gpu-cuda")]
    {
        match Device::new_cuda(0) {
            Ok(d) => {
                eprintln!("[Embedding] Using CUDA device 0");
                return d;
            }
            Err(e) => {
                eprintln!("[Embedding] CUDA init failed ({}), falling back", e);
            }
        }
    }
    #[cfg(all(target_os = "macos", feature = "gpu-metal"))]
    {
        match Device::new_metal(0) {
            Ok(d) => {
                eprintln!("[Embedding] Using Metal device 0");
                return d;
            }
            Err(e) => {
                eprintln!("[Embedding] Metal init failed ({}), falling back", e);
            }
        }
    }
    Device::Cpu
}

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

        // Pick the strongest device the host will actually let us use.
        // Priority: CUDA (gpu-cuda build) → Metal (macOS gpu-metal) →
        // CPU. An init failure — driver mismatch, missing cudart,
        // Metal system library missing — silently drops to CPU. BGE
        // is correctness-critical (the RAG index and the query-time
        // encoding must agree on the same model output), so a steady
        // CPU run beats a half-working GPU run. Log to stderr for
        // post-hoc debugging; nothing reaches the UI.
        let device = select_embedding_device();

        // Load config (支持 nomic 和標準 BERT 格式)
        let config_path = model_path
            .parent()
            .ok_or_else(|| anyhow!("Invalid model path"))?
            .join("config.json");

        let config_str = std::fs::read_to_string(&config_path)
            .map_err(|e| anyhow!("Failed to read config: {}", e))?;

        // 先嘗試解析為通用格式，然後轉換
        let nomic_config: NomicConfig = serde_json::from_str(&config_str)
            .map_err(|e| anyhow!("Failed to parse config: {}", e))?;

        // 轉換為標準 BERT 格式
        let bert_config_json = nomic_config.to_bert_config_json();
        let config: Config = serde_json::from_str(&bert_config_json)
            .map_err(|e| anyhow!("Failed to parse converted config: {}", e))?;

        // Sanity-check the safetensors file. BAAI/bge-small-en-v1.5 is
        // ~33 MB; a truncated download (e.g. user quit mid-download)
        // typically weighs <2 MB and would later surface a confusing
        // "cannot find tensor …" error from Candle's BertModel::load.
        // Catching it here gives a direct, actionable message instead.
        const MIN_PLAUSIBLE_SIZE: u64 = 20 * 1024 * 1024; // 20 MB
        let metadata = std::fs::metadata(model_path)
            .map_err(|e| anyhow!("Failed to stat model file: {}", e))?;
        if metadata.len() < MIN_PLAUSIBLE_SIZE {
            return Err(anyhow!(
                "Embedding 模型檔案疑似損壞或下載未完成（僅 {} MB，預期 ~33 MB）。\
                 請到「設定 → AI 模型 → Embedding」重新下載 bge-small-en-v1.5。",
                metadata.len() / 1024 / 1024
            ));
        }

        // Load model weights. bge-small-en-v1.5 is a standard BERT export
        // where tensor names match Candle's `BertModel::load` expectations
        // (e.g. `embeddings.word_embeddings.weight`,
        // `embeddings.position_embeddings.weight`, etc.) with no prefix.
        // v0.5.1 had a retry-with-`bert.`-prefix fallback to paper over
        // nomic-embed-text-v1's incompatibility; since we've now replaced
        // nomic outright, that fallback is removed. If future devs swap
        // in another model, prefer a model that BertModel::load accepts
        // cleanly rather than reviving the fallback — see the test
        // `load_bge_small_en_v15_succeeds` for the contract we want.
        let vb =
            unsafe { VarBuilder::from_mmaped_safetensors(&[model_path], DType::F32, &device)? };

        let model = BertModel::load(vb, &config).map_err(|err| {
            anyhow!(
                "Embedding 模型加載失敗（標準 BERT 架構不相容 — 檢查檔案或重新下載）：{}",
                err
            )
        })?;

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

    /// Batched embedding — ~3-5x faster than calling `generate_embedding`
    /// N times for the same N texts, because BertModel::forward runs a
    /// single matmul over the padded batch instead of N sequential
    /// matmuls. On CPU with a 384-d BGE model and ~500-char chunks,
    /// batching 32 chunks drops a ~10s serial loop to ~2s.
    ///
    /// The caller stacks all texts to a uniform seq_len by zero-padding;
    /// the attention mask carries the real length so mean pooling
    /// doesn't count padding rows. We clamp seq_len to the model's
    /// max_position_embeddings (512 for bge-small-en-v1.5); any chunk
    /// that tokenizes longer gets truncated upfront -- same guarantee
    /// as the single-text path which also silently passes long text to
    /// the tokenizer's default truncation.
    #[cfg(feature = "candle-embed")]
    pub fn generate_embeddings_batch(&mut self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        // Encode all texts in one shot. `encode_batch` parallelizes
        // tokenization internally using rayon.
        let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        let encodings = self
            .tokenizer
            .encode_batch(refs, true)
            .map_err(|e| anyhow!("Batch tokenization failed: {}", e))?;

        let batch_size = encodings.len();
        let mut max_len = encodings.iter().map(|e| e.get_ids().len()).max().unwrap_or(0);
        // Clamp to model's max position embeddings. BGE-small-en-v1.5 is
        // 512. Anything longer gets truncated below per-row.
        const HARD_CAP: usize = 512;
        if max_len > HARD_CAP {
            max_len = HARD_CAP;
        }
        if max_len == 0 {
            return Ok((0..batch_size).map(|_| Vec::new()).collect());
        }

        // Pad each row to max_len. Build flat (batch_size * max_len) buffers.
        let mut input_ids_flat = Vec::<u32>::with_capacity(batch_size * max_len);
        let mut attn_flat = Vec::<u32>::with_capacity(batch_size * max_len);
        let mut type_flat = Vec::<u32>::with_capacity(batch_size * max_len);
        // Track per-row true lengths so masking sum works after pooling.
        let mut row_true_lens = Vec::<f32>::with_capacity(batch_size);
        for enc in &encodings {
            let ids = enc.get_ids();
            let mask = enc.get_attention_mask();
            let types = enc.get_type_ids();
            let true_len = ids.len().min(max_len);
            row_true_lens.push(true_len as f32);
            for i in 0..max_len {
                if i < true_len {
                    input_ids_flat.push(ids[i]);
                    attn_flat.push(mask[i]);
                    type_flat.push(types[i]);
                } else {
                    input_ids_flat.push(0);
                    attn_flat.push(0);
                    type_flat.push(0);
                }
            }
        }

        let input_ids = Tensor::from_vec(input_ids_flat, (batch_size, max_len), &self.device)?;
        let attn = Tensor::from_vec(attn_flat, (batch_size, max_len), &self.device)?;
        let types = Tensor::from_vec(type_flat, (batch_size, max_len), &self.device)?;

        // Forward pass -- one matmul for the whole batch.
        let hidden = self.model.forward(&input_ids, &types, Some(&attn))?;
        let (_, _, hidden_size) = hidden.dims3()?;

        // Mean pooling per row, masked by attention.
        let mask_f = attn.to_dtype(DType::F32)?;
        let mask_expanded = mask_f
            .unsqueeze(2)?
            .broadcast_as((batch_size, max_len, hidden_size))?;
        let masked = hidden.mul(&mask_expanded)?; // (B, L, H)
        let summed = masked.sum(1)?; // (B, H)
        let summed_vec: Vec<Vec<f32>> = summed.to_vec2::<f32>()?;

        let mut out = Vec::with_capacity(batch_size);
        for (row, true_len) in summed_vec.iter().zip(row_true_lens.iter()) {
            let denom = true_len.max(1.0);
            let pooled: Vec<f32> = row.iter().map(|v| v / denom).collect();
            let norm = pooled.iter().map(|v| v * v).sum::<f32>().sqrt();
            if norm > 0.0 {
                out.push(pooled.iter().map(|v| v / norm).collect());
            } else {
                out.push(pooled);
            }
        }
        Ok(out)
    }

    /// Stub when candle-embed feature is disabled
    #[cfg(not(feature = "candle-embed"))]
    pub fn generate_embeddings_batch(&mut self, _texts: &[String]) -> Result<Vec<Vec<f32>>> {
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
