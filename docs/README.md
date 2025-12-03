# ClassNote AI 文檔目錄

**更新日期**: 2024年12月

---

## 🚀 快速開始

- **新開發者**: 先閱讀 [開發計劃](development/DEVELOPMENT.md) 了解項目整體情況
- **了解專案架構**: 閱讀 [專案架構文檔](ARCHITECTURE.md) 了解文檔組織結構
- **查找文檔**: 使用下方的快速導航或按功能分類查找

---

## 📚 文檔結構

文檔按功能分類組織，方便查找和閱讀。

### 📁 目錄結構

```
docs/
├── README.md                    # 本文檔（目錄索引）
├── ARCHITECTURE.md              # 專案架構文檔
├── development/                 # 開發計劃和項目狀態
│   ├── FEATURES.md             # 開發計劃功能狀態總結
│   └── DEVELOPMENT.md          # 開發計劃文檔
├── translation/                 # 翻譯功能相關
│   ├── FEATURES.md             # 翻譯功能狀態總結
│   ├── TRANSLATION.md          # 翻譯功能總覽
│   ├── TRANSLATION_STATUS.md   # 翻譯功能狀態
│   ├── ONNX_TRANSLATION_INTEGRATION.md  # ONNX 集成指南
│   └── OPUS_MT_BEST_PRACTICES.md        # OPUS-MT 最佳實踐
├── whisper/                    # Whisper 轉錄功能相關
│   ├── FEATURES.md             # Whisper 功能狀態總結
│   ├── WHISPER_TRANSCRIPTION.md         # Whisper 轉錄功能
│   └── WHISPER_MODEL_OPTIONS.md         # Whisper 模型選項
├── pdf/                        # PDF 查看器功能相關
│   ├── FEATURES.md             # PDF 功能狀態總結
│   └── PDF_VIEWER.md           # PDF 查看器詳細文檔
└── models/                     # 模型相關
    ├── FEATURES.md             # 模型功能狀態總結
    └── MODEL_CONVERSION_GUIDE.md         # 模型轉換指南
```

---

## 🚀 快速導航

### 開發相關

- **[開發計劃](development/DEVELOPMENT.md)** - 項目開發計劃、進度和下一步計劃

### 翻譯功能

- **[翻譯功能狀態總結](translation/FEATURES.md)** - 翻譯功能已達成和計劃功能
- **[翻譯功能總覽](translation/TRANSLATION.md)** - 翻譯功能架構和使用方式
- **[翻譯功能狀態](translation/TRANSLATION_STATUS.md)** - 翻譯功能實現狀態和測試結果
- **[ONNX 集成指南](translation/ONNX_TRANSLATION_INTEGRATION.md)** - ONNX Runtime 集成詳細指南
- **[OPUS-MT 最佳實踐](translation/OPUS_MT_BEST_PRACTICES.md)** - OPUS-MT 模型使用最佳實踐

### Whisper 轉錄

- **[Whisper 功能狀態總結](whisper/FEATURES.md)** - Whisper 功能已達成和計劃功能
- **[Whisper 轉錄功能](whisper/WHISPER_TRANSCRIPTION.md)** - Whisper ASR 功能說明
- **[Whisper 模型選項](whisper/WHISPER_MODEL_OPTIONS.md)** - Whisper 模型選擇指南

### PDF 查看器

- **[PDF 功能狀態總結](pdf/FEATURES.md)** - PDF 功能已達成和計劃功能
- **[PDF 查看器文檔](pdf/PDF_VIEWER.md)** - PDF 查看器詳細功能說明

### 模型相關

- **[模型功能狀態總結](models/FEATURES.md)** - 模型功能已達成和計劃功能
- **[模型轉換指南](models/MODEL_CONVERSION_GUIDE.md)** - 模型轉換為 ONNX 格式的指南

---

## 📋 文檔分類說明

### development/ - 開發計劃和項目狀態

