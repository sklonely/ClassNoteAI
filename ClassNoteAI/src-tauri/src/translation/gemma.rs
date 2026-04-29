//! TranslateGemma 4B backend via llama-server HTTP sidecar.
//!
//! This module talks to a locally-running `llama-server` instance (from
//! llama.cpp) hosting `translategemma-4b-it-Q4_K_M.gguf`. We send raw
//! prompts to the `/completion` endpoint using the Gemma chat template
//! manually formatted (TranslateGemma's embedded jinja template doesn't
//! parse correctly in llama-server's chat/completions endpoint, see notes
//! in D:\tmp\seg-experiments\stream_demo.py).
//!
//! Why not the OpenAI chat/completions endpoint?
//! - TranslateGemma's GGUF embeds a custom translation-specific jinja
//!   template that expects `{type, source_lang_code, target_lang_code,
//!   text}` structured content, not plain string content. llama-server
//!   rejects standard chat messages against it. `--no-jinja` avoids
//!   loading that template at all, and we format the Gemma prompt
//!   ourselves below.
//!
//! Why HTTP sidecar instead of in-process llama-cpp-2?
//! - Reuses the same llama-server binary we already need for whisper.cpp
//!   tooling, avoiding a parallel libllama integration.
//! - Allows the sidecar to live across renderer reloads.
//! - Keeps GPU memory management isolated from the main process.
//!
//! The server is expected to be running before this module is invoked.
//! The Tauri app spawns it as a sidecar at startup when the Gemma
//! provider is selected (sidecar lifecycle lives in `gemma::sidecar`,
//! to be added in a follow-up commit; this commit only ships the
//! HTTP client + provider dispatch).

use serde::{Deserialize, Serialize};
use std::time::Duration;

use super::{TranslationError, TranslationResult, TranslationSource};

/// Default llama-server endpoint. Can be overridden via the
/// `gemma_url` field in the front-end translation settings.
pub const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8080";

/// Per-request HTTP timeout. TranslateGemma 4B Q4_K_M on RTX 4060 Ti
/// generates ~80 t/s on GPU; a single lecture sentence (≤200 tokens)
/// finishes in well under 3 s. 30 s gives headroom for first-call
/// model warm-up and slower CPU-only setups.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Maximum tokens to generate per request. Caps runaway generations
/// while still covering long lecture sentences.
const MAX_TOKENS: u32 = 200;

/// Refuse inputs longer than this character count *before* we hit the
/// network, so a single huge sentence (e.g. an accumulator that
/// somehow bypassed its hard cap) doesn't blow up the sidecar's context
/// window. With `SentenceAccumulator`'s 60-word cap this is normally
/// well under 500 chars; the limit gives ~6× headroom for edge cases
/// (long compound words, long Chinese commits) without ever
/// approaching `-c 4096`.
const MAX_INPUT_CHARS: usize = 3_000;

/// Gemma chat template for raw `/completion`.
///
/// Phase 7 cp74.2 — domain-aware prompt:
///
/// The earlier prompt was a one-liner ("translate to Traditional Chinese,
/// output only") which left the 4B Q4_K_M model to guess on academic /
/// ML / technical content. Real failure modes observed:
///   - "adversarial training" rendered three different ways across the
///     same lecture (對抗性訓練 / 敵對訓練 / 對抗式訓練).
///   - Acronyms invented or expanded incorrectly ("DBAT" → "the bat").
///   - Loanwords like "natural accuracy" translated literally to
///     「自然的精確度」 instead of the canonical 「自然準確率」.
///
/// New prompt: tells the model the input is academic/technical, pins a
/// few canonical ML translations, and explicitly says to preserve
/// acronyms / proper nouns. Costs ~150 extra prompt tokens — negligible
/// compared to the per-sentence generation budget. Empirically this
/// also stops the model from emitting an introductory phrase before
/// the actual translation, a recurring 4B failure mode.
fn build_prompt(eng: &str) -> String {
    format!(
        "<start_of_turn>user\n\
         Translate the following English sentence to Traditional Chinese (繁體中文).\n\
         \n\
         Context: this is one sentence from a transcript of an academic / technical \
         lecture or presentation. The speaker may use machine learning, computer \
         science, or other scientific terminology, and the recording may be from a \
         non-native English speaker.\n\
         \n\
         Rules:\n\
         - Output ONLY the Traditional Chinese translation. No preamble, no \
           explanations, no English echo.\n\
         - Preserve canonical technical translations: 'adversarial training' → \
           '對抗訓練', 'natural accuracy' → '自然準確率', 'robustness' → '穩健性', \
           'gradient' → '梯度', 'loss function' → '損失函數', 'perturbation' → '擾動', \
           'decision boundary' → '決策邊界', 'fine-tuning' → '微調'.\n\
         - Keep ALL acronyms (e.g. DBAT, ASR, LLM, RNN, BERT, GAN) and ALL proper \
           nouns / model names in their original English form. Do NOT translate or \
           expand them.\n\
         - When you don't know the canonical Chinese translation of a technical \
           term, keep that term in English rather than guessing.\n\
         - Use Traditional Chinese (繁體中文), not Simplified.\n\
         \n\
         English:\n{eng}\n\n\
         Traditional Chinese:<end_of_turn>\n\
         <start_of_turn>model\n"
    )
}

