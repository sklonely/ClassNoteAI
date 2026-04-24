//! Phase 2 of speech-pipeline-v0.6.5 — VAD comparison harness.
//!
//! Runs the current **energy-based** VAD (what ships today) AND
//! **Silero VAD v5** (the Phase 2 candidate) on the same audio file,
//! then transcribes each VAD's segments with Whisper so we can judge
//! whether the upgrade would produce cleaner subtitle boundaries.
//!
//! Output is a single markdown report with:
//!   1. Side-by-side segment tables (start, end, duration, transcript)
//!   2. An ASCII timeline showing where the two VADs agree/disagree
//!   3. Aggregate metrics (# segments, speech %, mean segment length)
//!
//! Usage (from `ClassNoteAI/src-tauri`):
//!   cargo run --release --example phase2_vad_eval -- /path/to/lecture.wav
//!
//! The eval depends only on `voice_activity_detector` (dev-dep) + the
//! lib's existing `classnoteai_lib::vad` module. No production code
//! changes — this is pure measurement.

use std::env;
use std::fs;
use std::path::Path;
use std::time::Instant;

use classnoteai_lib::vad::{VadConfig, VadDetector};
use ort::session::Session;
use ort::value::Tensor;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// ---------------------------------------------------------------------
// WAV parsing + 48k→16k decimation (copied from phase0_translation_eval
// so this binary builds standalone without a shared module).
// ---------------------------------------------------------------------

fn read_wav_i16(path: &Path) -> Result<(Vec<i16>, u32), Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(format!("Not a RIFF/WAVE file: {:?}", path).into());
    }
    let mut off = 12;
    let mut channels: u16 = 0;
    let mut sample_rate: u32 = 0;
    let mut bits_per_sample: u16 = 0;
    let mut data_bytes: Option<&[u8]> = None;
    while off + 8 <= bytes.len() {
        let id = &bytes[off..off + 4];
        let sz = u32::from_le_bytes([bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]])
            as usize;
        let body_start = off + 8;
        let body_end = (body_start + sz).min(bytes.len());
        if id == b"fmt " {
            let fmt = &bytes[body_start..body_end];
            if fmt.len() < 16 {
                return Err("fmt chunk too small".into());
            }
            let audio_format = u16::from_le_bytes([fmt[0], fmt[1]]);
            if audio_format != 1 {
                return Err(format!("WAV not PCM (format={})", audio_format).into());
            }
            channels = u16::from_le_bytes([fmt[2], fmt[3]]);
            sample_rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
            bits_per_sample = u16::from_le_bytes([fmt[14], fmt[15]]);
        } else if id == b"data" {
            data_bytes = Some(&bytes[body_start..body_end]);
        }
        off = body_start + sz + (sz & 1);
    }
    if bits_per_sample != 16 {
        return Err(format!("Expected 16-bit PCM, got {}-bit", bits_per_sample).into());
    }
    let data = data_bytes.ok_or("Missing data chunk")?;
    let samples: Vec<i16> = data
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    let mono = if channels <= 1 {
        samples
    } else {
        samples
            .chunks_exact(channels as usize)
            .map(|c| {
                let sum: i32 = c.iter().map(|&s| s as i32).sum();
                (sum / channels as i32) as i16
            })
            .collect()
    };
    Ok((mono, sample_rate))
}

fn downsample_48k_to_16k(samples: &[i16]) -> Vec<i16> {
    samples
        .chunks_exact(3)
        .map(|c| ((c[0] as i32 + c[1] as i32 + c[2] as i32) / 3) as i16)
        .collect()
}

// ---------------------------------------------------------------------
// Common segment shape so both VADs emit the same type.
// ---------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Seg {
    start_ms: u64,
    end_ms: u64,
}
impl Seg {
    fn duration_ms(&self) -> u64 {
        self.end_ms.saturating_sub(self.start_ms)
    }
}

// ---------------------------------------------------------------------
// Silero VAD v5 wrapper. Silero is frame-at-a-time (512 samples @ 16k
// ≈ 32 ms) probability; we threshold + hysteresis to convert into
// segments compatible with the energy-VAD output shape.
// ---------------------------------------------------------------------

