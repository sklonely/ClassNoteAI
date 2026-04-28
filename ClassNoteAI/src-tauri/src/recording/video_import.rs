/*!
 * Video → PCM extraction for the v0.6.0 "import recorded lecture" flow.
 *
 * v2 NOTE (refactor/streaming-pipeline branch):
 *
 * The Whisper-based bulk transcription path that lived in this file
 * (`transcribe_pcm_file_slice`, `transcribe_video_file`, the
 * `IMPORT_WHISPER_SERVICE` slot) has been removed alongside the rest
 * of the legacy Whisper backend. Imported videos now flow through the
 * same Parakeet sidecar that powers live recording — the renderer
 * extracts PCM via the kept `extract_video_pcm_to_temp` /
 * `extract_pcm_from_video` commands, then streams chunks to
 * `asrPipeline.pushAudio()` exactly like the mic does.
 *
 * Result: one ASR code path instead of two; no Whisper-specific
 * chunking heuristics here; cross-platform parity automatically
 * follows from the sidecar.
 *
 * Commands kept on the Rust side:
 *   - `import_video_for_lecture`     (file copy + lecture binding)
 *   - `extract_pcm_from_video`       (ffmpeg → in-memory PCM)
 *   - `extract_video_pcm_to_temp`    (ffmpeg → PCM file under temp/)
 *   - `delete_temp_pcm`              (cleanup)
 *
 * Commands removed:
 *   - `transcribe_pcm_file_slice`    (was Whisper)
 *   - `transcribe_video_file`        (was Whisper)
 *   - `release_import_whisper`       (slot is gone)
 *   - `resolve_whisper_model_path`   (no Whisper models anymore)
 */

use crate::utils::command::no_window;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Stdio;

const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mkv", "webm", "mov", "avi", "wav", "mp3", "m4a", "aac", "flac", "ogg", "opus",
];

/// Run ffmpeg to decode a video file into raw 16 kHz mono i16 PCM.
///
/// We probe `ffmpeg` on PATH; if missing, fail with a user-actionable
/// error rather than spawning into the void. Works the same on every
/// supported OS (ffmpeg is the only required external tool).
pub fn extract_pcm_16k_mono(video_path: &Path) -> Result<Vec<i16>, String> {
    let ffmpeg = locate_ffmpeg().ok_or_else(|| {
        "ffmpeg not found on PATH. Install via WinGet/Homebrew/apt and retry.".to_string()
    })?;

    let output = no_window(&ffmpeg)
        .args([
            "-i",
            video_path.to_string_lossy().as_ref(),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    if !output.status.success() {
        let stderr_tail: String = String::from_utf8_lossy(&output.stderr)
            .lines()
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!(
            "ffmpeg exited {:?}: {}",
            output.status.code(),
            stderr_tail
        ));
    }

    // s16le bytes → i16 samples
    let bytes = output.stdout;
    if bytes.len() % 2 != 0 {
        return Err(format!(
            "ffmpeg returned odd byte count ({}); expected aligned i16 PCM",
            bytes.len()
        ));
    }
    let mut samples = Vec::with_capacity(bytes.len() / 2);
    for c in bytes.chunks_exact(2) {
        samples.push(i16::from_le_bytes([c[0], c[1]]));
    }
    Ok(samples)
}

/// Locate ffmpeg via PATH, with a Windows-specific WinGet fallback to
/// match `recording/audio_capture.rs`'s lookup. Cross-platform shape:
/// macOS/Linux just use `which`.
fn locate_ffmpeg() -> Option<PathBuf> {
    let probe = if cfg!(windows) { "where" } else { "which" };
    if let Ok(out) = no_window(probe).arg("ffmpeg").output() {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(line) = text.lines().next() {
                let p = PathBuf::from(line.trim());
                if !line.trim().is_empty() && p.exists() {
                    return Some(p);
                }
            }
        }
    }

    // Windows: check common WinGet install path (Gyan.FFmpeg)
    #[cfg(windows)]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let winget_path = PathBuf::from(local_app_data).join(
                r"Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe",
            );
            if winget_path.exists() {
                return Some(winget_path);
            }
        }
    }

    None
}

