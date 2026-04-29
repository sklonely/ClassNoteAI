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
///
/// cp75.15: trimmed 400 → 300. With the vLLM-style delimiter prompt
/// (no instructional preamble), echoed-prompt failures are bounded by
/// stop tokens, not by n_predict. 300 is enough headroom for a 60-word
/// sentence's Chinese expansion (~150–250 target tokens) while limiting
/// the worst-case bleed if the model ever ignores the stop sequences.
const MAX_TOKENS: u32 = 300;

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
/// cp75.15 — switched to vLLM-style structured delimiter format wrapped
/// in a Gemma chat turn. Combines two findings from the 2026-04-29
/// translation-prompt research:
///
///   - **Option A (vLLM TranslateGemma fork)**: production deployments
///     of TranslateGemma feed the model `<<<source>>>{src}<<<target>>>{tgt}<<<text>>>{text}`
///     as the user content. The delimiters mirror the structured-content
///     fields the model's training-time chat template expected; the
///     model recognises them as a translation request without any
///     natural-language instruction.
///   - **Option D (TranslateGemma-Studio plain mode)**: minimal prompt
///     plus a wide stop-sequence net catches the model when it tries to
///     continue past the translation (e.g. emitting another `<<<source>>>`
///     turn or an English `Source:` echo).
///
/// Why the previous cp74.3 multi-rule prompt failed:
///   - Per Google's TranslateGemma model card, the model "does not
///     support separate system prompts or instruction-style parameters"
///     — any text in the user turn is treated as content to translate.
///     The five English "Rules:" lines were being faithfully translated
///     into the output instead of being followed.
///
/// We don't need natural-language naming of the language ("Traditional
/// Chinese") in the prompt: the BCP-47 code (`zh-TW` vs `zh-CN`) is the
/// signal the model was trained on, and lang_label's character-class
/// nudge ("never Simplified") was itself getting echoed.
fn build_prompt(text: &str, source_lang: &str, target_lang: &str) -> String {
    format!(
        "<start_of_turn>user\n\
         <<<source>>>{src_code}<<<target>>>{tgt_code}<<<text>>>{text}<end_of_turn>\n\
         <start_of_turn>model\n",
        src_code = source_lang,
        tgt_code = target_lang,
        text = text,
    )
}

#[derive(Serialize)]
struct CompletionRequest<'a> {
    prompt: String,
    temperature: f32,
    top_p: f32,
    /// Filter tokens with probability < min_p × max_token_prob. cp74.3 —
    /// added with `min_p: 0.05` to discard junk continuations the 4B Q4
    /// model occasionally surfaces when greedy decoding gets unstuck.
    min_p: f32,
    /// cp74.3 — added at 1.1. The 4B Q4 quantization sometimes degenerates
    /// into character-level repetition mid-sentence (常常常常 / theytheythey)
    /// especially on long inputs; a mild penalty kills the loop without
    /// distorting normal repetition (e.g. 「我們」 used twice in one
    /// sentence is fine, this is per-token not per-phrase).
    repeat_penalty: f32,
    n_predict: u32,
    /// llama-server reuses cached prompt prefixes across requests when
    /// `cache_prompt: true`. Our prompts share the same ~10-line system
    /// scaffold for every sentence in a recording — caching saves ~5–10ms
    /// per request on top of the inference itself.
    cache_prompt: bool,
    stop: &'a [&'a str],
    stream: bool,
}

#[derive(Deserialize)]
struct CompletionResponse {
    /// Raw generated string (Gemma model output, before stripping).
    content: String,
}

