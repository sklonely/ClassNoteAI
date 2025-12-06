# 翻譯功能整體架構詳解

**更新日期**: 2024年12月

---

## 📐 整體架構圖

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端層 (TypeScript/React)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐      ┌──────────────────┐             │
│  │ TranscriptionService │ ──→ │ TranslationService │             │
│  │                  │      │                  │             │
│  │ • 音頻切片        │      │ • 翻譯調用        │             │
│  │ • 轉錄結果處理    │      │ • 緩存管理        │             │
│  │ • 翻譯觸發       │      │ • 錯誤處理        │             │
│  └──────────────────┘      └──────────────────┘             │
│         │                            │                         │
│         │                            │                         │
│         └────────────┬───────────────┘                         │
│                      │                                         │
│         ┌────────────▼───────────────┐                         │
│         │   Tauri IPC (invoke)       │                         │
│         │                            │                         │
│         │  translate_rough()         │                         │
│         │  translate_fine()           │                         │
│         │  load_translation_model()  │                         │
│         └────────────┬───────────────┘                         │
└──────────────────────┼─────────────────────────────────────────┘
                       │
                       │ IPC 通信
                       │
┌──────────────────────▼─────────────────────────────────────────┐
│                   後端層 (Rust/Tauri)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              lib.rs (Tauri Commands)                      │ │
│  │                                                            │ │
│  │  • translate_rough()  ──→ 路由到本地/Google               │ │
│  │  • translate_fine()   ──→ 路由到遠程 API                  │ │
│  │  • load_translation_model_by_name()                       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                            │                                   │
│         ┌──────────────────┼──────────────────┐              │
│         │                  │                  │              │
│    ┌────▼────┐      ┌─────▼─────┐      ┌─────▼─────┐        │
│    │ rough.rs │      │ google.rs │      │  fine.rs  │        │
│    │          │      │           │      │           │        │
│    │ 本地翻譯  │      │ Google API│      │ 遠程 API  │        │
│    └────┬────┘      └───────────┘      └───────────┘        │
│         │                                                   │
│         │ 使用                                              │
│    ┌────▼────────────────────────────────────────────┐     │
│    │          model.rs (TranslationModel)            │     │
│    │                                                   │     │
│    │  ┌──────────────────────────────────────────┐   │     │
│    │  │  TranslationModel 結構體                  │   │     │
│    │  │  • encoder_session: Arc<Mutex<Session>>  │   │     │
│    │  │  • decoder_session: Arc<Mutex<Session>>  │   │     │
│    │  │  • tokenizer: Arc<Tokenizer>             │   │     │
│    │  │  • vocab_map: HashMap<String, i64>       │   │     │
│    │  │  • generation_config: GenerationConfig    │   │     │
│    │  └──────────────────────────────────────────┘   │     │
│    │                                                   │     │
│    │  核心方法：                                        │     │
│    │  • load_model()      - 加載 ONNX 模型            │     │
│    │  • translate()        - 執行翻譯                  │     │
│    │  • preprocess_text() - 文本預處理                │     │
│    └───────────────────────────────────────────────────┘     │
│                            │                                   │
│                            │ 使用                              │
│    ┌───────────────────────▼───────────────────────────────┐ │
│    │            ONNX Runtime (ort crate)                    │ │
│    │                                                         │ │
│    │  • encoder_model.onnx  - 編碼器模型                   │ │
│    │  • decoder_model.onnx  - 解碼器模型                   │ │
│    │  • tokenizer.json      - Tokenizer                    │ │
│    │  • config.json         - 模型配置                     │ │
│    └───────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ 架構層次說明

### 1. 前端層（TypeScript/React）

#### 1.1 TranscriptionService（轉錄服務）

**位置**: `src/services/transcriptionService.ts`

**職責**:
- 管理音頻切片和轉錄流程
- 觸發翻譯請求
- 處理轉錄結果