fn lower_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

fn supported_media_extension(path: &Path) -> Result<String, String> {
    let ext = lower_extension(path).ok_or_else(|| {
        format!(
            "unsupported media file without extension: {}",
            path.display()
        )
    })?;
    if SUPPORTED_MEDIA_EXTENSIONS.contains(&ext.as_str()) {
        Ok(ext)
    } else {
        Err(format!(
            "unsupported media extension .{}; raw .pcm files are internal scratch files, not import media",
            ext
        ))
    }
}

fn app_temp_pcm_dir() -> Result<PathBuf, String> {
    Ok(crate::paths::get_app_data_dir()?.join("temp_pcm"))
}

fn validate_temp_pcm_path(path: &Path, temp_dir: &Path) -> Result<(), String> {
    if lower_extension(path).as_deref() != Some("pcm") {
        return Err(format!("expected a .pcm temp file: {}", path.display()));
    }
    if !path.exists() {
        return Ok(());
    }

    let canonical_temp = temp_dir
        .canonicalize()
        .map_err(|e| format!("canonicalize temp_pcm dir {}: {e}", temp_dir.display()))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("canonicalize pcm path {}: {e}", path.display()))?;
    if !canonical_path.starts_with(&canonical_temp) {
        return Err(format!(
            "rejected non-temp PCM path: {}",
            canonical_path.display()
        ));
    }
    Ok(())
}

// ============================================================
// Tauri commands
// ============================================================

/// Move/copy a video file into the app's managed video directory and
/// associate it with a lecture row. Returns the final absolute path.
#[tauri::command]
pub async fn import_video_for_lecture(
    src_path: String,
    lecture_id: String,
) -> Result<String, String> {
    use crate::paths;
    let src = PathBuf::from(&src_path);
    if !src.exists() {
        return Err(format!("source media not found: {src_path}"));
    }
    let ext = supported_media_extension(&src)?;
    let video_dir = paths::get_video_dir()?;
    std::fs::create_dir_all(&video_dir)
        .map_err(|e| format!("mkdir {}: {e}", video_dir.display()))?;
    let dest = video_dir.join(format!("{lecture_id}.{ext}"));
    std::fs::copy(&src, &dest)
        .map_err(|e| format!("copy video {} -> {}: {e}", src.display(), dest.display()))?;
    Ok(dest.to_string_lossy().to_string())
}

/// One-shot: ffmpeg → in-memory PCM. Convenient for short videos
/// (renderer reads everything into memory). Long videos should use
/// `extract_video_pcm_to_temp` instead.
#[tauri::command]
pub async fn extract_pcm_from_video(video_path: String) -> Result<Vec<i16>, String> {
    let path = PathBuf::from(&video_path);
    supported_media_extension(&path)?;
    extract_pcm_16k_mono(&path)
}

/// PCM extraction result for the temp-file variant.
#[derive(Debug, Serialize, Deserialize)]
pub struct PcmExtractResult {
    pub pcm_path: String,
    pub sample_count: u64,
    pub duration_sec: f64,
}

/// Stream ffmpeg output into a temp file under app data, returning the
/// path. Lets the renderer read PCM in slices instead of dumping a
/// 1-hour video's worth of i16 over Tauri IPC.
#[tauri::command]
pub async fn extract_video_pcm_to_temp(video_path: String) -> Result<PcmExtractResult, String> {
    use crate::paths;
    let video = PathBuf::from(&video_path);
    if !video.exists() {
        return Err(format!("media not found: {video_path}"));
    }
    supported_media_extension(&video)?;
    let ffmpeg = locate_ffmpeg().ok_or_else(|| {
        "ffmpeg not found on PATH. Install via WinGet/Homebrew/apt and retry.".to_string()
    })?;
    let temp_dir = paths::get_app_data_dir()?.join("temp_pcm");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("mkdir temp_pcm: {e}"))?;
    let pcm_name = format!(
        "{}.pcm",
        video
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("import")
    );
    let pcm_path = temp_dir.join(&pcm_name);
    let mut child = no_window(&ffmpeg)
        .args([
            "-y",
            "-i",
            video.to_string_lossy().as_ref(),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            pcm_path.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;
    // Drain stderr in a thread so ffmpeg doesn't deadlock on full pipe.
    if let Some(mut stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
            }
        });
    }
    let status = child.wait().map_err(|e| format!("ffmpeg wait: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg exited {:?}", status.code()));
    }
    let metadata =
        std::fs::metadata(&pcm_path).map_err(|e| format!("stat {}: {e}", pcm_path.display()))?;
    let sample_count = metadata.len() / 2; // i16 = 2 bytes
    let duration_sec = sample_count as f64 / 16000.0;
    Ok(PcmExtractResult {
        pcm_path: pcm_path.to_string_lossy().to_string(),
        sample_count,
        duration_sec,
    })
}

