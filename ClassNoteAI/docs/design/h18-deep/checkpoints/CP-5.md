# CP-5 · Phase 5 主頁面 Port 完成

**狀態**：等你 visual review。
**規則**：你昨晚明確指示「不要中間停，下次 review 是 Phase 5 結束」，所以從 CP-3 之後一路推到 alpha.6 alpha.7 一氣呵成，沒在中間 CP-4 停。
**驗證**：vitest 526/526、tsc clean、vite build clean。**沒有 CDP 視覺截圖** — 早上你開 dev 自己看比較準。
**Plan 對應**：V0.7.0-PLAN.md L297-314 Phase 5 「主要頁面 Port (大工程，分多次)」。

**分支**：`feat/h18-design-snapshot`（worktree at `d:/ClassNoteAI-design/`）

## Phase 5 commits（從 CP-4 結束起）

```
90eb866 feat(h18-cp5): MainWindow body bg → H18 token         ← 你最在意的「打開 app 第一眼」
87bff94 feat(h18-cp5): CourseListView 卡片 + kebab menu 換 H18  ← Plan Phase 5 第 1 項
37f4e14 feat(h18-cp5): CourseDetailView 整片換 H18              ← Plan Phase 5 第 2 項
7ada4df feat(h18-cp5): NotesView header / panels / mode toggle 換 H18  ← Plan Phase 5 第 3+4 項合併
2952ff2 feat(h18-cp5): AIChatPanel header + shells 換 H18 (移除藍紫漸層) ← Plan Phase 5 第 5 項
```

## 啟動

```bash
cd d:/ClassNoteAI-design/ClassNoteAI
npm run dev:ephemeral   # 或 node 全路徑
```

## 你應該會看到的差別 — 重點開頭

### 0 · 整體大背景已不是藍紫深色

