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
/// cp74.3: bumped 200 → 400. A 60-word English sentence is ~80–120
/// English tokens, but the *translation* into Chinese can easily double
/// that with formal compounds and connectors (那麼／因此／我們可以). At
/// 200 we observed long academic sentences truncating mid-clause. 400
/// gives ~3× headroom and KV-cache cost is negligible.
const MAX_TOKENS: u32 = 400;

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
/// cp74.3 — domain-neutral but precise prompt. Approximates the
/// information TranslateGemma's specialized chat template would carry
/// (source_lang_code / target_lang_code) but rendered as a plain Gemma
/// chat turn so it works through `/completion` without requiring the
/// `--jinja` path (which has version-dependent llama-server support).
///
/// The previous one-liner ("translate to Traditional Chinese, output
/// only") was too sparse; the model was guessing at register, treating
/// acronyms inconsistently, and occasionally emitting Simplified
/// characters or English preambles. The new prompt:
///
///   - Names the source/target language codes explicitly (en → zh-TW)
///     so the model's mode-of-operation is unambiguous.
///   - Caps output behaviour ("only the translation, nothing else")
///     to suppress 4B's habit of prepending 「翻譯：」or 「以下是」.
///   - Pins five domain-neutral rules: Traditional vs Simplified,
///     proper-noun preservation, unknown-term fallback, register
///     matching, and output discipline.
///   - Stays generic — no ML / academic / medical / legal hints. The
///     rules apply equally to a Wikipedia article, a cooking video
///     transcript, or a board-meeting recording.
/// Map an ISO-style code to a human-readable name + character-class hint.
/// Used by `build_prompt` to render `Translate from {src_name} to {tgt_name}`
/// dynamically per request. The character-class hint is appended only for
/// targets where simplified/traditional confusion is real (zh-TW vs zh-CN).
fn lang_label(code: &str) -> (&'static str, Option<&'static str>) {
    match code.to_lowercase().as_str() {
        "en" | "en-us" | "en-gb" => ("English", None),
        "zh-tw" | "zh-hant" | "zh_tw" => (
            "Traditional Chinese (繁體中文)",
            Some("Use Traditional Chinese (繁體) characters. Never Simplified (简体)."),
        ),
        "zh-cn" | "zh-hans" | "zh_cn" | "zh" => (
            "Simplified Chinese (简体中文)",
            Some("Use Simplified Chinese (简体) characters. Never Traditional (繁體)."),
        ),
        "ja" => ("Japanese", None),
        "ko" => ("Korean", None),
        "es" => ("Spanish", None),
        "fr" => ("French", None),
        "de" => ("German", None),
        "pt" => ("Portuguese", None),
        "ru" => ("Russian", None),
        "ar" => ("Arabic", None),
        "vi" => ("Vietnamese", None),
        "th" => ("Thai", None),
        "id" => ("Indonesian", None),
        // Pass through any other ISO code we don't have a name for.
        _ => ("the target language", None),
    }
}

