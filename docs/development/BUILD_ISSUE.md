# Tauri v2 打包問題說明

**更新日期**: 2024年12月

## 🔍 問題描述

在 macOS 上打包 Tauri v2 應用時，前端資源文件（`dist/` 目錄）沒有被自動複製到應用包的 `Resources` 目錄，導致應用無法啟動。

**錯誤信息**：
```
Launch failed. Error Domain=RBSRequestErrorDomain Code=5
Asset `` not found; fallback to index.html
```

## 📊 問題分析

### Tauri v2 的資源處理機制

1. **構建過程**：
   - Tauri 確實在構建過程中處理了前端文件
   - 文件被處理並存儲在 `target/release/build/.../out/tauri-codegen-assets/` 目錄
   - 文件經過哈希處理和編碼

2. **預期行為**：
   - Tauri v2 應該自動將前端文件複製到 bundle 的 `Resources` 目錄
   - 或者將資源嵌入到二進制文件中

3. **實際行為**：
   - 前端文件沒有被複製到 `Resources` 目錄
   - 資源嵌入可能失敗，導致應用找不到前端文件

### 可能的原因

1. **Tauri v2 的設計變更**：
   - Tauri v2 可能改變了資源處理方式
   - 從文件複製改為資源嵌入，但嵌入過程可能有問題

2. **配置問題**：
   - `frontendDist` 路徑配置可能不正確
   - 或者需要額外的配置選項

3. **已知 Bug**：
   - 這可能是 Tauri v2.9.x 的一個已知問題
   - 社區中可能有其他開發者遇到類似問題

## ✅ 解決方案

### 臨時解決方案（當前使用）

手動複製前端文件到應用包：

```bash
cp -r dist/* src-tauri/target/release/bundle/macos/classnoteai.app/Contents/Resources/
```

或使用修復腳本：

```bash
./fix_bundle.sh
```

### 永久解決方案

1. **使用打包腳本**：
   ```bash
   npm run tauri:build
   ```
   這個命令會自動執行修復步驟

2. **檢查 Tauri 更新**：
   - 關注 Tauri v2 的更新日誌
   - 查看是否有相關的 bug 修復

3. **報告問題**：
   - 如果確認是 Tauri 的 bug，可以在 GitHub 上報告
   - 提供詳細的重現步驟和環境信息

## 🔗 相關資源

- [Tauri v2 官方文檔](https://v2.tauri.app/)
- [Tauri GitHub Issues](https://github.com/tauri-apps/tauri/issues)
- [Tauri Discord 社區](https://discord.gg/tauri)

## 📝 結論

這**不是正常的行為**，但確實可能發生。可能的原因包括：

1. **Tauri v2 的資源處理機制變更**：從文件複製改為資源嵌入，但過程可能有問題
2. **配置不完整**：可能需要額外的配置選項
3. **已知 Bug**：可能是 Tauri v2.9.x 的一個已知問題

**建議**：
- 使用提供的修復腳本作為臨時解決方案
- 關注 Tauri 的更新，查看是否有相關修復
- 如果問題持續存在，考慮在 GitHub 上報告問題

---

**最後更新**: 2024年12月