**關鍵方法**:
```typescript
class TranscriptionService {
  // 處理粗轉錄結果（包含翻譯觸發）
  private async handleRoughTranscription(
    result: TranscriptionResult,
    startTime: number,
    duration: number,
    audioData: Int16Array
  ): Promise<void> {
    // 1. 預處理文本
    const cleanedText = this.preprocessText(result.text);
    
    // 2. 觸發翻譯（當前被註釋）
    // const roughTranslation = await translateRough(cleanedText, 'en', 'zh');
    
    // 3. 添加字幕片段
    subtitleService.addSegment({
      roughText: cleanedText,
      roughTranslation: roughTranslation,
      // ...
    });
  }
}
```

**數據流**:
```
轉錄結果 → 文本預處理 → 翻譯調用 → 字幕顯示
```

---

#### 1.2 TranslationService（翻譯服務）

**位置**: `src/services/translationService.ts`

**職責**:
- 封裝翻譯 API 調用
- 管理翻譯緩存（LRU，1000條，24小時TTL）
- 處理翻譯錯誤

**關鍵方法**:
```typescript
export async function translateRough(
  text: string,
  sourceLang: string = 'en',
  targetLang: string = 'zh',
  useCache: boolean = true,
  provider?: 'local' | 'google',
  googleApiKey?: string
): Promise<TranslationResult> {
  // 1. 檢查緩存
  if (useCache) {
    const cached = translationCache.get(text, sourceLang, targetLang, 'rough');
    if (cached) return cached;
  }
  
  // 2. 讀取設置（如果未指定 provider）
  const settings = await storageService.getAppSettings();
  const actualProvider = provider || settings?.translation?.provider || 'local';
  
  // 3. 調用 Tauri Command
  const result = await invoke<TranslationResult>('translate_rough', {
    text,
    sourceLang,
    targetLang,
    provider: actualProvider,
    googleApiKey: actualApiKey,
  });
  
  // 4. 保存到緩存
  if (useCache) {
    translationCache.set(text, sourceLang, targetLang, 'rough', result);
  }
  
  return result;
}
```

**緩存機制**:
- **策略**: LRU (Least Recently Used)
- **容量**: 1000 條翻譯結果
- **TTL**: 24 小時
- **鍵格式**: `rough:en:zh:${text}`

---

### 2. IPC 層（Tauri Commands）

**位置**: `src-tauri/src/lib.rs`

**職責**:
- 提供前端到後端的橋接
- 路由翻譯請求到正確的處理器

**關鍵 Commands**:

```rust
/// 粗翻譯（本地或 Google API）
#[tauri::command]
async fn translate_rough(
    text: String,
    source_lang: String,
    target_lang: String,
    provider: Option<String>, // "local" 或 "google"
    google_api_key: Option<String>,
) -> Result<translation::TranslationResult, String> {
    let provider = provider.as_deref().unwrap_or("local");
    
    match provider {
        "google" => {
            // 路由到 Google API
            translation::google::translate_with_google(
                &text, &source_lang, &target_lang, google_api_key.as_deref()
            ).await.map_err(|e| e.to_string())
        }
        "local" | _ => {
            // 路由到本地 ONNX 模型
            translation::rough::translate_rough(&text, &source_lang, &target_lang)
                .await.map_err(|e| e.to_string())
        }
    }
}
```

**路由邏輯**:
```
translate_rough()
    ├─ provider == "google" → google.rs
    └─ provider == "local"  → rough.rs → model.rs
```

---

### 3. 後端層（Rust）

#### 3.1 rough.rs（本地翻譯入口）

**位置**: `src-tauri/src/translation/rough.rs`

**職責**:
- 本地翻譯的入口點
- 調用 TranslationModel 進行翻譯

