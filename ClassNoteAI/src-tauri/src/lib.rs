// Whisper 模塊
mod whisper;
// 翻譯模塊
pub mod translation;  // 公開以便測試使用
// 數據存儲模塊
pub mod storage;  // 公開以便測試使用
// VAD 模塊
mod vad;
// Embedding 模塊
mod embedding;

use whisper::WhisperService;
use embedding::EmbeddingService;
use tokio::sync::Mutex;
// use tauri::{Manager, Emitter}; // Unused imports removed

// 全局 Whisper 服務實例
static WHISPER_SERVICE: Mutex<Option<WhisperService>> = Mutex::const_new(None);
// 全局 Embedding 服務實例
static EMBEDDING_SERVICE: Mutex<Option<EmbeddingService>> = Mutex::const_new(None);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 加載 Whisper 模型
#[tauri::command]
async fn load_whisper_model(model_path: String) -> Result<String, String> {
    let mut service_guard = WHISPER_SERVICE.lock().await;
    
    let mut service = WhisperService::new();
    service
        .load_model(&model_path)
        .await
        .map_err(|e| format!("模型加載失敗: {}", e))?;
    
    *service_guard = Some(service);
    Ok("模型加載成功".to_string())
}

/// 使用 VAD 檢測語音段落
#[tauri::command]
async fn detect_speech_segments(
    audio_data: Vec<i16>,
    sample_rate: u32,
    energy_threshold: Option<f32>,
    min_speech_duration_ms: Option<u64>,
    max_speech_duration_ms: Option<u64>,
) -> Result<Vec<vad::SpeechSegment>, String> {
    use crate::vad::{VadConfig, VadDetector};
    
    let mut config = VadConfig::default();
    config.sample_rate = sample_rate;
    
    if let Some(threshold) = energy_threshold {
        config.energy_threshold = threshold;
    }
    if let Some(min_duration) = min_speech_duration_ms {
        config.min_speech_duration_ms = min_duration;
    }
    if let Some(max_duration) = max_speech_duration_ms {
        config.max_speech_duration_ms = max_duration;
    }
    
    let detector = VadDetector::new(config);
    
    // 檢測語音段落
    let mut segments = detector.detect_speech_segments(&audio_data);
    
    // 強制在最大時長處切片
    segments = detector.enforce_max_duration(segments);
    
    // 過濾太短的片段
    segments = detector.filter_short_segments(segments);
    
    Ok(segments)
}

/// 轉錄音頻數據
#[tauri::command]
async fn transcribe_audio(
    audio_data: Vec<i16>,
    sample_rate: u32,
    initial_prompt: Option<String>,
    options: Option<whisper::transcribe::TranscriptionOptions>,
) -> Result<whisper::transcribe::TranscriptionResult, String> {
    let service_guard = WHISPER_SERVICE.lock().await;
    
    let service = service_guard
        .as_ref()
        .ok_or_else(|| "模型未加載".to_string())?;
    
    service
        .transcribe(&audio_data, sample_rate, initial_prompt.as_deref(), options)
        .await
        .map_err(|e| format!("轉錄失敗: {}", e))
}

