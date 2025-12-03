# 專案架構文檔

**更新日期**: 2024年12月

---

## 📁 文檔結構

文檔按功能分類組織，方便查找和閱讀。

```
docs/
├── README.md                    # 文檔目錄索引
├── ARCHITECTURE.md              # 本文檔（專案架構說明）
│
├── development/                 # 開發計劃和項目狀態
│   └── DEVELOPMENT.md          # 開發計劃、進度、技術棧
│
├── translation/                # 翻譯功能相關
│   ├── TRANSLATION.md          # 翻譯功能總覽
│   ├── TRANSLATION_STATUS.md   # 翻譯功能狀態
│   ├── ONNX_TRANSLATION_INTEGRATION.md  # ONNX 集成指南
│   └── OPUS_MT_BEST_PRACTICES.md        # OPUS-MT 最佳實踐
│
├── whisper/                    # Whisper 轉錄功能相關
│   ├── WHISPER_TRANSCRIPTION.md         # Whisper 轉錄功能
│   └── WHISPER_MODEL_OPTIONS.md         # Whisper 模型選項
│
└── models/                     # 模型相關
    └── MODEL_CONVERSION_GUIDE.md         # 模型轉換指南
```

---

## 🎯 分類說明

### development/ - 開發計劃和項目狀態

**用途**: 項目整體開發計劃、進度追蹤和下一步計劃

**主要文檔**:
- `DEVELOPMENT.md` - 開發計劃、MVP 範圍、開發階段、技術棧、當前進度

**適合閱讀對象**:
- 項目管理者
- 新加入的開發者
- 需要了解項目整體情況的人

---

### translation/ - 翻譯功能

**用途**: 所有翻譯功能相關的文檔

**主要文檔**:
- `TRANSLATION.md` - 翻譯功能總覽、架構、使用方式
- `TRANSLATION_STATUS.md` - 實現狀態、測試結果
- `ONNX_TRANSLATION_INTEGRATION.md` - ONNX Runtime 集成詳細指南
- `OPUS_MT_BEST_PRACTICES.md` - OPUS-MT 模型使用最佳實踐

**適合閱讀對象**:
- 翻譯功能開發者
- 需要集成翻譯功能的開發者
- 需要優化翻譯效果的開發者

**閱讀順序建議**:
1. `TRANSLATION.md` - 了解整體架構
2. `TRANSLATION_STATUS.md` - 了解實現狀態
3. `ONNX_TRANSLATION_INTEGRATION.md` - 了解技術細節
4. `OPUS_MT_BEST_PRACTICES.md` - 了解最佳實踐

---

### whisper/ - Whisper 轉錄功能

**用途**: Whisper ASR 功能相關的文檔

**主要文檔**:
- `WHISPER_TRANSCRIPTION.md` - Whisper 轉錄功能說明、使用方式
- `WHISPER_MODEL_OPTIONS.md` - Whisper 模型選擇指南

**適合閱讀對象**:
- Whisper 功能開發者
- 需要選擇合適 Whisper 模型的人

**閱讀順序建議**:
1. `WHISPER_TRANSCRIPTION.md` - 了解功能和使用方式
2. `WHISPER_MODEL_OPTIONS.md` - 了解模型選擇

---

### models/ - 模型相關

**用途**: 模型轉換、下載和管理相關的文檔

**主要文檔**:
- `MODEL_CONVERSION_GUIDE.md` - 模型轉換為 ONNX 格式的指南

**適合閱讀對象**:
- 需要轉換模型的開發者
- 需要管理模型的開發者

---

## 🔍 快速查找指南

### 按角色查找

**項目管理者**:
- `development/DEVELOPMENT.md` - 了解項目整體進度和計劃

**新開發者**:
1. `development/DEVELOPMENT.md` - 了解項目整體情況
2. `translation/TRANSLATION.md` - 了解翻譯功能
3. `whisper/WHISPER_TRANSCRIPTION.md` - 了解轉錄功能