**關鍵代碼**:
```rust
pub async fn translate_rough(
    text: &str,
    _source_lang: &str,
    _target_lang: &str,
) -> Result<TranslationResult, TranslationError> {
    // 獲取全局模型實例
    let model = model::get_model().await;
    
    // 檢查模型是否已加載
    let is_loaded = {
        let model_guard = model.lock().await;
        model_guard.is_loaded
    };
    
    if !is_loaded {
        return Err(TranslationError::LocalError(
            "ONNX 翻譯模型未加載，請先在設置頁面加載模型".to_string()
        ));
    }
    
    // 執行翻譯
    let model_guard = model.lock().await;
    let translated_text = model_guard.translate(text, _source_lang, _target_lang)
        .await
        .map_err(|e| TranslationError::LocalError(e))?;
    
    Ok(TranslationResult {
        translated_text,
        source: TranslationSource::Rough,
        confidence: None,
    })
}
```

---

#### 3.2 model.rs（核心翻譯引擎）

**位置**: `src-tauri/src/translation/model.rs`

**職責**:
- 管理 ONNX 模型的生命週期
- 執行 Encoder-Decoder 推理
- 處理 Tokenizer 編碼/解碼

**核心結構**:
```rust
pub struct TranslationModel {
    // ONNX Runtime Sessions（線程安全）
    encoder_session: Option<Arc<std::sync::Mutex<Session>>>,
    decoder_session: Option<Arc<std::sync::Mutex<Session>>>,
    
    // Tokenizer（線程安全）
    tokenizer: Option<Arc<Tokenizer>>,
    
    // 詞彙表映射
    vocab_map: Option<HashMap<String, i64>>,
    
    // 模型配置
    decoder_start_token_id: i64,
    eos_token_id: i64,
    max_length: usize,
    vocab_size: usize,
    hidden_size: usize,
    model_type: String, // "marian" (opus-mt), "mbart", "nllb"
    
    // 生成配置
    generation_config: GenerationConfig,
}
```

**翻譯流程**（`translate()` 方法）:

```
1. 文本預處理
   ↓
2. Tokenization（文本 → Token IDs）
   ↓
3. Encoder 推理（Token IDs → Hidden States）
   ↓
4. Decoder 自回歸生成（Hidden States → Token IDs）
   ├─ 策略選擇（短句：Top-p，長句：Greedy）
   ├─ Repetition Penalty
   ├─ 重複循環檢測
   └─ EOS Token 檢測
   ↓
5. Detokenization（Token IDs → 文本）
   ↓
6. 後處理和驗證
   ↓
7. 返回翻譯結果
```

**詳細實現**:

```rust
pub async fn translate(
    &self,
    text: &str,
    _source_lang: &str,
    _target_lang: &str,
) -> Result<String, String> {
    // 在 spawn_blocking 中執行同步操作
    tokio::task::spawn_blocking(move || {
        // 1. 文本預處理
        let preprocessed_text = preprocess_text_for_translation(text);
        
        // 2. Tokenization
        let encoding = tokenizer.encode(&preprocessed_text, true)?;
        let mut input_ids: Vec<i64> = encoding.get_ids()
            .iter().map(|&id| id as i64).collect();
        
        // 添加 EOS token
        if input_ids.last() != Some(&eos_token_id) {
            input_ids.push(eos_token_id);
        }
        
        // 3. Encoder 推理
        let encoder_session_guard = encoder_session.lock().unwrap();
        let encoder_inputs = vec![
            Tensor::from_array(
                (vec![batch_size, input_seq_len], input_ids.clone())
            )?
        ];
        let encoder_outputs = encoder_session_guard.run(encoder_inputs)?;
        let encoder_hidden_states = encoder_outputs[0].try_extract::<f32>()?;
        
        // 4. Decoder 自回歸生成
        let mut decoder_input_ids = vec![decoder_start_token_id];
        let mut generated_ids = Vec::new();
        
        for step in 0..max_length {
            // Decoder 推理
            let decoder_outputs = decoder_session.run(decoder_inputs)?;
            let logits = decoder_outputs[0].try_extract::<f32>()?;
            
            // 採樣策略（Top-p 或 Greedy）
            let next_token_id = if input_ids.len() < short_sentence_threshold {
                sample_top_p(&logits, temperature, top_p)? // Top-p
            } else {
                sample_greedy(&logits)? // Greedy
            };
            
            // 重複檢測和 Repetition Penalty
            if generated_ids.len() >= repetition_threshold {
                // 檢查重複
                // 應用 Repetition Penalty
            }
            
            // EOS 檢測
            if next_token_id == eos_token_id {
                break;
            }
            
            generated_ids.push(next_token_id);
            decoder_input_ids = vec![next_token_id];
        }
        
        // 5. Detokenization
        let translated_text = tokenizer.decode(&generated_ids, true)?;
        
        Ok(translated_text)
    }).await?
}
```

