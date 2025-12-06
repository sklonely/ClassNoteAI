# 翻譯模型配置說明

## 📋 當前配置

### 支持的模型

**僅保留快速響應的小模型：**

- ✅ **Opus-MT (英文→中文)** - `opus-mt-en-zh-onnx`
  - 文件大小：~512MB（壓縮後）
  - 特點：專為英文到中文翻譯優化，速度快，準確度高
  - 推薦使用：是

**已排除的大模型（以確保快速響應）：**

- ❌ NLLB-200-distilled-600M-onnx (~4.3GB) - 文件太大
- ❌ MBart-Large-50-onnx (~4.2GB) - 文件太大

## 🔧 配置位置

### Rust 後端配置

文件：`ClassNoteAI/src-tauri/src/translation/download.rs`

- `TranslationModelType` enum：只包含 `OpusMtEnZh`
- `get_translation_model_config()`：只配置 opus 模型的下載 URL

### 前端配置

文件：`ClassNoteAI/src/components/TranslationModelManager.tsx`

- `TRANSLATION_MODELS` 數組：只包含 opus 模型

文件：`ClassNoteAI/src/services/translationModelService.ts`

- `getModelDisplayName()`：只包含 opus 模型的顯示名稱

## 📦 模型文件

### 已打包的文件

- `model_packages/opus-mt-en-zh-onnx.zip` (~512MB)

### 上傳到 GitHub

1. 在 GitHub 創建倉庫（例如：`classnote-ai-models`）
2. 創建 Release `v1.0`
3. 上傳 `opus-mt-en-zh-onnx.zip`
4. 更新下載 URL（運行 `./scripts/update_download_urls.sh`）

## 🚀 使用方式

用戶只需：
1. 打開設置頁面
2. 選擇 "Opus-MT (英文→中文)"
3. 點擊 "下載模型"（如果本地沒有）
4. 點擊 "加載模型"

程序會自動處理所有細節。


