# Phase 7 · H18 Recording / Stop Pipeline / Polish 大改

**狀態**：Design doc — 等使用者最終 sign-off。
**分支**：`feat/h18-design-snapshot` (繼續疊上去)
**前置**：Phase 6 (CP-6.11 + 一系列 G/H wiring fixes) 已完成。
**範圍**：4 個 sprint，預計 ~10-15 個 commit。

---

## 0 · 為什麼要做這個 phase

P6 的目標是「H18 prototype → 接到既有後端」。完成度大約：
- **介面**：90%（chrome / 路由 / 頁面結構基本對齊）
- **接後端**：50%（多數 settings 控件已 wire，但**結束錄音的 6 步 pipeline 漏 5 步**）

使用者實測發現 catastrophic UX 失敗：錄完課堂 review 整片空白（字幕 / 摘要 / 索引都沒入庫）。Deep audit 又揭出 23 條斷裂 / 缺失 / 隱性 bug。Phase 7 收齊。

---

## 1 · 鎖定的設計決策（使用者 2026-04-27 ~ 04-28 確認）

| ID | 項目 | 決定 |
|---|---|---|
| Q5 | detached AIChatWindow webview | **刪除整套**（AIChatWindow / AIChatPanel / aiTutorWindow.ts + tests） |
| F1 | Lecture 編輯介面 | **A only · Modal** — Hero ✎ button + 右鍵「編輯」都進這裡 |
| F2 | 匯出格式 | SRT + Markdown |
| F3 | 移動 lecture 到其他課程 | 右鍵子 menu 列 courses（hover 展開） |
| F4 | 文字框 H18 風右鍵 | 剪下/複製/貼上/全選，OS detect ⌘ vs Ctrl |
| F5 | Trash 階層 | course → lecture，課程刪 → cascade lectures，課程可獨活 |
| F6 | 其他 surface 右鍵 | 純 preventDefault，不彈空 menu |
| U1 | 同時開新錄音 | confirm dialog + 同步等舊 finalize |
| U2 | Streaming summary 重複觸發 | 不同 lecture 平行；同 lecture 取消舊開新 |
| U3 | Stop pipeline 摘要失敗 | 不 block，note tab 顯示「✦ 失敗 · [重試]」 |
| U4 | `lecture.date` 邏輯 | 從 inbox 入口拿 scheduled time；rail [+] fallback now |
| U5 | 日期 picker | 自刻 H18 風 day grid |
| U6 | sub-menu 觸發 | hover 展開 |
| S1 | TaskIndicator 整合 | 統合所有背景任務 |
| S2 | 移動 lecture 後 nav | 跳到 `review:NEW_cid:lid` |
| S3 | Markdown 範本 | metadata + 摘要 + 章節 + 雙語逐字稿 |
| S4 | Trash bulk 操作 | 全選 + 還原選取 / 永久刪除選取 |
| S5 | 錄音中全域提示 | **只 TopBar 紅膠囊**（不加 Rail pulse / toast） |
| S6 | 30 天清理通知 | 啟動 toast「已永久清除 N 個…」 |
| S7 | Modal 改 course = 移動 | 兩條路保留 |
| S8 | ✎ button modal flow | 改完 → close → ReviewPage 刷新 |
| M1 | 結束 confirm | **加 confirm dialog** |
| M2 | 鍵盤快捷鍵 | **建 keymap 系統，使用者可自訂** + OS detect 顯 ⌘/Ctrl |
| N2 | cascade 軟刪實作 | Rust backend atomic transaction |
| N3 | 30 天清掃 | 啟動掃描 hard delete |

---

## 2 · 4 個 Sprint × commit plan

每個 sprint 一個 commit + 驗證點。tsc clean + 視覺自測 + sync 使用者後才開下個。

### Sprint 1 · 錄音 Singleton + 周邊（2-3 commits）

**目標**：錄音不再綁 component 生命週期；切頁不會殺錄音；finalize 路徑統一。

**新增**：
- `src/services/recordingSessionService.ts` — singleton
  - state: `status / segments / currentText / elapsed / stopPhase / sessionStartMs / error`
  - methods: `start(courseId, lectureId, opts) / pause() / resume() / stop() / subscribe(cb)`
  - 內部擁有 AudioRecorder + transcriptionService 的生命週期
  - 跨頁 navigation 不會 stop
  - 偵測 `document.visibilitychange` + `MediaStreamTrack.readyState` — 系統 sleep 後 mic 失活時 toast 警告
  - dispatch `RECORDING_CHANGE_EVENT` on start/pause/resume/stop

**改寫**：
- `src/components/h18/useRecordingSession.ts` — 改成 thin reader hook，subscribe singleton state，不再擁有 recorder
- `H18DeepApp.tsx` — recording state 從 singleton 來，不再 polling listLectures
- `H18RecordingPage.tsx` — 顯示 singleton state，切頁時不停止
- `H18ReviewPage.tsx` — `lecture.status === 'recording'` 路由邏輯保留，但底下用 singleton

