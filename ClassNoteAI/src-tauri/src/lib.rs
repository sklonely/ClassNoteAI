// ASR (v2.1 in-process Nemotron streaming via parakeet-rs) + legacy
// whisper module (downloader only — Whisper-rs ASR was deleted in v2).
// `pub` on `asr` so eval harnesses (examples/nemotron_eval.rs) can
// reach `parakeet_model::Variant` for the INT8/FP32 bake-off.
pub mod asr;
mod whisper;
// 工具模塊
// `pub` so example binaries (e.g. `examples/ort_minimal.rs`) can call
// `utils::onnx::init_onnx` and exercise the same Windows DLL-search
// fix the main app uses, instead of duplicating the wiring.
pub mod utils;
// 翻譯模塊
pub mod translation; // 公開以便測試使用
                     // 數據存儲模塊
pub mod storage; // 公開以便測試使用
                 // VAD 模塊
pub mod vad; // pub so eval harnesses (examples/phase2_vad_eval.rs) can A/B it
// Embedding 模塊
mod embedding;
// 首次運行設置模塊
mod setup;
// 統一路徑管理模塊
pub mod paths;
// 統一下載管理模塊
pub mod diagnostics;
pub mod downloads;
// 同步模塊
// Localhost OAuth callback listener (for ChatGPT OAuth sign-in)
mod oauth;
// Crash-safe recording — incremental PCM persistence + orphan recovery
pub mod recording;
// GPU backend detection (CUDA via nvidia-smi, Metal via cfg, Vulkan via filesystem)
mod gpu;
mod updater;
// Pre-WebView2 experimental toggles (remote debug port, etc). Public
// so `main()` can `remote_debug_enabled()` before Tauri spins up.
pub mod dev_flags;

use embedding::EmbeddingService;
use log::LevelFilter;
use tauri::{Emitter, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tokio::sync::Mutex;
// 全局 Embedding 服務實例
static EMBEDDING_SERVICE: Mutex<Option<EmbeddingService>> = Mutex::const_new(None);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Stub kept for renderer compatibility — v2 does not use a persistent
/// Whisper model slot. The Parakeet engine manages its own model load
/// lazily on first session. Returns success so any UI that still gates
/// on this in legacy code paths doesn't error.
#[tauri::command]
async fn load_whisper_model(_model_path: String) -> Result<String, String> {
    Ok("Whisper backend removed in v2 streaming refactor; ASR is now in-process Nemotron".to_string())
}

/// Detect speech segments. Phase 2 of the v0.6.5 speech-pipeline plan
/// routes this through [`vad::detect_speech_segments_adaptive`], which
/// prefers Silero VAD v5 when it's initialised and falls back to the
/// legacy energy VAD otherwise. The `energy_*` params remain effective
/// for the fallback path; the Silero path uses its own thresholds
/// (`vad::silero::DEFAULT_*`).
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

    // Route through the adaptive dispatcher. When Silero is up, `backend`
    // reports `Silero`; otherwise `Energy`. We log the tag so users
    // reporting odd chunking in diagnostics bundles can see which path
    // their recording went through.
    let (mut segments, backend) = vad::detect_speech_segments_adaptive(&audio_data, Some(config.clone()));
    if matches!(backend, vad::VadBackend::Energy) {
        // Legacy post-processing — Silero already enforces min duration
        // and doesn't need a hard max-duration chop (captured segments
        // stay under the Whisper 30 s window via MIN_SILENCE_MS merging).
        let detector = VadDetector::new(config);
        segments = detector.enforce_max_duration(segments);
        segments = detector.filter_short_segments(segments);
    }

    Ok(segments)
}

