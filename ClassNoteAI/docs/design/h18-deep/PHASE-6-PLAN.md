# Phase 6 · H18 真重寫 (v0.7.0-alpha 重啟)

**狀態**：等使用者 review + approve 整體方向後才開始 commit code。

**為什麼有這份 plan**：
- 原 V0.7.0-PLAN.md L313 寫「**不要重寫**，只**換視覺**：把 inline className 改成 H18 token」
- CP-3 ~ CP-5 完成「只換視覺」後，使用者反映「整個骨架都沒變化，它還是我們之前的那一個樣子，只是顏色變了而已」
- 使用者目標 = **整個跟 H18 Design 完全一致，只是功能接到我們的後端**
- 所以原 plan「只換視覺」這條 trade-off 失效，要重新定義 Phase 6 = 真重寫骨架 + IA + 頁面結構

---

## 1 · 結構性差距總覽

H18 prototype 的 IA 跟現在差遠了，不是 token 級可以解的。

### H18 應用模型（從 `h18-app.jsx` + `h18-parts.jsx` 讀出來的）

```
H18DeepApp (root)
├── H18TopBar  (traffic lights | logo "C" | Inbox count | datetime | ⌘K search bar | 錄音 button | TaskIndicator)
└── H18Layout  (grid: 62px Rail | 1fr Main, gap 1px = T.border)
    ├── H18Rail  (left vertical icons)
    │   ├── ⌂ Home         (active='home')
    │   ├── ▤ 知識庫       (active='notes' → NotesEditorPage)
    │   ├── divider
    │   ├── [course chips]  (active='course:{id}', 漸層方塊 + 未複習數 badge)
    │   ├── + 新增          (active='add')
    │   ├── flex-1
    │   ├── ✦ AI 助教       (active='ai' → AIPage)
    │   └── 👤 Profile     (active='profile' → ProfilePage)
    └── H18MainContent  (router by activeNav)
        ├── HomeLayout (3 variants A/B/C 由 tweaks.layout 控制)
        │   ├── A: 上 Calendar 280px + 下 Inbox 列表 | 右 380px Preview
        │   ├── B: 左 Inbox 列表 | 右 Calendar 260px + Preview
        │   └── C: 左 Calendar 大 | 右 440px Inbox
        ├── CourseDetailPage
        ├── RecordingPage   (3 layouts A/B/C + FloatingNotes + FinishingOverlay 5 步)
        ├── ReviewPage      (3 columns: TOC | 逐字稿 | Tabs notes/exam/summary)
        ├── AIPage          (全螢幕 AI 對話)
        ├── NotesEditorPage (doc / canvas / split 三模式 + iPad mirror)
        └── ProfilePage     (8 sub-panes: Overview + 7 Settings)

Floating overlays (從任一 page 都會 mount)：
├── AIDock          (⌘J 浮動 AI 小窗，跟 AIPage 不同)
├── SearchOverlay   (⌘K command palette)
├── ToastContainer
├── ConfirmDialog
├── TaskIndicator dropdown
├── VideoPiP
├── AlignmentBanner
├── RecoveryPromptModal
└── ErrorFallback
```

### 現在的應用模型

```
MainWindow
├── TopBar  (中央：上課/設置 nav，沒有 rail 也沒有 search)
└── <main>  (stack 顯示一個 view)
    ├── CourseListView      (3-col card grid 當作 home — 沒有 inbox / calendar)
    ├── CourseDetailView    (麵包屑 + 1/2 col)
    ├── NotesView           (PDF | transcript split + 內部 mode 切換 review/recording)
    ├── SettingsView        (overlay, 8 sub-panes)
    ├── ProfileView         (overlay, 簡單 user card)
    └── TrashView           (overlay)
```

### 8 個 fundamental IA 差距

