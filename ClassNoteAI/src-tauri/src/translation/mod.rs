pub mod ctranslate2;
pub mod google;
/**
 * 翻譯模塊
 *
 * rough: CTranslate2 本地翻譯（Opus-MT）
 * Fine translation 將在 v0.5.0+ 透過 LLMProvider（GitHub Models / OpenAI / Anthropic）實作
 */
pub mod rough;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationResult {
    pub translated_text: String,
    pub source: TranslationSource,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TranslationSource {
    Rough, // 本地翻譯
    Fine,  // 遠程翻譯
}

#[derive(Debug, Clone)]
pub enum TranslationError {
    LocalError(String),
    RemoteError(String),
    InvalidLanguage,
}

impl std::fmt::Display for TranslationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TranslationError::LocalError(msg) => write!(f, "本地翻譯錯誤: {}", msg),
            TranslationError::RemoteError(msg) => write!(f, "遠程翻譯錯誤: {}", msg),
            TranslationError::InvalidLanguage => write!(f, "無效的語言代碼"),
        }
    }
}

impl std::error::Error for TranslationError {}