/// Stub kept for renderer compatibility — `transcribe_audio` was the
/// in-process Whisper batch entry point; v2.1 routes all ASR through
/// the in-process Nemotron engine (see `crate::asr::parakeet_engine`).
/// Renderer code that called this directly should be migrated to push
/// audio chunks via `asr_push_audio` and listen for `asr-text` events.
#[tauri::command]
async fn transcribe_audio(
    _audio_data: Vec<i16>,
    _sample_rate: u32,
    _initial_prompt: Option<String>,
    _language: Option<String>,
) -> Result<serde_json::Value, String> {
    Err(
        "transcribe_audio (Whisper) was removed in the v2 streaming \
         refactor. Use the in-process Nemotron engine via \
         asr_start_session / asr_push_audio / asr_end_session instead."
            .to_string(),
    )
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
        "large-v3-turbo-q5" => download::get_large_v3_turbo_quantized_model_config(output_path),
        _ => return Err(format!("不支持的模型類型: {}。支持的類型: tiny, base, small, medium, large, small-q5, medium-q5, large-v3-turbo-q5", model_type)),
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
        } else if file_name.contains("large-v3-turbo-q5") {
            Some(574_000_000) // Large v3 turbo Q5 ~574MB
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

/// 粗翻譯（本地 CT2 / TranslateGemma LLM / Google API）
#[tauri::command]
async fn translate_rough(
    text: String,
    source_lang: String,
    target_lang: String,
    provider: Option<String>,       // "local" / "gemma" / "google"
    google_api_key: Option<String>, // Google API 密鑰（可選，僅 google provider 使用）
    gemma_endpoint: Option<String>, // llama-server URL（可選，僅 gemma provider 使用）
) -> Result<translation::TranslationResult, String> {
    // Default fallback differs by build: if `nmt-local` is compiled in we
    // honor the historical `local` default; otherwise default to `gemma`
    // (the only on-device backend available without the CT2 feature).
    #[cfg(feature = "nmt-local")]
    let default_provider = "local";
    #[cfg(not(feature = "nmt-local"))]
    let default_provider = "gemma";
    let provider = provider.as_deref().unwrap_or(default_provider);

    match provider {
        "google" => translation::google::translate_with_google(
            &text,
            &source_lang,
            &target_lang,
            google_api_key.as_deref(),
        )
        .await
        .map_err(|e| e.to_string()),
        "gemma" => {
            // gemma_endpoint == None → translate() falls back to DEFAULT_ENDPOINT
            translation::gemma::translate(&text, gemma_endpoint.as_deref())
                .await
                .map_err(|e| e.to_string())
        }
        #[cfg(feature = "nmt-local")]
        "local" => translation::rough::translate_rough(&text, &source_lang, &target_lang)
            .await
            .map_err(|e| e.to_string()),
        // When `nmt-local` is off and the user picked the local backend
        // anyway (e.g. legacy settings), surface a clear error rather than
        // silently falling back to a different language model.
        #[cfg(not(feature = "nmt-local"))]
        "local" => Err(
            "Local CTranslate2 backend not available in this build. \
             Switch to TranslateGemma (gemma) or Google in 設定 → 翻譯，\
             or rebuild with `--features nmt-local`."
                .to_string(),
        ),
        other => Err(format!("Unknown translation provider: {other}")),
    }
}

/// Build-time feature flags exposed to the renderer. Used by the UI to
/// hide unavailable provider options (e.g. don't show "本地 ONNX" in a
/// dev build that compiled without `nmt-local`) and to migrate stale
/// settings on first launch (e.g. provider="local" → "gemma" when local
/// CT2 isn't compiled in).
#[tauri::command]
fn get_build_features() -> serde_json::Value {
    serde_json::json!({
        "nmt_local": cfg!(feature = "nmt-local"),
        "gpu_cuda": cfg!(feature = "gpu-cuda"),
        "gpu_metal": cfg!(feature = "gpu-metal"),
        "gpu_vulkan": cfg!(feature = "gpu-vulkan"),
    })
}

/// Probe the TranslateGemma sidecar's `/health` endpoint so the UI can
/// show a green/red indicator without trying a full translation request.
#[tauri::command]
async fn check_gemma_server(endpoint: Option<String>) -> Result<bool, String> {
    let base = endpoint
        .as_deref()
        .unwrap_or(translation::gemma::DEFAULT_ENDPOINT);
    let url = format!("{}/health", base.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    match client.get(&url).send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Bring up the TranslateGemma sidecar — spawn `llama-server.exe` if it's
/// not already serving `model_path` on `port`. Returns the bring-up
/// outcome so the UI can distinguish "spawned" vs "already there" vs the
/// failure modes (binary missing / spawn failed / health timeout).
///
/// `port` defaults to [`translation::gemma_sidecar::DEFAULT_PORT`].
#[tauri::command]
async fn start_gemma_sidecar(
    model_path: String,
    port: Option<u16>,
    app: tauri::AppHandle,
) -> Result<translation::gemma_sidecar::BringUpResult, String> {
    let resource_dir = app.path().resource_dir().ok();
    let port = port.unwrap_or(translation::gemma_sidecar::DEFAULT_PORT);
    Ok(translation::gemma_sidecar::ensure_running(&model_path, port, resource_dir).await)
}

/// Stop the supervised sidecar (no-op if we never spawned one). Used when
/// the user switches away from gemma in settings, or when the renderer
/// wants to free the GPU for another task.
#[tauri::command]
fn stop_gemma_sidecar() -> Result<(), String> {
    translation::gemma_sidecar::shutdown();
    Ok(())
}

/// Locate the llama-server binary that would be used by `start_gemma_sidecar`,
/// without spawning. Lets the Settings UI show "binary missing — please
/// install / wait for download" before the user tries to start it.
#[tauri::command]
fn locate_gemma_binary(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let resource_dir = app.path().resource_dir().ok();
    Ok(translation::gemma_sidecar::locate_binary(resource_dir.as_ref())
        .map(|p| p.to_string_lossy().to_string()))
}

// ========== Parakeet (Nemotron) ASR Engine Commands ==========
//
// In-process Nemotron streaming via parakeet-rs (v2.1). Replaces the
// HTTP/SSE Python sidecar. The engine lives in `crate::asr::parakeet_engine`
// — a single global model with one active session at a time. Two
// quantization variants ship side-by-side (INT8 ~852 MB default,
// FP32 ~2.5 GB power-user). Each variant lives in its own subdir
// under `{app_data}/models/parakeet-nemotron-{int8|fp32}/`.

use crate::asr::parakeet_model::Variant;

/// Per-variant download / presence snapshot.
#[derive(serde::Serialize)]
struct VariantStatus {
    variant: Variant,
    /// Are all required files present at the right size?
    present: bool,
    /// Bytes already on disk (resume-aware — partial files count up
    /// to their target size, never more).
    bytes_on_disk: u64,
    /// Bytes a fully downloaded variant occupies.
    total_size: u64,
    /// Resolved model directory (display only).
    model_dir: Option<String>,
}

#[derive(serde::Serialize)]
struct ParakeetStatus {
    /// Per-variant download state.
    variants: Vec<VariantStatus>,
    /// Which variant (if any) is currently loaded into RAM.
    loaded_variant: Option<Variant>,
    /// Convenience: same as `loaded_variant.is_some()`.
    model_loaded: bool,
    /// Is there an active session right now?
    session_active: bool,
}

fn variant_from_str(s: &str) -> Result<Variant, String> {
    match s.to_lowercase().as_str() {
        "int8" => Ok(Variant::Int8),
        "fp32" => Ok(Variant::Fp32),
        other => Err(format!("unknown variant: {other} (expected int8|fp32)")),
    }
}

#[tauri::command]
fn get_parakeet_status() -> Result<ParakeetStatus, String> {
    let variants = Variant::all()
        .iter()
        .map(|&v| VariantStatus {
            variant: v,
            present: asr::parakeet_model::is_present(v),
            bytes_on_disk: asr::parakeet_model::bytes_on_disk(v),
            total_size: asr::parakeet_model::total_size(v),
            model_dir: asr::parakeet_model::model_dir(v)
                .map(|p| p.to_string_lossy().to_string())
                .ok(),
        })
        .collect();
    Ok(ParakeetStatus {
        variants,
        loaded_variant: asr::parakeet_engine::loaded_variant(),
        model_loaded: asr::parakeet_engine::is_loaded(),
        session_active: asr::parakeet_engine::has_session(),
    })
}

/// Per-file download progress emitted on `parakeet-download-progress`.
#[derive(Clone, serde::Serialize)]
struct ParakeetDownloadProgress {
    variant: Variant,
    file_index: usize,
    file_name: String,
    file_size: u64,
    file_downloaded: u64,
    total_size: u64,
    completed: bool,
}

/// Download one variant's files in sequence (sequential beats parallel
/// here — same HF host, single rate limit, and the per-file progress
/// bar is easier to read). Resume-friendly: complete files are
/// skipped, partial files continue via HTTP Range.
#[tauri::command]
async fn parakeet_download_model(
    app: tauri::AppHandle,
    variant: String,
) -> Result<String, String> {
    use tauri::Emitter as _;

    let variant = variant_from_str(&variant)?;
    let configs = asr::parakeet_model::all_download_configs(variant)?;
    let total = asr::parakeet_model::total_size(variant);

    let _ = app.emit("parakeet-download-started", (variant, total));

    for (idx, config) in configs.iter().enumerate() {
        let file_name = config
            .output_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "<unknown>".to_string());
        let file_size = config.expected_size.unwrap_or(0);

        let app_for_callback = app.clone();
        let file_name_for_cb = file_name.clone();

        let cb: Box<dyn Fn(u64, u64) + Send + Sync> = Box::new(move |downloaded, _file_total| {
            let _ = app_for_callback.emit(
                "parakeet-download-progress",
                ParakeetDownloadProgress {
                    variant,
                    file_index: idx,
                    file_name: file_name_for_cb.clone(),
                    file_size,
                    file_downloaded: downloaded,
                    total_size: total,
                    completed: false,
                },
            );
        });

        whisper::download::download_model(config, Some(cb))
            .await
            .map_err(|e| format!("download {} ({}) failed: {}", file_name, variant.label(), e))?;

        let _ = app.emit(
            "parakeet-download-progress",
            ParakeetDownloadProgress {
                variant,
                file_index: idx,
                file_name: file_name.clone(),
                file_size,
                file_downloaded: file_size,
                total_size: total,
                completed: true,
            },
        );
    }

    let _ = app.emit("parakeet-download-completed", (variant, total));
    Ok(format!(
        "downloaded {} files for {} ({:.2} GB)",
        configs.len(),
        variant.label(),
        total as f64 / 1e9
    ))
}

/// Load (or swap) the Nemotron model. Different variant than what's
/// currently loaded → drops the existing one first.
#[tauri::command]
async fn parakeet_load_model(variant: String) -> Result<(), String> {
    let variant = variant_from_str(&variant)?;
    if !asr::parakeet_model::is_present(variant) {
        return Err(format!(
            "Nemotron {} model files not on disk. Download first.",
            variant.label()
        ));
    }
    let dir = asr::parakeet_model::model_dir(variant)?;
    tokio::task::spawn_blocking(move || asr::parakeet_engine::ensure_loaded(variant, &dir))
        .await
        .map_err(|e| format!("load_model task join error: {e}"))?
}

#[tauri::command]
async fn parakeet_unload_model() -> Result<(), String> {
    tokio::task::spawn_blocking(asr::parakeet_engine::unload)
        .await
        .map_err(|e| format!("unload_model task join error: {e}"))
}

/// Begin an ASR session. Auto-loads the first available variant
/// (INT8 wins over FP32 if both are present) if nothing is in RAM yet.
#[tauri::command]
async fn asr_start_session(session_id: String) -> Result<(), String> {
    if !asr::parakeet_engine::is_loaded() {
        let variant = asr::parakeet_model::first_present().ok_or_else(|| {
            "No Nemotron model downloaded — open 設定 → 本地轉錄 to download.".to_string()
        })?;
        let dir = asr::parakeet_model::model_dir(variant)?;
        tokio::task::spawn_blocking(move || asr::parakeet_engine::ensure_loaded(variant, &dir))
            .await
            .map_err(|e| format!("auto-load task join error: {e}"))??;
    }
    let id = session_id.clone();
    tokio::task::spawn_blocking(move || asr::parakeet_engine::start_session(id))
        .await
        .map_err(|e| format!("start_session task join error: {e}"))?
}

/// Push int16 PCM. Drains pending chunks through the model and emits
/// one `asr-text` Tauri event per non-empty delta. The renderer turns
/// each delta into word events for `SentenceAccumulator`.
#[derive(Clone, serde::Serialize)]
struct AsrTextEvent {
    session_id: String,
    delta: String,
    transcript: String,
    audio_end_sec: f32,
}

#[tauri::command]
async fn asr_push_audio(
    app: tauri::AppHandle,
    session_id: String,
    pcm: Vec<i16>,
) -> Result<(), String> {
    use tauri::Emitter as _;
    let sid_for_engine = session_id.clone();
    let sid_for_event = session_id.clone();
    tokio::task::spawn_blocking(move || {
        // Buffer deltas inside the engine call so we don't hold the
        // engine Mutex across `app.emit` (which can do non-trivial
        // work serializing JSON for every webview window).
        let mut deltas: Vec<(String, String, f32)> = Vec::new();
        let res = asr::parakeet_engine::push_pcm_i16(
            &sid_for_engine,
            &pcm,
            |delta, transcript, audio_end_sec| {
                deltas.push((delta.to_string(), transcript.to_string(), audio_end_sec));
            },
        );
        for (delta, transcript, audio_end_sec) in deltas {
            let _ = app.emit(
                "asr-text",
                AsrTextEvent {
                    session_id: sid_for_event.clone(),
                    delta,
                    transcript,
                    audio_end_sec,
                },
            );
        }
        res
    })
    .await
    .map_err(|e| format!("push_audio task join error: {e}"))?
}

/// End the session. Pads + flushes the decoder, returns the cumulative
/// transcript, emits one final `asr-text` for any tail-end delta, and
/// emits an `asr-session-ended` event with the final transcript so the
/// renderer can show the complete text without re-accumulating from
/// the streaming events.
#[derive(Clone, serde::Serialize)]
struct AsrSessionEndedEvent {
    session_id: String,
    transcript: String,
}

#[tauri::command]
async fn asr_end_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<String, String> {
    use tauri::Emitter as _;
    let sid_for_engine = session_id.clone();
    let sid_for_event = session_id.clone();
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut deltas: Vec<(String, String, f32)> = Vec::new();
        let transcript = asr::parakeet_engine::end_session(
            &sid_for_engine,
            |delta, transcript, audio_end_sec| {
                deltas.push((delta.to_string(), transcript.to_string(), audio_end_sec));
            },
        )?;
        for (delta, transcript, audio_end_sec) in deltas {
            let _ = app_clone.emit(
                "asr-text",
                AsrTextEvent {
                    session_id: sid_for_event.clone(),
                    delta,
                    transcript,
                    audio_end_sec,
                },
            );
        }
        let _ = app_clone.emit(
            "asr-session-ended",
            AsrSessionEndedEvent {
                session_id: sid_for_event.clone(),
                transcript: transcript.clone(),
            },
        );
        Ok::<String, String>(transcript)
    })
    .await
    .map_err(|e| format!("end_session task join error: {e}"))?
}

