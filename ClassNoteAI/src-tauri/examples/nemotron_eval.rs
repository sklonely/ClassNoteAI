//! INT8 vs FP32 Nemotron streaming bake-off.
//!
//! Loads each variant, streams a WAV through `transcribe_chunk` in
//! 560 ms windows, and prints a side-by-side report:
//!   * cold-start load time (from_pretrained)
//!   * per-chunk inference time (mean / p95 / max)
//!   * RTF — how many seconds of audio one second of CPU eats
//!   * first-token latency — when the first non-empty delta surfaces
//!   * final transcript (so you can eyeball quality differences)
//!
//! Usage from `src-tauri`:
//!     cargo run --release --example nemotron_eval -- path/to/lecture.wav
//!
//! Both variants must already be downloaded under
//! `{app_data}/models/parakeet-nemotron-{int8|fp32}/`. Use the app's
//! Settings → 本地轉錄 page to fetch them, or call the
//! `parakeet_download_model` Tauri command directly.
//!
//! WAV requirements: 16 kHz mono, 16-bit PCM or 32-bit float. Other
//! sample rates / channel counts are rejected with a clear error
//! rather than silently downmixed (resampling artefacts would
//! contaminate the comparison).

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use classnoteai_lib::asr::parakeet_model::{self, Variant};
use parakeet_rs::Nemotron;

/// Locate the bundled onnxruntime.dll relative to this binary's
/// location and pin ORT_DYLIB_PATH if the caller hasn't already.
/// The example uses ort with `load-dynamic`, which expects an
/// absolute path to a matching onnxruntime; the main app does this
/// in `lib.rs` setup, but standalone examples need their own version.
fn ensure_ort_dylib_path() {
    if env::var_os("ORT_DYLIB_PATH").is_some() {
        return;
    }
    let exe = env::current_exe().unwrap_or_default();
    let dll_name = if cfg!(windows) {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.1.23.0.dylib"
    } else {
        "libonnxruntime.so.1.23.0"
    };

    // Prefer the DLL cargo placed next to the example exe — that's the
    // copy parakeet-rs's build script staged. Falls back to
    // src-tauri/resources/ort/ for users running from the bundled app.
    let beside = exe.parent().map(|p| p.join(dll_name)).unwrap_or_default();
    let resources = exe
        .ancestors()
        .nth(4) // examples/exe → examples → release → target → src-tauri
        .map(|p| p.join("resources").join("ort").join(dll_name))
        .unwrap_or_default();
    let candidate = if beside.exists() {
        beside
    } else if resources.exists() {
        resources
    } else {
        eprintln!(
            "[ort] could not locate {dll_name} beside exe ({}) or in {}",
            exe.parent().map(|p| p.display().to_string()).unwrap_or_default(),
            resources.display()
        );
        return;
    };
    eprintln!("[ort] auto-setting ORT_DYLIB_PATH = {}", candidate.display());
    env::set_var("ORT_DYLIB_PATH", &candidate);
}

const CHUNK_SAMPLES: usize = 8_960; // 560 ms @ 16 kHz
const SAMPLE_RATE: u32 = 16_000;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let wav_path = args
        .get(1)
        .ok_or("Usage: cargo run --release --example nemotron_eval -- <wav>")?;
    let only = args.get(2).map(String::as_str);

    println!("=== Nemotron variant bake-off ===");
    println!("Audio: {wav_path}");

    ensure_ort_dylib_path();
    let init_start = Instant::now();
    // Use the manual loader workaround instead of `ort::init().commit()`
    // — see `utils::onnx::init_onnx_from` for why ort's own loader
    // hangs on Windows + load-dynamic + ort 2.0.0-rc.12.
    classnoteai_lib::utils::onnx::init_onnx();
    println!("ort init: {} ms", init_start.elapsed().as_millis());

    let (audio, audio_sec) = load_wav_as_f32(Path::new(wav_path))?;
    println!("Loaded {} samples ({:.2}s)", audio.len(), audio_sec);
    println!();

    let mut reports = Vec::new();
    for variant in [Variant::Int8, Variant::Fp32] {
        if let Some(filter) = only {
            if filter != variant.label() {
                continue;
            }
        }
        match run_variant(variant, &audio, audio_sec) {
            Ok(r) => reports.push(r),
            Err(e) => eprintln!("[{}] FAILED: {e}", variant.label()),
        }
    }

    if reports.len() == 2 {
        print_summary(&reports[0], &reports[1]);
    }

    Ok(())
}

#[allow(dead_code)] // some fields kept for inspection in side-by-side output
struct Report {
    variant: Variant,
    load_ms: u128,
    chunks: usize,
    chunk_times_ms: Vec<u128>,
    first_delta_audio_sec: Option<f32>,
    first_delta_wall_sec: Option<f32>,
    rtf: f32,
    transcript: String,
}

