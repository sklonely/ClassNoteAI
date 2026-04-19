/*!
 * Video → PCM extraction for the v0.6.0 "import recorded lecture" flow.
 *
 * We shell out to `ffmpeg` rather than linking against libavcodec — the
 * app already ships with other native deps (whisper-rs, ct2rs, candle)
 * and adding libav would blow up the Windows build matrix. `ffmpeg` is
 * near-universally installed on developer machines and we probe PATH
 * at call time with a clear error when missing; bundling a static
 * binary can come later if real-user installs hit "ffmpeg not found"
 * often enough.
 *
 * Output format is fixed at 16 kHz mono i16 PCM (the exact shape
 * whisper-rs's `transcribe` wants — same as live-recording input), so
 * the downstream transcription path needs zero changes.
 */

use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tokio::sync::Mutex as TokioMutex;

use crate::whisper::WhisperService;

/// Dedicated Whisper service slot for bulk video import. We keep this
/// separate from the main WHISPER_SERVICE so:
///   - The user's live-recording model (often large-v3-turbo) stays
///     loaded and ready — video import doesn't evict it.
///   - Import can use a faster model (base / small) without touching
///     the live path. A 1-hour video on large-v3-turbo CPU is ~40 min;
///     on base it's ~5 min. For bulk transcription the accuracy trade
///     is almost always worth it.
/// The tuple carries the loaded model's path so successive slice calls
/// in the same import reuse the model instead of reloading per chunk.
static IMPORT_WHISPER_SERVICE: TokioMutex<Option<(String, WhisperService)>> =
    TokioMutex::const_new(None);

/// Run ffmpeg to decode a video file into raw 16 kHz mono i16 PCM.
/// Returns the full PCM samples in memory; for typical lecture lengths
/// (1-2 hours) that's ~100-200 MB of i16 which is fine to hold on
/// desktop. If we ever care about streaming very long lectures we can
/// emit a temp .wav and hand the path back instead.
pub fn extract_pcm_16k_mono(video_path: &Path) -> Result<Vec<i16>, String> {
    if !video_path.exists() {
        return Err(format!("video file not found: {}", video_path.display()));
    }

    let ffmpeg = locate_ffmpeg()?;

    let mut child = Command::new(&ffmpeg)
        // Suppress the extremely verbose default banner; keep warnings/errors.
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
        ])
        .arg(video_path)
        .args([
            // Mono, 16 kHz, signed 16-bit little-endian (whisper input).
            "-ac", "1",
            "-ar", "16000",
            "-f", "s16le",
            "-y",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {}", e))?;

    // Drain stdout (PCM bytes) and stderr (diagnostics) concurrently
    // to avoid pipe-buffer deadlock on long videos.
    let mut stdout = child.stdout.take().expect("stdout piped");
    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::with_capacity(16 * 1024 * 1024);
        stdout
            .read_to_end(&mut buf)
            .map(|_| buf)
            .map_err(|e| format!("ffmpeg stdout read failed: {}", e))
    });

    let mut stderr = child.stderr.take().expect("stderr piped");
    let stderr_handle = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg wait failed: {}", e))?;
    let stderr_out = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "ffmpeg exited with {}: {}",
            status,
            stderr_out.trim()
        ));
    }

    let pcm_bytes = stdout_handle
        .join()
        .map_err(|_| "ffmpeg stdout thread panicked".to_string())??;

    // Reinterpret the byte buffer as i16 samples. Little-endian on both
    // Windows and macOS arm64/x64 so this is a direct cast for us.
    if pcm_bytes.len() % 2 != 0 {
        return Err(format!(
            "ffmpeg produced {} bytes, not a whole number of i16 samples",
            pcm_bytes.len()
        ));
    }
    let samples: Vec<i16> = pcm_bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    Ok(samples)
}