/// Translate `text` from `source_lang` to `target_lang` using TranslateGemma.
///
/// `endpoint` should point at the llama-server root (e.g.
/// `http://127.0.0.1:8080`); the `/completion` path is appended here.
/// Pass `None` to use [`DEFAULT_ENDPOINT`].
///
/// `source_lang` / `target_lang` are ISO-639-1 (or BCP-47 region) codes,
/// e.g. `en`, `zh-TW`, `zh-CN`, `ja`. Codes flow through to the prompt
/// verbatim inside the `<<<source>>>…<<<target>>>` delimiter pair —
/// TranslateGemma was trained on the bare lang code, no human-readable
/// language name is needed (or beneficial — see cp75.15 notes on
/// `build_prompt` for why prompt text gets translated, not followed).
///
/// cp75.1 — added `source_lang` / `target_lang` parameters. Before this
/// release the function was hardcoded English → Traditional Chinese; the
/// PTranslate language pickers had no runtime effect.
///
/// cp75.15 — switched to vLLM-style structured-delimiter prompt; dropped
/// natural-language language naming + behaviour rules (Google's model
/// card confirms the model treats them as input to translate, not as
/// instructions).
pub async fn translate(
    text: &str,
    source_lang: &str,
    target_lang: &str,
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
        prompt: build_prompt(text, source_lang, target_lang),
        // cp75.15 sampling tuning — aligned with WaveSpeedAI's published
        // TranslateGemma defaults (the closest-to-official guidance we
        // have, since Google's docs deliberately don't pin sampling
        // params): temperature 0.2 / top_p 0.9 / repetition_penalty 1.02.
        //   - temperature 0.1 → 0.2: WaveSpeedAI recommends 0.2–0.4.
        //     The bump gives the model room to pick correct collocations
        //     on rare-vocabulary inputs without becoming creative.
        //   - top_p 0.9: unchanged.
        //   - min_p 0.05: kept as belt-and-braces vs top_p — filters
        //     absolute low-probability junk on long-tail inputs.
        //   - repeat_penalty 1.1 → 1.02: 1.1 was distorting the model's
        //     natural connector usage in long Chinese sentences (它它它
        //     loops were a rough-mode artefact and shouldn't dominate
        //     the param choice for the well-formed default case).
        temperature: 0.2,
        top_p: 0.9,
        min_p: 0.05,
        repeat_penalty: 1.02,
        n_predict: MAX_TOKENS,
        cache_prompt: true,
        // cp75.15 — wider stop net. The vLLM-style delimiter prompt has
        // no natural English continuation, so any of these markers
        // appearing in the output means the model is starting a fake
        // next turn or echoing the prompt structure. Stopping at the
        // first occurrence cuts the bleed before it becomes user-visible.
        //
        //   - <end_of_turn> / <start_of_turn>: Gemma chat-template
        //     boundaries, primary stop signal.
        //   - <<<source>>> / <<<target>>> / <<<text>>>: vLLM delimiter
        //     tokens. If the model tries to start a second translation
        //     turn it'll emit one of these first.
        //   - "\n<<<": catches partial delimiter emission (e.g. a model
        //     that tokenises `<<<source>>>` differently might emit
        //     `<<<` alone before the body).
        //   - "Source:" / "Target:" / "English:": plain-language
        //     prompt-echo guards (these would mean the model fell back
        //     to its generic instruction-following mode).
        stop: &[
            "<end_of_turn>",
            "<start_of_turn>",
            "<<<source>>>",
            "<<<target>>>",
            "<<<text>>>",
            "\n<<<",
            "\nSource:",
            "\nTarget:",
            "\nEnglish:",
        ],
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
        let result = translate("", "en", "zh-TW", None).await.unwrap();
        assert!(result.translated_text.is_empty());
        assert!(matches!(result.source, TranslationSource::Rough));
    }

    #[tokio::test]
    async fn unreachable_endpoint_returns_friendly_error() {
        // Use a port we don't expect anything on
        let err = translate("Hello.", "en", "zh-TW", Some("http://127.0.0.1:1"))
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
        let err = translate(&huge, "en", "zh-TW", Some("http://127.0.0.1:1"))
            .await
            .unwrap_err();
        match err {
            TranslationError::LocalError(msg) => {
                assert!(msg.contains("too long"), "msg = {msg}");
            }
            other => panic!("expected LocalError(too long), got: {other}"),
        }
    }

    /// cp75.15 — vLLM-style delimiter format. The prompt body is a
    /// single line of structured tokens between Gemma chat boundaries:
    /// no English instructions, no rules, no charset hints. This test
    /// pins the exact wire format we're sending to TranslateGemma so a
    /// stray newline or reordered delimiter shows up immediately.
    #[test]
    fn prompt_uses_vllm_delimiter_format() {
        let p = build_prompt("Hello world.", "en", "zh-TW");

        // Must open and close with the Gemma chat markers (the
        // `--no-jinja` raw-completion path requires these literally).
        assert!(p.starts_with("<start_of_turn>user\n"), "prompt = {p:?}");
        assert!(p.contains("<end_of_turn>\n<start_of_turn>model\n"), "prompt = {p:?}");

        // Must contain the three vLLM delimiters in order, with the
        // raw lang codes (no human-readable names).
        let body_pos_source = p.find("<<<source>>>en").expect("source delimiter");
        let body_pos_target = p.find("<<<target>>>zh-TW").expect("target delimiter");
        let body_pos_text = p.find("<<<text>>>Hello world.").expect("text delimiter");
        assert!(body_pos_source < body_pos_target);
        assert!(body_pos_target < body_pos_text);
    }

    /// cp75.15 — the new prompt has zero natural-language instructions.
    /// The TranslateGemma model card says any text in the user turn is
    /// translated, so words like "translate" or "rules" leaking into
    /// the prompt are the original cp74.3 echo-bug.
    #[test]
    fn prompt_contains_no_english_instructions() {
        let p = build_prompt("Some text.", "en", "zh-TW");
        let lower = p.to_lowercase();
        for forbidden in ["translate", "output only", "rules:", "preserve", "register"] {
            assert!(
                !lower.contains(forbidden),
                "prompt must not contain instruction word {forbidden:?}, got: {p}"
            );
        }
    }

    /// cp75.15 — character-class hints (繁體 / 简体) are no longer
    /// emitted. The lang code itself (`zh-TW` vs `zh-CN`) is the
    /// signal TranslateGemma was trained on; the natural-language
    /// hint was being translated into the output.
    #[test]
    fn prompt_omits_charset_hints_for_chinese() {
        let p_tw = build_prompt("Hello.", "en", "zh-TW");
        let p_cn = build_prompt("Hello.", "en", "zh-CN");
        assert!(!p_tw.contains("繁體"));
        assert!(!p_tw.contains("Traditional"));
        assert!(!p_cn.contains("简体"));
        assert!(!p_cn.contains("Simplified"));

        // …but the lang codes themselves must land verbatim.
        assert!(p_tw.contains("<<<target>>>zh-TW"));
        assert!(p_cn.contains("<<<target>>>zh-CN"));
    }

    /// cp75.15 — pass-through lang codes. A code we don't know about
    /// (e.g. a region we haven't tested) should still flow through
    /// the delimiter format without any special fallback like
    /// "the target language".
    #[test]
    fn prompt_passes_through_unknown_lang_codes() {
        let p = build_prompt("Hi.", "en", "sw"); // Swahili
        assert!(p.contains("<<<target>>>sw<<<text>>>Hi."));
        assert!(!p.contains("the target language"), "no human-readable fallback expected");
    }

    /// Regression: the input text must land in the prompt verbatim,
    /// without any leading or trailing whitespace inserted between
    /// `<<<text>>>` and the body. The model relies on the delimiter
    /// touching the text directly to recognise the boundary.
    #[test]
    fn prompt_text_immediately_follows_text_delimiter() {
        let p = build_prompt("ACME Corp launched OmniGPT.", "en", "zh-TW");
        assert!(p.contains("<<<text>>>ACME Corp launched OmniGPT."));
    }
}
