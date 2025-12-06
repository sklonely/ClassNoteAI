# 翻譯模型測試指南

## 📋 概述

本指南說明如何測試和比較三種翻譯實現：
1. **原始 HuggingFace 模型**（不通過 ONNX）
2. **ONNX Python 實現**
3. **ONNX Rust 實現**

---

## 🚀 快速開始

### 方法 1: 運行所有測試（推薦）

```bash
cd /Users/remote_sklonely/eduTranslate
./scripts/run_all_tests.sh
```

這個腳本會：
1. 測試原始模型
2. 測試 ONNX Python 實現
3. 測試 ONNX Rust 實現
4. 自動對比所有結果

### 方法 2: 分別運行

#### 1. 測試原始模型

```bash
cd /Users/remote_sklonely/eduTranslate
uv run python scripts/test_original_model.py
```

**輸出**: `scripts/original_model_results.json`

#### 2. 測試 ONNX Python 實現

```bash
cd /Users/remote_sklonely/eduTranslate
uv run python scripts/compare_translation_python_rust.py
```

**輸出**: `scripts/translation_comparison_results.json`

#### 3. 測試 ONNX Rust 實現

```bash
cd /Users/remote_sklonely/eduTranslate/ClassNoteAI/src-tauri
cargo run --example test_translation
```

**輸出**: `scripts/rust_translation_results.json`

#### 4. 對比所有實現

```bash
cd /Users/remote_sklonely/eduTranslate
uv run python scripts/compare_all_implementations.py
```

**輸出**: `scripts/comparison_all_results.json`

---

## 📊 測試結果解讀

### 原始模型結果

**位置**: `scripts/original_model_results.json`

**格式**:
```json
{
  "text": "Hello",
  "result": "你好你好",
  "success": true,
  "has_chinese": true
}
```

**說明**: 這是模型的"真實實力"，不經過 ONNX 轉換。

### ONNX Python 結果

**位置**: `scripts/translation_comparison_results.json`

**格式**:
```json
{
  "text": "Hello",
  "python_result": "你好你好",
  "python_success": true,
  "python_has_chinese": true
}
```

**說明**: 使用 ONNX Runtime 的 Python 實現結果。

### ONNX Rust 結果

**位置**: `scripts/rust_translation_results.json`

**格式**:
```json
{
  "text": "Hello",
  "result": "你好你好",
  "success": true,
  "has_chinese": true
}
```

**說明**: 使用 ONNX Runtime 的 Rust 實現結果。

### 對比結果

**位置**: `scripts/comparison_all_results.json`

**格式**:
```json
{
  "text": "Hello",
  "results": {
    "原始模型": {
      "result": "你好你好",
      "success": true,
      "has_chinese": true
    },
    "ONNX Python": {
      "result": "你好你好",
      "success": true,
      "has_chinese": true
    },
    "ONNX Rust": {
      "result": "你好你好",
      "success": true,
      "has_chinese": true
    }
  }
}
```

---

## 🔍 預期結果

### 理想情況

1. **原始模型 vs ONNX Python**: 應該非常接近（允許微小差異）
2. **ONNX Python vs ONNX Rust**: 應該幾乎完全一致（使用相同的 ONNX 模型和邏輯）

### 當前發現的問題

根據測試結果，**原始模型本身也存在重複問題**：
- "Hello" → "你好你好"（重複）
- "Hello, how are you?" → "你好,你好吗?"（部分重複）

這說明：
1. **問題不在 ONNX 轉換**：原始模型就有這個問題
2. **需要改進生成策略**：Repetition Penalty 和 N-gram 檢測需要更強

---

## 🐛 常見問題

### 1. Rust Example 編譯失敗

**錯誤**: `cannot find module`

**解決方案**:
```bash
cd ClassNoteAI/src-tauri
cargo clean
cargo build --example test_translation
```

### 2. Python 依賴缺失

**錯誤**: `ModuleNotFoundError`

**解決方案**:
```bash
uv pip install transformers torch onnxruntime numpy
```

### 3. 模型文件不存在

**錯誤**: `模型目錄不存在`

**解決方案**:
1. 確保模型已下載到 `models/opus-mt-en-zh-onnx/`
2. 或使用設置頁面下載模型

---

## 📝 測試文本

默認測試文本：
1. "Hello"
2. "Hello world"
3. "Hello, how are you?"
4. "Good morning"
5. "Thank you"
6. "I love you"
7. "What is your name?"
8. "How are you doing today?"
9. "The weather is nice today."
10. "This is a test sentence for translation comparison."

可以修改腳本中的 `test_texts` 列表來測試其他文本。

---

## 🎯 驗證標準

### 一致性檢查

1. **Tokenization 結果**: Python 和 Rust 應該完全一致
2. **Encoder 輸出**: Shape 和數值應該一致（允許浮點誤差）
3. **Decoder 生成**: 每個步驟的 token ID 應該一致
4. **最終結果**: 翻譯文本應該一致

### 質量檢查

1. **無重複**: 不應該有重複的詞或短語
2. **含中文**: 翻譯結果應該包含中文字符
3. **語義正確**: 翻譯應該符合語義

---

## 📚 相關文檔

- [翻譯架構文檔](./ARCHITECTURE.md)
- [改進實現指南](./IMPROVED_IMPLEMENTATION.md)
- [對比結果](./COMPARISON_RESULTS.md)


