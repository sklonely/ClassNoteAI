/**
 * Whisper 模型管理
 */

use anyhow::Result;
use whisper_rs::{WhisperContext, WhisperContextParameters};

/// Whisper 模型封裝
pub struct WhisperModel {
    context: WhisperContext,
    #[allow(dead_code)]
    model_path: String,
}

impl WhisperModel {
    /// 加載 Whisper 模型
    pub async fn load(model_path: &str) -> Result<Self> {
        println!("[Whisper] 開始加載模型: {}", model_path);

        // 檢查文件是否存在
        if !std::path::Path::new(model_path).exists() {
            return Err(anyhow::anyhow!("模型文件不存在: {}", model_path));
        }

        // 創建上下文參數
        let ctx_params = WhisperContextParameters::default();

        // 加載模型
        let context = WhisperContext::new_with_params(model_path, ctx_params)
            .map_err(|e| anyhow::anyhow!("模型加載失敗: {:?}", e))?;

        println!("[Whisper] 模型加載成功: {}", model_path);

        Ok(Self {
            context,
            model_path: model_path.to_string(),
        })
    }

    /// 獲取 Whisper 上下文
    pub fn get_context(&self) -> &WhisperContext {
        &self.context
    }

    /// 獲取模型路徑
    #[allow(dead_code)]
    pub fn get_model_path(&self) -> &str {
        &self.model_path
    }
}


