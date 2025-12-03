# GitHub 模型上傳指南

本指南將幫助您將翻譯模型上傳到 GitHub Releases，並配置應用程序的下載 URL。

## 📋 前置要求

1. **GitHub 帳戶**
2. **GitHub CLI** (可選，但推薦)
   ```bash
   # macOS
   brew install gh
   
   # 登錄
   gh auth login
   ```

## 🚀 快速開始

### 方法一：使用自動化腳本（推薦）

#### 步驟 1: 打包模型

```bash
cd /Users/remote_sklonely/eduTranslate
./scripts/package_models_for_github.sh
```

這會創建 `model_packages/` 目錄，包含所有模型的 ZIP 文件。

#### 步驟 2: 上傳到 GitHub

**選項 A: 使用 GitHub CLI（自動化）**

```bash
./scripts/upload_to_github.sh YOUR_GITHUB_USERNAME YOUR_REPO_NAME v1.0
```

例如：
```bash
./scripts/upload_to_github.sh sklonely classnote-ai-models v1.0
```

**選項 B: 手動上傳**

1. 在 GitHub 上創建新倉庫（例如：`classnote-ai-models`）
2. 創建新 Release：
   - 點擊 "Releases" → "Create a new release"
   - Tag: `v1.0`
   - Title: `Translation Models v1.0`
   - Description: `ONNX translation models for ClassNote AI`
3. 將 `model_packages/` 目錄中的 ZIP 文件拖放到 Release 頁面

#### 步驟 3: 更新下載 URL 配置

```bash
./scripts/update_download_urls.sh YOUR_GITHUB_USERNAME YOUR_REPO_NAME v1.0
```

例如：
```bash
./scripts/update_download_urls.sh sklonely classnote-ai-models v1.0
```

### 方法二：手動操作

#### 1. 打包模型

```bash
cd models
zip -r ../model_packages/opus-mt-en-zh-onnx.zip opus-mt-en-zh-onnx/
zip -r ../model_packages/nllb-200-distilled-600M-onnx.zip nllb-200-distilled-600M-onnx/
zip -r ../model_packages/mbart-large-50-onnx.zip mbart-large-50-onnx/
```

#### 2. 創建 GitHub 倉庫

1. 訪問 https://github.com/new
2. 倉庫名稱：`classnote-ai-models`（或您喜歡的名稱）
3. 選擇 Public（公開）或 Private（私有）
4. 點擊 "Create repository"

#### 3. 創建 Release

1. 在倉庫頁面，點擊 "Releases" → "Create a new release"
2. 填寫信息：
   - **Tag version**: `v1.0`
   - **Release title**: `Translation Models v1.0`
   - **Description**: 
     ```
     ONNX translation models for ClassNote AI application.
     
     Models included:
     - opus-mt-en-zh-onnx (~200MB)
     - nllb-200-distilled-600M-onnx (~600MB)
     - mbart-large-50-onnx (~1.2GB)
     ```
3. 上傳 ZIP 文件：
   - 將 `model_packages/` 目錄中的 ZIP 文件拖放到頁面
4. 點擊 "Publish release"

#### 4. 更新代碼配置

編輯 `ClassNoteAI/src-tauri/src/translation/download.rs`，將：

```rust
url: "https://github.com/your-username/classnote-ai-models/releases/download/v1.0/opus-mt-en-zh-onnx.zip".to_string(),
```

替換為：

```rust
url: "https://github.com/YOUR_USERNAME/YOUR_REPO_NAME/releases/download/v1.0/opus-mt-en-zh-onnx.zip".to_string(),
```

對所有三個模型重複此操作。

## 🔍 驗證

上傳完成後，驗證下載 URL 是否可訪問：

```bash
# 測試 URL（替換為您的實際 URL）
curl -I https://github.com/YOUR_USERNAME/YOUR_REPO_NAME/releases/download/v1.0/opus-mt-en-zh-onnx.zip
```

應該返回 `HTTP/2 302` 或 `HTTP/2 200`。

## 📝 注意事項

1. **文件大小限制**：
   - GitHub 單個文件限制：100MB（需要 Git LFS）
   - Release 附件限制：2GB
   - 如果文件超過 100MB，考慮使用 Git LFS 或分片上傳

2. **私有倉庫**：
   - 如果使用私有倉庫，需要配置 GitHub Token 進行認證
   - 公開倉庫更方便用戶下載

3. **版本管理**：
   - 建議使用語義化版本（如 v1.0, v1.1）
   - 更新模型時創建新版本

## 🛠️ 故障排除

### 問題：GitHub CLI 未安裝

```bash
# macOS
brew install gh

# 登錄
gh auth login
```

### 問題：文件太大無法上傳

如果文件超過 100MB，有幾個選項：

1. **使用 Git LFS**：
   ```bash
   git lfs install
   git lfs track "*.zip"
   git add .gitattributes
   git commit -m "Add LFS tracking"
   ```

2. **使用雲存儲**：
   - AWS S3
   - Google Cloud Storage
   - 阿里雲 OSS
   - 然後更新 URL 配置

### 問題：下載 URL 返回 404

1. 確認 Release 已發布（不是草稿）
2. 確認文件名完全匹配
3. 確認 URL 格式正確

## 📚 相關文檔

- [GitHub Releases 文檔](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [GitHub CLI 文檔](https://cli.github.com/manual/)
- [Git LFS 文檔](https://git-lfs.github.com/)

