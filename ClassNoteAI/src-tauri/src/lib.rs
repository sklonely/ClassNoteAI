// Whisper 模塊
mod whisper;
// 翻譯模塊
pub mod translation; // 公開以便測試使用
                     // 數據存儲模塊
pub mod storage; // 公開以便測試使用
                 // VAD 模塊
mod vad;
// Embedding 模塊
mod embedding;
// 首次運行設置模塊
mod setup;
// 統一路徑管理模塊
pub mod paths;
// 統一下載管理模塊
pub mod downloads;
// 同步模塊
mod sync;

use embedding::EmbeddingService;
use tauri::Emitter;
use tokio::sync::Mutex;
use whisper::WhisperService; // For window.emit()

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
    let progress_last_time = std::sync::Arc::new(std::sync::Mutex::new(std::time::Instant::now()));
    let progress_last_downloaded = std::sync::Arc::new(std::sync::Mutex::new(0u64));

    let progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>> = Some(Box::new({
        let app_clone = app_clone.clone();
        let model_type_clone = model_type_clone.clone();
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
    provider: Option<String>,       // "local" 或 "google"
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
        "local" | _ => translation::rough::translate_rough(&text, &source_lang, &target_lang)
            .await
            .map_err(|e| e.to_string()),
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

// ========== CTranslate2 翻譯相關 Commands ==========

/// 載入 CTranslate2 翻譯模型
#[tauri::command]
async fn load_ct2_model(model_path: String) -> Result<(), String> {
    translation::ctranslate2::load_ct2_model(&model_path).await
}

/// 檢查 CTranslate2 模型是否已載入
#[tauri::command]
async fn is_ct2_loaded() -> bool {
    translation::ctranslate2::is_ct2_loaded().await
}

/// 使用 CTranslate2 進行翻譯
#[tauri::command]
async fn translate_ct2(text: String) -> Result<String, String> {
    translation::ctranslate2::translate_ct2(&text).await
}

/// 使用 CTranslate2 進行批量翻譯
#[tauri::command]
async fn translate_ct2_batch(texts: Vec<String>) -> Result<Vec<String>, String> {
    translation::ctranslate2::translate_ct2_batch(&texts).await
}

/// 下載翻譯模型
///
/// model_name: 模型名稱（例如 "m2m100-418M-ct2-int8"）
#[tauri::command]
async fn download_translation_model(
    model_name: String,
    _output_dir: String, // Ignored - uses unified paths
    window: tauri::Window,
) -> Result<String, String> {
    use downloads::{download_model, get_translation_model_configs, DownloadProgress};

    // Find model config
    let configs = get_translation_model_configs();
    let config = configs
        .iter()
        .find(|c| c.name == model_name)
        .ok_or_else(|| format!("不支持的模型: {}", model_name))?
        .clone();

    println!(
        "[下載翻譯模型] 開始下載: {} 從 {}",
        config.name, config.download_url
    );

    // Progress callback that emits to frontend
    let window_clone = window.clone();
    let model_name_clone = model_name.clone();
    let progress_callback = move |progress: DownloadProgress| {
        // Emit progress event to frontend
        let _ = window_clone.emit(
            "translation_download_progress",
            serde_json::json!({
                "model": model_name_clone,
                "downloaded": progress.downloaded,
                "total": progress.total,
                "percent": progress.percent,
                "speed_mbps": progress.speed_mbps,
            }),
        );

        // Log progress
        if progress.downloaded % 10_000_000 == 0 || progress.percent >= 99.9 {
            println!(
                "[下載翻譯模型] {} 進度: {:.1}% ({:.1} MB/s)",
                model_name_clone, progress.percent, progress.speed_mbps
            );
        }
    };

    // Download using unified downloader
    let model_path = download_model(&config, Some(progress_callback))
        .await
        .map_err(|e| format!("下載失敗: {}", e))?;

    Ok(format!("翻譯模型下載成功: {:?}", model_path))
}

/// 檢查翻譯模型文件是否存在
#[tauri::command]
async fn check_translation_model(model_path: String) -> Result<bool, String> {
    use std::path::Path;

    let path = Path::new(&model_path);

    // CT2 format: check for model.bin
    let model_bin = path.join("model.bin");
    Ok(model_bin.exists())
}

/// 加載翻譯模型
///
/// model_dir: 模型目錄路徑（包含 model.bin）
#[tauri::command]
async fn load_translation_model(
    model_dir: String,
    _tokenizer_path: Option<String>,
) -> Result<String, String> {
    use std::path::Path;

    let path = Path::new(&model_dir);

    // 檢查 CT2 模型文件
    let model_bin_path = path.join("model.bin");
    if !model_bin_path.exists() {
        return Err(format!("CT2 模型文件不存在: {:?}", model_bin_path));
    }

    // 使用 CTranslate2 加載模型
    translation::ctranslate2::load_ct2_model(&model_dir).await?;

    Ok("CTranslate2 翻譯模型加載成功".to_string())
}

/// 掃描可用的翻譯模型
///
/// 使用統一路徑掃描 translation 目錄，查找所有可用的翻譯模型
#[tauri::command]
async fn list_available_translation_models() -> Result<Vec<String>, String> {
    use std::fs;

    // 使用統一路徑: {app_data}/models/translation/
    let translation_dir = paths::get_translation_models_dir()?;

    println!("[TranslationModel] 掃描翻譯模型目錄: {:?}", translation_dir);

    if !translation_dir.exists() {
        println!("[TranslationModel] 目錄不存在，嘗試創建");
        paths::ensure_dir_exists(&translation_dir)?;
        return Ok(vec![]);
    }

    // 掃描目錄，查找有效的翻譯模型
    // 支持 ONNX 格式（encoder_model.onnx + decoder_model.onnx）
    // 和 CTranslate2 格式（model.bin）
    let mut available_models = Vec::new();

    let entries = fs::read_dir(&translation_dir)
        .map_err(|e| format!("讀取目錄失敗: {:?}, 錯誤: {}", translation_dir, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("讀取目錄項失敗: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            // 檢查 ONNX 格式
            let encoder_path = path.join("encoder_model.onnx");
            let decoder_path = path.join("decoder_model.onnx");
            let is_onnx = encoder_path.exists() && decoder_path.exists();

            // 檢查 CTranslate2 格式
            let ct2_model_path = path.join("model.bin");
            let is_ct2 = ct2_model_path.exists();

            // 如果是任一有效格式，添加到列表
            if is_onnx || is_ct2 {
                if let Some(model_name) = path.file_name().and_then(|n| n.to_str()) {
                    let format_str = if is_ct2 { "CT2" } else { "ONNX" };
                    println!(
                        "[TranslationModel] 找到模型: {} ({})",
                        model_name, format_str
                    );
                    available_models.push(model_name.to_string());
                }
            }
        }
    }

    // 排序模型列表
    available_models.sort();

    println!(
        "[TranslationModel] 共找到 {} 個可用模型",
        available_models.len()
    );

    Ok(available_models)
}

/// 根據模型名稱加載翻譯模型
///
/// model_name: 模型名稱（例如 "m2m100-418M-ct2-int8"）
/// 使用統一路徑查找並加載模型
#[tauri::command]
async fn load_translation_model_by_name(model_name: String) -> Result<String, String> {
    // 使用統一路徑: {app_data}/models/translation/{model_name}/
    let translation_dir = paths::get_translation_models_dir()?;
    let model_dir = translation_dir.join(&model_name);

    println!("[TranslationModel] 嘗試加載模型: {:?}", model_dir);

    if !model_dir.exists() {
        return Err(format!("模型目錄不存在: {:?}", model_dir));
    }

    // 檢查 CT2 模型文件 (model.bin)
    let model_bin_path = model_dir.join("model.bin");

    if !model_bin_path.exists() {
        return Err(format!("CT2 模型文件不存在: {:?}", model_bin_path));
    }

    // 使用 CTranslate2 加載模型
    let model_path_str = model_dir.to_string_lossy().to_string();
    translation::ctranslate2::load_ct2_model(&model_path_str).await?;

    let message = format!("CTranslate2 翻譯模型 '{}' 加載成功", model_name);
    Ok(message)
}

// ========== 數據存儲相關 Commands ==========

/// 保存科目
#[tauri::command]
async fn save_course(course: storage::Course) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let mut course = course;
    course.updated_at = chrono::Utc::now().to_rfc3339();

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.save_course(&course)
        .map_err(|e| format!("保存科目失敗: {}", e))?;

    Ok(())
}

/// 獲取科目
#[tauri::command]
async fn get_course(id: String) -> Result<Option<storage::Course>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.get_course(&id)
        .map_err(|e| format!("獲取科目失敗: {}", e))
}

/// 列出所有科目
#[tauri::command]
async fn list_courses(user_id: String) -> Result<Vec<storage::Course>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.list_courses(&user_id)
        .map_err(|e| format!("列出科目失敗: {}", e))
}

/// 列出所有科目 (包含已刪除，用於同步)
#[tauri::command]
async fn list_courses_sync(user_id: String) -> Result<Vec<storage::Course>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.list_courses_sync(&user_id)
        .map_err(|e| format!("列出科目失敗: {}", e))
}

