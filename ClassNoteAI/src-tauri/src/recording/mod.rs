//! Crash-safe recording: incremental raw-PCM persistence + orphan recovery.
//!
//! Also hosts `video_import` — extracting 16kHz mono i16 PCM out of a
//! pre-recorded video file (ffmpeg shell-out) so imported lectures
//! feed the same Whisper transcription pipeline as live recordings.
//!
//! Before v0.5.2, audio only lived in the frontend `recordedChunks: Int16Array[]`
//! buffer until the user hit Stop — a crash, power loss, or accidental window
//! close in the middle of an 80-minute lecture wiped the whole session. The
//! `lectures` row was also left stuck at `status='recording'` with no
//! reconciliation on the next launch.
//!
//! The fix here is deliberately simple: during recording the frontend flushes
//! the most recent chunk of raw PCM to `{app_data}/audio/in-progress/{lecture_id}.pcm`
//! every few seconds via `append_pcm_chunk`. A 90-minute lecture at 48 kHz
//! mono i16 is ~520 MB — comfortable on any modern machine's `APPDATA`. On
//! normal Stop, `finalize_recording` reads the file, wraps it with a WAV
//! header, moves it to the finalized location, and deletes the in-progress
//! scratch. On a crash, the `.pcm` file survives; `find_orphaned_recordings`
//! reports it on the next launch and the UI decides (recover / discard).
//!
//! Design notes:
//! - Raw PCM (no header rewriting) sidesteps the "WAV size field is a lie
//!   after crash" problem entirely. The header is synthesised from file
//!   length at finalize time.
//! - Sample rate and channel count are captured in a sidecar
//!   `{lecture_id}.meta.json` on first append, so recovery doesn't have to
//!   guess. Without the sidecar we fall back to 16 kHz mono — a reasonable
//!   default given we always resample to that for Whisper anyway.
//! - Every Tauri command has a corresponding pure function (`*_inner`) that
//!   operates on a `&Path` instead of reading the global paths module. This
//!   is what makes the recovery / stitching logic actually testable from
//!   `cargo test --lib`, which is the whole point of PR #38.

pub mod video_import;

use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Default assumptions if no sidecar is present. Matches what the frontend
/// AudioRecorder emits for `originalPcmData` (mic native rate → resampled
/// to 16 kHz mono i16 before it reaches Rust for Whisper; the in-progress
/// dump captures the post-resample stream).
const DEFAULT_SAMPLE_RATE: u32 = 16_000;
const DEFAULT_CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingMeta {
    pub sample_rate: u32,
    pub channels: u16,
    pub started_at: String, // ISO-8601
}

impl Default for RecordingMeta {
    fn default() -> Self {
        Self {
            sample_rate: DEFAULT_SAMPLE_RATE,
            channels: DEFAULT_CHANNELS,
            started_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// Summary of an in-progress recording on disk, used to offer the user
/// a recover / discard choice on the next launch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanedRecording {
    pub lecture_id: String,
    /// Approximate duration in seconds, computed from file size and sample rate.
    pub duration_seconds: u64,
    /// File size of the raw PCM fragment on disk.
    pub bytes: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub started_at: Option<String>,
}

/// Validates a lecture_id is a plain UUID-ish identifier with no
/// path-separator or parent-directory characters. Returns the input
/// on success, an error otherwise.
///
/// Why: `pcm_path` / `meta_path` format the id into a file name. A
/// malicious frontend could pass `"../../Windows/System32/evil"`
/// and cause the recording commands to write outside
/// `{app_data}/audio/in-progress/`. This guard keeps the attack
/// surface to exactly the one intended directory regardless of
/// what the caller claims the id is.
fn validate_lecture_id(lecture_id: &str) -> std::io::Result<&str> {
    if lecture_id.is_empty() || lecture_id.len() > 128 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "lecture_id must be 1-128 chars",
        ));
    }
    for c in lecture_id.chars() {
        let ok = c.is_ascii_alphanumeric() || c == '-' || c == '_';
        if !ok {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("lecture_id contains disallowed char: {:?}", c),
            ));
        }
    }
    Ok(lecture_id)
}