fn run_variant(
    variant: Variant,
    audio: &[f32],
    audio_sec: f32,
) -> Result<Report, Box<dyn std::error::Error>> {
    let dir = parakeet_model::model_dir(variant)?;
    if !parakeet_model::is_present(variant) {
        return Err(format!(
            "{} not present at {} — download via Settings first",
            variant.label(),
            dir.display()
        )
        .into());
    }

    println!("--- {} ({}) ---", variant.label(), pretty_dir(&dir));
    let load_start = Instant::now();
    let mut model = Nemotron::from_pretrained(&dir, None)
        .map_err(|e| format!("from_pretrained failed: {e}"))?;
    let load_ms = load_start.elapsed().as_millis();
    println!("  load: {load_ms} ms");

    let mut chunk_times_ms: Vec<u128> = Vec::with_capacity(audio.len() / CHUNK_SAMPLES + 4);
    let mut first_delta_audio_sec: Option<f32> = None;
    let mut first_delta_wall_sec: Option<f32> = None;
    let infer_start = Instant::now();

    let mut cursor = 0usize;
    let mut chunk_idx = 0usize;
    while cursor < audio.len() {
        let end = (cursor + CHUNK_SAMPLES).min(audio.len());
        let chunk: Vec<f32> = if end - cursor < CHUNK_SAMPLES {
            // Tail pad — same trick examples/streaming.rs uses.
            let mut tail = audio[cursor..end].to_vec();
            tail.resize(CHUNK_SAMPLES, 0.0);
            tail
        } else {
            audio[cursor..end].to_vec()
        };
        let t0 = Instant::now();
        let delta = model
            .transcribe_chunk(&chunk)
            .map_err(|e| format!("transcribe_chunk[{chunk_idx}]: {e}"))?;
        let dt = t0.elapsed().as_millis();
        chunk_times_ms.push(dt);
        if first_delta_audio_sec.is_none() && !delta.is_empty() {
            let audio_pos = (cursor + CHUNK_SAMPLES) as f32 / SAMPLE_RATE as f32;
            first_delta_audio_sec = Some(audio_pos);
            first_delta_wall_sec = Some(infer_start.elapsed().as_secs_f32());
        }
        cursor += CHUNK_SAMPLES;
        chunk_idx += 1;
    }

    // Drain decoder per the crate's streaming.rs convention.
    let zeros = vec![0.0f32; CHUNK_SAMPLES];
    for _ in 0..3 {
        let t0 = Instant::now();
        let _ = model
            .transcribe_chunk(&zeros)
            .map_err(|e| format!("flush: {e}"))?;
        chunk_times_ms.push(t0.elapsed().as_millis());
    }

    let infer_total_sec = infer_start.elapsed().as_secs_f32();
    let rtf = audio_sec / infer_total_sec;
    let transcript = model.get_transcript();

    println!("  chunks: {} ({} content + 3 flush)", chunk_times_ms.len(), chunks_in(audio.len()));
    println!("  total inference wall: {:.2}s (audio {:.2}s)", infer_total_sec, audio_sec);
    println!(
        "  RTF: {:.2}x  ({})",
        rtf,
        if rtf >= 1.0 {
            "faster than realtime ✓"
        } else {
            "slower than realtime ✗"
        }
    );
    if let (Some(audio_pos), Some(wall)) = (first_delta_audio_sec, first_delta_wall_sec) {
        println!(
            "  first delta: at audio {:.2}s, wall {:.2}s after stream start",
            audio_pos, wall
        );
    } else {
        println!("  first delta: never (no text emitted)");
    }
    let pct = chunk_stats_ms(&chunk_times_ms);
    println!(
        "  per-chunk ms — mean {:.1}, p50 {}, p95 {}, max {}",
        pct.mean, pct.p50, pct.p95, pct.max
    );
    println!("  transcript ({} chars):", transcript.len());
    println!("  > {}", trim_for_display(&transcript, 600));
    println!();

    Ok(Report {
        variant,
        load_ms,
        chunks: chunk_times_ms.len(),
        chunk_times_ms,
        first_delta_audio_sec,
        first_delta_wall_sec,
        rtf,
        transcript,
    })
}

