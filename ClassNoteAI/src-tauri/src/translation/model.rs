/**
 * 翻譯模型管理
 * 處理 ONNX 模型的加載和管理
 * 
 * 使用 ort (onnxruntime-rs) 進行本地翻譯
 * 僅支持 ONNX 模型，無降級方案
 * 
 * 支持 Encoder-Decoder 架構（如 opus-mt-en-zh）
 */

use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;

// ONNX Runtime 依賴
use ort::session::Session;
use ort::value::{Tensor, TensorValueType};

// Tokenizer 依賴
use tokenizers::Tokenizer;
use serde_json::Value as JsonValue;

/// 預處理文本以提高翻譯質量
fn preprocess_text_for_translation(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    
    let mut cleaned = text.trim().to_string();
    
    // 1. 移除多餘的空白字符
    cleaned = cleaned.split_whitespace().collect::<Vec<&str>>().join(" ");
    
    // 2. 移除常見的轉錄錯誤標記（如 [音樂]、[笑聲]、(歌唱) 等）
    // 使用正則表達式移除 [...] 和 (...) 內容
    cleaned = regex::Regex::new(r"\[.*?\]").unwrap().replace_all(&cleaned, "").to_string();
    cleaned = regex::Regex::new(r"\(.*?\)").unwrap().replace_all(&cleaned, "").to_string();
    
    // 3. 處理 <unk> 標記 - 替換為空格（讓模型嘗試推斷）
    cleaned = regex::Regex::new(r"<unk>").unwrap().replace_all(&cleaned, " ").to_string();
    
    // 4. 清理多餘空格
    cleaned = cleaned.split_whitespace().collect::<Vec<&str>>().join(" ");
    
    // 5. 移除開頭和結尾的標點符號（如果只有標點符號）
    cleaned = cleaned.trim_matches(|c: char| matches!(c, '.' | ',' | '!' | '?' | ';' | ':' | ' ')).to_string();
    
    // 6. 確保文本不為空且長度合理
    cleaned.trim().to_string()
}

/// 翻譯模型管理器
/// 
/// 支持 Encoder-Decoder 架構：
/// - encoder_session: 編碼器模型
/// - decoder_session: 解碼器模型
/// 
/// 注意：Session 需要 &mut self 來執行推理
/// 解決方案：使用 std::sync::Mutex 包裝 Session，在 spawn_blocking 中使用
pub struct TranslationModel {
    encoder_session: Option<Arc<std::sync::Mutex<Session>>>,
    decoder_session: Option<Arc<std::sync::Mutex<Session>>>,
    tokenizer: Option<Arc<Tokenizer>>,
    vocab_map: Option<HashMap<String, i64>>,  // vocab.json 的映射：token -> id
    model_dir: String,
    tokenizer_path: Option<String>,
    is_loaded: bool,
    // 模型配置
    decoder_start_token_id: i64,
    eos_token_id: i64,
    max_length: usize,
    vocab_size: usize,  // 詞彙表大小（mbart-large-50 是 250054，opus-mt-en-zh 是 65001）
    hidden_size: usize,  // 隱藏層大小（mbart-large-50 是 1024，opus-mt-en-zh 是 512）
    model_type: String,  // 模型類型：mbart, marian (opus-mt), nllb
    // 生成配置
    generation_config: GenerationConfig,
}

/// 生成配置參數
#[derive(Clone)]
struct GenerationConfig {
    max_length: usize,
    temperature: f32,
    top_p: f32,
    repetition_penalty: f32,
    no_repeat_ngram_size: usize,  // 新增：N-gram 重複檢測大小
    short_sentence_threshold: usize,
    repetition_threshold: usize,
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            max_length: 150,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.5,  // 從 1.2 增加到 1.5
            no_repeat_ngram_size: 2,   // 新增：檢測 2-gram 重複
            short_sentence_threshold: 0, // 禁用短句採樣，全部使用 Greedy 以便於測試對比
            repetition_threshold: 3,
        }
    }
}

impl TranslationModel {
    /// 創建新的模型管理器
    pub fn new() -> Self {
        Self {
            encoder_session: None,
            decoder_session: None,
            tokenizer: None,
            vocab_map: None,
            model_dir: String::new(),
            tokenizer_path: None,
            is_loaded: false,
            decoder_start_token_id: 2, // 默認值，從 config.json 讀取
            eos_token_id: 2, // 默認值，從 config.json 讀取
            max_length: 1024, // 默認最大長度
            vocab_size: 250054, // 默認詞彙表大小（mbart-large-50）
            hidden_size: 1024, // 默認隱藏層大小（mbart-large-50）
            model_type: "mbart".to_string(), // 默認模型類型
            generation_config: GenerationConfig::default(),
        }
    }