/// Combined status snapshot for the TranslateGemma backend. Single round
/// trip for the Settings UI's "is everything wired up?" indicator.
#[derive(serde::Serialize)]
struct GemmaStatus {
    /// llama-server binary discovered (bundled / dev / PATH).
    binary_path: Option<String>,
    /// Absolute path the GGUF model would live at on this machine.
    model_path: String,
    /// `true` when the model file exists at the expected size.
    model_present: bool,
    /// Approximate full size in bytes — frontend uses this to render the
    /// download dialog "you'll download X.X GB".
    model_size_bytes: u64,
    /// HuggingFace URL we'd download from. Surfaced for transparency
    /// (some users/networks block HF; they need to know).
    model_url: String,
    /// `true` when our supervised sidecar is currently running. Doesn't
    /// HTTP-probe — for that, call `check_gemma_server`.
    sidecar_running: bool,
}

#[tauri::command]
fn get_gemma_status(app: tauri::AppHandle) -> Result<GemmaStatus, String> {
    let resource_dir = app.path().resource_dir().ok();
    Ok(GemmaStatus {
        binary_path: translation::gemma_sidecar::locate_binary(resource_dir.as_ref())
            .map(|p| p.to_string_lossy().to_string()),
        model_path: translation::gemma_model::target_path()?
            .to_string_lossy()
            .to_string(),
        model_present: translation::gemma_model::is_present(),
        model_size_bytes: translation::gemma_model::EXPECTED_SIZE,
        model_url: translation::gemma_model::MODEL_URL.to_string(),
        sidecar_running: translation::gemma_sidecar::is_running(),
    })
}

/// Download the TranslateGemma 4B Q4_K_M GGUF model file (≈ 2.5 GB).
///
/// Resume-friendly: a partial file from a previous interrupted download
/// is detected and continued (driven by `whisper::download::download_model`).
/// Emits `gemma-download-progress` events with `{downloaded, total, percent,
/// speed_mbps, eta_seconds}` for the renderer's progress bar.
///
/// Returns the absolute path to the downloaded file on success.
#[tauri::command]
async fn download_gemma_model(app: tauri::AppHandle) -> Result<String, String> {
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    use tauri::Emitter;

    use whisper::download;

    let config = translation::gemma_model::download_config()?;

    // Fast path: already complete.
    if translation::gemma_model::is_present() {
        return Ok(config.output_path.to_string_lossy().to_string());
    }

    // Mirror the Whisper progress callback shape so the front-end can reuse
    // the same DownloadProgress type. Emits at most ~2x/s based on the
    // 500 ms speed-window throttle in the closure below.
    let app_clone = app.clone();
    let last_time = Arc::new(Mutex::new(Instant::now()));
    let last_downloaded = Arc::new(Mutex::new(0u64));

    let progress_callback: Option<Box<dyn Fn(u64, u64) + Send + Sync>> = Some(Box::new({
        let app_clone = app_clone.clone();
        let last_time = last_time.clone();
        let last_downloaded = last_downloaded.clone();
        move |downloaded, total| {
            let now = Instant::now();
            let mut lt = last_time.lock().unwrap();
            let mut ld = last_downloaded.lock().unwrap();
            let elapsed = now.duration_since(*lt);
            let bytes = downloaded.saturating_sub(*ld);

            let speed_mbps = if elapsed.as_millis() >= 500 && elapsed.as_millis() > 0 {
                let bps = bytes as f64 / elapsed.as_millis() as f64 * 1000.0;
                bps / 1_000_000.0
            } else {
                0.0
            };
            let remaining = total.saturating_sub(downloaded);
            let eta_seconds = if speed_mbps > 0.0 && remaining > 0 {
                Some((remaining as f64 / (speed_mbps * 1_000_000.0)) as u64)
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
            let _ = app_clone.emit("gemma-download-progress", &progress);

            // Only refresh the throttle baseline when we actually emitted
            // a "speed" reading — otherwise short bursts get averaged out
            // to ~0 every event.
            if elapsed.as_millis() >= 500 {
                *lt = now;
                *ld = downloaded;
            }
        }
    }));

    let path = download::download_model(&config, progress_callback)
        .await
        .map_err(|e| format!("Gemma 模型下載失敗: {e}"))?;

    Ok(path.to_string_lossy().to_string())
}

// Fine translation + remote service check were removed in v0.5.0.
// Fine translation will be re-implemented via LLMProvider (GitHub Models,
// OpenAI Platform, Anthropic) in a later PR. The legacy ClassNoteServer
// is archived at tag server-archive-v0.4.0.

// ========== CTranslate2 翻譯相關 Commands ==========
// Bodies are gated by the `nmt-local` feature. When off, the commands
// still exist (so `generate_handler!` compiles unchanged) but return
// an explanatory error — the front-end handles this via provider check.

const NMT_LOCAL_DISABLED: &str =
    "Local CT2 translation backend not compiled into this build. \
     Switch to the gemma provider, or rebuild with `--features nmt-local`.";

/// 載入 CTranslate2 翻譯模型
#[tauri::command]
async fn load_ct2_model(model_path: String) -> Result<(), String> {
    #[cfg(feature = "nmt-local")]
    {
        translation::ctranslate2::load_ct2_model(&model_path).await
    }
    #[cfg(not(feature = "nmt-local"))]
    {
        let _ = model_path;
        Err(NMT_LOCAL_DISABLED.to_string())
    }
}

/// 檢查 CTranslate2 模型是否已載入
#[tauri::command]
async fn is_ct2_loaded() -> bool {
    #[cfg(feature = "nmt-local")]
    {
        translation::ctranslate2::is_ct2_loaded().await
    }
    #[cfg(not(feature = "nmt-local"))]
    {
        false
    }
}

/// 使用 CTranslate2 進行翻譯
#[tauri::command]
async fn translate_ct2(text: String) -> Result<String, String> {
    #[cfg(feature = "nmt-local")]
    {
        translation::ctranslate2::translate_ct2(&text).await
    }
    #[cfg(not(feature = "nmt-local"))]
    {
        let _ = text;
        Err(NMT_LOCAL_DISABLED.to_string())
    }
}

/// 使用 CTranslate2 進行批量翻譯
#[tauri::command]
async fn translate_ct2_batch(texts: Vec<String>) -> Result<Vec<String>, String> {
    #[cfg(feature = "nmt-local")]
    {
        translation::ctranslate2::translate_ct2_batch(&texts).await
    }
    #[cfg(not(feature = "nmt-local"))]
    {
        let _ = texts;
        Err(NMT_LOCAL_DISABLED.to_string())
    }
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
    #[cfg(not(feature = "nmt-local"))]
    {
        let _ = model_dir;
        return Err(NMT_LOCAL_DISABLED.to_string());
    }
    #[cfg(feature = "nmt-local")]
    {
        use std::path::Path;
        let path = Path::new(&model_dir);
        let model_bin_path = path.join("model.bin");
        if !model_bin_path.exists() {
            return Err(format!("CT2 模型文件不存在: {:?}", model_bin_path));
        }
        translation::ctranslate2::load_ct2_model(&model_dir).await?;
        Ok("CTranslate2 翻譯模型加載成功".to_string())
    }
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
#[cfg(feature = "nmt-local")]
async fn load_translation_model_by_name_impl(model_name: String) -> Result<String, String> {
    // 使用統一路徑: {app_data}/models/translation/{model_name}/
    let translation_dir = paths::get_translation_models_dir()?;
    let model_dir = translation_dir.join(&model_name);

    println!("[TranslationModel] 嘗試加載模型: {:?}", model_dir);

    if !model_dir.exists() {
        return Err(format!("模型目錄不存在: {:?}", model_dir));
    }

    // 檢查 CT2 模型文件 (model.bin).
    //
    // Some older app builds / manual extracts left the model files
    // one directory deeper than expected:
    //     .../m2m100-418M-ct2-int8/m2m100-418M-ct2-int8/model.bin
    // instead of the flat layout this command expects:
    //     .../m2m100-418M-ct2-int8/model.bin
    // The current downloader strips the top-level dir correctly, so
    // fresh installs don't hit this — but users migrating from older
    // versions do, and the error ("CT2 模型文件不存在") is opaque. We
    // self-heal on first load: if outer model.bin is missing but a
    // nested `{model_name}/model.bin` exists under the same root,
    // flatten it by moving every entry up one level. One-shot;
    // subsequent loads hit the check_path fast path.
    let model_bin_path = model_dir.join("model.bin");
    if !model_bin_path.exists() {
        let nested_dir = model_dir.join(&model_name);
        let nested_bin = nested_dir.join("model.bin");
        if nested_bin.exists() {
            println!(
                "[TranslationModel] 偵測到巢狀模型目錄，自動 flatten: {:?} -> {:?}",
                nested_dir, model_dir
            );
            match std::fs::read_dir(&nested_dir) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        let from = entry.path();
                        let to = model_dir.join(entry.file_name());
                        if let Err(e) = std::fs::rename(&from, &to) {
                            return Err(format!(
                                "自動 flatten 失敗 ({} → {}): {}",
                                from.display(),
                                to.display(),
                                e
                            ));
                        }
                    }
                    // Now the inner dir should be empty — remove it.
                    let _ = std::fs::remove_dir(&nested_dir);
                }
                Err(e) => {
                    return Err(format!("讀取巢狀目錄失敗 {:?}: {}", nested_dir, e));
                }
            }
        }
    }
    if !model_bin_path.exists() {
        return Err(format!("CT2 模型文件不存在: {:?}", model_bin_path));
    }

    // 使用 CTranslate2 加載模型
    let model_path_str = model_dir.to_string_lossy().to_string();
    translation::ctranslate2::load_ct2_model(&model_path_str).await?;

    let message = format!("CTranslate2 翻譯模型 '{}' 加載成功", model_name);
    Ok(message)
}

