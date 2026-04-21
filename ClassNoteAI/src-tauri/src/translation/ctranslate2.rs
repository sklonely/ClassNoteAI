use ct2rs::tokenizers::sentencepiece::Tokenizer as SentencePieceTokenizer;
/**
 * CTranslate2 Translation Module
 *
 * Provides translation functionality using CTranslate2 models via ct2rs.
 * Supports various translation models like Marian-MT and M2M100.
 *
 * Note: For M2M100 multilingual models, the tokenizer in the model directory
 * needs to be configured with the correct source/target languages via
 * tokenizer_config.json or the source.spm/target.spm files.
 */
#[cfg(feature = "gpu-cuda")]
use ct2rs::Device;
use ct2rs::{BatchType, Config, TranslationOptions, Translator};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;

/// CTranslate2 Translator wrapper with sentencepiece tokenizer
pub struct CT2Translator {
    translator: Option<Arc<Translator<SentencePieceTokenizer>>>,
    model_path: Option<String>,
    source_lang: String,
    target_lang: String,
}

impl CT2Translator {
    /// Create a new uninitialized translator
    pub fn new() -> Self {
        Self {
            translator: None,
            model_path: None,
            source_lang: "en".to_string(),
            target_lang: "zh".to_string(),
        }
    }

    /// Load a CTranslate2 model from the given path
    pub fn load_model(&mut self, model_path: &str) -> Result<(), String> {
        println!("[CT2] Loading model from: {}", model_path);

        if !Path::new(model_path).exists() {
            return Err(format!("Model path does not exist: {}", model_path));
        }

        // Create translator config. When the binary was compiled with
        // `gpu-cuda`, we probe for a usable CUDA runtime before asking
        // ct2rs for a CUDA device — `cuda-dynamic-loading` still works
        // even if cudart is absent at runtime (falls back to CPU), but
        // checking up-front keeps the log message honest and avoids
        // ct2rs's generic error if things go sideways.
        #[cfg(feature = "gpu-cuda")]
        let mut config: Config = Default::default();
        #[cfg(not(feature = "gpu-cuda"))]
        let config: Config = Default::default();

        #[cfg(feature = "gpu-cuda")]
        {
            let det = crate::gpu::detect(Some("auto"));
            if det.cuda.is_some() {
                config.device = Device::CUDA;
                println!(
                    "[CT2] CUDA detected ({}), using Device::CUDA",
                    det.cuda.as_ref().unwrap().gpu_name
                );
            } else {
                println!("[CT2] No CUDA at runtime — using Device::CPU");
            }
        }

        // Find SentencePiece model file
        let sp_model_path = Path::new(model_path).join("sentencepiece.bpe.model");
        if !sp_model_path.exists() {
            return Err(format!(
                "SentencePiece model not found at: {:?}",
                sp_model_path
            ));
        }

        // Tokenizer is consumed by `with_tokenizer`, so a CUDA→CPU retry
        // needs a fresh one. A closure keeps both construction sites in
        // one place. SentencePieceTokenizer::from_file expects
        // (model_path, vocab_path); for M2M100 the same file serves both.
        let make_tokenizer = || {
            SentencePieceTokenizer::from_file(&sp_model_path, &sp_model_path)
                .map_err(|e| format!("Failed to load tokenizer: {}", e))
        };

        // Try loading with whatever device `config` picked above. If the
        // first attempt was on CUDA and it blew up (typical causes:
        // driver < CUDA runtime, cudart DLL missing at runtime even with
        // `cuda-dynamic-loading`, or a stale kernel cache), retry once
        // on CPU. We log but don't surface the switch — the product
        // directive is "use GPU when possible, stay quiet when it
        // can't." Only fail the command when the CPU attempt also fails.
        let first_tokenizer = make_tokenizer()?;
        let first_attempt = Translator::with_tokenizer(&model_path, first_tokenizer, &config);

        let translator = match first_attempt {
            Ok(t) => t,
            #[cfg(feature = "gpu-cuda")]
            Err(e) if matches!(config.device, Device::CUDA) => {
                println!("[CT2] CUDA load failed ({}), retrying on CPU", e);
                let mut cpu_config: Config = Default::default();
                cpu_config.device = Device::CPU;
                let cpu_tokenizer = make_tokenizer()?;
                Translator::with_tokenizer(&model_path, cpu_tokenizer, &cpu_config).map_err(
                    |err| {
                        format!(
                            "Failed to load CT2 model: CUDA load errored ({}) and CPU fallback also failed ({})",
                            e, err
                        )
                    },
                )?
            }
            Err(e) => return Err(format!("Failed to load CT2 model: {}", e)),
        };

        self.translator = Some(Arc::new(translator));
        self.model_path = Some(model_path.to_string());

        println!("[CT2] Model loaded successfully");
        Ok(())
    }