fn silero_segments(
    samples_16k: &[i16],
    model_path: &Path,
) -> Result<Vec<Seg>, Box<dyn std::error::Error>> {
    const CHUNK: usize = 512;
    const THR_ON: f32 = 0.50;
    const THR_OFF: f32 = 0.35;
    const MIN_SPEECH_MS: u64 = 250;
    const MIN_SILENCE_MS: u64 = 500;

    // Silero VAD v5 exposes 3 inputs: `input` (audio, shape [1, CHUNK]),
    // `state` (RNN state, shape [2, 1, 128]), `sr` (scalar, i64 sample
    // rate). Outputs: `output` (speech probability, shape [1, 1]) and
    // `stateN` (next RNN state). State is carried across chunks —
    // initial state is all-zeros.
    //
    // We work with raw `Vec<f32>` + explicit shape `Vec<usize>` rather
    // than `ndarray::Array` to sidestep the version mismatch between
    // the lib's `ndarray = "0.15"` and `ort = "2.0.0-rc.11"`'s
    // `ndarray = "0.17"` — both live in the dependency graph and the
    // generic `from_array` bound fails when the two don't agree.
    // Silero v5 takes audio as `[1, CONTEXT + CHUNK]` at 16 kHz. The
    // CONTEXT is 64 samples retained from the previous frame — needed
    // for temporal continuity; without it the model sits at ~0 prob.
    // (Confirmed against the official snakers4 Rust example.)
    const CONTEXT: usize = 64;

    let mut session = Session::builder()?.commit_from_file(model_path)?;
    let mut state_flat: Vec<f32> = vec![0.0; 2 * 1 * 128];
    let state_shape: Vec<usize> = vec![2, 1, 128];
    let sr_shape: Vec<usize> = vec![1];
    let input_len = CONTEXT + CHUNK;

    // Running context window: the trailing CONTEXT samples of the
    // previous frame's audio. Start zero-filled.
    let mut context_buf: Vec<f32> = vec![0.0; CONTEXT];

    let chunk_ms: f64 = (CHUNK as f64 / 16000.0) * 1000.0;
    let mut probs: Vec<f32> = Vec::with_capacity(samples_16k.len() / CHUNK + 1);
    for chunk in samples_16k.chunks_exact(CHUNK) {
        // Normalise with i16::MAX (= 32767) to match the official impl.
        let chunk_f32: Vec<f32> = chunk.iter().map(|&s| s as f32 / 32767.0).collect();
        // Input = [previous 64-sample context] ++ [current 512-sample chunk]
        let mut input_f32 = Vec::with_capacity(input_len);
        input_f32.extend_from_slice(&context_buf);
        input_f32.extend_from_slice(&chunk_f32);

        // Update context_buf to the trailing 64 samples of THIS chunk,
        // ready for the next iteration.
        context_buf.clear();
        context_buf.extend_from_slice(&chunk_f32[CHUNK - CONTEXT..]);

        let outputs = session.run(ort::inputs![
            "input" => Tensor::from_array((vec![1usize, input_len], input_f32))?,
            "state" => Tensor::from_array((state_shape.clone(), state_flat.clone()))?,
            "sr" => Tensor::from_array((sr_shape.clone(), vec![16_000i64]))?,
        ])?;

        // "output" is shape [1, 1] with speech probability.
        let (_, out_flat) = outputs["output"].try_extract_tensor::<f32>()?;
        let p = out_flat.first().copied().unwrap_or(0.0);
        probs.push(p);

        // Carry forward hidden state from "stateN" as a flat Vec.
        let (_, new_state) = outputs["stateN"].try_extract_tensor::<f32>()?;
        if new_state.len() == 256 {
            state_flat = new_state.to_vec();
        }
    }

    // Hysteresis → raw segments.
    let mut segs: Vec<Seg> = Vec::new();
    let mut in_speech = false;
    let mut seg_start_ms: u64 = 0;
    for (i, &p) in probs.iter().enumerate() {
        let t_ms = (i as f64 * chunk_ms) as u64;
        if !in_speech && p >= THR_ON {
            in_speech = true;
            seg_start_ms = t_ms;
        } else if in_speech && p < THR_OFF {
            in_speech = false;
            let end_ms = t_ms;
            if end_ms.saturating_sub(seg_start_ms) >= MIN_SPEECH_MS {
                segs.push(Seg {
                    start_ms: seg_start_ms,
                    end_ms,
                });
            }
        }
    }
    if in_speech {
        let end_ms = (probs.len() as f64 * chunk_ms) as u64;
        if end_ms.saturating_sub(seg_start_ms) >= MIN_SPEECH_MS {
            segs.push(Seg {
                start_ms: seg_start_ms,
                end_ms,
            });
        }
    }

    // Merge segments separated by very short silence (smoothing).
    let mut merged: Vec<Seg> = Vec::new();
    for seg in segs {
        match merged.last_mut() {
            Some(prev) if seg.start_ms.saturating_sub(prev.end_ms) < MIN_SILENCE_MS => {
                prev.end_ms = seg.end_ms;
            }
            _ => merged.push(seg),
        }
    }
    Ok(merged)
}

