//! Hallucination guards for Whisper output.
//!
//! Phase 3 of the v0.6.5 speech-pipeline plan (issue #53). Whisper
//! confidently fabricates text on silence and low-SNR input — the
//! most visible patterns are YouTube-training-data artifacts like
//! "Thank you for watching" on near-silent gaps, and tight n-gram
//! loops ("okay, okay, okay, okay…") on background hum.
//!
//! We layer cheap filters. Each one is a pure function over text
//! (plus the `no_speech_probability` the decoder already provides),
//! so they compose in any order and are easy to unit-test:
//!
//! 1. **No-speech probability** — whisper's own score that the
//!    segment is silence rather than speech. Drop above `0.6`.
//! 2. **Compression ratio** — `len(text) / len(zlib(text))`. Loops
//!    compress extremely well. Whisper's own stopping criterion uses
//!    `2.4` as the cutoff; matching that keeps behaviour consistent
//!    with what users would expect from a reference implementation.
//! 3. **N-gram repetition** — same token-level 3–5-gram repeating 3+
//!    times. Catches the "tight loop" failure mode (e.g. `我认为
//!    我认为 我认为` style) that compression_ratio alone can miss on
//!    short snippets.
//! 4. **Blacklist** — exact substring match against a small curated
//!    list of well-known Whisper hallucinations. Last resort; the
//!    first three filters already catch most cases.
//!
//! Upstream of this, Phase 2's Silero VAD already prevents silent
//! chunks from reaching the decoder, so guards here are a belt &
//! suspenders second layer — they catch hallucinations that slip
//! through the VAD because the input had borderline noise floor.

use serde::{Deserialize, Serialize};

/// Knobs for [`evaluate`]. Defaults match whisper.cpp's own filter
/// thresholds, which are stricter than the Python whisper library
/// (2.4 vs 2.2, -1.0 vs -1.0). Settings UI can override when we add
/// user-tunable quality in a later phase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardConfig {
    /// Drop segments whose no-speech probability exceeds this (Whisper
    /// thinks the audio is silent, but decoded text anyway → noise).
    pub max_no_speech_prob: f32,
    /// Drop segments whose compression ratio exceeds this (zlib-
    /// compressible = repetitive).
    pub max_compression_ratio: f32,
    /// N-gram size for the repetition detector.
    pub ngram_size: usize,
    /// Maximum allowed consecutive repeats of any n-gram.
    pub max_ngram_repeats: usize,
    /// Known-hallucination substrings (case-insensitive exact contain).
    pub blacklist: Vec<String>,
}

impl Default for GuardConfig {
    fn default() -> Self {
        Self {
            max_no_speech_prob: 0.6,
            max_compression_ratio: 2.4,
            ngram_size: 3,
            max_ngram_repeats: 3,
            blacklist: default_blacklist(),
        }
    }
}

/// Known hallucination patterns observed in Whisper output on silence /
/// low-SNR inputs. Sourced from whisper.cpp issue threads and
/// systematic audit of our own v0.5.x fine-refinement logs. Keep the
/// list short: each entry adds false-positive risk on material that
/// happens to mention the phrase legitimately.
pub fn default_blacklist() -> Vec<String> {
    vec![
        // English — YouTube training-set artifacts
        "thank you for watching".to_string(),
        "thanks for watching".to_string(),
        "don't forget to subscribe".to_string(),
        "please subscribe".to_string(),
        "like and subscribe".to_string(),
        "see you in the next video".to_string(),
        // Mandarin — common on Chinese-trained data
        "请订阅".to_string(),
        "字幕组".to_string(),
        "字幕志愿者".to_string(),
        "谢谢观看".to_string(),
    ]
}

/// Why a segment was dropped (or why it passed). Returned by
/// [`evaluate`] so the caller can log / surface diagnostics without
/// having to re-run the individual filters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GuardVerdict {
    Pass,
    /// Whisper's `no_speech_probability` exceeded the threshold.
    HighNoSpeech { prob: f32 },
    /// `compression_ratio` exceeded the threshold.
    HighCompression { ratio: f32 },
    /// An n-gram repeated beyond `max_ngram_repeats` consecutively.
    ExcessRepetition { ngram: String, count: usize },
    /// A blacklist entry matched.
    Blacklisted { pattern: String },
}