    /// 加載翻譯模型
    /// 
    /// model_dir: 模型目錄路徑（包含 encoder_model.onnx 和 decoder_model.onnx）
    /// tokenizer_path: Tokenizer 文件路徑（可選，如果為空則嘗試自動查找）
    pub async fn load_model(&mut self, model_dir: &Path, tokenizer_path: Option<&Path>) -> Result<(), String> {
        // 檢查模型目錄是否存在
        if !model_dir.exists() {
            return Err(format!("模型目錄不存在: {:?}", model_dir));
        }

        // 讀取模型配置 (優先讀取配置，以便了解模型類型)
        let config_path = model_dir.join("config.json");
        if config_path.exists() {
            self.load_config(&config_path).await?;
        }

        // 構建 encoder 和 decoder 模型路徑
        // 優先嘗試量化版本
        let encoder_quantized = model_dir.join("encoder_model_quantized.onnx");
        let decoder_quantized = model_dir.join("decoder_model_quantized.onnx");
        
        let (encoder_path, decoder_path) = if encoder_quantized.exists() && decoder_quantized.exists() {
            println!("[TranslationModel] 檢測到量化模型");
            (encoder_quantized, decoder_quantized)
        } else {
            let encoder_path = model_dir.join("encoder_model.onnx");
            let decoder_path = model_dir.join("decoder_model.onnx");
            (encoder_path, decoder_path)
        };

        if !encoder_path.exists() {
            return Err(format!("Encoder 模型文件不存在: {:?}", encoder_path));
        }
        if !decoder_path.exists() {
            return Err(format!("Decoder 模型文件不存在: {:?}", decoder_path));
        }

        // 加載 encoder 模型
        println!("[TranslationModel] 加載 Encoder 模型: {:?}", encoder_path);
        let encoder_session = self.load_session(&encoder_path).await?;
        println!("[TranslationModel] Encoder 模型加載成功");

        // 加載 decoder 模型
        println!("[TranslationModel] 加載 Decoder 模型: {:?}", decoder_path);
        let decoder_session = self.load_session(&decoder_path).await?;
        println!("[TranslationModel] Decoder 模型加載成功");

        self.encoder_session = Some(Arc::new(std::sync::Mutex::new(encoder_session)));
        self.decoder_session = Some(Arc::new(std::sync::Mutex::new(decoder_session)));
        self.model_dir = model_dir.to_string_lossy().to_string();
        
        // 加載 tokenizer（如果提供路徑）
        if let Some(tokenizer_path) = tokenizer_path {
            if tokenizer_path.exists() {
                match self.load_tokenizer(tokenizer_path).await {
                    Ok(_) => {
                        println!("[TranslationModel] Tokenizer 加載成功: {:?}", tokenizer_path);
                        self.tokenizer_path = Some(tokenizer_path.to_string_lossy().to_string());
                    }
                    Err(e) => {
                        println!("[TranslationModel] 警告：Tokenizer 加載失敗: {}", e);
                        println!("[TranslationModel] 將繼續使用模型，但翻譯功能可能無法正常工作");
                    }
                }
            } else {
                println!("[TranslationModel] 警告：Tokenizer 文件不存在: {:?}", tokenizer_path);
            }
        } else {
            // 嘗試從模型目錄自動查找 tokenizer 文件
            let model_dir_path = Path::new(&self.model_dir);
            let tokenizer_json = model_dir_path.join("tokenizer.json");
            let vocab_json = model_dir_path.join("vocab.json");
            let source_spm = model_dir_path.join("source.spm");
            
            // 優先嘗試加載 tokenizer.json
            if tokenizer_json.exists() {
                match self.load_tokenizer(&tokenizer_json).await {
                    Ok(_) => {
                        println!("[TranslationModel] 自動加載 Tokenizer: {:?}", tokenizer_json);
                        self.tokenizer_path = Some(tokenizer_json.to_string_lossy().to_string());
                    }
                    Err(e) => {
                        println!("[TranslationModel] 警告：自動加載 Tokenizer 失敗: {}", e);
                    }
                }
            } else if vocab_json.exists() && source_spm.exists() {
                // 嘗試使用 vocab.json 和 source.spm 創建 tokenizer
                println!("[TranslationModel] 檢測到 vocab.json 和 source.spm，嘗試創建 Tokenizer...");
                match self.load_tokenizer_from_vocab_and_spm(&vocab_json, &source_spm).await {
                    Ok(_) => {
                        println!("[TranslationModel] 從 vocab.json 和 source.spm 加載 Tokenizer 成功");
                        self.tokenizer_path = Some(format!("{:?} + {:?}", vocab_json, source_spm));
                    }
                    Err(e) => {
                        println!("[TranslationModel] 警告：從 vocab.json 和 source.spm 加載 Tokenizer 失敗: {}", e);
                        println!("[TranslationModel] 建議：使用 transformers 將 tokenizer 保存為 tokenizer.json");
                    }
                }
            } else {
                println!("[TranslationModel] 警告：未找到 tokenizer.json、vocab.json 或 source.spm");
                println!("[TranslationModel] 建議：使用 transformers 將 tokenizer 保存為 tokenizer.json");
            }
        }
        
        self.is_loaded = true;
        println!("[TranslationModel] ONNX 模型加載成功: {}", self.model_dir);
        Ok(())
    }

    /// 加載單個 Session
    async fn load_session(&self, model_path: &Path) -> Result<Session, String> {
        let path = model_path.to_path_buf();
        tokio::task::spawn_blocking(move || {
            Session::builder()
                .map_err(|e| format!("創建 SessionBuilder 失敗: {}", e))?
                .commit_from_file(&path)
                .map_err(|e| format!("加載 ONNX 模型失敗: {}", e))
        })
        .await
        .map_err(|e| format!("異步任務失敗: {}", e))?
    }

    /// 加載模型配置
    async fn load_config(&mut self, config_path: &Path) -> Result<(), String> {
        use std::fs;
        use serde_json::Value;

        let config_str = fs::read_to_string(config_path)
            .map_err(|e| format!("讀取配置文件失敗: {}", e))?;
        
        let config: Value = serde_json::from_str(&config_str)
            .map_err(|e| format!("解析配置文件失敗: {}", e))?;

        // 讀取配置值
        if let Some(decoder_start_token_id) = config.get("decoder_start_token_id").and_then(|v| v.as_i64()) {
            self.decoder_start_token_id = decoder_start_token_id;
        }
        if let Some(eos_token_id) = config.get("eos_token_id").and_then(|v| v.as_i64()) {
            self.eos_token_id = eos_token_id;
        }
        // max_length 可能為 null，使用 max_position_embeddings 作為備選
        if let Some(max_length) = config.get("max_length").and_then(|v| v.as_u64()) {
            self.max_length = max_length as usize;
        } else if let Some(max_pos) = config.get("max_position_embeddings").and_then(|v| v.as_u64()) {
            self.max_length = max_pos as usize;
        }
        
        // 讀取 vocab_size
        if let Some(vocab_size) = config.get("vocab_size").and_then(|v| v.as_u64()) {
            self.vocab_size = vocab_size as usize;
        }
        
        // 讀取 hidden_size (d_model)
        if let Some(d_model) = config.get("d_model").and_then(|v| v.as_u64()) {
            self.hidden_size = d_model as usize;
        }
        
        // 檢測模型類型
        if let Some(model_type) = config.get("model_type").and_then(|v| v.as_str()) {
            self.model_type = model_type.to_string();
        } else if let Some(architectures) = config.get("architectures").and_then(|v| v.as_array()) {
            if let Some(first_arch) = architectures.first().and_then(|v| v.as_str()) {
                if first_arch.contains("Marian") {
                    self.model_type = "marian".to_string();
                } else if first_arch.contains("MBart") {
                    self.model_type = "mbart".to_string();
                } else if first_arch.contains("Nllb") {
                    self.model_type = "nllb".to_string();
                }
            }
        }

        println!("[TranslationModel] 配置加載成功:");
        println!("  模型類型: {}", self.model_type);
        println!("  decoder_start_token_id: {}", self.decoder_start_token_id);
        println!("  eos_token_id: {}", self.eos_token_id);
        println!("  max_length: {}", self.max_length);
        println!("  vocab_size: {}", self.vocab_size);
        println!("  hidden_size: {}", self.hidden_size);

        Ok(())
    }