/// Wrapper that exposes `load_translation_model_by_name` regardless of
/// whether the `nmt-local` feature is enabled. With the feature off it
/// returns a descriptive error so the renderer can guide the user to a
/// supported provider rather than seeing a generic "command not found".
#[tauri::command]
async fn load_translation_model_by_name(model_name: String) -> Result<String, String> {
    #[cfg(feature = "nmt-local")]
    {
        load_translation_model_by_name_impl(model_name).await
    }
    #[cfg(not(feature = "nmt-local"))]
    {
        let _ = model_name;
        Err(NMT_LOCAL_DISABLED.to_string())
    }
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
async fn list_lectures_by_course(
    course_id: String,
    user_id: String,
) -> Result<Vec<storage::Lecture>, String> {
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

/// List lectures still marked 'recording' — crash-recovery boot entry point.
/// Returned rows should be cross-referenced with `find_orphaned_recordings`
/// (the on-disk side) to decide whether audio is recoverable.
#[tauri::command]
async fn list_orphaned_recording_lectures() -> Result<Vec<storage::Lecture>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;

    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;

    db.list_orphaned_recording_lectures()
        .map_err(|e| format!("查詢 orphan lectures 失敗: {}", e))
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

// ===== Embeddings (local RAG store) =====

#[derive(serde::Deserialize)]
pub struct EmbeddingInput {
    pub id: String,
    pub lecture_id: String,
    pub chunk_text: String,
    pub embedding: Vec<f32>,
    pub source_type: String,
    pub position: i64,
    pub page_number: Option<i64>,
    pub created_at: String,
}

#[tauri::command]
async fn save_embedding(input: EmbeddingInput) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    db.save_embedding(
        &input.id,
        &input.lecture_id,
        &input.chunk_text,
        &input.embedding,
        &input.source_type,
        input.position,
        input.page_number,
        &input.created_at,
    )
    .map_err(|e| format!("save embedding: {}", e))
}

#[tauri::command]
async fn save_embeddings(inputs: Vec<EmbeddingInput>) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    for input in inputs {
        db.save_embedding(
            &input.id,
            &input.lecture_id,
            &input.chunk_text,
            &input.embedding,
            &input.source_type,
            input.position,
            input.page_number,
            &input.created_at,
        )
        .map_err(|e| format!("save embedding {}: {}", input.id, e))?;
    }
    Ok(())
}

/// Atomically replace all embeddings for a lecture. Old rows are
/// deleted and new ones inserted in a single SQLite transaction; if
/// any insert fails, the transaction rolls back and the existing
/// index stays intact.
///
/// This exists because the v0.5.1-and-earlier re-indexing flow did a
/// JS-side `delete → loop insert`, so a crash partway through the
/// insert loop left the lecture with ZERO embeddings (old gone, new
/// incomplete) and `hasEmbeddings` returned true because some rows
/// had been written — silent broken-retrieval state until the user
/// noticed AI 助教 was worse.
#[tauri::command]
async fn replace_embeddings_for_lecture(
    lecture_id: String,
    inputs: Vec<EmbeddingInput>,
) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    // EmbeddingInput (deser) → EmbeddingRow (storage's internal shape).
    // Identical field set; exists only because the deser type lives in
    // this crate and the DB type lives in storage.
    let rows: Vec<storage::EmbeddingRow> = inputs
        .into_iter()
        .map(|i| storage::EmbeddingRow {
            id: i.id,
            lecture_id: i.lecture_id,
            chunk_text: i.chunk_text,
            embedding: i.embedding,
            source_type: i.source_type,
            position: i.position,
            page_number: i.page_number,
            created_at: i.created_at,
        })
        .collect();
    db.replace_embeddings_for_lecture(&lecture_id, &rows)
        .map_err(|e| format!("replace embeddings: {}", e))
}

#[tauri::command]
async fn get_embeddings_by_lecture(
    lecture_id: String,
) -> Result<Vec<storage::EmbeddingRow>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    db.get_embeddings_by_lecture(&lecture_id)
        .map_err(|e| format!("get embeddings: {}", e))
}

#[tauri::command]
async fn delete_embeddings_by_lecture(lecture_id: String) -> Result<usize, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    db.delete_embeddings_by_lecture(&lecture_id)
        .map_err(|e| format!("delete embeddings: {}", e))
}

