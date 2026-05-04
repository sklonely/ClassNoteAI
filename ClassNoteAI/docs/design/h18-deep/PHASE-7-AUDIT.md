# Phase 7 · 計畫審查總集 (3 輪 audit + design)

**狀態**：已收束的審查紀錄。配 PHASE-7-PLAN.md (設計) + PHASE-7-EXECUTION.md (執行)。
**範圍**：對 `feat/h18-design-snapshot` 分支的 H18 重寫計畫做 3 輪 deep audit + 1 輪 user journey persona 模擬。

---

## 1 · Audit 三輪結構

### 輪一 · 計畫 vs 程式現況
找「我計畫上寫的功能在 codebase 裡實際存在嗎」、「我假設的 API 簽名對嗎」。

### 輪二 · Schema audit
找「DB schema / Rust struct / TS interface 三邊一致性」、「欄位語意對不對」、「缺什麼欄位」。

### 輪三 · 邊緣 case + UX
找「使用者實際操作會踩哪些 hole」、「app 生命週期未處理」、「多 user 安全」、「performance / a11y 漏洞」。

---

## 2 · 輪一發現 (檔案/實體現況 vs 計畫假設)

### 2.1 假設正確

- vitest + @testing-library/react + Tauri mock infra 完整 (`src/test/setup.ts`)
- `summarize` / `summarizeStream` API 存在
- `ragService.indexLecture(lectureId, pdfText, transcriptText, onProgress)` 簽名正確
- `normalizeAppSettings` migration 路徑存在

### 2.2 假設錯誤

| ID | 計畫假設 | 實際情況 | 影響 |
|---|---|---|---|
| **A1** | TaskIndicator 是空殼 | 已被 offlineQueueService 佔用 (AUTH_REGISTER / PURGE_ITEM / TASK_CREATE) | 不能直接 rewrite，要 dual-source merge |
| **A2** | `delete_course` 觸發 FK CASCADE | 是 soft delete (UPDATE is_deleted=1)，不觸發 FK | lectures 仍 alive 變孤兒，要在 transaction 內手動 cascade |
| **A3** | 字幕 timestamp 是相對秒 | 是 epoch 秒 (legacy bug) | review 顯示亂碼，需修 |
| **A4** | AudioRecorder 暴露 mic readyState | private mediaStream，沒 public getter | 要加 `getMicReadyState()` |
| **A5** | 有 `classnote-lectures-changed` 事件 | 不存在 | 要新增 |

---

## 3 · 輪二發現 (Schema 一致性 / 缺欄位)

### 3.1 三邊不一致 (silent bug)

#### B1 · Lecture.keywords + Lecture.audio_hash
TS 端有，Rust struct 沒有，DB 沒有。永遠不持久化。
→ 從 TS 端移除。

#### B2 · Note 結構不對等
TS: `summary, sections, qa_records` 三個欄位。
Rust + DB: `content TEXT` 一個 JSON blob。
→ summary 抽到 column，content 仍 JSON。

### 3.2 缺欄位 (Phase 7 直接需要)

| 表 | 欄位 | 用途 |
|---|---|---|
| lectures | `started_at_ms INTEGER` | Recording Island elapsed 計算的真實 start time |
| lectures | `summary_status TEXT DEFAULT 'pending'` | U3 retry path |
| lectures | `summary_provider TEXT` | 哪個 LLM 跑的 |
| lectures | `import_source TEXT DEFAULT 'live'` | live/video/audio/subtitle_paste/outline_paste/empty |
| lectures | `cascade_deleted_with TEXT` | 軟刪 cascade restore 反向找 |
| notes | `summary TEXT` | 抽到頂層 |
| notes | `status TEXT DEFAULT 'pending'` | retry / failed 標記 |
| notes | `provider TEXT` | LLM 來源 |
| settings | `user_id TEXT DEFAULT 'default_user'` | 多 user 切換 |

### 3.3 欄位語意問題