    /// Set source language (for future M2M100 support)
    #[allow(dead_code)]
    pub fn set_source_lang(&mut self, lang: &str) {
        self.source_lang = lang.to_string();
    }

    /// Set target language (for future M2M100 support)
    #[allow(dead_code)]
    pub fn set_target_lang(&mut self, lang: &str) {
        self.target_lang = lang.to_string();
    }

    /// Check if the translator is loaded
    pub fn is_loaded(&self) -> bool {
        self.translator.is_some()
    }

    /// Translate a batch of texts with optional source/target language override.
    ///
    /// For M2M100 we prepend the source language token (e.g. `__en__`) to each
    /// input. Without it the model sometimes refuses to cross-translate and
    /// echoes the source instead — especially on short / repetitive inputs.
    pub fn translate_batch(
        &self,
        texts: &[String],
        target_lang_override: Option<&str>,
        source_lang_override: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let translator = self
            .translator
            .as_ref()
            .ok_or_else(|| "Translator not loaded".to_string())?;

        if texts.is_empty() {
            return Ok(vec![]);
        }

        // Source language token (for M2M100 input prefix)
        let source_lang = source_lang_override.unwrap_or(&self.source_lang);
        let src_token = m2m100_lang_token(source_lang);

        // Translate only non-empty inputs. M2M100 given an empty string
        // after the source token produces garbage / can hang the beam
        // search. Record the original indices so we can interleave
        // empty-string outputs back at the correct positions.
        let non_empty: Vec<(usize, String)> = texts
            .iter()
            .enumerate()
            .filter(|(_, t)| !t.trim().is_empty())
            .map(|(i, t)| (i, format!("{} {}", src_token, t)))
            .collect();

        if non_empty.is_empty() {
            return Ok(vec![String::new(); texts.len()]);
        }

        let prefixed: Vec<String> = non_empty.iter().map(|(_, t)| t.clone()).collect();
        let sources: Vec<&str> = prefixed.iter().map(|s| s.as_str()).collect();

        // TranslationOptions with good defaults
        let options = TranslationOptions::<String, String> {
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
            // Try adding target_prefix here?
            // target_prefix: Some(vec![lang_token.to_string()]),
            // If this fails, we know it's not in options.
        };

        // Determine target language
        let target_lang = target_lang_override.unwrap_or(&self.target_lang);

        // Prepare target prefix (language token)
        // M2M100 requires the target language token as the first decoded token.
        let lang_token = m2m100_lang_token(target_lang);

        // Prepare target prefix (language token)
        let target_prefix = vec![vec![lang_token.to_string()]; sources.len()];

        // Translate using translate_batch_with_target_prefix
        let results = translator
            .translate_batch_with_target_prefix(&sources, &target_prefix, &options, None)
            .map_err(|e| format!("Translation failed: {}", e))?;

        // Extract translations from results, re-interleaving empty
        // strings at the positions whose inputs we skipped above. Each
        // output is run through `clean_translation` — M2M100 with the
        // src-side `__xx__` prefix we prepend occasionally leaks that
        // token back into the decoded string and, worse, sometimes
        // echoes the full English source before emitting the Chinese
        // translation (observed e.g. `"__en__ And we will have to save
        // it to the next class. 我们将不得不将其保存到下一类。"`).
        // We strip both unconditionally rather than try to fix the
        // prompting — post-processing is deterministic and cheap.
        let mut output = vec![String::new(); texts.len()];
        for ((orig_idx, _), (translation, _score)) in
            non_empty.iter().zip(results.into_iter())
        {
            output[*orig_idx] = clean_translation(&translation, target_lang);
        }

        Ok(output)
    }

    /// Translate a single text
    pub fn translate(&self, text: &str) -> Result<String, String> {
        let results = self.translate_batch(&[text.to_string()], None, None)?;
        results
            .into_iter()
            .next()
            .ok_or_else(|| "No translation result".to_string())
    }
}