**關鍵技術點**:

1. **線程安全**:
   - 使用 `Arc<Mutex<Session>>` 包裝 ONNX Session
   - 使用 `tokio::task::spawn_blocking` 執行同步操作

2. **自回歸生成**:
   - Decoder 逐步生成 token
   - 每次使用上一步的輸出作為下一步的輸入

3. **採樣策略**:
   - 短句（< 20 tokens）: Top-p (nucleus) 採樣
   - 長句（≥ 20 tokens）: Greedy 解碼

4. **問題修復**:
   - Repetition Penalty（1.2倍懲罰）
   - 重複循環檢測（連續3次相同token終止）
   - Token 8 特殊處理（防止空輸出）

---

#### 3.3 google.rs（Google API 集成）

**位置**: `src-tauri/src/translation/google.rs`

**職責**:
- 集成 Google Cloud Translation API（官方）
- 集成非官方 Google Translate（無需 API key）

**實現方式**:
```rust
pub async fn translate_with_google(
    text: &str,
    source_lang: &str,
    target_lang: &str,
    api_key: Option<&str>,
) -> Result<TranslationResult, TranslationError> {
    if let Some(key) = api_key {
        // 使用官方 API
        translate_with_official_api(text, source_lang, target_lang, key).await
    } else {
        // 使用非官方接口（網頁爬取）
        translate_with_unofficial_api(text, source_lang, target_lang).await
    }
}
```

---

#### 3.4 fine.rs（遠程 API）

**位置**: `src-tauri/src/translation/fine.rs`

**職責**:
- 提供遠程翻譯 API 接口
- 檢查遠程服務可用性

**設計**（待實現）:
```rust
pub async fn translate_fine(
    text: &str,
    source_lang: &str,
    target_lang: &str,
    service_url: &str,
) -> Result<TranslationResult, TranslationError> {
    // HTTP POST 請求到遠程服務
    // 返回高質量翻譯結果
}
```

---

#### 3.5 download.rs（模型下載）

**位置**: `src-tauri/src/translation/download.rs`

**職責**:
- 下載翻譯模型（ZIP 格式）
- 解壓模型文件
- 驗證文件完整性

**支持的模型**:
- `opus-mt-en-zh-onnx` (~512MB) - 推薦

---

## 🔄 完整數據流

### 場景 1: 本地翻譯（ONNX 模型）

```
1. 用戶說話
   ↓
2. TranscriptionService 轉錄音頻
   ↓
3. 獲得英文文本: "Hello world"
   ↓
4. TranscriptionService.handleRoughTranscription()
   ├─ 預處理文本
   └─ 調用 translateRough()
       ↓
5. TranslationService.translateRough()
   ├─ 檢查緩存（未命中）
   └─ invoke('translate_rough', { provider: 'local' })
       ↓
6. lib.rs::translate_rough()
   └─ 路由到 rough.rs
       ↓
7. rough.rs::translate_rough()
   └─ 調用 model.rs::translate()
       ↓
8. TranslationModel.translate()
   ├─ 文本預處理: "Hello world" → "Hello world"
   ├─ Tokenization: "Hello world" → [1234, 5678]
   ├─ Encoder 推理: [1234, 5678] → Hidden States
   ├─ Decoder 生成: Hidden States → [9876, 5432]
   ├─ Detokenization: [9876, 5432] → "你好世界"
   └─ 返回: "你好世界"
       ↓
9. TranslationService
   ├─ 保存到緩存
   └─ 返回結果
       ↓
10. TranscriptionService
    └─ 更新字幕: { roughText: "Hello world", roughTranslation: "你好世界" }
```

