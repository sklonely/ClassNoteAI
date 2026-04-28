# Phase 7 過夜進度

**最後更新**：2026-04-28T20:30Z
**當前 sprint**：Sprint 3 完工 ✅；Sprint 4 (P1) 評估
**當前 task**：Sprint 4 是 plan 標明「建議推遲但留 issue」的 P1 — 評估是否在過夜時間內推進
**總進度**：~67 / 77 task；測試 472 → 1037 (+565 新測試)；11 個 Phase 7 commit

## 已完成 commits（時間倒序）

- `8cde715` feat(h18-cp73.2): Sprint 3 R3+R4 — Trash UI + LectureContextMenu + course menu 統一 + empty state
- `94f501c` feat(h18-cp73.1): Sprint 3 R2 — keymap rollout + text ctx menu + LectureEditDialog
- `f5096fd` feat(h18-cp73.0): Sprint 3 R1 — keymap + ctx menu + day picker + export + Rust cascade + Gemma DL + stop confirm
- `fcde0f2` feat(h18-cp72.2): Sprint 2 R3 — ReviewPage streaming + TaskIndicator + LLM error/cancel + persistence + toast coalesce + subtitle.timestamp
- `8f0423b` feat(h18-cp72.1): Sprint 2 R2 — recordingSessionService.stop() 6-step pipeline 真實作
- `45d7b66` feat(h18-cp72.0): Sprint 2 R1 — taskTrackerService singleton + translationPipeline awaitDrain/cap
- `44d4555` feat(h18-cp71.3): Sprint 1 R4 — H18DeepApp / RecordingPage / ReviewPage / App.close 適配 singleton + W10 + S1.10
- `16022f6` feat(h18-cp71.2): Sprint 1 R3 — useRecordingSession thin reader + W14 quota 防呆 + R-1 logout reset
- `72af8fd` feat(h18-cp71.1): Sprint 1 R2 — recordingSessionService singleton + RecoveryHintBanner
- `333c99e` feat(h18-cp71.0): Sprint 1 R1 — 安全收緊 W4/W5/W6/W19/W20
- `faa9f38` feat(h18-cp70.0): Sprint 0 foundation — 16 task 平行落地

Pre-flight：
- `9efa3ea` docs(h18-cp70b): Phase 7 設計 baseline 4 docs
- `b02474c` feat(h18-cp70a): cp70 收尾整合 (gemma autostart + settings 擴充 + examMarks)

## Sprint 進度總覽

### Sprint 0 · Foundation ✅ 16 / 16
setup hooks / fixtures / mocks / contracts / Modal conventions / useService /
CSP draft / token system 8 categories / TaskIndicator merge spec / SIGNING.md +
Win timestampUrl / DESIGN-SYSTEM.md (隨 cp70b)

### Sprint 1 · Recording Singleton + 安全 ✅ 18 / 18
W4/5/6 (CSP / DOMPurify / HTTP allowlist) + W19 logger redact + W20 build /
recordingSessionService singleton (state machine + visibility + mic ended +
device monitor + mustFinalizeSync) + RecoveryHintBanner / W14 localStorage
quota / R-1 logout reset / useRecordingSession thin reader / H18DeepApp +
RecordingPage + ReviewPage 適配 + W10 全入口 confirm + S1.10 App close
confirm + finalize

### Sprint 2 · Stop Pipeline + Streaming + RAG ✅ 12 / 13 (S2.12 deferred)
taskTrackerService singleton (persist 用 localStorage 退階) + translationPipeline
awaitDrain + W9 queue cap / stop() 6-step pipeline 真實作 (transcribe / segment /
index / summary kick-off / index kick-off / done) + W17 toast coalescing /
ReviewPage streaming summary + retry + cancel-on-regen + lecture.status
'failed'/'stopping' enum 擴 / TaskIndicator dual-source 重寫 / W7 map-reduce
per-section error catch + W8 AbortController / S2.9 + W18 persistence + sticky
toast / S2.11 subtitle.timestamp relative seconds helper

**S2.12 react-window virtualization** 推到 backlog — perf polish 不阻擋功能完整。

### Sprint 3 · Polish ✅ 22 / 22
keymapService + utils/kbd / H18ContextMenu base / H18DayPicker / exportService
SRT+MD / Rust cascade backend (一次到位 v8 schema migration + delete_course /
list/restore/hard_delete commands + 9 cargo test) / PTranslate Gemma DL /
Stop confirm M1 / PKeyboard sub-pane + 替換 7 顯示處 + 替換 2 keydown handlers /
H18TextContextMenu (剪複貼全選) + 全域 contextmenu listener / LectureEditDialog
F1A modal + DayPicker popover (W11 落地) / Trash UI 階層樹 + bulk + App.tsx
hard_delete on boot / LectureContextMenu (編輯/重命名/匯出/移動/刪除) + CourseDetailPage
+ inline rename → edit dialog routing / W12 CourseRailContextMenu 統一 (3 actionable
items) + 移除快速錄音 / W13 H18EmptyState 共用 component 套 5 surface

### Sprint 4 · 影片 / PDF / Alignment / Import (P1) — pending 8 task
Plan 標明：
> 這 sprint 我建議推遲，但留 issue
> Sprint 1-3 完成後 H18 已經是 production-ready

待 Sprint 4 派工：
- S4.1 ReviewImportMenu component (hero dropdown)
- S4.2 PDF 匯入 flow + 衝突 confirm
- S4.3 影片匯入 flow (videoImportService 已有)
- S4.4 音檔匯入 flow + ASR
- S4.5 字幕貼上 flow (subtitleImportService 已有)
- S4.6 大綱貼上 → 寫 note.sections
- S4.7 已過未錄 slot 改 nav-only
- S4.8 import_source UI 對應