/// Find `ffmpeg` on the current machine. Returns a descriptive error
/// the frontend can show to the user when absent.
fn locate_ffmpeg() -> Result<String, String> {
    // Fast path: PATH lookup via `which`-equivalent. `ffmpeg` alone
    // works on every shell that has it resolvable, so we just try to
    // spawn it with `-version` to see if it's there.
    let probe = Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if probe.is_ok() && probe.unwrap().success() {
        return Ok("ffmpeg".to_string());
    }

    // Windows: common WinGet install location. If a user has installed
    // Gyan.FFmpeg but their PATH wasn't updated for the current app
    // session, we still find it.
    #[cfg(target_os = "windows")]
    {
        if let Some(home) = dirs::home_dir() {
            let winget_path = home.join(
                "AppData/Local/Microsoft/WinGet/Packages/\
                 Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/\
                 ffmpeg-8.0.1-full_build/bin/ffmpeg.exe",
            );
            if winget_path.exists() {
                return Ok(winget_path.to_string_lossy().into_owned());
            }
        }
    }

    Err(
        "ffmpeg 未安裝或不在 PATH 中。\
         請從 https://ffmpeg.org/download.html 下載後重新啟動應用程式。"
            .to_string(),
    )
}

// ----- Tauri command wrappers ------------------------------------------

/// Copy / link a video source file into the lecture's data directory so
/// we own it and the user can't accidentally move/delete the playback
/// target. Returns the destination path (string) for the frontend to
/// persist in `lectures.video_path`.
///
/// Uses a rename-then-fallback-copy strategy: same-volume moves are
/// free; cross-volume gets a full copy. Either way, the original is
/// left intact if the user picked a file outside the app's data dir.
pub fn stage_video_inner(
    videos_dir: &Path,
    lecture_id: &str,
    source: &Path,
) -> std::io::Result<PathBuf> {
    if lecture_id.is_empty() || lecture_id.len() > 128 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "lecture_id must be 1-128 chars",
        ));
    }
    for c in lecture_id.chars() {
        if !(c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("lecture_id contains disallowed char: {:?}", c),
            ));
        }
    }
    if !source.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("source video not found: {}", source.display()),
        ));
    }
    std::fs::create_dir_all(videos_dir)?;
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4");
    let dest = videos_dir.join(format!("{}.{}", lecture_id, ext));
    // We copy rather than move: the user may want to keep their
    // original file, and moving from arbitrary user dirs gets brittle
    // (OneDrive-mirrored paths, network shares, etc).
    std::fs::copy(source, &dest)?;
    Ok(dest)
}

#[tauri::command]
pub async fn import_video_for_lecture(
    lecture_id: String,
    source_path: String,
) -> Result<String, String> {
    let videos_dir = crate::paths::get_video_dir()
        .map_err(|e| format!("video dir unavailable: {}", e))?;
    let dest = stage_video_inner(&videos_dir, &lecture_id, Path::new(&source_path))
        .map_err(|e| format!("failed to stage video: {}", e))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn extract_pcm_from_video(video_path: String) -> Result<Vec<i16>, String> {
    extract_pcm_16k_mono(Path::new(&video_path))
}

// ----- Chunked-transcribe pipeline (v0.6.0) ----------------------------
//
// The original `transcribe_video_file` was a single opaque call: ffmpeg
// → full PCM buffer → one Whisper pass → return all segments. For a
// 1 hour 20 minute lecture that's ~80 min of CPU work with zero
// progress feedback, indistinguishable from a hang. We now split the
// work into 5-minute slices so the frontend can:
//   1. show granular progress ("轉錄 3/14, 翻譯 2/14"),
//   2. pipeline translation against transcription instead of sequencing
//      them, and
//   3. avoid rebuffering the whole PCM when retrying a single chunk.
//
// The PCM is materialised to a temp file on disk once (fast — ffmpeg
// does ~70 min of video in ~3 s) and then each slice reads the exact
// byte range it needs. Whisper is called per-slice with the offset
// baked into the returned segment timestamps.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PcmExtractResult {
    pub pcm_path: String,
    pub duration_sec: f64,
    pub sample_count: u64,
}

const PCM_SAMPLE_RATE: u32 = 16_000;
const PCM_BYTES_PER_SAMPLE: u64 = 2;

