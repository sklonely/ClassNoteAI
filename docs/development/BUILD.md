# 打包指南

**更新日期**: 2024年12月

## 📦 macOS 打包

### 快速打包

```bash
cd ClassNoteAI
npm run tauri:build
```

這個命令會：
1. 構建前端（`npm run build`）
2. 打包 Tauri 應用（`npm run tauri build`）
3. 自動修復前端資源文件（`./fix_bundle.sh`）

### 手動打包步驟

1. **構建前端**
   ```bash
   npm run build
   ```

2. **打包應用**
   ```bash
   npm run tauri build
   ```

3. **修復前端資源文件**（如果打包後前端文件缺失）
   ```bash
   ./fix_bundle.sh
   ```

### 打包輸出位置

- **macOS**: `src-tauri/target/release/bundle/macos/classnoteai.app`
- **DMG**: `src-tauri/target/release/bundle/dmg/`（如果成功）

### 已知問題

#### 問題：前端資源文件未被打包

**症狀**：
- 應用無法啟動
- 錯誤：`Launch failed` 或 `Error Domain=RBSRequestErrorDomain Code=5`

**原因**：
- Tauri v2 在某些情況下不會自動複製前端文件到應用包

**解決方案**：
1. 運行修復腳本：`./fix_bundle.sh`
2. 或手動複製：
   ```bash
   cp -r dist/* src-tauri/target/release/bundle/macos/classnoteai.app/Contents/Resources/
   ```

#### 問題：DMG 打包失敗

**症狀**：
- `.app` 文件成功創建，但 DMG 創建失敗

**解決方案**：
- 直接使用 `.app` 文件進行測試
- 如需 DMG，可以手動創建或使用第三方工具

### 測試打包的應用

```bash
# 方法 1: 使用 open 命令
open src-tauri/target/release/bundle/macos/classnoteai.app

# 方法 2: 雙擊 Finder 中的 .app 文件
```

### 如果遇到權限問題

如果 macOS 提示"無法打開，因為來自身份不明的開發者"：

```bash
# 移除隔離屬性
xattr -cr src-tauri/target/release/bundle/macos/classnoteai.app

# 或添加執行權限
chmod +x src-tauri/target/release/bundle/macos/classnoteai.app/Contents/MacOS/classnoteai
```

## 🔧 打包配置

### tauri.conf.json

關鍵配置：
- `build.frontendDist`: 前端構建輸出目錄（相對於 `src-tauri`）
- `build.beforeBuildCommand`: 打包前執行的命令
- `bundle.targets`: 打包目標平台

### 優化建議

1. **減小應用體積**：
   - 使用 `strip` 移除調試符號
   - 啟用 LTO（Link Time Optimization）

2. **代碼簽名**（生產環境）：
   - 配置 `bundle.macOS.signingIdentity`
   - 設置證書和授權

## 📝 相關文檔

- `../development/DEVELOPMENT.md` - 開發計劃
- `../ARCHITECTURE.md` - 項目架構

---

**最後更新**: 2024年12月