| # | H18 | 現在 |
|---|---|---|
| 1 | 左側 **icon rail** 是主導覽 | TopBar 中央 nav |
| 2 | Home = **Inbox + Calendar + Preview** | Home = courses grid |
| 3 | **NotesEditor** 是獨立「知識庫」頁面 | 沒這頁 |
| 4 | **AIPage** (全螢幕) + **AIDock** (浮動 ⌘J) 兩種 | 只有 AIChatPanel 浮動 |
| 5 | **ProfilePage 內含 Settings 7 sub-panes** | Profile 跟 Settings 是分開的 overlay |
| 6 | **Recording 跟 Review 是兩個獨立 page** | NotesView 內部 mode 切換 |
| 7 | **⌘K SearchOverlay** 全域搜尋 | 沒有 |
| 8 | 課程切換 = 點 rail 上的 course chip | 必須回 Home → 點卡片 |

---

## 2 · 頁面 Inventory（H18 vs 現在）

### A · 全新建（H18 有，現在完全沒有）

| H18 元件 | 來源 | 對應後端 / 資料 | 風險 |
|----------|------|-----------------|------|
| `H18Rail` | h18-parts.jsx L106-161 | activeNav state → React Router | 低，純 UI |
| `H18Inbox` + `H18InboxRow` | h18-inbox-preview.jsx | **需要新 schema**：reminders table (作業/老師說/公告/成績/小考/待辦/到期) | **中**，要決定 reminders 怎麼進 DB |
| `H18Preview` | h18-inbox-preview.jsx | 從 selected course → syllabus / next lecture | 低 |
| `H18Calendar` | h18-parts.jsx L163+ | **需要新 schema**：calendar_events table (week-of-N events with time/duration/course) | **中**，要決定 events 怎麼產生（手動 / from syllabus / iCal import） |
| `SearchOverlay` (⌘K) | h18-nav-pages.jsx L27 | 全域搜尋：notes + courses + 語音片段 | **中**，需要重用 RAG 或建 minisearch index |
| `AIDock` (⌘J 浮動) | h18-aidock-recording.jsx | 重用 AIChatPanel logic | 低 |
| `AIPage` (全螢幕) | h18-nav-pages.jsx L604 | 重用 chatStream + RAG | 低 |
| `NotesEditorPage` | h18-notes-editor.jsx | **需要新功能**：doc/canvas/split 編輯器 + iPad mirror + LaTeX | **高**，這是新 feature 不只是新 UI |
| `H18OauthFlowModal` | extras-oauth.jsx 後半段 | 現在 OAuth 開 system browser，沒 in-app 進度 modal | 低（可選） |

### B · 重寫（現在有但結構完全不同）

| 現在 | → H18 對應 | Plan tag |
|------|-----------|---------|
| `MainWindow.tsx` | `H18DeepApp` (h18-app.jsx) | P6.1 chrome |
| `TopBar` (within MainWindow) | `H18TopBar` (h18-parts.jsx) | P6.1 chrome |
| `CourseListView.tsx` | 整片殺，併進 `HomeLayout` (h18-app.jsx) | P6.2 home |
| `CourseDetailView.tsx` | `CourseDetailPage` (h18-nav-pages.jsx L283) | P6.3 course |
| `NotesView.tsx` (review mode) | `ReviewPage` (h18-review-page.jsx L436) | P6.4 review |
| `NotesView.tsx` (recording mode) | `RecordingPage` (h18-recording-v2.jsx L549) + `RV2FinishingOverlay` (5-step 結束過場) | P6.5 recording |
| `AIChatPanel.tsx` (floating) | `AIDock` (h18-aidock-recording.jsx) | P6.6 ai |
| `AIChatWindow.tsx` (detached) | `AIPage` (h18-nav-pages.jsx L604) full-screen | P6.6 ai |
| `SettingsView.tsx` + 8 sub-panels | `ProfilePage` 內 7 settings sub-panes (h18-nav-pages.jsx L990+) | P6.7 settings |
| `ProfileView.tsx` | `ProfilePage Overview` = `POverviewA` (h18-nav-pages.jsx L1248) | P6.7 settings |
| `CourseCreationDialog.tsx` | `AddCourseDialog` (h18-nav-pages.jsx L774) | P6.3 course |
| `TrashView.tsx` | 殺，併進 ProfilePage 內 PData section | P6.7 settings |

