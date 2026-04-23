//! End-to-end A/B harness for Phase 0 of speech-pipeline-v0.6.5.
//!
//! Directly loads the M2M100 CT2 model and runs the same inputs twice:
//! once with the pre-Phase-0 `TranslationOptions` + `clean_translation`
//! shape, once with the Phase 0 guards. So we can see exactly what
//! changed on #67's two canonical failure cases.
//!
//! Usage (from `ClassNoteAI/src-tauri`):
//!   cargo run --release --example phase0_translation_eval
//!   # Override model location:
//!   M2M100_DIR=/path/to/m2m100-418M-ct2-int8 \
//!     cargo run --release --example phase0_translation_eval
//!
//! Defaults to `$APPDATA/com.classnoteai/models/translation/m2m100-418M-ct2-int8`
//! on Windows (where the setup wizard installs it).

use std::env;
use std::fs;
use std::path::Path;
use std::time::Instant;

use ct2rs::tokenizers::sentencepiece::Tokenizer as SentencePieceTokenizer;
use ct2rs::{BatchType, Config, TranslationOptions, Translator};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn m2m100_lang_token(lang: &str) -> &'static str {
    match lang {
        "zh" | "zh-CN" | "zh-TW" => "__zh__",
        "en" => "__en__",
        "ja" => "__ja__",
        _ => "__en__",
    }
}

/// Mirrors the pre-Phase-0 `clean_translation`: strip `__xx__` language
/// tokens + strip leading non-CJK when target is Chinese. NO
/// `collapse_repetitions` (that was added in Phase 0).
fn clean_pre_phase_0(raw: &str, target_lang: &str) -> String {
    let mut s = raw.trim().to_string();
    loop {
        let Some(start) = s.find("__") else { break };
        let remaining = &s[start + 2..];
        let Some(end_offset) = remaining.find("__") else {
            break;
        };
        if end_offset == 0 || end_offset > 4 {
            break;
        }
        let token_end = start + 2 + end_offset + 2;
        s.replace_range(start..token_end, " ");
    }
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");

    if target_lang.starts_with("zh") {
        let is_cjk = |c: char| {
            let u = c as u32;
            (0x3000..=0x303F).contains(&u)
                || (0x3400..=0x4DBF).contains(&u)
                || (0x4E00..=0x9FFF).contains(&u)
                || (0xFF00..=0xFFEF).contains(&u)
                || (0xF900..=0xFAFF).contains(&u)
        };
        if let Some((i, _)) = s.char_indices().find(|(_, c)| is_cjk(*c)) {
            s = s[i..].trim().to_string();
        }
    }
    s
}