#[tauri::command]
async fn count_embeddings(lecture_id: String) -> Result<i64, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    db.count_embeddings(&lecture_id)
        .map_err(|e| format!("count embeddings: {}", e))
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
    file.write_all(&data)
        .map_err(|e| format!("寫入文件失敗: {}", e))?;
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

/// Batched version of `generate_embedding`. Processes N texts in one
/// forward pass of the BERT model with padded attention masks; the
/// resulting speedup over N sequential calls is ~3-5x on CPU because
/// matmul saturates more of the cache and the per-call Rust/JS round
/// trip (tokenizer lock acquire, tensor allocate, unsqueeze, forward,
/// squeeze, to_vec1, IPC serialize, IPC deserialize) only happens
/// once instead of N times.
#[tauri::command]
async fn generate_embeddings_batch(texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = service_guard
        .as_mut()
        .ok_or("Embedding 模型未加載".to_string())?;
    service
        .generate_embeddings_batch(&texts)
        .map_err(|e| format!("批次生成 Embedding 失敗: {}", e))
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

/// Read the current "Remote debug port" experimental toggle.
/// Returns the persisted flag from `dev-flags.toml`; `false` when
/// the file doesn't exist or is unreadable.
#[tauri::command]
fn get_remote_debug_enabled() -> bool {
    dev_flags::remote_debug_enabled()
}

/// Persist the toggle. Frontend Settings shows a "請重啟應用程式"
/// hint after calling this — the change doesn't take effect until
/// the next `main()` runs, because WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
/// is read at WebView2 process-start time only.
#[tauri::command]
fn set_remote_debug_enabled(enabled: bool) -> Result<(), String> {
    let mut flags = dev_flags::load();
    flags.remote_debug_port_enabled = enabled;
    dev_flags::save(&flags)
}

/// Given N sentence-groups (one per Note section), return `top_k`
/// representative sentences per group via a GPU-capable centroid
/// extractor. Empty or small groups are passed through unchanged.
///
/// This is Layer-1 of Note AI structurization — the extractive pass
/// that runs automatically on section creation. The opt-in LLM
/// enrichment (Layer 2) happens through a separate command.
#[tauri::command]
async fn extract_section_highlights(
    sections: Vec<Vec<String>>,
    top_k: Option<usize>,
) -> Result<Vec<Vec<String>>, String> {
    let top_k = top_k.unwrap_or(3).max(1);
    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = service_guard
        .as_mut()
        .ok_or("Embedding 模型未加載".to_string())?;
    service
        .extract_representative_sentences(&sections, top_k)
        .map_err(|e| format!("section highlight extraction failed: {}", e))
}

/// Structured search hit returned by `semantic_search_*`. Wraps the
/// embedding row's metadata (minus the raw embedding vector, which the
/// frontend doesn't need for display) plus the computed similarity.
///
/// Field names use snake_case to match the existing `BackendEmbeddingRow`
/// payload — the frontend's `toRecord` helper can then reuse its
/// existing camelCase mapping.
#[derive(serde::Serialize, Debug)]
struct SearchHit {
    id: String,
    lecture_id: String,
    chunk_text: String,
    source_type: String,
    position: i64,
    page_number: Option<i64>,
    created_at: String,
    similarity: f32,
}

/// Apply the same preferred-page boost the old JS path did. Kept as a
/// tiny helper so the single-lecture and course-wide paths below
/// don't drift.
fn boost_for_page(sim: f32, chunk_page: Option<i64>, preferred_page: Option<i64>) -> f32 {
    match (preferred_page, chunk_page) {
        (Some(pref), Some(page)) => {
            let gap = (page - pref).abs();
            if gap <= 5 {
                sim + 0.1
            } else if gap <= 10 {
                sim + 0.05
            } else {
                sim
            }
        }
        _ => sim,
    }
}

/// Rank chunks in one lecture by cosine similarity to `query`, with an
/// optional boost for chunks near `preferred_page` (PDF-slide-aware
/// RAG). Single Candle matmul on the service's device replaces the
/// per-chunk JS cosine loop we used to run in the renderer.
#[tauri::command]
async fn semantic_search_lecture(
    lecture_id: String,
    query: String,
    top_k: Option<usize>,
    preferred_page: Option<i64>,
) -> Result<Vec<SearchHit>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    let rows = db
        .get_embeddings_by_lecture(&lecture_id)
        .map_err(|e| format!("get embeddings: {}", e))?;
    drop(db);

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = service_guard
        .as_mut()
        .ok_or("Embedding 模型未加載".to_string())?;
    let query_emb = service
        .generate_embedding(&query)
        .map_err(|e| format!("query embed: {}", e))?;
    let chunks: Vec<Vec<f32>> = rows.iter().map(|r| r.embedding.clone()).collect();
    let sims = service
        .batch_cosine_similarity(&query_emb, &chunks)
        .map_err(|e| format!("similarity: {}", e))?;
    drop(service_guard);

    let top_k = top_k.unwrap_or(5);
    let mut scored: Vec<(usize, f32)> = sims
        .iter()
        .enumerate()
        .map(|(i, &s)| (i, boost_for_page(s, rows[i].page_number, preferred_page)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);

    Ok(scored
        .into_iter()
        .map(|(i, score)| {
            let r = &rows[i];
            SearchHit {
                id: r.id.clone(),
                lecture_id: r.lecture_id.clone(),
                chunk_text: r.chunk_text.clone(),
                source_type: r.source_type.clone(),
                position: r.position,
                page_number: r.page_number,
                created_at: r.created_at.clone(),
                similarity: score,
            }
        })
        .collect())
}

/// Cross-lecture search: union every lecture in a course and rank the
/// combined chunk pool. One matmul over the union, not per-lecture —
/// for a typical 10-lecture × 200-chunk course that's 2000 rows, and
/// the GPU finishes the whole search in a handful of ms.
#[tauri::command]
async fn semantic_search_course(
    course_id: String,
    user_id: String,
    query: String,
    top_k: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("db init: {}", e))?;
    let db = manager.get_db().map_err(|e| format!("db conn: {}", e))?;
    let lectures = db
        .list_lectures_by_course(&course_id, &user_id)
        .map_err(|e| format!("list lectures: {}", e))?;

    let mut all_rows: Vec<storage::EmbeddingRow> = Vec::new();
    for lec in &lectures {
        let rows = db
            .get_embeddings_by_lecture(&lec.id)
            .map_err(|e| format!("get embeddings for {}: {}", lec.id, e))?;
        all_rows.extend(rows);
    }
    drop(db);

    if all_rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut service_guard = EMBEDDING_SERVICE.lock().await;
    let service = service_guard
        .as_mut()
        .ok_or("Embedding 模型未加載".to_string())?;
    let query_emb = service
        .generate_embedding(&query)
        .map_err(|e| format!("query embed: {}", e))?;
    let chunks: Vec<Vec<f32>> = all_rows.iter().map(|r| r.embedding.clone()).collect();
    let sims = service
        .batch_cosine_similarity(&query_emb, &chunks)
        .map_err(|e| format!("similarity: {}", e))?;
    drop(service_guard);

    let top_k = top_k.unwrap_or(5);
    let mut scored: Vec<(usize, f32)> = sims.iter().enumerate().map(|(i, &s)| (i, s)).collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);

    Ok(scored
        .into_iter()
        .map(|(i, score)| {
            let r = &all_rows[i];
            SearchHit {
                id: r.id.clone(),
                lecture_id: r.lecture_id.clone(),
                chunk_text: r.chunk_text.clone(),
                source_type: r.source_type.clone(),
                position: r.position,
                page_number: r.page_number,
                created_at: r.created_at.clone(),
                similarity: score,
            }
        })
        .collect())
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

    // Use bge-small-en-v1.5 (standard BERT, Candle-compatible, ~33 MB).
    // Replaces nomic-embed-text-v1 in v0.5.2 — nomic uses the NomicBert
    // architecture with rotary position embeddings + SwiGLU, which
    // Candle's stock `BertModel::load` cannot load (it hard-requires
    // `embeddings.position_embeddings.weight` which nomic doesn't have).
    // Cross-lingual zh→en retrieval is handled upstream in ragService.ts
    // by translating the query to English before embedding.
    let config = EmbeddingModelConfig::bge_small(models_dir);

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

