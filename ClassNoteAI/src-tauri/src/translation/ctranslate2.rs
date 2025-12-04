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

use ct2rs::{Config, Translator, TranslationOptions, BatchType};
use ct2rs::tokenizers::sentencepiece::Tokenizer as SentencePieceTokenizer;
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
        
        // Create translator with default config
        let config: Config = Default::default();
        
        // Find SentencePiece model file
        let sp_model_path = Path::new(model_path).join("sentencepiece.bpe.model");
        if !sp_model_path.exists() {
             return Err(format!("SentencePiece model not found at: {:?}", sp_model_path));
        }
        
        // Initialize Tokenizer
        // Note: SentencePieceTokenizer::from_file expects (model_path, vocab_path).
        // For M2M100, we pass the model path for both as the vocab is typically embedded or handled by the model file.
        let tokenizer = SentencePieceTokenizer::from_file(&sp_model_path, &sp_model_path)
            .map_err(|e| format!("Failed to load tokenizer: {}", e))?;
            
        // Initialize Translator with tokenizer
        let translator = Translator::with_tokenizer(&model_path, tokenizer, &config)
            .map_err(|e| format!("Failed to load CT2 model: {}", e))?;
        
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
    
    /// Translate a batch of texts with optional target language override
    pub fn translate_batch(&self, texts: &[String], target_lang_override: Option<&str>) -> Result<Vec<String>, String> {
        let translator = self.translator.as_ref()
            .ok_or_else(|| "Translator not loaded".to_string())?;
        
        if texts.is_empty() {
            return Ok(vec![]);
        }
        
        // Convert to Vec<&str> for the API
        let sources: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        
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
        // M2M100 requires the target language token as the first token
        // Map common codes to M2M100 tokens
        let lang_token = match target_lang {
            "zh" | "zh-CN" | "zh-TW" => "__zh__",
            "en" => "__en__",
            "ja" => "__ja__",
            "ko" => "__ko__",
            "fr" => "__fr__",
            "de" => "__de__",
            "es" => "__es__",
            "ru" => "__ru__",
            _ => "__en__", // Default to English if unknown
        };
        
        // Prepare target prefix (language token)
        let target_prefix = vec![vec![lang_token.to_string()]; sources.len()];

        // Translate using translate_batch_with_target_prefix
        let results = translator.translate_batch_with_target_prefix(
            &sources,
            &target_prefix,
            &options,
            None
        ).map_err(|e| format!("Translation failed: {}", e))?;
        
        // Extract translations from results
        let translations: Vec<String> = results.into_iter()
            .map(|(translation, _score)| translation)
            .collect();
        
        Ok(translations)
    }
    
    /// Translate a single text
    pub fn translate(&self, text: &str) -> Result<String, String> {
        let results = self.translate_batch(&[text.to_string()], None)?;
        results.into_iter().next()
            .ok_or_else(|| "No translation result".to_string())
    }
}

impl Default for CT2Translator {
    fn default() -> Self {
        Self::new()
    }
}

/// Global CT2 translator instance
static CT2_TRANSLATOR: tokio::sync::OnceCell<RwLock<CT2Translator>> = tokio::sync::OnceCell::const_new();

/// Get or initialize the CT2 translator
async fn get_translator() -> &'static RwLock<CT2Translator> {
    CT2_TRANSLATOR.get_or_init(|| async {
        RwLock::new(CT2Translator::new())
    }).await
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
    guard.translate_batch(texts, None)
}

// ========== Aliases for compatibility with rough.rs ==========

/// Check if CT2 model is loaded (alias for is_ct2_loaded)
pub async fn is_loaded() -> bool {
    is_ct2_loaded().await
}

/// Translate text with language parameters (uses configured languages)
pub async fn translate_text(text: &str, _source_lang: &str, target_lang: &str) -> Result<String, String> {
    // Use the provided target_lang instead of the default
    let translator = get_translator().await;
    let guard = translator.read().await;
    
    let results = guard.translate_batch(&[text.to_string()], Some(target_lang))?;
    results.into_iter().next()
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
