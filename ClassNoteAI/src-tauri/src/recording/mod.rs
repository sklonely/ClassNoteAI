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
    /// Number of transcript segments persisted to the sidecar JSONL
    /// while recording. 0 means no transcript was captured (older builds,
    /// or a crash before the first segment committed).
    #[serde(default)]
    pub transcript_segments: u64,
}

/// One transcript segment as it lived in the frontend's pending queue.
/// JSONL = one of these per line, append-only, written by the renderer
/// every time `commitStableText` lands a stable rough/fine pass. On
/// recovery we parse the file into this shape and let the frontend
/// insert any rows that never made it to sqlite (the periodic
/// `savePendingSubtitles` flush is every 10s, so a crash in the
/// 9.999s gap loses everything in between without this sidecar).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedTranscriptSegment {
    pub id: String,
    /// Seconds from epoch (matches `pending_subtitles.timestamp` shape
    /// in the frontend; sqlite expects f64 seconds, so we keep it as-is).
    pub timestamp: f64,
    pub text_en: String,
    #[serde(default)]
    pub text_zh: Option<String>,
    /// `"rough"` for the streaming pass; `"fine"` for the LLM-refined
    /// follow-up that overwrites it. Only `"rough"` lines are required
    /// for recovery; `"fine"` is best-effort (the refinement queue is
    /// allowed to drop on crash without data loss).
    #[serde(rename = "type")]
    pub kind: String,
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

fn transcript_path(in_progress_dir: &Path, lecture_id: &str) -> PathBuf {
    in_progress_dir.join(format!("{}.transcript.jsonl", lecture_id))
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

/// Append a single transcript segment to the lecture's JSONL sidecar.
/// One write per line — append-only, atomic enough that a partially-
/// written final line is just dropped by `read_transcript_segments_inner`'s
/// per-line parse. We never rewrite the file, so a crash mid-line at
/// most loses the in-flight segment, never anything previously committed.
pub fn append_transcript_segment_inner(
    in_progress_dir: &Path,
    lecture_id: &str,
    segment: &PersistedTranscriptSegment,
) -> std::io::Result<u64> {
    let lecture_id = validate_lecture_id(lecture_id)?;
    fs::create_dir_all(in_progress_dir)?;
    let p = transcript_path(in_progress_dir, lecture_id);

    let mut line = serde_json::to_string(segment)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    line.push('\n');

    let mut f = OpenOptions::new().create(true).append(true).open(&p)?;
    f.write_all(line.as_bytes())?;
    f.flush()?;

    Ok(fs::metadata(&p).map(|m| m.len()).unwrap_or(0))
}

/// Read every well-formed JSON line out of the transcript sidecar.
/// Any line that fails to parse is logged-and-skipped — recovery is
/// best-effort by design, and a single corrupted final line should
/// never block restoration of everything that came before it.
pub fn read_transcript_segments_inner(
    in_progress_dir: &Path,
    lecture_id: &str,
) -> std::io::Result<Vec<PersistedTranscriptSegment>> {
    let lecture_id = validate_lecture_id(lecture_id)?;
    let p = transcript_path(in_progress_dir, lecture_id);
    if !p.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&p)?;
    let mut out = Vec::new();
    for (idx, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<PersistedTranscriptSegment>(trimmed) {
            Ok(seg) => out.push(seg),
            Err(e) => {
                eprintln!(
                    "[recording] transcript JSONL line {} for {} unparseable, skipping: {}",
                    idx + 1,
                    lecture_id,
                    e
                );
            }
        }
    }
    Ok(out)
}

/// Count parseable lines without materialising the full segment list.
/// Used by `find_orphaned_recordings_inner` so the recovery UI can
/// show "+N transcript segments" alongside the audio duration without
/// pulling potentially-thousands of segments into a Tauri payload
/// every app boot.
fn count_transcript_segments(in_progress_dir: &Path, lecture_id: &str) -> u64 {
    let p = transcript_path(in_progress_dir, lecture_id);
    let Ok(raw) = fs::read_to_string(&p) else {
        return 0;
    };
    raw.lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && serde_json::from_str::<serde_json::Value>(t).is_ok()
        })
        .count() as u64
}