    /// 加載 vocab.json 映射
    async fn load_vocab_map(&mut self, vocab_path: &Path) -> Result<(), String> {
        use std::fs;
        
        let path = vocab_path.to_path_buf();
        let vocab_str = tokio::task::spawn_blocking(move || {
            fs::read_to_string(&path)
                .map_err(|e| format!("讀取 vocab.json 失敗: {}", e))
        })
        .await
        .map_err(|e| format!("異步任務失敗: {}", e))??;
        
        let vocab: JsonValue = serde_json::from_str(&vocab_str)
            .map_err(|e| format!("解析 vocab.json 失敗: {}", e))?;
        
        // 轉換為 HashMap<String, i64>
        let mut vocab_map = HashMap::new();
        if let Some(vocab_obj) = vocab.as_object() {
            for (token, id_value) in vocab_obj {
                if let Some(id) = id_value.as_i64() {
                    vocab_map.insert(token.clone(), id);
                }
            }
        }
        
        self.vocab_map = Some(vocab_map);
        println!("[TranslationModel] Vocab 映射大小: {}", self.vocab_map.as_ref().unwrap().len());
        Ok(())
    }

    /// 加載 tokenizer
    async fn load_tokenizer(&mut self, tokenizer_path: &Path) -> Result<(), String> {
        let path = tokenizer_path.to_path_buf();
        let tokenizer_result = tokio::task::spawn_blocking(move || {
            Tokenizer::from_file(&path)
                .map_err(|e| format!("加載 Tokenizer 失敗: {}", e))
        })
        .await
        .map_err(|e| format!("異步任務失敗: {}", e))??;

        self.tokenizer = Some(Arc::new(tokenizer_result));
        Ok(())
    }

    /// 從 vocab.json 和 source.spm 創建 tokenizer
    /// 
    /// 注意：這是一個臨時解決方案，建議使用 tokenizer.json
    async fn load_tokenizer_from_vocab_and_spm(
        &mut self,
        vocab_path: &Path,
        spm_path: &Path,
    ) -> Result<(), String> {
        use std::fs;
        use serde_json::Value;
        
        // 讀取 vocab.json
        let vocab_str = fs::read_to_string(vocab_path)
            .map_err(|e| format!("讀取 vocab.json 失敗: {}", e))?;
        let _vocab: Value = serde_json::from_str(&vocab_str)
            .map_err(|e| format!("解析 vocab.json 失敗: {}", e))?;
        
        // 讀取 source.spm
        if !spm_path.exists() {
            return Err(format!("source.spm 文件不存在: {:?}", spm_path));
        }
        
        // 使用 tokenizers crate 從 SentencePiece 模型創建 tokenizer
        let spm_path_buf = spm_path.to_path_buf();
        let tokenizer_result = tokio::task::spawn_blocking(move || {
            // tokenizers crate 支持從 SentencePiece 模型加載
            Tokenizer::from_file(&spm_path_buf)
                .or_else(|_| {
                    // 如果直接加載失敗，嘗試使用 vocab.json 創建
                    // 注意：這可能需要額外的配置
                    Err("無法從 source.spm 直接加載，需要 tokenizer.json".to_string())
                })
        })
        .await
        .map_err(|e| format!("異步任務失敗: {}", e))??;

        self.tokenizer = Some(Arc::new(tokenizer_result));
        Ok(())
    }