**翻譯功能開發者**:
1. `translation/TRANSLATION.md` - 翻譯功能總覽
2. `translation/TRANSLATION_STATUS.md` - 實現狀態
3. `translation/ONNX_TRANSLATION_INTEGRATION.md` - 技術細節
4. `translation/OPUS_MT_BEST_PRACTICES.md` - 最佳實踐

**Whisper 功能開發者**:
1. `whisper/WHISPER_TRANSCRIPTION.md` - 功能說明
2. `whisper/WHISPER_MODEL_OPTIONS.md` - 模型選擇

**模型管理員**:
- `models/MODEL_CONVERSION_GUIDE.md` - 模型轉換指南

### 按任務查找

**想了解項目整體進度？**
→ `development/DEVELOPMENT.md`

**想開始使用翻譯功能？**
→ `translation/TRANSLATION.md`

**想了解翻譯實現細節？**
→ `translation/TRANSLATION_STATUS.md`

**想集成 ONNX 模型？**
→ `translation/ONNX_TRANSLATION_INTEGRATION.md`

**想優化翻譯效果？**
→ `translation/OPUS_MT_BEST_PRACTICES.md`

**想使用 Whisper 轉錄？**
→ `whisper/WHISPER_TRANSCRIPTION.md`

**想選擇 Whisper 模型？**
→ `whisper/WHISPER_MODEL_OPTIONS.md`

**想轉換模型？**
→ `models/MODEL_CONVERSION_GUIDE.md`

---

## 📝 文檔維護規範

### 新增文檔

1. **確定分類**: 根據文檔內容確定應該放在哪個分類目錄
2. **命名規範**: 使用大寫字母和下劃線，如 `FEATURE_NAME.md`
3. **更新索引**: 在 `README.md` 中添加新文檔的鏈接
4. **更新引用**: 更新相關文檔中的相互引用

### 更新文檔

1. **更新日期**: 在文檔頂部更新日期
2. **更新引用**: 如果移動文檔，更新所有相關引用
3. **保持一致性**: 保持文檔格式和風格一致

### 刪除文檔

1. **確認過期**: 確認文檔確實過期或不再需要
2. **更新引用**: 刪除或更新所有對該文檔的引用
3. **更新索引**: 從 `README.md` 中移除鏈接

---

## 🔗 文檔引用規範

### 同目錄引用

```markdown
- `TRANSLATION.md` - 翻譯功能總覽
```

### 跨目錄引用

```markdown
- `../development/DEVELOPMENT.md` - 開發計劃
- `../whisper/WHISPER_TRANSCRIPTION.md` - Whisper 轉錄
- `../models/MODEL_CONVERSION_GUIDE.md` - 模型轉換指南
```

### 根目錄引用（從 README.md）

```markdown
- `translation/TRANSLATION.md` - 翻譯功能總覽
- `development/DEVELOPMENT.md` - 開發計劃
```

---

## 📊 文檔統計

### 當前文檔數量

- **development/**: 1 個文檔
- **translation/**: 4 個文檔
- **whisper/**: 2 個文檔
- **models/**: 1 個文檔
- **根目錄**: 2 個文檔（README.md, ARCHITECTURE.md）

**總計**: 10 個文檔

---

## 🎉 優勢

### 按功能分類的優勢

1. **清晰組織**: 相關文檔集中在一起，方便查找
2. **易於維護**: 每個分類獨立，維護更方便
3. **快速定位**: 根據功能快速找到相關文檔
4. **擴展性好**: 新增功能時可以輕鬆添加新分類

### 閱讀體驗提升

1. **結構清晰**: 一目了然的目錄結構
2. **導航方便**: README.md 提供完整的導航
3. **引用準確**: 文檔間相互引用路徑正確
4. **分類明確**: 每個文檔都有明確的分類

---

**最後更新**: 2024年12月

