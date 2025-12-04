/**
 * Whisper ASR 服務模塊
 * 提供語音轉文字功能
 */

pub mod model;
pub mod transcribe;
pub mod download;
#[cfg(test)]
pub mod test_utils;

use anyhow::Result;
pub use model::WhisperModel;
pub use transcribe::TranscriptionResult;

/// Whisper 服務
pub struct WhisperService {
    model: Option<WhisperModel>,
}

impl WhisperService {
    /// 創建新的 Whisper 服務實例
    pub fn new() -> Self {
        Self { 
            model: None,
        }
    }

    /// 加載 Whisper 模型
    pub async fn load_model(&mut self, model_path: &str) -> Result<()> {
        let model = WhisperModel::load(model_path).await?;
        self.model = Some(model);
        Ok(())
    }

    /// 轉錄音頻數據
    pub async fn transcribe(
        &self,
        audio_data: &[i16],
        sample_rate: u32,
        initial_prompt: Option<&str>,
        options: Option<transcribe::TranscriptionOptions>,
    ) -> Result<transcribe::TranscriptionResult> {
        let model = self
            .model
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("模型未加載"))?;

        transcribe::transcribe_audio(model, audio_data, sample_rate, initial_prompt, options).await
    }

    /// 檢查模型是否已加載
    pub fn is_model_loaded(&self) -> bool {
        self.model.is_some()
    }
}

impl Default for WhisperService {
    fn default() -> Self {
        Self::new()
    }
}

