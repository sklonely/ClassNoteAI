# Phase 7 · 執行計畫（TDD + Agent 分派 + Verification）

**配對文件**：PHASE-7-PLAN.md（設計）
**這份文件**：怎麼動手、誰先誰後、怎麼驗證
**執行方式**：主 Claude 拆 task → 派 sub-agent 平行執行 → 收檢驗 → tsc → sync → 下一輪

---

## 1 · 開發原則

### 1.1 TDD 紀律
每個 task **強制**順序：
1. 寫測試（先紅）— 描述期望行為
2. 跑 `npx vitest <path>` 確認紅
3. 寫實作（轉綠）
4. 跑測試確認綠
5. 跑全套 `npm test` 確認沒回歸
6. 跑 `npx tsc --noEmit` 確認 type clean

例外：純 UI / CSS 改動沒 testable behavior → 走「視覺驗證」清單。

### 1.2 平行 vs 串行
- **平行條件**：兩個 task **不碰同一個檔案**且**不互為前置依賴**
- **串行條件**：寫同檔案 / 後者 import 前者新 export / 共用 schema migration

主 Claude 看 DAG 派 agent。同 layer 的 task 同時派；下層 task 等上層完成。

### 1.3 Agent 範圍
每個 sub-task 給 sub-agent 的 context：
- 要動的檔案清單（白名單）
- 要寫的測試 + acceptance criteria
- 不准動的檔案（防 conflict）
- 完成後丟回 diff + test result

主 Claude 收 diff → review → tsc → 接著派下個。

---

## 2 · Sprint 1 — Recording Singleton（DAG）

```
                       ┌─────────────────────────────────────┐
                       │ S1.0  Phase 7 Schema bump            │
                       │  (AppSettings.shortcuts type)         │
                       │  (no business logic)                  │
                       └────────────────┬────────────────────┘
                                        │
            ┌───────────────────────────┼─────────────────────┐
            │                           │                     │
   ┌────────▼─────────┐    ┌────────────▼──────────┐   ┌──────▼────────┐
   │ S1.1 recording   │    │ S1.6 visibility +      │   │ S1.9 recovery │
   │ SessionService    │   │ mic readyState         │   │ hint banner   │
   │ (singleton skel) │    │ detection (in S1.1)   │   │ (independent) │
   └────────┬─────────┘    └────────────┬──────────┘   └──────┬────────┘
            │                           │                     │
            └───────────┬───────────────┘                     │
                        │                                     │
            ┌───────────▼─────────────┐                       │
            │ S1.2 useRecordingSession │                       │
            │ thin reader hook         │                       │
            └───────────┬─────────────┘                       │
                        │                                     │
       ┌────────────────┼─────────────────┬───────────────────┤
       │                │                 │                   │
   ┌───▼──────┐   ┌─────▼──────┐    ┌─────▼──────┐    ┌──────▼──────┐
   │ S1.3     │   │ S1.4       │    │ S1.5       │    │ S1.7 + S1.8 │
   │ H18Deep  │   │ H18Record  │    │ H18Review  │    │ U1 confirm  │
   │ App ↔ svc│   │ Page ↔ svc │    │ Page ↔ svc │    │ + N1 sched  │
   └──────────┘   └────────────┘    └────────────┘    └─────────────┘
```

### Sprint 1 任務表

| Task | 依賴 | 平行可？ | 動的檔案 | 對應測試 |
|---|---|---|---|---|
| **S1.0** schema bump | — | — | `src/types/index.ts` | TypeScript compile |
| **S1.1** recordingSessionService | S1.0 | 跟 S1.6/S1.9 平行 | `src/services/recordingSessionService.ts` (新) | `recordingSessionService.test.ts` |
| **S1.6** visibility + mic readyState | S1.1 | inline 進 S1.1（同 PR） | 同 S1.1 | 同 S1.1 test |
| **S1.9** recovery hint banner | — | 完全獨立 | `src/components/h18/RecoveryHintBanner.tsx`, `H18ReviewPage.tsx` (1 行 mount) | `RecoveryHintBanner.test.tsx` |
| **S1.2** useRecordingSession thin reader | S1.1 | 跟 S1.9 平行 | `src/components/h18/useRecordingSession.ts` | `useRecordingSession.test.ts` |
| **S1.3** H18DeepApp 改 subscribe | S1.2 | 跟 S1.4 / S1.5 / S1.7 / S1.8 平行（不同檔） | `src/components/h18/H18DeepApp.tsx` | smoke test (component renders without polling) |
| **S1.4** H18RecordingPage 適配 | S1.2 | 跟 S1.3 平行 | `src/components/h18/H18RecordingPage.tsx` | `H18RecordingPage.test.tsx` (mock service) |
| **S1.5** H18ReviewPage 適配 | S1.2 | 跟 S1.3 平行 | `src/components/h18/H18ReviewPage.tsx` | 沿用既有測試 |
| **S1.7** U1 concurrent confirm | S1.3 (同檔) | 不能 | `src/components/h18/H18DeepApp.tsx` | `H18DeepApp.test.tsx` (test confirm flow) |
| **S1.8** N1 scheduledDate thread | S1.7 (同函數) | 不能 | `src/components/h18/H18DeepApp.tsx` + `H18Inbox.tsx` (傳 prop) | sym test for date prop |

