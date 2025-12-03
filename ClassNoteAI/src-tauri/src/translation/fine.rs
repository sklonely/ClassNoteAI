/**
 * 精翻譯模塊（遠程）
 * 通過 HTTP API 調用遠程翻譯服務
 */

use super::{TranslationError, TranslationResult, TranslationSource};
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct TranslationRequest {
    text: String,
    source_lang: String,
    target_lang: String,
}

#[derive(Debug, Deserialize)]
struct TranslationResponse {
    translated_text: String,
    confidence: Option<f32>,
}

/// 精翻譯（遠程）
pub async fn translate_fine(
    text: &str,
    source_lang: &str,
    target_lang: &str,
    service_url: &str,
) -> Result<TranslationResult, TranslationError> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| TranslationError::RemoteError(format!("創建 HTTP 客戶端失敗: {}", e)))?;

    let url = format!("{}/api/translate", service_url.trim_end_matches('/'));
    
    let request = TranslationRequest {
        text: text.to_string(),
        source_lang: source_lang.to_string(),
        target_lang: target_lang.to_string(),
    };

    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await
        .map_err(|e| TranslationError::RemoteError(format!("請求失敗: {}", e)))?;

    if !response.status().is_success() {
        return Err(TranslationError::RemoteError(format!(
            "服務器返回錯誤: {}",
            response.status()
        )));
    }

    let translation: TranslationResponse = response
        .json()
        .await
        .map_err(|e| TranslationError::RemoteError(format!("解析響應失敗: {}", e)))?;

    Ok(TranslationResult {
        translated_text: translation.translated_text,
        source: TranslationSource::Fine,
        confidence: translation.confidence,
    })
}

/// 檢查遠程服務是否可用
/// 
/// 注意：當前版本中，遠程服務功能尚未實現
/// 此函數保留接口定義，供未來實現使用
pub async fn check_remote_service(_service_url: &str) -> bool {
    // TODO: 實現遠程服務健康檢查
    // API 規範：GET /health
    // 詳細文檔：docs/REMOTE_SERVICE_API.md
    
    // 當前版本：始終返回 false（服務未實現）
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_remote_service() {
        // 測試不可用的服務
        let available = check_remote_service("http://localhost:9999").await;
        assert!(!available);
    }
}