/// Read a slice of a PCM file and return as `Vec<i16>`. The renderer
/// uses this to stream chunks into the Parakeet sidecar.
///
/// `start_sample` and `count` are in i16 samples (not bytes).
#[tauri::command]
pub async fn read_pcm_slice(
    pcm_path: String,
    start_sample: u64,
    count: u64,
) -> Result<Vec<i16>, String> {
    let path = PathBuf::from(&pcm_path);
    let temp_dir = app_temp_pcm_dir()?;
    validate_temp_pcm_path(&path, &temp_dir)?;
    let mut file = File::open(&path).map_err(|e| format!("open {pcm_path}: {e}"))?;
    file.seek(SeekFrom::Start(start_sample * 2))
        .map_err(|e| format!("seek: {e}"))?;
    let mut buf = vec![0u8; (count * 2) as usize];
    let read = file.read(&mut buf).map_err(|e| format!("read: {e}"))?;
    buf.truncate(read);
    if buf.len() % 2 != 0 {
        buf.pop(); // unaligned tail
    }
    let mut samples = Vec::with_capacity(buf.len() / 2);
    for c in buf.chunks_exact(2) {
        samples.push(i16::from_le_bytes([c[0], c[1]]));
    }
    Ok(samples)
}

/// Best-effort cleanup of a PCM temp file. Idempotent — missing files
/// aren't an error (caller may have already cleaned up).
#[tauri::command]
pub async fn delete_temp_pcm(pcm_path: String) -> Result<(), String> {
    let path = PathBuf::from(&pcm_path);
    let temp_dir = app_temp_pcm_dir()?;
    validate_temp_pcm_path(&path, &temp_dir)?;
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| format!("delete {pcm_path}: {e}"))
}

/// Helper used by frontend to find existing lecture videos on disk.
pub fn stage_video_inner(_dir: &Path, _lecture_id: &str) -> Result<Option<PathBuf>, String> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn supported_media_extension_accepts_audio_and_video_but_rejects_pcm() {
        assert_eq!(
            supported_media_extension(Path::new("lecture.MP4")).unwrap(),
            "mp4"
        );
        assert_eq!(
            supported_media_extension(Path::new("audio.m4a")).unwrap(),
            "m4a"
        );
        assert!(supported_media_extension(Path::new("scratch.pcm")).is_err());
        assert!(supported_media_extension(Path::new("slides.pdf")).is_err());
    }

    #[test]
    fn temp_pcm_validation_stays_inside_temp_pcm_dir() {
        let tmp = TempDir::new().unwrap();
        let temp_pcm = tmp.path().join("temp_pcm");
        std::fs::create_dir_all(&temp_pcm).unwrap();
        let good = temp_pcm.join("import.pcm");
        std::fs::write(&good, [0u8; 4]).unwrap();
        let outside = tmp.path().join("audio").join("in-progress");
        std::fs::create_dir_all(&outside).unwrap();
        let interrupted_recording = outside.join("lecture.pcm");
        std::fs::write(&interrupted_recording, [0u8; 4]).unwrap();

        assert!(validate_temp_pcm_path(&good, &temp_pcm).is_ok());
        assert!(validate_temp_pcm_path(&interrupted_recording, &temp_pcm).is_err());
        assert!(validate_temp_pcm_path(&temp_pcm.join("not-pcm.wav"), &temp_pcm).is_err());
    }
}