/// Phase 0 addition: collapse runs of 1-4 char patterns repeated 4+
/// times into a single occurrence. Duplicates the implementation in
/// `translation::ctranslate2` so this example binary doesn't require
/// the function to be `pub` in the lib API.
fn collapse_repetitions(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 8 {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        let mut collapsed = false;
        for n in 1..=4usize {
            if i + n * 4 > chars.len() {
                continue;
            }
            let pat = &chars[i..i + n];
            let mut k = 1;
            while i + n * (k + 1) <= chars.len()
                && &chars[i + n * k..i + n * (k + 1)] == pat
            {
                k += 1;
            }
            if k >= 4 {
                out.extend(pat.iter());
                i += n * k;
                collapsed = true;
                break;
            }
        }
        if !collapsed {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn clean_phase_0(raw: &str, target_lang: &str) -> String {
    collapse_repetitions(&clean_pre_phase_0(raw, target_lang))
}

fn base_options() -> TranslationOptions<String, String> {
    TranslationOptions {
        beam_size: 4,
        patience: 1.0,
        length_penalty: 1.0,
        coverage_penalty: 0.0,
        repetition_penalty: 1.0,
        no_repeat_ngram_size: 0,
        disable_unk: false,
        suppress_sequences: Vec::new(),
        prefix_bias_beta: 0.0,
        end_token: Vec::new(),
        return_end_token: false,
        max_input_length: 1024,
        max_decoding_length: 256,
        min_decoding_length: 1,
        sampling_topk: 1,
        sampling_topp: 1.0,
        sampling_temperature: 1.0,
        use_vmap: false,
        num_hypotheses: 1,
        return_scores: false,
        return_attention: false,
        return_alternatives: false,
        min_alternative_expansion_prob: 0.0,
        replace_unknowns: false,
        batch_type: BatchType::default(),
        max_batch_size: 0,
        return_logits_vocab: false,
    }
}

fn options_pre_phase_0() -> TranslationOptions<String, String> {
    base_options()
}

fn options_phase_0() -> TranslationOptions<String, String> {
    let mut opts = base_options();
    opts.repetition_penalty = 1.3;
    opts.no_repeat_ngram_size = 4;
    opts
}

/// Minimal WAV parser: handles RIFF/WAVE PCM16. Returns (i16 samples
/// in channel-averaged mono, sample_rate). Sufficient for the WAV
/// files the recording pipeline writes (16-bit PCM, mono or stereo,
/// single `data` chunk preceded by a standard `fmt ` chunk).
fn read_wav_i16(path: &Path) -> Result<(Vec<i16>, u32), Box<dyn std::error::Error>> {
    let bytes = fs::read(path)?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(format!("Not a RIFF/WAVE file: {:?}", path).into());
    }
    // Walk chunks from offset 12 onwards. `fmt ` comes first in practice
    // but the spec allows other order; scanning avoids the assumption.
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
            // audio_format (2) channels (2) sample_rate (4) byte_rate (4) block_align (2) bps (2)
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
        // Chunks are word-aligned; odd sizes are padded with one byte.
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
    // Collapse multi-channel to mono by averaging. Monaural input returns unchanged.
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

/// Cheap 3:1 decimation for 48 kHz → 16 kHz (the app's native recording
/// rate on Windows mics). Averages three consecutive samples to act as
/// a primitive low-pass before decimation — better than raw pick-every-
/// third, which would alias high-frequency noise into the speech band.
fn downsample_48k_to_16k(samples: &[i16]) -> Vec<i16> {
    samples
        .chunks_exact(3)
        .map(|c| ((c[0] as i32 + c[1] as i32 + c[2] as i32) / 3) as i16)
        .collect()
}

/// Whisper-rs transcribe with greedy sampling. Uses the same
/// "suppress non-speech tokens" flags as the live pipeline so the
/// transcription output here mirrors what users actually see.
fn transcribe_with_whisper(
    ctx: &WhisperContext,
    pcm_16k: &[i16],
    language: Option<&str>,
) -> Result<String, Box<dyn std::error::Error>> {
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("create_state: {:?}", e))?;
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: 1.0,
    });
    params.set_n_threads(num_cpus::get().min(8) as i32);
    params.set_translate(false);
    params.set_language(language);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);

    let audio_f32: Vec<f32> = pcm_16k.iter().map(|&s| s as f32 / 32768.0).collect();
    state
        .full(params, &audio_f32)
        .map_err(|e| format!("whisper full: {:?}", e))?;

    // whisper-rs 0.16 API: full_n_segments() returns i32; get_segment
    // returns Option<WhisperSegment>; text via seg.to_str_lossy().
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