// ---------------------------------------------------------------------
// Energy VAD (current production). Uses the lib's own detector so this
// is exactly what the app does today.
// ---------------------------------------------------------------------

fn energy_segments(samples_16k: &[i16]) -> Vec<Seg> {
    let cfg = VadConfig::default();
    let detector = VadDetector::new(cfg);
    let raw = detector.detect_speech_segments(samples_16k);
    raw.into_iter()
        .map(|s| Seg {
            start_ms: s.start_ms,
            end_ms: s.end_ms,
        })
        .collect()
}

// ---------------------------------------------------------------------
// Whisper transcription for a single segment's slice.
// ---------------------------------------------------------------------

fn transcribe_slice(
    ctx: &WhisperContext,
    samples_16k: &[i16],
    start_ms: u64,
    end_ms: u64,
) -> Result<String, Box<dyn std::error::Error>> {
    let start_idx = ((start_ms as usize) * 16000 / 1000).min(samples_16k.len());
    let end_idx = ((end_ms as usize) * 16000 / 1000).min(samples_16k.len());
    if end_idx <= start_idx {
        return Ok(String::new());
    }
    let slice = &samples_16k[start_idx..end_idx];
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("create_state: {:?}", e))?;
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: 1.0,
    });
    params.set_n_threads(num_cpus::get().min(8) as i32);
    params.set_translate(false);
    params.set_language(None); // auto-detect (fast on short segments)
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);

    let audio_f32: Vec<f32> = slice.iter().map(|&s| s as f32 / 32768.0).collect();
    // Whisper expects at least 1 s; pad shorter slices with silence so
    // the decoder doesn't crash on sub-100 ms bursts (which Silero can
    // emit on very short utterances like "yeah?").
    let min_samples = 16_000; // 1 s
    let padded: Vec<f32> = if audio_f32.len() < min_samples {
        let mut v = audio_f32;
        v.resize(min_samples, 0.0);
        v
    } else {
        audio_f32
    };
    state
        .full(params, &padded)
        .map_err(|e| format!("whisper full: {:?}", e))?;
    let n = state.full_n_segments();
    let mut out = String::new();
    for i in 0..n {
        let seg = state
            .get_segment(i)
            .ok_or_else(|| format!("get_segment({}) returned None", i))?;
        let text = seg
            .to_str_lossy()
            .map_err(|e| format!("segment {}: {:?}", i, e))?;
        out.push_str(text.trim());
        out.push(' ');
    }
    Ok(out.trim().to_string())
}

// ---------------------------------------------------------------------
// ASCII timeline: 1 column per `bucket_ms`, one row per VAD. `#` =
// segment overlaps bucket, `.` = silence. Good-enough visual to eyeball
// boundary agreement.
// ---------------------------------------------------------------------