/// Delete the transcript JSONL for a lecture. Called by `discard_*`
/// (user chose to throw the recording away) and after recovery has
/// successfully migrated segments into sqlite.
pub fn discard_transcript_segments_inner(
    in_progress_dir: &Path,
    lecture_id: &str,
) -> std::io::Result<()> {
    let lecture_id = validate_lecture_id(lecture_id)?;
    let _ = fs::remove_file(transcript_path(in_progress_dir, lecture_id));
    Ok(())
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
    // Transcript JSONL is the caller's responsibility (the frontend
    // recovery flow imports those rows into sqlite first, then asks
    // us to discard); we don't touch it here.
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
        let transcript_segments = count_transcript_segments(in_progress_dir, &lecture_id);
        out.push(OrphanedRecording {
            lecture_id,
            duration_seconds,
            bytes,
            sample_rate: meta.sample_rate,
            channels: meta.channels,
            started_at: Some(meta.started_at),
            transcript_segments,
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
    let _ = fs::remove_file(transcript_path(in_progress_dir, lecture_id));
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

#[tauri::command]
pub async fn append_transcript_segment(
    lecture_id: String,
    segment: PersistedTranscriptSegment,
) -> Result<u64, String> {
    let dir = crate::paths::get_in_progress_audio_dir()?;
    append_transcript_segment_inner(&dir, &lecture_id, &segment)
        .map_err(|e| format!("Failed to append transcript segment: {}", e))
}

#[tauri::command]
pub async fn read_orphaned_transcript(
    lecture_id: String,
) -> Result<Vec<PersistedTranscriptSegment>, String> {
    let dir = crate::paths::get_in_progress_audio_dir()?;
    read_transcript_segments_inner(&dir, &lecture_id)
        .map_err(|e| format!("Failed to read transcript: {}", e))
}

#[tauri::command]
pub async fn discard_orphaned_transcript(lecture_id: String) -> Result<(), String> {
    let dir = crate::paths::get_in_progress_audio_dir()?;
    discard_transcript_segments_inner(&dir, &lecture_id)
        .map_err(|e| format!("Failed to discard transcript: {}", e))
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
        assert!(
            !pcm_path(&dir, "lec-42").exists(),
            "scratch must be removed"
        );
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

    // ===== Transcript JSONL persistence (Phase 1 of speech-pipeline-v0.6.5) =====

    fn sample_segment(id: &str, text: &str) -> PersistedTranscriptSegment {
        PersistedTranscriptSegment {
            id: id.to_string(),
            timestamp: 1.0,
            text_en: text.to_string(),
            text_zh: None,
            kind: "rough".to_string(),
        }
    }

    #[test]
    fn append_transcript_creates_file_and_each_call_adds_one_line() {
        let (_tmp, dir) = fresh();
        append_transcript_segment_inner(&dir, "lec-t", &sample_segment("a", "first")).unwrap();
        append_transcript_segment_inner(&dir, "lec-t", &sample_segment("b", "second")).unwrap();
        let raw = fs::read_to_string(transcript_path(&dir, "lec-t")).unwrap();
        assert_eq!(raw.lines().count(), 2, "one line per segment");
    }

    #[test]
    fn read_transcript_round_trips_all_well_formed_segments() {
        let (_tmp, dir) = fresh();
        let s1 = sample_segment("a", "hello");
        let s2 = PersistedTranscriptSegment {
            id: "b".to_string(),
            timestamp: 2.5,
            text_en: "world".to_string(),
            text_zh: Some("世界".to_string()),
            kind: "fine".to_string(),
        };
        append_transcript_segment_inner(&dir, "lec-r", &s1).unwrap();
        append_transcript_segment_inner(&dir, "lec-r", &s2).unwrap();

        let segs = read_transcript_segments_inner(&dir, "lec-r").unwrap();
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].id, "a");
        assert_eq!(segs[1].id, "b");
        assert_eq!(segs[1].text_zh.as_deref(), Some("世界"));
        assert_eq!(segs[1].kind, "fine");
    }

    #[test]
    fn read_transcript_skips_corrupt_lines_but_keeps_good_ones() {
        // Simulates a crash mid-write: previous lines are clean JSONL,
        // last line is a half-flushed garbage. Recovery must NOT discard
        // the first N segments because of the truncated tail.
        let (_tmp, dir) = fresh();
        fs::create_dir_all(&dir).unwrap();
        let mut content = String::new();
        content.push_str(&serde_json::to_string(&sample_segment("good-1", "first")).unwrap());
        content.push('\n');
        content.push_str(&serde_json::to_string(&sample_segment("good-2", "second")).unwrap());
        content.push('\n');
        content.push_str("{\"id\":\"truncated"); // half-written line, no closing }
        fs::write(transcript_path(&dir, "lec-mix"), content).unwrap();

        let segs = read_transcript_segments_inner(&dir, "lec-mix").unwrap();
        assert_eq!(segs.len(), 2, "must keep the 2 well-formed lines");
        assert_eq!(segs[0].id, "good-1");
        assert_eq!(segs[1].id, "good-2");
    }

    #[test]
    fn read_transcript_returns_empty_when_no_jsonl_file() {
        let (_tmp, dir) = fresh();
        let segs = read_transcript_segments_inner(&dir, "never-recorded").unwrap();
        assert!(segs.is_empty());
    }

    #[test]
    fn count_transcript_segments_matches_read_length() {
        let (_tmp, dir) = fresh();
        for i in 0..7 {
            append_transcript_segment_inner(
                &dir,
                "lec-c",
                &sample_segment(&format!("s-{}", i), "x"),
            )
            .unwrap();
        }
        assert_eq!(count_transcript_segments(&dir, "lec-c"), 7);
        assert_eq!(count_transcript_segments(&dir, "missing"), 0);
    }

    #[test]
    fn find_orphaned_recordings_includes_transcript_segment_count() {
        let (_tmp, dir) = fresh();
        append_pcm_chunk_inner(&dir, "lec-with-tx", &vec![0i16; 16_000], 16_000, 1).unwrap();
        for i in 0..3 {
            append_transcript_segment_inner(
                &dir,
                "lec-with-tx",
                &sample_segment(&format!("seg-{}", i), "text"),
            )
            .unwrap();
        }
        let orphans = find_orphaned_recordings_inner(&dir).unwrap();
        let lec = orphans.iter().find(|o| o.lecture_id == "lec-with-tx").unwrap();
        assert_eq!(lec.transcript_segments, 3);
    }

    #[test]
    fn find_orphaned_recordings_reports_zero_segments_for_audio_only_session() {
        // A pre-Phase-1 .pcm with no JSONL companion must still be
        // recoverable — the field defaults to 0, never errors.
        let (_tmp, dir) = fresh();
        append_pcm_chunk_inner(&dir, "audio-only", &vec![0i16; 16_000], 16_000, 1).unwrap();
        let orphans = find_orphaned_recordings_inner(&dir).unwrap();
        let lec = orphans
            .iter()
            .find(|o| o.lecture_id == "audio-only")
            .unwrap();
        assert_eq!(lec.transcript_segments, 0);
    }

    #[test]
    fn discard_orphaned_recording_removes_transcript_jsonl_too() {
        let (_tmp, dir) = fresh();
        append_pcm_chunk_inner(&dir, "to-discard", &vec![0i16; 100], 16_000, 1).unwrap();
        append_transcript_segment_inner(
            &dir,
            "to-discard",
            &sample_segment("seg-1", "should be deleted"),
        )
        .unwrap();
        assert!(transcript_path(&dir, "to-discard").exists());

        discard_orphaned_recording_inner(&dir, "to-discard").unwrap();

        assert!(!pcm_path(&dir, "to-discard").exists());
        assert!(!meta_path(&dir, "to-discard").exists());
        assert!(
            !transcript_path(&dir, "to-discard").exists(),
            "transcript JSONL must be cleaned on discard"
        );
    }

    #[test]
    fn finalize_recording_does_not_delete_transcript_jsonl() {
        // The frontend recovery flow imports the JSONL into sqlite BEFORE
        // calling finalize. If finalize wiped the JSONL too, a recovery
        // failure between import and finalize would lose segments. The
        // explicit cleanup is `discard_orphaned_transcript` after the
        // import succeeds, so finalize is intentionally narrow here.
        let (tmp, dir) = fresh();
        append_pcm_chunk_inner(&dir, "fin-keep", &[1, 2, 3, 4], 16_000, 1).unwrap();
        append_transcript_segment_inner(
            &dir,
            "fin-keep",
            &sample_segment("survived", "I should still be on disk"),
        )
        .unwrap();
        let final_path = tmp.path().join("out.wav");
        finalize_recording_inner(&dir, "fin-keep", &final_path).unwrap();
        assert!(
            transcript_path(&dir, "fin-keep").exists(),
            "finalize is narrow: only PCM + meta cleared, transcript JSONL stays for explicit discard"
        );
    }

    #[test]
    fn append_transcript_rejects_lecture_id_with_path_traversal() {
        let (_tmp, dir) = fresh();
        let r = append_transcript_segment_inner(&dir, "../escape", &sample_segment("x", "y"));
        assert!(r.is_err(), "transcript append must reject path-traversal id");
    }

    #[test]
    fn discard_transcript_rejects_lecture_id_with_path_traversal() {
        let (_tmp, dir) = fresh();
        assert!(discard_transcript_segments_inner(&dir, "../escape").is_err());
    }
}
