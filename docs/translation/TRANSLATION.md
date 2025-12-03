# 翻譯功能文檔

**更新日期**: 2024年12月  
**狀態**: ✅ 已完成並測試通過

---

## 📋 概述

實現雙層翻譯架構：粗層（本地 ONNX 模型）→ 精層（遠程 API，可選）

---

## 🏗️ 架構流程

```
音頻輸入
    ↓
┌─────────────────────────────────────────┐
│  粗層（本地，必須）                       │
│  1. 粗轉錄（Whisper Base/Small）         │
│  2. 粗翻譯（本地 ONNX 模型）             │
│  3. 立即顯示粗字幕                        │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  精層（遠程，可選）                       │
│  4. 精轉錄（遠程 Whisper Large）         │
│  5. 精翻譯（遠程翻譯服務）                │
│  6. 自動覆蓋粗字幕                        │
└─────────────────────────────────────────┘
```

---

## 🎯 粗翻譯（本地 ONNX 模型）

### 實現狀態

**位置**: `src-tauri/src/translation/rough.rs`

**技術棧**:
- ✅ ONNX Runtime (`ort` crate)
- ✅ Tokenizer (`tokenizers` crate)
- ✅ 模型: `Helsinki-NLP/opus-mt-en-zh`

**特點**:
- ✅ 完全本地，無需網絡
- ✅ 實時翻譯，延遲 ~50-200ms
- ✅ 翻譯成功率 75%
- ✅ 空輸出問題已解決（0%）
- ✅ 重複問題已解決（0%）

**修復狀態** (2024年12月):
- ✅ 重複循環檢測
- ✅ Repetition Penalty
- ✅ Token 8 特殊處理
- ✅ 空輸出檢測

**詳細文檔**: 見 `OPUS_MT_BEST_PRACTICES.md`

---

## 🎯 精翻譯（遠程 API）

### 實現狀態

**位置**: `src-tauri/src/translation/fine.rs`

**特點**:
- ✅ HTTP API 接口
- ✅ 遠程服務檢查
- ⏳ 實際服務端待實現（可選）

---

## 📊 數據結構

```typescript
export interface SubtitleSegment {
  id: string;
  
  // 粗層（本地）
  roughText: string;           // 粗轉錄文本（英文）
  roughTranslation?: string;   // 粗翻譯文本（中文，ONNX 模型）
  
  // 精層（遠程，可選）
  fineText?: string;            // 精轉錄文本（英文）
  fineTranslation?: string;     // 精翻譯文本（中文）
  
  // 顯示邏輯
  displayText: string;          // 當前顯示的英文
  displayTranslation?: string;  // 當前顯示的中文
  source: 'rough' | 'fine';     // 當前來源
  translationSource?: 'rough' | 'fine';
  
  // 元數據
  startTime: number;
  endTime: number;
  fineStatus?: 'pending' | 'transcribing' | 'translating' | 'completed' | 'failed';
}
```

---

## 🔧 實現模塊

### Rust 後端

```
src-tauri/src/
├── translation/
│   ├── mod.rs          # 模塊入口
│   ├── rough.rs        # 粗翻譯（本地 ONNX）
│   ├── fine.rs         # 精翻譯（遠程 API）
│   ├── model.rs        # ONNX 模型管理
│   └── download.rs     # 模型下載
```

**Tauri Commands**:
- `translate_rough(text, source_lang, target_lang)` - 粗翻譯（ONNX 模型）
- `translate_fine(text, source_lang, target_lang, service_url)` - 精翻譯（遠程）
- `check_remote_service(service_url)` - 檢查遠程服務
- `load_translation_model(model_dir, tokenizer_path)` - 加載 ONNX 模型
- `download_translation_model(output_dir)` - 下載模型

### 前端服務

**文件**: `src/services/translationService.ts`

**主要功能**:
- 粗翻譯調用（ONNX 模型）
- 精翻譯調用（遠程 API）
- 遠程服務管理

---

## 🎯 使用流程

