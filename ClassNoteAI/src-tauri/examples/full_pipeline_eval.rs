//! End-to-end backend pipeline eval. Run a real video through every
//! Rust-side stage of the v2 streaming pipeline:
//!
//!   ffmpeg → 16 kHz mono PCM
//!     → Parakeet INT8 (cache-aware streaming, 560 ms chunks)
//!     → sentence accumulator (filler-aware boundary detection)
//!     → TranslateGemma 4B Q4_K_M via llama-server sidecar
//!
//! Bypasses the Tauri runtime + the React frontend so any panic / OOM /
//! pipeline-level regression lands in our terminal instead of an opaque
//! "the app froze" report from the user. Captures per-stage timing
//! metrics so future runs have a regression baseline.
//!
//! Usage from `src-tauri`:
//!
//! ```sh
//! cargo run --release --example full_pipeline_eval -- ../我的影片.mp4
//! ```
//!
//! Outputs (under `target/eval-reports/`):
//! - `<stem>-<timestamp>.md`     — human-readable summary (this is the main artefact)
//! - `<stem>-<timestamp>.json`   — machine-readable metrics for regression diff
//! - `<stem>-<timestamp>.jsonl`  — per-sentence transcript + translation dump

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

use serde::Serialize;

use classnoteai_lib::asr::{parakeet_engine, parakeet_model};
use classnoteai_lib::asr::parakeet_model::Variant;
use classnoteai_lib::translation::{gemma, gemma_model, gemma_sidecar};
use classnoteai_lib::utils::onnx;

const SAMPLE_RATE: u32 = 16_000;
const CHUNK_SAMPLES: usize = 8_960; // 560 ms @ 16 kHz

// Sentence-boundary policy. Mirrors `services/streaming/sentenceAccumulator.ts`
// in the renderer. Kept in sync deliberately — both are testing the same
// product invariant (don't commit at filler tails / abbreviations / under
// length+duration thresholds; force-cut at 60 words / 30 s on real
// lecture audio that doesn't get reliable Parakeet punctuation).
const MIN_WORDS: usize = 3;
const MIN_DURATION_MS: u64 = 800;
const HARD_MAX_WORDS: usize = 60;
const HARD_MAX_DURATION_MS: u64 = 30_000;
const ABBREVIATIONS: &[&str] = &[
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.",
    "e.g.", "i.e.", "etc.", "vs.", "cf.", "al.",
    "inc.", "ltd.", "co.", "corp.",
    "um.", "uh.", "er.", "ah.", "oh.",
];
// Equivalent of FILLER_TAIL in TS: catches `…, um.` / `…, you know.` / `well.`
fn ends_with_filler(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    let candidates: &[&str] = &[
        " um.", " um?", " um!", ", um.", ", um?", ", um!",
        " uh.", " uh?", ", uh.",
        " er.", " ah.", " oh.",
        " you know.", " you know?", ", you know.", ", you know?",
        " i mean.", ", i mean.",
        " so.", ", so.",
        " well.", ", well.",
    ];
    candidates.iter().any(|c| lower.ends_with(c))
}

fn count_spoken_words(text: &str) -> usize {
    let t = text.trim();
    if t.is_empty() {
        return 0;
    }
    let tokens: Vec<&str> = t
        .split_whitespace()
        .filter(|tok| !tok.chars().all(|c| !c.is_alphanumeric()))
        .collect();
    if tokens.len() >= 3 {
        return tokens.len();
    }
    let cjk = t.chars().filter(|c| ('\u{4e00}'..='\u{9fa5}').contains(c)).count();
    if cjk > 0 { cjk } else { tokens.len() }
}