fn ascii_timeline(segs: &[Seg], total_ms: u64, bucket_ms: u64) -> String {
    let buckets = ((total_ms + bucket_ms - 1) / bucket_ms).max(1) as usize;
    let mut row = vec!['.'; buckets];
    for s in segs {
        let b0 = (s.start_ms / bucket_ms) as usize;
        let b1 = ((s.end_ms + bucket_ms - 1) / bucket_ms) as usize;
        for b in b0..b1.min(buckets) {
            row[b] = '#';
        }
    }
    row.iter().collect()
}

fn aggregate_speech_ms(segs: &[Seg]) -> u64 {
    segs.iter().map(|s| s.duration_ms()).sum()
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let audio_path = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "/tmp/lecture_clip.wav".to_string());

    if !Path::new(&audio_path).exists() {
        eprintln!("Audio file not found: {}", audio_path);
        eprintln!("Usage: phase2_vad_eval <path-to-wav>");
        return Ok(());
    }

    eprintln!("Reading {}...", audio_path);
    let (samples, sr) = read_wav_i16(Path::new(&audio_path))?;
    let samples_16k = if sr == 48_000 {
        downsample_48k_to_16k(&samples)
    } else if sr == 16_000 {
        samples
    } else {
        return Err(format!("Unsupported sample rate {}", sr).into());
    };
    let total_ms = (samples_16k.len() as u64 * 1000) / 16_000;

    let mut out = String::new();
    out.push_str("# Phase 2 VAD comparison — energy vs Silero v5\n\n");
    out.push_str(&format!("**Audio**: `{}` ({:.1} s, 16 kHz mono)\n\n", audio_path, total_ms as f64 / 1000.0));
    out.push_str("**Comparing**: `classnoteai_lib::vad::VadDetector` (current — RMS energy threshold) vs Silero VAD v5 via `voice_activity_detector` crate (Phase 2 candidate).\n\n");
    out.push_str("---\n\n");

    // --- Run both VADs ---
    eprintln!("Running energy VAD...");
    let t_e = Instant::now();
    let e_segs = energy_segments(&samples_16k);
    let e_ms = t_e.elapsed().as_millis();
    eprintln!("  {} segs in {} ms", e_segs.len(), e_ms);

    eprintln!("Running Silero VAD v5...");
    let silero_model = env::var("SILERO_VAD_ONNX")
        .unwrap_or_else(|_| "/tmp/silero/silero_vad.onnx".to_string());
    if !Path::new(&silero_model).exists() {
        return Err(format!(
            "Silero ONNX model not found at {} — download from https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx or set SILERO_VAD_ONNX",
            silero_model
        )
        .into());
    }
    let t_s = Instant::now();
    let s_segs = silero_segments(&samples_16k, Path::new(&silero_model))?;
    let s_ms = t_s.elapsed().as_millis();
    eprintln!("  {} segs in {} ms", s_segs.len(), s_ms);

    // --- Aggregate metrics ---
    let e_speech = aggregate_speech_ms(&e_segs);
    let s_speech = aggregate_speech_ms(&s_segs);
    let e_pct = e_speech as f64 * 100.0 / total_ms.max(1) as f64;
    let s_pct = s_speech as f64 * 100.0 / total_ms.max(1) as f64;
    let e_mean = if !e_segs.is_empty() {
        e_speech as f64 / e_segs.len() as f64
    } else {
        0.0
    };
    let s_mean = if !s_segs.is_empty() {
        s_speech as f64 / s_segs.len() as f64
    } else {
        0.0
    };

    out.push_str("## Aggregate metrics\n\n");
    out.push_str("| Metric | Energy VAD | Silero v5 |\n|---|---|---|\n");
    out.push_str(&format!(
        "| Segments detected | {} | {} |\n",
        e_segs.len(),
        s_segs.len()
    ));
    out.push_str(&format!(
        "| Total speech time | {:.1} s ({:.1}%) | {:.1} s ({:.1}%) |\n",
        e_speech as f64 / 1000.0,
        e_pct,
        s_speech as f64 / 1000.0,
        s_pct
    ));
    out.push_str(&format!(
        "| Mean segment length | {:.0} ms | {:.0} ms |\n",
        e_mean, s_mean
    ));
    out.push_str(&format!(
        "| Detection time | {} ms | {} ms |\n\n",
        e_ms, s_ms
    ));

    // --- ASCII timeline (1 bucket = 500 ms) ---
    let bucket = 500u64;
    out.push_str(&format!(
        "## Timeline (1 cell = {} ms)\n\n```\n",
        bucket
    ));
    out.push_str(&format!(
        "Energy: {}\n",
        ascii_timeline(&e_segs, total_ms, bucket)
    ));
    out.push_str(&format!(
        "Silero: {}\n",
        ascii_timeline(&s_segs, total_ms, bucket)
    ));
    // Print a tick mark every 10 s so the timeline is readable.
    let buckets = ((total_ms + bucket - 1) / bucket) as usize;
    let ticks_per_10s = 10_000 / bucket as usize;
    let mut axis = vec![' '; buckets];
    for i in (0..buckets).step_by(ticks_per_10s) {
        let sec = i * bucket as usize / 1000;
        let label = format!("{}s", sec);
        for (j, ch) in label.chars().enumerate() {
            if i + j < buckets {
                axis[i + j] = ch;
            }
        }
    }
    let axis_str: String = axis.iter().collect();
    out.push_str(&format!("        {}\n```\n\n", axis_str));

    // --- Transcribe each VAD's segments with Whisper ---
    let whisper_path = env::var("WHISPER_MODEL").unwrap_or_else(|_| {
        let appdata = env::var("APPDATA").unwrap_or_default();
        format!("{}/com.classnoteai/models/whisper/ggml-base.bin", appdata)
    });
    eprintln!("Loading Whisper from {}...", whisper_path);
    let t_w = Instant::now();
    let ctx_params = WhisperContextParameters::default();
    let whisper_ctx = WhisperContext::new_with_params(&whisper_path, ctx_params)
        .map_err(|e| format!("Whisper load: {:?}", e))?;
    eprintln!("Whisper loaded in {:.1}s", t_w.elapsed().as_secs_f64());

    out.push_str("## Per-segment transcripts\n\n");
    out.push_str("### Energy VAD\n\n");
    out.push_str("| # | Start | End | Dur | Transcript |\n|---|---|---|---|---|\n");
    for (i, seg) in e_segs.iter().enumerate() {
        eprintln!("[energy] transcribing seg {}/{}", i + 1, e_segs.len());
        let text = transcribe_slice(&whisper_ctx, &samples_16k, seg.start_ms, seg.end_ms)
            .unwrap_or_else(|e| format!("(error: {})", e));
        let esc = text.replace('|', "\\|").replace('\n', " ");
        out.push_str(&format!(
            "| {} | {:.1}s | {:.1}s | {:.1}s | {} |\n",
            i + 1,
            seg.start_ms as f64 / 1000.0,
            seg.end_ms as f64 / 1000.0,
            seg.duration_ms() as f64 / 1000.0,
            esc
        ));
    }
    out.push_str("\n### Silero VAD v5\n\n");
    out.push_str("| # | Start | End | Dur | Transcript |\n|---|---|---|---|---|\n");
    for (i, seg) in s_segs.iter().enumerate() {
        eprintln!("[silero] transcribing seg {}/{}", i + 1, s_segs.len());
        let text = transcribe_slice(&whisper_ctx, &samples_16k, seg.start_ms, seg.end_ms)
            .unwrap_or_else(|e| format!("(error: {})", e));
        let esc = text.replace('|', "\\|").replace('\n', " ");
        out.push_str(&format!(
            "| {} | {:.1}s | {:.1}s | {:.1}s | {} |\n",
            i + 1,
            seg.start_ms as f64 / 1000.0,
            seg.end_ms as f64 / 1000.0,
            seg.duration_ms() as f64 / 1000.0,
            esc
        ));
    }
    out.push_str("\n---\n\n");

    println!("{}", out);
    Ok(())
}
