//! In-process Nemotron streaming ASR engine.
//!
//! Wraps `parakeet_rs::Nemotron` for cache-aware streaming transcription.
//! Replaces the previous Python-sidecar-over-HTTP design — same model
//! family, but the audio pipeline never leaves the Rust process. Big
//! wins for our lecture/simultaneous-interpretation use case:
//!
//!   * No Python install / venv / uv setup for users.
//!   * No HTTP roundtrip per chunk — push is a function call.
//!   * No SSE retry/backoff dance on the renderer side; events flow
//!     out via `app.emit("asr-text", …)` like every other Tauri event.
//!   * One ort runtime, one onnxruntime.dll, shared with everything
//!     else (Silero VAD, Candle BGE) instead of two duplicated stacks.
//!
//! Concurrency model: one user, one mic, one active session at a time.
//! A global `OnceLock<Mutex<EngineState>>` protects the model and the
//! per-session buffer. Tauri commands wrap calls in
//! `tokio::task::spawn_blocking` so the inference work doesn't stall
//! the runtime; the engine itself is sync. If we ever need
//! concurrent sessions (e.g. importing a video while recording live),
//! `parakeet_rs::Nemotron::from_shared` lets multiple decoders share
//! one set of weights at ~7.5 MB extra per stream — but that's a
//! later step; today's API is single-session.
//!
//! Streaming protocol: `transcribe_chunk(&[f32; 8960])` returns the
//! delta text the model just committed (cumulative is available via
//! `get_transcript()`). We forward each non-empty delta to a caller-
//! supplied `emit` callback; the lib.rs command layer turns that into
//! a Tauri event. Audio timestamps are computed from the running
//! sample-counter — the model itself doesn't expose word-level
//! timestamps in this API, so the renderer fakes per-word stamps by
//! splitting the delta evenly across `audio_end_sec - last_audio_end_sec`.
//! Good enough for sentence boundary detection (the only consumer) but
//! NOT a substitute for real word-level timing if we ever want that.

use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use parakeet_rs::Nemotron;

use super::parakeet_model::Variant;

/// Sample rate the model was trained on. Anything else upstream MUST
/// resample first; the model has no resampler of its own.
pub const SAMPLE_RATE: u32 = 16_000;

/// Per-chunk sample count Nemotron's cache-aware pipeline expects.
/// 8960 samples = 560 ms @ 16 kHz. The model also supports 80/160/1120
/// ms chunks but the crate's `examples/streaming.rs` settles on 560
/// as the latency/quality sweet spot, and changing it has cascade
/// effects on internal cache layout — sticking with the documented
/// value avoids surprises.
pub const CHUNK_SAMPLES: usize = 8_960;

/// Number of empty-buffer flushes at session end — drains words the
/// model held back waiting for trailing context. Same value the
/// crate's `examples/streaming.rs` uses.
const FLUSH_ITERATIONS: usize = 3;

static ENGINE: OnceLock<Mutex<EngineState>> = OnceLock::new();