**新功能**：
- **U1 同時錄音 confirm**: 在 `startNewLectureFor()` 偵測 `recordingSessionService.status === 'recording'` → confirmService.ask → 同意才 await 舊 finalize 後啟動新 session
- **N1 thread scheduled time**: `startNewLectureFor(courseId, opts?: { scheduledDate?: Date })`，inbox 入口傳 nextClass.date，rail [+] 入口用 `new Date()`
- **N6 Recovery hint**: recoveryService 修復成功後 set localStorage flag `_recovery:<lectureId>`，ReviewPage hero 偵測到顯示 banner「這堂課因 crash 自動還原」+ dismiss button
- **N7 visibilitychange 處理**: singleton 內 listen `document.visibilitychange` → hidden 時記 timestamp，visible 時若 status='recording' 檢查 `recorderRef.audioTrack.readyState`，'ended' → toast「錄音可能在 X 分鐘前因系統 sleep 中斷」+ 提示去 review

**Verify M3 (Gemma model 下載入口缺)** — 確認後加進 Sprint 3 PTranslate（避免 Sprint 1 失焦）。

**驗證**：
- 錄音 → 切到 home → 切回 → status 仍 recording，elapsed 連續
- 系統 sleep 60s → 回來看 toast
- 同時開新錄音 → 看到 confirm dialog，選 cancel 不影響舊的

---

### Sprint 2 · Stop Pipeline + Streaming Summary + RAG（3-4 commits）

**目標**：結束錄音真的存資料，5-step UI 跟實際對齊，背景任務有 TaskIndicator 看得見。

**新增**：
- `src/services/taskTrackerService.ts` — singleton
  - shape: `{ id, kind: 'summarize'|'index'|'export', label, lectureId?, progress, status: 'queued'|'running'|'done'|'failed', startedAt, error? }`
  - methods: `start(task) → taskId / update(taskId, patch) / complete(taskId) / fail(taskId, err) / cancel(taskId) / getActive() / subscribe(cb)`
  - persist running tasks 到 sessionStorage（重整網頁救回）

**translationPipeline 加 `awaitDrain()`**:
```ts
public awaitDrain(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (this.queue.length === 0 && !this.processing) resolve();
      else setTimeout(check, 50);
    };
    check();
  });
}
```

**改寫 `recordingSessionService.stop()` 為真實 6 步 pipeline**：

1. **轉錄收尾** (`stopPhase='transcribe'`)
   - `transcriptionService.stop()` (await `asrPipeline.stop()` flush 最後一句)
   - **新加** `await translationPipeline.awaitDrain()` — 讓最後一句的中文翻譯回來
2. **寫入錄音檔** (`stopPhase='segment'`)
   - `recorder.finalizeToDisk(...)` (.pcm → .wav)
3. **保存字幕** (`stopPhase='index'` — 名稱對使用者語意，不是 RAG 索引)
   - `subtitleService.getSegments()` → map 成 Subtitle[]
   - `await storageService.saveSubtitles(subtitles)`
   - 同步 update `globalSearchService` index (字幕 fts) — **N4 修**
4. **生成摘要** (`stopPhase='summary'`) — **背景，不 block 完成**
   - kick off `taskTrackerService.start({ kind:'summarize', lectureId, label:'生成摘要' })`
   - background `summarizeStream(...)` → emit progress to taskTracker → emit `partial_text` event
   - finally `storageService.saveNote({ ...note, summary })`
   - 失敗 → taskTracker 標 failed + UI 在 review note tab 顯示 retry button
5. **建立索引** (合併進 step 4 背景)
   - `ragService.indexLecture(lectureId)` — kick off background
   - 也走 taskTracker
6. **完成** (`stopPhase='done'`)
   - flip lecture status='completed'
   - dispatch RECORDING_CHANGE_EVENT { kind: 'stop' }
   - UI 跳 review:cid:lid

**前 3 步同步等完，4-5 在背景跑**。「完成 →」按鈕在 step 6 完成時可按（< 10s）。Review page 看摘要可能還在 streaming（灰色 → 黑色）。

**ReviewPage 改造**：
- `summary` tab 加 streaming 監聽：subscribe taskTracker filter lectureId+kind=summarize → 看到 partial_text 即顯示灰色文字；done 變黑
- failed 狀態顯示「✦ 失敗：{err} · [重試]」
- streaming 時顯示「✦ 摘要生成中 · 段落 X/Y」progress bar

**TopBar TaskIndicator 改造**：
- 之前是 placeholder，現在 subscribe taskTrackerService
- icon badge 顯示 active task 數
- 點開 panel 列出每個 task + 進度 + 取消 button
- task done 後 5 秒淡出

**summary regen button (C4 已有) 升級**：
- 點下去 → 取消同 lecture 既有 summarize task → 開新的（U2）

**驗證**：
- 錄 30s → 結束 → 5-step 跑完 → review 有字幕、摘要 streaming、Q&A 從 note.qa_records
- 摘要中切到別頁 → TaskIndicator 看到進度 → 切回來摘要已完成或仍在跑
- 故意把 LLM provider 拔掉 → 摘要失敗 → review 顯示重試按鈕

---

### Sprint 3 · Polish · OS / 右鍵 / 編輯 / 匯出 / 刪除（4-5 commits）

**目標**：填齊使用者實測抓到的所有非 P0 但體驗痛點。