### C · 留著（CP-1 ~ CP-4 已 H18 化，沒結構問題）

- `LoginScreen.tsx` ✓
- `SetupWizard.tsx` ✓
- `ToastContainer.tsx` ✓
- `ConfirmDialog.tsx` ✓
- `TaskIndicator.tsx` ✓
- `WindowControls.tsx` ✓ (mount 待 P6.1 翻 decorations)
- `RecoveryPromptModal.tsx` ✓
- `ErrorBoundary.tsx` ✓
- `UnofficialChannelWarning.tsx` ✓
- `VideoPiP.tsx` ✓
- `AlignmentBanner.tsx` ✓
- 所有 module CSS + tokens.css + tokens.ts 系統 ✓

### D · 暫不做（per H18 README + V0.7.0-PLAN L320-330）

- `RVBilink concept hover tooltips` (需要 concept extraction 後端)
- `iPad mirror` (NotesEditor 內的浮動 iPad — 需要設備同步)
- `POverview B/C/D variants` (先 A 就好)
- `RV2LayoutB/C` (RecordingPage 三 layout 中的 B/C — 先做 A 就好)
- `Inbox sources` 中 `NTU COOL` 這個來源（需要 LMS 整合）

---

## 3 · 架構先決條件（必須先解決）

### 3.1 Schema 新增

**reminders table**（給 H18Inbox）
```sql
CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    course_id TEXT,            -- FK courses
    type TEXT,                 -- 'hw'|'say'|'ann'|'grade'|'quiz'|'todo'|'due'
    title TEXT,
    detail TEXT,
    icon TEXT,
    urgency TEXT,              -- 'high'|'medium'|'low'
    when_str TEXT,             -- '今天 22:00' / '週日 23:59' (display string)
    when_at INTEGER,           -- unix epoch for sorting
    source TEXT,               -- 'L13' / 'AI' / 'manual' / 'NTU COOL'
    resolved INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
);
```

reminders 怎麼產生？三條路（要決定）：
- **A. 純手動**：使用者自己加，最 MVP
- **B. AI 自動**：從 transcript / lecture summary 偵測「老師說 HW3 週日截止」→ 自動建
- **C. 混合**：A + B

**calendar_events table**（給 H18Calendar week view）
```sql
CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    course_id TEXT,            -- FK courses
    title TEXT,                -- 'L14 · Multi-Head Attention'
    weekday INTEGER,           -- 1..7
    start_hour REAL,           -- 14.0 = 14:00
    duration_h REAL,           -- 1.5 = 90 min
    is_recurring INTEGER,
    -- ... 跟 syllabus_info.time 對應
);
```

calendar_events 怎麼產生？
- **A. 從 course.syllabus_info.time 推**（已有，e.g. "週一 14:00-15:30" → 自動產生 weekly recurring event）
- **B. iCal import** (defer 到 v0.8)
- **C. 手動加**

建議 **3.1 → 都從 A 起步**：reminders 純手動 + calendar 從 syllabus 推。讓 UI 先做完，後端 schema 加最小可動。

### 3.2 全域搜尋 index

⌘K SearchOverlay 要搜：notes + courses + 語音片段。

**現有可用**：
- minisearch (npm) 已裝，CourseListView 沒在用，可拿來建索引
- ragService 已 index lectures (內含 PDF 文字 + 字幕)，但 per-lecture 不是全域

**建議**：建 `globalSearchService.ts`：
- 啟動時讀 storageService.listCourses() + listLectures() + 對每 lecture 從 RAG store 撈摘要 → 建 minisearch index
- ⌘K 開時 query 即時
- 不重做 RAG（per-lecture chat）