#[tauri::command]
fn get_documents_dir() -> Result<String, String> {
    paths::get_documents_dir().map(|p| p.to_string_lossy().into_owned())
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

    let output = crate::utils::command::no_window("osascript")
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

    let output = crate::utils::command::no_window("osascript")
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

    let output = crate::utils::command::no_window("osascript")
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

    let soffice_cmd: String = if cfg!(target_os = "macos") {
        if Path::new("/Applications/LibreOffice.app/Contents/MacOS/soffice").exists() {
            "/Applications/LibreOffice.app/Contents/MacOS/soffice".to_string()
        } else {
            "soffice".to_string()
        }
    } else if cfg!(target_os = "windows") {
        // LibreOffice on Windows isn't on PATH by default. Prefer soffice.com
        // (the console wrapper that waits for completion) under the standard
        // install directories, falling back to "soffice" on PATH.
        const WIN_CANDIDATES: &[&str] = &[
            r"C:\Program Files\LibreOffice\program\soffice.com",
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.com",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ];
        WIN_CANDIDATES
            .iter()
            .find(|p| Path::new(p).exists())
            .map(|p| (*p).to_string())
            .unwrap_or_else(|| "soffice".to_string())
    } else {
        "soffice".to_string()
    };

    println!("Using LibreOffice: {}", soffice_cmd);

    let output = crate::utils::command::no_window(soffice_cmd)
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
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::Path;

    // Create parent directory if it doesn't exist — lets callers that
    // want to drop files under a new subfolder (e.g. `lecture-pdfs/`)
    // just hand us the final path without a separate mkdir dance.
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent dir: {}", e))?;
        }
    }

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

#[tauri::command]
async fn read_recent_log(lines: usize, app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {}", e))?;
    let log_path = log_dir.join("classnoteai.log");

    if !log_path.exists() {
        return Ok(String::new());
    }

    let file = File::open(&log_path).map_err(|e| format!("Failed to open log file: {}", e))?;
    let reader = BufReader::new(file);
    let all_lines = reader
        .lines()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    let limit = lines.min(2000);
    if limit == 0 {
        return Ok(String::new());
    }

    let start = all_lines.len().saturating_sub(limit);
    Ok(all_lines[start..].join("\n"))
}

#[tauri::command]
async fn open_log_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {}", e))?;

    app_handle
        .opener()
        .open_path(log_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_diagnostic_package(
    input: crate::diagnostics::DiagnosticPackageInput,
    include_audio: bool,
) -> Result<String, String> {
    let path = crate::diagnostics::build_diagnostic_zip(input, include_audio)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Populate HTTP_PROXY/HTTPS_PROXY from Windows Internet Settings so
    // campus/corporate users behind a system proxy can reach our backends.
    // No-op on macOS/Linux. Must run before any reqwest client is built.
    utils::sys_proxy::apply_system_proxy_env();

    tauri::Builder::default()
        // Single-instance MUST be the first plugin so it intercepts
        // before any other plugin grabs a resource lock. Second launch
        // calls the callback with the new argv and exits; we pull the
        // existing main window to the front. See Cargo.toml note on
        // why this app can't run two instances concurrently.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("classnoteai".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .level(if cfg!(debug_assertions) {
                    LevelFilter::Info
                } else {
                    LevelFilter::Warn
                })
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(oauth::OAuthListenerState::default())
        .setup(|app| {
            // DevTools 現在由前端控制，根據 developerMode 設定
            // 前端可透過 invoke 呼叫開啟
            // 不再自動開啟

            // Phase 2 follow-up: point ORT at the bundled onnxruntime
            // binary BEFORE init_onnx(). Without this override the
            // `ort` crate's `load-dynamic` walks PATH and typically
            // picks up whatever older onnxruntime.dll Office / Edge /
            // Copilot left on a Windows box (1.17.x), which fails
            // ort-rc.9's ≥1.23.x version check and silently disables
            // Silero VAD. Setting ORT_DYLIB_PATH to our pinned 1.23.0
            // copy makes this deterministic — `ort::init()` checks
            // that env var first, before any PATH lookup.
            //
            // Bundled file is fetched into `resources/ort/` by
            // `scripts/fetch-onnxruntime.sh` at release build time.
            // Missing file on local dev is fine — we just fall
            // through to the normal PATH search.
            if let Ok(resource_dir) = app.handle().path().resource_dir() {
                let ort_dir = resource_dir.join("resources").join("ort");
                let dll_name = if cfg!(target_os = "windows") {
                    "onnxruntime.dll"
                } else if cfg!(target_os = "macos") {
                    "libonnxruntime.1.23.0.dylib"
                } else {
                    "libonnxruntime.so.1.23.0"
                };
                let bundled = ort_dir.join(dll_name);
                if bundled.exists() {
                    std::env::set_var("ORT_DYLIB_PATH", &bundled);
                    println!("[ORT] ORT_DYLIB_PATH set to bundled {:?}", bundled);
                } else {
                    eprintln!(
                        "[ORT] Bundled onnxruntime not found at {:?} — falling back to system PATH search",
                        bundled
                    );
                }
            }

            // Initialize ONNX Runtime
            utils::onnx::init_onnx();

            // Phase 2 of speech-pipeline-v0.6.5: try to initialise Silero
            // VAD v5 from the bundled resource. A failure is non-fatal —
            // the dispatcher (`vad::detect_speech_segments_adaptive`)
            // falls back to the energy VAD, so recording still works.
            // This keeps the "user can record their lecture" invariant
            // even if the ONNX Runtime DLL is missing / incompatible.
            if let Ok(resource_dir) = app.handle().path().resource_dir() {
                let model_path = resource_dir.join("resources").join("silero").join("silero_vad.onnx");
                if model_path.exists() {
                    match vad::silero::init(&model_path) {
                        Ok(()) => println!("[VAD] Silero v5 initialised from bundle"),
                        Err(e) => eprintln!("[VAD] Silero init failed ({}); falling back to energy VAD", e),
                    }
                } else {
                    eprintln!("[VAD] Silero model not bundled at {:?}; using energy VAD", model_path);
                }
            }

            // Initialization of database
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = storage::init_db(&app_handle).await {
                    eprintln!("數據庫初始化失敗: {}", e);
                } else {
                    println!("數據庫初始化成功");
                }
            });

            // Auto-load the Nemotron model in the background if any
            // variant is already on disk. INT8 wins over FP32 if both
            // are present (faster, similar accuracy). We never trigger
            // a download implicitly at startup — that's a deliberate
            // user action via the Settings UI. But if the model is
            // already downloaded, eagerly loading the ort session
            // saves the user from a ~3-5 s cold start the first time
            // they hit Record.
            tauri::async_runtime::spawn(async move {
                let variant = match asr::parakeet_model::first_present() {
                    Some(v) => v,
                    None => {
                        println!(
                            "[startup] No Nemotron variant downloaded — \
                             skipping auto-load (visit 設定 → 本地轉錄)"
                        );
                        return;
                    }
                };
                let dir = match asr::parakeet_model::model_dir(variant) {
                    Ok(d) => d,
                    Err(e) => {
                        eprintln!("[startup] Nemotron model_dir error: {e}");
                        return;
                    }
                };
                // ort session creation is sync + heavyweight; push it
                // off the tokio runtime so other startup tasks (DB
                // init, gemma autoload) keep progressing.
                let load_result = tokio::task::spawn_blocking(move || {
                    asr::parakeet_engine::ensure_loaded(variant, &dir)
                })
                .await;
                match load_result {
                    Ok(Ok(())) => {
                        println!("[startup] Nemotron {} loaded into memory", variant.label())
                    }
                    Ok(Err(e)) => eprintln!("[startup] Nemotron {} load failed: {e}", variant.label()),
                    Err(e) => eprintln!("[startup] Nemotron load join error: {e}"),
                }
            });

            // Auto-spawn the TranslateGemma sidecar if its model file is
            // already on disk. We don't trigger a 2.5 GB model download
            // implicitly at startup — that has to be a deliberate user
            // action via the Settings UI. But if the model is present
            // (already downloaded), starting the sidecar is free and
            // matches the user's expectation that "translation works
            // when I start the app".
            let app_for_gemma = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Manager as _;
                if !translation::gemma_model::is_present() {
                    println!(
                        "[startup] TranslateGemma model not yet downloaded — \
                         skipping sidecar auto-start (visit 設定 → 翻譯 to download)"
                    );
                    return;
                }
                let model_path = match translation::gemma_model::target_path() {
                    Ok(p) => p.to_string_lossy().to_string(),
                    Err(e) => {
                        eprintln!("[startup] gemma model_path error: {e}");
                        return;
                    }
                };
                let resource_dir = app_for_gemma.path().resource_dir().ok();
                let result = translation::gemma_sidecar::ensure_running(
                    &model_path,
                    translation::gemma_sidecar::DEFAULT_PORT,
                    resource_dir,
                )
                .await;
                println!("[startup] TranslateGemma sidecar bring-up: {result:?}");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            close_devtools,
            read_recent_log,
            open_log_folder,
            export_diagnostic_package,
            detect_speech_segments,
            greet,
            load_whisper_model,
            transcribe_audio,
            download_whisper_model,
            check_whisper_model,
            translate_rough,
            check_gemma_server,
            start_gemma_sidecar,
            stop_gemma_sidecar,
            locate_gemma_binary,
            get_gemma_status,
            download_gemma_model,
            get_parakeet_status,
            parakeet_load_model,
            parakeet_unload_model,
            parakeet_download_model,
            asr_start_session,
            asr_push_audio,
            asr_end_session,
            get_build_features,
            download_translation_model,
            check_translation_model,
            load_translation_model,
            list_available_translation_models,
            load_translation_model_by_name,
            // OAuth callback listener
            oauth::oauth_bind_port,
            oauth::oauth_wait_for_code,
            oauth::oauth_cancel,
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
            delete_subtitle,
            save_setting,
            get_setting,
            get_all_settings,
            register_local_user,
            check_local_user,
            save_note,
            get_note,
            // Embeddings (local RAG)
            save_embedding,
            save_embeddings,
            replace_embeddings_for_lecture,
            get_embeddings_by_lecture,
            delete_embeddings_by_lecture,
            count_embeddings,
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
            generate_embeddings_batch,
            calculate_similarity,
            semantic_search_lecture,
            semantic_search_course,
            extract_section_highlights,
            get_remote_debug_enabled,
            set_remote_debug_enabled,
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
            write_binary_file,
            get_audio_dir,
            get_documents_dir,
            try_recover_audio_path,
            try_recover_pdf_path,
            consume_migration_notices,
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
            // Crash-safe recording (v0.5.2): incremental PCM persistence + recovery
            recording::append_pcm_chunk,
            recording::finalize_recording,
            recording::find_orphaned_recordings,
            recording::discard_orphaned_recording,
            // Phase 1 of speech-pipeline-v0.6.5 (#52): transcript JSONL sidecar
            recording::append_transcript_segment,
            recording::read_orphaned_transcript,
            recording::discard_orphaned_transcript,
            recording::video_import::import_video_for_lecture,
            recording::video_import::extract_pcm_from_video,
            recording::video_import::extract_video_pcm_to_temp,
            recording::video_import::read_pcm_slice,
            recording::video_import::delete_temp_pcm,
            gpu::detect_gpu_backends,
            gpu::get_build_variant,
            crate::updater::check_update_for_channel,
            crate::updater::download_and_install_update,
            list_orphaned_recording_lectures,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Reap the TranslateGemma sidecar on every exit pathway so we
            // don't leave a 2 GB llama-server process orphaned in the
            // background after the app closes (taskmgr would still see it).
            // `Exit` fires on graceful quit, `ExitRequested` is the
            // pre-flight callback if a handler wants to veto — for our
            // sidecar shutting down twice is a no-op so we don't bother.
            //
            // The in-process Nemotron engine doesn't have a separate
            // process to reap, but we still drop the model so the OS
            // sees the RAM (~600 MB) released cleanly before the
            // process exits. Useful for crash diagnostics where ort's
            // memory accounting matters.
            if matches!(event, tauri::RunEvent::Exit) {
                translation::gemma_sidecar::shutdown();
                asr::parakeet_engine::unload();
            }
        });
}