/// Gemma chat template for raw `/completion`.
///
/// cp75.1 — accepts dynamic source/target language. Replaces the previous
/// hardcoded "English → Traditional Chinese" path so PTranslate's
/// source_language / target_language settings actually take effect.
///
/// The prompt structure stays the same as cp74.3: domain-neutral, 4–5
/// behaviour rules, two trailing turn markers. The character-class rule
/// (繁體 vs 简体) is only emitted for Chinese targets where it actually
/// matters; for Japanese, Korean, etc. it would just be confusing noise.
fn build_prompt(text: &str, source_lang: &str, target_lang: &str) -> String {
    let (src_name, _) = lang_label(source_lang);
    let (tgt_name, tgt_charset_hint) = lang_label(target_lang);

    let charset_line = match tgt_charset_hint {
        Some(hint) => format!("- {hint}\n"),
        None => String::new(),
    };

    format!(
        "<start_of_turn>user\n\
         Translate the following from {src_name} ({src_code}) to {tgt_name} ({tgt_code}).\n\
         \n\
         Rules:\n\
         - Output only the translation. No preamble, no explanation, no source-language echo.\n\
         {charset_line}\
         - Preserve proper nouns, brand names, model names, and acronyms verbatim in their original form.\n\
         - For technical terms whose canonical translation you don't know, keep the original term.\n\
         - Match the source register: keep formal sentences formal, casual sentences casual.\n\
         \n\
         {src_name}: {text}\n\
         {tgt_name}:<end_of_turn>\n\
         <start_of_turn>model\n",
        src_name = src_name,
        tgt_name = tgt_name,
        src_code = source_lang,
        tgt_code = target_lang,
        charset_line = charset_line,
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
/// e.g. `en`, `zh-TW`, `zh-CN`, `ja`. Unknown codes are passed through
/// to the prompt verbatim and labelled "the target language" in the
/// natural-language portion (the model still sees the code so it has a
/// chance to recognise it).
///
/// cp75.1 — added `source_lang` / `target_lang` parameters. Before this
/// release the function was hardcoded English → Traditional Chinese; the
/// PTranslate language pickers had no runtime effect.
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
        // cp74.3 sampling tuning — based on the LLM-prompting guide (see
        // promptingguide.ai / f22labs Apr 2026):
        //   - temperature 0.0 (pure greedy) gets stuck on the first
        //     wrong continuation when 4B Q4_K_M is uncertain. 0.1 gives
        //     just enough slack to step out of local minima while
        //     remaining effectively deterministic for a given input.
        //   - top_p 0.9 excludes the long tail of nonsense tokens. With
        //     temp ≈ 0 and top_p = 1.0 the long tail rarely kicks in,
        //     but on rare-vocabulary inputs (proper nouns, acronyms)
        //     0.9 protects against the model latching onto a pre-trained
        //     bias.
        //   - min_p 0.05 belt-and-braces with top_p (filters absolute
        //     low-probability junk no matter the nucleus size).
        //   - repeat_penalty 1.1 stops 4B's degenerate-repetition mode.
        temperature: 0.1,
        top_p: 0.9,
        min_p: 0.05,
        repeat_penalty: 1.1,
        n_predict: MAX_TOKENS,
        cache_prompt: true,
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

    #[test]
    fn prompt_includes_target_language_marker_zh_tw() {
        let p = build_prompt("Hello world.", "en", "zh-TW");
        assert!(p.contains("zh-TW"), "prompt must mention target lang code");
        assert!(p.contains("繁體"), "zh-TW prompt must mention 繁體 character class");
        assert!(p.contains("Hello world."), "prompt must contain the input");
        assert!(p.contains("<start_of_turn>model"), "prompt must end with the model turn marker");
    }

    #[test]
    fn prompt_zh_cn_uses_simplified_charset_hint() {
        // cp75.1: dynamic prompt should swap the character-class hint
        // between Traditional and Simplified by target lang code.
        let p = build_prompt("Hello world.", "en", "zh-CN");
        assert!(p.contains("zh-CN"), "prompt must mention target lang code");
        assert!(p.contains("简体"), "zh-CN prompt must mention 简体 charset hint");
        assert!(
            !p.contains("Use Traditional Chinese (繁體) characters."),
            "zh-CN prompt must NOT pin Traditional charset"
        );
    }

    #[test]
    fn prompt_non_chinese_target_skips_charset_rule() {
        // For ja/ko/etc. there's no Trad/Simp distinction → don't emit
        // the line at all (avoids confusing the model).
        let p = build_prompt("Hello.", "en", "ja");
        assert!(p.contains("Japanese"), "prompt must name target language");
        assert!(!p.contains("繁體"), "ja prompt must not mention 繁體");
        assert!(!p.contains("简体"), "ja prompt must not mention 简体");
    }

    #[test]
    fn prompt_pins_register_and_acronym_rules() {
        // Regression: cp74.3 added five behaviour rules. Don't let a
        // future refactor silently drop any of them — at least verify
        // the keywords land in the prompt body.
        let p = build_prompt("Some sentence.", "en", "zh-TW");
        assert!(p.contains("Output only the translation"));
        assert!(p.contains("acronym") || p.contains("proper noun"));
        assert!(p.contains("register"));
    }
}