/// Post-process a raw M2M100 translation output:
///   1. Strip any `__xx__` / `__xxx__` language tokens — these are
///      meant to be internal and shouldn't appear in user-visible
///      text, but M2M100 occasionally echoes them.
///   2. If the target language is Chinese and the output still starts
///      with non-CJK characters (observed: the model echoing the
///      English source before switching languages), drop everything
///      up to the first CJK character.
///
/// Kept conservative — this only touches known failure modes; normal
/// translations (which are pure target-language text) pass through
/// unchanged after step 1.
fn clean_translation(raw: &str, target_lang: &str) -> String {
    // Step 1: strip `__xx__` / `__xxx__` / `__xxxx__` tokens.
    let mut s = raw.trim().to_string();
    loop {
        let Some(start) = s.find("__") else { break };
        let remaining = &s[start + 2..];
        let Some(end_offset) = remaining.find("__") else { break };
        if end_offset == 0 || end_offset > 4 {
            // Not a plausible lang token — bail to avoid eating user text.
            break;
        }
        let token_end = start + 2 + end_offset + 2;
        s.replace_range(start..token_end, " ");
    }
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");

    // Step 2: if target is zh, strip any leading non-CJK text. We
    // consider CJK blocks, CJK extension A, halfwidth/fullwidth punct,
    // and CJK punct — i.e. anything that could legitimately START a
    // Chinese sentence.
    if target_lang.starts_with("zh") {
        let is_cjk = |c: char| {
            let u = c as u32;
            (0x3000..=0x303F).contains(&u) // CJK punctuation
                || (0x3400..=0x4DBF).contains(&u) // CJK Ext A
                || (0x4E00..=0x9FFF).contains(&u) // CJK Unified
                || (0xFF00..=0xFFEF).contains(&u) // Halfwidth/Fullwidth
                || (0xF900..=0xFAFF).contains(&u) // Compatibility
        };
        if let Some((i, _)) = s.char_indices().find(|(_, c)| is_cjk(*c)) {
            s = s[i..].trim().to_string();
        }
    }
    s
}

/// Map ISO-ish language codes to the M2M100 language token used by
/// CTranslate2's target_prefix and by the source-side text prefix we
/// prepend manually. Keep this list aligned with the dropdown in
/// SettingsView / SetupWizard.
fn m2m100_lang_token(lang: &str) -> &'static str {
    match lang {
        "zh" | "zh-CN" | "zh-TW" => "__zh__",
        "en" => "__en__",
        "ja" => "__ja__",
        "ko" => "__ko__",
        "fr" => "__fr__",
        "de" => "__de__",
        "es" => "__es__",
        "ru" => "__ru__",
        // `auto` falls back to English as a conservative default.
        // Whisper's language auto-detect should have reported a concrete
        // code by the time we reach translate_batch, so this branch is
        // mostly defensive.
        _ => "__en__",
    }
}

impl Default for CT2Translator {
    fn default() -> Self {
        Self::new()
    }
}

/// Global CT2 translator instance
static CT2_TRANSLATOR: tokio::sync::OnceCell<RwLock<CT2Translator>> =
    tokio::sync::OnceCell::const_new();

/// Get or initialize the CT2 translator
async fn get_translator() -> &'static RwLock<CT2Translator> {
    CT2_TRANSLATOR
        .get_or_init(|| async { RwLock::new(CT2Translator::new()) })
        .await
}

/// Load CT2 model
pub async fn load_ct2_model(model_path: &str) -> Result<(), String> {
    let translator = get_translator().await;
    let mut guard = translator.write().await;
    guard.load_model(model_path)
}

/// Check if CT2 model is loaded
pub async fn is_ct2_loaded() -> bool {
    let translator = get_translator().await;
    let guard = translator.read().await;
    guard.is_loaded()
}

/// Translate text using CT2
pub async fn translate_ct2(text: &str) -> Result<String, String> {
    let translator = get_translator().await;
    let guard = translator.read().await;
    guard.translate(text)
}

/// Translate batch using CT2
pub async fn translate_ct2_batch(texts: &[String]) -> Result<Vec<String>, String> {
    let translator = get_translator().await;
    let guard = translator.read().await;
    guard.translate_batch(texts, None, None)
}

// ========== Aliases for compatibility with rough.rs ==========

/// Check if CT2 model is loaded (alias for is_ct2_loaded)
pub async fn is_loaded() -> bool {
    is_ct2_loaded().await
}

/// Translate text with language parameters (uses configured languages)
pub async fn translate_text(
    text: &str,
    source_lang: &str,
    target_lang: &str,
) -> Result<String, String> {
    // Pass BOTH source and target through so M2M100 knows how to cross.
    let translator = get_translator().await;
    let guard = translator.read().await;

    let results = guard.translate_batch(
        &[text.to_string()],
        Some(target_lang),
        Some(source_lang),
    )?;
    results
        .into_iter()
        .next()
        .ok_or_else(|| "No translation result".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_translator_creation() {
        let translator = CT2Translator::new();
        assert!(!translator.is_loaded());
    }
}