/// Returns + clears any migration notices the DB init queued up.
///
/// Called by the frontend at app-ready so the user sees a toast when
/// an irreversible migration touched their data (e.g. v0.5.2's drop
/// of old-dimension embedding vectors). Drain-once semantics — if
/// the frontend calls twice without a new migration running, the
/// second call returns empty.
#[tauri::command]
async fn consume_migration_notices() -> Result<Vec<String>, String> {
    Ok(storage::drain_migration_notices())
}

/// Attempt to recover a missing `lecture.pdf_path`.
///
/// Mirrors `try_recover_audio_path`. If the DB column is empty but a
/// file matching `lecture_<id>_*` exists in `{app_data}/lecture-pdfs/`,
/// pick the newest and relink it. Orphans can happen when
/// `write_temp_file` succeeded but the subsequent `save_lecture`
/// failed (logged-only before v0.5.2 audit fix).
#[tauri::command]
async fn try_recover_pdf_path(lecture_id: String) -> Result<Option<String>, String> {
    use std::fs;

    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("DB Error: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("DB Connection Error: {}", e))?;

    let lecture_opt = db
        .get_lecture(&lecture_id)
        .map_err(|e| format!("Get Lecture Error: {}", e))?;

    if let Some(ref lecture) = lecture_opt {
        if let Some(ref path) = lecture.pdf_path {
            if !path.is_empty() {
                return Ok(Some(path.clone()));
            }
        }
    } else {
        return Ok(None);
    }

    let pdfs_dir = paths::get_lecture_pdfs_dir().map_err(|e| format!("Path Error: {}", e))?;
    if !pdfs_dir.exists() {
        return Ok(None);
    }

    // Look for `lecture_<id>_*.pdf` (or any extension) — pick newest.
    let prefix = format!("lecture_{}_", lecture_id);
    let mut candidates: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();
    if let Ok(entries) = fs::read_dir(&pdfs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(s) => s,
                None => continue,
            };
            if !name.starts_with(&prefix) {
                continue;
            }
            let mtime = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            candidates.push((path, mtime));
        }
    }
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    let recovered = match candidates.into_iter().next() {
        Some((p, _)) => p,
        None => return Ok(None),
    };

    let path_str = recovered.to_string_lossy().to_string();
    println!("[Recovery] 找到丟失的 PDF 文件: {}", path_str);

    if let Some(mut lecture) = db.get_lecture(&lecture_id).unwrap_or(None) {
        lecture.pdf_path = Some(path_str.clone());
        let user_id = if let Some(course) = db.get_course(&lecture.course_id).unwrap_or(None) {
            course.user_id
        } else {
            "default_user".to_string()
        };
        db.save_lecture(&lecture, &user_id)
            .map_err(|e| format!("Update DB Error: {}", e))?;
        return Ok(Some(path_str));
    }

    Ok(None)
}

fn resolve_stored_audio_path(
    audio_dir: &std::path::Path,
    stored_path: &str,
) -> Option<std::path::PathBuf> {
    let trimmed = stored_path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = std::path::Path::new(trimmed);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        audio_dir.join(path)
    })
}

fn stored_audio_path_is_usable(audio_dir: &std::path::Path, stored_path: &str) -> bool {
    resolve_stored_audio_path(audio_dir, stored_path)
        .map(|path| path.is_file())
        .unwrap_or(false)
}

fn to_stored_audio_path(audio_dir: &std::path::Path, absolute_path: &std::path::Path) -> String {
    if let Ok(relative) = absolute_path.strip_prefix(audio_dir) {
        return relative.to_string_lossy().to_string();
    }

    absolute_path.to_string_lossy().to_string()
}

