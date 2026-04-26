# CP-2 · 基礎 UI 遷移完成（夜間自主執行）

**狀態**：等你 visual review。
**規則放鬆**：你昨晚明確指示「你來驗證、往下推；早上看到最基礎 UI 遷移完」，所以我跳過 CP-1 的 step-by-step user verify、用 CDP screenshot 自己驗證、push 到此處。

**分支**：`feat/h18-design-snapshot`（worktree at `d:/ClassNoteAI-design/`）

**新增 commits（從 CP-1 起）**：

```
6199ecd feat(h18-p2): ProfileView 換 H18 tokens
b7ff5ed feat(h18-p2): SettingsView shell + LoginScreen 換 H18 tokens
31e56d6 feat(h18-p2): MainWindow shell + CourseListView 換 H18 tokens
b6c3859 feat(dev): ephemeral-port tauri dev launcher + CDP autoconfig
99c9754 fix(h18-p1): 補 src-tauri/resources/ort/.gitkeep
```

**驗證**：vitest 526/526 pass、tsc clean、vite build clean、CDP screenshot 各主要頁面 light + dark 都看過。

---

## 啟動方式（變更）

從現在開始用：

```bash
cd d:/ClassNoteAI-design/ClassNoteAI
npm run dev:ephemeral
```

不再用 `npm run tauri dev`。原因：

- vite/HMR/CDP 三個 port 全部用 OS 配發 free port，不會跟 Codex 隔壁 worktree 撞 1420/1421/9222
- 寫 `.dev-ephemeral.lock.json`（gitignored）給 `scripts/dev-ctl.mjs` 自動讀，所以我可以從 CDP 操控視窗 / 截圖 / eval JS 不用記 port
- SIGINT / 子進程 exit → `taskkill /T /F` 砍整棵 process tree，不留 orphan

第一次跑要從主 repo 複製 ort dll（gitignored binary）：

```
cp d:/ClassNoteAI/ClassNoteAI/src-tauri/resources/ort/onnxruntime{,_providers_shared}.dll \
   d:/ClassNoteAI-design/ClassNoteAI/src-tauri/resources/ort/
```

如果沒做，啟動會掛 `[ORT] FATAL: ORT_DYLIB_PATH is not set`。

---

## 你應該會看到的（請逐項打 ✓ / ✗）

### 1 · Login screen（如果是冷啟動）
- [ ] 暖色 backdrop（不是 slate gradient）+ 中央 H18 surface 卡片
- [ ] Avatar 圓圈：warm chip-bg + 橘色 accent 人形 icon
- [ ] 標題「歡迎使用 ClassNote AI」H18 weight，hint「請輸入用戶名以繼續」
- [ ] Input focus 時 border 變橘色 + 13% opacity 暈
- [ ] 「開始使用 →」按鈕：cream/dark chip（H18 invert pattern）
- [ ] 底下 mono 小字 footnote
- [ ] light/dark 都看一輪

### 2 · 主視窗 chrome（TopBar + 狀態列）
- [ ] TopBar 高 46px：左 brand「ClassNote AI」、中 nav (上課/設置)、右 ☁ 個人 主題 icon
- [ ] Active nav button：用「macOS segmented control」感的 dark/cream chip（不是 Tailwind 藍）
- [ ] Profile / Theme icon button：32px，hover 出現邊框
- [ ] 狀態列「● 模型就緒 | ● 翻譯就緒」：mono small caps，分隔豎線
- [ ] 整片背景：light = warm cream `#f5f2ea`，dark = warm purple-black `#16151a`
- [ ] 拖視窗：整條 TopBar 可拖（內部按鈕區除外）

### 3 · Home（CourseListView 空狀態）
- [ ] 「我的科目」標題，旁邊橘色 accent 🎓 icon
- [ ] 「+ 新增科目」按鈕：右上，H18 invert chip 樣式
- [ ] 空狀態：暗淡 🎓 icon、「還沒有科目」H18 字級、底下 mono hint

