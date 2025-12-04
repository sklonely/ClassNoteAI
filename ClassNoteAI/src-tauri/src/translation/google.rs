/**
 * Google 翻譯模塊
 * 支持兩種方式：
 * 1. 官方 Google Cloud Translation API（需要 API 密鑰）
 * 2. 非官方網頁接口（無需 API 密鑰，但可能違反服務條款）
 */

use super::{TranslationError, TranslationResult, TranslationSource};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Serialize, Deserialize)]
struct GoogleTranslateRequest {
    q: Vec<String>,
    source: String,
    target: String,
    format: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleTranslateResponse {
    data: GoogleTranslateData,
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleTranslateData {
    translations: Vec<GoogleTranslation>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GoogleTranslation {
    translated_text: String,
    detected_source_language: Option<String>,
}

/// Google 翻譯（使用官方 Google Cloud Translation API）
/// 
/// API 文檔：https://cloud.google.com/translate/docs/reference/rest/v2/translate
pub async fn translate_with_google_api(
    text: &str,
    source_lang: &str,
    target_lang: &str,
    api_key: &str,
) -> Result<TranslationResult, TranslationError> {
    // 驗證語言代碼
    if text.trim().is_empty() {
        return Ok(TranslationResult {
            translated_text: String::new(),
            source: TranslationSource::Rough,
            confidence: Some(1.0),
        });
    }

    // 轉換語言代碼：en -> en, zh -> zh-CN 或 zh-TW
    let google_source_lang = match source_lang {
        "en" => "en",
        "zh" => "zh-CN",
        _ => source_lang,
    };
    
    let google_target_lang = match target_lang {
        "en" => "en",
        "zh" => "zh-CN",
        _ => target_lang,
    };

    // 構建請求 URL
    let url = format!(
        "https://translation.googleapis.com/language/translate/v2?key={}",
        api_key
    );

    // 構建請求體
    let request_body = json!({
        "q": [text],
        "source": google_source_lang,
        "target": google_target_lang,
        "format": "text"
    });

    // 發送 HTTP 請求
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| TranslationError::RemoteError(format!("請求失敗: {}", e)))?;

    // 檢查 HTTP 狀態碼
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(TranslationError::RemoteError(format!(
            "Google API 錯誤 ({}): {}",
            status, error_text
        )));
    }

    // 解析響應
    let response_json: GoogleTranslateResponse = response
        .json()
        .await
        .map_err(|e| TranslationError::RemoteError(format!("解析響應失敗: {}", e)))?;

    // 提取翻譯結果
    if let Some(translation) = response_json.data.translations.first() {
        Ok(TranslationResult {
            translated_text: translation.translated_text.clone(),
            source: TranslationSource::Rough,
            confidence: Some(0.95), // Google 翻譯置信度較高
        })
    } else {
        Err(TranslationError::RemoteError(
            "Google API 返回空翻譯結果".to_string(),
        ))
    }
}

/// Google 翻譯（使用非官方網頁接口，無需 API 密鑰）
/// 
/// ⚠️ 警告：此方法可能違反 Google 的服務條款，僅供學習和測試使用
/// 建議在生產環境中使用官方 API
pub async fn translate_with_google_unofficial(
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<TranslationResult, TranslationError> {
    if text.trim().is_empty() {
        return Ok(TranslationResult {
            translated_text: String::new(),
            source: TranslationSource::Rough,
            confidence: Some(1.0),
        });
    }

    println!("[GoogleTranslate] 開始翻譯（非官方接口）:");
    println!("  原文: {}", text);
    println!("  源語言: {} -> 目標語言: {}", source_lang, target_lang);

    // 轉換語言代碼
    let google_source_lang = match source_lang {
        "en" => "en",
        "zh" => "zh-CN",
        _ => source_lang,
    };
    
    let google_target_lang = match target_lang {
        "en" => "en",
        "zh" => "zh-CN",
        _ => target_lang,
    };

    println!("  Google 語言代碼: {} -> {}", google_source_lang, google_target_lang);

    // 構建請求 URL（使用 Google Translate 網頁接口）
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
        google_source_lang,
        google_target_lang,
        urlencoding::encode(text)
    );
    
    println!("  請求 URL: {}", url);

    // 發送 HTTP 請求，模擬瀏覽器
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| TranslationError::RemoteError(format!("創建 HTTP 客戶端失敗: {}", e)))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| TranslationError::RemoteError(format!("請求失敗: {}", e)))?;

    if !response.status().is_success() {
        return Err(TranslationError::RemoteError(format!(
            "HTTP 錯誤: {}",
            response.status()
        )));
    }

    // 解析響應（Google 返回的是 JSON 數組格式）
    let response_text = response
        .text()
        .await
        .map_err(|e| TranslationError::RemoteError(format!("讀取響應失敗: {}", e)))?;

    // 記錄響應文本的前 500 個字符用於調試
    let response_preview = if response_text.len() > 500 {
        format!("{}...", &response_text[..500])
    } else {
        response_text.clone()
    };
    println!("[GoogleTranslate] 響應預覽: {}", response_preview);

    // Google Translate 返回的格式類似：[[["翻譯結果",...],...],...]
    // 我們需要提取第一個翻譯結果
    let json_value: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| {
            let error_msg = format!("解析 JSON 失敗: {}。響應前 200 字符: {}", e, &response_text[..response_text.len().min(200)]);
            println!("[GoogleTranslate] {}", error_msg);
            TranslationError::RemoteError(error_msg)
        })?;

    // 提取翻譯文本
    let translated_text = if let Some(array) = json_value.as_array() {
        if let Some(first_array) = array.get(0).and_then(|v| v.as_array()) {
            // 遍歷所有翻譯數組，找到第一個有效的翻譯文本
            let mut found_text: Option<String> = None;
            for translation_array in first_array.iter() {
                if let Some(translation_array) = translation_array.as_array() {
                    if let Some(text) = translation_array.get(0).and_then(|v| v.as_str()) {
                        if !text.is_empty() {
                            found_text = Some(text.to_string());
                            break;
                        }
                    }
                }
            }
            
            if let Some(text) = found_text {
                println!("[GoogleTranslate] 提取到翻譯文本: {}", text);
                text
            } else {
                let error_msg = format!("無法從響應中提取翻譯文本。響應結構: {:?}", json_value);
                println!("[GoogleTranslate] {}", error_msg);
                return Err(TranslationError::RemoteError(error_msg));
            }
        } else {
            let error_msg = format!("響應格式不正確（缺少第一層數組）。響應: {:?}", json_value);
            println!("[GoogleTranslate] {}", error_msg);
            return Err(TranslationError::RemoteError(error_msg));
        }
    } else {
        let error_msg = format!("響應不是有效的 JSON 數組。響應: {:?}", json_value);
        println!("[GoogleTranslate] {}", error_msg);
        return Err(TranslationError::RemoteError(error_msg));
    };

    Ok(TranslationResult {
        translated_text,
        source: TranslationSource::Rough,
        confidence: Some(0.9), // 非官方接口，置信度稍低
    })
}

/// Google 翻譯（統一接口，自動選擇使用 API 或非官方接口）
pub async fn translate_with_google(
    text: &str,
    source_lang: &str,
    target_lang: &str,
    api_key: Option<&str>,
) -> Result<TranslationResult, TranslationError> {
    if let Some(key) = api_key {
        if !key.is_empty() {
            // 使用官方 API
            return translate_with_google_api(text, source_lang, target_lang, key).await;
        }
    }
    
    // 如果沒有 API 密鑰或密鑰為空，使用非官方接口
    translate_with_google_unofficial(text, source_lang, target_lang).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // 需要 API 密鑰，默認跳過
    async fn test_google_translate() {
        // 需要設置 GOOGLE_API_KEY 環境變量
        let api_key = std::env::var("GOOGLE_API_KEY").unwrap_or_default();
        if api_key.is_empty() {
            println!("跳過測試：未設置 GOOGLE_API_KEY");
            return;
        }

        let result = translate_with_google("Hello world", "en", "zh", &api_key).await;
        assert!(result.is_ok());
        let translation = result.unwrap();
        assert!(!translation.translated_text.is_empty());
        println!("翻譯結果: {}", translation.translated_text);
    }
}