/// 下載 Whisper 模型（支持進度事件和斷點續傳）
#[tauri::command]
async fn download_whisper_model(
    app: tauri::AppHandle,
    model_type: String, // "base", "small", "tiny" 等
    output_dir: String,
) -> Result<String, String> {
    use std::path::Path;
    use whisper::download;
    
    let output_path = Path::new(&output_dir);
    let config = match model_type.as_str() {
        "tiny" => download::get_tiny_model_config(output_path),
        "base" => download::get_base_model_config(output_path),
        "small" => download::get_small_model_config(output_path),
        "medium" => download::get_medium_model_config(output_path),
        "large" => download::get_large_model_config(output_path),
        "small-q5" => download::get_small_quantized_model_config(output_path),
        "medium-q5" => download::get_medium_quantized_model_config(output_path),
        _ => return Err(format!("不支持的模型類型: {}。支持的類型: tiny, base, small, medium, large, small-q5, medium-q5", model_type)),
    };
    
    // 下載模型（通過 Tauri 事件發送進度）
    let app_clone = app.clone();
    let model_type_clone = model_type.clone();
    
    // 用於計算速度的變量
    let progress_start_time = std::sync::Arc::new(std::sync::Mutex::new(std::time::Instant::now()));
    let progress_last_time = std::sync::Arc::new(std::sync::Mutex::new(std::time::Instant::now()));
    let progress_last_downloaded = std::sync::Arc::new(std::sync::Mutex::new(0u64));
    
    let progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>> = Some(Box::new({
        let app_clone = app_clone.clone();
        let model_type_clone = model_type_clone.clone();
        let progress_start_time = progress_start_time.clone();
        let progress_last_time = progress_last_time.clone();
        let progress_last_downloaded = progress_last_downloaded.clone();
        
        move |downloaded, total| {
            use tauri::Emitter; // 在閉包內部導入 Emitter trait
            let now = std::time::Instant::now();
            let mut last_time = progress_last_time.lock().unwrap();
            let mut last_downloaded = progress_last_downloaded.lock().unwrap();
            
            let elapsed = now.duration_since(*last_time);
            let downloaded_bytes = downloaded.saturating_sub(*last_downloaded);
            
            // 計算速度（每 500ms 更新一次）
            let speed_mbps = if elapsed.as_millis() >= 500 && elapsed.as_millis() > 0 {
                let speed_bps = downloaded_bytes as f64 / elapsed.as_millis() as f64 * 1000.0;
                speed_bps / 1_000_000.0
            } else {
                0.0
            };
            
            // 計算 ETA
            let remaining = total.saturating_sub(downloaded);
            let eta_seconds = if speed_mbps > 0.0 && remaining > 0 {
                let speed_bps = speed_mbps * 1_000_000.0;
                Some((remaining as f64 / speed_bps) as u64)
            } else {
                None
            };
            
            let percent = if total > 0 {
                (downloaded as f64 / total as f64) * 100.0
            } else {
                0.0
            };
            
            let progress = download::DownloadProgress {
                downloaded,
                total,
                percent,
                speed_mbps,
                eta_seconds,
            };
            
            // 發送進度事件到前端
            // Tauri 2.0 中使用 AppHandle 的 emit 方法（需要 Manager trait）
            let event_name = format!("download-progress-{}", model_type_clone);
            if let Err(e) = app_clone.emit(&event_name, &progress) {
                eprintln!("[下載] 發送進度事件失敗: {}", e);
            }
            
            // 更新時間和已下載量
            if elapsed.as_millis() >= 500 {
                *last_time = now;
                *last_downloaded = downloaded;
            }
        }
    }));
    
    // 下載前發送開始事件
    use tauri::Emitter;
    let _ = app.emit(&format!("download-started-{}", model_type), &model_type);
    
    let result = download::download_model(&config, progress_callback)
        .await
        .map(|path| format!("模型下載成功: {:?}", path))
        .map_err(|e| format!("下載失敗: {}", e));
    
    // 下載完成後發送完成事件
    match &result {
        Ok(_) => {
            let _ = app.emit(&format!("download-completed-{}", model_type), &model_type);
        }
        Err(e) => {
            let _ = app.emit(&format!("download-error-{}", model_type), e);
        }
    }
    
    result
}

/// 檢查模型文件是否存在
#[tauri::command]
async fn check_whisper_model(model_path: String) -> Result<bool, String> {
    use std::path::Path;
    use whisper::download;
    
    let path = Path::new(&model_path);
    
    // 根據文件名判斷模型類型並設置預期大小
    let expected_size = if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
        if file_name.contains("tiny") {
            Some(75_000_000) // Tiny 約 75MB
        } else if file_name.contains("base") {
            Some(142_000_000) // Base 約 142MB（實際約 141MB）
        } else if file_name.contains("small-q5") {
            Some(180_000_000) // Small Q5 約 180MB
        } else if file_name.contains("small") {
            Some(466_000_000) // Small 約 466MB
        } else if file_name.contains("medium-q5") {
            Some(530_000_000) // Medium Q5 約 530MB
        } else if file_name.contains("medium") {
            Some(1_500_000_000) // Medium 約 1.5GB
        } else if file_name.contains("large") {
            Some(2_900_000_000) // Large 約 2.9GB
        } else {
            None // 未知類型，只檢查文件是否存在
        }
    } else {
        None
    };
    
    download::check_model_file(path, expected_size)
        .await
        .map_err(|e| format!("檢查失敗: {}", e))
}

/// 粗翻譯（本地或 Google API）
#[tauri::command]
async fn translate_rough(
    text: String,
    source_lang: String,
    target_lang: String,
    provider: Option<String>, // "local" 或 "google"
    google_api_key: Option<String>, // Google API 密鑰（可選，如果為空則使用非官方接口）
) -> Result<translation::TranslationResult, String> {
    // 根據 provider 選擇翻譯方式
    let provider = provider.as_deref().unwrap_or("local");
    
    match provider {
        "google" => {
            // 如果提供了 API 密鑰，使用官方 API；否則使用非官方接口
            translation::google::translate_with_google(
                &text,
                &source_lang,
                &target_lang,
                google_api_key.as_deref(),
            )
            .await
            .map_err(|e| e.to_string())
        }
        "local" | _ => {
            translation::rough::translate_rough(&text, &source_lang, &target_lang)
                .await
                .map_err(|e| e.to_string())
        }
    }
}