### 3.3 Tauri decorations flip + WindowControls mount

H18 設計用 **traffic lights + 自畫 chrome**，不用 Windows native title bar。

- `tauri.conf.json` → `decorations: false`
- `WindowControls` 元件已就緒 (CP-1)，要 mount 進 H18TopBar 左側
- macOS 注意：原生 traffic lights 在左上角，要不要保留？建議**全平台一致用我們自畫的**

風險：使用者反饋「拖不動視窗」→ 必須在 outer container 加 `data-tauri-drag-region`，testing 要做。

### 3.4 Layout 變體選擇

H18 提供：
- **HomeLayout A/B/C** (3 種 home 配置)
- **RecordingPage Layout A/B/C** (3 種錄音配置)
- **POverviewA/B/C/D** (4 種 profile 變體 — README + plan 都說先做 A)

要鎖定一個預設，使用者後續可以改 settings → 介面與顯示 → 主頁佈局 / 錄音佈局。

**建議預設**：
- HomeLayout = **A** (左 Calendar 上 / Inbox 下 + 右 Preview)
- RecordingPage = **A** (per plan L308)
- POverview = **A** (per plan L329)

---

## 4 · Phase 6 sub-phases (sequenced commits)

每個 sub-phase 對應一個 CP，做完寫 walkthrough 等使用者 review 才推下一個。**不再用 Phase 5 那種「一口氣推完」**。

### P6.0 · Foundation: Schema + Routing 改 (1 CP)

- 新增 reminders / calendar_events table + storageService API
- React Router 加 activeNav state machine (home / notes / course:id / recording:id / review:id:n / ai / profile / add)
- `App.tsx` 改成 dispatch 結構（暫時 fallback 到舊 components）
- 不動現有 UI

**驗證**：vitest tests for storage CRUD，現有 UI 完全不破

### P6.1 · Chrome: H18TopBar + H18Rail + H18DeepApp shell (1 CP)

- 新 `H18TopBar.tsx` (取代 MainWindow header) — 含 search ⌘K trigger + 錄音 button + TaskIndicator + WindowControls mount
- 新 `H18Rail.tsx` (左 62px icon rail，dynamic course chips from storageService)
- 新 `H18DeepApp.tsx` 取代 MainWindow router
- `tauri.conf.json` decorations: false + drag region
- 舊 MainWindow 退場（保留 git history）

**驗證**：所有現有 view (CourseListView / CourseDetailView / etc.) 從 rail 點得到、視窗拖得動、traffic lights 點得開關

### P6.2 · Home: HomeLayout + H18Inbox + H18Calendar + H18Preview (2 CPs)

- P6.2a: H18Inbox + reminders 純手動 CRUD
- P6.2b: H18Calendar + 從 syllabus 推 events + H18Preview
- HomeLayout A 變體（先一個）
- CourseListView 退場

**驗證**：home 看起來真的不一樣了；可加 reminder、可看 calendar、選 reminder 跳對應 course

### P6.3 · Course: CourseDetailPage + AddCourseDialog (1 CP)

- 重寫 `CourseDetailPage` per h18-nav-pages.jsx L283
- 重寫 `AddCourseDialog` per L774
- 舊 CourseDetailView + CourseCreationDialog 退場

**驗證**：所有 course CRUD + 課堂列表都 work，CourseCreationDialog 的 PDF/AI 生成大綱 flow 沒破

### P6.4 · Review: ReviewPage 3 columns (1 CP)

- 新 `ReviewPage.tsx` per h18-review-page.jsx L436
- 三欄：左 TOC (從 lecture summary 章節抽) | 中逐字稿 + bilink (no concept hover, plain text) | 右 Tabs (notes / exam / summary)
- 底部 H18AudioPlayer (52px)
- NotesView review mode 退場（先保留 recording 模式）
- 不做：bilink concept hover（defer per plan）