fn is_sentence_boundary(text: &str, duration_ms: u64) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Proper boundary: terminator + abbrev/filler/length/duration ok.
    let last_token = trimmed
        .split_whitespace()
        .last()
        .unwrap_or("")
        .to_lowercase();
    let proper_ok = ends_with_terminator(trimmed)
        && !ABBREVIATIONS.iter().any(|a| *a == last_token)
        && !ends_with_filler(trimmed)
        && count_spoken_words(trimmed) >= MIN_WORDS
        && duration_ms >= MIN_DURATION_MS;
    if proper_ok {
        return true;
    }

    // Hard-cap fallback (#R-eval) — Parakeet on conversational lecture
    // audio frequently goes 30+ s without emitting a terminator the
    // proper path will accept; without this the buffer accumulates
    // until end-of-stream as one mega-block (53-min/7000-word block
    // observed in 2026-04-25 70-min eval). Forced cut keeps the
    // translation pipeline fed with chunks it can actually translate.
    let word_count = count_spoken_words(trimmed);
    if word_count >= HARD_MAX_WORDS {
        return true;
    }
    if duration_ms >= HARD_MAX_DURATION_MS && word_count >= MIN_WORDS {
        return true;
    }
    false
}

fn ends_with_terminator(text: &str) -> bool {
    let last = text.trim().chars().last();
    matches!(last, Some('.') | Some('?') | Some('!') | Some('。') | Some('？') | Some('！'))
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let video_arg = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "../我的影片.mp4".to_string());
    let video_path = PathBuf::from(&video_arg).canonicalize()
        .map_err(|e| format!("cannot resolve {video_arg}: {e}"))?;

    println!("=== Full pipeline eval ===");
    println!("Video: {}", video_path.display());

    // Stage 0 — locate prerequisites.
    if !gemma_model::is_present() {
        return Err(format!(
            "TranslateGemma model missing: {}",
            gemma_model::target_path().unwrap_or_default().display()
        )
        .into());
    }
    let gguf = gemma_model::target_path()?;
    println!("Gemma model: {}", gguf.display());

    if !parakeet_model::is_present(Variant::Int8) {
        return Err(format!(
            "Parakeet INT8 model missing under {}",
            parakeet_model::model_dir(Variant::Int8)?.display()
        )
        .into());
    }
    let int8_dir = parakeet_model::model_dir(Variant::Int8)?;
    println!("Parakeet INT8: {}", int8_dir.display());

    // Stage 1 — ORT init via the workaround loader.
    let exe = env::current_exe().unwrap_or_default();
    let beside = exe.parent().map(|p| p.join("onnxruntime.dll")).unwrap_or_default();
    if beside.exists() && env::var_os("ORT_DYLIB_PATH").is_none() {
        env::set_var("ORT_DYLIB_PATH", &beside);
    }
    let t0 = Instant::now();
    onnx::init_onnx();
    let ort_init_ms = t0.elapsed().as_millis();
    println!("ORT init: {ort_init_ms} ms");

    // Stage 2 — load Parakeet INT8.
    let t0 = Instant::now();
    parakeet_engine::ensure_loaded(Variant::Int8, &int8_dir)
        .map_err(|e| format!("ensure_loaded INT8: {e}"))?;
    let parakeet_load_ms = t0.elapsed().as_millis();
    println!("Parakeet INT8 load: {parakeet_load_ms} ms");

    // Stage 3 — bring up Gemma sidecar (already running is fine).
    println!("Bringing up Gemma sidecar on :{}…", gemma_sidecar::DEFAULT_PORT);
    let t0 = Instant::now();
    let bring_up = gemma_sidecar::ensure_running(
        gguf.to_string_lossy().as_ref(),
        gemma_sidecar::DEFAULT_PORT,
        None,
    )
    .await;
    let sidecar_ms = t0.elapsed().as_millis();
    println!("Sidecar bring-up: {bring_up:?} in {sidecar_ms} ms");
    if !matches!(
        bring_up,
        gemma_sidecar::BringUpResult::AlreadyRunning | gemma_sidecar::BringUpResult::Spawned
    ) {
        return Err(format!("sidecar bring-up failed: {bring_up:?}").into());
    }

    // Stage 4 — spawn ffmpeg, stream PCM into Parakeet.
    println!("\n--- ASR streaming phase ---");
    let mut ff = Command::new("ffmpeg")
        .args([
            "-hide_banner", "-loglevel", "error",
            "-i", video_path.to_str().unwrap(),
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            "-f", "s16le",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut audio_in = ff.stdout.take().ok_or("ffmpeg stdout missing")?;

    let session_id = "full-pipeline-eval";
    parakeet_engine::start_session(session_id.to_string())
        .map_err(|e| format!("start_session: {e}"))?;

    let asr_start = Instant::now();
    let mut total_samples: u64 = 0;
    let mut chunk_times_ms: Vec<u128> = Vec::new();
    let mut deltas: Vec<DeltaEvent> = Vec::new();

    let mut buf = vec![0u8; CHUNK_SAMPLES * 2];
    let mut last_progress = Instant::now();
    loop {
        let mut filled = 0;
        let mut eof = false;
        while filled < buf.len() {
            match audio_in.read(&mut buf[filled..])? {
                0 => {
                    eof = true;
                    break;
                }
                n => filled += n,
            }
        }
        if filled == 0 {
            break;
        }
        let pcm: Vec<i16> = buf[..filled]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        total_samples += pcm.len() as u64;
        let t0 = Instant::now();
        parakeet_engine::push_pcm_i16(session_id, &pcm, |delta, _transcript, audio_end| {
            deltas.push(DeltaEvent {
                audio_end_sec: audio_end,
                text: delta.to_string(),
            });
        })
        .map_err(|e| format!("push_pcm_i16: {e}"))?;
        chunk_times_ms.push(t0.elapsed().as_millis());

        // Lightweight progress so a 70-min run doesn't look hung.
        if last_progress.elapsed().as_secs() >= 30 {
            let audio_sec = total_samples as f64 / SAMPLE_RATE as f64;
            let wall_sec = asr_start.elapsed().as_secs_f64();
            let rtf = if wall_sec > 0.0 { audio_sec / wall_sec } else { 0.0 };
            println!(
                "  [progress] audio={:.1}s wall={:.1}s rtf={:.2}x deltas={}",
                audio_sec, wall_sec, rtf, deltas.len()
            );
            last_progress = Instant::now();
        }

        if eof {
            break;
        }
    }
    let _final_text = parakeet_engine::end_session(session_id, |delta, _transcript, audio_end| {
        deltas.push(DeltaEvent {
            audio_end_sec: audio_end,
            text: delta.to_string(),
        });
    })
    .map_err(|e| format!("end_session: {e}"))?;
    let asr_wall = asr_start.elapsed();
    let _ = ff.wait();
    let audio_sec = total_samples as f64 / SAMPLE_RATE as f64;
    let asr_rtf = audio_sec / asr_wall.as_secs_f64();
    println!(
        "ASR done: {:.1}s audio in {:.1}s wall (RTF {:.2}x), {} deltas",
        audio_sec,
        asr_wall.as_secs_f64(),
        asr_rtf,
        deltas.len()
    );

    // Stage 5 — accumulate sentences.
    println!("\n--- Sentence accumulation ---");
    let sentences = accumulate_sentences(&deltas);
    let total_chars: usize = sentences.iter().map(|s| s.text.chars().count()).sum();
    let total_words: usize = sentences.iter().map(|s| count_spoken_words(&s.text)).sum();
    let avg_chars = if !sentences.is_empty() { total_chars as f64 / sentences.len() as f64 } else { 0.0 };
    let avg_words = if !sentences.is_empty() { total_words as f64 / sentences.len() as f64 } else { 0.0 };
    println!(
        "Sentences: {} (avg {:.1} chars, {:.1} words)",
        sentences.len(),
        avg_chars,
        avg_words
    );

    // Stage 6 — translate each sentence.
    println!("\n--- Translation phase ---");
    let translate_start = Instant::now();
    let mut per_sentence: Vec<SentenceRecord> = Vec::with_capacity(sentences.len());
    let mut translation_times_ms: Vec<u128> = Vec::with_capacity(sentences.len());
    let mut failures: Vec<(usize, String)> = Vec::new();
    let mut first_translation_wall_ms: Option<u128> = None;

    let mut last_progress = Instant::now();
    for (i, sent) in sentences.iter().enumerate() {
        let t0 = Instant::now();
        let result = gemma::translate(&sent.text, None).await;
        let dt = t0.elapsed().as_millis();
        let (translated, error) = match result {
            Ok(r) => {
                translation_times_ms.push(dt);
                if first_translation_wall_ms.is_none() {
                    first_translation_wall_ms = Some(translate_start.elapsed().as_millis());
                }
                (r.translated_text, None)
            }
            Err(e) => {
                let msg = e.to_string();
                failures.push((i, msg.clone()));
                (String::new(), Some(msg))
            }
        };
        per_sentence.push(SentenceRecord {
            index: i,
            audio_start_sec: sent.start_sec,
            audio_end_sec: sent.end_sec,
            source_text: sent.text.clone(),
            translation: translated,
            translation_ms: dt,
            error,
        });
        if last_progress.elapsed().as_secs() >= 15 {
            let n = per_sentence.len();
            let total = sentences.len();
            let mean = if !translation_times_ms.is_empty() {
                translation_times_ms.iter().sum::<u128>() as f64 / translation_times_ms.len() as f64
            } else { 0.0 };
            println!(
                "  [progress] {}/{} translated, mean {:.0} ms/sent, {} failures",
                n, total, mean, failures.len()
            );
            last_progress = Instant::now();
        }
    }
    let translate_wall = translate_start.elapsed();

    let chunk_pct = percentiles(&chunk_times_ms);
    let translate_pct = percentiles(&translation_times_ms);
    let metrics = Metrics {
        video_path: video_path.to_string_lossy().to_string(),
        audio_sec,
        ort_init_ms,
        parakeet_load_ms,
        sidecar_ms,
        sidecar_bring_up: format!("{:?}", bring_up),
        asr_wall_sec: asr_wall.as_secs_f64(),
        asr_rtf,
        chunk_count: chunk_times_ms.len(),
        chunk_ms: chunk_pct,
        delta_count: deltas.len(),
        sentence_count: sentences.len(),
        sentence_avg_chars: avg_chars,
        sentence_avg_words: avg_words,
        translation_wall_sec: translate_wall.as_secs_f64(),
        translation_count: per_sentence.len(),
        translation_failure_count: failures.len(),
        translation_first_wall_ms: first_translation_wall_ms,
        translation_ms: translate_pct,
        end_to_end_wall_sec: asr_wall.as_secs_f64() + translate_wall.as_secs_f64(),
        combined_rtf: audio_sec / (asr_wall.as_secs_f64() + translate_wall.as_secs_f64()),
    };

    write_reports(&video_path, &metrics, &per_sentence)?;

    println!("\n=== Done ===");
    println!("ASR RTF: {:.2}x  /  Translation: {:.0} ms p50, {:.0} ms p95",
             metrics.asr_rtf, metrics.translation_ms.p50, metrics.translation_ms.p95);
    if !failures.is_empty() {
        println!("Translation failures: {} / {}", failures.len(), per_sentence.len());
    }
    Ok(())
}

// -- types & helpers --

#[derive(Clone)]
struct DeltaEvent {
    audio_end_sec: f32,
    text: String,
}

#[derive(Clone)]
struct Sentence {
    start_sec: f32,
    end_sec: f32,
    text: String,
}

fn accumulate_sentences(deltas: &[DeltaEvent]) -> Vec<Sentence> {
    let mut out: Vec<Sentence> = Vec::new();
    let mut buf = String::new();
    let mut buf_start: Option<f32> = None;
    let mut last_audio_end: f32 = 0.0;
    for d in deltas {
        if buf_start.is_none() {
            buf_start = Some(d.audio_end_sec);
        }
        let trimmed = d.text.trim();
        if !trimmed.is_empty() {
            if !buf.is_empty() && !buf.ends_with(' ') {
                buf.push(' ');
            }
            buf.push_str(trimmed);
        }
        last_audio_end = d.audio_end_sec;
        let span_ms = ((d.audio_end_sec - buf_start.unwrap()) * 1000.0).max(0.0) as u64;
        if is_sentence_boundary(&buf, span_ms) {
            out.push(Sentence {
                start_sec: buf_start.unwrap(),
                end_sec: d.audio_end_sec,
                text: std::mem::take(&mut buf),
            });
            buf_start = None;
        }
    }
    let trimmed_remainder = buf.trim();
    if !trimmed_remainder.is_empty() {
        out.push(Sentence {
            start_sec: buf_start.unwrap_or(last_audio_end),
            end_sec: last_audio_end,
            text: buf,
        });
    }
    out
}

#[derive(Serialize, Clone)]
struct Percentiles {
    mean: f64,
    p50: f64,
    p95: f64,
    p99: f64,
    max: f64,
    count: usize,
}

fn percentiles(times: &[u128]) -> Percentiles {
    if times.is_empty() {
        return Percentiles { mean: 0.0, p50: 0.0, p95: 0.0, p99: 0.0, max: 0.0, count: 0 };
    }
    let mut sorted: Vec<u128> = times.to_vec();
    sorted.sort_unstable();
    let pick = |q: f64| -> f64 {
        let idx = ((sorted.len() as f64) * q).floor() as usize;
        sorted[idx.min(sorted.len() - 1)] as f64
    };
    Percentiles {
        mean: sorted.iter().sum::<u128>() as f64 / sorted.len() as f64,
        p50: pick(0.50),
        p95: pick(0.95),
        p99: pick(0.99),
        max: *sorted.last().unwrap() as f64,
        count: sorted.len(),
    }
}

#[derive(Serialize)]
struct Metrics {
    video_path: String,
    audio_sec: f64,
    ort_init_ms: u128,
    parakeet_load_ms: u128,
    sidecar_ms: u128,
    sidecar_bring_up: String,
    asr_wall_sec: f64,
    asr_rtf: f64,
    chunk_count: usize,
    chunk_ms: Percentiles,
    delta_count: usize,
    sentence_count: usize,
    sentence_avg_chars: f64,
    sentence_avg_words: f64,
    translation_wall_sec: f64,
    translation_count: usize,
    translation_failure_count: usize,
    translation_first_wall_ms: Option<u128>,
    translation_ms: Percentiles,
    end_to_end_wall_sec: f64,
    combined_rtf: f64,
}

#[derive(Serialize)]
struct SentenceRecord {
    index: usize,
    audio_start_sec: f32,
    audio_end_sec: f32,
    source_text: String,
    translation: String,
    translation_ms: u128,
    error: Option<String>,
}

fn write_reports(
    video_path: &Path,
    metrics: &Metrics,
    per_sentence: &[SentenceRecord],
) -> Result<(), Box<dyn std::error::Error>> {
    let stem = video_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "video".into());
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let out_dir = PathBuf::from("target/eval-reports");
    fs::create_dir_all(&out_dir)?;

    let md_path = out_dir.join(format!("{stem}-{stamp}.md"));
    let json_path = out_dir.join(format!("{stem}-{stamp}.json"));
    let jsonl_path = out_dir.join(format!("{stem}-{stamp}.jsonl"));

    let md = render_markdown(metrics, per_sentence);
    fs::write(&md_path, md)?;
    fs::write(&json_path, serde_json::to_string_pretty(metrics)?)?;
    let mut jsonl = fs::File::create(&jsonl_path)?;
    for s in per_sentence {
        writeln!(jsonl, "{}", serde_json::to_string(s)?)?;
    }

    println!("\nReports written:");
    println!("  {}", md_path.display());
    println!("  {}", json_path.display());
    println!("  {}", jsonl_path.display());
    Ok(())
}