### 場景 2: Google API 翻譯

```
1-4. 同上
   ↓
5. TranslationService.translateRough()
   └─ invoke('translate_rough', { provider: 'google', googleApiKey: 'xxx' })
       ↓
6. lib.rs::translate_rough()
   └─ 路由到 google.rs
       ↓
7. google.rs::translate_with_google()
   ├─ 使用官方 API（如果有 key）
   └─ 或使用非官方接口（如果無 key）
       ↓
8. 返回翻譯結果
   ↓
9-10. 同上
```

---

## 🗂️ 文件結構

```
ClassNoteAI/
├── src/
│   ├── services/
│   │   ├── translationService.ts      # 前端翻譯服務（緩存、調用封裝）
│   │   └── transcriptionService.ts    # 轉錄服務（觸發翻譯）
│   │
│   └── components/
│       ├── TranslationModelManager.tsx  # 模型管理 UI
│       └── SettingsView.tsx             # 設置頁面（翻譯配置）
│
└── src-tauri/src/
    ├── lib.rs                           # Tauri Commands（路由）
    │
    └── translation/
        ├── mod.rs                       # 模塊入口（類型定義）
        ├── rough.rs                     # 本地翻譯入口
        ├── fine.rs                      # 遠程翻譯入口
        ├── google.rs                    # Google API 集成
        ├── model.rs                     # 核心翻譯引擎（ONNX）
        └── download.rs                  # 模型下載
```

---

## 🔧 技術棧

### 前端
- **TypeScript/React**: UI 和服務層
- **Tauri IPC**: 前端到後端通信
- **LRU Cache**: 翻譯結果緩存

### 後端
- **Rust**: 核心實現語言
- **ONNX Runtime (`ort` crate)**: 模型推理引擎
- **Tokenizer (`tokenizers` crate)**: 文本編碼/解碼
- **Tokio**: 異步運行時
- **reqwest**: HTTP 客戶端（Google API）

### 模型
- **opus-mt-en-zh**: Encoder-Decoder 架構
- **格式**: ONNX（`encoder_model.onnx` + `decoder_model.onnx`）
- **大小**: ~512MB

---

## 🎯 設計特點

### 1. 雙層架構
- **粗層（本地）**: 必須，實時翻譯
- **精層（遠程）**: 可選，高質量翻譯

### 2. 多提供商支持
- **本地 ONNX**: 完全離線，快速
- **Google API**: 高質量，需要網絡

### 3. 線程安全
- 使用 `Arc<Mutex<>>` 包裝共享資源
- 使用 `spawn_blocking` 執行同步操作

### 4. 緩存機制
- LRU 策略
- 減少重複翻譯
- 提升響應速度

### 5. 錯誤處理
- 分層錯誤處理
- 友好的錯誤提示
- 不影響轉錄功能

---

## 📊 性能指標

| 指標 | 本地 ONNX | Google API |
|------|-----------|------------|
| **延遲** | ~50-200ms | ~100-500ms |
| **成功率** | ~75% | ~95% |
| **網絡需求** | 無 | 需要 |
| **成本** | 免費 | 付費（官方） |
| **離線** | ✅ | ❌ |

---

## 🔗 相關文檔

- `TRANSLATION.md` - 翻譯功能總覽
- `TRANSLATION_STATUS.md` - 翻譯功能狀態
- `ONNX_TRANSLATION_INTEGRATION.md` - ONNX 集成指南
- `OPUS_MT_BEST_PRACTICES.md` - 最佳實踐
- `TRANSLATION_STATUS_ASSESSMENT.md` - 狀態評估


