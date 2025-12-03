# ONNX 翻譯模型集成指南

## 📋 概述

本文檔說明如何集成 `onnxruntime-rs` 和 ONNX 翻譯模型，實現本地翻譯功能。

**當前狀態**：使用簡單規則翻譯作為臨時方案  
**目標**：集成 ONNX 模型實現高質量本地翻譯

---

## 🔧 依賴安裝

### 1. 系統依賴

**macOS**:
```bash
brew install onnxruntime
```

**Linux**:
```bash
# 下載並安裝 ONNX Runtime
# 參考：https://onnxruntime.ai/docs/install/
```

**Windows**:
```powershell
# 使用 vcpkg 或直接下載預編譯庫
```

### 2. Cargo 依賴

在 `Cargo.toml` 中添加：

```toml
[dependencies]
onnxruntime = "0.18"
ndarray = "0.15"  # 用於張量操作
```

---

## 📦 模型準備

### 推薦模型

1. **Helsinki-NLP/opus-mt-en-zh**
   - 來源：Hugging Face
   - 格式：需要轉換為 ONNX
   - 大小：約 200MB

2. **其他 ONNX 翻譯模型**
   - 確保支持 en-zh 語言對
   - 模型格式：ONNX
   - 輸入/輸出格式：需要確認

### 模型下載

模型下載功能已實現（`translation/download.rs`），但需要設置正確的 URL：

```rust
pub fn get_en_zh_model_config(output_dir: &Path) -> TranslationModelConfig {
    TranslationModelConfig {
        url: "https://actual-model-url.onnx",  // 替換為實際 URL
        model_name: "opus-mt-en-zh.onnx",
        expected_size: Some(200_000_000),
    }
}
```

---

## 💻 實現步驟

### 1. 加載模型

```rust
use onnxruntime::{environment::Environment, session::Session};

let environment = Environment::builder()
    .with_name("Translation Model")
    .with_log_level(onnxruntime::LoggingLevel::Warning)
    .build()?;

let session = Session::builder(&environment)
    .with_model_from_file("path/to/model.onnx")?
    .build()?;
```

### 2. 文本預處理

根據模型要求進行預處理：
- 分詞（Tokenization）
- 編碼（Encoding）
- 創建輸入張量

```rust
use ndarray::Array;

// 示例：將文本轉換為模型輸入格式
let input_tokens = tokenize(text);
let input_tensor = Array::from_shape_vec((1, input_length), input_tokens)?;
```

### 3. 執行推理

```rust
use onnxruntime::tensor::OrtOwnedTensor;

let outputs: Vec<OrtOwnedTensor<f32, _>> = session.run(vec![input_tensor.view()])?;
let output = outputs[0].as_slice()?;
```

### 4. 後處理

將模型輸出轉換為文本：
- 解碼（Decoding）
- 去標記化（Detokenization）
- 格式化輸出

---

## 📝 代碼位置

### 關鍵文件

1. **`src-tauri/src/translation/model.rs`**
   - 模型管理器
   - 加載和推理邏輯

2. **`src-tauri/src/translation/rough.rs`**
   - 翻譯接口
   - 當前使用簡單規則，待替換為 ONNX

3. **`src-tauri/src/translation/download.rs`**
   - 模型下載功能
   - 需要設置正確的模型 URL

---

## 🚀 啟用步驟

1. **安裝系統依賴**
   ```bash
   brew install onnxruntime  # macOS
   ```

2. **取消註釋 Cargo.toml 中的依賴**
   ```toml
   onnxruntime = "0.18"
   ndarray = "0.15"
   ```

3. **實現模型加載邏輯**
   - 在 `translation/model.rs` 中實現 `load_model`
   - 實現 `translate` 方法

4. **設置模型下載 URL**
   - 在 `translation/download.rs` 中設置實際的模型 URL

5. **更新翻譯邏輯**
   - 在 `translation/rough.rs` 中啟用 ONNX 模型翻譯
   - 保留簡單規則翻譯作為降級方案

---

## ⚠️ 注意事項

1. **模型格式**：確保模型是 ONNX 格式
2. **輸入/輸出格式**：需要確認模型的輸入輸出格式
3. **性能**：ONNX Runtime 需要一定內存和計算資源
4. **錯誤處理**：實現完善的錯誤處理和降級機制

---

## 📚 參考資源

- [onnxruntime-rs 文檔](https://docs.rs/onnxruntime/)
- [ONNX Runtime 官方文檔](https://onnxruntime.ai/)
- [Hugging Face ONNX 模型](https://huggingface.co/models?library=onnx)

---

## 🔄 當前狀態

- ✅ 模型管理結構已創建
- ✅ 模型下載功能已實現（待設置 URL）
- ✅ 翻譯接口已定義
- ✅ **ONNX Runtime 集成（已完成）**
- ✅ **模型加載邏輯（已完成）**
- ✅ **基礎推理框架（已完成）**
- ⏳ 文本預處理（tokenization）- 待實現
- ⏳ 模型推理執行（待實現）
- ⏳ 後處理（detokenization）- 待實現

## 📚 相關文檔

- `OPUS_MT_BEST_PRACTICES.md` - 最佳實踐指南
- `TRANSLATION_STATUS.md` - 翻譯功能狀態
- `../models/MODEL_CONVERSION_GUIDE.md` - 模型轉換指南