| ID | 欄位 | 問題 | 修法 |
|---|---|---|---|
| C1 | `subtitle.timestamp` | 寫 epoch 秒 (應該相對秒) | recordingSessionService.stop() 改 `(seg.startTime - sessionStartMs) / 1000` |
| C2 | `subtitle.type` | `'rough' \| 'fine'`，fine 從沒寫過 | 改用途為 `'live' \| 'imported' \| 'edited'`，DB 一次性 UPDATE rough → live |
| C3 | `lecture.date` | 語意混亂 (排程 / 實際 start / 純日期) | 拆 `date` 為 YYYY-MM-DD only + 新 `started_at_ms` |
| C4 | `course.description` | H18Preview 不再讀，但仍 saveCourseWithSyllabus 寫進去 | 保留不動，後續 sprint 清 |
| C5 | `SyllabusInfo.instructor` (legacy) vs `instructor_person` | 雙存 fallback 邏輯 | 不動，純 frontend normalize 函數即可 |
| C6 | `chat_sessions / chat_messages` 表 | H18 沒用（用 localStorage） | 不動，留待 D2 multi-session |

---

## 4 · 輪三發現 (邊緣 case / 使用者場景)

### 4.1 Recording 生命週期

| ID | 問題 | 嚴重度 |
|---|---|---|
| L1 | useRecordingSession unmount cleanup 直接 stop()，切頁就殺錄音 | 🔴 P0 |
| L2 | 切頁回來不 dispatch RECORDING_CHANGE_EVENT，DB 卡 status='recording' | 🔴 P0 |
| L3 | start() 呼第二次會 wipe 舊 segments | 🔴 P0 |
| L4 | system sleep / hibernate 後 mic readyState 未檢查 | 🟠 P1 |
| L5 | dev mode HMR 會 re-eval module，singleton state 重置 | 🟡 P2 |
| L6 | logout 不 reset singleton，切 user 看到上 user 錄音 | 🔴 P0 |

→ 全部 Sprint 1 singleton 重構處理。

### 4.2 Stop pipeline 斷裂

| ID | 問題 | 嚴重度 |
|---|---|---|
| P1 | subtitleService.addSegment 純 in-memory，沒 saveSubtitles | 🔴 P0 |
| P2 | translationPipeline 沒 awaitDrain，最後一句沒中文 | 🔴 P0 |
| P3 | stop() 沒呼叫 summarize / saveNote | 🔴 P0 |
| P4 | stop() 沒呼叫 ragService.indexLecture | 🔴 P0 |
| P5 | finishing overlay 是 fixed timer 假動畫 | 🟠 P1 |
| P6 | summary streaming 失敗無 retry path | 🟠 P1 |
| P7 | 1000+ 字幕 segments 重 render 卡頓 | 🟠 P1 |

→ Sprint 2 全收。

### 4.3 多 user 安全

| ID | 問題 | 嚴重度 |
|---|---|---|
| M1 | settings table 沒 user_id，A user 設定 B user 看到 | 🔴 P0 |
| M2 | keyStore (LLM API keys) 不分 user，財務風險 | 🔴 P0 |
| M3 | localStorage stores 全跨 user 共用 (inboxState / examMarks / userNotes / aiHistory) | 🟠 P1 |

→ Sprint 1 順手做。

### 4.4 App close 流程

| ID | 問題 | 嚴重度 |
|---|---|---|
| W1 | 錄音中關 app 沒 confirm，segments 整片丟 | 🔴 P0 |
| W2 | LLM task 跑中關 app，token 已 charge 但結果丟 | 🟠 P1 |
| W3 | 沒有「下次啟動續跑」機制 | 🟠 P1 |

→ V4 設計：必修同步 finalize + 可延後 task queue 進 pending_actions。Sprint 1 處理。

### 4.5 UX 漏洞

| ID | 問題 | 修在哪 |
|---|---|---|
| U1 | F5 reload 顧慮錯了（桌面 app 沒 F5） | 拿掉 D3 |
| U2 | 「已過未錄」slot 開 ImportModal 太重 | 改進 review 看，匯入按鈕在 review hero |
| U3 | Review 頁無匯入路徑，老師後 PDF 場景斷 | Sprint 4 加 ReviewImportMenu |
| U4 | lecture-level 刪除沒 UI | Sprint 3 lecture context menu |
| U5 | 結束按鈕沒 confirm，誤觸 90 min 錄音風險 | Sprint 3 加 confirm dialog |
| U6 | 跨 OS 鍵盤符號 hardcode ⌘ | Sprint 3 keymap + OS detect |
| U7 | 文字框右鍵彈瀏覽器原生 | Sprint 3 文字框 H18 menu |
| U8 | a11y 沒考慮（focus trap, ARIA, 鍵盤導覽）| Sprint 3 各 component 順手 |

