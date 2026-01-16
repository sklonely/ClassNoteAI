---
name: Release Process
description: How to release a new version of ClassNoteAI with CI/CD auto-build and updater support
---

# ClassNoteAI 發布流程

## 概述

本項目使用 **GitHub Actions** 自動構建，搭配 **Tauri Updater** 實現應用內自動更新。

---

## 關鍵文件

| 文件 | 用途 |
| :-- | :-- |
| `ClassNoteAI/src-tauri/tauri.conf.json` | 版本號、Updater 配置 |
| `ClassNoteAI/package.json` | npm 版本號 (需同步更新) |
| `.github/workflows/release-macos.yml` | macOS CI/CD 工作流 |
| `ClassNoteAI/src/services/updateService.ts` | 客戶端更新邏輯 |

---

## 最佳實踐：Release Notes

為了確保自動生成的 Release Notes 清晰易讀，建議：

1. **使用 Pull Requests**：盡量透過 PR 合併代碼，PR 標題將成為 Release Notes 的條目。
2. **使用 Label 分類**：GitHub 會根據 Label (如 `enhancement`, `bug`, `documentation`) 自動分類變更。
3. **Commit 訊息清晰**：如果直接 Push 到 main，Commit 訊息將被列出。

---

## 發布步驟

### 1. 更新版本號

> [!CAUTION]
> **必須同時更新以下三處，版本號必須一致！**

| 文件 | 位置 | 範例 |
| :-- | :-- | :-- |
| `ClassNoteAI/src-tauri/tauri.conf.json` | L4 | `"version": "0.3.0"` |
| `ClassNoteAI/package.json` | L4 | `"version": "0.3.0"` |
| `ClassNoteAI/src-tauri/Cargo.toml` | L3 | `version = "0.3.0"` |

**快速查找命令：**
```bash
grep -n '"version"' ClassNoteAI/src-tauri/tauri.conf.json ClassNoteAI/package.json
grep -n '^version' ClassNoteAI/src-tauri/Cargo.toml
```

### 2. 提交並推送

```bash
git add -A
git commit -m "vX.Y.Z: 版本描述

變更說明..."
```

### 3. 創建並推送 Tag

```bash
git tag vX.Y.Z
git push origin main --tags
```

### 4. CI/CD 自動執行

推送 tag 後，GitHub Actions 自動：

1. Checkout 代碼
2. 安裝 Node.js + Rust
3. `npm ci` 安裝依賴
4. `npm run tauri build --target aarch64-apple-darwin`
5. 生成 `latest.json` (含簽名)
6. 創建 GitHub Release，上傳：
   - `ClassNoteAI_X.Y.Z_aarch64.dmg`
   - `ClassNoteAI_X.Y.Z_aarch64.app.tar.gz`
   - `latest.json`
7. **自動生成 Release Notes**：根據 Merged PRs 和 Commits 生成「What's Changed」清單。

### 5. 驗證發布

1. 檢查 GitHub Actions: `https://github.com/sklonely/ClassNoteAI/actions`
2. 檢查 Release: `https://github.com/sklonely/ClassNoteAI/releases`
3. 確認 `latest.json` 已上傳

---

## Updater 配置

### tauri.conf.json

```json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "endpoints": [
        "https://github.com/sklonely/ClassNoteAI/releases/latest/download/latest.json"
      ]
    }
  }
}
```

### latest.json 結構

CI/CD 自動生成：

```json
{
  "version": "X.Y.Z",
  "notes": "ClassNoteAI X.Y.Z 更新",
  "pub_date": "2026-01-15T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/sklonely/ClassNoteAI/releases/download/vX.Y.Z/ClassNoteAI_X.Y.Z_aarch64.app.tar.gz"
    }
  }
}
```

---

## 用戶更新流程

```
舊版 App 啟動
       ↓
updateService.checkForUpdates()
       ↓
請求 latest.json
       ↓
比較版本號
       ↓
顯示更新提示
       ↓
用戶點擊「更新」
       ↓
downloadAndInstall()
       ↓
下載 → 驗證簽名 → 安裝 → relaunch
```

---

## 破壞性更新處理

對於包含 Schema 變更的版本：

1. **SQLite 遷移**：使用 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` (自動處理)
2. **localStorage 遷移**：在首次啟動時檢測並遷移 (如 chatSessionService)
3. **記錄版本號**：可選在 Settings 表記錄 `db.schema_version`

---

## GitHub Secrets 配置

| Secret | 用途 |
| :-- | :-- |
| `TAURI_SIGNING_PRIVATE_KEY` | 更新包簽名私鑰 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私鑰密碼 |

---

## 常見問題

### Q: CI 構建失敗？
A: 檢查 GitHub Actions logs，常見原因：
- Rust 編譯錯誤
- npm 依賴問題
- 簽名密鑰未配置

### Q: 用戶無法收到更新？
A: 確認：
1. `latest.json` 已上傳到 Release
2. 版本號正確 (新版 > 舊版)
3. `endpoints` URL 正確

### Q: Windows 版本？
A: 目前禁用 (`.github/workflows/release-windows.yml.disabled`)，需要時改名為 `.yml` 並啟用