/// 精翻譯（遠程）
#[tauri::command]
async fn translate_fine(
    text: String,
    source_lang: String,
    target_lang: String,
    service_url: String,
) -> Result<translation::TranslationResult, String> {
    translation::fine::translate_fine(&text, &source_lang, &target_lang, &service_url)
        .await
        .map_err(|e| e.to_string())
}

/// 檢查遠程服務是否可用
#[tauri::command]
async fn check_remote_service(service_url: String) -> bool {
    translation::fine::check_remote_service(&service_url).await
}

/// 下載翻譯模型
/// 
/// model_name: 模型名稱（例如 "opus-mt-en-zh-onnx"）
/// output_dir: 輸出目錄路徑
#[tauri::command]
async fn download_translation_model(
    model_name: String,
    output_dir: String,
) -> Result<String, String> {
    use std::path::Path;
    use translation::download;
    
    // 解析模型類型
    let model_type = download::TranslationModelType::from_name(&model_name)
        .ok_or_else(|| format!("不支持的模型類型: {}", model_name))?;
    
    // 獲取模型配置
    let config = download::get_translation_model_config(model_type);
    
    let output_path = Path::new(&output_dir);
    
    // 下載模型（帶進度回調）
    // 克隆 model_name 以便在閉包中使用（閉包需要 'static 生命週期）
    let model_name_clone = model_name.clone();
    let progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>> = Some(Box::new(move |downloaded, total| {
        let percent = (downloaded as f64 / total as f64) * 100.0;
        if downloaded % 5_000_000 == 0 || downloaded == total {
            println!("[下載翻譯模型] {} 進度: {:.1}%", model_name_clone, percent);
        }
    }));
    
    // 下載模型文件
    let downloaded_path = download::download_translation_model(&config, output_path, progress_callback)
        .await
        .map_err(|e| format!("下載失敗: {}", e))?;
    
    // 如果是 ZIP 文件，需要解壓
    if downloaded_path.extension().and_then(|s| s.to_str()) == Some("zip") {
        // TODO: 實現 ZIP 解壓功能
        // 目前假設下載的是 ZIP 文件，需要解壓到 output_dir/model_name/ 目錄
        return Err("ZIP 解壓功能尚未實現，請手動解壓文件".to_string());
    }
    
    Ok(format!("翻譯模型下載成功: {:?}", downloaded_path))
}

/// 檢查翻譯模型文件是否存在
#[tauri::command]
async fn check_translation_model(model_path: String) -> Result<bool, String> {
    use std::path::Path;
    use translation::download;
    
    let path = Path::new(&model_path);
    let config = download::get_en_zh_model_config(path.parent().unwrap_or(Path::new(".")));
    
    download::check_translation_model(path, config.expected_size)
        .await
        .map_err(|e| format!("檢查失敗: {}", e))
}

/// 加載翻譯模型
/// 
/// model_dir: 模型目錄路徑（包含 encoder_model.onnx 和 decoder_model.onnx）
/// tokenizer_path: Tokenizer 文件路徑（可選，如果為空則嘗試自動查找）
#[tauri::command]
async fn load_translation_model(
    model_dir: String,
    tokenizer_path: Option<String>,
) -> Result<String, String> {
    use std::path::Path;
    use translation::model;
    
    let path = Path::new(&model_dir);
    let tokenizer_path_opt = tokenizer_path.as_deref().map(Path::new);
    
    let model_guard = model::get_model().await;
    let mut model = model_guard.lock().await;
    
    // 必須提供有效的模型目錄，無降級方案
    model.load_model(path, tokenizer_path_opt).await?;
    
    let mut message = "ONNX 翻譯模型加載成功（Encoder-Decoder）".to_string();
    if !model.is_tokenizer_loaded() {
        message.push_str("（警告：Tokenizer 未加載，翻譯功能可能無法正常工作）");
    }
    
    Ok(message)
}