/// Stream ffmpeg's PCM output directly to a temp file instead of the
/// in-memory Vec<i16> that `extract_pcm_16k_mono` uses. A 70-minute
/// video is ~130 MB; writing to disk is cheaper than holding it in RAM
/// across the chunked transcription loop (which can take tens of
/// minutes) and the frontend can then retry individual slices without
/// re-running ffmpeg.
fn extract_pcm_to_file(video_path: &Path, pcm_path: &Path) -> Result<u64, String> {
    if !video_path.exists() {
        return Err(format!("video file not found: {}", video_path.display()));
    }
    if let Some(parent) = pcm_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create pcm dir: {}", e))?;
    }

    let ffmpeg = locate_ffmpeg()?;
    let output = File::create(pcm_path)
        .map_err(|e| format!("failed to create pcm file: {}", e))?;
    let mut writer = BufWriter::with_capacity(1024 * 1024, output);

    let mut child = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(video_path)
        .args(["-ac", "1", "-ar", "16000", "-f", "s16le", "-y", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {}", e))?;

    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut stderr = child.stderr.take().expect("stderr piped");

    let stderr_handle = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    // Stream in 1 MB blocks so we never hold more than that in memory.
    let mut buf = vec![0u8; 1024 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = stdout
            .read(&mut buf)
            .map_err(|e| format!("ffmpeg read failed: {}", e))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("pcm write failed: {}", e))?;
        total += n as u64;
    }
    writer
        .flush()
        .map_err(|e| format!("pcm flush failed: {}", e))?;

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg wait failed: {}", e))?;
    let stderr_out = stderr_handle.join().unwrap_or_default();
    if !status.success() {
        return Err(format!(
            "ffmpeg exited with {}: {}",
            status,
            stderr_out.trim()
        ));
    }
    if total % 2 != 0 {
        return Err(format!(
            "ffmpeg produced {} bytes, not a whole number of i16 samples",
            total
        ));
    }
    Ok(total / PCM_BYTES_PER_SAMPLE)
}

#[tauri::command]
pub async fn extract_video_pcm_to_temp(video_path: String) -> Result<PcmExtractResult, String> {
    let source = Path::new(&video_path);
    // Drop the temp PCM next to the staged video so it lives and dies
    // with the lecture — same directory already has the app's write
    // permission and our cleanup routines.
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("pcm");
    let parent = source
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "invalid video path".to_string())?;
    let pcm_path = parent.join(format!("{}.transcribe.pcm", stem));

    let sample_count = extract_pcm_to_file(source, &pcm_path)?;
    let duration_sec = sample_count as f64 / PCM_SAMPLE_RATE as f64;
    Ok(PcmExtractResult {
        pcm_path: pcm_path.to_string_lossy().into_owned(),
        duration_sec,
        sample_count,
    })
}

