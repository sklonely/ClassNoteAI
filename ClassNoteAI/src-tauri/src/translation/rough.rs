/**
 * 粗翻譯模塊（本地）
 * 使用 CTranslate2 模型進行本地翻譯
 */
use super::{TranslationError, TranslationResult, TranslationSource};

/// 粗翻譯（本地）
///
/// 使用 CTranslate2 模型進行翻譯
/// 如果模型未加載，返回錯誤
pub async fn translate_rough(
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<TranslationResult, TranslationError> {
    // 空文本處理
    if text.trim().is_empty() {
        return Ok(TranslationResult {
            translated_text: String::new(),
            source: TranslationSource::Rough,
            confidence: Some(1.0),
        });
    }

    // 使用 CTranslate2 翻譯
    use super::ctranslate2;

    if !ctranslate2::is_loaded().await {
        return Err(TranslationError::LocalError(
            "翻譯模型未加載，請先在設置頁面加載模型".to_string(),
        ));
    }

    // 執行 CT2 模型翻譯
    match ctranslate2::translate_text(text, source_lang, target_lang).await {
        Ok(translated) => Ok(TranslationResult {
            translated_text: translated,
            source: TranslationSource::Rough,
            confidence: Some(0.9),
        }),
        Err(e) => Err(TranslationError::LocalError(format!("CT2 翻譯失敗: {}", e))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_translate_rough_empty_text() {
        let result = translate_rough("", "en", "zh").await;
        assert!(result.is_ok());
        let translation = result.unwrap();
        assert_eq!(translation.translated_text, "");
    }

    #[tokio::test]
    async fn test_translate_rough_model_not_loaded() {
        // 測試模型未加載時返回錯誤
        let result = translate_rough("Hello world", "en", "zh").await;
        // 應該返回錯誤，因為模型未加載
        assert!(result.is_err());
    }
}
