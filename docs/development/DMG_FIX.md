# DMG 打包問題解決方案

**更新日期**: 2024年12月

## 🔍 問題描述

在構建 Tauri 應用時，DMG 打包失敗：

```
failed to bundle project error running bundle_dmg.sh
```

## ✅ 解決方案

### 方案 1: 跳過 DMG 打包（推薦用於開發）

修改 `src-tauri/tauri.conf.json`，將 `targets` 從 `"all"` 改為 `["app"]`：

```json
{
  "bundle": {
    "active": true,
    "targets": ["app"],  // 只構建 .app，跳過 DMG
    ...
  }
}
```

**優點**：
- ✅ 構建更快
- ✅ 避免 DMG 打包錯誤
- ✅ `.app` 文件可以直接使用

**缺點**：
- ❌ 不會生成 DMG 文件（分發時需要手動創建）

### 方案 2: 修復 DMG 打包

DMG 打包失敗通常是因為 `create-dmg` 工具的問題。可以：

1. **檢查 create-dmg 是否安裝**：
   ```bash
   which create-dmg
   ```

2. **安裝 create-dmg**（如果未安裝）：
   ```bash
   brew install create-dmg
   ```

3. **手動創建 DMG**（如果需要）：
   ```bash
   # 創建臨時目錄
   mkdir -p /tmp/dmg_build
   
   # 複製應用
   cp -R src-tauri/target/debug/bundle/macos/classnoteai.app /tmp/dmg_build/
   
   # 創建 DMG
   hdiutil create -volname "ClassNote AI" \
     -srcfolder /tmp/dmg_build \
     -ov -format UDZO \
     classnoteai_0.1.0_aarch64.dmg
   ```

## 📝 當前配置

**已更新配置**：`targets` 已設置為 `["app"]`，跳過 DMG 打包。

## 🎯 使用建議

### 開發階段
- 使用 `targets: ["app"]` - 只構建 `.app` 文件
- 直接使用 `.app` 文件進行測試

### 分發階段
- 如果需要 DMG，可以：
  1. 手動創建 DMG（使用 `hdiutil`）
  2. 或使用第三方工具（如 `create-dmg`）
  3. 或恢復 `targets: "all"` 並修復 `create-dmg` 問題

## ⚠️ 注意事項

1. **DMG 不是必需的**：`.app` 文件可以直接運行和分發
2. **DMG 僅用於分發**：提供更好的用戶體驗（拖放安裝）
3. **本地測試不需要 DMG**：直接使用 `.app` 文件即可

## 🔗 相關資源

- [Tauri Bundle Configuration](https://v2.tauri.app/develop/bundling/)
- [macOS DMG Creation](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFBundles/BundleTypes/BundleTypes.html)

---

**最後更新**: 2024年12月