/// 掃描可用的翻譯模型
/// 
/// 掃描項目根目錄下的 models 目錄，查找所有可用的翻譯模型
#[tauri::command]
async fn list_available_translation_models() -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::{Path, PathBuf};
    
    // 嘗試多個可能的路徑
    let mut possible_paths = Vec::new();
    
    // 策略1: 從可執行文件位置向上查找項目根目錄
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let search_dir = exe_dir.to_path_buf();
            
            // 如果在 target/debug 或 target/release 中，向上兩級到項目根目錄
            if search_dir.ends_with("debug") || search_dir.ends_with("release") {
                if let Some(parent) = search_dir.parent() {
                    if let Some(grandparent) = parent.parent() {
                        possible_paths.push(grandparent.join("models"));
                    }
                }
            }
            
            // 嘗試向上查找多層，尋找包含 models 目錄的位置
            let mut current = search_dir.clone();
            for _ in 0..5 {
                let models_path = current.join("models");
                if models_path.exists() {
                    possible_paths.push(models_path);
                }
                if let Some(parent) = current.parent() {
                    current = parent.to_path_buf();
                } else {
                    break;
                }
            }
        }
    }
    
    // 策略2: 使用當前工作目錄
    if let Ok(cwd) = std::env::current_dir() {
        let models_path = cwd.join("models");
        if models_path.exists() {
            possible_paths.push(models_path);
        }
        
        // 嘗試向上查找
        let mut current = cwd.clone();
        for _ in 0..5 {
            let models_path = current.join("models");
            if models_path.exists() {
                possible_paths.push(models_path);
            }
            if let Some(parent) = current.parent() {
                current = parent.to_path_buf();
            } else {
                break;
            }
        }
    }
    
    // 策略3: 使用 CARGO_MANIFEST_DIR 環境變量（如果可用）
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let models_path = PathBuf::from(manifest_dir).join("models");
        if models_path.exists() {
            possible_paths.push(models_path);
        }
    }
    
    // 去重並找到第一個存在的路徑
    let models_path = possible_paths
        .into_iter()
        .find(|p| p.exists() && p.is_dir());
    
    let models_path = match models_path {
        Some(path) => {
            println!("[TranslationModel] 找到 models 目錄: {:?}", path);
            path
        },
        None => {
            println!("[TranslationModel] 未找到 models 目錄，嘗試的路徑:");
            if let Ok(current_exe) = std::env::current_exe() {
                println!("  - 可執行文件: {:?}", current_exe);
            }
            if let Ok(cwd) = std::env::current_dir() {
                println!("  - 當前工作目錄: {:?}", cwd);
            }
            return Ok(vec![]);
        }
    };
    
    // 掃描目錄，查找包含 encoder_model.onnx 和 decoder_model.onnx 的子目錄
    let mut available_models = Vec::new();
    
    let entries = fs::read_dir(&models_path)
        .map_err(|e| format!("讀取 models 目錄失敗: {:?}, 錯誤: {}", models_path, e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("讀取目錄項失敗: {}", e))?;
        let path = entry.path();
        
        if path.is_dir() {
            let encoder_path = path.join("encoder_model.onnx");
            let decoder_path = path.join("decoder_model.onnx");
            
            // 檢查是否包含必要的模型文件
            if encoder_path.exists() && decoder_path.exists() {
                // 獲取目錄名稱作為模型名稱
                if let Some(model_name) = path.file_name().and_then(|n| n.to_str()) {
                    println!("[TranslationModel] 找到模型: {}", model_name);
                    available_models.push(model_name.to_string());
                }
            }
        }
    }
    
    // 排序模型列表
    available_models.sort();
    
    println!("[TranslationModel] 共找到 {} 個可用模型", available_models.len());
    
    Ok(available_models)
}

/// 根據模型名稱加載翻譯模型
/// 
/// model_name: 模型名稱（例如 "opus-mt-en-zh-onnx"）
/// 自動查找模型目錄並加載
#[tauri::command]
async fn load_translation_model_by_name(model_name: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;
    use translation::model;
    
    // 使用與 list_available_translation_models 相同的路徑查找邏輯
    let mut possible_paths = Vec::new();
    
    // 策略1: 從可執行文件位置向上查找
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let search_dir = exe_dir.to_path_buf();
            
            if search_dir.ends_with("debug") || search_dir.ends_with("release") {
                if let Some(parent) = search_dir.parent() {
                    if let Some(grandparent) = parent.parent() {
                        possible_paths.push(grandparent.join("models").join(&model_name));
                    }
                }
            }
            
            let mut current = search_dir.clone();
            for _ in 0..5 {
                let model_path = current.join("models").join(&model_name);
                if model_path.exists() {
                    possible_paths.push(model_path);
                }
                if let Some(parent) = current.parent() {
                    current = parent.to_path_buf();
                } else {
                    break;
                }
            }
        }
    }
    
    // 策略2: 使用當前工作目錄
    if let Ok(cwd) = std::env::current_dir() {
        let mut current = cwd.clone();
        for _ in 0..5 {
            let model_path = current.join("models").join(&model_name);
            if model_path.exists() {
                possible_paths.push(model_path);
            }
            if let Some(parent) = current.parent() {
                current = parent.to_path_buf();
            } else {
                break;
            }
        }
    }
    
    // 策略3: 使用 CARGO_MANIFEST_DIR
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let model_path = PathBuf::from(manifest_dir).join("models").join(&model_name);
        if model_path.exists() {
            possible_paths.push(model_path);
        }
    }
    
    // 找到第一個存在的模型目錄
    let model_dir = possible_paths
        .into_iter()
        .find(|p| p.exists() && p.is_dir());
    
    let model_dir = match model_dir {
        Some(path) => {
            println!("[TranslationModel] 找到模型目錄: {:?}", path);
            path
        },
        None => {
            return Err(format!("模型目錄不存在: {}", model_name));
        }
    };
    
    // 檢查必要的模型文件
    let encoder_path = model_dir.join("encoder_model.onnx");
    let decoder_path = model_dir.join("decoder_model.onnx");
    
    if !encoder_path.exists() {
        return Err(format!("Encoder 模型文件不存在: {:?}", encoder_path));
    }
    if !decoder_path.exists() {
        return Err(format!("Decoder 模型文件不存在: {:?}", decoder_path));
    }
    
    // 自動查找 tokenizer 文件
    let tokenizer_path = model_dir.join("tokenizer.json");
    let tokenizer_path_opt = if tokenizer_path.exists() {
        Some(tokenizer_path.as_path())
    } else {
        None
    };
    
    // 加載模型
    let model_guard = model::get_model().await;
    let mut model = model_guard.lock().await;
    
    model.load_model(&model_dir, tokenizer_path_opt).await?;
    
    let mut message = format!("翻譯模型 '{}' 加載成功", model_name);
    if !model.is_tokenizer_loaded() {
        message.push_str("（警告：Tokenizer 未加載，翻譯功能可能無法正常工作）");
    }
    
    Ok(message)
}