#### 3a. Keymap 系統（M2）
- `src/services/keymapService.ts` singleton
  - default map：
    ```
    search:        Mod+K
    toggleAiDock:  Mod+J
    newCourse:     Mod+N
    goHome:        Mod+H
    goProfile:     Mod+Comma
    toggleTheme:   Mod+Backslash
    floatingNotes: Mod+Shift+N
    ```
  - `getCombo(actionId)` / `getDisplayLabel(actionId)` / `matchesEvent(actionId, e)` / `subscribe(cb)` / `set(actionId, combo)` (檢查衝突)
  - `Mod` token = `⌘` on macOS, `Ctrl` on Windows/Linux
  - 持久化到 `AppSettings.shortcuts: Record<actionId, comboString>`

- `src/utils/kbd.ts`：OS detect、`parseCombo`、`formatComboLabel`、`comboFromEvent`

- 替換綁定處：
  - `H18DeepApp.tsx` 鍵盤 handler 改成 iterate keymapService entries
  - `H18RecordingPage.tsx` 浮動筆記 toggle 改成 `keymapService.matchesEvent('floatingNotes', e)`

- 替換顯示處（**全部 import 自 keymapService.getDisplayLabel**）：
  - `H18TopBar` 搜尋 / 主題
  - `H18RecordingPage` 筆記 button + tooltip
  - `DraggableAIFab` tooltip
  - `H18AIPage` empty hint
  - `H18Preview` AI hint
  - `SearchOverlay` empty footer
  - `PAppearance` 主題 row hint

- **新 sub-pane** `PKeyboard`（在 ProfilePage SETTINGS 列加一個 tab「鍵盤」）：
  - 列出所有 actions
  - 每行：label + 當前 combo chip（click 開 capture mode 錄入新 combo）+ 重置 default button
  - 衝突偵測：使用者錄入跟另一個 action 撞 → toast warn 不允許
  - Esc 取消 capture

#### 3b. 全域右鍵抑制 + 文字框 H18 menu（F4 / F6）
- `src/components/h18/H18ContextMenu.tsx` — 重用既有 CourseRailContextMenu 的 visual pattern
- `src/components/h18/H18TextContextMenu.tsx`：
  - 剪下 / 複製 / 貼上 / 全選
  - 用 `document.execCommand('cut'|'copy'|'paste'|'selectAll')`
  - 沒選文字 → 剪下/複製 disabled
  - clipboard 空 → 貼上 disabled
- `H18DeepApp` 加全域 `contextmenu` listener：
  - 偵測 target，TEXTAREA / INPUT / contentEditable → 顯示 H18TextContextMenu
  - 其他 → preventDefault only

#### 3c. Lecture 編輯 Modal (F1 A)
- `src/components/h18/LectureEditDialog.tsx`：
  - 標題 input
  - 日期 picker（**自刻 H18 day grid**，U5）
  - 所屬課程 dropdown（一改 = 移動 lecture，S7）
  - 關鍵字 chip + 加 / 刪
  - Footer [取消] [儲存]
- 觸發點：
  - ReviewPage hero ✎ button（S8）
  - 右鍵 menu「編輯」(F3)
- `H18DayPicker.tsx`：
  - month grid + prev/next month
  - 點 day → onChange
  - 跟 H18 design tokens 對齊

#### 3d. Lecture 右鍵 menu (F3)
- 適用於 CourseDetailPage lecture 列表行
- Items：
  - 編輯
  - 重新命名（inline）
  - 匯出 ▸ SRT / Markdown
  - 移動到其他課程 ▸ (列出 courses，hover 展開, U6)
  - ─ 刪除 ─
- 移動完 nav 到 `review:NEW_cid:lid`（S2）

#### 3e. 匯出 SRT + Markdown (F2)
- `src/services/exportService.ts`：
  - `exportLectureSRT(lectureId): Promise<string>` — 從字幕 generate SRT
  - `exportLectureMarkdown(lectureId): Promise<string>` — metadata + summary + sections + transcript（雙語）
- 觸發後 → `dialog.save` 選位置 → 寫檔
- progress / 完成 → toast

#### 3f. Lecture 刪除 + Trash UI（F5 / S4）
- 後端 `delete_course` Rust 改成 atomic transaction：UPDATE course is_deleted=1 + UPDATE lectures is_deleted=1 WHERE course_id=? (N2)
- 加 `list_trashed_lectures` Tauri command
- 加 `restore_lecture` 命令（需要先確保 course 存活 — 客戶端邏輯）
- 加 `hard_delete_old_trashed` 命令 — 啟動時掃 > 30 天 (N3)
- App.tsx 啟動加：
  - 跑 `hard_delete_old_trashed` → 拿回清掉的 list → toast「已永久清除 N 個…」(S6)
- PData 整片改造：
  - 階層樹狀顯示：course → lecture
  - 課程列下：救「課堂屬於存活 course」直接 restore；救「課堂屬於已刪 course」confirm「需要連同課程一起回復」atomic restore
  - bulk 全選 + 「還原選取」/「永久刪除選取」(S4)

#### 3g. PTranscribe 加 Gemma 下載 button（M3）
- 移植 legacy SettingsTranslation 的 `handleDownload`
- progress event subscription
- 整合 taskTrackerService（顯示在 TopBar）

#### 3h. 結束 confirm（M1）
- H18RecordingPage 「結束 · 儲存」按下去 → confirmService.ask
  - title「結束錄音？」
  - message「字幕跟摘要會自動生成。可在背景繼續，可隨時去其他頁面。」
  - confirmLabel「結束」
  - variant: 'default'