### 4.6 Performance / Architecture

| ID | 問題 | 修法 |
|---|---|---|
| X1 | subtitleService 每次 update 全 array re-emit | 不改服務，前端用 react-window 處理 |
| X2 | Singleton subscriber memory leak 風險 | 統一 useService hook |
| X3 | Streaming summary 跨 reload 無法續跑 | F5 拿掉 → 寫進 pending_actions 下次啟動續跑 |
| X4 | LLM 同時並行無 cap | 拿掉 cap，使用者自負 token |
| X5 | logging 各 service 用法不一 | 統一 errorReportService（backlog） |

---

## 5 · v3 鎖定的所有決議

整理進 PHASE-7-PLAN.md § 8.1，這裡列 tag → 決議：

```
F5 → 拿掉
LLM cap → 拿掉
「已過未錄」 → 進 review，import 在 review
App close → 必須同步 finalize；可延後 task → pending_actions 下次續跑
多 user → 完整方案 (prefix + user_id + clear)
react-window → Sprint 2 加
ImportModal → P1 升級進 Sprint 4
Schema → 一次到位 (Sprint 3.f-RS)
TS-only fields → 移除 (keywords / audio_hash)
subtitle.type → 重新定義 (live/imported/edited)
lecture.date → 拆欄
Note.summary → 抽 column
lecture.status → 加 failed/stopping
TaskTracker → 用 pending_actions 持久化
```

---

## 6 · 還沒做的決定 (送 backlog)

- errorReportService 統一錯誤路徑
- logDiagnostics 整合 + log export UI
- Lazy chunk load (pdfjs / heavy modules)
- CSS token cleanup (extras-* vs H18)
- Telemetry / 使用分析
- chat_sessions 從 localStorage 遷到 DB
- Visual regression test
- subtitle.end_timestamp / is_exam_mark 入 schema
- course color / archived
- lecture_number column
- SyllabusInfo legacy field cleanup
- 概念圖 / concept extraction
- iPad mirror NotesEditor
- 跨課堂 RAG UI
- 字幕對齊 (alignmentService)
- 雲端備份 / 設備同步

---

## 7 · 工程量估計 (v3)

| Sprint | 任務數 | 工程量 | 風險 |
|---|---|---|---|
| Sprint 1 (singleton + 多 user + close 流程) | 14 | 3 天 | 中 |
| Sprint 2 (stop pipeline + streaming + virtualization) | 9 | 3-4 天 | 中 |
| Sprint 3 (polish + schema migration + a11y) | 16 | 4-5 天 | 低 |
| Sprint 4 (Review/Recording Import Surface) | 8 | 3-4 天 | 中 |
| **總計** | **47 任務** | **13-16 天** | |

---

## 8 · v3 後續正式審查方向

預計派多 agent 平行 audit 這份計畫，方向：

1. **資料流 + Schema correctness**
2. **Concurrency + lifecycle 管理**
3. **錯誤處理 + 邊緣 case**
4. **Test 策略可行性**
5. **UX consistency + IA**
6. (額外) **Security + dependencies + build**

---

## 9 · 第四輪：5 (+1) agents 平行中立審查結果

派 6 個獨立 agent，中立 prompt，~80 finding 收回。共識排序：

### 9.1 高度共識 P0 (3+ agent 都抓到)

| 共識數 | finding | 修法 |
|---|---|---|
| 5/5 | recordingSessionService / taskTrackerService 完全不存在 | Sprint 0 加 contract + Sprint 1 / 2 實作 |
| 5/5 | useRecordingSession unmount 直接 stop() (L1) | Sprint 1 singleton 重構 |
| 4/5 | Stop pipeline step 4-5 是 no-op | Sprint 2 真接 |
| 4/5 | 多 user 資料隔離未實作 (keyStore / settings / localStorage) | Sprint 1 W4-W6 + R-1 |
| 4/5 | App `onCloseRequested` 未掛 | Sprint 1 (V4 設計) |
| 4/5 | translationPipeline 無 `awaitDrain()` | Sprint 2 必修 |

