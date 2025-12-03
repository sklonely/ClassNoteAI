# Whisper 模型選項說明

## 📋 目前實現的模型選項

### ✅ 已實現（可在 UI 中選擇）

1. **Tiny (75MB)**
   - 文件大小：約 75MB
   - 速度：最快 ⚡⚡⚡
   - 準確度：較低 ⭐⭐
   - 適用場景：
     - 快速測試
     - 資源受限的設備
     - 對準確度要求不高的場景
   - 下載 URL: `ggml-tiny.bin`

2. **Base (142MB)** ⭐ **推薦**
   - 文件大小：約 142MB（實際約 141MB）
   - 速度：快 ⚡⚡
   - 準確度：良好 ⭐⭐⭐
   - 適用場景：
     - **日常使用（推薦）**
     - 平衡速度和準確度
     - 大多數應用場景
   - 下載 URL: `ggml-base.bin`

3. **Small (466MB)**
   - 文件大小：約 466MB
   - 速度：中等 ⚡
   - 準確度：高 ⭐⭐⭐⭐
   - 適用場景：
     - 需要更高準確度
     - 專業應用
     - 有足夠資源的設備
   - 下載 URL: `ggml-small.bin`

---

## 🔮 理論上可用的其他選項（未實現）

### ⚠️ 未實現（需要額外開發）

4. **Medium (1.5GB)**
   - 文件大小：約 1.5GB
   - 速度：慢 🐌
   - 準確度：很高 ⭐⭐⭐⭐⭐
   - 適用場景：
     - 專業轉錄需求
     - 高準確度要求
     - 有充足資源的設備
   - 下載 URL: `ggml-medium.bin`
   - **狀態**: ❌ 未實現

5. **Large / Large-v2 / Large-v3 (2.9GB)**
   - 文件大小：約 2.9GB
   - 速度：很慢 🐌🐌
   - 準確度：最高 ⭐⭐⭐⭐⭐
   - 適用場景：
     - 專業級轉錄
     - 最高準確度要求
     - 高性能設備
   - 下載 URL: `ggml-large.bin` / `ggml-large-v2.bin` / `ggml-large-v3.bin`
   - **狀態**: ❌ 未實現

---

## 📊 模型對比表

| 模型 | 大小 | 速度 | 準確度 | 延遲 | 推薦場景 |
|------|------|------|--------|------|----------|
| Tiny | 75MB | ⚡⚡⚡ | ⭐⭐ | < 1秒 | 快速測試 |
| **Base** | **142MB** | **⚡⚡** | **⭐⭐⭐** | **< 2秒** | **日常使用（推薦）** |
| Small | 466MB | ⚡ | ⭐⭐⭐⭐ | < 3秒 | 專業應用 |
| Medium | 1.5GB | 🐌 | ⭐⭐⭐⭐⭐ | < 5秒 | 高精度需求 |
| Large | 2.9GB | 🐌🐌 | ⭐⭐⭐⭐⭐ | < 10秒 | 最高精度 |

---

## 🎯 選擇建議

### 根據使用場景選擇：

1. **快速測試和開發**
   - 推薦：**Tiny**
   - 理由：下載快，運行快，適合測試功能

2. **日常使用（推薦）**
   - 推薦：**Base** ⭐
   - 理由：平衡速度和準確度，適合大多數場景

3. **專業轉錄需求**
   - 推薦：**Small** 或 **Medium**
   - 理由：更高的準確度，適合專業應用

4. **最高精度需求**
   - 推薦：**Large**
   - 理由：最高準確度，但需要更多資源

### 根據設備資源選擇：

- **低配置設備**：Tiny 或 Base
- **中等配置設備**：Base 或 Small
- **高配置設備**：Small、Medium 或 Large

---

## 🔧 如何添加更多模型選項

如果需要添加 Medium 或 Large 模型，需要：

1. **在 `download.rs` 中添加配置函數**：
```rust
pub fn get_medium_model_config(output_dir: &Path) -> ModelDownloadConfig {
    ModelDownloadConfig {
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin".to_string(),
        output_path: output_dir.join("ggml-medium.bin"),
        expected_size: Some(1_500_000_000), // 約 1.5GB
    }
}
```

2. **在 `lib.rs` 中添加支持**：
```rust
match model_type.as_str() {
    "tiny" => download::get_tiny_model_config(output_path),
    "base" => download::get_base_model_config(output_path),
    "small" => download::get_small_model_config(output_path),
    "medium" => download::get_medium_model_config(output_path), // 新增
    "large" => download::get_large_model_config(output_path),   // 新增
    _ => return Err(format!("不支持的模型類型")),
}
```

3. **在前端添加選項**：
   - 更新 `whisperService.ts` 中的 `ModelType`
   - 更新 `getModelSize()` 和 `getModelDisplayName()`
   - 更新 `WhisperModelManager.tsx` 中的下拉選單

---

## 📝 注意事項

1. **文件大小**：實際文件大小可能略有不同（±5%）
2. **下載時間**：根據網絡速度，下載時間會有所不同
3. **內存使用**：模型越大，運行時內存使用越多
4. **轉錄延遲**：模型越大，轉錄延遲可能增加
5. **推薦配置**：Base 模型適合大多數場景，是推薦選擇

---

## 🔗 參考資料

- HuggingFace 模型倉庫: https://huggingface.co/ggerganov/whisper.cpp
- Whisper 官方文檔: https://github.com/openai/whisper
- whisper.cpp 文檔: https://github.com/ggerganov/whisper.cpp