- Cancel 直接返回，不執行

**驗證**：
- Win 上 menu 顯示 Ctrl+K，鍵盤敲 Ctrl+K 真的開搜
- PKeyboard 改 search 為 Ctrl+P → 立刻所有顯示處更新 → Ctrl+P 真開搜
- 編輯 lecture title → 儲存 → review 麵包屑改了
- 刪 lecture → trash 看到 → 救回來 → review 又能開
- 故意刪 course → 看到課堂全部跟著進垃圾桶 → 救 lecture 跳「需連同 course」
- 結束按下去 → confirm dialog → cancel → 仍在錄音

---

### Sprint 4 · 影片 / PDF / Alignment（範圍外，先存 issue）

**這 sprint 我建議推遲，但留 issue**：
- ImportModal 重寫接 videoImportService
- ReviewPage / RecordingPage 加 PDF panel
- AlignmentBanner 接 autoAlignmentService
- 投影片 / PDF 對齊功能

理由：Sprint 1-3 完成後 H18 已經是 production-ready。Sprint 4 是「擴功能」不是「修壞掉」。可獨立後續排。

---

## 3 · API / Schema 變動

### AppSettings 新增
```ts
interface AppSettings {
  // ... existing
  shortcuts?: Partial<{
    search: string;          // default 'Mod+K'
    toggleAiDock: string;    // default 'Mod+J'
    newCourse: string;       // default 'Mod+N'
    goHome: string;          // default 'Mod+H'
    goProfile: string;       // default 'Mod+Comma'
    toggleTheme: string;     // default 'Mod+Backslash'
    floatingNotes: string;   // default 'Mod+Shift+N'
  }>;
}
```

### Tauri 新命令
- `delete_course_cascade(course_id)` — 改 `delete_course` 內部 cascade 軟刪
- `list_trashed_lectures(user_id)` — 列垃圾桶 lectures
- `restore_lecture(lecture_id)`
- `hard_delete_trashed_older_than(days_ago: i64)` — 回傳清掉的 ids

### 新服務
- `recordingSessionService.ts` — singleton
- `taskTrackerService.ts` — singleton
- `keymapService.ts` — singleton
- `exportService.ts` — stateless

### 新元件
- `LectureEditDialog.tsx` + `.module.css`
- `H18DayPicker.tsx` + `.module.css`
- `LectureRailContextMenu.tsx` (or 重構 generic `H18ContextMenu`)
- `H18TextContextMenu.tsx`
- `PKeyboard.tsx` (ProfilePanes 的新 sub-pane)
- `RecoveryHintBanner.tsx` (ReviewPage hero 用)

### 刪除
- `AIChatWindow.tsx` + `AIChatPanel.tsx` + `AIChatPanel.module.css`
- `services/aiTutorWindow.ts`
- `__tests__/AIChatPanel.test.tsx` + `__tests__/AIChatWindow.test.tsx`
- App.tsx `aiTutorWindow=1` 分支

---

## 4 · 風險

| 風險 | 影響 | 緩解 |
|---|---|---|
| recordingSessionService 邊界 case （多 instance / hot reload） | 錄音資料損失 | sessionStorage 做 lock；hot reload 時用 lectureId 偵測 dirty session |
| Streaming summary 跟 recording 同時跑會打爆 LLM rate | 失敗率上升 | TaskTracker queue priority；同時間最多 2 個 LLM 調用 |
| 自刻 day picker 跨 OS / 跨字級渲染崩 | UX bug | mount 時測 canvas size，失敗 fallback native input |
| Cascade 軟刪後資料量翻倍（每堂 lecture 算一筆 row） | trash 列表慢 | bulk 操作做 paginate；hard delete 30 天每月跑 |
| Keymap 衝突 (使用者設兩個 action 同 combo) | shortcut 失靈 | set() 階段 reject + UI 提示衝突 action |
| Gemma 自動 spawn 占 1-2GB 內存 | 開機慢 | 4s 延遲後才嘗試，且只有 provider=gemma 才啟動 |

---

## 5 · 完工驗收 checklist

- [ ] 錄音中切到任何頁面再切回來，elapsed 連續、segments 不丟
- [ ] 結束錄音 → 字幕入庫、摘要 streaming 灰→黑、note tab 有內容
- [ ] 摘要失敗 → review 顯示「失敗 · [重試]」+ TaskIndicator 顯紅
- [ ] 文字框右鍵彈我們的 menu，其他空白右鍵不彈瀏覽器原生
- [ ] Win 看到 Ctrl+K，Mac 看到 ⌘K，雙方鍵盤都 work
- [ ] 使用者去 PKeyboard 改 search 為 Ctrl+P，所有顯示處同步刷新
- [ ] 課堂編輯 modal 改 title / date / course → 儲存 → review 刷新
- [ ] 課堂右鍵 → 匯出 SRT → 寫到磁碟 → 內容正確
- [ ] 課堂右鍵 → 移動到其他課程 → nav 跳新 course
- [ ] 課堂右鍵 → 刪除 → 進垃圾桶 → 救回來
- [ ] 課程刪除 → 內含課堂全跟著進垃圾桶
- [ ] 啟動 toast 顯示 「已永久清除 N 個 > 30 天」
- [ ] PTranslate 看到 ✗ 模型尚未下載 → 點下載 → progress 顯示 → 完成後可手動啟動 sidecar
- [ ] Hero ✎ button 點下去 → 編輯 modal 開
- [ ] 錄音中再開新錄音 → confirm dialog 防呆
- [ ] AIChatWindow 整套刪掉，App.tsx detached 路徑也刪
- [ ] tsc clean, no console errors during a 5-min recording session

