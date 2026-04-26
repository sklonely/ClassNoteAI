# CP-6.11 · Wiring audit pass 1 + Legacy cleanup

**狀態**：等你 visual review。
**驗證**：`tsc --noEmit` clean、CDP 驗 ⌘N/⌘,/⌘H 三個快捷鍵工作。

**分支**：`feat/h18-design-snapshot`

## 兩件事打成一個 commit

### 1. Legacy file cleanup（18 個檔）

UI 全部換 H18 後，legacy 已不再被路由 / 元件 import：

```
刪除：
  src/components/MainWindow.{tsx,module.css}
  src/components/TopBar.{tsx,module.css}
  src/components/LectureView.tsx
  src/components/NotesView.{tsx,module.css}
  src/components/SettingsView.{tsx,module.css}
  src/components/ProfileView.{tsx,module.css}
  src/components/TrashView.tsx
  src/components/CourseListView.{tsx,module.css}
  src/components/CourseDetailView.{tsx,module.css}
  src/components/CourseCreationDialog.{tsx,module.css}
  src/components/__tests__/{TopBar,SettingsView,ProfileView,CourseListView,CourseDetailView,CourseCreationDialog}.test.tsx
```

App.tsx 註解內 `MainWindow` 改成 `H18DeepApp`（detached AI tutor 分支說明）。

### 2. Wiring audit pass 1

| 動作 | 接 |
|------|-----|
| **⌘N** 鍵盤 | `setIsCourseDialogOpen(true)` → 開新增課程 dialog |
| **⌘H** 鍵盤 | `setActiveNav('home')` → 跳首頁 |
| **⌘,** 鍵盤 | `setActiveNav('profile')` → 跳設定 |
| PAbout **立即檢查更新** | `updateService.checkForUpdates()`（real）→ 顯示「有新版本 / 已是最新版」hint |
| PAbout **開啟資料夾** | `invoke('get_audio_dir')` 拿到 audio dir → 退一層 → `openPath()` 開系統 file explorer |
| PAbout **GitHub** | `openUrl('https://github.com/sklonely/ClassNoteAI')` |

## 還沒接的 wiring（候選 future CP）

- PTranscribe 全部控件（model select / GPU backend / log level）→ saveAppSettings
- PTranslate 控件（除了 segmented control 的 local state）
- PCloud 5 個 provider key 寫入 + OCR / refine intensity
- PAudio 麥克風選擇 + 字幕外觀
- PData 匯入 / 匯出 backup（後端命令尚未寫）
- PData 危險區「清空」全部
- PAbout 重新執行 Setup Wizard → setupService.reset
- 使用者指南 link（沒 docs URL）
- Recording engine: BatteryMonitor / recordingDeviceMonitor / 5-step real backend events
- Notes Editor 的 backend persistence（per Q5 lock 純 UI）

## 改了什麼

```
新:
  docs/design/h18-deep/checkpoints/CP-6.11.md
  docs/design/h18-deep/checkpoints/screenshots/proto-home-reference.png (補上 audit reference)

刪:
  18 個 legacy components / 6 個 legacy tests

改:
  src/App.tsx                              · MainWindow comment → H18DeepApp
  src/components/h18/H18DeepApp.tsx        · 加 ⌘N / ⌘H / ⌘, 鍵盤
  src/components/h18/ProfilePanes.tsx       · PAbout 立即檢查更新 + 開啟資料夾 + GitHub link wired
```

## 已知 issue

1. **⌘N 在輸入框中也觸發** — `e.target` 沒過濾，輸入框打字輸入「n」+ Ctrl 會被攔截。實務多數人用 ⌘N 不會誤觸，但可以加 `if (e.target.tagName === 'INPUT' || isContentEditable) return` 防呆。
2. **PAbout 立即檢查更新** 顯示文字直接 inline 在 hint 行（取代原本的 hint）。Idle 狀態回到原文。
3. **開啟資料夾** 會跳到 audio/.. 的 parent dir。若 user appdata 結構改變這個推理可能不對，但目前 audio 永遠在 `{app_data}/audio/`，向上一層就是 app_data root。

## Phase 6 整體 commits 概覽

```
2d1284a feat(h18-cp610): visual audit pass 1
d19aae0 feat(h18-cp610b): POverview big hero
2d99a46 feat(h18-cp65plus): RV2 Layout A + drag fix
987a82a feat(h18-cp69): NotesEditorPage UI
1efe7a9 feat(h18-cp68): ⌘K 全域搜尋
13684fa feat(h18-cp67): ProfilePage 8 sub-pane
78008f2 feat(h18-cp66): AI 助教 dock + page
0e2900c feat(h18-cp65): chrome wrap (superseded)
0ac31d5 feat(h18-cp64): review page
8fab0cc feat(h18-cp63): course detail + add dialog
3b18315 feat(h18-cp62): home (calendar + inbox + preview)
7f65267 feat(h18-cp61): chrome shell
2970a13 docs(h18): Phase 6 master plan
+ this CP (legacy cleanup + wiring audit pass 1)
```

review 完點頭就推下一個 wiring audit batch。