包含項目整體開發計劃、進度追蹤和下一步計劃。

**主要文檔**:
- `FEATURES.md` - 開發計劃功能狀態總結
- `DEVELOPMENT.md` - 開發計劃、MVP 範圍、開發階段、技術棧

### translation/ - 翻譯功能

包含所有翻譯功能相關的文檔，包括實現狀態、技術細節和最佳實踐。

**主要文檔**:
- `FEATURES.md` - 翻譯功能狀態總結
- `TRANSLATION.md` - 翻譯功能總覽、架構、使用方式
- `TRANSLATION_STATUS.md` - 實現狀態、測試結果
- `ONNX_TRANSLATION_INTEGRATION.md` - ONNX Runtime 集成詳細指南
- `OPUS_MT_BEST_PRACTICES.md` - OPUS-MT 模型使用最佳實踐

### whisper/ - Whisper 轉錄功能

包含 Whisper ASR 功能相關的文檔。

**主要文檔**:
- `FEATURES.md` - Whisper 功能狀態總結
- `WHISPER_TRANSCRIPTION.md` - Whisper 轉錄功能說明
- `WHISPER_MODEL_OPTIONS.md` - Whisper 模型選擇指南

### pdf/ - PDF 查看器功能

包含 PDF 查看器功能相關的文檔。

**主要文檔**:
- `FEATURES.md` - PDF 功能狀態總結
- `PDF_VIEWER.md` - PDF 查看器詳細功能說明

### models/ - 模型相關

包含模型轉換、下載和管理相關的文檔。

**主要文檔**:
- `FEATURES.md` - 模型功能狀態總結
- `MODEL_CONVERSION_GUIDE.md` - 模型轉換為 ONNX 格式的指南

---

## 🔍 查找文檔

### 按功能查找

- **想了解項目整體進度？** → `development/FEATURES.md` 或 `development/DEVELOPMENT.md`
- **想了解翻譯功能？** → `translation/FEATURES.md` 或 `translation/TRANSLATION.md`
- **想了解 Whisper 轉錄？** → `whisper/FEATURES.md` 或 `whisper/WHISPER_TRANSCRIPTION.md`
- **想了解 PDF 查看器？** → `pdf/FEATURES.md` 或 `pdf/PDF_VIEWER.md`
- **想轉換模型？** → `models/FEATURES.md` 或 `models/MODEL_CONVERSION_GUIDE.md`

### 按需求查找

- **快速了解功能狀態** → 各分類下的 `FEATURES.md`
- **快速開始翻譯功能** → `translation/TRANSLATION.md`
- **了解翻譯實現細節** → `translation/TRANSLATION_STATUS.md`
- **集成 ONNX 模型** → `translation/ONNX_TRANSLATION_INTEGRATION.md`
- **優化翻譯效果** → `translation/OPUS_MT_BEST_PRACTICES.md`
- **選擇 Whisper 模型** → `whisper/WHISPER_MODEL_OPTIONS.md`
- **使用 PDF 查看器** → `pdf/PDF_VIEWER.md`

---

## 📝 文檔更新記錄

- **2024年12月**: 重新組織文檔結構，按功能分類
- **2024年12月**: 確認粗翻譯使用 ONNX 模型（非詞典）
- **2024年12月**: 翻譯功能修復完成並測試通過
- **2024年12月**: 為每個功能分類創建功能狀態總結文檔（FEATURES.md）
- **2024年12月**: 新增 PDF 查看器功能文檔

---

## 💡 使用建議

1. **新開發者**: 先閱讀 `development/DEVELOPMENT.md` 了解項目整體情況
2. **翻譯功能開發**: 從 `translation/TRANSLATION.md` 開始
3. **Whisper 功能開發**: 從 `whisper/WHISPER_TRANSCRIPTION.md` 開始
4. **模型相關工作**: 參考 `models/MODEL_CONVERSION_GUIDE.md`

---

**最後更新**: 2024年12月