/// Transcribe a [start_sec, end_sec) range of an on-disk PCM file.
/// The returned segment timestamps are shifted by `start_sec * 1000`
/// so the frontend can concatenate slices without further adjustment.
///
/// When `model_override_path` is `Some`, use a separate Whisper
/// instance loaded from that file instead of the main WHISPER_SERVICE.
/// This drives the "fast import" path where bulk video transcription
/// runs on a smaller model (base) while live recording keeps the
/// user's larger model loaded in WHISPER_SERVICE. When `None`, falls
/// back to WHISPER_SERVICE (same as before).
#[tauri::command]
pub async fn transcribe_pcm_file_slice(
    pcm_path: String,
    start_sec: f64,
    end_sec: f64,
    initial_prompt: Option<String>,
    language: Option<String>,
    options: Option<crate::whisper::transcribe::TranscriptionOptions>,
    model_override_path: Option<String>,
) -> Result<crate::whisper::transcribe::TranscriptionResult, String> {
    let t0 = std::time::Instant::now();
    println!(
        "[video_import] slice start: {:.1}..{:.1}s, lang={:?}, override={:?}, pcm={}",
        start_sec, end_sec, language, model_override_path, pcm_path
    );
    if end_sec <= start_sec {
        return Err("end_sec must be > start_sec".to_string());
    }
    let path = Path::new(&pcm_path);
    let mut file = File::open(path).map_err(|e| format!("open pcm failed: {}", e))?;
    let start_byte = (start_sec * PCM_SAMPLE_RATE as f64 * PCM_BYTES_PER_SAMPLE as f64) as u64;
    // Align to sample boundary.
    let start_byte = start_byte - (start_byte % PCM_BYTES_PER_SAMPLE);
    let sample_span = ((end_sec - start_sec) * PCM_SAMPLE_RATE as f64) as usize;
    let byte_span = sample_span * PCM_BYTES_PER_SAMPLE as usize;

    file.seek(SeekFrom::Start(start_byte))
        .map_err(|e| format!("seek failed: {}", e))?;
    let mut bytes = vec![0u8; byte_span];
    let read = file
        .read(&mut bytes)
        .map_err(|e| format!("read pcm failed: {}", e))?;
    bytes.truncate(read - (read % PCM_BYTES_PER_SAMPLE as usize));

    let samples: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    println!(
        "[video_import] slice read {} samples in {:.2}s — calling whisper…",
        samples.len(),
        t0.elapsed().as_secs_f64()
    );

    if samples.is_empty() {
        return Ok(crate::whisper::transcribe::TranscriptionResult {
            text: String::new(),
            segments: vec![],
            language: None,
            duration_ms: 0,
        });
    }

    let t_lock = std::time::Instant::now();
    let result = if let Some(ref override_path) = model_override_path {
        // Fast-import path: dedicated IMPORT_WHISPER_SERVICE with the
        // caller-specified model. First slice in an import pays the
        // model-load cost (~0.5-2s); subsequent slices reuse the
        // cached model since we key on path.
        let mut guard = IMPORT_WHISPER_SERVICE.lock().await;
        let needs_load = match guard.as_ref() {
            Some((loaded_path, _)) => loaded_path != override_path,
            None => true,
        };
        if needs_load {
            if !Path::new(override_path).exists() {
                return Err(format!(
                    "指定的 Whisper 模型檔案不存在: {}",
                    override_path
                ));
            }
            println!(
                "[video_import] loading import-side Whisper model: {}",
                override_path
            );
            let t_load = std::time::Instant::now();
            let mut svc = WhisperService::new();
            svc.load_model(override_path)
                .await
                .map_err(|e| format!("模型加載失敗: {}", e))?;
            println!(
                "[video_import] import model loaded in {:.2}s",
                t_load.elapsed().as_secs_f64()
            );
            *guard = Some((override_path.to_string(), svc));
        }
        let (_, service) = guard.as_ref().unwrap();
        println!(
            "[video_import] slice acquired IMPORT_WHISPER lock in {:.2}s",
            t_lock.elapsed().as_secs_f64()
        );

        let t_whisper = std::time::Instant::now();
        let r = service
            .transcribe(
                &samples,
                PCM_SAMPLE_RATE,
                initial_prompt.as_deref(),
                language.as_deref(),
                options,
            )
            .await
            .map_err(|e| format!("轉錄失敗: {}", e))?;
        println!(
            "[video_import] slice whisper (import) done in {:.2}s — segments={} lang={:?}, total slice {:.2}s",
            t_whisper.elapsed().as_secs_f64(),
            r.segments.len(),
            r.language,
            t0.elapsed().as_secs_f64()
        );
        r
    } else {
        // Default path: share the main WHISPER_SERVICE with live
        // recording. May contend if the user imports while a mic
        // capture is running, but that's a rare race.
        let service_guard = crate::WHISPER_SERVICE.lock().await;
        let service = service_guard
            .as_ref()
            .ok_or_else(|| "Whisper 模型未加載".to_string())?;
        println!(
            "[video_import] slice acquired WHISPER_SERVICE lock in {:.2}s",
            t_lock.elapsed().as_secs_f64()
        );

        let t_whisper = std::time::Instant::now();
        let r = service
            .transcribe(
                &samples,
                PCM_SAMPLE_RATE,
                initial_prompt.as_deref(),
                language.as_deref(),
                options,
            )
            .await
            .map_err(|e| format!("轉錄失敗: {}", e))?;
        println!(
            "[video_import] slice whisper done in {:.2}s — segments={} lang={:?}, total slice {:.2}s",
            t_whisper.elapsed().as_secs_f64(),
            r.segments.len(),
            r.language,
            t0.elapsed().as_secs_f64()
        );
        r
    };
    let mut result = result;
    let offset_ms = (start_sec * 1000.0) as u64;
    for seg in result.segments.iter_mut() {
        seg.start_ms = seg.start_ms.saturating_add(offset_ms);
        seg.end_ms = seg.end_ms.saturating_add(offset_ms);
    }
    Ok(result)
}