    /// 執行翻譯推理
    /// 
    /// Encoder-Decoder 推理流程：
    /// 1. Tokenize 輸入文本
    /// 2. Encoder 推理（將輸入編碼）
    /// 3. Decoder 推理（自回歸生成輸出）
    /// 4. Detokenize 輸出文本
    pub async fn translate(
        &self,
        text: &str,
        _source_lang: &str,
        _target_lang: &str,
    ) -> Result<String, String> {
        if !self.is_loaded {
            return Err("ONNX 模型未加載，請先加載模型".to_string());
        }

        let encoder_session = self.encoder_session.as_ref()
            .ok_or_else(|| "Encoder 會話未初始化".to_string())?;
        let decoder_session = self.decoder_session.as_ref()
            .ok_or_else(|| "Decoder 會話未初始化".to_string())?;
        let tokenizer = self.tokenizer.as_ref()
            .ok_or_else(|| {
                let error_msg = format!(
                    "Tokenizer 未加載，無法進行翻譯。模型目錄: {}, Tokenizer 路徑: {:?}",
                    self.model_dir,
                    self.tokenizer_path
                );
                println!("[TranslationModel] {}", error_msg);
                error_msg
            })?;
        
        // 驗證 tokenizer 是否可用
        println!("[TranslationModel] Tokenizer 已加載，路徑: {:?}", self.tokenizer_path);

        // 在 spawn_blocking 中執行同步操作
        let tokenizer_clone = self.tokenizer.clone().unwrap();
        let encoder_clone = self.encoder_session.clone().unwrap();
        let decoder_clone = self.decoder_session.clone().unwrap();
        
        let text = text.to_string(); // 為 spawn_blocking 準備
        
        let config = self.generation_config.clone();
        let decoder_start_token_id = self.decoder_start_token_id;
        let eos_token_id = self.eos_token_id;
        let vocab_size = self.vocab_size;
        let model_type = self.model_type.clone();
        
        // 查找 NLLB/MBart 的語言 ID
        // 注意：這裡我們在閉包外部使用 tokenizer 查找 ID
        let eng_latn_id = tokenizer_clone.token_to_id("eng_Latn").map(|id| id as i64);
        let zho_hans_id = tokenizer_clone.token_to_id("zho_Hans").map(|id| id as i64);
        
        // 確定特殊的語言 token ID (Source, Target) 和是否需要在 encoder 輸入前添加 source lang token
        // 返回 (src_lang_token_id, tgt_lang_token_id, needs_encoder_prefix, needs_decoder_prefix)
        let (src_lang_token_id, tgt_lang_token_id, needs_encoder_prefix, needs_decoder_prefix) = if model_type == "marian" {
             // opus-mt-en-zh: 不需要語言代碼前綴
             (0i64, 0i64, false, false)
        } else if _source_lang == "eng_Latn" && _target_lang == "zho_Hans" {
            // NLLB: 嘗試查找
             if let (Some(src), Some(tgt)) = (eng_latn_id, zho_hans_id) {
                // NLLB: Encoder 不需要 src lang, Decoder 需要 tgt lang
                (src, tgt, false, true)
            } else {
                 println!("[TranslationModel] 警告：無法在詞表中找到 NLLB 語言代碼 (eng_Latn, zho_Hans)");
                 (256047, 256093, false, true) // 默認值
            }
        } else if _source_lang == "en_XX" && _target_lang == "zh_CN" {
            // MBart-Large-50: Encoder 需要 src lang, Decoder 需要 tgt lang
            (250004i64, 250025i64, true, true)
        } else if _source_lang == "en" && _target_lang == "zh" {
            // 默認：根據模型類型選擇
            if model_type == "mbart" {
                (250004i64, 250025i64, true, true)
            } else if model_type == "nllb" || model_type == "m2m_100" {
                // NLLB: 嘗試查找
                 if let (Some(src), Some(tgt)) = (eng_latn_id, zho_hans_id) {
                    (src, tgt, false, true)
                } else {
                     println!("[TranslationModel] 警告：無法在詞表中找到 NLLB 語言代碼 (eng_Latn, zho_Hans)");
                     (256047, 256093, false, true) // 默認值
                }
            } else {
                // opus-mt-en-zh 或其他模型 (Marian)
                (0i64, 0i64, false, false)
            }
        } else {
            // 未知語言對，使用默認值
            (decoder_start_token_id, decoder_start_token_id, false, false)
        };
        
        let result = tokio::task::spawn_blocking(move || {
            // 0. 預處理文本：清理和規範化
            let preprocessed_text = preprocess_text_for_translation(&text);
            if preprocessed_text.is_empty() {
                return Err("預處理後的文本為空".to_string());
            }
            
            // 1. Tokenize 輸入文本
            println!("[TranslationModel] 開始 Tokenize，文本: {}", preprocessed_text);
            let encoding = tokenizer_clone.encode(preprocessed_text.as_str(), true)
                .map_err(|e| format!("文本編碼失敗: {}。文本: {}", e, preprocessed_text))?;
            
            let mut input_ids: Vec<i64> = encoding.get_ids()
                .iter()
                .map(|&id| id as i64)
                .collect();
            
            println!("[TranslationModel] Tokenize 結果: {} tokens, IDs (前10個): {:?}", 
                input_ids.len(), 
                &input_ids[..input_ids.len().min(10)]
            );
            
            if input_ids.is_empty() {
                return Err(format!("編碼後的 token IDs 為空。原始文本: {}", preprocessed_text));
            }
            
            // 根據模型類型處理輸入格式
            if needs_encoder_prefix {
                // MBart: 需要語言代碼前綴
                // 檢查是否已經有語言代碼前綴
                if input_ids.first() != Some(&src_lang_token_id) {
                    // 在開頭插入源語言代碼
                    input_ids.insert(0, src_lang_token_id);
                }
            }
            // opus-mt-en-zh (MarianMT): 不需要語言代碼前綴，tokenizer 已經處理好了
            
            // 確保最後一個 token 是 EOS token
            if input_ids.last() != Some(&eos_token_id) {
                input_ids.push(eos_token_id);
            }
            
            println!("[TranslationModel] 原始輸入文本: {}", text);
            println!("[TranslationModel] 預處理後文本: {}", preprocessed_text);
            println!("[TranslationModel] Tokenization 結果（添加 EOS 前）: {:?}", encoding.get_ids());
            println!("[TranslationModel] Tokenization 結果（添加 EOS 後）: {:?}", input_ids);
            println!("[TranslationModel] Input IDs 長度: {}", input_ids.len());

            // 2. Encoder 推理
            let batch_size = 1;
            let input_seq_len = input_ids.len();
            
            // 創建 input_ids 張量
            let input_ids_tensor = Tensor::<i64>::from_array(([batch_size, input_seq_len], input_ids.clone().into_boxed_slice()))
                .map_err(|e| format!("創建 input_ids 張量失敗: {}", e))?;
            
            // 創建 attention_mask（全為 1，表示所有 token 都有效）
            let attention_mask: Vec<i64> = vec![1; input_seq_len];
            let attention_mask_tensor = Tensor::<i64>::from_array(([batch_size, input_seq_len], attention_mask.into_boxed_slice()))
                .map_err(|e| format!("創建 attention_mask 張量失敗: {}", e))?;
            
            let mut encoder_guard = encoder_clone.lock()
                .map_err(|e| format!("獲取 Encoder 鎖失敗: {}", e))?;
            
            // Encoder 推理：輸入 input_ids 和 attention_mask
            // 使用命名參數確保順序正確
            let mut encoder_outputs = encoder_guard.run(ort::inputs![
                "input_ids" => input_ids_tensor,
                "attention_mask" => attention_mask_tensor
            ])
            .map_err(|e| format!("Encoder 推理失敗: {}", e))?;
            
            // 提取 encoder 輸出：last_hidden_state
            let encoder_output_value = encoder_outputs
                .remove("last_hidden_state")
                .ok_or_else(|| "無法獲取 Encoder 輸出: last_hidden_state".to_string())?;
            
            // 轉換為 Tensor<f32> Value，提取數據以便在 decoder 循環中重用
            let encoder_hidden_states_value = encoder_output_value
                .downcast::<TensorValueType<f32>>()
                .map_err(|e| format!("轉換 encoder 輸出失敗: {}", e))?;
            
            // 提取 encoder_hidden_states 的數據和形狀
            let (encoder_shape, encoder_hidden_states_data) = encoder_hidden_states_value.extract_tensor();
            let encoder_hidden_states_shape: Vec<usize> = encoder_shape.iter().map(|&d| d as usize).collect();
            
            println!("[TranslationModel] Encoder hidden states shape: {:?}", encoder_hidden_states_shape);
            println!("[TranslationModel] Encoder hidden states data length: {}", encoder_hidden_states_data.len());
            
            // 檢查數據是否為空或全為 0
            if encoder_hidden_states_data.is_empty() {
                return Err("Encoder hidden states 數據為空".to_string());
            }
            
            // 檢查前幾個值是否為 0（可能是數據沒有正確提取）
            let sample_size = encoder_hidden_states_data.len().min(10);
            let sample_values: Vec<f32> = encoder_hidden_states_data[..sample_size].to_vec();
            println!("[TranslationModel] Encoder hidden states 前{}個值: {:?}", sample_size, sample_values);
            
            // 將數據轉換為 Vec<f32> 以便重用
            let encoder_hidden_states_vec: Vec<f32> = encoder_hidden_states_data.to_vec();
            
            // 驗證數據長度是否正確
            // hidden_size 從 shape 中獲取（mbart-large-50 是 1024，opus-mt 是 512）
            let hidden_size = encoder_hidden_states_shape[2] as usize;
            let expected_length = batch_size * input_seq_len * hidden_size;
            if encoder_hidden_states_vec.len() != expected_length {
                return Err(format!(
                    "Encoder hidden states 數據長度不匹配: 期望 {} (batch={}, seq_len={}, hidden={}), 實際 {}",
                    expected_length,
                    batch_size,
                    input_seq_len,
                    hidden_size,
                    encoder_hidden_states_vec.len()
                ));
            }
            
            // 3. Decoder 推理（自回歸生成）
            let mut decoder_guard = decoder_clone.lock()
                .map_err(|e| format!("獲取 Decoder 鎖失敗: {}", e))?;
            
            // 根據模型類型確定 decoder 起始 tokens
            let mut generated_ids = if needs_decoder_prefix {
                // MBart/NLLB: [EOS, target_lang, ...]
                vec![eos_token_id, tgt_lang_token_id]
            } else {
                // opus-mt-en-zh (MarianMT): 直接從 decoder_start_token_id 開始
                vec![decoder_start_token_id]
            };
            
            // 準備 encoder_attention_mask（與 encoder 的 attention_mask 相同）
            let encoder_attention_mask_data: Vec<i64> = vec![1; input_seq_len];
            let encoder_attention_mask_tensor = Tensor::<i64>::from_array(([batch_size, input_seq_len], encoder_attention_mask_data.into_boxed_slice()))
                .map_err(|e| format!("創建 encoder_attention_mask 張量失敗: {}", e))?;
            
            // 重複檢測變量
            let mut consecutive_same = 0;
            let mut last_token: Option<i64> = None;
            let config = GenerationConfig::default();
            
            // 自回歸生成循環
            // 注意：mbart-large-50 的 decoder 需要整個序列作為輸入（不支持 past_key_values）
            // 所以每次都需要傳入完整的 generated_ids 序列
            for step in 0..config.max_length {
                // 準備 decoder input_ids（整個生成的序列）
                // decoder_sequence_length 是當前生成的序列長度
                let decoder_seq_len = generated_ids.len();
                let decoder_input_data: Vec<i64> = generated_ids.clone();
                let decoder_input_ids = Tensor::<i64>::from_array(([batch_size, decoder_seq_len], decoder_input_data.into_boxed_slice()))
                    .map_err(|e| format!("創建 decoder input_ids 張量失敗: {}", e))?;
                
                // 重新創建 encoder_hidden_states Tensor（因為需要在每次 decoder 調用時使用）
                // 注意：encoder_hidden_states 在每次 decoder 調用時都應該相同
                // 形狀應該是 [batch_size, input_seq_len, hidden_size]
                // 重要：必須使用正確的形狀數組，不能使用 Vec<usize>
                // 從 encoder_hidden_states_shape 獲取 hidden_size
                let hidden_size = encoder_hidden_states_shape[2] as usize;
                let encoder_hidden_states_array: [usize; 3] = [batch_size, input_seq_len, hidden_size];
                
                // 驗證數據長度
                if encoder_hidden_states_vec.len() != batch_size * input_seq_len * hidden_size {
                    return Err(format!(
                        "步驟 {}: encoder_hidden_states 數據長度不匹配: 期望 {} (batch={}, seq_len={}, hidden={}), 實際 {}",
                        step,
                        batch_size * input_seq_len * hidden_size,
                        batch_size,
                        input_seq_len,
                        hidden_size,
                        encoder_hidden_states_vec.len()
                    ));
                }
                
                let encoder_hidden_states_tensor = Tensor::<f32>::from_array(
                    (encoder_hidden_states_array, encoder_hidden_states_vec.clone().into_boxed_slice())
                )
                .map_err(|e| format!("重新創建 encoder_hidden_states 失敗 (步驟 {}): {}", step, e))?;
                
                // Decoder 推理：輸入 encoder_hidden_states, encoder_attention_mask, decoder input_ids
                // 根據模型定義：encoder_attention_mask, input_ids, encoder_hidden_states
                let mut decoder_outputs = decoder_guard.run(ort::inputs![
                    "encoder_attention_mask" => encoder_attention_mask_tensor.clone(),
                    "input_ids" => decoder_input_ids,
                    "encoder_hidden_states" => encoder_hidden_states_tensor
                ])
                .map_err(|e| format!("Decoder 推理失敗 (步驟 {}): {}", step, e))?;
                
                // 提取 logits 輸出
                let logits_value = decoder_outputs
                    .remove("logits")
                    .ok_or_else(|| "無法獲取 Decoder 輸出: logits".to_string())?;
                
                let logits_value_downcast = logits_value
                    .downcast::<TensorValueType<f32>>()
                    .map_err(|e| format!("轉換 logits 失敗: {}", e))?;
                let (logits_shape, logits_slice) = logits_value_downcast.extract_tensor();
                let logits_shape: Vec<usize> = logits_shape.iter().map(|&d| d as usize).collect();
                
                println!("[TranslationModel] Logits shape: {:?}", logits_shape);
                
                // 確保 shape 正確
                if logits_shape.len() < 3 {
                    // 如果維度不足，嘗試根據數據長度推斷
                    // 預期：[batch_size, decoder_seq_len, vocab_size]
                    // 已知：batch_size=1, vocab_size=vocab_size
                    println!("[TranslationModel] 警告：Logits 維度不足 3，嘗試推斷形狀");
                    
                    let batch_size = 1;
                    // vocab_size 已經在閉包外部定義並捕獲
                    let total_len = logits_slice.len();
                    
                    if total_len % (batch_size * vocab_size) == 0 {
                        let decoder_seq_len = total_len / (batch_size * vocab_size);
                        println!("[TranslationModel] 推斷 shape: [{}, {}, {}]", batch_size, decoder_seq_len, vocab_size);
                        
                        // 使用推斷的長度
                        let last_logits_start = (decoder_seq_len - 1) * vocab_size;
                        let last_logits_end = decoder_seq_len * vocab_size;
                        
                        if last_logits_end > logits_slice.len() {
                            return Err(format!("Logits 數據長度不足: 需要 {}, 實際 {}", last_logits_end, logits_slice.len()));
                        }
                        
                        // 繼續處理...
                        let mut last_logits = logits_slice[last_logits_start..last_logits_end].to_vec();
                        
                        // 1. 應用 Repetition Penalty（增強版）
                        Self::apply_repetition_penalty(
                            &mut last_logits,
                            &generated_ids,
                            config.repetition_penalty
                        );
                        
                        // 2. 計算最大 logit
                        let (max_idx, _max_value) = last_logits
                            .iter()
                            .enumerate()
                            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                            .ok_or_else(|| "無法找到下一個 token ID".to_string())?;
                            
                        // ... 接下來的邏輯提取到一個閉包或函數中以避免重複代碼？
                        // 為簡單起見，這裡直接繼續使用下面的代碼块，但需要調整變量作用域
                        // 由於這是修復 panic，我們先用簡單的方式：
                        // 如果維度不對，手動構造 last_logits，然後跳過下面的 shape 提取邏輯
                    } else {
                        return Err(format!("Logits shape 異常: {:?}, 數據長度: {}", logits_shape, logits_slice.len()));
                    }
                }
                
                // 從 logits 中提取下一個 token ID（argmax）
                // logits shape: [batch_size, decoder_sequence_length, vocab_size]
                // 例如：[1, 8, 250054] 表示 batch_size=1, decoder_seq_len=8, vocab_size=250054
                // 我們需要最後一個位置的 logits（即 decoder_seq_len-1 位置的 logits）
                
                // 提取最後一個位置的 logits
                // logits_slice 是 flatten 後的數組：[batch_0_seq_0_vocab_0, batch_0_seq_0_vocab_1, ..., batch_0_seq_0_vocab_V, batch_0_seq_1_vocab_0, ...]
                // 對於 shape [batch_size, decoder_seq_len, vocab_size]，最後一個位置的 logits 是：
                // logits_slice[(decoder_seq_len - 1) * vocab_size .. decoder_seq_len * vocab_size]
                
                let decoder_seq_len = if logits_shape.len() >= 2 {
                    logits_shape[1]
                } else {
                    // 如果上面已經推斷了，這裡應該不會執行，或者需要重構邏輯
                    // 為了避免重複代碼，我們在這裡統一處理 shape
                    logits_slice.len() / (1 * vocab_size)
                };
                
                let last_logits_start = (decoder_seq_len - 1) * vocab_size;
                let last_logits_end = decoder_seq_len * vocab_size;
                
                if last_logits_end > logits_slice.len() {
                    return Err(format!(
                        "步驟 {}: logits_slice 長度 ({}) 不足以提取最後一個位置的 logits (需要至少 {})",
                        step,
                        logits_slice.len(),
                        last_logits_end
                    ));
                }
                
                let mut last_logits = logits_slice[last_logits_start..last_logits_end].to_vec();
                
                // 1. 應用 Repetition Penalty（增強版）
                Self::apply_repetition_penalty(
                    &mut last_logits,
                    &generated_ids,
                    config.repetition_penalty
                );
                
                // 2. 計算最大 logit 值用於調試和 Token 8 檢測
                let (max_idx, max_value) = last_logits
                    .iter()
                    .enumerate()
                    .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .ok_or_else(|| "無法找到下一個 token ID".to_string())?;
                
                // 3. Token 8 特殊處理（防止空輸出）
                let mut next_token_id = if max_idx == 8 {
                    // 檢查 Token 8 的 logit 是否異常高
                    let token_8_logit = last_logits[8];
                    // 找到次優 token
                    let mut logit_values: Vec<(usize, f32)> = last_logits.iter().enumerate()
                        .map(|(idx, &val)| (idx, val))
                        .collect();
                    logit_values.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                    
                    if logit_values.len() > 1 {
                        let (second_idx, second_logit) = logit_values[1];
                        // 如果 Token 8 的優勢太大（> 2.0），選擇次優 token
                        if (token_8_logit - second_logit) > 2.0 {
                            second_idx as i64
                        } else {
                            max_idx as i64
                        }
                    } else {
                        max_idx as i64
                    }
                } else if text.len() < config.short_sentence_threshold {
                    // 短句：使用 Top-p (nucleus) 採樣
                    Self::sample_top_p(&last_logits, config.temperature, config.top_p)?
                } else {
                    // 中等和長句：使用 Greedy decoding (argmax)
                    max_idx as i64
                };
                
                // 4. 檢測 N-gram 重複（新增）
                if Self::has_repeated_ngram(&generated_ids, config.no_repeat_ngram_size, next_token_id) {
                    // 如果檢測到 N-gram 重複，選擇次優 token
                    let mut logit_values: Vec<(usize, f32)> = last_logits.iter().enumerate()
                        .map(|(idx, &val)| (idx, val))
                        .collect();
                    logit_values.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                    
                    // 找到第一個不重複的 token
                    let mut found = false;
                    for (idx, _) in logit_values.iter().skip(1) {
                        let candidate_token = *idx as i64;
                        if !Self::has_repeated_ngram(&generated_ids, config.no_repeat_ngram_size, candidate_token) {
                            next_token_id = candidate_token;
                            found = true;
                            break;
                        }
                    }
                    
                    // 如果所有候選都重複，強制終止
                    if !found {
                        println!("[TranslationModel] 警告：所有候選 token 都重複，終止生成");
                        break;
                    }
                }
                
                // 5. 檢測單個 token 重複循環
                if Some(next_token_id) == last_token {
                    consecutive_same += 1;
                    if consecutive_same >= config.repetition_threshold {
                        println!("[TranslationModel] 警告：檢測到連續 {} 次相同 token，終止生成", consecutive_same);
                        break;
                    }
                } else {
                    consecutive_same = 0;
                }
                
                // 6. 檢查是否結束
                if next_token_id == eos_token_id {
                    break;
                }
                
                // 7. 檢查是否生成了 pad_token_id（對於 opus-mt-en-zh 是 65000）
                // 注意：pad_token_id 和 decoder_start_token_id 可能相同
                if next_token_id == decoder_start_token_id {
                    // 對於 opus-mt-en-zh，decoder_start_token_id = 65000 = pad_token_id
                    // 如果生成了這個 token，應該跳過（不添加到輸出）
                    // 如果連續生成多個 pad_token，應該停止
                    if last_token == Some(next_token_id) {
                        break;
                    }
                    last_token = Some(next_token_id);
                    continue;
                }
                
                // 8. 檢查 token ID 是否在有效範圍內
                if next_token_id < 0 || next_token_id >= vocab_size as i64 {
                    continue;
                }
                
                last_token = Some(next_token_id);
                generated_ids.push(next_token_id);
                
                // 調試：打印生成的 token
                // println!("[Debug] Step {}: Generated ID {}", generated_ids.len(), next_token_id);
                
                // 9. 安全檢查：如果生成的 token 數量過多，強制停止
                if generated_ids.len() > 100 {
                    break;
                }
            }
            
            // 4. Detokenize 輸出文本
            // 根據模型類型處理輸出
            let output_ids: Vec<u32> = if needs_decoder_prefix {
                // MBart/NLLB: 移除 decoder 的開始 tokens（EOS token 和目標語言代碼）
                // 輸出序列是：[EOS, target_lang, ...generated_tokens..., EOS]
                generated_ids.iter()
                    .skip(2)  // 跳過 EOS token 和目標語言代碼
                    .take_while(|&&id| id != eos_token_id)  // 在遇到 EOS token 時停止
                    .filter(|&&id| id != 0 && id != 1)  // 過濾掉 BOS token (0) 和 PAD token (1)
                    .map(|&id| id as u32)
                    .collect()
            } else {
                // opus-mt-en-zh (MarianMT): 移除 decoder_start_token_id，保留生成的 tokens
                // 輸出序列是：[decoder_start_token_id, ...generated_tokens..., EOS]
                // 注意：對於 opus-mt-en-zh，eos_token_id = 0，decoder_start_token_id = pad_token_id = 65000
                // opus-mt-en-zh (MarianMT): 移除 decoder_start_token_id，保留生成的 tokens
                // 輸出序列是：[decoder_start_token_id (65000), ...generated_tokens..., EOS (0)]
                let mut output_ids: Vec<u32> = Vec::new();
                
                // 從第二個 token 開始（跳過 decoder_start_token_id = 65000）
                for &id in generated_ids.iter().skip(1) {
                    // 如果遇到 EOS token (0)，停止
                    if id == eos_token_id || id == 0 {
                        break;
                    }
                    // 過濾掉特殊 tokens
                    if id != decoder_start_token_id &&  // 過濾掉 pad_token_id (65000)
                       id != eos_token_id &&            // 過濾掉 EOS token (0)
                       id >= 0 && id < vocab_size as i64 {  // 確保 token ID 在有效範圍內
                        output_ids.push(id as u32);
                    }
                }
                
                // 如果輸出為空，嘗試更寬鬆的過濾（只過濾明顯的無效 token）
                if output_ids.is_empty() && generated_ids.len() > 1 {
                    for &id in generated_ids.iter().skip(1) {
                        if id == eos_token_id || id == 0 {
                            break;
                        }
                        // 只過濾掉 decoder_start_token_id，保留其他所有 token
                        if id != decoder_start_token_id && id >= 0 && id < vocab_size as i64 {
                            output_ids.push(id as u32);
                        }
                    }
                }
                
                output_ids
            };
            
            if output_ids.is_empty() {
                return Err(format!(
                    "解碼前的 token IDs 為空。生成的 token IDs: {:?}, decoder_start_token_id: {}, eos_token_id: {}",
                    generated_ids, decoder_start_token_id, eos_token_id
                ));
            }
            
            let decoded = tokenizer_clone.decode(&output_ids, true)
                .map_err(|e| format!("解碼失敗: {}。Token IDs: {:?}", e, &output_ids[..output_ids.len().min(10)]))?;
            
            // 後處理：清理 SentencePiece 的空格標記（▁）
            // SentencePiece 使用 ▁ 表示空格，需要替換為實際空格
            let cleaned = if decoded.contains('▁') {
                // 如果包含 SentencePiece 標記，進行清理
                let replaced = decoded.replace('▁', " ");
                replaced.trim().to_string()
            } else {
                // 如果沒有 SentencePiece 標記，只進行 trim
                decoded.trim().to_string()
            };
            
            // 8. 檢查空輸出並嘗試降級策略
            if cleaned.is_empty() {
                
                // 嘗試使用 Temperature 採樣重新生成
                // 這裡簡化處理，直接返回錯誤
                // 實際可以實現完整的降級邏輯
                return Err(format!(
                    "翻譯結果為空。原始解碼: {}, 生成的 token IDs 數量: {}。建議：嘗試使用 Temperature 採樣或檢查輸入文本。",
                    decoded,
                    output_ids.len()
                ));
            }
            
            Ok(cleaned)
        })
        .await
        .map_err(|e| format!("異步推理任務失敗: {}", e))??;

        Ok(result)
    }

