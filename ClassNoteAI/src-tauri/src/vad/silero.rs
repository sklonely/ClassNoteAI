//! Silero VAD v5 — neural voice activity detection.
//!
//! Phase 2 of the v0.6.5 speech-pipeline overhaul ([design](../../../docs/design/speech-pipeline-v0.6.5.md),
//! evaluated in [phase2-analysis-2026-04-23](../../../docs/evals/phase2-analysis-2026-04-23.md)).
//!
//! Replaces the 100-ms RMS energy threshold with Silero's ONNX model
//! (2.3 MB, shipped as a bundle resource). On the 90-s lecture fixture
//! Silero recovers 3 short utterances per clip that the energy VAD
//! drops entirely and trims tails at cleaner sentence boundaries.
//!
//! Design notes:
//!
//! - **Model input** is `[1, 64 + CHUNK]` at 16 kHz, not `[1, CHUNK]`.
//!   The leading 64 samples are the previous frame's tail; without it
//!   Silero's probabilities collapse to ~0. This matches the official
//!   snakers4 Rust example and is **not** documented in the README.
//!
//! - **State** is a `[2, 1, 128]` float tensor carried across calls;
//!   we store it as a flat `Vec<f32>` to sidestep the ndarray version
//!   conflict (lib 0.15 vs ort rc.11's transitive 0.17).
//!
//! - **Fallback** is the caller's responsibility. If this module can't
//!   initialise (missing model, bad ORT DLL, ONNX opset unsupported),
//!   calls return `Err` and [`super::detect_speech_segments_adaptive`]
//!   falls back to the energy VAD. The lecture app must not refuse to
//!   record just because the neural VAD isn't available.
//!
//! - **Thread safety.** `ort::Session::run` requires `&mut self`, so
//!   the process-wide session is held behind a `Mutex`. Single Tauri
//!   caller at a time is the expected pattern; a queue behind the
//!   mutex wouldn't help because Whisper decode dominates anyway.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use ort::session::Session;
use ort::value::Tensor;

use super::SpeechSegment;

/// Silero v5 chunk size at 16 kHz: 512 samples ≈ 32 ms frame.
const CHUNK: usize = 512;
/// Tail samples of the previous frame prepended to each input tensor.
/// Required by the v5 model; see module docs.
const CONTEXT: usize = 64;
/// State dimensions `[2, 1, 128]` flattened to 256 floats.
const STATE_SHAPE: [usize; 3] = [2, 1, 128];
const STATE_LEN: usize = STATE_SHAPE[0] * STATE_SHAPE[1] * STATE_SHAPE[2];

/// Hysteresis: cross this probability to *enter* speech.
pub const DEFAULT_THR_ON: f32 = 0.50;
/// Cross BELOW this probability to *leave* speech.
pub const DEFAULT_THR_OFF: f32 = 0.35;
/// Discard segments shorter than this (likely clicks / plosives).
pub const DEFAULT_MIN_SPEECH_MS: u64 = 500;
/// Merge segments separated by less than this (smooth out brief gaps).
pub const DEFAULT_MIN_SILENCE_MS: u64 = 500;

/// Sticky singleton. First successful `init` wins; later calls with
/// a different path are ignored (changing the model at runtime is not
/// a supported flow).
static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();

