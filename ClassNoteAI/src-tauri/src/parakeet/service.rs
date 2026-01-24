use crate::parakeet::model::ParakeetModel;
use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct ParakeetService {
    model: Arc<Mutex<Option<ParakeetModel>>>,
}

impl ParakeetService {
    pub fn new() -> Self {
        Self {
            model: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn load_model(&self, model_path: &str, tokenizer_path: &str) -> Result<()> {
        let mut model_guard = self.model.lock().await;
        
        // Check if file exists
        if !std::path::Path::new(model_path).exists() {
            return Err(anyhow::anyhow!("Model file not found: {}", model_path));
        }
        if !std::path::Path::new(tokenizer_path).exists() {
            return Err(anyhow::anyhow!("Tokenizer file not found: {}", tokenizer_path));
        }

        let model = ParakeetModel::new(model_path, tokenizer_path)
            .map_err(|e| anyhow::anyhow!("Failed to load Parakeet model: {}", e))?;
        
        *model_guard = Some(model);
        println!("Parakeet model loaded successfully");
        Ok(())
    }

    pub async fn transcribe(&self, audio_data: &[i16]) -> Result<String> {
        let mut model_guard = self.model.lock().await;
        
        if let Some(model) = model_guard.as_mut() {
            model.transcribe(audio_data)
        } else {
            Err(anyhow::anyhow!("Parakeet model not loaded"))
        }
    }
}