**驗證**：review mode 點得進 lecture，audio 播得出，summary 生得出，notes 編輯得了

### P6.5 · Recording: RecordingPage + FinishingOverlay (1 CP)

- 新 `RecordingPage.tsx` per h18-recording-v2.jsx L549
- Layout A only（投影片大 + 右下 transcript stream）
- `RV2FinishingOverlay` (5-step 結束過場：transcribe / segment / summary / index / done)
- `RV2FloatingNotes` 浮動筆記 panel
- NotesView recording mode 退場

**驗證**：recording state machine 沒破（start/pause/stop/resume）、字幕 stream、auto-follow、結束自動跳 review

### P6.6 · AI: AIDock + AIPage (1 CP)

- 新 `AIDock.tsx` 取代 AIChatPanel floating mode (⌘J 觸發)
- 新 `AIPage.tsx` 取代 AIChatWindow detached mode (從 rail ✦ 進)
- 共用 chatStream + RAG service
- AIChatPanel + AIChatWindow 退場

**驗證**：⌘J 開浮動、rail ✦ 進全螢幕、對話歷史共用

### P6.7 · Settings: ProfilePage 8 sub-panes (2 CPs)

- P6.7a: ProfilePage shell + Overview (POverviewA — 成就計數 hero + 登出)
- P6.7b: 其它 7 sub-panes (PTranscribe / PTranslate / PCloud / PAppearance / PAudio / PData / PAbout) — 全部 inline 在 ProfilePage 內
- TrashView 併進 PData section
- SettingsView + 8 sub-panel + ProfileView 退場

**驗證**：所有 settings 還能改，數據還能 export/import，trash 還能 restore

### P6.8 · Search: SearchOverlay ⌘K (1 CP)

- 新 `globalSearchService.ts` (minisearch-based)
- 新 `SearchOverlay.tsx` per h18-nav-pages.jsx L27
- 鍵盤 ⌘K 觸發
- 結果跳對應 course / lecture / note

**驗證**：⌘K 開、輸入有結果、Enter 跳得對

### P6.9 · NotesEditor: NotesEditorPage (擴展，optional) (1 CP)

- 新 `NotesEditorPage.tsx` per h18-notes-editor.jsx
- doc / canvas / split 三模式
- LaTeX equation block (KaTeX)
- iPad mirror 不做（defer）

**risk**：這是 **新 feature**，不只是新 UI。要先決定要不要做。如果 v0.7.0 不上，rail 上的 ▤ 知識庫就不要 link。

---

## 5 · 開放問題 — 需要使用者決定

下列要使用者點頭才能往下走：

### Q1 · Schema：reminders 怎麼產生
- [A] 純手動  
- [B] AI 自動偵測 transcript 關鍵字  
- [C] 混合  
**建議**：A 起步，v0.7.x 逐步加 B

### Q2 · Schema：calendar events 怎麼產生
- [A] 從 syllabus.time 字串推  
- [B] iCal import  
- [C] 手動  
**建議**：A 起步

### Q3 · Tauri decorations flip
- [A] 全平台用我們自畫的 traffic lights  
- [B] macOS 用原生、Windows 用我們的  
- [C] 不 flip，先 keep native chrome  
**建議**：A（最簡 + 跨平台一致）

### Q4 · Layout 預設
- HomeLayout 預設用 **A / B / C**？
- RecordingPage 預設用 **A**（其它 defer）？
- POverview 預設用 **A**（其它 defer）？
**建議**：A / A / A

### Q5 · NotesEditorPage (P6.9) 要不要做
- [Y] 要 — rail 上的 ▤ 知識庫 link 過去；新 feature scope，可能 +1 週
- [N] 不要 — rail 上 ▤ 隱藏，defer 到 v0.8
**建議**：N（先讓 Phase 6 收束，不擴 scope）

