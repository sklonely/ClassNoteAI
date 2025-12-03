# 上傳模型到 GitHub Releases 指南

## 📋 快速步驟

### 1. 準備模型文件

模型文件已打包完成：
- `model_packages/opus-mt-en-zh-onnx.zip` (512MB)

### 2. 創建 GitHub Release

1. 訪問：https://github.com/sklonely/ClassNoteAI/releases/new
2. 填寫信息：
   - **Tag version**: `v1.0`
   - **Release title**: `Translation Models v1.0`
   - **Description**: 
     ```
     ONNX translation model for ClassNote AI application.
     
     Model: opus-mt-en-zh-onnx (~512MB)
     - Optimized for English to Chinese translation
     - Fast response time
     - High accuracy
     ```
3. 上傳文件：
   - 將 `model_packages/opus-mt-en-zh-onnx.zip` 拖放到頁面
4. 點擊 **"Publish release"**

### 3. 驗證下載 URL

上傳完成後，驗證 URL 是否可訪問：

```bash
curl -I https://github.com/sklonely/ClassNoteAI/releases/download/v1.0/opus-mt-en-zh-onnx.zip
```

應該返回 `HTTP/2 302` 或 `HTTP/2 200`。

## 🔗 Release URL

創建完成後，Release 地址將是：
https://github.com/sklonely/ClassNoteAI/releases/tag/v1.0

## ✅ 完成後

模型上傳完成後，用戶就可以：
1. 打開應用設置頁面
2. 選擇 "Opus-MT (英文→中文)"
3. 點擊 "下載模型"
4. 程序會自動從 GitHub Releases 下載並解壓模型

## 📝 注意事項

- GitHub 單個文件限制：100MB（超過需要 Git LFS）
- 我們的模型文件是 512MB，超過了限制
- **解決方案**：需要使用 Git LFS 或分片上傳

### 使用 Git LFS（推薦）

```bash
# 安裝 Git LFS
brew install git-lfs  # macOS
# 或從 https://git-lfs.github.com/ 下載

# 初始化 Git LFS
cd /Users/remote_sklonely/eduTranslate
git lfs install

# 追蹤 ZIP 文件
git lfs track "*.zip"
git add .gitattributes

# 添加模型文件
git add model_packages/opus-mt-en-zh-onnx.zip
git commit -m "Add translation model via Git LFS"
git push origin main
```

然後在 Release 中引用這個文件。

### 或使用雲存儲

如果 Git LFS 不方便，可以：
1. 上傳到雲存儲（AWS S3, Google Cloud Storage 等）
2. 更新 `download.rs` 中的 URL