/// 刪除科目
#[tauri::command]
async fn delete_course(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.delete_course(&id)
        .map_err(|e| format!("刪除科目失敗: {}", e))?;

    Ok(())
}

/// 列出特定科目的所有課堂
#[tauri::command]
async fn list_lectures_by_course(course_id: String, user_id: String) -> Result<Vec<storage::Lecture>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.list_lectures_by_course(&course_id, &user_id)
        .map_err(|e| format!("列出課程失敗: {}", e))
}

/// 保存課程
#[tauri::command]
async fn save_lecture(lecture: storage::Lecture, user_id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let mut lecture = lecture;
    lecture.updated_at = chrono::Utc::now().to_rfc3339();

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.save_lecture(&lecture, &user_id)
        .map_err(|e| format!("保存課程失敗: {}", e))?;

    Ok(())
}

/// 獲取課程
#[tauri::command]
async fn get_lecture(id: String) -> Result<Option<storage::Lecture>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.get_lecture(&id)
        .map_err(|e| format!("獲取課程失敗: {}", e))
}

/// 列出所有課程
#[tauri::command]
async fn list_lectures(user_id: String) -> Result<Vec<storage::Lecture>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.list_lectures(&user_id)
        .map_err(|e| format!("列出課程失敗: {}", e))
}

