# 翻譯結果比較指南

## 📋 概述

本文檔說明如何使用 Python 和 Rust 腳本來比較 ONNX 翻譯模型的結果，以驗證 Rust 實現是否正確。

---

## 🚀 快速開始

### 1. 安裝 Python 依賴

```bash
pip install onnxruntime transformers numpy
```

### 2. 運行比較測試

```bash
cd /path/to/eduTranslate
./scripts/run_translation_comparison.sh
```

或者直接運行 Python 腳本：

```bash
python3 scripts/compare_translation_python_rust.py
```

---

## 📝 腳本說明

### `compare_translation_python_rust.py`

**功能**：
- 使用 Python ONNX Runtime 進行翻譯
- 輸出詳細的翻譯過程日誌
- 保存結果到 JSON 文件

**使用方法**：
```bash
python3 scripts/compare_translation_python_rust.py
```

**輸出**：
- 控制台：詳細的翻譯過程和結果
- `scripts/translation_comparison_results.json`：結構化的測試結果

### `test_translation_rust.rs`

**功能**：
- Rust 翻譯測試腳本（需要實際實現）

**注意**：
- 目前只是一個框架，需要實際的翻譯模型實現
- 建議通過 Tauri 應用程序測試 Rust 翻譯功能

### `run_translation_comparison.sh`

**功能**：
- 自動化測試腳本
- 檢查依賴和模型目錄
- 運行 Python 測試

---

## 🔍 比較要點

### 1. Tokenization 結果

比較 Python 和 Rust 的 tokenization 結果是否一致：

```python
# Python
input_ids = tokenizer.encode(text, add_special_tokens=True)

# Rust
let encoding = tokenizer.encode(text, true);
let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
```

**檢查點**：
- Token IDs 是否一致
- 特殊 token（BOS, EOS, PAD）的處理是否一致

### 2. Encoder 輸出

比較 Encoder 的 hidden states：

```python
# Python
encoder_outputs = encoder_session.run(None, {
    "input_ids": input_ids,
    "attention_mask": attention_mask
})
encoder_hidden_states = encoder_outputs[0]
```

**檢查點**：
- Shape 是否一致：`[batch_size, seq_len, hidden_size]`
- 數值是否接近（允許浮點誤差）

### 3. Decoder 生成過程

比較 Decoder 的自回歸生成過程：

**檢查點**：
- 每個步驟生成的 token ID 是否一致
- Repetition Penalty 的應用是否一致
- EOS token 的檢測是否一致

### 4. 最終翻譯結果

比較最終的翻譯文本：

**檢查點**：
- 翻譯文本是否一致
- 是否都包含中文字符
- 長度是否接近

---

## 🐛 常見問題

### 1. Tokenization 結果不一致

**可能原因**：
- `add_special_tokens` 參數不一致
- Tokenizer 版本不同
- 預處理邏輯不同

**解決方案**：
- 確保 Python 和 Rust 使用相同的 tokenizer 文件
- 檢查預處理邏輯是否一致

### 2. Encoder 輸出不一致

**可能原因**：
- 輸入張量的形狀或數據類型不一致
- Attention mask 的處理不一致

**解決方案**：
- 檢查輸入張量的 shape 和 dtype
- 確保 attention_mask 的處理一致

### 3. Decoder 生成不一致

**可能原因**：
- Decoder 輸入格式不一致
- Repetition Penalty 的應用不一致
- EOS token 的檢測邏輯不一致

**解決方案**：
- 檢查 Decoder 的輸入格式（是否需要整個序列）
- 確保 Repetition Penalty 的實現一致
- 檢查 EOS token 的處理邏輯

### 4. 翻譯結果為空

**可能原因**：
- Token 8 的特殊處理不當
- 輸出 token 的過濾邏輯過於嚴格
- Decode 過程出錯

**解決方案**：
- 檢查 Token 8 的處理邏輯
- 檢查輸出 token 的過濾條件
- 驗證 decode 過程是否正確

---

## 📊 測試結果解讀

### Python 測試結果

查看 `translation_comparison_results.json`：

```json
{
  "text": "Hello world",
  "python_result": "你好世界",
  "python_success": true,
  "python_has_chinese": true,
  "rust_result": null,
  "rust_success": false,
  "rust_has_chinese": false
}
```

### 成功標準

- ✅ **Python 翻譯成功**：`python_success == true`
- ✅ **包含中文**：`python_has_chinese == true`
- ✅ **結果合理**：翻譯文本長度適中，語義正確

### Rust 比較

當 Rust 結果可用時：

- ✅ **結果一致**：`python_result == rust_result`
- ⚠️ **結果不一致**：需要檢查實現差異
- ❌ **Rust 失敗**：需要檢查 Rust 實現

---

## 🔧 調試技巧

### 1. 啟用詳細日誌

在 Python 腳本中，已經包含了詳細的日誌輸出：
- Tokenization 結果
- Encoder 輸出 shape
- Decoder 生成過程
- 最終翻譯結果

### 2. 逐步比較

如果結果不一致，可以逐步比較：
1. 比較 Tokenization 結果
2. 比較 Encoder 輸出
3. 比較 Decoder 每個步驟的輸出
4. 比較最終結果

### 3. 使用調試工具

- **Python**：使用 `pdb` 或 `ipdb` 進行調試
- **Rust**：使用 `println!` 或 `dbg!` 宏輸出調試信息

---

## 📚 相關文檔

- [翻譯架構文檔](./ARCHITECTURE.md)
- [ONNX 翻譯集成指南](./ONNX_TRANSLATION_INTEGRATION.md)
- [翻譯狀態評估](./TRANSLATION_STATUS_ASSESSMENT.md)

---

## 💡 下一步

1. **運行 Python 測試**：確認 Python 實現正確
2. **運行 Rust 測試**：通過 Tauri 應用程序測試 Rust 實現
3. **比較結果**：找出不一致的地方
4. **修復問題**：根據比較結果修復 Rust 實現
5. **重複測試**：直到結果一致