fn translate_one(
    translator: &Translator<SentencePieceTokenizer>,
    input: &str,
    options: &TranslationOptions<String, String>,
    src_lang: &str,
    tgt_lang: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let src_token = m2m100_lang_token(src_lang);
    let prefixed = format!("{} {}", src_token, input);
    let sources: Vec<&str> = vec![&prefixed];
    let tgt_token = m2m100_lang_token(tgt_lang);
    let target_prefix = vec![vec![tgt_token.to_string()]];

    let results =
        translator.translate_batch_with_target_prefix(&sources, &target_prefix, options, None)?;
    let (raw, _score) = results.into_iter().next().ok_or("empty result")?;
    Ok(raw)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let m2m100_dir = env::var("M2M100_DIR").unwrap_or_else(|_| {
        let appdata = env::var("APPDATA").unwrap_or_default();
        format!(
            "{}/com.classnoteai/models/translation/m2m100-418M-ct2-int8",
            appdata
        )
    });

    if !Path::new(&m2m100_dir).exists() {
        eprintln!("M2M100 model not found at: {}", m2m100_dir);
        eprintln!("Set M2M100_DIR env var or install via setup wizard.");
        return Ok(());
    }

    let mut out = String::new();
    out.push_str("# Phase 0 translation A/B evaluation\n\n");
    out.push_str(&format!("**Model**: `{}`\n\n", m2m100_dir));
    out.push_str("**Baseline** = pre-Phase-0 settings:\n");
    out.push_str("- `TranslationOptions::repetition_penalty = 1.0`\n");
    out.push_str("- `TranslationOptions::no_repeat_ngram_size = 0`\n");
    out.push_str("- `clean_translation` = strip `__xx__` tokens + strip leading non-CJK (no repetition collapse)\n\n");
    out.push_str("**Phase 0** = post-fix settings:\n");
    out.push_str("- `TranslationOptions::repetition_penalty = 1.3`\n");
    out.push_str("- `TranslationOptions::no_repeat_ngram_size = 4`\n");
    out.push_str("- `clean_translation` = strip `__xx__` + strip leading non-CJK + `collapse_repetitions`\n\n");
    out.push_str("Everything else (beam_size=4, patience=1.0, max_decoding_length=256, ...) is identical between the two paths.\n\n");
    out.push_str("---\n\n");

    eprintln!("Loading M2M100 model from {}...", m2m100_dir);
    let t_load = Instant::now();
    let sp_path = Path::new(&m2m100_dir).join("sentencepiece.bpe.model");
    let tokenizer = SentencePieceTokenizer::from_file(&sp_path, &sp_path)?;
    let config = Config::default();
    let translator = Translator::with_tokenizer(&m2m100_dir, tokenizer, &config)?;
    eprintln!("Loaded in {:.1}s", t_load.elapsed().as_secs_f64());

    let pre_opts = options_pre_phase_0();
    let post_opts = options_phase_0();

    let fixtures: Vec<(&str, &str, &str)> = vec![
        (
            "issue-67-example-1",
            "Long disfluent sentence from issue #67. Original user-reported behavior: 2 of 3 sentences dropped entirely in Chinese output.",
            "I'm not going to go through every single one of these because I think that any of you can see just by the title. That many of you are kind of just known by the title. Disability of the System Status, do you not?",
        ),
        (
            "issue-67-example-2",
            "Heavy filler words. Original user-reported behavior: translation looped as 我认为, repeated 26 times.",
            "I think, um, in my opinion, I find that you know, send Heuristics all the keys here, follow along and understand, maybe because, you know, it doesn't have the strict, inclusivity, kind of focus, it's more general, any all-percent.",
        ),
        (
            "control-clean-academic",
            "Clean academic English. Should be unchanged between baseline and Phase 0.",
            "The gradient descent algorithm is used to optimize the loss function in machine learning models.",
        ),
        (
            "control-enumeration",
            "Academic enumeration. Should be unchanged.",
            "This lecture will cover three key topics: supervised learning, neural networks, and evaluation metrics.",
        ),
        (
            "disfluent-short",
            "Short filler-heavy input to exercise the n-gram ban directly.",
            "So, um, basically, you know, it's like, uh, yeah.",
        ),
    ];

    for (name, desc, input) in &fixtures {
        eprintln!("Running fixture: {}", name);
        out.push_str(&format!("## {}\n\n", name));
        out.push_str(&format!("_{}_\n\n", desc));
        out.push_str(&format!("**Source** ({} chars):\n\n", input.chars().count()));
        out.push_str(&format!("> {}\n\n", input));

        let t0 = Instant::now();
        let raw_base = translate_one(&translator, input, &pre_opts, "en", "zh")?;
        let ms_base = t0.elapsed().as_millis();
        let clean_base = clean_pre_phase_0(&raw_base, "zh");

        let t1 = Instant::now();
        let raw_post = translate_one(&translator, input, &post_opts, "en", "zh")?;
        let ms_post = t1.elapsed().as_millis();
        let clean_post = clean_phase_0(&raw_post, "zh");

        let base_chars = clean_base.chars().count();
        let post_chars = clean_post.chars().count();

        out.push_str(&format!(
            "**Baseline** — {} ms, {} chars:\n\n> {}\n\n",
            ms_base, base_chars, clean_base
        ));
        out.push_str(&format!(
            "**Phase 0** — {} ms, {} chars:\n\n> {}\n\n",
            ms_post, post_chars, clean_post
        ));
        out.push_str("---\n\n");
    }

    // Optional audio end-to-end: pass a WAV path as the first positional
    // argument. Uses ggml-base.bin under %APPDATA%\com.classnoteai by default.
    // Phase 0's streaming-only fixes (silence threshold, filler-aware
    // sentence end) don't apply to offline full-file transcription, so
    // Whisper runs once and the transcript is the A/B input for M2M100.
    let args: Vec<String> = env::args().collect();
    let audio_paths: Vec<String> = args.iter().skip(1).cloned().collect();

    if !audio_paths.is_empty() {
        let whisper_path = env::var("WHISPER_MODEL").unwrap_or_else(|_| {
            let appdata = env::var("APPDATA").unwrap_or_default();
            format!("{}/com.classnoteai/models/whisper/ggml-base.bin", appdata)
        });
        if !Path::new(&whisper_path).exists() {
            eprintln!("Whisper model not found at: {}", whisper_path);
            eprintln!("Set WHISPER_MODEL env var or install via setup wizard.");
            println!("{}", out);
            return Ok(());
        }

        eprintln!("Loading Whisper model from {}...", whisper_path);
        let t_w = Instant::now();
        let ctx_params = WhisperContextParameters::default();
        let whisper_ctx = WhisperContext::new_with_params(&whisper_path, ctx_params)
            .map_err(|e| format!("Whisper load: {:?}", e))?;
        eprintln!("Whisper loaded in {:.1}s", t_w.elapsed().as_secs_f64());

        out.push_str("# End-to-end audio pipeline (Whisper → M2M100 A/B)\n\n");
        out.push_str(&format!("**Whisper model**: `{}`\n\n", whisper_path));
        out.push_str("Transcription runs once (Phase 0 didn't change offline Whisper params); the resulting transcript feeds the same A/B translation as above.\n\n");
        out.push_str("---\n\n");

        for audio_path in &audio_paths {
            eprintln!("Processing audio: {}", audio_path);
            out.push_str(&format!("## audio: `{}`\n\n", audio_path));

            let t_wav = Instant::now();
            let (samples, sr) = match read_wav_i16(Path::new(audio_path)) {
                Ok(r) => r,
                Err(e) => {
                    out.push_str(&format!("**WAV read failed**: {}\n\n---\n\n", e));
                    continue;
                }
            };
            let duration_s = samples.len() as f64 / sr as f64;
            out.push_str(&format!(
                "- **Source**: {} samples at {} Hz mono (~{:.1} s), WAV read in {} ms\n",
                samples.len(),
                sr,
                duration_s,
                t_wav.elapsed().as_millis()
            ));

            // Whisper wants 16 kHz mono f32. If source is 48 kHz, decimate 3:1.
            let (samples_16k, final_sr) = if sr == 48_000 {
                let t = Instant::now();
                let s = downsample_48k_to_16k(&samples);
                eprintln!(
                    "downsampled {}→16k in {} ms",
                    sr,
                    t.elapsed().as_millis()
                );
                (s, 16_000u32)
            } else if sr == 16_000 {
                (samples, 16_000u32)
            } else {
                out.push_str(&format!(
                    "**Unsupported sample rate {} Hz** (this harness only handles 16 kHz or 48 kHz directly).\n\n---\n\n",
                    sr
                ));
                continue;
            };
            out.push_str(&format!(
                "- **Decode rate**: {} Hz ({} samples)\n",
                final_sr,
                samples_16k.len()
            ));

            let t_trans = Instant::now();
            let transcript = match transcribe_with_whisper(&whisper_ctx, &samples_16k, None) {
                Ok(t) => t,
                Err(e) => {
                    out.push_str(&format!("\n**Whisper transcription failed**: {}\n\n---\n\n", e));
                    continue;
                }
            };
            let trans_ms = t_trans.elapsed().as_millis();
            out.push_str(&format!(
                "- **Whisper transcription**: {} ms ({:.2}× realtime)\n\n",
                trans_ms,
                duration_s * 1000.0 / trans_ms.max(1) as f64
            ));
            out.push_str(&format!("**Transcript** ({} chars):\n\n> {}\n\n", transcript.chars().count(), transcript));

            if transcript.trim().is_empty() {
                out.push_str("_(empty transcript — silent audio? skipping translation A/B)_\n\n---\n\n");
                continue;
            }

            // === Whole-transcript A/B ===
            // Exposes M2M100's "source echo" pathology on long technical
            // content: the model emits English tokens up to max_decoding_length
            // without ever switching to Chinese. Useful for surfacing the
            // limit, but NOT what the streaming app actually does.
            let t0 = Instant::now();
            let raw_base = translate_one(&translator, &transcript, &pre_opts, "en", "zh")?;
            let ms_base = t0.elapsed().as_millis();
            let clean_base = clean_pre_phase_0(&raw_base, "zh");

            let t1 = Instant::now();
            let raw_post = translate_one(&translator, &transcript, &post_opts, "en", "zh")?;
            let ms_post = t1.elapsed().as_millis();
            let clean_post = clean_phase_0(&raw_post, "zh");

            out.push_str(&format!(
                "### Whole-transcript A/B (single M2M100 call)\n\n"
            ));
            out.push_str("_Not how the streaming app operates — sanity check for M2M100's limits on long inputs._\n\n");
            out.push_str(&format!(
                "**Baseline** — {} ms, {} chars:\n\n> {}\n\n",
                ms_base,
                clean_base.chars().count(),
                clean_base
            ));
            out.push_str(&format!(
                "**Phase 0** — {} ms, {} chars:\n\n> {}\n\n",
                ms_post,
                clean_post.chars().count(),
                clean_post
            ));

            // === Per-sentence A/B ===
            // What the app really does at runtime: commit each stable
            // segment as its own translation input. Simulate by splitting
            // the Whisper transcript on sentence-ending punctuation, then
            // running A/B on each chunk independently.
            let sentences: Vec<String> = transcript
                .split_inclusive(|c: char| matches!(c, '.' | '?' | '!'))
                .map(|s| s.trim().to_string())
                .filter(|s| s.chars().filter(|c| c.is_alphabetic()).count() >= 3)
                .collect();

            out.push_str(&format!(
                "### Per-sentence A/B (streaming-app simulation — {} segments)\n\n",
                sentences.len()
            ));
            out.push_str("| # | Source | Baseline | Phase 0 |\n");
            out.push_str("|---|---|---|---|\n");

            let mut total_base_ms: u128 = 0;
            let mut total_post_ms: u128 = 0;
            let mut base_has_cjk_count = 0usize;
            let mut post_has_cjk_count = 0usize;
            for (idx, sent) in sentences.iter().enumerate() {
                let t = Instant::now();
                let raw_b = translate_one(&translator, sent, &pre_opts, "en", "zh")?;
                total_base_ms += t.elapsed().as_millis();
                let clean_b = clean_pre_phase_0(&raw_b, "zh");

                let t = Instant::now();
                let raw_p = translate_one(&translator, sent, &post_opts, "en", "zh")?;
                total_post_ms += t.elapsed().as_millis();
                let clean_p = clean_phase_0(&raw_p, "zh");

                let has_cjk = |s: &str| {
                    s.chars().any(|c| {
                        let u = c as u32;
                        (0x4E00..=0x9FFF).contains(&u) || (0x3400..=0x4DBF).contains(&u)
                    })
                };
                if has_cjk(&clean_b) {
                    base_has_cjk_count += 1;
                }
                if has_cjk(&clean_p) {
                    post_has_cjk_count += 1;
                }

                // Escape pipes in table cells.
                let esc = |s: &str| s.replace('|', "\\|").replace('\n', " ");
                out.push_str(&format!(
                    "| {} | {} | {} | {} |\n",
                    idx + 1,
                    esc(sent),
                    esc(&clean_b),
                    esc(&clean_p)
                ));
            }
            out.push_str(&format!(
                "\n**Totals**: {} segments; baseline {:.1}s / Phase 0 {:.1}s; segments with any CJK output — baseline {}/{}, Phase 0 {}/{}.\n\n",
                sentences.len(),
                total_base_ms as f64 / 1000.0,
                total_post_ms as f64 / 1000.0,
                base_has_cjk_count,
                sentences.len(),
                post_has_cjk_count,
                sentences.len(),
            ));
            out.push_str("---\n\n");
        }
    }

    println!("{}", out);
    Ok(())
}