---

## 6 · 不在範圍

- 概念圖 / concept extraction
- iPad mirror NotesEditor
- 跨課堂 RAG（globalSearchService 已 index 但 UI 不暴露）
- 雲端備份 / 設備同步
- 字幕對齊 (alignmentService 沒 wire；後續 sprint)

---

## 7 · 開工順序 + 預估時間

| Sprint | 工作量 (active days) | 風險 |
|---|---|---|
| Sprint 1 (singleton + 多 user 安全 + close 流程) | 3 | 中（生命週期重構） |
| Sprint 2 (stop pipeline + streaming + virtualization) | 3-4 | 中（LLM 路徑多） |
| Sprint 3 (polish 8 子任務 + a11y) | 4-5 | 低（純 wiring + UI） |
| Sprint 4 (Review/Recording Import Surface · P1) | 3-4 | 中（影片 / 字幕匯入接 service） |
| **Total** | **13-16 天** | |

每個 sprint 完 → tsc + 視覺自測 → 跟使用者 sync 一次 → 下個 sprint 開工。**不再 P5 那種「一口氣推完」**。

---

## 9 · v4 5-agent 審查補遺（2026-04-28 第四輪 — 取代 §8 之上 §1-7 範圍規劃）

5 個獨立 agent 用中立 prompt 從 5 個方向審查 v3 plan，~80 finding 收回。本節列出 v4 必修項目。

### 9.1 必加 Sprint 0 · Foundation（1-1.5 天）

開 Sprint 1 前的前置條件。沒這 10 件事，Sprint 1 第一個 commit 就會破：

| # | 任務 | 為什麼必要 |
|---|---|---|
| 0.1 | `src/test/setup.ts` 加 `afterEach(cleanup)` | React 18 Strict Mode + RTL 雙 mount 會 leak listener |
| 0.2 | `src/test/h18-fixtures.ts` 新建 (mockLecture / mockSubtitles / mockTask / mockSettings 共用 builder) | 80+ 新測試避免重複構造 fixture |
| 0.3 | `src/test/h18-llm-mocks.ts` 新建 (async generator mock pattern, summarizeStream / chatStream) | 沒範例使所有 sub-agent 自己摸索 |
| 0.4 | `src-tauri/src/storage/database_test.rs` 新建 in-memory SQLite test harness | database.rs 目前零測試，無法 TDD migration |
| 0.5 | `src/services/__contracts__/recordingSessionService.contract.ts` (interface only) | 先有 contract 才能寫紅測試 |
| 0.6 | `src/services/__contracts__/taskTrackerService.contract.ts` | 同上 |
| 0.7 | `src/services/__contracts__/keymapService.contract.ts` | 同上 |
| 0.8 | `docs/design/h18-deep/H18-MODAL-CONVENTIONS.md` 規範 Z-index / Esc / focus trap | 多個 sub-agent 平行寫 modal/popover 不會打架 |
| 0.9 | `src/components/h18/useService.ts` (subscribe 統一 cleanup hook) | Singleton 訂閱模式 boilerplate 統一 |
| 0.10 | `tauri.conf.json` 加 CSP 草稿 (smoke test 確認 dev 不破) | 後續 Sprint 1 W4 真開 CSP 之前先 test 環境驗 |

### 9.2 Sprint 1 加 4 個必修安全項目（W4-W6 + W19-20）

| ID | 項目 | 為什麼必修 |
|---|---|---|
| **W4** | `tauri.conf.json` 真開 CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` | 目前 `csp: null`，rehype-raw + Canvas HTML 是 XSS 大表面 |
| **W5** | rehype-raw 移除 / 改 DOMPurify；`safeHtml()` 從 regex 換成 isomorphic-dompurify | regex sanitize 已知可被 `<svg/onload=>` bypass |
| **W6** | HTTP allowlist 收緊（`capabilities/default.json` 從 `https://*:*/**` 改成具體 host pattern） | 目前任意 fetch / SSRF 風險 |
| **W19** | 全域 console wrapper 跑 logDiagnostics redact，runtime log 不漏 secrets | export bundle 是手動，runtime log 沒過濾 |
| **W20** | release build 關 sourcemap (`vite.config.ts`) | release 不該外漏 source code |

### 9.3 Sprint 1 加 4 個 lifecycle / multi-user 強化（W10 / W14-15 / R-1）

| ID | 項目 |
|---|---|
| **W10** | concurrent recording confirm 掛**所有**入口（rail course chip / CourseDetailPage row click / inbox 「下一堂課」），不只 inbox |
| **W14** | 全部 localStorage 寫入包 try-catch（quota exceeded 時 toast） |
| **W15** | recordingSessionService 訂閱 `MediaStreamTrack.onended` (mic 中途被 OS 收回時偵測) |
| **R-1** | logout 一併呼叫 `recordingSessionService.reset()` + `taskTrackerService.cancelAll()` 不只 keyStore |