// ========== 數據存儲相關 Commands ==========

/// 保存科目
#[tauri::command]
async fn save_course(course: storage::Course) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let mut course = course;
    course.updated_at = chrono::Utc::now().to_rfc3339();
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.save_course(&course)
        .map_err(|e| format!("保存科目失敗: {}", e))?;
    
    Ok(())
}

/// 獲取科目
#[tauri::command]
async fn get_course(id: String) -> Result<Option<storage::Course>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.get_course(&id)
        .map_err(|e| format!("獲取科目失敗: {}", e))
}

/// 列出所有科目
#[tauri::command]
async fn list_courses() -> Result<Vec<storage::Course>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.list_courses()
        .map_err(|e| format!("列出科目失敗: {}", e))
}

/// 刪除科目
#[tauri::command]
async fn delete_course(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.delete_course(&id)
        .map_err(|e| format!("刪除科目失敗: {}", e))?;
    
    Ok(())
}

/// 列出特定科目的所有課堂
#[tauri::command]
async fn list_lectures_by_course(course_id: String) -> Result<Vec<storage::Lecture>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.list_lectures_by_course(&course_id)
        .map_err(|e| format!("列出課程失敗: {}", e))
}


/// 保存課程
#[tauri::command]
async fn save_lecture(lecture: storage::Lecture) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let mut lecture = lecture;
    lecture.updated_at = chrono::Utc::now().to_rfc3339();
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.save_lecture(&lecture)
        .map_err(|e| format!("保存課程失敗: {}", e))?;
    
    Ok(())
}

/// 獲取課程
#[tauri::command]
async fn get_lecture(id: String) -> Result<Option<storage::Lecture>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.get_lecture(&id)
        .map_err(|e| format!("獲取課程失敗: {}", e))
}

/// 列出所有課程
#[tauri::command]
async fn list_lectures() -> Result<Vec<storage::Lecture>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.list_lectures()
        .map_err(|e| format!("列出課程失敗: {}", e))
}

/// 刪除課程
#[tauri::command]
async fn delete_lecture(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.delete_lecture(&id)
        .map_err(|e| format!("刪除課程失敗: {}", e))?;
    
    Ok(())
}

/// 更新課程狀態
#[tauri::command]
async fn update_lecture_status(id: String, status: String) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.update_lecture_status(&id, &status)
        .map_err(|e| format!("更新課程狀態失敗: {}", e))?;
    
    Ok(())
}

/// 保存字幕
#[tauri::command]
async fn save_subtitle(subtitle: storage::Subtitle) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.save_subtitle(&subtitle)
        .map_err(|e| format!("保存字幕失敗: {}", e))?;
    
    Ok(())
}

/// 批量保存字幕
#[tauri::command]
async fn save_subtitles(subtitles: Vec<storage::Subtitle>) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.save_subtitles(&subtitles)
        .map_err(|e| format!("批量保存字幕失敗: {}", e))?;
    
    Ok(())
}

/// 獲取課程的所有字幕
#[tauri::command]
async fn get_subtitles(lecture_id: String) -> Result<Vec<storage::Subtitle>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.get_subtitles(&lecture_id)
        .map_err(|e| format!("獲取字幕失敗: {}", e))
}