    /// 檢查模型是否已加載
    pub fn is_loaded(&self) -> bool {
        self.is_loaded 
            && self.encoder_session.is_some() 
            && self.decoder_session.is_some()
    }

    /// 檢查 tokenizer 是否已加載
    pub fn is_tokenizer_loaded(&self) -> bool {
        self.tokenizer.is_some()
    }

    /// 應用 Repetition Penalty（重複懲罰）
    /// 
    /// 對已生成的 token 應用懲罰，降低其再次被選擇的概率
    fn apply_repetition_penalty(
        logits: &mut [f32],
        generated_tokens: &[i64],
        repetition_penalty: f32,
    ) {
        for &token_id in generated_tokens {
            let idx = token_id as usize;
            if idx < logits.len() {
                // 降低重複 token 的 logit
                logits[idx] /= repetition_penalty;
            }
        }
    }

    /// 檢測 N-gram 重複
    /// 
    /// 檢查新 token 是否會與已生成的序列形成重複的 N-gram
    fn has_repeated_ngram(generated_ids: &[i64], ngram_size: usize, new_token: i64) -> bool {
        // 如果已生成的長度小於 N-gram 大小，不可能存在重複的 N-gram
        // 例如：已生成 [A]，找 [A, B] (size 2)，無法在 [A] 中找到
        if generated_ids.len() < ngram_size {
            return false;
        }
        
        // 構建要檢查的 N-gram：[...generated_ids[last n-1], new_token]
        let mut check_ngram = Vec::with_capacity(ngram_size);
        let start_idx = generated_ids.len() + 1 - ngram_size;
        for i in start_idx..generated_ids.len() {
            check_ngram.push(generated_ids[i]);
        }
        check_ngram.push(new_token);
        
        // 檢查是否在之前的序列中出現過
        // 我們只需要檢查到 generated_ids.len() - ngram_size
        // 例如 generated_ids = [A, B, C], ngram_size = 2
        // check_ngram = [C, D]
        // 我們檢查 [A, B] (i=0), [B, C] (i=1)
        // generated_ids.len() - ngram_size = 3 - 2 = 1
        // 範圍 0..=1 即 0, 1
        for i in 0..=generated_ids.len() - ngram_size {
            let mut matches = true;
            for j in 0..ngram_size {
                if generated_ids[i + j] != check_ngram[j] {
                    matches = false;
                    break;
                }
            }
            if matches {
                return true;
            }
        }
        
        false
    }