fn engine_lock() -> MutexGuard<'static, EngineState> {
    ENGINE
        .get_or_init(|| Mutex::new(EngineState::new()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

pub struct EngineState {
    model: Option<Nemotron>,
    loaded_variant: Option<Variant>,
    active: Option<ActiveSession>,
}

struct ActiveSession {
    id: String,
    #[allow(dead_code)] // surfaced via wall-clock metrics in a later pass
    started_at: Instant,
    /// Samples accumulated but not yet sent to the model — sub-chunk
    /// remainder from the last `push_pcm_i16` call.
    pcm_buffer: Vec<f32>,
    /// Cumulative samples that have been pushed through
    /// `transcribe_chunk`. Used to compute audio_end timestamps.
    samples_processed: usize,
}

impl EngineState {
    fn new() -> Self {
        Self { model: None, loaded_variant: None, active: None }
    }

    pub fn is_loaded(&self) -> bool {
        self.model.is_some()
    }

    pub fn loaded_variant(&self) -> Option<Variant> {
        self.loaded_variant
    }

    pub fn has_session(&self) -> bool {
        self.active.is_some()
    }

    /// Load (or swap) the Nemotron model. If the requested variant is
    /// already loaded, no-ops. If a *different* variant is loaded,
    /// drops it first and loads the new one — useful for the eval
    /// example that A/Bs INT8 vs FP32 in one process.
    pub fn ensure_loaded(&mut self, variant: Variant, dir: &Path) -> Result<(), String> {
        if self.model.is_some() && self.loaded_variant == Some(variant) {
            return Ok(());
        }
        // Different variant requested or first load — drop any
        // existing model + session before allocating the new one.
        self.active = None;
        self.model = None;
        self.loaded_variant = None;

        let m = Nemotron::from_pretrained(dir, None).map_err(|e| {
            format!(
                "Nemotron::from_pretrained({}) failed: {e}",
                dir.display()
            )
        })?;
        self.model = Some(m);
        self.loaded_variant = Some(variant);
        Ok(())
    }

    pub fn unload(&mut self) {
        self.active = None;
        self.model = None;
        self.loaded_variant = None;
    }

    /// Open a session. The caller picks the id (typically a UUID
    /// generated on the renderer side and threaded through the
    /// `asr_start_session` command) so the renderer can correlate
    /// events without an extra round-trip.
    pub fn start_session(&mut self, id: String) -> Result<(), String> {
        let model = self
            .model
            .as_mut()
            .ok_or_else(|| "model not loaded — call ensure_loaded first".to_string())?;
        if self.active.is_some() {
            return Err(
                "another session already active — call end_session first".to_string(),
            );
        }
        model.reset();
        self.active = Some(ActiveSession {
            id,
            started_at: Instant::now(),
            pcm_buffer: Vec::with_capacity(CHUNK_SAMPLES * 2),
            samples_processed: 0,
        });
        Ok(())
    }

    /// Push int16 PCM. Drains the buffer in 8960-sample chunks and
    /// invokes `emit(delta, transcript, audio_end_sec)` once per
    /// non-empty delta. `transcript` is the model's cumulative text
    /// after applying Nemotron's own stabilization/cleanup.
    /// Sub-chunk leftovers stay in the buffer until the next push.
    pub fn push_pcm_i16<F>(
        &mut self,
        session_id: &str,
        pcm: &[i16],
        mut emit: F,
    ) -> Result<(), String>
    where
        F: FnMut(&str, &str, f32),
    {
        let model = self
            .model
            .as_mut()
            .ok_or_else(|| "model not loaded".to_string())?;
        let session = self
            .active
            .as_mut()
            .ok_or_else(|| "no active session".to_string())?;
        if session.id != session_id {
            return Err(format!(
                "session id mismatch: active={}, got={}",
                session.id, session_id
            ));
        }

        // i16 → f32 normalize to [-1, 1]. The crate's example uses
        // /32768.0; we mirror it. Slightly asymmetric (i16 min is
        // -32768, max is +32767) but the half-LSB skew at peak is
        // inaudible and matches every other ASR pipeline's convention.
        session.pcm_buffer.reserve(pcm.len());
        for &s in pcm {
            session.pcm_buffer.push(s as f32 / 32_768.0);
        }

        while session.pcm_buffer.len() >= CHUNK_SAMPLES {
            let chunk: Vec<f32> = session.pcm_buffer.drain(..CHUNK_SAMPLES).collect();
            let delta = model
                .transcribe_chunk(&chunk)
                .map_err(|e| format!("transcribe_chunk failed: {e}"))?;
            session.samples_processed += CHUNK_SAMPLES;
            if !delta.is_empty() {
                let audio_end = session.samples_processed as f32 / SAMPLE_RATE as f32;
                let transcript = model.get_transcript();
                emit(&delta, &transcript, audio_end);
            }
        }
        Ok(())
    }

    /// End-of-stream: pad the remainder, run zero-flushes, and return
    /// the cumulative transcript. Idempotent guard — second call
    /// returns "no active session" rather than corrupting state.
    pub fn end_session<F>(
        &mut self,
        session_id: &str,
        mut emit: F,
    ) -> Result<String, String>
    where
        F: FnMut(&str, &str, f32),
    {
        let model = self
            .model
            .as_mut()
            .ok_or_else(|| "model not loaded".to_string())?;
        let session = self
            .active
            .as_mut()
            .ok_or_else(|| "no active session".to_string())?;
        if session.id != session_id {
            return Err(format!(
                "session id mismatch: active={}, got={}",
                session.id, session_id
            ));
        }

        // Pad-and-process any sub-chunk tail (up to 559 ms).
        if !session.pcm_buffer.is_empty() {
            let mut tail = std::mem::take(&mut session.pcm_buffer);
            tail.resize(CHUNK_SAMPLES, 0.0);
            let delta = model
                .transcribe_chunk(&tail)
                .map_err(|e| format!("flush tail: transcribe_chunk failed: {e}"))?;
            session.samples_processed += CHUNK_SAMPLES;
            if !delta.is_empty() {
                let audio_end = session.samples_processed as f32 / SAMPLE_RATE as f32;
                let transcript = model.get_transcript();
                emit(&delta, &transcript, audio_end);
            }
        }

        // Drain the decoder. Synthetic zeros — don't credit them to
        // samples_processed (these chunks aren't real audio time).
        let zeros = vec![0.0_f32; CHUNK_SAMPLES];
        for _ in 0..FLUSH_ITERATIONS {
            let delta = model
                .transcribe_chunk(&zeros)
                .map_err(|e| format!("flush zero-chunk failed: {e}"))?;
            if !delta.is_empty() {
                let audio_end = session.samples_processed as f32 / SAMPLE_RATE as f32;
                let transcript = model.get_transcript();
                emit(&delta, &transcript, audio_end);
            }
        }

        let transcript = model.get_transcript();
        self.active = None;
        Ok(transcript)
    }
}

// ----- thin module-level wrappers used by lib.rs Tauri commands -----

pub fn is_loaded() -> bool {
    engine_lock().is_loaded()
}

pub fn loaded_variant() -> Option<Variant> {
    engine_lock().loaded_variant()
}

pub fn has_session() -> bool {
    engine_lock().has_session()
}

pub fn ensure_loaded(variant: Variant, dir: &Path) -> Result<(), String> {
    engine_lock().ensure_loaded(variant, dir)
}

pub fn unload() {
    engine_lock().unload();
}

pub fn start_session(id: String) -> Result<(), String> {
    engine_lock().start_session(id)
}

pub fn push_pcm_i16<F>(session_id: &str, pcm: &[i16], emit: F) -> Result<(), String>
where
    F: FnMut(&str, &str, f32),
{
    engine_lock().push_pcm_i16(session_id, pcm, emit)
}

pub fn end_session<F>(session_id: &str, emit: F) -> Result<String, String>
where
    F: FnMut(&str, &str, f32),
{
    engine_lock().end_session(session_id, emit)
}

// ─────────────────────────────────────────────────────────────────────
// cp75.24 — test-only state seams for the variant-switch guard.
//
// `parakeet_load_model` (in lib.rs) refuses model swaps while a session
// is live. The guard checks `has_session()`, which under the hood reads
// `engine.active.is_some()`. Setting `active` from a test normally
// requires `start_session`, which needs a real model loaded — too heavy
// for a unit test (the `.gguf` file isn't available to CI test workers).
//
// These compiled-only-under-`cfg(test)` helpers let the lib.rs tests
// flip the session flag directly and verify the guard's branch
// behaviour without touching any inference machinery.
// ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
pub fn _test_force_session_active(active: bool) {
    let mut engine = engine_lock();
    if active {
        engine.active = Some(ActiveSession {
            id: "__test_session__".to_string(),
            started_at: Instant::now(),
            pcm_buffer: Vec::new(),
            samples_processed: 0,
        });
    } else {
        engine.active = None;
    }
}