### Sprint 1 dispatch plan

**Round 1** (3 agent 平行):
- Agent A: S1.0 + S1.1 + S1.6 (在同一個 commit)
- Agent B: S1.9 (獨立 component)
- Agent C: 寫 test 框架 setup（如果還沒）

**Round 2** (S1.1 完成後):
- Agent A: S1.2

**Round 3** (S1.2 完成後, 4 agent 平行):
- Agent B: S1.3
- Agent C: S1.4
- Agent D: S1.5
- Agent E: S1.7 + S1.8（同檔不能再分）

**Round 4** (彙整 + 驗收)
- 主 Claude tsc + npm test + 手動 smoke
- diff review → commit
- sync 使用者

### Sprint 1 verify checklist

**自動測試**：
- [ ] `recordingSessionService` state machine 測試：idle → recording → paused → recording → stopped
- [ ] `subscribe()` callback fires on each transition
- [ ] `start()` 同時被呼叫兩次只實際啟動一次（idempotent）
- [ ] visibilitychange hidden 60s + 回來 → 偵測 mic readyState
- [ ] `RecoveryHintBanner` mount 條件正確
- [ ] `useRecordingSession` hook return shape 沒變（不破現有 caller）

**手動 smoke**：
- [ ] 啟動 → 進 recording page → 按 ● 開始錄音 → 看到 segments
- [ ] 切到 home → TopBar 紅膠囊還在
- [ ] 切回 recording page → elapsed 連續、segments 沒丟
- [ ] 系統 sleep 模擬（DevTools → Console → `Object.defineProperty(document, 'visibilityState', { value: 'hidden' })` + dispatchEvent('visibilitychange'）→ 60s → 反向 → 看 toast
- [ ] 在 recording 中點 inbox 「下一堂課」→ confirm dialog 跳出
- [ ] confirm「結束」→ 等舊 finalize → 開新 session

---

## 3 · Sprint 2 — Stop Pipeline + Streaming Summary（DAG）

```
                ┌──────────────────────────┐  ┌──────────────────────────┐
                │ S2.1 taskTrackerService  │  │ S2.2 translationPipeline │
                │ (新 singleton)            │  │ .awaitDrain()             │
                └────────────┬─────────────┘  └──────────────┬───────────┘
                             │                                │
                             └─────────────┬──────────────────┘
                                           │
                              ┌────────────▼──────────────┐
                              │ S2.3 recordingSession      │
                              │ Service.stop() 6-step      │
                              │ pipeline (drain → save     │
                              │ subtitles → summary task   │
                              │ → index task → done)        │
                              └────┬─────────────────┬─────┘
                                   │                 │
                ┌──────────────────┤                 ├────────────────────┐
                │                  │                 │                    │
       ┌────────▼─────────┐ ┌──────▼───────┐  ┌──────▼─────────┐ ┌───────▼───────┐
       │ S2.4 ReviewPage  │ │ S2.5 TaskIndi│  │ S2.6 U3 retry  │ │ S2.8 N4 update│
       │ streaming summary│ │ cator subscr │  │ button on fail │ │ globalSearch  │
       │ (gray → black)   │ │ taskTracker  │  │                │ │ on saveSubs   │
       └──────────────────┘ └──────────────┘  └────────────────┘ └───────────────┘
                                                       │
                                              ┌────────▼─────────┐
                                              │ S2.7 U2 cancel    │
                                              │ on summary regen  │
                                              │ (depends S2.6)    │
                                              └───────────────────┘
```

### Sprint 2 任務表

| Task | 依賴 | 平行可？ | 動的檔案 | 對應測試 |
|---|---|---|---|---|
| **S2.1** taskTrackerService | — | 跟 S2.2 平行 | `src/services/taskTrackerService.ts` (新) | `taskTrackerService.test.ts` |
| **S2.2** translationPipeline.awaitDrain | — | 跟 S2.1 平行 | `src/services/streaming/translationPipeline.ts` | `translationPipeline.test.ts` (extend 既有) |
| **S2.3** stop() 6-step pipeline | S2.1, S2.2 | — | `src/services/recordingSessionService.ts` (從 Sprint 1 來) | `recordingSessionService.stop.test.ts` |
| **S2.4** ReviewPage streaming summary | S2.1, S2.3 | 跟 S2.5 / S2.6 / S2.8 平行（不同檔） | `src/components/h18/H18ReviewPage.tsx` | `H18ReviewPage.summary.test.tsx` |
| **S2.5** TaskIndicator subscribe | S2.1 | 跟 S2.4 / S2.6 / S2.8 平行 | `src/components/TaskIndicator.tsx` (rewrite) | `TaskIndicator.test.tsx` |
| **S2.6** U3 retry button | S2.1, S2.4 (同檔) | 跟 S2.5 平行 | `H18ReviewPage.tsx` | inline 進 S2.4 test |
| **S2.7** U2 cancel-on-regen | S2.6 | — | `H18ReviewPage.tsx` | inline test |
| **S2.8** N4 globalSearch reindex | S2.3 | 跟 S2.4 / S2.5 平行 | `src/services/globalSearchService.ts` | `globalSearchService.test.ts` (extend) |

### Sprint 2 dispatch plan

**Round 1** (2 agent 平行):
- Agent A: S2.1 (taskTrackerService) + tests
- Agent B: S2.2 (translationPipeline awaitDrain) + tests

**Round 2** (S2.1+S2.2 完成):
- Agent A: S2.3 (rewrite stop pipeline) + integration tests

**Round 3** (S2.3 完成, 3 agent 平行):
- Agent B: S2.4 + S2.6 + S2.7（同檔，serial 在內）
- Agent C: S2.5
- Agent D: S2.8

**Round 4** verify

### Sprint 2 verify checklist

**自動測試**：
- [ ] taskTracker state transitions: queued → running → done / failed / cancelled
- [ ] taskTracker.subscribe 在每次 update fire
- [ ] taskTracker.cancel 中斷 running
- [ ] translationPipeline.awaitDrain 在 queue 空時立即 resolve
- [ ] awaitDrain 在 queue 還有 jobs 時等到 drain 完成
- [ ] recordingSessionService.stop() 真的呼叫 saveSubtitles + summarize + indexLecture（mock 三者）
- [ ] stop() 在 LLM provider 失敗時：lecture status='completed' 仍寫，summary task 標 failed
- [ ] ReviewPage 看到 streaming summary chunk 是灰色，done 後變黑
- [ ] retry button 觸發新 task，舊 failed task 標記 cancelled
- [ ] saveSubtitles 後 globalSearchService.search() 找得到字幕內容

**手動 smoke**：
- [ ] 錄 30 秒 → 結束 → 進 review
- [ ] 看到字幕完整列表 + 章節 + AI 摘要 streaming
- [ ] 摘要文字一段段灰色出現，完成後變黑
- [ ] TopBar TaskIndicator 顯紅圈跳數字
- [ ] 故意把 LLM key 拔掉 → 結束 → 進 review → 看到 「✦ 失敗 · [重試]」
- [ ] 點重試 → 跑新 task

---

## 4 · Sprint 3 — Polish（DAG）

```
                          無 (independent)
        ┌──────────────────────┼──────────────────────────┐
        │                      │                          │
  ┌─────▼─────┐         ┌──────▼──────┐           ┌───────▼─────┐
  │ S3a       │         │ S3b         │           │ S3e         │
  │ keymap    │         │ contextmenu │           │ exportSrv   │
  │ + UI       │        │ suppression │           │ (SRT + MD)  │
  └─────┬─────┘         │ + text menu │           └─────┬───────┘
        │               └─────┬───────┘                 │
        ▼                     ▼                         │
  跨 8 處顯示 sync       全域 listener                    │
                              ▲                         │
                              │                         │
  ┌──────────────┐    ┌───────┴──────┐         ┌───────▼──────┐    ┌────────────┐
  │ S3g          │    │ S3c           │        │ S3d          │    │ S3h        │
  │ PTranslate   │    │ LectureEdit   │←       │ Lecture ctx  │    │ Stop       │
  │ Gemma DL     │    │ Dialog +      │  ┐     │ menu (依 S3c │    │ confirm    │
  │ (S2.5 取依)  │    │ DayPicker     │  │     │ + S3e + S3f) │    │ (用 S3a kbd)│
  └──────────────┘    └───────────────┘  │     └──────────────┘    └────────────┘
                                          │              ▲
                              ┌───────────┘              │
                              │                          │
                       ┌──────▼─────────────┐            │
                       │ S3f Trash UI       │            │
                       │ (前端 + Rust 後端) │────────────┘
                       │ delete cascade,    │
                       │ list/restore/clean │
                       └────────────────────┘
```

### Sprint 3 任務表

| Task | 依賴 | 平行可？ | 動的檔案 | 對應測試 |
|---|---|---|---|---|
| **S3a-1** keymapService + utils/kbd | — | 跟 b/e/g/h 平行 | `src/services/keymapService.ts`, `src/utils/kbd.ts` (新) | `keymapService.test.ts`, `kbd.test.ts` |
| **S3a-2** PKeyboard sub-pane | S3a-1 | 跟 b/e/f/g/h 平行 | `src/components/h18/ProfilePage.tsx` (加 tab), `ProfilePanes.tsx` (新 PKeyboard 元件) | `PKeyboard.test.tsx` |
| **S3a-3** 替換顯示處 | S3a-1 | 跟 b/e/f/g/h 平行 | H18TopBar / DraggableAIFab / H18AIPage / H18Preview / SearchOverlay / PAppearance / H18RecordingPage（多檔但每檔小） | snap test 或視覺 |
| **S3a-4** 替換 keydown handlers | S3a-1 | 跟 a-3 平行（不同檔） | H18DeepApp.tsx, H18RecordingPage.tsx | unit test |
| **S3b-1** H18ContextMenu generic | — | 跟 a/e/f/g/h 平行 | `src/components/h18/H18ContextMenu.tsx` (新) | `H18ContextMenu.test.tsx` |
| **S3b-2** H18TextContextMenu + 全域 listener | S3b-1 | 跟 a-3 平行 | `H18TextContextMenu.tsx`, `H18DeepApp.tsx` (1 處 effect) | `H18TextContextMenu.test.tsx` |
| **S3c-1** H18DayPicker | — | 跟 a/b/e/f/g/h 平行 | `src/components/h18/H18DayPicker.tsx` + .module.css (新) | `H18DayPicker.test.tsx` |
| **S3c-2** LectureEditDialog | S3c-1 | 跟 a/b/e/f/g/h 平行 | `src/components/h18/LectureEditDialog.tsx` (新), `H18ReviewPage.tsx` (hero ✎ button) | `LectureEditDialog.test.tsx` |
| **S3d** Lecture context menu | S3c-2, S3e, S3f-FE | — | `LectureContextMenu.tsx` (新), `CourseDetailPage.tsx` (hookup) | `LectureContextMenu.test.tsx` |
| **S3e** exportService | — | 跟 a/b/c/f/g/h 平行 | `src/services/exportService.ts` (新) | `exportService.test.ts` |
| **S3f-RS** Rust cascade + new commands | — | 跟 FE 平行（不同 lang） | `src-tauri/src/storage/database.rs`, `src-tauri/src/lib.rs` | `database.rs` `#[cfg(test)]` |
| **S3f-FE** Trash UI overhaul | S3f-RS | — | `ProfilePanes.tsx` PData section | `PData.test.tsx` |
| **S3g** PTranslate Gemma download | S2.5 (TaskIndicator) | 跟 a/b/c/d/e/f/h 平行 | `ProfilePanes.tsx` PTranslate | `PTranslate.test.tsx` |
| **S3h** Stop confirm | S3a-1（用 keymapLabel） | 跟 a/b/c/e/f/g 平行 | `H18RecordingPage.tsx` | inline test |

### Sprint 3 dispatch plan

**Round 1** (8 agent 平行 — 最大平行度):
- Agent A: S3a-1 (keymap)
- Agent B: S3b-1 (context menu base)
- Agent C: S3c-1 (DayPicker)
- Agent D: S3e (export)
- Agent E: S3f-RS (Rust)
- Agent F: S3g (Gemma DL)
- Agent G: S3h (stop confirm)
- Agent H: 寫 test 框架 hooks if needed

**Round 2** (各自完成後):
- Agent A: S3a-2 + S3a-3 + S3a-4
- Agent B: S3b-2
- Agent C: S3c-2
- Agent E: S3f-FE

**Round 3**:
- Agent X: S3d (整合)

**Round 4** verify

### Sprint 3 verify checklist

**自動測試**：
- [ ] `kbd.parseCombo('Mod+K')` → `{ mod: true, key: 'k' }`
- [ ] `kbd.formatLabel(combo, 'mac')` → `'⌘K'`
- [ ] `kbd.formatLabel(combo, 'win')` → `'Ctrl+K'`
- [ ] `keymapService.set('search', 'Mod+P')` → emits 'shortcuts-changed' event
- [ ] `keymapService.set('search', 'Mod+J')` (跟 toggleAiDock 撞) → throws / rejects
- [ ] `keymapService.matchesEvent('search', { metaKey: true, key: 'k' })` → true
- [ ] PKeyboard 編輯 row capture 模式工作
- [ ] H18ContextMenu render menu items + onClick
- [ ] H18TextContextMenu cut/copy/paste 用 execCommand 觸發
- [ ] 全域 contextmenu listener 偵測 INPUT / TEXTAREA → 彈我們的，其他 preventDefault
- [ ] H18DayPicker 點 day → onChange(date)
- [ ] H18DayPicker prev/next month 切換 grid
- [ ] LectureEditDialog form validation + 儲存 call storageService.saveLecture
- [ ] LectureContextMenu items render + sub-menu hover 展開
- [ ] exportService.exportLectureSRT → 標準 SRT 格式（測 srt validator）
- [ ] exportService.exportLectureMarkdown → 期望 markdown
- [ ] Rust `delete_course` cascade → lectures 也被軟刪
- [ ] `list_trashed_lectures` 回傳 deleted 的 lectures
- [ ] `restore_lecture` 翻 is_deleted=0
- [ ] `hard_delete_trashed_older_than(30)` 永久刪 > 30 天 trashed
- [ ] PData 階層樹 render 正確
- [ ] PTranslate 「下載」按鈕點下去 → invoke download_gemma_model → progress event 顯示
- [ ] Stop confirm → cancel → 仍在錄音

**手動 smoke**：
- [ ] PKeyboard 改 search 為 Ctrl+P → 全 app 顯示更新 → 鍵盤敲 Ctrl+P 真開搜
- [ ] textarea 內右鍵 → 跳 H18 menu，剪/貼/複真的 work
- [ ] 空白處右鍵 → 不彈瀏覽器原生
- [ ] hero ✎ → modal 開 → 改 title 儲存 → review 麵包屑改了
- [ ] 改 course → modal 關 → review 跳到 `review:NEW_cid:lid`
- [ ] 右鍵 lecture → 匯出 → SRT → 寫到桌面 → 用 VLC 開正常
- [ ] 右鍵 lecture → 移動到 → CS → 跳新 course
- [ ] 右鍵 lecture → 刪除 → trash 看到
- [ ] 在 trash 救 lecture（屬於存活 course）→ restore
- [ ] 在 trash 救 lecture（屬於已刪 course）→ confirm「需連同 course」→ 兩條都 restore
- [ ] 啟動 → toast「已永久清除 N 個...」（先手動 SQL update 製造 > 30 天 trashed）
- [ ] PTranslate 沒模型 → 「下載」→ progress → 完成 → 「啟動」→ sidecar running
- [ ] 結束按下去 → confirm → 確認 → finalize 跑

---

## 5 · 主 Claude 的 Verification Routine

每個 sprint 結束 + 每個 agent diff 收回時跑：

```bash
# 1. Type check
npx tsc --noEmit

# 2. Unit + integration tests
npm test

# 3. Test coverage (新加的 logic 應該都有測)
npm run test:coverage -- --reporter=text-summary

# 4. Lint (if exists)
# (project uses TypeScript strict; no eslint config seen — skip or add later)

# 5. Manual smoke
npm run tauri:dev
# 走 verify checklist
```

**不通過的不接 commit**。Agent 回傳的 diff 如果 tsc / test 不過，主 Claude 修補或退回 agent 修。

---

## 6 · 測試框架

### TS / React 測試
- **Vitest** (existing)
- `@testing-library/react` (existing)
- `@testing-library/user-event` (existing)
- `jsdom` (existing)

### 服務 singleton 測試模式
```ts
// recordingSessionService.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordingSessionService } from '../recordingSessionService';

beforeEach(() => {
  recordingSessionService.reset(); // 每個 test 前 reset state
});

it('start() transitions idle → recording', async () => {
  // mock AudioRecorder, transcriptionService
  await recordingSessionService.start({ courseId: 'c1', lectureId: 'l1' });
  expect(recordingSessionService.getState().status).toBe('recording');
});
```

### React 元件測試模式
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LectureEditDialog from '../LectureEditDialog';

it('儲存按鈕呼叫 onSubmit', async () => {
  const onSubmit = vi.fn();
  render(<LectureEditDialog isOpen lecture={mockLec} onSubmit={onSubmit} ... />);
  await userEvent.type(screen.getByLabelText('標題'), 'New Title');
  await userEvent.click(screen.getByRole('button', { name: '儲存' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'New Title' }));
});
```

### Rust 後端測試
- 用既有 `#[cfg(test)] mod tests {}` pattern
- in-memory SQLite (`Connection::open_in_memory()`)

### 視覺驗證
跑 dev → 走 Sprint checklist 手動跑一輪。重要 surface 截圖存 `docs/design/h18-deep/checkpoints/screenshots/cp-7.X-*.png`。

---

## 7 · 失敗 / 退回流程

每個 task agent 完成後可能有 4 種狀態：

| 狀態 | 主 Claude 動作 |
|---|---|
| ✅ 全綠 + diff 乾淨 | accept，下個 task |
| 🟡 測試綠但 diff 有問題 | refactor request，再派 |
| 🔴 測試紅 / tsc 紅 | 退回 agent 修；最多 2 輪；第 3 輪主 Claude 直接接手 |
| ⚠️ scope creep（動了不准動的檔）| revert + 退回 + 強調白名單 |

---

## 8 · 文件 maintain

主 Claude 持續更新：
- `PHASE-7-PLAN.md` § 5 完工 checklist 打勾
- `PHASE-7-EXECUTION.md` § 各 sprint 任務表加「✓ 完成 commit hash」
- 每個 sprint 結束開 `checkpoints/CP-7.X.md`（沿 P6 慣例），描述：
  - 範圍 / 改了什麼 / 沒接的 / 下一步
- 完整 P7 結束開 `CP-7.summary.md`

---

## 9 · 跨 sprint 累計回歸面

每個 sprint 結束後跑：

```
✓ 全套 npm test (coverage 不能下降)
✓ tsc --noEmit clean
✓ npm run tauri:dev 起得來
✓ 錄一段 30s 走完整 user journey 沒 console error
✓ 之前 sprint 的 verify checklist 沒回歸
```

P6 既有 27 條視覺 / wiring 驗收（issue report 列的 ✓ 已正常運作那塊）每 sprint 都要 sample 5 條 cross-check 沒破。

---

## 10 · 預估時間 + 派 agent 數量

| Sprint | 任務數 | 並行峰值 | 工程量（active days） |
|---|---|---|---|
| S1 | 14 | 4 agents | 3 天 |
| S2 | 9 | 3 agents | 3-4 天 |
| S3 | 16 | 8 agents（最大平行） | 4-5 天 |
| S4 | 8 | 3 agents | 3-4 天 |
| **總計** | **47** | — | **13-16 天** |

agents 是邏輯上 — 主 Claude 是序列在 dispatch，但 sub-agent 內部可以平行做 file edit。

---

## 11 · TL;DR — 主 Claude 接下「OK 開工」後的第一步

1. 開 `feat(h18-cp71): Phase 7 schema + recordingSessionService skeleton + tests` 分支不分（同 `feat/h18-design-snapshot`）
2. 先寫 `recordingSessionService.test.ts`（紅）
3. 派 sub-agent 寫 `recordingSessionService.ts` 實作（轉綠）
4. tsc + test → green
5. 報 commit hash + diff summary 給使用者
6. 等 OK 接下個 task

預期第一個 commit 大約 ~300 行新增 + ~50 行 modify，30-60 分鐘。

---

## 12 · v3 Audit 後新加 task（2026-04-28）

### Sprint 1 補增 task

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **S1.10** App `onCloseRequested` confirm flow | `src/App.tsx` (新 effect)，`src/services/recordingSessionService.ts` (expose `mustFinalizeSync()`) | `App.close.test.tsx` |
| **S1.11** Logout 清 keyStore + AppSettings user_id 切換 | `src/contexts/AuthContext.tsx`, `src/services/llm/keyStore.ts` (加 `clearAll()`) | `AuthContext.test.tsx` |
| **S1.12** localStorage stores 全部 prefix user_id | `inboxStateService.ts`, `userNotesStore.ts`, `useAIHistory.ts`, `examMarksStore.ts` | 各自 test |
| **S1.13** useService hook 統一 subscription cleanup | `src/components/h18/useService.ts` (新) | `useService.test.tsx` |
| **S1.14** recordingDeviceMonitor 整合進 singleton | `recordingSessionService.ts` 內接 monitor + toast | inline test |

### Sprint 2 補增 task

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **S2.9** TaskTracker 持久化用 pending_actions 表 | `taskTrackerService.ts`, `App.tsx` 啟動 init scan | `taskTrackerService.persistence.test.ts` |
| **S2.10** lecture.status enum 擴展 + UI 適配 | `types/index.ts`, `H18ReviewPage.tsx` (failed banner) | unit |
| **S2.11** subtitle.timestamp 改 relative seconds + legacy migration | `recordingSessionService.stop()`, `globalSearchService.ts` (re-index) | integration |
| **S2.12** react-window virtualization for transcript pane | `H18ReviewPage.tsx`, `H18RecordingPage.tsx` SubPane | manual perf |

### Sprint 3 補增 task

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **S3.f-RS-2** Schema migration 一次到位（lectures + notes 新 columns） | `src-tauri/src/storage/database.rs` migration block | Rust `#[cfg(test)]` |
| **S3.f-RS-3** delete_course cascade 寫 cascade_deleted_with | `src-tauri/src/storage/database.rs` | Rust test |
| **S3.f-RS-4** restore_course 反向 cascade（cascade_deleted_with == course_id 才救） | `database.rs` | Rust test |
| **S3.i** a11y verify 各新 component | 各新 component | manual |

### Sprint 4 詳細任務（升 P1）

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **S4.1** ReviewImportMenu component（hero dropdown） | `src/components/h18/ReviewImportMenu.tsx` (新) | `ReviewImportMenu.test.tsx` |
| **S4.2** PDF 匯入 flow + 衝突 confirm | `ReviewImportFlow.tsx` (新) | unit |
| **S4.3** 影片匯入 flow（接 videoImportService） | 同上 + `videoImportService.ts` (既有) | integration |
| **S4.4** 音檔匯入 flow + ASR | 同上 | integration |
| **S4.5** 字幕貼上 flow（接 subtitleImportService） | 同上 + `subtitleImportService.ts` (既有) | unit |
| **S4.6** 大綱貼上 → 寫 note.sections | 同上 | unit |
| **S4.7** CourseDetailPage「已過未錄」slot 改 nav-only | `CourseDetailPage.tsx` (改 handleOpenPastSlot) | unit |
| **S4.8** lecture.import_source UI 對應 (audio scrubber 條件顯示) | `H18ReviewPage.tsx` | unit |

### v3 連動的 PHASE-7-PLAN § 5 verify checklist 補增

(已寫進 PHASE-7-PLAN.md § 8.9)

---

## 13 · v4 補增 (2026-04-28 5-agent 中立審查後)

### 13.0 Sprint 0 · Foundation 任務表（必須在 Sprint 1 開工前完成）

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **S0.1** setup.ts 加 `afterEach(cleanup)` | `src/test/setup.ts` | smoke (既有 test 仍綠) |
| **S0.2** 共用 fixtures | `src/test/h18-fixtures.ts` (新) | self-test |
| **S0.3** LLM async generator mock 範例 | `src/test/h18-llm-mocks.ts` (新) | self-test |
| **S0.4** Rust DB test harness | `src-tauri/src/storage/database_test.rs` (新) — in-memory SQLite + helpers | Rust `#[cfg(test)]` |
| **S0.5** recordingSessionService contract | `src/services/__contracts__/recordingSessionService.contract.ts` (新) | type-only |
| **S0.6** taskTrackerService contract | `src/services/__contracts__/taskTrackerService.contract.ts` (新) | type-only |
| **S0.7** keymapService contract | `src/services/__contracts__/keymapService.contract.ts` (新) | type-only |
| **S0.8** Modal Z-index / Esc / focus trap 規範 | `docs/design/h18-deep/H18-MODAL-CONVENTIONS.md` (新) | doc only |
| **S0.9** useService cleanup hook | `src/components/h18/useService.ts` (新) | `useService.test.tsx` |
| **S0.10** CSP 草稿 + dev smoke | `tauri.conf.json` (改 csp 從 null 改成 dev 草稿) | `tauri:dev` 起得來 |

**Round 1** (10 agent 平行 — Sprint 0 全平行)

### 13.1 Sprint 1 補增 task

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **W4** CSP 完整啟用 (production-grade) | `src-tauri/tauri.conf.json` | smoke + Canvas modal render |
| **W5** rehype-raw 改 DOMPurify | `H18Preview.tsx`, `CanvasItemPreviewModal.tsx`, `package.json` (加 isomorphic-dompurify) | XSS test |
| **W6** HTTP allowlist 收緊 | `src-tauri/capabilities/default.json` | smoke (LLM + Canvas 仍可) |
| **W10** concurrent recording confirm 掛全入口 | `H18DeepApp.tsx` startNewLectureFor / handleCourseAction / inbox handler | unit |
| **W14** localStorage write try-catch | `inboxStateService.ts`, `userNotesStore.ts`, `useAIHistory.ts`, `examMarksStore.ts`, `keyStore.ts` | quota mock test |
| **W15** MediaStreamTrack.onended 訂閱 | `recordingSessionService.ts` | track ended mock |
| **W19** 全域 console wrapper redact | `src/services/loggerService.ts` (新) + `src/main.tsx` boot | redaction test |
| **W20** release build sourcemap off | `vite.config.ts` | build output 不含 .map |
| **R-1** logout 連帶 reset singleton | `AuthContext.tsx` + recordingSession + taskTracker | logout flow test |

### 13.2 Sprint 2 補增 task

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **W7** map-reduce per-section error catch | `services/llm/tasks.ts` summarizeStream | error injection test |
| **W8** AbortController 真接 | `services/llm/tasks.ts` summarizeStream + chatStream + 各 caller | cancel test |
| **W9** translationPipeline queue cap | `services/streaming/translationPipeline.ts` | overflow test |
| **W17** Toast coalescing 策略 | `recordingSessionService.stop()` 統合，少跳 toast | manual smoke |
| **W18** TaskTracker done sticky toast | `taskTrackerService.ts` complete handler | flow test |

### 13.3 Sprint 3 補增 task

| Task | 動的檔案 | 對應測試 |
|---|---|---|
| **W2** Schema migration TRANSACTION 包 atomic | `src-tauri/src/storage/database.rs` migration block | partial fail rollback test |
| **W3** Rust DB test 為 cascade / restore / hard_delete | `src-tauri/src/storage/database_test.rs` (續 S0.4) | Rust unit |
| **W11** Modal popover behavior 落實 | `LectureEditDialog.tsx`, `H18DayPicker.tsx` 改 popover | Esc behavior test |
| **W12** course / lecture context menu 結構統一 | `CourseRailContextMenu.tsx` 改; `LectureContextMenu.tsx` 新 | unit |
| **W13** empty state visual spec 5 surface | `H18Inbox.tsx`, `H18Calendar.tsx`, PData trash, `SearchOverlay.tsx`, `H18ReviewPage.tsx` empty | snap test |

### 13.4 dispatch plan 更新

**Sprint 0 dispatch plan**:
- Round 1 (10 平行): S0.1 ~ S0.10 全部不同檔案，全平行
- Round 2: 主 Claude 收 verify
- 預期 1 commit `feat(h18-cp70): Phase 7 foundation`

**Sprint 1 dispatch plan v4**:
- Round 1 (4 平行 W4/W5/W6/W19): 純 config / 換套件
- Round 2 (S1.0 ~ S1.6): singleton + recordingDeviceMonitor (依賴 S0.5 contract)
- Round 3 (S1.7-9 + W10/W14/W15/W20): downstream + 安全收尾 + multi-user store prefix

### 13.5 v4 工程量（已被 v5 取代，見下節）

---

## 14 · v5 補增（fresh agent rerun 後 + 使用者 2026-04-28 拍板）

### 14.1 Sprint 0 任務表 v5（從 10 → 16 task）

| Task | 動的檔案 | 對應測試 / 產出 |
|---|---|---|
| **S0.1** setup.ts 加 `afterEach(cleanup)` | `src/test/setup.ts` | 既有 test 仍綠 |
| **S0.2** 共用 fixtures | `src/test/h18-fixtures.ts` (新) | self-test |
| **S0.3** LLM async generator mock 範例 | `src/test/h18-llm-mocks.ts` (新) | self-test |
| **S0.4** Rust DB test harness | `src-tauri/src/storage/database_test.rs` (新) — in-memory SQLite | Rust `#[cfg(test)]` |
| **S0.5** recordingSessionService contract | `src/services/__contracts__/recordingSessionService.contract.ts` (新) | type-only |
| **S0.6** taskTrackerService contract | `src/services/__contracts__/taskTrackerService.contract.ts` (新) | type-only |
| **S0.7** keymapService contract | `src/services/__contracts__/keymapService.contract.ts` (新) | type-only |
| **S0.8** Modal Z-index / Esc / focus trap 規範 | `docs/design/h18-deep/H18-MODAL-CONVENTIONS.md` (新) | doc only |
| **S0.9** useService cleanup hook | `src/components/h18/useService.ts` (新) | `useService.test.tsx` |
| **S0.10** CSP 草稿 + dev smoke | `tauri.conf.json` | `tauri:dev` 起得來 |
| **S0.11** 🆕 補完 tokens.css 6 類缺失 token | `src/styles/tokens.css`, `tokens.ts` (擴充) | `tokens.test.ts` 驗 token 引用一致 |
| **S0.12** 🆕 寫 H18-DESIGN-SYSTEM.md (1-4+6) | `docs/design/h18-deep/H18-DESIGN-SYSTEM.md` (已寫) | doc only |
| **S0.13** 🆕 setup.ts MediaStreamTrack jsdom mock | `src/test/setup.ts` | 對應 S1.6 test |
| **S0.14** 🆕 Singleton beforeEach reset 自動化 | `src/test/setup.ts` | services contract enforce reset() |
| **S0.15** 🆕 H18-TASKINDICATOR-MERGE.md 規範 | `docs/design/h18-deep/H18-TASKINDICATOR-MERGE.md` (新) | doc only |
| **S0.16** 🆕 docs/build/SIGNING.md + Win timestampUrl | `docs/build/SIGNING.md` (新), `tauri.conf.json` 補 `timestampUrl` | doc + smoke build |

**dispatch plan**：Round 1 全 16 task 平行（每個動的檔案不同），約 1.5-2 天合併。

### 14.2 Sprint 1 v5 微調

W20 改寫如下（吃 N1）：

| Task | 動的檔案 | 補強 |
|---|---|---|
| **W20** release build 配置 | `vite.config.ts` | sourcemap off **+ minify: 'terser' for production** (吃 N1) |

(其他 v4 W4/5/6/10/14/15/19 + R-1 不變)

### 14.3 Sprint 3 增加：Token migration sweep 守則

Sprint 3 各 sub-agent 寫新 component 時：
- 必須用 `var(--h18-*)` token，**禁止** hardcode `padding: 14px` / `border-radius: 6px` / `font-size: 12px` / `color: #...` / `z-index: 100`
- code review (主 Claude 收回 diff) 抓 hardcoded 用 grep `grep -E "padding: [0-9]+px|font-size: [0-9]+px|z-index: [0-9]+|border-radius: [0-9]+px" *.module.css`
- 違反 → 退回 sub-agent 重寫

### 14.4 v5 工程量

```
Sprint 0  · 16 task · 1.5-2 day  (10 → 16, +6 task: design system + N1/3/4/5/6)
Sprint 1  · 18 task · 3-4 day    (W20 補強，工作量略增)
Sprint 2  · 13 task · 4 day      (不變)
Sprint 3  · 22 task · 5-6 day    (token sweep 守則加入)
Sprint 4  ·  8 task · 3-4 day    (不變)
總計      · 77 task · 17-20 day
```

跟 v4 比 +1 天（多在 Sprint 0）。換來 design system 萃取 + 5 fresh agent 抓的微妙 finding。

### 14.5 開工順序更新（覆蓋 § 11）

1. 開 `feat(h18-cp70.0): Phase 7 foundation (S0.1-S0.16)` 一個 commit
   - 含 setup.ts cleanup + fixtures + LLM mocks + Rust test harness + 3 個 contract + Modal conventions doc + useService hook + CSP draft + tokens 補完 + design system doc + MediaStreamTrack mock + singleton reset + TaskIndicator merge spec + signing doc
2. tsc + npm test + rust test + tauri:dev smoke → green
3. 報 commit hash + diff stats 給使用者
4. 等 OK 開 Sprint 1（cp71）
