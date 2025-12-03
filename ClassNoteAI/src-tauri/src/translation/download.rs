/**
 * 翻譯模型下載模塊
 * 處理 ONNX 翻譯模型的下載和管理
 */

use std::path::{Path, PathBuf};
use reqwest::Client;
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;

/// 翻譯模型配置
pub struct TranslationModelConfig {
    pub url: String,
    pub model_name: String,
    pub expected_size: Option<u64>,
}

/// 翻譯模型類型
/// 
/// 注意：只保留快速響應的小模型，大模型已排除
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranslationModelType {
    OpusMtEnZh,
    // 大模型已排除，以確保快速響應
    // Nllb200Distilled600M,  // ~4.3GB，太大
    // MBartLarge50,          // ~4.2GB，太大
}

impl TranslationModelType {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "opus-mt-en-zh-onnx" => Some(Self::OpusMtEnZh),
            // 大模型已排除
            // "nllb-200-distilled-600M-onnx" => Some(Self::Nllb200Distilled600M),
            // "mbart-large-50-onnx" => Some(Self::MBartLarge50),
            _ => None,
        }
    }

    pub fn to_name(&self) -> &'static str {
        match self {
            Self::OpusMtEnZh => "opus-mt-en-zh-onnx",
            // 大模型已排除
            // Self::Nllb200Distilled600M => "nllb-200-distilled-600M-onnx",
            // Self::MBartLarge50 => "mbart-large-50-onnx",
        }
    }
}

/// 獲取翻譯模型配置
/// 
/// 支持多個模型的下載配置
/// 注意：這些 URL 需要指向實際的 ONNX 模型文件
/// 建議使用 GitHub Releases 或其他雲存儲服務託管模型
pub fn get_translation_model_config(model_type: TranslationModelType) -> TranslationModelConfig {
    match model_type {
        TranslationModelType::OpusMtEnZh => TranslationModelConfig {
            // GitHub Releases 格式（需要替換為實際的倉庫和版本）
            // 格式：https://github.com/USERNAME/REPO/releases/download/VERSION/model-name.zip
            url: "https://github.com/sklonely/ClassNoteAI/releases/download/v1.0/opus-mt-en-zh-onnx.zip".to_string(),
            model_name: "opus-mt-en-zh-onnx".to_string(),
            expected_size: Some(550_000_000), // 約 550MB（實際約 512MB，留一些餘量）
        },
        // 大模型已排除，以確保快速響應
        // TranslationModelType::Nllb200Distilled600M => TranslationModelConfig {
        //     url: "https://github.com/sklonely/ClassNoteAI/releases/download/v1.0/nllb-200-distilled-600M-onnx.zip".to_string(),
        //     model_name: "nllb-200-distilled-600M-onnx".to_string(),
        //     expected_size: Some(600_000_000),
        // },
        // TranslationModelType::MBartLarge50 => TranslationModelConfig {
        //     url: "https://github.com/sklonely/ClassNoteAI/releases/download/v1.0/mbart-large-50-onnx.zip".to_string(),
        //     model_name: "mbart-large-50-onnx".to_string(),
        //     expected_size: Some(1_200_000_000),
        // },
    }
}

/// 獲取英文到中文翻譯模型配置（向後兼容）
pub fn get_en_zh_model_config(_output_dir: &Path) -> TranslationModelConfig {
    get_translation_model_config(TranslationModelType::OpusMtEnZh)
}