/// 保存設置
#[tauri::command]
async fn save_setting(key: String, value: String) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.save_setting(&key, &value)
        .map_err(|e| format!("保存設置失敗: {}", e))?;
    
    Ok(())
}

/// 獲取設置
#[tauri::command]
async fn get_setting(key: String) -> Result<Option<String>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.get_setting(&key)
        .map_err(|e| format!("獲取設置失敗: {}", e))
}

/// 獲取所有設置
#[tauri::command]
async fn get_all_settings() -> Result<Vec<storage::Setting>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.get_all_settings()
        .map_err(|e| format!("獲取所有設置失敗: {}", e))
}

/// 保存筆記
#[tauri::command]
async fn save_note(note: storage::Note) -> Result<(), String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.save_note(&note)
        .map_err(|e| format!("保存筆記失敗: {}", e))?;
    
    Ok(())
}

/// 獲取筆記
#[tauri::command]
async fn get_note(lecture_id: String) -> Result<Option<storage::Note>, String> {
    let manager = storage::get_db_manager().await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    
    let db = manager.get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    
    db.get_note(&lecture_id)
        .map_err(|e| format!("獲取筆記失敗: {}", e))
}

/// 寫入文本文件
#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    use std::fs;
    fs::write(&path, contents)
        .map_err(|e| format!("寫入文件失敗: {}", e))?;
    Ok(())
}

/// 讀取文本文件
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    use std::fs;
    fs::read_to_string(&path)
        .map_err(|e| format!("讀取文件失敗: {}", e))
}

/// 讀取二進制文件（用於 PDF 等）
#[tauri::command]
async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    use std::fs;
    fs::read(&path)
        .map_err(|e| format!("讀取文件失敗: {}", e))
}

// ========== Embedding 相關 Commands ==========

/// 加載 Embedding 模型
#[tauri::command]
async fn load_embedding_model(model_path: String, tokenizer_path: String) -> Result<String, String> {
    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = EmbeddingService::new(&model_path, &tokenizer_path)
        .map_err(|e| format!("Embedding 模型加載失敗: {}", e))?;
    *service_guard = Some(service);
    Ok("Embedding 模型加載成功".to_string())
}

/// 生成文本 Embedding
#[tauri::command]
async fn generate_embedding(text: String) -> Result<Vec<f32>, String> {
    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = service_guard.as_mut().ok_or("Embedding 模型未加載".to_string())?;
    service.generate_embedding(&text).map_err(|e| format!("生成 Embedding 失敗: {}", e))
}

/// 計算餘弦相似度
#[tauri::command]
async fn calculate_similarity(text_a: String, text_b: String) -> Result<f32, String> {
    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = service_guard.as_mut().ok_or("Embedding 模型未加載".to_string())?;
    
    let emb_a = service.generate_embedding(&text_a).map_err(|e| format!("生成 Embedding A 失敗: {}", e))?;
    let emb_b = service.generate_embedding(&text_b).map_err(|e| format!("生成 Embedding B 失敗: {}", e))?;
    
    Ok(EmbeddingService::cosine_similarity(&emb_a, &emb_b))
}

#[tauri::command]
async fn download_embedding_model_cmd(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    use embedding::{download_embedding_model, EmbeddingModelConfig};
    use std::path::PathBuf;
    use tauri::Emitter;

    // Get models directory
    let app_data_dir = get_app_data_dir()?;
    let models_dir = PathBuf::from(app_data_dir).join("models");
    
    // Create config
    let config = EmbeddingModelConfig::default(models_dir);

    // Progress callback
    let progress_callback = Box::new(move |downloaded: u64, total: u64| {
        let progress = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0) as u64
        } else {
            0
        };
        
        // Emit progress event
        let _ = window.emit("embedding_download_progress", progress);
    });

    // Download with retry
    download_embedding_model(&config, Some(progress_callback))
        .await
        .map_err(|e| format!("下載失敗: {}", e))?;

    Ok(())
}

fn get_app_data_dir_path() -> Result<std::path::PathBuf, String> {
    let app_name = "com.classnoteai";
    
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|e| format!("Cannot get HOME: {}", e))?;
        Ok(std::path::PathBuf::from(home).join("Library/Application Support").join(app_name))
    }
    
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|e| format!("Cannot get APPDATA: {}", e))?;
        Ok(std::path::PathBuf::from(appdata).join(app_name))
    }
    
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").map_err(|e| format!("Cannot get HOME: {}", e))?;
        Ok(std::path::PathBuf::from(home).join(".local/share").join(app_name))
    }
}

