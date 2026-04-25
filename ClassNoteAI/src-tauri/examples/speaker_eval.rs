//! Local Sortformer speaker diarization benchmark.
//!
//! Usage:
//!   cargo run --release --example speaker_eval -- sortformer <wav16k> <sortformer.onnx> [cpu|directml|coreml]
//!
//! Provider notes:
//! - `cpu` always works.
//! - `directml` requires building with `--features gpu-directml` on Windows.
//! - `coreml` requires building with `--features gpu-coreml` on macOS.

use std::env;
use std::path::Path;
use std::time::Instant;

use classnoteai_lib::utils::onnx;
use parakeet_rs::sortformer::{DiarizationConfig, Sortformer};
use parakeet_rs::{ExecutionConfig, ExecutionProvider};

const SAMPLE_RATE: u32 = 16_000;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    onnx::init_onnx();

    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("sortformer") => run_sortformer(&args),
        _ => {
            eprintln!(
                "usage:\n  speaker_eval sortformer <wav16k> <sortformer.onnx> [cpu|directml|coreml]"
            );
            std::process::exit(2);
        }
    }
}

fn run_sortformer(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let wav = args.get(2).ok_or("missing wav path")?;
    let sortformer_path = args.get(3).ok_or("missing sortformer path")?;
    let provider = args.get(4).map(String::as_str).unwrap_or("cpu");
    let exec = execution_config(provider)?;
    let audio = load_wav_16k_mono(Path::new(wav))?;
    let duration = audio.len() as f32 / SAMPLE_RATE as f32;
    let started = Instant::now();

    let mut sortformer =
        Sortformer::with_config(sortformer_path, Some(exec), DiarizationConfig::callhome())?;
    println!(
        "mode=sortformer provider={provider} audio_sec={duration:.2} latency_sec={:.2}",
        sortformer.latency()
    );

    let mut segments = Vec::new();
    for chunk in audio.chunks(320) {
        segments.extend(sortformer.feed(chunk)?);
    }
    segments.extend(sortformer.flush()?);

    let elapsed = started.elapsed().as_secs_f32();
    let mut speaker_seconds = [0.0f64; 4];
    for seg in &segments {
        let start = seg.start as f64 / SAMPLE_RATE as f64;
        let end = seg.end as f64 / SAMPLE_RATE as f64;
        speaker_seconds[seg.speaker_id.min(3)] += (end - start).max(0.0);
        println!("[{start:07.2} - {end:07.2}] speaker={}", seg.speaker_id);
    }

    println!("segments={}", segments.len());
    for (speaker, seconds) in speaker_seconds.iter().enumerate() {
        if *seconds > 0.0 {
            println!("speaker={speaker} seconds={seconds:.2}");
        }
    }
    println!("elapsed_sec={elapsed:.2}");
    println!("speed_x_realtime={:.2}", duration / elapsed.max(0.001));
    Ok(())
}

fn execution_config(provider: &str) -> Result<ExecutionConfig, Box<dyn std::error::Error>> {
    let ep = match provider {
        "cpu" => ExecutionProvider::Cpu,
        "directml" => directml_provider()?,
        "coreml" => coreml_provider()?,
        other => return Err(format!("unknown provider: {other}").into()),
    };
    Ok(ExecutionConfig::new().with_execution_provider(ep))
}

#[cfg(feature = "gpu-directml")]
fn directml_provider() -> Result<ExecutionProvider, Box<dyn std::error::Error>> {
    Ok(ExecutionProvider::DirectML)
}

#[cfg(not(feature = "gpu-directml"))]
fn directml_provider() -> Result<ExecutionProvider, Box<dyn std::error::Error>> {
    Err("DirectML provider was not compiled; rebuild with --features gpu-directml".into())
}

#[cfg(feature = "gpu-coreml")]
fn coreml_provider() -> Result<ExecutionProvider, Box<dyn std::error::Error>> {
    Ok(ExecutionProvider::CoreML)
}

#[cfg(not(feature = "gpu-coreml"))]
fn coreml_provider() -> Result<ExecutionProvider, Box<dyn std::error::Error>> {
    Err("CoreML provider was not compiled; rebuild with --features gpu-coreml".into())
}

fn load_wav_16k_mono(path: &Path) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    if spec.sample_rate != SAMPLE_RATE {
        return Err(format!("expected {SAMPLE_RATE} Hz WAV, got {}", spec.sample_rate).into());
    }

    let channels = spec.channels.max(1) as usize;
    let samples = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<Vec<_>, _>>()?,
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|sample| sample.map(|s| s as f32 / 32768.0))
            .collect::<Result<Vec<_>, _>>()?,
    };
    if channels == 1 {
        return Ok(samples);
    }

    Ok(samples
        .chunks(channels)
        .map(|frame| frame.iter().copied().sum::<f32>() / frame.len() as f32)
        .collect())
}