/// 列出所有課程 (包含已刪除，用於同步)
#[tauri::command]
async fn list_lectures_sync(user_id: String) -> Result<Vec<storage::Lecture>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.list_lectures_sync(&user_id)
        .map_err(|e| format!("列出課程失敗: {}", e))
}

/// 刪除課程
#[tauri::command]
async fn delete_lecture(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.delete_lecture(&id)
        .map_err(|e| format!("刪除課程失敗: {}", e))?;

    Ok(())
}

/// 更新課程狀態
#[tauri::command]
async fn update_lecture_status(id: String, status: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.update_lecture_status(&id, &status)
        .map_err(|e| format!("更新課程狀態失敗: {}", e))?;

    Ok(())
}

/// 保存字幕
#[tauri::command]
async fn save_subtitle(subtitle: storage::Subtitle) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.save_subtitle(&subtitle)
        .map_err(|e| format!("保存字幕失敗: {}", e))?;

    Ok(())
}

/// 批量保存字幕
#[tauri::command]
async fn save_subtitles(subtitles: Vec<storage::Subtitle>) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.save_subtitles(&subtitles)
        .map_err(|e| format!("批量保存字幕失敗: {}", e))?;

    Ok(())
}

/// 獲取課程的所有字幕
#[tauri::command]
async fn get_subtitles(lecture_id: String) -> Result<Vec<storage::Subtitle>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.get_subtitles(&lecture_id)
        .map_err(|e| format!("獲取字幕失敗: {}", e))
}

/// 刪除單條字幕
#[tauri::command]
async fn delete_subtitle(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.delete_subtitle_by_id(&id)
        .map_err(|e| format!("刪除字幕失敗: {}", e))?;

    Ok(())
}

/// 保存設置
#[tauri::command]
async fn save_setting(key: String, value: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.save_setting(&key, &value)
        .map_err(|e| format!("保存設置失敗: {}", e))?;

    Ok(())
}

/// 獲取設置
#[tauri::command]
async fn get_setting(key: String) -> Result<Option<String>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.get_setting(&key)
        .map_err(|e| format!("獲取設置失敗: {}", e))
}

/// 獲取所有設置
#[tauri::command]
async fn get_all_settings() -> Result<Vec<storage::Setting>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.get_all_settings()
        .map_err(|e| format!("獲取所有設置失敗: {}", e))
}

/// 註冊本地使用者
#[tauri::command]
async fn register_local_user(username: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.create_local_user(&username)
        .map_err(|e| format!("創建本地使用者失敗: {}", e))
}