    /// Top-p (nucleus) 採樣
    /// 
    /// 參數：
    /// - logits: 最後一個位置的 logits
    /// - temperature: 溫度參數（用於調整分佈的平滑度）
    /// - top_p: nucleus 採樣參數（累積概率閾值）
    fn sample_top_p(logits: &[f32], temperature: f32, top_p: f32) -> Result<i64, String> {
        use rand::Rng;
        
        // 應用 temperature
        let scaled_logits: Vec<f32> = logits.iter()
            .map(|&logit| logit / temperature)
            .collect();
        
        // 找到最大值（用於數值穩定性）
        let max_logit = scaled_logits.iter()
            .fold(f32::NEG_INFINITY, |a, &b| a.max(b));
        
        // 計算 softmax 概率
        let mut probs: Vec<f32> = scaled_logits.iter()
            .map(|&logit| (logit - max_logit).exp())
            .collect();
        
        let sum_probs: f32 = probs.iter().sum();
        if sum_probs == 0.0 {
            return Err("概率總和為 0".to_string());
        }
        
        // 歸一化
        for prob in probs.iter_mut() {
            *prob /= sum_probs;
        }
        
        // 創建索引和概率的配對，並按概率降序排序
        let mut indexed_probs: Vec<(usize, f32)> = probs.iter()
            .enumerate()
            .map(|(idx, &prob)| (idx, prob))
            .collect();
        
        indexed_probs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        
        // 計算累積概率並選擇 top_p 範圍內的 tokens
        let mut cumsum: f32 = 0.0;
        let mut top_p_indices = Vec::new();
        let mut top_p_probs = Vec::new();
        
        for (idx, prob) in indexed_probs.iter() {
            cumsum += prob;
            top_p_indices.push(*idx);
            top_p_probs.push(*prob);
            
            if cumsum >= top_p {
                break;
            }
        }
        
        if top_p_indices.is_empty() {
            // 如果沒有找到任何 token，選擇概率最高的
            top_p_indices.push(indexed_probs[0].0);
            top_p_probs.push(indexed_probs[0].1);
        }
        
        // 重新歸一化 top_p 範圍內的概率
        let sum_top_p: f32 = top_p_probs.iter().sum();
        if sum_top_p == 0.0 {
            return Err("Top-p 概率總和為 0".to_string());
        }
        
        for prob in top_p_probs.iter_mut() {
            *prob /= sum_top_p;
        }
        
        // 根據概率分佈採樣
        let mut rng = rand::thread_rng();
        let random_value: f32 = rng.gen();
        
        let mut cumsum: f32 = 0.0;
        for (i, &prob) in top_p_probs.iter().enumerate() {
            cumsum += prob;
            if random_value <= cumsum {
                return Ok(top_p_indices[i] as i64);
            }
        }
        
        // 如果沒有匹配（由於浮點誤差），返回最後一個
        Ok(top_p_indices[top_p_indices.len() - 1] as i64)
    }

    /// 獲取模型目錄路徑
    pub fn get_model_dir(&self) -> &str {
        &self.model_dir
    }
}

impl Default for TranslationModel {
    fn default() -> Self {
        Self::new()
    }
}

/// 全局翻譯模型實例
static TRANSLATION_MODEL: Mutex<Option<Arc<Mutex<TranslationModel>>>> = Mutex::const_new(None);

/// 獲取全局翻譯模型實例
pub async fn get_model() -> Arc<Mutex<TranslationModel>> {
    let mut guard = TRANSLATION_MODEL.lock().await;
    if guard.is_none() {
        *guard = Some(Arc::new(Mutex::new(TranslationModel::new())));
    }
    guard.as_ref().unwrap().clone()
}