### 9.4 Sprint 2 加 5 個 error / UX 強化（W7-W9, W17-W18）

| ID | 項目 |
|---|---|
| **W7** | `summarize` map-reduce 加 per-section try-catch + partial recovery（一節 fail 不要整堂垮）|
| **W8** | LLM 路徑加 `AbortController` 真接，cancel UI = cancel HTTP（U2 取消舊 task 才有意義） |
| **W9** | translationPipeline queue 加 max size (~5000) + 觸發 `translation_backlog` event；不是 LLM 並行 cap，是記憶體保護 |
| **W17** | Toast coalescing — stop pipeline 不要連噴 5 個 toast，相關 event 合併成 1 條 「✓ 錄音已儲存」 |
| **W18** | TaskTracker task done 跳一條 sticky toast「✦ ML L4 摘要已完成」，避免使用者沒看 dropdown 不知道結果 |

### 9.5 Sprint 3 加 5 個 schema 安全 + UX 一致性（W2-W3, W11-W13）

| ID | 項目 |
|---|---|
| **W2** | Schema migration 用 SQLite TRANSACTION 包 atomic — 任一步 fail 整體 rollback |
| **W3** | `database_test.rs` 為新 cascade / restore / hard_delete 寫 in-memory 驗證 |
| **W11** | 落實 modal 規範：DayPicker 是 popover (Esc 不關 LectureEditDialog)，stack 順序明寫 |
| **W12** | course / lecture context menu 結構統一：course = [編輯/新建課堂/刪除]，lecture = [編輯/匯出/移動/刪除]；移除 course 「快速錄音」（rail 已有按鈕）|
| **W13** | Inbox / Calendar / Trash / Search / Empty Review 5 個 surface empty state visual spec 統一（icon + 文字 + CTA pattern） |

### 9.6 v4 完工 checklist 補增

- [ ] Sprint 0 完工：10 件 foundation 全綠 + tsc clean
- [ ] tauri.conf.json CSP 啟用後所有 H18 page 仍正常 render
- [ ] DOMPurify 換完，Canvas HTML 預覽仍可用 + 加 XSS 測試
- [ ] HTTP allowlist 收緊後 LLM provider / Canvas 仍可連
- [ ] Logout 後 DevTools localStorage 看不到任何 keyStore / settings 殘留
- [ ] keyStore 改加密層後 (P2) 既有 keys 自動 migrate
- [ ] 模擬 quota exceeded 測 localStorage 寫不下 → toast 不 crash
- [ ] Concurrent recording confirm 在 rail / CourseDetail / Inbox 三入口都觸發
- [ ] Migration partial fail 時 (DB 鎖 / 磁碟滿)，schema 維持 v0.7.0 狀態而不是半套
- [ ] Stop pipeline 5 個 toast 合 1 個 (W17)
- [ ] LLM cancel 真斷 HTTP，不只 hide UI

### 9.7 工程量重估

| Sprint | 任務數 | 工程量 | 說明 |
|---|---|---|---|
| **Sprint 0** | 16 (新加 N1/3/4/5/6 + Design System) | 1.5-2 天 | foundation |
| Sprint 1 | 18 (原 14 + 4 安全) | 3-4 天 | + W4/5/6/10/14/15/19/20 + R-1 |
| Sprint 2 | 13 (原 9 + 4 error / UX) | 4 天 | + W7/8/9/17/18 |
| Sprint 3 | 22 (原 16 + 5 schema/UX) | 5-6 天 | + W2/3/11/12/13 |
| Sprint 4 | 8 | 3-4 天 | 不變 |
| **總計** | **77** | **17-20 天** | |

### 9.8 v5 補增（fresh agent rerun + 使用者拍板後）

#### N1-N6 微調（5 fresh agent 中立 rerun 後抓到的細項）

| ID | 項目 | 進 sprint |
|---|---|---|
| N1 | W20 補上 minify on for production (vite build) | 0 / 1 |
| ~~N2~~ | ~~Cargo devtools feature gate~~ | **取消** — by design：使用者透過 Profile → 關於 → DevTools button 開啟 |
| N3 | Windows signing timestampUrl + 寫 docs/build/SIGNING.md | 0 |
| N4 | `H18-TASKINDICATOR-MERGE.md` schema 規範 (offlineQueue + taskTracker dual source) | 0 |
| N5 | setup.ts 加自動 singleton.reset() beforeEach + 強制 contract expose reset() | 0 |
| N6 | setup.ts 加 `MockMediaStreamTrack` jsdom mock | 0 |

#### Design System 萃取（使用者 2026-04-28 拍板）

| 項目 | 內容 |
|---|---|
| **產出文件** | `H18-DESIGN-SYSTEM.md`（已寫，9 sections）|
| **品牌色固定** | `--h18-accent: #d24a1a` (light) / `#ffab7a` (dark) — H18 prototype 來，不擴張不換 |
| **token 補完** | tokens.css 加 6 類缺失 token（spacing / radius / type scale / shadow / z-index / duration / component dims） |
| **TS 對應** | tokens.ts 同步擴充 |
| **新組件強制** | Sprint 3 任何新 module.css 不得 hardcode 顏色/spacing/radius/z-index/font-size，必須用 token |
| **舊組件 sweep** | 留 Phase 8 backlog（不批量 migrate） |
| **範圍**（含/不含） | 含：色 / 字體 / spacing / radius / shadow / z-index / duration / component dims / iconography (1-4 + 6) ；不含：voice & tone (另寫 `H18-WRITING-GUIDE.md`，本 phase 不做) |