impl GuardVerdict {
    /// Whether this verdict means "drop the segment".
    pub fn should_drop(&self) -> bool {
        !matches!(self, GuardVerdict::Pass)
    }
}

/// Run every guard in cheap-to-expensive order. Returns the first
/// failure reason, or `Pass` if the segment survives.
pub fn evaluate(text: &str, no_speech_prob: f32, cfg: &GuardConfig) -> GuardVerdict {
    if no_speech_prob > cfg.max_no_speech_prob {
        return GuardVerdict::HighNoSpeech {
            prob: no_speech_prob,
        };
    }
    let cr = compression_ratio(text);
    if cr > cfg.max_compression_ratio {
        return GuardVerdict::HighCompression { ratio: cr };
    }
    if let Some((ngram, count)) = excessive_ngram_repeat(text, cfg.ngram_size, cfg.max_ngram_repeats) {
        return GuardVerdict::ExcessRepetition { ngram, count };
    }
    if let Some(pattern) = blacklist_match(text, &cfg.blacklist) {
        return GuardVerdict::Blacklisted { pattern };
    }
    GuardVerdict::Pass
}

/// `utf-8(text).len() / zlib(text).len()` — the ratio Whisper uses
/// internally to decide whether to re-decode. High values correlate
/// with repetition because zlib compresses repetition well. Short
/// texts (<16 bytes) return a neutral 1.0 — too little signal to
/// meaningfully ratio against.
pub fn compression_ratio(text: &str) -> f32 {
    let bytes = text.as_bytes();
    if bytes.len() < 16 {
        return 1.0;
    }
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    if encoder.write_all(bytes).is_err() {
        return 1.0;
    }
    let compressed = match encoder.finish() {
        Ok(c) => c,
        Err(_) => return 1.0,
    };
    if compressed.is_empty() {
        return 1.0;
    }
    bytes.len() as f32 / compressed.len() as f32
}

/// Tokenise on whitespace and look for any n-gram that repeats
/// consecutively more than `max_repeats` times. Tokens are compared
/// case-insensitively after stripping trailing `,.!?` — so `"I think,
/// I think, I think, I think."` is caught as `"I think"` × 4 not as
/// four distinct trigrams.
///
/// Returns `Some((ngram_string, repeat_count))` for the first
/// offender found, or `None` if the segment is clean.
pub fn excessive_ngram_repeat(
    text: &str,
    n: usize,
    max_repeats: usize,
) -> Option<(String, usize)> {
    if n == 0 || max_repeats == 0 {
        return None;
    }
    let tokens: Vec<String> = text
        .split_whitespace()
        .map(|t| {
            t.trim_matches(|c: char| matches!(c, ',' | '.' | '!' | '?' | ';' | ':' | '、' | '。' | '？' | '！'))
                .to_lowercase()
        })
        .filter(|t| !t.is_empty())
        .collect();
    if tokens.len() < n * (max_repeats + 1) {
        return None;
    }
    let mut i = 0;
    while i + n * (max_repeats + 1) <= tokens.len() {
        let window = &tokens[i..i + n];
        // Count how many times this same window repeats starting at i.
        let mut k = 1;
        while i + n * (k + 1) <= tokens.len() && tokens[i + n * k..i + n * (k + 1)] == *window {
            k += 1;
        }
        if k > max_repeats {
            return Some((window.join(" "), k));
        }
        i += 1;
    }
    None
}