/// 檢查本地使用者
#[tauri::command]
async fn check_local_user(username: String) -> Result<bool, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.check_local_user(&username)
        .map_err(|e| format!("檢查使用者失敗: {}", e))
}

/// 保存筆記
#[tauri::command]
async fn save_note(note: storage::Note) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.save_note(&note)
        .map_err(|e| format!("保存筆記失敗: {}", e))?;

    Ok(())
}

/// 獲取筆記
#[tauri::command]
async fn get_note(lecture_id: String) -> Result<Option<storage::Note>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.get_note(&lecture_id)
        .map_err(|e| format!("獲取筆記失敗: {}", e))
}

/// 寫入文本文件
#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    use std::fs;
    fs::write(&path, contents).map_err(|e| format!("寫入文件失敗: {}", e))?;
    Ok(())
}

/// 讀取文本文件
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    use std::fs;
    fs::read_to_string(&path).map_err(|e| format!("讀取文件失敗: {}", e))
}

/// 讀取二進制文件（用於 PDF 等）
#[tauri::command]
async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    use std::fs;
    fs::read(&path).map_err(|e| format!("讀取文件失敗: {}", e))
}

/// 寫入二進制文件
#[tauri::command]
async fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::Path;

    let path_obj = Path::new(&path);
    if let Some(parent) = path_obj.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("創建目錄失敗: {}", e))?;
    }

    let mut file = File::create(&path).map_err(|e| format!("創建文件失敗: {}", e))?;
    file.write_all(&data).map_err(|e| format!("寫入文件失敗: {}", e))?;
    Ok(())
}

// ========== 首次運行設置相關 Commands ==========

/// 檢查設置狀態
#[tauri::command]
async fn check_setup_status() -> Result<setup::SetupStatus, String> {
    setup::get_setup_status().await
}

/// 檢查設置是否已完成
#[tauri::command]
async fn is_setup_complete() -> Result<bool, String> {
    setup::is_setup_complete().await
}

/// 開始安裝所需組件
#[tauri::command]
async fn start_setup_installation(
    requirement_ids: Vec<String>,
    window: tauri::Window,
) -> Result<(), String> {
    setup::install_requirements(requirement_ids, window).await
}

/// 取消安裝
#[tauri::command]
async fn cancel_setup_installation() -> Result<(), String> {
    setup::cancel_current_installation()
}

/// 標記設置完成
#[tauri::command]
async fn mark_setup_complete() -> Result<(), String> {
    setup::save_setup_status(true).await
}

/// 重置設置狀態（用於調試）
#[tauri::command]
async fn reset_setup_status() -> Result<(), String> {
    setup::save_setup_status(false).await
}

// ========== Embedding 相關 Commands ==========

/// 加載 Embedding 模型
#[tauri::command]
async fn load_embedding_model(
    model_path: String,
    tokenizer_path: String,
) -> Result<String, String> {
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
    let service = service_guard
        .as_mut()
        .ok_or("Embedding 模型未加載".to_string())?;
    service
        .generate_embedding(&text)
        .map_err(|e| format!("生成 Embedding 失敗: {}", e))
}

/// 計算餘弦相似度
#[tauri::command]
async fn calculate_similarity(text_a: String, text_b: String) -> Result<f32, String> {
    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = service_guard
        .as_mut()
        .ok_or("Embedding 模型未加載".to_string())?;

    let emb_a = service
        .generate_embedding(&text_a)
        .map_err(|e| format!("生成 Embedding A 失敗: {}", e))?;
    let emb_b = service
        .generate_embedding(&text_b)
        .map_err(|e| format!("生成 Embedding B 失敗: {}", e))?;

    Ok(EmbeddingService::cosine_similarity(&emb_a, &emb_b))
}