### 9.9 Backlog（v5 確認不放）

- API key 進 OS keychain (Phase 8 範圍 — 提升加密層)
- LLM streaming 真正 cancel 跟 partial output 持久化
- 模型下載 checksum 驗證
- Code signing 流程文件化
- Property-based testing
- E2E (Playwright)
- 響應式設計 < 1280px
- 跨平台 visual regression test

---

## 8 · v3 Audit 補遺（2026-04-28 三輪審查後）

審查方向：檔案實體現況 / 資料流 / Schema 一致性 / 邊緣 case / 使用者使用情境 / 程式架構漏洞。

### 8.1 v3 鎖定的新決定

| ID | 項目 | 決定 |
|---|---|---|
| **V1** | F5 reload 顧慮 | **拿掉**（桌面 app 沒 reload 入口） |
| **V2** | 「已過未錄」slot 流向 | **進 Review 直接看，匯入功能在 Review 頁** |
| **V3** | LLM 並行 cap | **拿掉** — 使用者自負成本 |
| **V4** | App close 流程 | **必須同步**: drain + saveSubtitles + saveLecture status; **可延後**: summary / index → 寫進 pending_actions 下次啟動續跑 + 提示 toast |
| **V5** | 多 user 資料切換 | **完整方案**: localStorage prefix user_id + AppSettings.user_id + logout 清 keyStore |
| **V6** | App close confirm | 錄音中 + LLM task 中都 confirm |
| **V7** | Performance virtualization | Sprint 2 加 react-window 給 transcript pane |
| **V8** | ImportModal 升級 | **P1 進 Sprint 4** — Review 頁 hero 「⤓ 匯入材料」dropdown |
| **V9** | Schema 一次到位 | Sprint 3.f-RS 一次跑 5+ 個 ALTER（一次 cargo rebuild） |
| **V10** | TS-only 欄位移除 | `Lecture.keywords / audio_hash` 從 TS 拿掉（永遠沒持久化） |
| **V11** | subtitle.type 重新定義 | 從 `'rough' \| 'fine'` 改 `'live' \| 'imported' \| 'edited'` |
| **V12** | lecture.date 拆欄 | `date` 純 YYYY-MM-DD + 新 `started_at_ms` |
| **V13** | Note schema | summary 抽頂層 column + 加 status / provider |
| **V14** | lecture.status 擴 enum | 加 `'failed' \| 'stopping'`，TS 強制 union |
| **V15** | TaskTracker 持久化 | **重用 pending_actions 表** — 加 SUMMARIZE_LECTURE / INDEX_LECTURE action types |

### 8.2 Schema migration 一次到位（Sprint 3.f-RS）

```sql
-- v0.7.0 → v0.8.0
ALTER TABLE lectures ADD COLUMN started_at_ms INTEGER;
ALTER TABLE lectures ADD COLUMN summary_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE lectures ADD COLUMN summary_provider TEXT;
ALTER TABLE lectures ADD COLUMN import_source TEXT NOT NULL DEFAULT 'live';
ALTER TABLE lectures ADD COLUMN cascade_deleted_with TEXT;

ALTER TABLE notes ADD COLUMN summary TEXT;
ALTER TABLE notes ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE notes ADD COLUMN provider TEXT;
-- one-shot migration
UPDATE notes SET summary = json_extract(content, '$.summary')
  WHERE content LIKE '%"summary"%';

-- multi-user
ALTER TABLE settings ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user';
-- migrate existing: keep current rows with user_id='default_user'
-- new PK consideration: (user_id, key) — but settings 是 single-row JSON 改不了 PK
-- → 解法：app 啟動讀 settings WHERE user_id=current_user OR fallback default

-- subtitle.type 語意重定義（資料層相容）
-- 既有 'rough' → 'live'，'fine' (從沒寫過) → 'edited'
UPDATE subtitles SET type = 'live' WHERE type = 'rough';
-- 新增約束在 TS 端（union type）
```

### 8.3 App close 流程細節（V4）

```
使用者按 ✕ 關 app
    │
    ▼
getCurrentWindow().onCloseRequested(...)
    │
    ▼
偵測 recordingSession.status === 'recording' ?
    │
    ├─ Yes → confirm「正在錄音 (X 分鐘)，要結束並儲存嗎？」
    │         │ Cancel → preventDefault, 不關
    │         └ OK → 跑「最小同步 finalize」(drain + saveSubtitles + status='completed')
    │                 ↓
    │             pending_actions queue:
    │             - { type: 'SUMMARIZE_LECTURE', payload: { lectureId } }
    │             - { type: 'INDEX_LECTURE', payload: { lectureId } }
    │                 ↓
    │             toast 提示「已儲存錄音，摘要 / 索引將於下次開啟時於背景生成」
    │                 ↓
    │             allow window close
    │
    ├─ taskTracker 有 LLM task ? → confirm + 同上 queue 進 pending_actions
    │
    └─ 都沒 → close 直接放行

下次啟動：
    ↓
    App.tsx ready → taskTrackerService.init()
    ↓
    讀 pending_actions WHERE status='pending' AND action_type IN ('SUMMARIZE_LECTURE','INDEX_LECTURE')
    ↓
    開始背景跑（TaskIndicator 顯示「2 個任務恢復執行」）
```