fn render_markdown(m: &Metrics, sentences: &[SentenceRecord]) -> String {
    let mut s = String::new();
    s.push_str(&format!("# Full pipeline eval — {}\n\n", m.video_path));
    s.push_str(&format!("Generated: {}\n\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")));

    s.push_str("## Headline\n\n");
    s.push_str(&format!("- **Audio**: {:.1} s ({:.1} min)\n", m.audio_sec, m.audio_sec / 60.0));
    s.push_str(&format!("- **ASR RTF**: {:.2}× (Parakeet INT8)\n", m.asr_rtf));
    s.push_str(&format!("- **Sentences**: {} (avg {:.1} chars / {:.1} words)\n",
        m.sentence_count, m.sentence_avg_chars, m.sentence_avg_words));
    s.push_str(&format!("- **Translation**: {:.0} ms/sent p50, {:.0} ms p95, {:.0} ms p99 (TranslateGemma 4B Q4_K_M)\n",
        m.translation_ms.p50, m.translation_ms.p95, m.translation_ms.p99));
    s.push_str(&format!("- **End-to-end**: ASR {:.1}s + translation {:.1}s = **{:.1}s wall** (combined RTF {:.2}×)\n",
        m.asr_wall_sec, m.translation_wall_sec, m.end_to_end_wall_sec, m.combined_rtf));
    if m.translation_failure_count > 0 {
        s.push_str(&format!("- **Failures**: {} / {} translations errored\n",
            m.translation_failure_count, m.translation_count));
    }
    s.push('\n');

    s.push_str("## Stage timings\n\n");
    s.push_str("| Stage | ms |\n|---|---|\n");
    s.push_str(&format!("| ORT init (set_api workaround) | {} |\n", m.ort_init_ms));
    s.push_str(&format!("| Parakeet INT8 load | {} |\n", m.parakeet_load_ms));
    s.push_str(&format!("| Gemma sidecar bring-up ({}) | {} |\n", m.sidecar_bring_up, m.sidecar_ms));
    s.push_str(&format!("| First translation wall | {} |\n",
        m.translation_first_wall_ms.map(|v| v.to_string()).unwrap_or_else(|| "—".into())));
    s.push('\n');

    s.push_str("## ASR per-chunk timing (560 ms each)\n\n");
    s.push_str(&format!(
        "Chunks: {}  ·  mean **{:.1} ms**  ·  p50 **{:.0}**  ·  p95 **{:.0}**  ·  p99 **{:.0}**  ·  max **{:.0}**\n\n",
        m.chunk_count, m.chunk_ms.mean, m.chunk_ms.p50, m.chunk_ms.p95, m.chunk_ms.p99, m.chunk_ms.max
    ));

    s.push_str("## Translation per-sentence timing\n\n");
    s.push_str(&format!(
        "Sentences: {}  ·  mean **{:.0} ms**  ·  p50 **{:.0}**  ·  p95 **{:.0}**  ·  p99 **{:.0}**  ·  max **{:.0}**\n\n",
        m.translation_ms.count, m.translation_ms.mean, m.translation_ms.p50, m.translation_ms.p95,
        m.translation_ms.p99, m.translation_ms.max
    ));

    s.push_str("## Translation samples\n\n");
    s.push_str("First 10, middle 5, last 5 sentence pairs (audio_start → text → translation, latency).\n\n");
    let n = sentences.len();
    let head: Vec<usize> = (0..n.min(10)).collect();
    let mid_start = if n > 25 { n / 2 - 2 } else { n.min(10) };
    let mid_end = (mid_start + 5).min(n);
    let tail_start = if n > 5 { n - 5 } else { mid_end };
    let mut indices: Vec<usize> = head;
    indices.extend(mid_start..mid_end);
    indices.extend(tail_start..n);
    indices.sort_unstable();
    indices.dedup();

    for i in indices {
        let r = &sentences[i];
        s.push_str(&format!("### #{i} — t={:.1}s ({} ms)\n", r.audio_start_sec, r.translation_ms));
        s.push_str(&format!("- **EN**: {}\n", escape_md(&r.source_text)));
        if let Some(err) = &r.error {
            s.push_str(&format!("- **ZH**: ⚠️ ERROR — {}\n", escape_md(err)));
        } else {
            s.push_str(&format!("- **ZH**: {}\n", escape_md(&r.translation)));
        }
        s.push('\n');
    }

    s.push_str("---\n");
    s.push_str("Full transcript + translation pairs: see sibling `.jsonl` file.\n");
    s
}

fn escape_md(text: &str) -> String {
    text.replace('\n', " ").replace('|', "\\|")
}
