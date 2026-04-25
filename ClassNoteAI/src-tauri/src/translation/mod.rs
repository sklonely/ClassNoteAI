/// 翻譯模塊
///
/// - `ctranslate2` / `rough`: CTranslate2 本地翻譯（M2M100），需要 `nmt-local`
///   feature。沒啟用時不編，避免拉 ct2rs + sentencepiece-sys 的 CMake/C++
///   build pipeline。
/// - `gemma`: TranslateGemma 4B LLM 翻譯（HTTP 到 llama-server sidecar）。
///   永遠可用，零 native dep。
/// - `google`: Google Translate API（官方 / 非官方）。永遠可用。
///
/// Fine translation 將在 v0.5.0+ 透過 LLMProvider（GitHub Models / OpenAI /
/// Anthropic）實作。
#[cfg(feature = "nmt-local")]
pub mod ctranslate2;
pub mod gemma;
pub mod gemma_model;
pub mod gemma_sidecar;
pub mod google;
#[cfg(feature = "nmt-local")]
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