之前你開 app 看到 home 是 `dark:bg-gray-900` (#111827 冷藍灰)，
卡片是 `dark:bg-slate-800` (#1e293b 帶藍紫味)。

**現在**：

- Home / Course / Lecture 大底 → `var(--h18-bg)` = `#16151a`（暖近黑、帶一點紫但偏咖啡）
- 卡片 → `var(--h18-surface)` = `#1e1d24`（暖灰深，比 slate-800 暖）
- 邊框 → `var(--h18-border)` = `#2f2d38`（不冷藍）

如果還是覺得色調怪，就是 tokens.css L62-108 那組 dark 值的問題，告訴我哪一個我直接調。

---

### 1 · CourseListView 卡片（home 第一眼）

- [ ] 卡片背景是暖色 surface (`#1e1d24` dark / `#ffffff` light)，不再 slate-800
- [ ] 卡片邊框 14px radius + token border
- [ ] hover：lift -2px + h18-shadow + 邊框微微變橘
- [ ] 標題 hover 從黑變橘 (`var(--h18-accent)`)
- [ ] kebab 點開的 menu 用 token surface + 4px padding，不再藍灰
- [ ] 刪除選項是 hot 紅橘色 + hover hot-bg
- [ ] meta icon (User / Clock / MapPin) 顏色用 accent / green / hot

### 2 · CourseDetailView（點進科目後）

- [ ] 麵包屑：「HOME › 科目名」是 mono caps，不再 slate
- [ ] 標題後的 Pencil edit button：hover 從 grey 變 accent
- [ ] keywords 變 chip-bg pill (#2a2834 dark)，不再 indigo
- [ ] 兩欄 grid：左 1fr (大綱) / 右 2fr (課堂列表)，1024px 以下變單欄
- [ ] 大綱 card：`#FileText` 標題 icon 是橘 accent
- [ ] 區段標題用 mono caps eyebrow（「課程主題」「時間」「地點」）
- [ ] 評分標準 table：surface2 表頭 + token border + tabular-nums % 對齊
- [ ] AI 生成中 pill：chip-bg + accent，1.6s pulse
- [ ] 生成失敗：hot-bg + hot border + token retry button
- [ ] 課堂 row：暖色 surface + 12px radius，hover lift -1px + 邊框變橘
- [ ] 錄音中 row：left status glyph 是 hot-bg pulse，不再純紅
- [ ] 完成 row：left status glyph 是 chip-bg + accent CheckCircle2，不再 green
- [ ] 日期 / duration 變 mono pill chip
- [ ] 右箭頭 hover 從 grey-300 變 accent + translate-x

### 3 · NotesView（點進 lecture）

注意：plan L313 寫「2870 行的巨獸，不要重寫，只換視覺」。所以本 commit
**只動最 dominant 的部分**，內部 transcript bubbles / context menus / 
PDF viewer toolbar / AudioPlayer 內部 button 還是 Tailwind。要 polish
這些是 v0.7.x patches 範圍。

- [ ] 整片大底 var(--h18-bg) 暖色（不再 dark:bg-gray-900）
- [ ] Header bar：surface 底 + 16px 800 weight 標題
- [ ] Back button 不再 rounded-full grey，改 7px radius token border on hover
- [ ] 標題後的 Pencil edit hover accent
- [ ] header sub-row：mono caps「LIVE MODE」/「REVIEW MODE」+ REC pulse 紅橘
- [ ] mode toggle (Live / Review)：surface2 軌道 + invert chip active，不再 white-on-grey
- [ ] toolbar buttons (Auto-Follow / Save / Import / Summary / Export / AI 助教)：
  - 都是 outlined token，hover surface2
  - active state（auto-follow on / AI 助教 open）= chip-bg + accent border
  - Save / Export 是 invert chip primary（之前是 blue-600）
- [ ] Recording 控制：Start = hot 紅橘、Pause = chip-bg、Stop = invert chip
- [ ] 錄音音量 bar：linear gradient h18-accent → h18-hot
- [ ] PanelResizeHandle：從 1.5px slate 變 3px h18-border，hover h18-accent

### 4 · AIChatPanel（floating mode：點 AI 助教 button）

- [ ] **header 不再 from-purple-500 to-blue-500 漸層！** 改 var(--h18-surface) 底 + bottom border
- [ ] 標題列：22×22 chip-bg + accent Bot icon + 「AI 助教」+ mono「RAG」eyebrow
- [ ] 五個 icon button (新對話 / 歷史 / 重置 / 最小化 / 關閉) 都 24×24 token，hover surface2
- [ ] 對話歷史下拉：surface 底 + token border + token shadow
- [ ] 對話 row hover：surface2；active session 是 chip-bg + 3px accent left border
- [ ] sidebar mode：border-left token 替代 grey-200/700
- [ ] **內部 message bubbles / markdown / RAG switch / index progress 還是 Tailwind**（v0.7.x polish）

---

## 我刻意還沒做的（v0.7.x patches 範圍）

1. **NotesView 內部** — transcript bubbles、context menu、AudioPlayer
   button 群、PDF viewer toolbar、handler menu、bilink concept hover
   tooltips（後者 plan 明說 defer）。逐 element polish 工程量大，建議
   實際使用後挑高頻看到的先動。

2. **AIChatPanel 內部** — message bubbles、markdown rendering、RAG
   status badge、index progress bar、input area、streaming spinner、
   delete session confirm、empty state。

3. **CourseDetailView 中 syllabus_info 的剩餘子欄位** — 像
   `office_hours` / `teaching_assistants` 用了 inline style fontSize 12
   而沒有正規 module class，可以再優化。

4. **CourseCreationDialog form 內容** — tabs / drop zone / AI 生成
   button 從 CP-3 之後沒動。

5. **WindowControls mount + tauri.conf decorations flip** — 元件早就到位，
   但 mount + flip 是改動 tauri.conf，是有 OS 風險的步驟。我這次不動，
   等你想清楚要不要走 macOS 原生 / 我們自畫的方向再決定。

6. **完整 Phase 5 第 3+4 項拆分**（NotesView review 模式 vs recording
   模式分別 polish）— 我這次合併成一個 commit 因為兩個模式共用 header
   + panel divider + audio bar。如果之後要動 review 模式內部
   (h18-review-page.jsx) 或 recording 模式 layout（h18-recording-v2.jsx
   有 layout A/B/C 變體），那就是新 commit。

## Phase 4 + Phase 5 整體 stats

- **新 commits**: 10 個（CP-4 5 個 + CP-5 5 個）
- **新 module CSS**: 8 個（RecoveryPromptModal / ErrorBoundary / VideoPiP
  / UnofficialChannelWarning / AlignmentBanner / NotesView / AIChatPanel /
  CourseDetailView；MainWindow.module.css 是擴充）
- **Tests**: 仍 526/526（沒新增 / 沒退化）
- **TS errors**: 0
- **Vite build**: clean (gzip 31.6 kB CSS / 621 kB JS bundle)

## 你 review 完之後

**A. 通過** → 拉 `0.7.0-alpha.6` tag。剩 v0.7.x polish patches 慢慢
推。Tailwind config 還在（plan L86 說「Phase 5 全部主頁面 port 完才刪
tailwind.config.js」），要不要刪是另一個討論。

**B. 哪裡顏色不對** → 直接在這個檔下面寫「CourseDetailView 卡片 hover
邊框太橘」這種具體反饋，我改。最常見的調整應該是 dark mode 的
chip-bg / surface2 對比度。

**C. 翻車** → 如果某頁面整個壞掉（白屏、layout 跑掉、tsc 跑得過但實際
runtime 出 className undefined），最快方法是 `git revert <commit>` 把
那一個 component 退回。每個 P5 commit 都是獨立檔案 scope，互不依賴。

我這邊已停，dev 全清，PATH junction 修好。