#[cfg(feature = "candle-embed")]
#[tauri::command]
async fn download_embedding_model_cmd(
    _app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    use embedding::{download_embedding_model, EmbeddingModelConfig};
    use tauri::Emitter;

    // Get models directory using unified path
    let models_dir = paths::get_embedding_models_dir()?;

    // Create config for nomic-embed-text-v1 (recommended model)
    let config = EmbeddingModelConfig::nomic_embed(models_dir);

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

#[cfg(not(feature = "candle-embed"))]
#[tauri::command]
async fn download_embedding_model_cmd(
    _app: tauri::AppHandle,
    _window: tauri::Window,
) -> Result<(), String> {
    Err("Candle Embedding 功能未啟用。使用 --features candle-embed 重新編譯以啟用。".to_string())
}

fn get_app_data_dir_path() -> Result<std::path::PathBuf, String> {
    paths::get_app_data_dir()
}

#[tauri::command]
fn get_app_data_dir() -> Result<String, String> {
    paths::get_app_data_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_whisper_models_dir() -> Result<String, String> {
    paths::get_whisper_models_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_translation_models_dir() -> Result<String, String> {
    paths::get_translation_models_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_embedding_models_dir() -> Result<String, String> {
    paths::get_embedding_models_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_audio_dir() -> Result<String, String> {
    paths::get_audio_dir().map(|p| p.to_string_lossy().into_owned())
}

// ========== Storage Management Commands (Phase 3) ==========

/// Get storage usage for all app data
#[tauri::command]
fn get_storage_usage() -> Result<paths::StorageUsage, String> {
    paths::get_storage_usage()
}

/// Clear model cache for a specific model type
#[tauri::command]
async fn clear_model_cache(model_type: String) -> Result<String, String> {
    use std::fs;

    let dir = match model_type.as_str() {
        "translation" => paths::get_translation_models_dir()?,
        "whisper" => paths::get_whisper_models_dir()?,
        "embedding" => paths::get_embedding_models_dir()?,
        "all" => paths::get_models_dir()?,
        _ => return Err(format!("未知的模型類型: {}", model_type)),
    };

    if dir.exists() {
        let size_before = paths::get_storage_usage()?.models;
        fs::remove_dir_all(&dir).map_err(|e| format!("刪除失敗: {}", e))?;
        fs::create_dir_all(&dir).map_err(|e| format!("重建目錄失敗: {}", e))?;

        let freed_mb = size_before / 1_000_000;
        Ok(format!(
            "已清除 {} 模型快取，釋放 {} MB",
            model_type, freed_mb
        ))
    } else {
        Ok("目錄不存在，無需清除".to_string())
    }
}

/// Reset app to fresh state (delete all data except settings)
#[tauri::command]
async fn reset_app_data() -> Result<String, String> {
    use std::fs;

    // Clear models
    let models_dir = paths::get_models_dir()?;
    if models_dir.exists() {
        fs::remove_dir_all(&models_dir).map_err(|e| format!("刪除模型失敗: {}", e))?;
    }

    // Clear cache
    let cache_dir = paths::get_cache_dir()?;
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| format!("刪除快取失敗: {}", e))?;
    }

    // Re-initialize directories
    paths::init_app_dirs()?;

    Ok("應用已重置，請重新下載模型".to_string())
}

/// Completely uninstall app data (for complete removal)
#[tauri::command]
async fn uninstall_app_data() -> Result<String, String> {
    use std::fs;

    let app_dir = paths::get_app_data_dir()?;
    if app_dir.exists() {
        fs::remove_dir_all(&app_dir).map_err(|e| format!("刪除應用數據失敗: {}", e))?;
    }

    Ok("已完全刪除所有應用數據".to_string())
}

#[tauri::command]
async fn convert_to_pdf(file_path: String) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

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
        fs::create_dir_all(&documents_dir)
            .map_err(|e| format!("Failed to create documents dir: {}", e))?;
    }

    let file_stem = input_path
        .file_stem()
        .ok_or("Invalid filename")?
        .to_string_lossy();
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
                if let Ok(path) =
                    try_office_mac_conversion(&file_path, &output_pdf_path, "PowerPoint")
                {
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
fn try_keynote_conversion(
    input_path: &str,
    output_path: &std::path::Path,
) -> Result<String, String> {
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
fn try_office_mac_conversion(
    input_path: &str,
    output_path: &std::path::Path,
    app_name: &str,
) -> Result<String, String> {
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

fn convert_with_libreoffice(
    input_path: &str,
    output_path: &std::path::Path,
) -> Result<String, String> {
    use std::path::Path;
    use std::process::Command;

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
        .map_err(|e| {
            format!(
                "Failed to execute LibreOffice: {}. Please install LibreOffice.",
                e
            )
        })?;

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

    let max_wait = 120; // 60 seconds (120 * 500ms)
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

    let metadata = fs::metadata(path).map_err(|e| format!("Cannot read PDF: {}", e))?;

    if metadata.len() < 100 {
        return Err(format!("PDF too small ({} bytes)", metadata.len()));
    }

    let mut file = fs::File::open(path).map_err(|e| format!("Cannot open PDF: {}", e))?;
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

    let mut file = File::create(&path).map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(&data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

/// 開啟開發者工具 (Developer Mode)
#[tauri::command]
async fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
    Ok(())
}

/// 關閉開發者工具
#[tauri::command]
async fn close_devtools(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        window.close_devtools();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // DevTools 現在由前端控制，根據 developerMode 設定
            // 前端可透過 invoke 呼叫開啟
            // 不再自動開啟

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
            open_devtools,
            close_devtools,
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
            list_courses_sync, // Added
            delete_course,
            list_lectures_by_course,
            save_lecture,
            get_lecture,
            list_lectures,
            list_lectures_sync, // Added
            delete_lecture,
            update_lecture_status,
            save_subtitle,
            save_subtitles,
            get_subtitles,
            delete_subtitle,
            save_setting,
            get_setting,
            get_all_settings,
            register_local_user,
            check_local_user,
            save_note,
            get_note,
            write_text_file,
            read_text_file,
            read_binary_file,
            // 首次運行設置相關
            check_setup_status,
            is_setup_complete,
            start_setup_installation,
            cancel_setup_installation,
            mark_setup_complete,
            reset_setup_status,
            // CTranslate2 翻譯相關
            load_ct2_model,
            is_ct2_loaded,
            translate_ct2,
            translate_ct2_batch,
            // Embedding 相關
            load_embedding_model,
            generate_embedding,
            calculate_similarity,
            download_embedding_model_cmd,
            // 文檔轉換相關
            convert_to_pdf,
            get_temp_dir,
            get_app_data_dir,
            get_whisper_models_dir,
            get_translation_models_dir,
            get_embedding_models_dir,
            write_temp_file,
            // 儲存管理相關 (Phase 3)
            get_storage_usage,
            clear_model_cache,
            reset_app_data,
            // Sync 相關
            sync::upload_file,
            sync::download_file,
            write_binary_file,
            get_audio_dir,
            try_recover_audio_path,
            // Offline Queue
            add_pending_action,
            list_pending_actions,
            update_pending_action,
            remove_pending_action,
            // Trash Bin
            list_deleted_courses,
            list_deleted_lectures,
            restore_course,
            restore_lecture,
            purge_course,
            purge_lecture,
            // Sync Extensions (New)
            delete_subtitles_by_lecture,
            get_all_chat_sessions,
            save_chat_session,
            get_all_chat_messages,
            save_chat_message,
            delete_chat_messages_by_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 嘗試恢復丟失的 audio_path
#[tauri::command]
async fn try_recover_audio_path(lecture_id: String) -> Result<Option<String>, String> {
    use std::fs;
    
    // 1. 檢查 DB 中是否確實缺失
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("DB Error: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("DB Connection Error: {}", e))?;
    
    let lecture_opt = db.get_lecture(&lecture_id).map_err(|e| format!("Get Lecture Error: {}", e))?;
    
    if let Some(lecture) = lecture_opt {
        if let Some(path) = lecture.audio_path {
            if !path.is_empty() {
                return Ok(Some(path)); // 已存在，直接返回
            }
        }
    } else {
        return Ok(None); // Lecture 不存在
    }

    // 2. 掃描目錄
    let audio_dir = paths::get_audio_dir().map_err(|e| format!("Path Error: {}", e))?;
    if !audio_dir.exists() {
        return Ok(None);
    }

    let prefix = format!("lecture_{}_", lecture_id);
    let mut found_path: Option<std::path::PathBuf> = None;

    if let Ok(entries) = fs::read_dir(&audio_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with(&prefix) && name.ends_with(".wav") {
                        found_path = Some(path);
                        break; // 找到一個即可（通常只有一個，或者取最新的）
                    }
                }
            }
        }
    }

    // 3. 更新 DB
    if let Some(path) = found_path {
        let path_str = path.to_string_lossy().to_string();
        println!("[Recovery] 找到丟失的音頻文件: {}", path_str);
        
        // 我們需要一個更新 audio_path 的方法，或者直接用 save_lecture
        // 由於我們剛才更新了 save_lecture 支持 audio_path，重新保存一次即可
        // 但需要先獲取完整 lecture 對象
        if let Some(mut lecture) = db.get_lecture(&lecture_id).unwrap_or(None) {
            lecture.audio_path = Some(path_str.clone());
            // 更新狀態為 completed 如果是 recording
            if lecture.status == "recording" {
                lecture.status = "completed".to_string();
            }
            // Fetch user_id from course
            let user_id = if let Some(course) = db.get_course(&lecture.course_id).unwrap_or(None) {
                course.user_id
            } else {
                "default_user".to_string() // Should not happen if foreign keys are enforced, but safe fallback
            };
            
            db.save_lecture(&lecture, &user_id).map_err(|e| format!("Update DB Error: {}", e))?;
            return Ok(Some(path_str));
        }
    }

    Ok(None)
}

// ========== Offline Queue Commands ==========

#[tauri::command]
async fn add_pending_action(id: String, action_type: String, payload: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.add_pending_action(&id, &action_type, &payload)
        .map_err(|e| format!("新增待處理動作失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn list_pending_actions() -> Result<Vec<(String, String, String, String, i32)>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.list_pending_actions()
        .map_err(|e| format!("列出待處理動作失敗: {}", e))
}

#[tauri::command]
async fn update_pending_action(id: String, status: String, retry_count: i32) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.update_pending_action(&id, &status, retry_count)
        .map_err(|e| format!("更新待處理動作失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn remove_pending_action(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.remove_pending_action(&id)
        .map_err(|e| format!("移除待處理動作失敗: {}", e))?;
    Ok(())
}

// ========== Trash Bin Commands ==========

#[tauri::command]
async fn list_deleted_courses(user_id: String) -> Result<Vec<storage::models::Course>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.list_deleted_courses(&user_id)
        .map_err(|e| format!("列出已刪除課程失敗: {}", e))
}

#[tauri::command]
async fn list_deleted_lectures(user_id: String) -> Result<Vec<storage::models::Lecture>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.list_deleted_lectures(&user_id)
        .map_err(|e| format!("列出已刪除課堂失敗: {}", e))
}

#[tauri::command]
async fn restore_course(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.restore_course(&id)
        .map_err(|e| format!("還原課程失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn restore_lecture(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.restore_lecture(&id)
        .map_err(|e| format!("還原課堂失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn purge_course(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.purge_course(&id)
        .map_err(|e| format!("永久刪除課程失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn purge_lecture(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.purge_lecture(&id)
        .map_err(|e| format!("永久刪除課堂失敗: {}", e))?;
    Ok(())
}

// ========== Sync 相關 Commands ==========

#[tauri::command]
async fn delete_subtitles_by_lecture(lecture_id: String) -> Result<usize, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.delete_subtitles_by_lecture(&lecture_id)
        .map_err(|e| format!("刪除字幕失敗: {}", e))
}

#[tauri::command]
async fn get_all_chat_sessions(user_id: String) -> Result<Vec<(String, Option<String>, String, String, Option<String>, String, String, bool)>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.get_all_chat_sessions(&user_id)
        .map_err(|e| format!("獲取聊天會話失敗: {}", e))
}

#[tauri::command]
async fn save_chat_session(
    id: String,
    lecture_id: Option<String>,
    user_id: String,
    title: String,
    summary: Option<String>,
    created_at: String,
    updated_at: String,
    is_deleted: bool,
) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.save_chat_session(
        &id,
        lecture_id.as_deref(),
        &user_id,
        &title,
        summary.as_deref(),
        &created_at,
        &updated_at,
        is_deleted,
    )
    .map_err(|e| format!("保存聊天會話失敗: {}", e))
}

#[tauri::command]
async fn get_all_chat_messages(user_id: String) -> Result<Vec<(String, String, String, String, Option<String>, String)>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.get_all_chat_messages(&user_id)
        .map_err(|e| format!("獲取聊天訊息失敗: {}", e))
}

#[tauri::command]
async fn save_chat_message(
    id: String,
    session_id: String,
    role: String,
    content: String,
    sources: Option<String>,
    timestamp: String,
) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.save_chat_message(
        &id,
        &session_id,
        &role,
        &content,
        sources.as_deref(),
        &timestamp,
    )
    .map_err(|e| format!("保存聊天訊息失敗: {}", e))
}

#[tauri::command]
async fn delete_chat_messages_by_session(session_id: String) -> Result<usize, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.delete_chat_messages_by_session(&session_id)
        .map_err(|e| format!("刪除聊天訊息失敗: {}", e))
}