/// 下載翻譯模型
/// 
/// 下載模型文件（可能是 ZIP 或目錄結構）
/// 如果是 ZIP 文件，需要解壓到 output_dir/model_name/ 目錄
pub async fn download_translation_model(
    config: &TranslationModelConfig,
    output_dir: &Path,
    progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>>,
) -> Result<PathBuf, String> {
    use std::fs;
    
    // 確保輸出目錄存在
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("創建目錄失敗: {}", e))?;

    // 構建下載文件路徑（可能是 ZIP）
    let is_zip = config.url.ends_with(".zip");
    let file_extension = if is_zip { "zip" } else { "onnx" };
    let downloaded_file = output_dir.join(format!("{}.{}", config.model_name, file_extension));
    let model_dir = output_dir.join(&config.model_name);

    // 檢查模型目錄是否已存在且完整
    if model_dir.exists() {
        let encoder_path = model_dir.join("encoder_model.onnx");
        let decoder_path = model_dir.join("decoder_model.onnx");
        if encoder_path.exists() && decoder_path.exists() {
            println!("[下載翻譯模型] 模型已存在: {:?}", model_dir);
            return Ok(model_dir);
        }
    }

    // 檢查下載文件是否已存在
    if downloaded_file.exists() {
        if let Some(expected_size) = config.expected_size {
            if let Ok(metadata) = fs::metadata(&downloaded_file) {
                let file_size = metadata.len();
                // 允許 10% 的誤差（ZIP 文件大小可能因壓縮率而異）
                let tolerance = (expected_size as f64 * 0.10) as u64;
                if file_size >= expected_size.saturating_sub(tolerance) {
                    println!("[下載翻譯模型] 下載文件已存在: {:?}", downloaded_file);
                    // 如果是 ZIP，需要解壓
                    if is_zip {
                        return extract_model_zip(&downloaded_file, &model_dir);
                    }
                    return Ok(downloaded_file);
                }
            }
        }
    }

    println!("[下載翻譯模型] 開始下載: {} 從 {}", config.model_name, config.url);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 分鐘超時（大文件）
        .build()
        .map_err(|e| format!("創建 HTTP 客戶端失敗: {}", e))?;

    let response = client
        .get(&config.url)
        .send()
        .await
        .map_err(|e| format!("下載請求失敗: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下載失敗: HTTP {} - 請檢查 URL 是否正確: {}", response.status(), config.url));
    }

    let total_size = response
        .content_length()
        .ok_or_else(|| "無法獲取文件大小".to_string())?;

    let mut file = tokio::fs::File::create(&downloaded_file)
        .await
        .map_err(|e| format!("創建文件失敗: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("讀取數據失敗: {}", e))?;
        
        // 使用異步寫入
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("寫入文件失敗: {}", e))?;

        downloaded += chunk.len() as u64;

        // 調用進度回調
        if let Some(ref callback) = progress_callback {
            callback(downloaded, total_size);
        }

        // 每 5MB 打印一次進度
        if downloaded % 5_000_000 == 0 || downloaded == total_size {
            let percent = (downloaded as f64 / total_size as f64) * 100.0;
            println!("[下載翻譯模型] {} 進度: {:.1}% ({}/{} bytes)", config.model_name, percent, downloaded, total_size);
        }
    }

    println!("[下載翻譯模型] 下載完成: {:?}", downloaded_file);

    // 如果是 ZIP 文件，解壓
    if is_zip {
        extract_model_zip(&downloaded_file, &model_dir)?;
        // 刪除 ZIP 文件以節省空間
        fs::remove_file(&downloaded_file)
            .unwrap_or_else(|e| eprintln!("警告: 無法刪除 ZIP 文件: {}", e));
        Ok(model_dir)
    } else {
        Ok(downloaded_file)
    }
}

/// 解壓模型 ZIP 文件
fn extract_model_zip(zip_path: &Path, output_dir: &Path) -> Result<PathBuf, String> {
    use std::fs::File;
    use std::io::Read;
    use zip::ZipArchive;
    
    println!("[下載翻譯模型] 開始解壓 ZIP 文件: {:?}", zip_path);
    
    // 確保輸出目錄存在
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("創建輸出目錄失敗: {}", e))?;
    
    // 打開 ZIP 文件
    let file = File::open(zip_path)
        .map_err(|e| format!("打開 ZIP 文件失敗: {}", e))?;
    
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("讀取 ZIP 文件失敗: {}", e))?;
    
    // 解壓所有文件
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("讀取 ZIP 條目 {} 失敗: {}", i, e))?;
        
        let outpath = match file.enclosed_name() {
            Some(path) => output_dir.join(path),
            None => continue,
        };
        
        // 創建目錄（如果需要）
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("創建目錄失敗: {}", e))?;
        } else {
            // 確保父目錄存在
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("創建父目錄失敗: {}", e))?;
            }
            
            // 解壓文件
            let mut outfile = File::create(&outpath)
                .map_err(|e| format!("創建文件失敗: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("寫入文件失敗: {}", e))?;
        }
    }
    
    println!("[下載翻譯模型] ZIP 解壓完成: {:?}", output_dir);
    Ok(output_dir.to_path_buf())
}

/// 檢查翻譯模型文件是否存在
pub async fn check_translation_model(
    model_path: &Path,
    expected_size: Option<u64>,
) -> Result<bool, String> {
    if !model_path.exists() {
        return Ok(false);
    }

    let metadata = std::fs::metadata(model_path)
        .map_err(|e| format!("獲取文件信息失敗: {}", e))?;

    if let Some(expected_size) = expected_size {
        let file_size = metadata.len();
        // 允許 5% 的誤差
        let tolerance = (expected_size as f64 * 0.05) as u64;
        let is_valid = (file_size as i64 - expected_size as i64).abs() as u64 <= tolerance;
        Ok(is_valid)
    } else {
        Ok(true)
    }
}

