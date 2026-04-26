# H18 Deep · ClassNoteAI v0.7.0 UI Design

這是 v0.7.0 alpha UI 大改的設計依據。**純 HTML/CSS/JSX prototype**（不是要編進 React app 的源碼），用來在實作前先讓所有人看到 / 操作 / 對齊視覺與互動。

實際移植到 `src/components/` 時，要把這些 prototype 用 React + TS + Tailwind 重寫，但**視覺、互動、動畫、token 系統照搬**。

---

## 怎麼跑

```bash
node server.js
# → http://127.0.0.1:5173/
```

預設打開 `Home H18 Deep.html`，是主應用。其他入口：
- `Setup Wizard.html` — 初次設置精靈 (10 step)
- `Login.html` — 登入頁
- `Notes Editor.html` — 筆記編輯器（doc / canvas / split 三模式）
- `Home Directions*.html` — 早期探索版本（有興趣可看）

## 設計來源

`Home H18 Deep` 是從 [claude.ai/design](https://claude.ai/design) 匯出的設計 bundle，再加上對齊真實後端的修正、跟我們自己擴充的元件。

設計 git 倉庫：`C:/Users/asd19/claude_web_design`（含完整迭代歷史）

---

## 檔案組成

### 核心 (來自 claude.ai/design)

| 檔案 | 內容 |
|---|---|
| `h18-theme.jsx` | `H18_THEMES` light / dark token 物件 + `h18Accent` / `h18CourseText` helpers |
| `h18-parts.jsx` | `H18TopBar` (含 traffic lights + TaskIndicator slot) / `H18Rail` / `H18Calendar` / `H18Breadcrumb` / `H18WindowControls` |
| `h18-app.jsx` | `H18DeepApp` (root 元件 + tweaks state + layout 派發 + 各 overlay mount) |
| `h18-inbox-preview.jsx` | `H18Inbox` / `H18InboxRow` / `H18Preview` |
| `h18-nav-pages.jsx` | `SearchOverlay` (⌘K) / `CourseDetailPage` / `AIPage` / `AddCourseDialog` / `ProfilePage` (含 8 sub-pane: Overview/本地轉錄/翻譯/雲端AI/介面與顯示/音訊/資料/關於) |
| `h18-aidock-recording.jsx` | `AIDock` (⌘J 浮動 AI) |
| `h18-recording-v2.jsx` | `RecordingPage` (3 layouts) + `RV2FloatingNotes` + `RV2FinishingOverlay` (5 步驟結束過場) |
| `h18-review-page.jsx` | `ReviewPage` (3 欄: TOC / 逐字稿 / Tabs notes·exam·summary) + `RVBilink` (concept hover tooltip) + `RVMarkdown` + `H18AudioPlayer` (底部 52px player) |
| `h18-notes-editor.jsx` | `NotesEditorPage` (doc / canvas / split 三模式) + iPad mirror floater + LaTeX equation block |

### 我們擴充的 conditional UI (extras-*)

| 檔案 | 元件 | 對應真實程式 |
|---|---|---|
| `extras-toast.jsx` | `H18ToastContainer` (card + typewriter 雙風格) + countdown bar | `services/toastService.ts` + `components/ToastContainer.tsx` |
| `extras-confirm.jsx` | `H18ConfirmDialog` (一般/danger 兩 kind, ESC/Enter) | `services/confirmService.ts` + `components/ConfirmDialog.tsx` |
| `extras-task-indicator.jsx` | `H18TaskIndicator` (top bar 小膠囊 + dropdown panel) | `components/TaskIndicator.tsx` + `services/offlineQueueService.ts` |
| `extras-setup-wizard.jsx` | `SetupWizardApp` (10 step + traffic lights + 主題切換) | `components/SetupWizard.tsx` |
| `extras-login.jsx` | `LoginApp` (單欄位 username + 本機優先承諾) | `components/LoginScreen.tsx` |
| `extras-recovery.jsx` | `H18RecoveryPrompt` (全螢幕 modal + 多 session 個別處理) | `components/RecoveryPromptModal.tsx` + `services/recordingRecoveryService.ts` |
| `extras-error-fallback.jsx` | `H18ErrorFallback` (全螢幕 fallback UI) | `components/ErrorBoundary.tsx` |
| `extras-oauth.jsx` | `H18UnofficialChannelWarning` + `H18OauthFlowModal` (3 階段狀態機) | `components/UnofficialChannelWarning.tsx` + ChatGPT OAuth flow |
| `extras-video-pip.jsx` | `H18VideoPiP` (浮動可拖曳/縮放 320×180 視窗) | `components/VideoPiP.tsx` |
| `extras-alignment-banner.jsx` | `H18AlignmentBanner` (頂部 pill + 8s 倒數) | `services/autoAlignmentService.ts` |

### 入口 HTML

- `Home H18 Deep.html` — 主應用 (含全部上述元件)
- `Setup Wizard.html` / `Login.html` / `Notes Editor.html` — 各自獨立入口

### 其他

- `home-v2-*.jsx` / `home-v3-*.jsx` / `home-v4-*.jsx` — Claude Design 早期探索的首頁版本（Tufte / Swiss / 雜誌 等多風格），保留參考但 **H18 Deep 是定案版本**
- `_check/` `uploads/` — Claude Design 對話過程的截圖 / 上傳，可忽略

---

## 怎麼把這個移植到 React app

### Token 系統先搬

`H18_THEMES` 兩個物件 (light / dark) 全部換成 CSS variables 注入到 `:root` / `:root.dark`。Tailwind config 從這些變數讀。所有元件用 `var(--h18-text)` 等，自動跟著主題切。

### 元件要轉的東西

prototype 用法 → React/TS/Tailwind 用法：

| Prototype | Real |
|---|---|
| inline `style={{...}}` (含 T tokens) | Tailwind class + CSS vars (`text-[var(--h18-text)]` 或 預設 design tokens) |
| `window.h18Toast({...})` Manager | `useToast()` hook + provider |
| `window.h18Confirm({...}) → Promise` | `useConfirm()` hook |
| `Object.assign(window, {...})` 全域曝露 | 正常 ES module export / import |
| Babel-standalone in `.html` | 已經是 Vite + tsx，直接寫 |
| 固定 1440×900 letterbox 畫布 | 響應式（要重 review 各 layout 的 breakpoint） |

### 視覺保留的東西

- 所有色卡（H18_THEMES light / dark）
- 所有字體層級（Inter / JetBrains Mono / Noto Sans TC + Fraunces 已載入）
- 所有動畫曲線（iOS spring `cubic-bezier(0.32, 0.72, 0, 1)`）
- 所有間距/圓角（border-radius 6/8/12/14, padding 12/14/16/24）
- 所有 chrome（traffic lights / window controls / progress bars）

### 對齊真實後端的部分（已 hardcode 在 prototype）

- Whisper → **Parakeet INT8 / FP32**
- ONNX 翻譯 → **TranslateGemma 4B + llama-server sidecar**
- AI Provider 5 個（GitHub Models / ChatGPT OAuth / Anthropic / OpenAI / Gemini）
- ProfilePage 8 個 sub-pane 對齊 SettingsView 的 7 + Profile

---

## 設計 spec 速覽

打開 `Home H18 Deep.html` → 進 Profile (左下頭像) → 「**關於與更新** → **開發者預覽**」section，有 ~12 個觸發按鈕，可一次體驗所有 conditional UI（toast 各種變體 / confirm / task indicator / recovery / error / OAuth / VideoPiP / alignment banner 等）。

主題切換：右上方 `☾` 按鈕，或 `⌘\\`。
