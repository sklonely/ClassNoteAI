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

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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