/// Initialise the Silero session from an ONNX file. Idempotent — a
/// successful second call with a matching path is a no-op. Returns
/// `Err` if the ORT runtime can't be started (missing DLL, version
/// mismatch) OR if the file is not a valid ONNX graph for Silero v5.
pub fn init(model_path: &Path) -> Result<(), String> {
    if SESSION.get().is_some() {
        return Ok(());
    }
    let session = Session::builder()
        .map_err(|e| format!("Silero: Session::builder failed ({})", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Silero: model load failed ({}): {}", model_path.display(), e))?;
    SESSION
        .set(Mutex::new(session))
        .map_err(|_| "Silero: SESSION set race (unreachable)".to_string())?;
    Ok(())
}

/// Whether a Silero session has been successfully initialised.
pub fn is_initialised() -> bool {
    SESSION.get().is_some()
}

/// Detect speech segments in a PCM buffer. Expects 16 kHz mono i16.
/// Falls back to an empty vec on initialisation/inference errors —
/// callers that want the error should use `try_detect_speech_segments`.
pub fn detect_speech_segments(audio_16k: &[i16]) -> Vec<SpeechSegment> {
    try_detect_speech_segments(audio_16k).unwrap_or_default()
}

/// Like [`detect_speech_segments`] but surfaces inference errors so the
/// dispatcher can distinguish "no speech found" from "Silero broken".
pub fn try_detect_speech_segments(
    audio_16k: &[i16],
) -> Result<Vec<SpeechSegment>, String> {
    let session_mu = SESSION
        .get()
        .ok_or_else(|| "Silero not initialised — call vad::silero::init first".to_string())?;

    let probs = run_inference(session_mu, audio_16k)?;
    let chunk_ms: f64 = (CHUNK as f64 / 16_000.0) * 1_000.0;

    // Hysteresis over the frame probabilities → raw segments.
    let mut raw: Vec<SpeechSegment> = Vec::new();
    let mut in_speech = false;
    let mut start_sample: usize = 0;
    let mut start_ms: u64 = 0;
    for (i, &p) in probs.iter().enumerate() {
        let t_ms = (i as f64 * chunk_ms) as u64;
        let sample_idx = i * CHUNK;
        if !in_speech && p >= DEFAULT_THR_ON {
            in_speech = true;
            start_sample = sample_idx;
            start_ms = t_ms;
        } else if in_speech && p < DEFAULT_THR_OFF {
            in_speech = false;
            let end_sample = sample_idx;
            let end_ms = t_ms;
            if end_ms.saturating_sub(start_ms) >= DEFAULT_MIN_SPEECH_MS {
                raw.push(SpeechSegment {
                    start_sample,
                    end_sample,
                    start_ms,
                    end_ms,
                    avg_energy: 0.0, // Silero doesn't produce an energy stat.
                });
            }
        }
    }
    if in_speech {
        let end_sample = probs.len() * CHUNK;
        let end_ms = (probs.len() as f64 * chunk_ms) as u64;
        if end_ms.saturating_sub(start_ms) >= DEFAULT_MIN_SPEECH_MS {
            raw.push(SpeechSegment {
                start_sample,
                end_sample,
                start_ms,
                end_ms,
                avg_energy: 0.0,
            });
        }
    }

    // Merge segments separated by gaps shorter than MIN_SILENCE_MS — a
    // single-frame silence dip in the middle of a sentence shouldn't
    // split it into two captions.
    let merged = merge_close_segments(raw, DEFAULT_MIN_SILENCE_MS);
    Ok(merged)
}

/// Collapse adjacent segments whose inter-segment gap is below
/// `min_silence_ms`. Public for reuse in tests.
pub fn merge_close_segments(
    mut segs: Vec<SpeechSegment>,
    min_silence_ms: u64,
) -> Vec<SpeechSegment> {
    if segs.len() <= 1 {
        return segs;
    }
    let mut out: Vec<SpeechSegment> = Vec::with_capacity(segs.len());
    let first = segs.remove(0);
    out.push(first);
    for seg in segs {
        let last = out.last_mut().unwrap();
        let gap = seg.start_ms.saturating_sub(last.end_ms);
        if gap < min_silence_ms {
            last.end_ms = seg.end_ms;
            last.end_sample = seg.end_sample;
        } else {
            out.push(seg);
        }
    }
    out
}

/// Slide a 512-sample window across the audio, calling Silero at each
/// step with the previous frame's 64-sample tail prepended. Returns
/// per-frame speech probabilities in emission order.
fn run_inference(
    session_mu: &Mutex<Session>,
    audio_16k: &[i16],
) -> Result<Vec<f32>, String> {
    let mut session = session_mu
        .lock()
        .map_err(|_| "Silero: session mutex poisoned".to_string())?;

    let mut state_flat: Vec<f32> = vec![0.0; STATE_LEN];
    let state_shape: Vec<usize> = STATE_SHAPE.to_vec();
    let sr_shape: Vec<usize> = vec![1];
    let input_len = CONTEXT + CHUNK;

    let mut context_buf: Vec<f32> = vec![0.0; CONTEXT];

    let n_chunks = audio_16k.len() / CHUNK;
    let mut probs: Vec<f32> = Vec::with_capacity(n_chunks);

    for chunk in audio_16k.chunks_exact(CHUNK) {
        let chunk_f32: Vec<f32> = chunk.iter().map(|&s| s as f32 / 32_767.0).collect();
        let mut input_f32: Vec<f32> = Vec::with_capacity(input_len);
        input_f32.extend_from_slice(&context_buf);
        input_f32.extend_from_slice(&chunk_f32);
        context_buf.clear();
        context_buf.extend_from_slice(&chunk_f32[CHUNK - CONTEXT..]);

        let outputs = session
            .run(ort::inputs![
                "input" => Tensor::from_array((vec![1usize, input_len], input_f32))
                    .map_err(|e| format!("Silero: input tensor ({})", e))?,
                "state" => Tensor::from_array((state_shape.clone(), state_flat.clone()))
                    .map_err(|e| format!("Silero: state tensor ({})", e))?,
                "sr" => Tensor::from_array((sr_shape.clone(), vec![16_000i64]))
                    .map_err(|e| format!("Silero: sr tensor ({})", e))?,
            ])
            .map_err(|e| format!("Silero: session.run ({})", e))?;

        let (_, out_flat) = outputs["output"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Silero: extract output ({})", e))?;
        probs.push(out_flat.first().copied().unwrap_or(0.0));

        let (_, new_state) = outputs["stateN"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Silero: extract stateN ({})", e))?;
        if new_state.len() == STATE_LEN {
            state_flat = new_state.to_vec();
        }
    }

    Ok(probs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_seg(start_ms: u64, end_ms: u64) -> SpeechSegment {
        SpeechSegment {
            start_sample: 0,
            end_sample: 0,
            start_ms,
            end_ms,
            avg_energy: 0.0,
        }
    }

    #[test]
    fn merge_close_segments_combines_segments_within_gap() {
        let segs = vec![mk_seg(0, 1000), mk_seg(1300, 2000)];
        let merged = merge_close_segments(segs, 500);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start_ms, 0);
        assert_eq!(merged[0].end_ms, 2000);
    }

    #[test]
    fn merge_close_segments_leaves_segments_with_big_gap_alone() {
        let segs = vec![mk_seg(0, 1000), mk_seg(3000, 4000)];
        let merged = merge_close_segments(segs, 500);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn merge_close_segments_no_op_on_single_or_empty() {
        assert!(merge_close_segments(vec![], 500).is_empty());
        let one = vec![mk_seg(100, 200)];
        let merged = merge_close_segments(one.clone(), 500);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start_ms, 100);
    }

    #[test]
    fn merge_close_segments_chains_multiple_close_neighbors() {
        // Three near-adjacent segments should collapse into one spanning
        // the first's start to the last's end — not two pair-wise merges.
        let segs = vec![
            mk_seg(0, 500),
            mk_seg(800, 1200),
            mk_seg(1500, 2000),
        ];
        let merged = merge_close_segments(segs, 400);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].end_ms, 2000);
    }

    /// Sanity: without an initialised session, detection returns an
    /// explicit error. The dispatcher relies on this to choose
    /// fallback routing rather than misinterpreting silence.
    #[test]
    fn detect_without_init_returns_error() {
        // Note: once another test initialises SESSION, it's sticky for
        // the rest of the process. We rely on test ordering here being
        // "this runs first". If that becomes flaky we can switch to a
        // per-test SESSION cell, but for now the OnceCell matches
        // production semantics exactly.
        if !is_initialised() {
            let err = try_detect_speech_segments(&[0i16; 16_000]);
            assert!(err.is_err());
        }
    }
}
