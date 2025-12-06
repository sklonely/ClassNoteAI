# 推送代碼到 GitHub 指南

## ✅ 已完成

- ✅ 代碼已提交到本地倉庫
- ✅ GitHub 倉庫已創建：https://github.com/sklonely/ClassNoteAI
- ✅ 遠程倉庫已配置

## 🚀 推送步驟

### 方法一：使用 GitHub CLI（最簡單）

```bash
cd /Users/remote_sklonely/eduTranslate

# 確保 GitHub CLI 已登錄
gh auth status

# 設置 git 使用 GitHub CLI 認證
gh auth setup-git

# 推送代碼
git push origin main
```

### 方法二：手動推送（如果方法一不行）

1. **使用 GitHub CLI 推送**：
   ```bash
   cd /Users/remote_sklonely/eduTranslate
   gh repo sync sklonely/ClassNoteAI
   ```

2. **或使用 SSH**：
   ```bash
   # 更改遠程 URL 為 SSH
   git remote set-url origin git@github.com:sklonely/ClassNoteAI.git
   git push origin main
   ```

3. **或使用 Personal Access Token**：
   ```bash
   # 創建 token: https://github.com/settings/tokens
   # 選擇 repo 權限
   git push https://YOUR_TOKEN@github.com/sklonely/ClassNoteAI.git main
   ```

## 📦 上傳模型文件

**重要**：模型文件 `opus-mt-en-zh-onnx.zip` (512MB) 超過 GitHub 的 100MB 限制。

### 推薦方法：使用 GitHub Releases

1. 訪問：https://github.com/sklonely/ClassNoteAI/releases/new
2. 填寫：
   - **Tag**: `v1.0`
   - **Title**: `Translation Models v1.0`
   - **Description**: `ONNX translation model for ClassNote AI`
3. **上傳文件**：將 `model_packages/opus-mt-en-zh-onnx.zip` 拖放到頁面
4. 點擊 **"Publish release"**

**注意**：GitHub Releases 支持大文件上傳，不受 100MB 限制！

## 🔗 倉庫信息

- **倉庫地址**：https://github.com/sklonely/ClassNoteAI
- **模型下載 URL**（上傳後）：
  https://github.com/sklonely/ClassNoteAI/releases/download/v1.0/opus-mt-en-zh-onnx.zip

## ✅ 完成後

1. 代碼已推送到 GitHub
2. 模型文件已上傳到 Releases
3. 用戶可以通過應用程序自動下載模型


