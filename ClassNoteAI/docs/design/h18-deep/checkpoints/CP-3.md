# CP-3 · 基礎架構遷移完成（夜間自主執行 round 2）

**狀態**：等你 visual review。
**規則**：你昨晚二次明確指示「推到 CP3 / 基礎架構遷移完再停」，我用 CDP screenshot 自驗 + push 到此處，沒在中間停。

**分支**：`feat/h18-design-snapshot`（worktree at `d:/ClassNoteAI-design/`）

**新增 commits（從 CP-2 起）**：

```
23ccca0 feat(h18-cp3): CourseCreationDialog shell 換 H18 (backdrop blur + chip footer)
0cf5035 feat(h18-cp3): SetupWizard CSS 全 H18 token 化
c549672 feat(h18-cp2): Settings shared Card + SegmentedControl 換 H18 tokens
```

**驗證**：vitest 526/526、tsc clean、vite build clean、CDP screenshot 各主要頁面 light + dark 都自看。

---

## 啟動方式（沒變）

```bash
cd d:/ClassNoteAI-design/ClassNoteAI
npm run dev:ephemeral
```

---

## 你應該會看到的（請逐項打 ✓ / ✗）

### 1 · CP-1 + CP-2 既有項目（沿用，再 spot-check）
- [ ] Login screen 暖色 backdrop + radial accent glow
- [ ] TopBar / status bar / Home 空狀態 / Settings sidebar / Profile — 上次 review 的 H18 chrome 仍然對

### 2 · Settings panels 外殼（新）
- [ ] 點 設置，預設 panel「本地轉錄模型」: 外層 Card 是 H18 surface（暖色）+ accent icon + mono subtitle
- [ ] 換到「翻譯服務」: SegmentedControl (TranslateGemma / Google Cloud) 是 H18 風 segmented chip，selected segment 浮起
- [ ] 換到「介面與顯示」: 整片用 SegmentedControl 切 主題/密度/字體/Toast 風格 — 全部對齊 H18 segmented 樣式
- [ ] 換到「雲端 AI 助理」: 5-provider grid 外殼是 H18 Card，inner provider rows 還是 Tailwind（預期，Phase 3.5）
- [ ] 換到「資料管理」/「關於與更新」: Card 標題 + accent icon + mono subtitle，inner content 還是 Tailwind 但邊框已經 H18 化

### 3 · CourseCreationDialog（新，點「+ 新增科目」觸發）
- [ ] Backdrop: 4px blur + 暖色半透明（不是純黑 50%）
- [ ] Card: H18 surface + token border + cardIn 動畫
- [ ] Title「創建新課程」前面是橘色 accent BookOpen icon
- [ ] X 關閉按鈕 hover 時加 subtle border
- [ ] Footer: 取消是 outlined / 創建課程是 cream-chip primary
- [ ] Form 內容（PDF 文件 / 課程大綱 tabs、檔案 drop zone、AI 生成 button）還是 Tailwind look — 預期，Phase 3.5

### 4 · SetupWizard（新，僅在 Settings → 關於與更新 → 重置 Setup Wizard 才能觸發）
- [ ] Backdrop: 暖色 + radial accent glow（不再是藍紫漸層）
- [ ] Container: H18 surface + token border + h18-shadow
- [ ] Step indicator: 圓點變 pill，active 是 18px 橘色長條
- [ ] Welcome icon: 80px 圓 + chip-bg + accent translation icon
- [ ] 標題「歡迎使用 ClassNoteAI」: H18 weight (不再是藍紫漸層字)
- [ ] Feature cards (語音轉錄 / 自動翻譯 / 智能摘要): H18 surface2 + accent icons
- [ ] 「開始設置 →」按鈕: cream chip
- [ ] 註解 mono small caps

### 5 · Phase 1 元件 spot-check（在 console）
```js
// Toast
toastService.success('儲存成功', 'ML · L13')

// Confirm dialog danger variant
confirmService.ask({ title: '永久刪除？', message: '此動作無法復原。', variant: 'danger' })

// TaskIndicator dropdown — 點右上 ☁
```

---

## 我刻意還沒做的（Phase 3.5+ 範圍）

1. **Settings 各 panel 內部** — Card 外殼 H18 了，但裡面的 content（model rows、status pills、download progress bars、provider grid items）還是 Tailwind blue/green/slate。逐 panel polish 是 Phase 3.5，建議從你最常用的開始排序。

2. **CourseCreationDialog form 內容** — tabs（PDF 文件 / 課程大綱）、drop zone、AI 生成 button 還是 Tailwind。

3. **左側 icon Rail** — 還沒做。Nav 還在 TopBar 中央。要做要動 IA。

4. **Traffic lights (WindowControls)** — 元件 + 測試 + permissions 都到位但沒 mount，因為 `decorations` 還沒 flip。

5. **CourseDetailView / NotesView / TrashView / AIChatPanel / RecoveryPromptModal** — 大頁面，每個 200~2900 行 Tailwind。要看到要有資料才看得到（CourseDetail/Notes 需先建科目）。Phase 5 範圍。

6. **Profile achievements (POverview A 變體)** — 設計裡是成就計數的 hero，我目前只做了基本 user card。Phase 3.5。

---

## Risk / Revert paths

**單個元件**：對應 commit hash 在最上方表格，`git revert <hash>`

**完全退回 main 風格**：
```
git checkout main && git branch -D feat/h18-design-snapshot && git worktree prune
```

**保留 Phase 1 chrome、退掉 Phase 2/3 shells**：
```
git revert 23ccca0 0cf5035 c549672 6199ecd b7ff5ed 31e56d6
```

---

## Stats（CP-1 ~ CP-3）

- **Commits**: 18 個（從 main 起）
- **新元件 / module CSS**: 8 個（Toast, Confirm, TaskIndicator, WindowControls, TopBar 在 Phase 1；MainWindow.module, CourseListView.module, SettingsView.module, LoginScreen.module, ProfileView.module, settings/shared.module, CourseCreationDialog.module 在 Phase 2/3）
- **Tests added**: 44 個 (vitest 從 main 的 482 → 526)
- **既有功能**: 全部沒破

---

## 你 review 完之後

**A. 通過** → 接 Phase 3.5：逐 settings panel 內部 + dialogs form 內容 polish；或直接跳 Phase 5 主頁面 (CourseDetail/Notes 等大頁面，需 IA 討論)。

**B. 哪裡要改** → 在這個檔下面 markdown 寫，我看了就改。

我這邊已停在 commit `23ccca0`，dev server 仍跑著（pid 應該還在），等你動作。