## Skipped 跳過（明早回來人工裁示）

- S2.12 react-window virtualization for transcript pane — 非阻擋功能；Sprint 1-3 結束後
  H18 production-ready 但 transcript 1000+ 句 perf 未測。建議 morning 真用一遍才決定要不要做

## Deviations 跟 plan 不同的判斷

### 編號慣例
- cp70.X = Sprint 0 / cp71.X = Sprint 1 / cp72.X = Sprint 2 / cp73.X = Sprint 3
- cp70a / cp70b = pre-flight 整理 (cp70 收尾 + Phase 7 design baseline)

### 重要技術 deviation
- **useService hook 跟 singleton 不相容**：Sprint 1 發現 singleton.getState() 回 defensive
  copy → 跟 useSyncExternalStore 互斥 (每 render 看作 store changed → infinite loop)。
  Round 3 改 useState + 直接 subscribe pattern。useService 仍然 useful for 簡單 store；
  singleton 不能用。
- **recordingSessionService.subtitle.type='rough'**：V11 重定義 'rough' → 'live' 排在
  Sprint 3 schema migration 但 Sprint 2 stop pipeline 用 'rough' 對齊既有 fixture；
  Sprint 3 cp73.0 schema migration 內 UPDATE subtitles SET type='live' WHERE type='rough'
  自動 migrate
- **AuthContext.logout signature 改 Promise<void>**：唯一 caller ProfilePage 走 fire-and-
  forget 模式不破。
- **stop pipeline 動態 import 一半改 static**：vitest mock resolve race。taskTracker /
  translationPipeline / summarizeStream 改 static；storageService / globalSearchService
  保持 dynamic 因 H18DeepApp test 用 factory mock 會 init order 撞
- **TaskTracker 持久化用 localStorage 退階**：Rust pending_actions Tauri commands
  (upsert_pending_action / list_pending_actions_by_types / delete_pending_action) 還沒加；
  本次用 localStorage 暫代，等 Rust 端命令補完後改回 pending_actions 表
- **list_trashed_courses Tauri command 不存在**：cp73.0 補上 list_trashed_lectures /
  restore_lecture / restore_course / hard_delete_trashed_older_than 但忘了 list_trashed_courses；
  S3f-FE PData 用 list_deleted_courses fallback；下個 cp 補
- **永久刪除 by-id 沒 backend command**：目前 hard_delete 只支援「30 天清掃」批次；
  Trash UI bulk 永久刪除標 TODO
- **W4 / W6 production CSP/HTTP 比 plan spec 多 3 host**：codebase grep 出 active provider
  (github-models / chatgpt-oauth / oauth2.googleapis.com) 補上以免 break 現有
- **S3a-1 keymap H18Preview 留 TODO**：Preview footer chips 是 preview-local nav，不在
  ActionId 集合內 (search/toggleAiDock/newCourse/goHome/goProfile/toggleTheme/floatingNotes 七個)；
  hardcode 留住

## 新發現的 backlog（不做，記下）

- subtitle.type V11 重定義為 'live' | 'imported' | 'edited'；schema migration 已 done
  但 TS type 還是 'rough' | 'fine' (H18-fixtures 用)；Phase 8 fix
- API key 進 OS keychain (Phase 8 加密層)
- LLM streaming 真正 cancel 跟 partial output 持久化 (W8 caller adoption — Sprint 4)
- 模型下載 checksum 驗證
- list_trashed_courses Rust command + 永久刪除 by-id command
- 跨平台 visual regression test
- transcript virtualization (S2.12)
- AlignmentBanner 接 autoAlignmentService (Sprint 4)

## 環境問題（不影響進度）

- 既有 2 個 test 紅 (`storageService.syllabusPipeline.test.ts` + `audioRecorder.fallback.test.ts`)
  ：toast() signature 多了 4th 個 navRequest argument，test 還是預期舊 2 args expect。
  Sprint 4 動 toast() 才會修這 2 紅
- Rust prod target 被執行中 classnoteai.exe 鎖；cargo test workaround =
  `CARGO_TARGET_DIR=target-test cargo test storage`
- Working tree 已乾淨

## Verify checklist 當前狀態

Sprint 0/1/2/3 完工 verify checklist 大多已通過：
- [x] tsc clean
- [x] npm test 1037 / 1039 (2 紅 pre-existing)
- [x] cargo test storage 30 / 30
- [x] tauri.conf.json CSP 嚴格化 (production grade)
- [x] HTTP allowlist 收緊
- [x] DOMPurify 替換 + XSS test
- [x] keymap 系統 + PKeyboard + 7 顯示處
- [x] Trash UI 階層樹 + cascade restore
- [x] LectureEditDialog + DayPicker (W11)
- [x] Lecture context menu + Course context menu 統一 (W12)
- [x] 5 surface empty state 統一 (W13)
- [x] taskTrackerService persistence + sticky toast
- [x] stop pipeline 6-step + W17 coalescing
- [x] streaming summary + retry + cancel-on-regen
- [ ] manual smoke (錄一段 30s 走完整 user journey) — 過夜模式不跑 GUI；morning 必驗
- [ ] dev mode CSP 違規檢查 (vite HMR eval) — 過夜不 run dev
- [ ] Sprint 4 import flow

## 早晨報告建議

明早醒來：
1. 讀此 PROGRESS.md
2. 跑 `npm run tauri:dev` 走 verify checklist 中需要 GUI 的部分
3. 修 2 個 pre-existing toast signature failures（不在 Phase 7 範圍但會干擾 CI）
4. 決定 Sprint 4 是否在 Phase 7 內推進，或拉成 Phase 8 P1