fn print_summary(a: &Report, b: &Report) {
    println!("=== Side-by-side ===");
    println!("                       {:<14} {:<14}", a.variant.label(), b.variant.label());
    println!(
        "  load (ms):           {:<14} {:<14}",
        a.load_ms, b.load_ms
    );
    println!(
        "  RTF:                 {:<14.2} {:<14.2}",
        a.rtf, b.rtf
    );
    let a_first = a
        .first_delta_wall_sec
        .map(|s| format!("{:.2}s", s))
        .unwrap_or_else(|| "—".into());
    let b_first = b
        .first_delta_wall_sec
        .map(|s| format!("{:.2}s", s))
        .unwrap_or_else(|| "—".into());
    println!(
        "  first-delta wall:    {:<14} {:<14}",
        a_first, b_first
    );
    let a_pct = chunk_stats_ms(&a.chunk_times_ms);
    let b_pct = chunk_stats_ms(&b.chunk_times_ms);
    println!(
        "  per-chunk p95 (ms):  {:<14} {:<14}",
        a_pct.p95, b_pct.p95
    );
    println!(
        "  per-chunk max (ms):  {:<14} {:<14}",
        a_pct.max, b_pct.max
    );
    println!(
        "  transcript chars:    {:<14} {:<14}",
        a.transcript.len(),
        b.transcript.len()
    );
    println!();
    println!("=== Transcript diff ===");
    println!("[{}]: {}", a.variant.label(), trim_for_display(&a.transcript, 800));
    println!();
    println!("[{}]: {}", b.variant.label(), trim_for_display(&b.transcript, 800));
}

// ---------------------------------------------------------------------
// WAV loader: bare RIFF parser (no extra deps); produces normalized f32
// at 16 kHz mono. Other rates / channel counts → hard error.
// ---------------------------------------------------------------------

fn load_wav_as_f32(path: &Path) -> Result<(Vec<f32>, f32), Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(format!("not a RIFF/WAVE file: {:?}", path).into());
    }
    let mut off = 12usize;
    let mut channels: u16 = 0;
    let mut sample_rate: u32 = 0;
    let mut bits_per_sample: u16 = 0;
    let mut format_tag: u16 = 0;
    let mut data: Option<&[u8]> = None;
    while off + 8 <= bytes.len() {
        let id = &bytes[off..off + 4];
        let sz = u32::from_le_bytes([
            bytes[off + 4],
            bytes[off + 5],
            bytes[off + 6],
            bytes[off + 7],
        ]) as usize;
        let body_start = off + 8;
        let body_end = (body_start + sz).min(bytes.len());
        match id {
            b"fmt " => {
                let body = &bytes[body_start..body_end];
                if body.len() >= 16 {
                    format_tag = u16::from_le_bytes([body[0], body[1]]);
                    channels = u16::from_le_bytes([body[2], body[3]]);
                    sample_rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
                    bits_per_sample = u16::from_le_bytes([body[14], body[15]]);
                }
            }
            b"data" => {
                data = Some(&bytes[body_start..body_end]);
            }
            _ => {}
        }
        off = body_end + (body_end & 1); // RIFF chunks are even-aligned
    }
    let data = data.ok_or("no data chunk")?;
    if sample_rate != SAMPLE_RATE {
        return Err(format!(
            "expected {} Hz, got {} Hz — please resample first",
            SAMPLE_RATE, sample_rate
        )
        .into());
    }

    // Decode samples into f32 (per-channel) then mono-mix.
    let per_channel: Vec<f32> = match (format_tag, bits_per_sample) {
        (1, 16) => data
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32_768.0)
            .collect(),
        (3, 32) => data
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
        other => return Err(format!("unsupported WAV format {:?}", other).into()),
    };

    let mono: Vec<f32> = if channels <= 1 {
        per_channel
    } else {
        per_channel
            .chunks(channels as usize)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    let secs = mono.len() as f32 / SAMPLE_RATE as f32;
    Ok((mono, secs))
}

// ---------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------

struct ChunkStats {
    mean: f64,
    p50: u128,
    p95: u128,
    max: u128,
}

fn chunk_stats_ms(times: &[u128]) -> ChunkStats {
    if times.is_empty() {
        return ChunkStats { mean: 0.0, p50: 0, p95: 0, max: 0 };
    }
    let mut sorted = times.to_vec();
    sorted.sort_unstable();
    let p50 = sorted[sorted.len() / 2];
    let p95 = sorted[(sorted.len() * 95 / 100).min(sorted.len() - 1)];
    let max = *sorted.last().unwrap();
    let mean = sorted.iter().sum::<u128>() as f64 / sorted.len() as f64;
    ChunkStats { mean, p50, p95, max }
}

fn chunks_in(samples: usize) -> usize {
    samples.div_ceil(CHUNK_SAMPLES)
}

fn trim_for_display(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        let head: String = trimmed.chars().take(max).collect();
        format!("{head}…")
    }
}

fn pretty_dir(p: &PathBuf) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.to_string_lossy().to_string())
}
