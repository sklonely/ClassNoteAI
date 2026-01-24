use anyhow::Result;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use std::path::Path;
use tokenizers::Tokenizer;

use super::audio::process_audio;

pub struct ParakeetModel {
    session: Session,
    tokenizer: Tokenizer,
}

impl ParakeetModel {
    pub fn new<P: AsRef<Path>>(model_path: P, tokenizer_path: P) -> Result<Self> {
        // Load Tokenizer
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| anyhow::anyhow!("Failed to load tokenizer: {}", e))?;

        // Load ONNX Model with CoreML support for Apple Silicon
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path)?;

        Ok(Self { session, tokenizer })
    }

    pub fn transcribe(&mut self, audio_data: &[i16]) -> Result<String> {
        // 1. Preprocess audio
        let audio_f32 = process_audio(audio_data)?;
        
        // 2. Prepare inputs
        // Parakeet expects [batch_size, audio_length]
        let audio_len = audio_f32.len();
        
        // Create tensors using ort 2.0 API
        let input_tensor = Tensor::from_array(([1, audio_len], audio_f32))?;
        let length_tensor = Tensor::from_array(([1], vec![audio_len as i64]))?;

        // 3. Run Inference
        // Input names depend on the specific ONNX export
        // For NeMo Parakeet models: "audio_signal" and "length"
        let outputs = self.session.run(ort::inputs![
            "audio_signal" => input_tensor,
            "length" => length_tensor
        ])?;

        // 4. Decode Outputs
        // This part heavily depends on TDT vs CTC model architecture.
        // For debugging, print output names and types
        for (name, value) in outputs.iter() {
            println!("Output: {}, Type: {:?}", name, value.dtype());
        }

        // TODO: Implement actual decoding logic (Greedy/Beam search)
        // For CTC: argmax on logits, then collapse repeated tokens
        // For TDT: greedy decoding with blank token handling
        
        Ok("Transcription not implemented yet".to_string())
    }
}
