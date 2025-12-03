// Whisper 模塊
mod whisper;
// 翻譯模塊
pub mod translation;  // 公開以便測試使用
// 數據存儲模塊
pub mod storage;  // 公開以便測試使用

use whisper::WhisperService;
use tokio::sync::Mutex;

// 全局 Whisper 服務實例
static WHISPER_SERVICE: Mutex<Option<WhisperService>> = Mutex::const_new(None);

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

/// 轉錄音頻數據
#[tauri::command]
async fn transcribe_audio(
    audio_data: Vec<i16>,
    sample_rate: u32,
    initial_prompt: Option<String>,
) -> Result<whisper::transcribe::TranscriptionResult, String> {
    let service_guard = WHISPER_SERVICE.lock().await;
    
    let service = service_guard
        .as_ref()
        .ok_or_else(|| "模型未加載".to_string())?;
    
    service
        .transcribe(&audio_data, sample_rate, initial_prompt.as_deref())
        .await
        .map_err(|e| format!("轉錄失敗: {}", e))
}

/// 下載 Whisper 模型
#[tauri::command]
async fn download_whisper_model(
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
        _ => return Err(format!("不支持的模型類型: {}。支持的類型: tiny, base, small", model_type)),
    };
    
    // 下載模型（帶進度回調）
    let progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>> = Some(Box::new(|downloaded, total| {
        let percent = (downloaded as f64 / total as f64) * 100.0;
        if downloaded % 5_000_000 == 0 || downloaded == total {
            println!("[下載進度] {:.1}%", percent);
        }
    }));
    
    download::download_model(&config, progress_callback)
        .await
        .map(|path| format!("模型下載成功: {:?}", path))
        .map_err(|e| format!("下載失敗: {}", e))
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
        } else if file_name.contains("small") {
            Some(466_000_000) // Small 約 466MB
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

/// 粗翻譯（本地）
#[tauri::command]
async fn translate_rough(
    text: String,
    source_lang: String,
    target_lang: String,
) -> Result<translation::TranslationResult, String> {
    translation::rough::translate_rough(&text, &source_lang, &target_lang)
        .await
        .map_err(|e| e.to_string())
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
    let progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>> = Some(Box::new(|downloaded, total| {
        let percent = (downloaded as f64 / total as f64) * 100.0;
        if downloaded % 5_000_000 == 0 || downloaded == total {
            println!("[下載翻譯模型] {} 進度: {:.1}%", model_name, percent);
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
            let mut search_dir = exe_dir.to_path_buf();
            
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
    use std::path::{Path, PathBuf};
    use translation::model;
    
    // 使用與 list_available_translation_models 相同的路徑查找邏輯
    let mut possible_paths = Vec::new();
    
    // 策略1: 從可執行文件位置向上查找
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let mut search_dir = exe_dir.to_path_buf();
            
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
            read_binary_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