```typescript
// 1. 粗轉錄完成
const roughResult = await transcribeAudio(audioChunk);

// 2. 粗翻譯（立即，使用 ONNX 模型）
const roughTranslation = await translateRough(roughResult.text);

// 3. 顯示粗字幕
subtitleService.addSegment({
  roughText: roughResult.text,
  roughTranslation: roughTranslation,
  displayText: roughResult.text,
  displayTranslation: roughTranslation,
  source: 'rough',
  translationSource: 'rough'
});

// 4. 如果有遠程服務，發送精層請求（異步）
if (await checkRemoteService()) {
  // 精轉錄
  requestFineTranscription(audioChunk)
    .then(fineResult => {
      // 更新：粗轉錄 → 精轉錄
      updateSegment({
        fineText: fineResult.text,
        displayText: fineResult.text,
        source: 'fine'
      });
      
      // 精翻譯（使用精轉錄結果）
      return translateFine(fineResult.text);
    })
    .then(fineTranslation => {
      // 更新：粗翻譯 → 精翻譯
      updateSegment({
        fineTranslation: fineTranslation,
        displayTranslation: fineTranslation,
        translationSource: 'fine'
      });
    });
}
```

---

## 📦 技術選型

### 本地翻譯（粗翻譯）

**當前實現**: ONNX Runtime + opus-mt-en-zh
- ✅ Rust 實現 (`ort` crate)
- ✅ 完全離線
- ✅ 延遲 ~50-200ms
- ✅ 翻譯成功率 75%
- ✅ 已修復空輸出和重複問題

**模型**: `Helsinki-NLP/opus-mt-en-zh`
- Encoder-Decoder 架構
- 自回歸生成
- 支持 Top-p 和 Greedy 策略

### 遠程翻譯 API（精翻譯）

**設計**:
```
POST /api/translate
{
  "text": "Hello world",
  "source_lang": "en",
  "target_lang": "zh"
}

Response:
{
  "translated_text": "你好世界",
  "confidence": 0.95
}
```

---

## ⚙️ 配置

### ONNX 模型

**模型目錄**: `models/opus-mt-en-zh-onnx/`
- `encoder_model.onnx` - Encoder 模型
- `decoder_model.onnx` - Decoder 模型
- `tokenizer.json` - Tokenizer
- `config.json` - 模型配置

**下載**: 使用 `download_translation_model` 命令

**加載**: 使用 `load_translation_model` 命令

### 遠程服務 URL

在設置頁面配置遠程服務端地址：
- 默認：空（僅使用本地 ONNX 模型）
- 可選：`http://localhost:8000` 或遠程服務器地址

---

## 📊 性能指標

| 指標 | 目標 | 當前 | 狀態 |
|------|------|------|------|
| 翻譯延遲 | < 200ms | ✅ ~50-200ms | ✅ |
| 翻譯成功率 | > 70% | ✅ 75% | ✅ |
| 空輸出率 | < 5% | ✅ 0% | ✅ |
| 重複問題 | < 5% | ✅ 0% | ✅ |

---

## 📝 注意事項

1. **粗層優先**: 必須立即完成，不等待精層
2. **精層增強**: 完全可選，失敗不影響粗層
3. **自動覆蓋**: 精層返回後自動更新顯示
4. **降級處理**: 無遠程服務時僅使用粗層（ONNX 模型）

---

## 🔄 版本歷史

- **v1.0** (2024年12月): ONNX 模型翻譯，已修復空輸出和重複問題
- **v0.9** (之前): 詞典翻譯（已棄用）

---

## 📚 相關文檔

- `TRANSLATION_STATUS.md` - 翻譯功能狀態
- `OPUS_MT_BEST_PRACTICES.md` - 最佳實踐指南
- `ONNX_TRANSLATION_INTEGRATION.md` - ONNX 集成指南
- `../development/DEVELOPMENT.md` - 開發計劃
- `../whisper/WHISPER_TRANSCRIPTION.md` - Whisper 轉錄功能