/// Lowercase contain check against every pattern. Returns the first
/// match so the verdict message tells us WHAT matched (useful when
/// debugging false positives on legitimate content).
pub fn blacklist_match(text: &str, patterns: &[String]) -> Option<String> {
    let lower = text.to_lowercase();
    patterns
        .iter()
        .find(|p| lower.contains(&p.to_lowercase()))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compression_ratio_flags_tight_loops() {
        // 30 repeats of a short phrase — exactly the "Thank you for
        // watching ×N" hallucination shape.
        let looped = "Thank you for watching. ".repeat(30);
        let r = compression_ratio(&looped);
        assert!(r > 5.0, "expected ratio > 5.0 for tight loop, got {}", r);
    }

    #[test]
    fn compression_ratio_is_neutral_on_diverse_text() {
        let prose = "The quick brown fox jumps over the lazy dog. Sphinx of black quartz, judge my vow. How vexingly quick daft zebras jump.";
        let r = compression_ratio(prose);
        assert!(r < 2.4, "expected ratio < 2.4 for diverse prose, got {}", r);
    }

    #[test]
    fn compression_ratio_short_text_is_neutral() {
        // <16 bytes — not enough signal to meaningfully ratio.
        assert!((compression_ratio("hi") - 1.0).abs() < 1e-6);
        assert!((compression_ratio("").abs() - 1.0).abs() < 1e-6);
    }

    #[test]
    fn ngram_catches_tight_loops_over_the_threshold() {
        let text = "I think I think I think I think I think";
        let r = excessive_ngram_repeat(text, 2, 3);
        assert!(r.is_some(), "expected to catch 'I think' × 5 with max=3");
        let (ngram, count) = r.unwrap();
        assert_eq!(ngram, "i think");
        assert!(count >= 5);
    }

    #[test]
    fn ngram_ignores_runs_at_or_below_threshold() {
        // Exactly 3 repeats at max_repeats=3 → allowed.
        let text = "okay okay okay fine";
        assert!(excessive_ngram_repeat(text, 1, 3).is_none());
    }

    #[test]
    fn ngram_strips_trailing_punctuation_before_comparing() {
        // Without normalisation, these look like distinct tokens.
        let text = "I think, I think, I think, I think.";
        let r = excessive_ngram_repeat(text, 2, 2);
        assert!(r.is_some(), "trailing , and . must not block detection");
    }

    #[test]
    fn ngram_empty_and_clean_text_passes() {
        assert!(excessive_ngram_repeat("", 3, 3).is_none());
        assert!(excessive_ngram_repeat("one two three four five", 2, 3).is_none());
    }

    #[test]
    fn blacklist_matches_case_insensitively() {
        let patterns = default_blacklist();
        assert!(blacklist_match("Thank you for watching!", &patterns).is_some());
        assert!(blacklist_match("THANK YOU FOR WATCHING", &patterns).is_some());
        assert!(blacklist_match("请订阅并分享", &patterns).is_some());
    }

    #[test]
    fn blacklist_does_not_match_legitimate_content() {
        let patterns = default_blacklist();
        assert!(blacklist_match("The algorithm subscribes to this model", &patterns).is_none());
        assert!(blacklist_match("We are thanking the participants", &patterns).is_none());
    }

    #[test]
    fn evaluate_pass_on_normal_lecture_sentence() {
        let cfg = GuardConfig::default();
        let v = evaluate(
            "The gradient descent algorithm optimises the loss function.",
            0.1,
            &cfg,
        );
        assert_eq!(v, GuardVerdict::Pass);
    }

    #[test]
    fn evaluate_catches_whisper_youtube_artifact() {
        let cfg = GuardConfig::default();
        let v = evaluate("Thank you for watching!", 0.3, &cfg);
        assert!(v.should_drop());
    }

    #[test]
    fn evaluate_catches_high_no_speech_prob() {
        let cfg = GuardConfig::default();
        // Clean text but whisper said "this was mostly silence".
        let v = evaluate("something something", 0.85, &cfg);
        assert!(matches!(v, GuardVerdict::HighNoSpeech { .. }));
    }

    #[test]
    fn evaluate_catches_repetition_loop_before_blacklist() {
        // "我认为 × 30" is BOTH high compression AND heavily repeated.
        // The guard should fire on whichever check runs first (compression
        // is cheaper, so it wins). Either verdict is acceptable — we just
        // require some drop verdict.
        let cfg = GuardConfig::default();
        let looped: String = "我认为, ".repeat(30);
        let v = evaluate(&looped, 0.1, &cfg);
        assert!(v.should_drop());
    }

    #[test]
    fn evaluate_respects_disabled_blacklist() {
        let mut cfg = GuardConfig::default();
        cfg.blacklist.clear();
        // Same YouTube phrase as above — now passes blacklist but
        // compression ratio on this ONE line should not fire (< 2.4).
        let v = evaluate("Thank you for watching!", 0.1, &cfg);
        assert_eq!(v, GuardVerdict::Pass);
    }
}