### 9.2 各 agent 獨家 P1 整理

#### Schema/Data flow agent
- Phase 7 9 columns / Note 拆 summary / settings PK 不變但加 user_id 矛盾 / pending_actions 不分 offline-retry vs background-work

#### Concurrency/Lifecycle agent
- React Strict Mode idempotency / `MediaStreamTrack.onended` 沒訂閱 / Recovery vs singleton boot race / concurrent confirm 只 inbox 入口掛

#### Error handling agent
- summarize map-reduce 沒 per-section error / LLM 不能真 cancel (AbortController 缺) / Canvas RSS 無 timeout / localStorage write 無 try-catch / translationPipeline queue 無上限 / `getUserMedia` deny 沒 catch

#### Test agent
- setup.ts 無 `afterEach(cleanup)` / `database.rs` 零測試 / LLM async generator mock 無範例 / `h18-fixtures.ts` 沒寫 / verify checklist manual vs auto 沒分 / TaskTracker persistence 不易跨 process test

#### UX/IA agent
- course / lecture 右鍵 menu 結構分歧 / Modal Z-index / Esc 規範缺 / 切頁離開錄音中沒 confirm / 「已過未錄」改 nav-only 後 empty state 沒 hero CTA / Toast spam (5 個 toast) / TaskIndicator 關 dropdown 後背景任務無聲 / dark mode 新元件未 require / 響應式 < 1280px 未涵蓋 / AddCourseDialog vs ReviewImportFlow mode picker pattern 不一致

#### Security/Build agent
- `csp: null` + rehype-raw + Canvas regex sanitize → XSS 大表面 / HTTP allowlist `https://*:*/**` 未限制 / keyStore 純 localStorage 無加密 / capabilities 還有 `aiTutor-*` 死 config / 模型下載無 checksum / sourcemap 在 release / dependency `^` 太鬆 / runtime log 不過濾

### 9.3 v4 W 任務總清單（共 20 條）

對應 PHASE-7-PLAN § 9.2 ~ 9.5 + EXECUTION § 13:

| ID | 項目 | 提出方 | Sprint |
|---|---|---|---|
| W1 | Sprint 0 (test infra + service contracts) | Test | 0 |
| W2 | Migration 用 SQLite TRANSACTION 包 atomic | Schema + Test | 3.f-RS |
| W3 | Rust test harness for database.rs | Test | 0 + 3.f-RS |
| W4 | tauri.conf.json 真開 CSP | Security | 1 |
| W5 | rehype-raw 換 DOMPurify | Security + UX | 1 |
| W6 | HTTP allowlist 收緊 | Security | 1 |
| W7 | summarize map-reduce per-section error catch | Error | 2 |
| W8 | LLM AbortController 真接 (cancel UI = cancel HTTP) | Error | 2 |
| W9 | translationPipeline queue max size | Error | 2 |
| W10 | concurrent recording confirm 掛全入口 | Concurrency + UX | 1 |
| W11 | Modal Z-index / Esc behavior 規範 | UX | 0 doc + 3 落實 |
| W12 | course / lecture 右鍵 menu 結構統一 | UX | 3 |
| W13 | empty state visual spec for 5 surface | UX | 3 |
| W14 | localStorage write try-catch | Error | 1 |
| W15 | MediaStreamTrack.onended 訂閱 | Concurrency | 1 |
| W16 | Strict Mode idempotency / useService hook | Concurrency + Test | 0 |
| W17 | Toast coalescing 策略 | UX | 2 |
| W18 | TaskTracker task done sticky toast | UX | 2 |
| W19 | logDiagnostics 包 console 全域 hook | Security | 1 |
| W20 | release build sourcemap off | Security | 1 |
| R-1 | logout 一併 reset singleton | Concurrency | 1 |

### 9.4 v4 工程量