/// Release the import-side Whisper service — called by the frontend
/// orchestrator when a video import pipeline finishes (or errors). We
/// don't auto-unload because the user may run several imports back-to
/// -back with the same model, and each load costs 0.5–2 s. Once idle,
/// frees ~150 MB for base / ~200 MB for small.
#[tauri::command]
pub async fn release_import_whisper() -> Result<(), String> {
    let mut guard = IMPORT_WHISPER_SERVICE.lock().await;
    *guard = None;
    println!("[video_import] IMPORT_WHISPER_SERVICE released");
    Ok(())
}

/// Return the absolute path to a preset Whisper model file under the
/// app's `models/whisper/` dir. Used by the import pipeline so the
/// frontend can ask for "fast" without hardcoding platform-specific
/// paths in TS.
#[tauri::command]
pub async fn resolve_whisper_model_path(preset: String) -> Result<String, String> {
    let filename = match preset.as_str() {
        "base" => "ggml-base.bin",
        "small" => "ggml-small.bin",
        "small-q5" => "ggml-small-q5.bin",
        "medium" => "ggml-medium.bin",
        "large" => "ggml-large.bin",
        "turbo" => "ggml-large-v3-turbo-q5_0.bin",
        _ => return Err(format!("unknown preset: {}", preset)),
    };
    let dir = crate::paths::get_whisper_models_dir()
        .map_err(|e| format!("whisper models dir unavailable: {}", e))?;
    let full = dir.join(filename);
    if !full.exists() {
        return Err(format!(
            "preset {} ({}) not downloaded",
            preset,
            full.display()
        ));
    }
    Ok(full.to_string_lossy().into_owned())
}

/// Remove the temp `.transcribe.pcm` file once the orchestrator is done
/// with it. Best-effort — a leftover PCM is harmless (just disk).
#[tauri::command]
pub async fn delete_temp_pcm(pcm_path: String) -> Result<(), String> {
    let path = Path::new(&pcm_path);
    if !path.exists() {
        return Ok(());
    }
    // Guard against accidental deletion outside a pcm file.
    if !pcm_path.ends_with(".pcm") {
        return Err("refusing to delete non-.pcm file".to_string());
    }
    std::fs::remove_file(path).map_err(|e| format!("delete failed: {}", e))
}

/// Combined "extract + transcribe" entry point. The original shape --
/// one command for extract (returns Vec<i16>), one for transcribe --
/// would have round-tripped up to ~115 MB of PCM over Tauri's JSON IPC
/// for a 1-hour 16 kHz video. Serialising 57M i16 as JSON text blows
/// out to ~300 MB and OOMs the webview.
///
/// Keeping the PCM inside the Rust process and handing only the
/// finished transcription segments back (usually a few KB) avoids
/// the whole issue. The actual Whisper call uses the same WHISPER_SERVICE
/// singleton as the live-recording path.
#[tauri::command]
pub async fn transcribe_video_file(
    video_path: String,
    initial_prompt: Option<String>,
    language: Option<String>,
    options: Option<crate::whisper::transcribe::TranscriptionOptions>,
) -> Result<crate::whisper::transcribe::TranscriptionResult, String> {
    let pcm = extract_pcm_16k_mono(Path::new(&video_path))?;
    let service_guard = crate::WHISPER_SERVICE.lock().await;
    let service = service_guard
        .as_ref()
        .ok_or_else(|| "Whisper 模型未加載".to_string())?;
    service
        .transcribe(
            &pcm,
            16_000,
            initial_prompt.as_deref(),
            language.as_deref(),
            options,
        )
        .await
        .map_err(|e| format!("轉錄失敗: {}", e))
}