#[derive(Serialize)]
struct CompletionRequest<'a> {
    prompt: String,
    temperature: f32,
    top_p: f32,
    n_predict: u32,
    stop: &'a [&'a str],
    stream: bool,
}

#[derive(Deserialize)]
struct CompletionResponse {
    /// Raw generated string (Gemma model output, before stripping).
    content: String,
}

/// Translate `text` from English to Traditional Chinese using TranslateGemma.
///
/// `endpoint` should point at the llama-server root (e.g.
/// `http://127.0.0.1:8080`); the `/completion` path is appended here.
/// Pass `None` to use [`DEFAULT_ENDPOINT`].
pub async fn translate(
    text: &str,
    endpoint: Option<&str>,
) -> Result<TranslationResult, TranslationError> {
    if text.trim().is_empty() {
        return Ok(TranslationResult {
            translated_text: String::new(),
            source: TranslationSource::Rough,
            confidence: Some(1.0),
        });
    }

    if text.chars().count() > MAX_INPUT_CHARS {
        return Err(TranslationError::LocalError(format!(
            "input too long: {} chars (cap {}). \
             SentenceAccumulator's hard cap should prevent this — please \
             file a bug with the offending text.",
            text.chars().count(),
            MAX_INPUT_CHARS
        )));
    }

    let base = endpoint.unwrap_or(DEFAULT_ENDPOINT);
    let url = format!("{}/completion", base.trim_end_matches('/'));
    let body = CompletionRequest {
        prompt: build_prompt(text),
        temperature: 0.0,
        top_p: 1.0,
        n_predict: MAX_TOKENS,
        // Gemma may regenerate the chat boundary tokens after finishing
        // a translation; stop at either to avoid bleeding into a fake
        // next turn.
        stop: &["<end_of_turn>", "<start_of_turn>"],
        stream: false,
    };

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| TranslationError::RemoteError(format!("HTTP client init: {e}")))?;

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| classify_error(e, base))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        return Err(TranslationError::RemoteError(format!(
            "llama-server returned {status}: {}",
            detail.chars().take(200).collect::<String>()
        )));
    }

    let parsed: CompletionResponse = resp
        .json()
        .await
        .map_err(|e| TranslationError::RemoteError(format!("response parse: {e}")))?;

    Ok(TranslationResult {
        translated_text: parsed.content.trim().to_string(),
        source: TranslationSource::Rough,
        confidence: Some(0.95),
    })
}

/// Map reqwest connection errors to user-friendly messages so the UI
/// can suggest starting the sidecar instead of just showing "error
/// sending request" when the server isn't up yet.
fn classify_error(e: reqwest::Error, endpoint: &str) -> TranslationError {
    if e.is_connect() {
        TranslationError::RemoteError(format!(
            "TranslateGemma 服務未啟動於 {endpoint}（請確認 llama-server sidecar 正在執行）"
        ))
    } else if e.is_timeout() {
        TranslationError::RemoteError(
            "TranslateGemma 請求逾時（GPU 推理超過 30s — 模型可能未啟用 GPU 或 VRAM 不足）"
                .to_string(),
        )
    } else {
        TranslationError::RemoteError(format!("HTTP error: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn empty_text_short_circuits() {
        let result = translate("", None).await.unwrap();
        assert!(result.translated_text.is_empty());
        assert!(matches!(result.source, TranslationSource::Rough));
    }

    #[tokio::test]
    async fn unreachable_endpoint_returns_friendly_error() {
        // Use a port we don't expect anything on
        let err = translate("Hello.", Some("http://127.0.0.1:1"))
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("未啟動") || msg.contains("HTTP error"),
            "expected connect-error message, got: {msg}"
        );
    }

    /// Guard against the regression observed in the 2026-04-25 70-min
    /// full-pipeline eval, where one runaway accumulator chunk reached
    /// the sidecar at 9721 tokens and crashed it. With the renderer's
    /// hard cap fixed, this should never happen — but defence-in-depth
    /// ensures a buggy upstream can't take down the sidecar.
    #[tokio::test]
    async fn oversized_input_short_circuits_before_network() {
        let huge = "word ".repeat(800); // 4000 chars, well over MAX_INPUT_CHARS
        // Point at port 1 — if the size guard fails we'd get a connect
        // error instead of LocalError, which is what the assertion catches.
        let err = translate(&huge, Some("http://127.0.0.1:1")).await.unwrap_err();
        match err {
            TranslationError::LocalError(msg) => {
                assert!(msg.contains("too long"), "msg = {msg}");
            }
            other => panic!("expected LocalError(too long), got: {other}"),
        }
    }

    #[test]
    fn prompt_includes_target_language_marker() {
        let p = build_prompt("Hello world.");
        assert!(p.contains("Traditional Chinese (繁體中文)"));
        assert!(p.contains("Hello world."));
        assert!(p.contains("<start_of_turn>model"));
    }
}