### Q6 · TrashView 要不要保留現有形式
- [A] 殺 → 併進 ProfilePage → PData section
- [B] 留 → 從 ProfilePage 點進去開新 page
**建議**：A（IA 比較乾淨）

### Q7 · 既有資料 migration
- 現有 user 升級到 v0.7.0：
  - reminders / calendar_events 表是空的 → home 有 inbox 但 inbox 空
  - 是否要寫一次性 migration 從現有 lectures 自動產生 calendar_events？
**建議**：要寫 — 否則使用者升級後 home 看起來空蕩蕩

### Q8 · CP-3 ~ CP-5 的 module CSS 要保留嗎
這些 CSS 是針對舊骨架寫的：
- `MainWindow.module.css` → P6.1 整片重寫
- `CourseListView.module.css` → P6.2 整片刪
- `CourseDetailView.module.css` → P6.3 整片重寫
- `NotesView.module.css` → P6.4 + P6.5 整片刪
- `AIChatPanel.module.css` → P6.6 整片重寫

**建議**：留在 git history，新檔重寫；不刻意保留。Tokens (tokens.css / tokens.ts) + extras-* (Toast/Confirm/Recovery/etc.) 全部留。

---

## 6 · 工程量估計

| Sub-phase | Days (active) | 風險 |
|-----------|---------------|------|
| P6.0 Foundation | 1 | 低 |
| P6.1 Chrome (Rail+TopBar+shell) | 2-3 | 中 (Tauri decorations) |
| P6.2 Home (Inbox+Calendar+Preview) | 3-4 | 中 (新 schema) |
| P6.3 Course | 2 | 低 |
| P6.4 Review | 3-4 | 中 (3-column resize, audio player) |
| P6.5 Recording | 4-5 | **高** (state machine 跟 layout 緊耦合) |
| P6.6 AI | 2 | 低 |
| P6.7 Settings (Profile+8 panes) | 3-4 | 中 (大量 form) |
| P6.8 Search ⌘K | 2 | 中 (索引建構) |
| P6.9 NotesEditor (optional) | 5-7 | 高 (新 feature) |
| **Total (no P6.9)** | **22-29 天** | |
| **Total (with P6.9)** | **27-36 天** | |

**現實**：3-5 週認真做。期間舊 component 跟新 component 並存，每個 P6.X 是獨立可 ship 的 commit。Tailwind 不刪（plan L86 說 Phase 5 結束才刪 — 我們現在重新定義 Phase 5 等於沒做完，所以還不刪）。

---

## 7 · 相比之前的差別 — 為什麼這次會真的不一樣

| | CP-1 ~ CP-5 | Phase 6 |
|---|---|---|
| 哲學 | 換顏色 (token swap) | 換骨架 (IA + page rewrite) |
| 動的東西 | className | 元件樹結構 + router + DB schema |
| 結果 | 「舊 app 染色」 | 真正「H18 app 接上現有後端」 |
| 何時看到效果 | 已 ship | P6.1 chrome 一上你就會立刻看到「左 rail + Inbox」變化 |
| 風險 | 低（沒動 logic） | 中（重寫 + schema 新增 + 升級 migration） |

---

## 8 · 等使用者決定

請對 **Q1 ~ Q8** 點頭或調整，**特別是 Q5 NotesEditor 要不要做**（直接影響工程量 +1 週）。

決定後我從 **P6.0 Foundation** 開始，每個 sub-phase 一個 commit + 一個 CP 等你 review，這次**不再「一口氣推完」**。

Open questions 鎖定後 P6.0 第一個 commit 預計動的檔：
- `src-tauri/migrations/0XXX_reminders_calendar.sql` (新)
- `src/services/storageService.ts` (加 reminders / events CRUD)
- `src/services/storageService.test.ts` (新測試)
- `src/types.ts` (加 Reminder / CalendarEvent type)
- `src/App.tsx` (加 activeNav state，但 dispatch 暫時還是 fallback 到舊 components)
- 不動 UI

**沒寫 code 直到你 OK。**