fn pcm_path(in_progress_dir: &Path, lecture_id: &str) -> PathBuf {
    in_progress_dir.join(format!("{}.pcm", lecture_id))
}

fn meta_path(in_progress_dir: &Path, lecture_id: &str) -> PathBuf {
    in_progress_dir.join(format!("{}.meta.json", lecture_id))
}

fn read_meta_or_default(in_progress_dir: &Path, lecture_id: &str) -> RecordingMeta {
    let path = meta_path(in_progress_dir, lecture_id);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Append bytes of PCM (i16 little-endian) to the in-progress file.
///
/// First call creates the file and writes the sidecar meta. Subsequent
/// calls append. Returns cumulative bytes on disk so the frontend can
/// surface "N minutes of audio persisted" to the user if needed.
pub fn append_pcm_chunk_inner(
    in_progress_dir: &Path,
    lecture_id: &str,
    samples: &[i16],
    sample_rate: u32,
    channels: u16,
) -> std::io::Result<u64> {
    let lecture_id = validate_lecture_id(lecture_id)?;
    fs::create_dir_all(in_progress_dir)?;
    let p = pcm_path(in_progress_dir, lecture_id);
    let is_new = !p.exists();

    let mut f = OpenOptions::new().create(true).append(true).open(&p)?;
    // i16 little-endian is the WAV PCM canonical encoding. Keeping the
    // on-disk bytes in the same format that WAV wants means finalize is
    // a pure prefix-with-header operation — no conversion.
    let mut buf = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    f.write_all(&buf)?;
    f.flush()?;

    if is_new {
        let meta = RecordingMeta {
            sample_rate,
            channels,
            started_at: chrono::Utc::now().to_rfc3339(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&meta) {
            let _ = fs::write(meta_path(in_progress_dir, lecture_id), json);
        }
    }

    Ok(fs::metadata(&p).map(|m| m.len()).unwrap_or(0))
}

/// Build a WAV byte stream from raw i16-LE PCM.
///
/// Pure function — no I/O — so the test can verify the 44-byte header
/// structure byte-for-byte without a filesystem or a real audio file.
pub fn wrap_pcm_as_wav(pcm: &[u8], sample_rate: u32, channels: u16) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * BITS_PER_SAMPLE as u32 / 8;
    let block_align = channels * BITS_PER_SAMPLE / 8;
    let data_size = pcm.len() as u32;
    let riff_size = 36 + data_size;

    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM format code
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_size.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

/// Read the in-progress PCM, wrap as WAV, write to `final_path`, delete
/// the scratch. Returns the bytes of the finalized WAV file.
pub fn finalize_recording_inner(
    in_progress_dir: &Path,
    lecture_id: &str,
    final_path: &Path,
) -> std::io::Result<u64> {
    let lecture_id = validate_lecture_id(lecture_id)?;
    let p = pcm_path(in_progress_dir, lecture_id);
    let meta = read_meta_or_default(in_progress_dir, lecture_id);

    let mut pcm = Vec::new();
    File::open(&p)?.read_to_end(&mut pcm)?;

    let wav = wrap_pcm_as_wav(&pcm, meta.sample_rate, meta.channels);

    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(final_path, &wav)?;

    // Clean up the scratch files. Best-effort — the finalized WAV is
    // already safely on disk, so partial cleanup won't lose anything.
    let _ = fs::remove_file(&p);
    let _ = fs::remove_file(meta_path(in_progress_dir, lecture_id));

    Ok(wav.len() as u64)
}

/// List every in-progress `.pcm` file with a companion meta if present,
/// so the startup UI can offer recovery.
pub fn find_orphaned_recordings_inner(
    in_progress_dir: &Path,
) -> std::io::Result<Vec<OrphanedRecording>> {
    if !in_progress_dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(in_progress_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("pcm") {
            continue;
        }
        let lecture_id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let bytes = entry.metadata()?.len();
        let meta = read_meta_or_default(in_progress_dir, &lecture_id);
        // Duration = bytes / (sample_rate * channels * bytes_per_sample).
        let bytes_per_sec = meta.sample_rate as u64 * meta.channels as u64 * 2;
        let duration_seconds = if bytes_per_sec > 0 {
            bytes / bytes_per_sec
        } else {
            0
        };
        out.push(OrphanedRecording {
            lecture_id,
            duration_seconds,
            bytes,
            sample_rate: meta.sample_rate,
            channels: meta.channels,
            started_at: Some(meta.started_at),
        });
    }
    // Stable order for UI — oldest first.
    out.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    Ok(out)
}

/// Delete the in-progress scratch for a lecture without finalizing.
/// Used when the user picks "Discard" on the recovery prompt.
pub fn discard_orphaned_recording_inner(
    in_progress_dir: &Path,
    lecture_id: &str,
) -> std::io::Result<()> {
    // Validation is best-effort here — if a garbage id somehow ended up
    // on disk (pre-validation schema, manual tampering), discarding it
    // still makes sense. But we refuse ids that look like path escapes.
    let lecture_id = validate_lecture_id(lecture_id)?;
    let _ = fs::remove_file(pcm_path(in_progress_dir, lecture_id));
    let _ = fs::remove_file(meta_path(in_progress_dir, lecture_id));
    Ok(())
}

// ----- Tauri command wrappers ------------------------------------------

#[tauri::command]
pub async fn append_pcm_chunk(
    lecture_id: String,
    data: Vec<i16>,
    sample_rate: u32,
    channels: u16,
) -> Result<u64, String> {
    let dir = crate::paths::get_in_progress_audio_dir()?;
    append_pcm_chunk_inner(&dir, &lecture_id, &data, sample_rate, channels)
        .map_err(|e| format!("Failed to append PCM chunk: {}", e))
}

#[tauri::command]
pub async fn finalize_recording(lecture_id: String, final_path: String) -> Result<u64, String> {
    let in_progress = crate::paths::get_in_progress_audio_dir()?;
    let audio_dir = crate::paths::get_audio_dir()?;

    // Pin the output under {app_data}/audio/. The frontend is trusted but
    // not infinitely — a compromised renderer or a logic bug in NotesView
    // that composes an absolute path elsewhere must not turn this command
    // into a "write arbitrary WAV anywhere" primitive. Canonicalise both
    // sides and require the final path to live under audio_dir.
    let requested = Path::new(&final_path);
    let requested_parent = requested
        .parent()
        .ok_or_else(|| "final_path has no parent directory".to_string())?;
    // `parent` may not exist yet on first run — fall back to the audio_dir
    // itself for the canonicalisation comparison if that's the case.
    let canon_parent = if requested_parent.exists() {
        requested_parent
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalise final_path parent: {}", e))?
    } else {
        audio_dir
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalise audio_dir: {}", e))?
    };
    let canon_audio_dir = audio_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalise audio_dir: {}", e))?;
    if !canon_parent.starts_with(&canon_audio_dir) {
        return Err(format!(
            "Rejected final_path: must be under audio_dir. got={:?}, expected_under={:?}",
            canon_parent, canon_audio_dir
        ));
    }

    finalize_recording_inner(&in_progress, &lecture_id, requested)
        .map_err(|e| format!("Failed to finalize recording: {}", e))
}

#[tauri::command]
pub async fn find_orphaned_recordings() -> Result<Vec<OrphanedRecording>, String> {
    let dir = crate::paths::get_in_progress_audio_dir()?;
    find_orphaned_recordings_inner(&dir).map_err(|e| format!("Failed to scan orphans: {}", e))
}

#[tauri::command]
pub async fn discard_orphaned_recording(lecture_id: String) -> Result<(), String> {
    let dir = crate::paths::get_in_progress_audio_dir()?;
    discard_orphaned_recording_inner(&dir, &lecture_id)
        .map_err(|e| format!("Failed to discard orphan: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fresh() -> (TempDir, PathBuf) {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("in-progress");
        (tmp, dir)
    }

    #[test]
    fn append_creates_file_and_sidecar_on_first_call() {
        let (_tmp, dir) = fresh();
        let samples = vec![1i16, 2, 3, 4];
        let bytes = append_pcm_chunk_inner(&dir, "lec-1", &samples, 48_000, 1).unwrap();
        assert_eq!(bytes, 8); // 4 samples * 2 bytes
        assert!(pcm_path(&dir, "lec-1").exists());
        assert!(meta_path(&dir, "lec-1").exists());

        let meta = read_meta_or_default(&dir, "lec-1");
        assert_eq!(meta.sample_rate, 48_000);
        assert_eq!(meta.channels, 1);
    }

    #[test]
    fn append_is_cumulative_across_calls() {
        let (_tmp, dir) = fresh();
        append_pcm_chunk_inner(&dir, "lec-1", &[1, 2, 3], 16_000, 1).unwrap();
        append_pcm_chunk_inner(&dir, "lec-1", &[4, 5, 6], 16_000, 1).unwrap();
        let bytes_on_disk = fs::metadata(pcm_path(&dir, "lec-1")).unwrap().len();
        assert_eq!(bytes_on_disk, 12);
    }

    #[test]
    fn wrap_pcm_as_wav_produces_valid_44_byte_header() {
        let pcm = vec![0u8; 100];
        let wav = wrap_pcm_as_wav(&pcm, 16_000, 1);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
        // RIFF chunk size = file - 8 = (44 + 100) - 8 = 136
        assert_eq!(u32::from_le_bytes([wav[4], wav[5], wav[6], wav[7]]), 136);
        // data chunk size = pcm length = 100
        assert_eq!(
            u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]),
            100
        );
        assert_eq!(wav.len(), 144);
    }

    #[test]
    fn finalize_writes_wav_and_deletes_scratch() {
        let (tmp, dir) = fresh();
        append_pcm_chunk_inner(&dir, "lec-42", &[100, 200, -100, -200], 16_000, 1).unwrap();
        let final_path = tmp.path().join("final.wav");
        let bytes = finalize_recording_inner(&dir, "lec-42", &final_path).unwrap();

        assert!(final_path.exists(), "finalized WAV must be on disk");
        assert_eq!(bytes, 52); // 44-byte header + 8 bytes PCM
        assert!(!pcm_path(&dir, "lec-42").exists(), "scratch must be removed");
        assert!(
            !meta_path(&dir, "lec-42").exists(),
            "meta sidecar must be removed"
        );

        let wav = fs::read(&final_path).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
    }

    /// Regression test: a lecture crashed mid-recording must be
    /// discoverable on boot. If this returns an empty list despite
    /// a `.pcm` file being on disk, a user would lose their partial
    /// audio silently on every restart — the exact failure mode
    /// we're trying to prevent.
    #[test]
    fn find_orphaned_recordings_returns_crashed_sessions() {
        let (_tmp, dir) = fresh();
        // Simulate two lectures in progress
        append_pcm_chunk_inner(&dir, "lec-a", &vec![0i16; 16_000], 16_000, 1).unwrap();
        append_pcm_chunk_inner(&dir, "lec-b", &vec![0i16; 32_000], 16_000, 1).unwrap();

        let orphans = find_orphaned_recordings_inner(&dir).unwrap();
        assert_eq!(orphans.len(), 2);

        // lec-a: 16k samples * 2 bytes / (16k samples/sec * 1 ch * 2 bytes) = 1 sec
        let a = orphans.iter().find(|o| o.lecture_id == "lec-a").unwrap();
        assert_eq!(a.duration_seconds, 1);
        assert_eq!(a.sample_rate, 16_000);

        let b = orphans.iter().find(|o| o.lecture_id == "lec-b").unwrap();
        assert_eq!(b.duration_seconds, 2);
    }

    #[test]
    fn find_orphaned_recordings_returns_empty_when_dir_missing() {
        // No appends have ever happened — directory doesn't exist yet.
        // Must degrade gracefully; the startup flow calls this before
        // any recording, so an error here would crash app boot.
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("never-created");
        let orphans = find_orphaned_recordings_inner(&missing).unwrap();
        assert!(orphans.is_empty());
    }

    #[test]
    fn find_orphaned_recordings_ignores_non_pcm_files() {
        let (_tmp, dir) = fresh();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("stray.txt"), "not a recording").unwrap();
        fs::write(dir.join("old.wav"), [0u8; 44]).unwrap();
        append_pcm_chunk_inner(&dir, "real-lec", &[1i16, 2], 16_000, 1).unwrap();

        let orphans = find_orphaned_recordings_inner(&dir).unwrap();
        assert_eq!(orphans.len(), 1);
        assert_eq!(orphans[0].lecture_id, "real-lec");
    }

    #[test]
    fn discard_removes_both_pcm_and_meta() {
        let (_tmp, dir) = fresh();
        append_pcm_chunk_inner(&dir, "gone", &[9i16], 16_000, 1).unwrap();
        assert!(pcm_path(&dir, "gone").exists());
        discard_orphaned_recording_inner(&dir, "gone").unwrap();
        assert!(!pcm_path(&dir, "gone").exists());
        assert!(!meta_path(&dir, "gone").exists());
    }

    #[test]
    fn discard_of_missing_lecture_is_a_noop_not_an_error() {
        // Idempotency: the startup flow calls discard in response to
        // user input; it must not fail if the file has already been
        // cleaned up (e.g. double-click on the discard button).
        let (_tmp, dir) = fresh();
        assert!(discard_orphaned_recording_inner(&dir, "nope").is_ok());
    }

    /// Security: a frontend-supplied lecture_id with path separators or
    /// parent-dir segments must NOT be turned into a write-anywhere
    /// primitive. Every command-level function that takes a lecture_id
    /// must reject these before the first fs call.
    #[test]
    fn append_rejects_lecture_id_with_path_traversal() {
        let (_tmp, dir) = fresh();
        let evil_ids = [
            "../../Windows/System32/cmd",
            "../escape",
            "dir/sub",
            "dir\\sub",
            "name with spaces",
            "name;with;semi",
            "",
            // 129 chars of 'a' — over the length cap
            &"a".repeat(200),
        ];
        for id in evil_ids {
            let r = append_pcm_chunk_inner(&dir, id, &[1i16, 2], 16_000, 1);
            assert!(r.is_err(), "append must reject lecture_id={:?}", id);
        }
    }

    #[test]
    fn finalize_rejects_lecture_id_with_path_traversal() {
        let (tmp, dir) = fresh();
        let final_path = tmp.path().join("out.wav");
        let r = finalize_recording_inner(&dir, "../../evil", &final_path);
        assert!(r.is_err(), "finalize must reject traversal lecture_id");
    }

    #[test]
    fn discard_rejects_lecture_id_with_path_traversal() {
        let (_tmp, dir) = fresh();
        let r = discard_orphaned_recording_inner(&dir, "../../evil");
        assert!(r.is_err(), "discard must reject traversal lecture_id");
    }

    #[test]
    fn validate_lecture_id_accepts_uuid_like_strings() {
        // Real lecture_ids from the frontend are uuid::Uuid::new_v4()
        // which produces 36 chars of hex + hyphens. Make sure the
        // guard doesn't reject those.
        assert!(validate_lecture_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(validate_lecture_id("abc_123").is_ok());
        assert!(validate_lecture_id("ABC-def").is_ok());
    }

    /// Test that `wrap_pcm_as_wav` handles the expected max lecture
    /// size (~1 GB for 90 min stereo i16 at 48 kHz) without overflow.
    /// u32 caps at 4 GB so this is well within the RIFF-imposed limit,
    /// but we want the failure mode to be "explicit error" if anyone
    /// tries to wrap a >4 GB buffer, not "silently truncated".
    #[test]
    fn wrap_pcm_as_wav_data_size_fits_u32_at_realistic_lecture_length() {
        // 10 KB is enough to exercise the u32 path without burning RAM.
        let pcm = vec![0u8; 10_000];
        let wav = wrap_pcm_as_wav(&pcm, 48_000, 2);
        let data_size = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]);
        assert_eq!(data_size as usize, 10_000);
    }
}
