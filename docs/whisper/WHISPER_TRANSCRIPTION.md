# Whisper 轉錄功能文檔

## 📋 概述

使用 Whisper 進行語音識別（ASR），支持本地實時轉錄。

## 🎯 功能特性

- ✅ 本地 Whisper 轉錄（whisper-rs）
- ✅ 模型下載和管理（Tiny/Base/Small）
- ✅ 實時轉錄（< 2 秒延遲）
- ✅ 初始提示支持（專有名詞優化）
- ✅ 音頻格式自動轉換（16kHz, 16-bit, Mono）

## 📦 技術實現

### Rust 後端

**模塊結構**：
```
src-tauri/src/whisper/
├── mod.rs          # 模塊入口
├── model.rs        # 模型管理
├── transcribe.rs   # 轉錄邏輯
└── download.rs     # 模型下載
```

**Tauri Commands**：
- `load_whisper_model(model_path)` - 加載模型
- `transcribe_audio(audio_data, sample_rate, initial_prompt)` - 轉錄音頻
- `download_whisper_model(model_type)` - 下載模型
- `check_whisper_model(model_path)` - 檢查模型文件

### 前端服務

**文件**：`src/services/whisperService.ts`

**主要功能**：
- 模型管理（下載、加載、檢查）
- 轉錄調用
- 路徑管理

## 🔧 使用方式

### 1. 下載模型

```typescript
import { downloadModel } from './services/whisperService';

await downloadModel('base'); // 下載 Base 模型
```

### 2. 加載模型

```typescript
import { loadModel } from './services/whisperService';

await loadModel('base');
```

### 3. 轉錄音頻

```typescript
import { transcribeAudio } from './services/whisperService';

const result = await transcribeAudio(
  audioData,      // Int16Array
  16000,          // 採樣率
  initialPrompt   // 可選：初始提示
);
```

## 📊 模型選項

| 模型 | 大小 | 速度 | 準確度 | 推薦場景 |
|------|------|------|--------|----------|
| Tiny | ~75MB | 最快 | 較低 | 測試、快速原型 |
| Base | ~150MB | 快 | 中等 | **推薦日常使用** |
| Small | ~500MB | 中等 | 較高 | 高準確度需求 |

## ⚙️ 配置

### 初始提示（Initial Prompt）

用於提升專有名詞識別準確度：

```typescript
const keywords = extractKeywordsFromPDF(pdfText);
const initialPrompt = generateInitialPrompt(keywords);
// 例如: "ClassNote AI, transcription, lecture, professor, algorithm"
```

## 📝 注意事項

1. **模型文件**：首次使用需要下載模型（Base 約 150MB）
2. **性能**：轉錄延遲 < 2 秒（Base 模型，2-4 秒音頻）
3. **音頻格式**：必須是 16kHz, 16-bit, Mono
4. **線程數**：自動使用 CPU 核心數（最多 4 個）

## 📚 相關文檔

- 模型選項說明：`WHISPER_MODEL_OPTIONS.md`