#[tauri::command]
fn get_app_data_dir() -> Result<String, String> {
    get_app_data_dir_path().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn convert_to_pdf(file_path: String) -> Result<String, String> {
    use std::process::Command;
    use std::path::Path;
    use std::fs;
    use std::time::Duration;

    let input_path = Path::new(&file_path);
    if !input_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Determine file type
    let extension = input_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .ok_or("Unknown file type")?;

    // Use persistent app data directory for output
    let app_data_dir = get_app_data_dir_path()?;
    let documents_dir = app_data_dir.join("documents");
    
    if !documents_dir.exists() {
        fs::create_dir_all(&documents_dir).map_err(|e| format!("Failed to create documents dir: {}", e))?;
    }

    let file_stem = input_path.file_stem().ok_or("Invalid filename")?.to_string_lossy();
    // Use a hash of the input path to avoid collisions if files have same name but different locations
    // Or just append timestamp/random string. Let's use timestamp for simplicity and uniqueness.
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    
    let output_filename = format!("{}_{}.pdf", file_stem, timestamp);
    let output_pdf_path = documents_dir.join(&output_filename);

    // Remove existing output (unlikely with timestamp, but good practice)
    if output_pdf_path.exists() {
        fs::remove_file(&output_pdf_path).ok();
    }

    println!("Converting {} to PDF", file_path);
    println!("Output path: {:?}", output_pdf_path);
    println!("File type: {}", extension);

    // Platform-specific conversion with layered fallback
    #[cfg(target_os = "macos")]
    {
        // Try macOS native conversions first
        match extension.as_str() {
            "ppt" | "pptx" => {
                // Try Keynote first (best quality, built-in)
                if let Ok(path) = try_keynote_conversion(&file_path, &output_pdf_path) {
                    println!("✓ Converted using Keynote (highest quality)");
                    return Ok(path);
                }
                
                // Try PowerPoint for Mac
                if let Ok(path) = try_office_mac_conversion(&file_path, &output_pdf_path, "PowerPoint") {
                    println!("✓ Converted using Microsoft PowerPoint");
                    return Ok(path);
                }
            }
            "doc" | "docx" => {
                // Try Pages first
                if let Ok(path) = try_pages_conversion(&file_path, &output_pdf_path) {
                    println!("✓ Converted using Pages (highest quality)");
                    return Ok(path);
                }
                
                // Try Word for Mac
                if let Ok(path) = try_office_mac_conversion(&file_path, &output_pdf_path, "Word") {
                    println!("✓ Converted using Microsoft Word");
                    return Ok(path);
                }
            }
            _ => {}
        }
        
        // Fallback to LibreOffice
        println!("⚠ Native apps not available, falling back to LibreOffice");
    }

    // Use LibreOffice (cross-platform fallback)
    convert_with_libreoffice(&file_path, &output_pdf_path)
}

#[cfg(target_os = "macos")]
fn try_keynote_conversion(input_path: &str, output_path: &std::path::Path) -> Result<String, String> {
    use std::process::Command;
    
    // Check if Keynote is available
    if !std::path::Path::new("/Applications/Keynote.app").exists() {
        return Err("Keynote not installed".to_string());
    }

    // Use AppleScript instead of JXA for better reliability
    let script = format!(
        r#"
        tell application "Keynote"
            set theDoc to open POSIX file "{}"
            delay 2
            export theDoc to POSIX file "{}" as PDF
            delay 1
            close theDoc
        end tell
        "#,
        input_path.replace("\"", "\\\""),
        output_path.to_string_lossy().replace("\"", "\\\"")
    );

    println!("Executing Keynote conversion...");
    
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to execute Keynote: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Keynote conversion error: {}", stderr));
    }

    wait_for_file(output_path)?;
    validate_pdf(output_path)?;
    
    Ok(output_path.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
fn try_pages_conversion(input_path: &str, output_path: &std::path::Path) -> Result<String, String> {
    use std::process::Command;
    
    if !std::path::Path::new("/Applications/Pages.app").exists() {
        return Err("Pages not installed".to_string());
    }

    let script = format!(
        r#"
        tell application "Pages"
            set theDoc to open POSIX file "{}"
            delay 2
            export theDoc to POSIX file "{}" as PDF
            delay 1
            close theDoc
        end tell
        "#,
        input_path.replace("\"", "\\\""),
        output_path.to_string_lossy().replace("\"", "\\\"")
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to execute Pages: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pages conversion error: {}", stderr));
    }

    wait_for_file(output_path)?;
    validate_pdf(output_path)?;
    
    Ok(output_path.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
fn try_office_mac_conversion(input_path: &str, output_path: &std::path::Path, app_name: &str) -> Result<String, String> {
    use std::process::Command;
    
    let app_path = format!("/Applications/Microsoft {}.app", app_name);
    if !std::path::Path::new(&app_path).exists() {
        return Err(format!("Microsoft {} not installed", app_name));
    }

    let script = format!(
        r#"
        tell application "Microsoft {}"
            set theDoc to open POSIX file "{}"
            delay 2
            save as theDoc file name (POSIX file "{}") file format PDF file format
            delay 1
            close theDoc
        end tell
        "#,
        app_name,
        input_path.replace("\"", "\\\""),
        output_path.to_string_lossy().replace("\"", "\\\"")
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", app_name, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{} conversion error: {}", app_name, stderr));
    }

    wait_for_file(output_path)?;
    validate_pdf(output_path)?;
    
    Ok(output_path.to_string_lossy().into_owned())
}

fn convert_with_libreoffice(input_path: &str, output_path: &std::path::Path) -> Result<String, String> {
    use std::process::Command;
    use std::path::Path;

    let temp_dir = output_path.parent().ok_or("Invalid output path")?;

    let soffice_cmd = if cfg!(target_os = "macos") {
        if Path::new("/Applications/LibreOffice.app/Contents/MacOS/soffice").exists() {
            "/Applications/LibreOffice.app/Contents/MacOS/soffice"
        } else {
            "soffice"
        }
    } else {
        "soffice"
    };

    println!("Using LibreOffice: {}", soffice_cmd);

    let output = Command::new(soffice_cmd)
        .arg("--headless")
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(temp_dir)
        .arg(input_path)
        .output()
        .map_err(|e| format!("Failed to execute LibreOffice: {}. Please install LibreOffice.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("LibreOffice conversion failed: {}", stderr));
    }

    wait_for_file(output_path)?;
    validate_pdf(output_path)?;
    
    Ok(output_path.to_string_lossy().into_owned())
}

fn wait_for_file(path: &std::path::Path) -> Result<(), String> {
    use std::fs;
    use std::time::Duration;
    
    let max_wait = 30;
    let mut waited = 0;
    let mut last_size = 0;
    
    while waited < max_wait {
        if path.exists() {
            if let Ok(metadata) = fs::metadata(path) {
                let current_size = metadata.len();
                if current_size > 0 && current_size == last_size {
                    println!("File ready. Size: {} bytes", current_size);
                    return Ok(());
                }
                last_size = current_size;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
        waited += 1;
    }

    if path.exists() {
        Ok(())
    } else {
        Err("Timeout waiting for PDF file".to_string())
    }
}

fn validate_pdf(path: &std::path::Path) -> Result<(), String> {
    use std::fs;
    use std::io::Read;
    
    let metadata = fs::metadata(path)
        .map_err(|e| format!("Cannot read PDF: {}", e))?;
    
    if metadata.len() < 100 {
        return Err(format!("PDF too small ({} bytes)", metadata.len()));
    }

    let mut file = fs::File::open(path)
        .map_err(|e| format!("Cannot open PDF: {}", e))?;
    let mut header = [0u8; 5];
    file.read_exact(&mut header).ok();
    
    if &header != b"%PDF-" {
        return Err("Invalid PDF header".to_string());
    }

    Ok(())
}

#[tauri::command]
fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().into_owned()
}



#[tauri::command]
async fn write_temp_file(path: String, data: Vec<u8>) -> Result<(), String> {
    use std::fs::File;
    use std::io::Write;

    let mut file = File::create(&path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    
    file.write_all(&data)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 在 debug 模式下自動打開開發者工具
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            
            // 初始化數據庫
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = storage::init_db(&app_handle).await {
                    eprintln!("數據庫初始化失敗: {}", e);
                } else {
                    println!("數據庫初始化成功");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_speech_segments,
            greet,
            load_whisper_model,
            transcribe_audio,
            download_whisper_model,
            check_whisper_model,
            translate_rough,
            translate_fine,
            check_remote_service,
            download_translation_model,
            check_translation_model,
            load_translation_model,
            list_available_translation_models,
            load_translation_model_by_name,
            // 數據存儲相關
            save_course,
            get_course,
            list_courses,
            delete_course,
            list_lectures_by_course,
            save_lecture,
            get_lecture,
            list_lectures,
            delete_lecture,
            update_lecture_status,
            save_subtitle,
            save_subtitles,
            get_subtitles,
            save_setting,
            get_setting,
            get_all_settings,
            save_note,
            get_note,
            write_text_file,
            read_text_file,
            read_binary_file,
            // Embedding 相關
            load_embedding_model,
            generate_embedding,
            calculate_similarity,
            download_embedding_model_cmd,
            // 文檔轉換相關
            convert_to_pdf,
            get_temp_dir,
            get_app_data_dir,
            write_temp_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