### 4 · Settings（點 TopBar 的「設置」）
- [ ] Sidebar 240px，「設置」標題 H18，section labels「主要 / 其他」mono uppercase
- [ ] Active 項目：cream chip-bg + 橘 icon + 右 ChevronRight
- [ ] Sidebar 底「ClassNote AI v0.6.5-alpha.1」mono 小字
- [ ] Main header：title + mono description，右側 save status pills
- [ ] 內部各 panel（本地轉錄模型 / 翻譯服務 / etc）**還是 Tailwind look**（slate cards、藍 icon），這是預期的 — 一個個 panel 的 H18 化是 Phase 3，不在「最基礎」範圍

### 5 · Profile（點右上人形 icon）
- [ ] 「個人中心」標題 + mono description
- [ ] User card：H18 surface，avatar chip-bg + accent，username + mono lastLogin
- [ ] 登出按鈕：橘紅 outlined，hover 加深底色
- [ ] 「關閉」按鈕：minimal chrome

### 6 · Phase 1 元件再 spot-check（在 console 戳）
```js
// Toast 卡片
toastService.success('儲存成功', 'ML · L13')

// Toast typewriter style 不容易在 dev 戳到，預設用 card

// Confirm dialog
confirmService.ask({ title: '清除字幕？', message: '此動作不會刪除資料庫紀錄。' })

// Confirm dialog danger
confirmService.ask({ title: '永久刪除？', message: '此動作無法復原。', variant: 'danger' })

// TaskIndicator dropdown
// 直接點右上的 ☁ icon

// 模擬 task pending（dropdown 才會有東西）：
await import('/src/services/offlineQueueService.ts').then(m => m.offlineQueueService.enqueue?.('AUTH_REGISTER', { test: true }))
```

---

## 我刻意還沒做的（標清楚 scope）

1. **左側 icon Rail（H18 design 的 H18Rail）**
   - 設計上 nav 應該在左 62px rail，TopBar 中央放 Inbox count + 日期
   - 我沒做是因為要動 nav IA + 影響每個 page 的 layout，不算「最基礎」
   - 等你下次 review 時討論：要直接上 Rail，還是先 Phase 3 把 inner panels H18 化

2. **WindowControls（紅黃綠 traffic lights）還是沒 mount**
   - 元件 + 9 個測試 + 對應 capability permissions 早就在了
   - `tauri.conf.json` 還是 `decorations: 預設 true`，flip false 後才能 mount，不然會兩條 title bar
   - 一個 coordinated change：flip + `<TopBar showWindowControls>` + macOS hide-on-close 策略決定

3. **Settings 內部各 panel**
   - 本地轉錄模型 / 翻譯服務 / 雲端 AI 助理 / 介面與顯示 / 音訊與字幕 / 資料管理 / 關於與更新
   - 7 個 panel，每個 ~150-300 行 Tailwind，加總 ≈ 1500 行
   - 都還能用，但視覺是 Tailwind island 在 H18 shell 裡。Phase 3 規劃逐 panel 切

4. **CourseDetailView / NotesView / TrashView / SetupWizard / AIChatPanel**
   - 你現在沒科目所以看不到 CourseDetail / Notes
   - SetupWizard 只有第一次 install 看到
   - 都很大（每個檔 500-2000 行），Phase 3+ 範圍

5. **Inner panel cards（科目 cards、訊息卡片等）**
   - 等資料填進去才看得到，現在空狀態看不出來

---

## 如果哪裡爆掉

- **單個 component revert**：對應 commit hash 在最上方表格，`git revert <hash>`
- **整個 Phase 2 revert（保留 Phase 1 chrome）**：`git revert b7ff5ed 31e56d6 6199ecd`
- **退回 CP-1 狀態**：`git reset --hard 6dc2f56`
- **整條 branch 砍掉重練**：`git checkout main && git branch -D feat/h18-design-snapshot && git worktree prune`

---

## 你 review 完之後

兩條路：

**A. 通過** → 開始 Phase 3：逐 settings panel H18 化（先從你最常用的開始？建議「介面與顯示」因為跟 H18 token 系統最親）；同時討論左 Rail 上不上、traffic lights flip 不 flip。

**B. 哪裡要改** → 在這個檔下面 markdown 寫，我就改。

我這邊已停在這個 commit，等你動作。