/// 嘗試恢復丟失的 audio_path.
///
/// v0.5.2: extended to also recover from orphaned `.pcm` files in the
/// in-progress recording directory. The previous version only scanned
/// the audio dir for `.wav` files matching `lecture_<id>_*.wav`, so if
/// the Stop-handler's finalize step failed (for whatever reason — disk
/// full, permission, race), the audio data sitting on disk as a
/// `<id>.pcm` was invisible to recovery. User report:
/// "東西存在就應該要找得到，而不該是找不到的問題" — audio existed on
/// disk, lecture row had null audio_path, no way to reach it.
///
/// Recovery order:
///   1. DB already has a non-empty audio_path → return it as-is.
///   2. Scan audio_dir for `lecture_<id>_*.wav`; pick the NEWEST (by
///      mtime) so re-recordings on the same lecture don't silently
///      lose audio to an older file.
///   3. Scan in-progress dir for `<id>.pcm`; finalize it into a new
///      `lecture_<id>_<now>.wav` under audio_dir, then return that.
///      Finalization removes the `.pcm` + meta after success so the
///      same file can't get recovered twice.
///   4. Nothing found → Ok(None).
#[tauri::command]
async fn try_recover_audio_path(lecture_id: String) -> Result<Option<String>, String> {
    use std::fs;

    // Step 1: check DB state. If audio_path is already populated, nothing to recover.
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("DB Error: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("DB Connection Error: {}", e))?;

    let lecture_opt = db
        .get_lecture(&lecture_id)
        .map_err(|e| format!("Get Lecture Error: {}", e))?;

    let audio_dir = paths::get_audio_dir().map_err(|e| format!("Path Error: {}", e))?;

    if let Some(ref lecture) = lecture_opt {
        if let Some(ref path) = lecture.audio_path {
            if stored_audio_path_is_usable(&audio_dir, path) {
                return Ok(Some(path.clone()));
            }
            if !path.trim().is_empty() {
                println!(
                    "[Recovery] Stored audio_path is stale for lecture {}: {}",
                    lecture_id, path
                );
            }
        }
    } else {
        return Ok(None);
    }

    // Step 2: scan audio_dir for matching .wav files, pick the newest.
    let mut recovered_path: Option<std::path::PathBuf> = None;
    if audio_dir.exists() {
        let prefix = format!("lecture_{}_", lecture_id);
        let mut candidates: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();
        if let Ok(entries) = fs::read_dir(&audio_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(s) => s,
                    None => continue,
                };
                if !(name.starts_with(&prefix) && name.ends_with(".wav")) {
                    continue;
                }
                // Prefer the newest re-recording over an older one. An
                // older loop did `break` on the first match, so a user
                // who re-recorded on the same lecture could silently end
                // up playing the PREVIOUS attempt.
                let mtime = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::UNIX_EPOCH);
                candidates.push((path, mtime));
            }
        }
        candidates.sort_by(|a, b| b.1.cmp(&a.1));
        recovered_path = candidates.into_iter().next().map(|(p, _)| p);
    }

    // Step 3: if no .wav was found, check for an orphaned .pcm in the
    // in-progress dir and finalize it. The Stop-handler failure path
    // (or a mid-session crash that never hit the crash-recovery modal)
    // can leave a .pcm with the actual audio data sitting here.
    if recovered_path.is_none() {
        let in_progress_dir =
            paths::get_in_progress_audio_dir().map_err(|e| format!("Path Error: {}", e))?;
        let pcm_path = in_progress_dir.join(format!("{}.pcm", lecture_id));
        if pcm_path.exists() {
            // Synthesise a new timestamped WAV target under audio_dir.
            let ts = chrono::Utc::now().timestamp_millis();
            let wav_path = audio_dir.join(format!("lecture_{}_{}.wav", lecture_id, ts));
            fs::create_dir_all(&audio_dir)
                .map_err(|e| format!("Failed to create audio dir: {}", e))?;
            match recording::finalize_recording_inner(&in_progress_dir, &lecture_id, &wav_path) {
                Ok(_bytes) => {
                    println!(
                        "[Recovery] Finalised orphaned PCM for lecture {} → {:?}",
                        lecture_id, wav_path
                    );
                    recovered_path = Some(wav_path);
                }
                Err(e) => {
                    println!(
                        "[Recovery] Could not finalise PCM for {}: {} (non-fatal)",
                        lecture_id, e
                    );
                }
            }
        }
    }

    // Step 4: persist the recovered path into the DB so subsequent loads
    // don't have to re-scan.
    if let Some(path) = recovered_path {
        let stored_path = to_stored_audio_path(&audio_dir, &path);
        println!("[Recovery] 找到丟失的音頻文件: {}", stored_path);

        if let Some(mut lecture) = db.get_lecture(&lecture_id).unwrap_or(None) {
            lecture.audio_path = Some(stored_path.clone());
            if lecture.status == "recording" {
                lecture.status = "completed".to_string();
            }
            let user_id = if let Some(course) = db.get_course(&lecture.course_id).unwrap_or(None) {
                course.user_id
            } else {
                "default_user".to_string()
            };
            db.save_lecture(&lecture, &user_id)
                .map_err(|e| format!("Update DB Error: {}", e))?;
            return Ok(Some(stored_path));
        }
    }

    Ok(None)
}

// ========== Offline Queue Commands ==========

#[tauri::command]
async fn add_pending_action(
    id: String,
    action_type: String,
    payload: String,
) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.add_pending_action(&id, &action_type, &payload)
        .map_err(|e| format!("新增待處理動作失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn list_pending_actions() -> Result<Vec<(String, String, String, String, i32)>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.list_pending_actions()
        .map_err(|e| format!("列出待處理動作失敗: {}", e))
}

#[tauri::command]
async fn update_pending_action(id: String, status: String, retry_count: i32) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.update_pending_action(&id, &status, retry_count)
        .map_err(|e| format!("更新待處理動作失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn remove_pending_action(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
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
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.list_deleted_courses(&user_id)
        .map_err(|e| format!("列出已刪除課程失敗: {}", e))
}

#[tauri::command]
async fn list_deleted_lectures(user_id: String) -> Result<Vec<storage::models::Lecture>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.list_deleted_lectures(&user_id)
        .map_err(|e| format!("列出已刪除課堂失敗: {}", e))
}

#[tauri::command]
async fn restore_course(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.restore_course(&id)
        .map_err(|e| format!("還原課程失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn restore_lecture(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.restore_lecture(&id)
        .map_err(|e| format!("還原課堂失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn purge_course(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.purge_course(&id)
        .map_err(|e| format!("永久刪除課程失敗: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn purge_lecture(id: String) -> Result<(), String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
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
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.delete_subtitles_by_lecture(&lecture_id)
        .map_err(|e| format!("刪除字幕失敗: {}", e))
}

#[tauri::command]
async fn get_all_chat_sessions(
    user_id: String,
) -> Result<
    Vec<(
        String,
        Option<String>,
        String,
        String,
        Option<String>,
        String,
        String,
        bool,
    )>,
    String,
> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
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
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
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
async fn get_all_chat_messages(
    user_id: String,
) -> Result<Vec<(String, String, String, String, Option<String>, String)>, String> {
    let manager = storage::get_db_manager()
        .await
        .map_err(|e| format!("數據庫未初始化: {}", e))?;
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
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
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
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
    let db = manager
        .get_db()
        .map_err(|e| format!("數據庫連接失敗: {}", e))?;
    db.delete_chat_messages_by_session(&session_id)
        .map_err(|e| format!("刪除聊天訊息失敗: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{resolve_stored_audio_path, stored_audio_path_is_usable, to_stored_audio_path};
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn stored_audio_path_is_usable_accepts_relative_paths_under_audio_dir() {
        let temp = TempDir::new().unwrap();
        let audio_dir = temp.path().join("audio");
        fs::create_dir_all(&audio_dir).unwrap();
        fs::write(audio_dir.join("lecture_demo.wav"), b"wav").unwrap();

        assert!(stored_audio_path_is_usable(&audio_dir, "lecture_demo.wav"));
    }

    #[test]
    fn stored_audio_path_is_usable_rejects_stale_absolute_paths() {
        let temp = TempDir::new().unwrap();
        let audio_dir = temp.path().join("audio");
        fs::create_dir_all(&audio_dir).unwrap();

        assert!(!stored_audio_path_is_usable(
            &audio_dir,
            "/Users/old-home/Library/Application Support/com.classnoteai/audio/lecture_demo.wav",
        ));
    }

    #[test]
    fn to_stored_audio_path_relativizes_files_inside_audio_dir() {
        let temp = TempDir::new().unwrap();
        let audio_dir = temp.path().join("audio");
        let audio_path = audio_dir.join("lecture_demo.wav");

        assert_eq!(
            to_stored_audio_path(&audio_dir, &audio_path),
            "lecture_demo.wav"
        );
    }

    #[test]
    fn resolve_stored_audio_path_preserves_absolute_paths() {
        let temp = TempDir::new().unwrap();
        let audio_dir = temp.path().join("audio");
        let absolute = audio_dir.join("lecture_demo.wav");

        let resolved = resolve_stored_audio_path(&audio_dir, absolute.to_str().unwrap()).unwrap();
        assert_eq!(resolved, absolute);
    }
}
