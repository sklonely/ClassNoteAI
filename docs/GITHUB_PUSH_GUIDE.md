# GitHub 推送指南

## ✅ 已完成

- ✅ 代碼已提交到本地倉庫
- ✅ GitHub 倉庫已創建：https://github.com/sklonely/ClassNoteAI
- ✅ 遠程倉庫已配置

## 🚀 推送代碼

### 方法一：使用 GitHub CLI（推薦）

```bash
cd /Users/remote_sklonely/eduTranslate

# 如果還沒登錄，先登錄
gh auth login

# 推送代碼
git push origin main
```

### 方法二：使用 HTTPS（需要 Personal Access Token）

1. 創建 Personal Access Token：
   - 訪問：https://github.com/settings/tokens
   - 點擊 "Generate new token (classic)"
   - 選擇權限：`repo`（完整倉庫權限）
   - 複製 token

2. 推送時使用 token：
   ```bash
   git push https://YOUR_TOKEN@github.com/sklonely/ClassNoteAI.git main
   ```

### 方法三：使用 SSH

1. 設置 SSH 密鑰（如果還沒有）：
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   # 將公鑰添加到 GitHub: https://github.com/settings/keys
   ```

2. 更改遠程 URL：
   ```bash
   git remote set-url origin git@github.com:sklonely/ClassNoteAI.git
   git push origin main
   ```

## 📦 上傳模型文件

**重要**：模型文件 `opus-mt-en-zh-onnx.zip` (512MB) 超過 GitHub 的 100MB 限制。

### 解決方案 1：使用 Git LFS（推薦）

```bash
# 安裝 Git LFS
brew install git-lfs  # macOS

# 初始化
cd /Users/remote_sklonely/eduTranslate
git lfs install

# 追蹤 ZIP 文件
git lfs track "model_packages/*.zip"
git add .gitattributes
git commit -m "Add Git LFS tracking for model files"

# 添加模型文件
git add model_packages/opus-mt-en-zh-onnx.zip
git commit -m "Add translation model"
git push origin main
```

### 解決方案 2：使用 GitHub Releases（手動上傳）

1. 訪問：https://github.com/sklonely/ClassNoteAI/releases/new
2. 創建 Release `v1.0`
3. **直接上傳 ZIP 文件**（GitHub Releases 支持大文件，不受 100MB 限制）
4. 上傳完成後，URL 將自動可用

### 解決方案 3：使用雲存儲

如果 GitHub 不方便，可以：
1. 上傳到雲存儲（AWS S3, Google Cloud Storage, 阿里雲 OSS 等）
2. 更新 `ClassNoteAI/src-tauri/src/translation/download.rs` 中的 URL

## 🔗 倉庫信息

- **倉庫地址**：https://github.com/sklonely/ClassNoteAI
- **模型下載 URL**：https://github.com/sklonely/ClassNoteAI/releases/download/v1.0/opus-mt-en-zh-onnx.zip
- **需要先創建 Release 並上傳模型文件**

## 📝 下一步

1. **推送代碼**（選擇上述方法之一）
2. **上傳模型文件**（推薦使用 GitHub Releases 手動上傳）
3. **驗證下載 URL**（確認可以訪問）

完成後，用戶就可以通過應用程序自動下載模型了！