| Sprint | 任務數 | 工程量 |
|---|---|---|
| Sprint 0 | 10 | 1-1.5 天 |
| Sprint 1 | 18 | 3-4 天 |
| Sprint 2 | 13 | 4 天 |
| Sprint 3 | 22 | 5-6 天 |
| Sprint 4 | 8 | 3-4 天 |
| **總計** | **71** | **16-19 天** |

### 9.5 v4 sign-off 後待跑

開工前的最後檢查：

1. 重跑 5 (+1) agents 中立審查 (本次審查的迴圈版)
2. 確認 v4 doc 沒新一輪 P0 / P1
3. 開 Sprint 0 第一個 commit `feat(h18-cp70): Phase 7 foundation`

---

## 10 · v4 重跑審查結果 (2026-04-28 第二次 5 agent 中立 rerun)

### 10.1 重跑判讀

5 個 fresh agent（不知道之前審過）讀過 v4 doc：
- **0 個全新 P0** — v4 plan 設計沒漏 P0
- **5/5 共識**：所有大方向 finding 都是「plan 已寫但還沒實作」
- **6 個微妙新 finding (N1-N6)**：plan 沒明寫到位
- **重合度 ~95%**：plan 跟 fresh agent 期待重疊

### 10.2 N1-N6 處理結論

| ID | finding | 處理 |
|---|---|---|
| N1 | vite minify 沒開 | 加進 W20 描述 (Sprint 0 / 1) |
| N2 | Cargo devtools feature | **取消** — by design：Profile → 關於 → DevTools 開關 |
| N3 | Win signing timestampUrl 空 | 進 Sprint 0 (S0.16) + docs/build/SIGNING.md |
| N4 | TaskIndicator dual source schema 沒寫 | 進 Sprint 0 (S0.15) — H18-TASKINDICATOR-MERGE.md |
| N5 | Singleton reset() pattern 沒明寫 | 進 Sprint 0 (S0.14) — setup.ts 自動 + contract enforce |
| N6 | jsdom MediaStreamTrack mock 沒進 setup | 進 Sprint 0 (S0.13) |

### 10.3 衍生：Design System 萃取 (使用者 2026-04-28 拍板)

UX agent 抓出視覺不一致風險 → 使用者要求**先萃取 design system 再開工**：

**問題現況**：
- tokens.css 有 30+ color，但 spacing / radius / shadow / z-index / type scale / duration / component dims **6 類 token 缺失**
- 各 module.css 大量 hardcoded `padding: 14px` / `font-size: 12px` / `border-radius: 6px` etc.
- 多個 sub-agent 平行寫新 component (Sprint 3) 必撞風格

**解法**：
- Sprint 0 加 S0.11 + S0.12：補完 tokens.css/ts + 寫 H18-DESIGN-SYSTEM.md (1-4+6 章節)
- Sprint 3 強制 sub-agent 用 token，禁止 hardcoded
- code review 用 grep 抓違規

### 10.4 v5 工程量

| Sprint | task 數 | 工程量 |
|---|---|---|
| Sprint 0 | 16 (10 + 6 v5 補) | 1.5-2 day |
| Sprint 1 | 18 | 3-4 day |
| Sprint 2 | 13 | 4 day |
| Sprint 3 | 22 | 5-6 day |
| Sprint 4 | 8 | 3-4 day |
| **總計** | **77** | **17-20 day** |

### 10.5 v5 sign-off 拍板項

✅ 全部使用者已 confirm：
- Sprint 0 Foundation（含 N1/N3/N4/N5/N6 + Design System 萃取）
- Q-DS-1 = A（接受設計系統萃取）
- Q-DS-2 = A（品牌主色固定 #d24a1a）
- Q-DS-3 = 1-4 + 6（visual 規範範圍）
- N2 取消（by design）

### 10.6 v5 開工準備

- [x] PHASE-7-PLAN.md v5 完成
- [x] PHASE-7-EXECUTION.md v5 完成
- [x] PHASE-7-AUDIT.md v5 完成
- [x] H18-DESIGN-SYSTEM.md v0.7.0 完成
- [ ] Sprint 0 第一個 commit `feat(h18-cp70.0): Phase 7 foundation`
