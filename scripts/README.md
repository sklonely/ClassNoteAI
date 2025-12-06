# 模型轉換腳本

## 📋 概述

此目錄包含用於將 PyTorch 翻譯模型轉換為 ONNX 格式的腳本。

## 🔧 使用方法

### 1. 安裝依賴

```bash
pip install optimum[onnxruntime] transformers torch
```

### 2. 運行轉換腳本

```bash
python scripts/convert_model_to_onnx.py
```

或指定自定義參數：

```bash
python scripts/convert_model_to_onnx.py \
    --model Helsinki-NLP/opus-mt-en-zh \
    --output-dir ./models/opus-mt-en-zh-onnx
```

### 3. 檢查輸出

轉換完成後，檢查 `models/opus-mt-en-zh-onnx/` 目錄：

```
models/opus-mt-en-zh-onnx/
├── model.onnx              # ONNX 模型文件
├── config.json             # 模型配置
├── tokenizer.json          # Tokenizer 文件
├── vocab.json              # 詞彙表
└── merges.txt              # BPE merges
```

### 4. 上傳模型

將轉換後的模型上傳到可訪問的位置：
- GitHub Releases
- 雲存儲（如 AWS S3、Google Cloud Storage）
- 自託管服務器

### 5. 更新配置

更新 `src-tauri/src/translation/download.rs` 中的：
- `url`: 模型下載 URL
- `expected_size`: 實際模型文件大小（字節）

## 📝 注意事項

1. **網絡連接**：首次運行需要下載模型，確保網絡連接正常
2. **磁盤空間**：確保有足夠的磁盤空間（至少 1GB）
3. **Python 版本**：建議使用 Python 3.8+
4. **模型大小**：轉換後的 ONNX 模型大小約 200-300MB

## 🔗 相關文檔

- `docs/MODEL_CONVERSION_GUIDE.md` - 詳細的轉換指南
- `docs/TRANSLATION_MODEL_SELECTION.md` - 模型選擇說明