### 8.4 多 user 資料安全（V5）

#### keyStore 必修
```ts
// keyStore.clear(provider) 已存在
// 加 keyStore.clearAll() 清所有 provider/field
// useAuth.logout() 內呼叫
```

#### localStorage prefix
所有 H18 新加 / 既有的 store 加 user_id prefix：
```
classnote-exam-marks-v1:<userId>:<lectureId>
classnote-h18-notes-v1:<userId>:<lectureId>
classnote-h18-ai-history-v1:<userId>
classnote-inbox-state-v1:<userId>:<itemId>
```

`useAuth` 提供 `useCurrentUserId()` hook，stores 內部用。

#### settings table 加 user_id
- 新 column `user_id TEXT NOT NULL DEFAULT 'default_user'`
- read 時 WHERE user_id = current_user
- write 時 INSERT/UPDATE 帶 current user

### 8.5 Review 頁匯入 surface（V2 + V8）

ReviewPage hero 加：
```
[← 返回] [Lecture title]    [✎ 編輯] [⤓ 匯入材料 ▾] [▶ 回放]
                            ↓
            ┌─────────────────────────┐
            │ 📄 匯入投影片 (PDF/PPT)  │ → write lecture.pdf_path
            │ 🎬 匯入影片 (MP4/MKV)    │ → videoImportService + 重 ASR
            │ 🎙 匯入音檔 (WAV/M4A)    │ → audio_path + ASR
            │ ──                       │
            │ 📝 貼字幕 (SRT/VTT/text) │ → subtitleImportService
            │ 📋 貼大綱文字 (補章節)    │ → 寫 note.sections
            └─────────────────────────┘
```

衝突處理：
- 既有同類資料 → confirm「取代 / 合併 / 取消」
- 字幕變動 → mark `summary_status='outdated'` → review 顯示「字幕已更新，建議 ✦ 重新生成摘要」

CourseDetailPage「已過未錄」slot 改邏輯：
- 點 → 建空白 lecture (status='completed', import_source='empty')
- → nav 進 Review
- Review 顯示 empty state + 醒目「⤓ 匯入材料」 CTA

### 8.6 Performance virtualization（V7）

`react-window` 加進 dependencies (~10kb)。
- ReviewPage transcript pane 用 `<FixedSizeList>` 包字幕 row
- 1000+ 句也只 render 視窗內 ~30 個
- `React.memo(SubRow)` 配合 stable key

### 8.7 a11y 全面補（v3 audit 2.8）
新元件 verify checklist：
- ContextMenu: `role="menu"` + `aria-haspopup` + Esc dismiss
- DayPicker: 鍵盤導覽（Arrow keys + Tab） + `aria-label="選擇日期"`
- LectureEditDialog: focus trap + Esc dismiss + initial focus 在第一個 input
- TaskIndicator panel: `aria-live="polite"` for new task announcement
- 所有 button: `aria-label` 給 icon-only buttons

### 8.8 lecture.status 擴 enum（V14）

```ts
type LectureStatus = 
    | 'recording'   // 錄音中（mic 開著）
    | 'stopping'    // finalize 中（同步 drain + save 階段）
    | 'completed'   // 已儲存（含可能跑中的背景 task）
    | 'failed'      // 錄音 / 儲存階段崩潰，需要使用者注意
```

UI 對應：
- `recording` → TopBar 紅膠囊 + RecordingPage live
- `stopping` → TopBar 紅膠囊變黃 + 「儲存中…」label
- `completed` → 正常 review
- `failed` → ReviewPage hero banner「⚠ 此堂課儲存時發生錯誤」+ retry button

### 8.9 完整 verify checklist 補增

- [ ] App close 中錄音 → confirm → finalize → 下次啟動背景跑 summary/index
- [ ] 切 user → 看不到舊 user 設定 / API key / inbox state
- [ ] keyStore 登出後完全清空（DevTools localStorage 看）
- [ ] ReviewPage transcript 1000+ 句滾動順暢，CPU < 30%
- [ ] ReviewPage hero「⤓ 匯入材料」5 種 import 都跑通
- [ ] 「已過未錄」slot → empty lecture → review 看到 import CTA
- [ ] lecture.status='failed' UI 顯示 banner + retry
- [ ] LectureEditDialog 鍵盤可全程操作（Tab / Esc / Enter）
- [ ] DayPicker 鍵盤 Arrow keys 可選日期
- [ ] ContextMenu 開啟後鍵盤 Arrow keys 可選 item

### 8.10 Backlog（不放 Phase 7）

- errorReportService 統一錯誤
- logDiagnostics 整合 + log export UI
- Lazy chunk load（pdfjs / heavy modules）
- CSS token cleanup（extras-* 跟 H18 並存）
- Telemetry / 使用分析
- chat_sessions 從 localStorage 遷到 DB
- Visual regression test
- subtitle end_timestamp / is_exam_mark 入 schema
- course color / archived
- lecture_number column
- SyllabusInfo legacy field cleanup
