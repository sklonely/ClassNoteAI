# Phase 7 過夜進度

**最後更新**：2026-04-28T17:10Z
**當前 sprint**：Sprint 1 開工準備中
**當前 task**：派 Sprint 1 Round 1 (recordingSessionService skeleton + RecoveryHintBanner)
**總進度**：Sprint 0 16/16 + 2 pre-flight = 18 / 79

## 已完成 commits（時間倒序）

- _即將 commit_ `feat(h18-cp70.0)`: Sprint 0 foundation (S0.1 ~ S0.16)
- `9efa3ea` docs(h18-cp70b): Phase 7 設計 baseline
- `b02474c` feat(h18-cp70a): cp70 收尾整合 — examMarks store + Gemma autostart + 設定型別擴充

## Sprint 0 完工總結 ✅

10 個平行 sub-agent 全部成功收回，0 退回。新增 64 個測試全綠（472 → 536）。

| Task | 動的檔 | 結果 |
|---|---|---|
| S0.1 + S0.13 + S0.14 | `src/test/setup.ts` | afterEach(cleanup) + MockMediaStreamTrack + singleton reset hook |
| S0.2 | `src/test/h18-fixtures.ts` + test | 6 builder + 7 self-test 綠 |
| S0.3 | `src/test/h18-llm-mocks.ts` + test | streaming mock helpers + 12 self-test 綠 |
| S0.4 | `src-tauri/src/storage/database_test.rs` + tiny edits | in-memory DB harness + 3 Rust test 綠（agent 跑 CARGO_TARGET_DIR=target-test 避免 onnxruntime.dll 檔鎖；prod target 運行時要先關 classnoteai.exe 才能 cargo test） |
| S0.5/6/7 | `src/services/__contracts__/*.contract.ts` + index | 3 service contract type-only + tsc clean |
| S0.8 | `docs/design/h18-deep/H18-MODAL-CONVENTIONS.md` | 11 節，跟 DESIGN-SYSTEM §4.4 z-index 對齊 |
| S0.9 | `src/components/h18/useService.ts` + test | useSyncExternalStore 包裝 + 7 test 綠 |
| S0.10 + S0.16 | `tauri.conf.json` (CSP draft + Win timestampUrl) + `docs/sop/SIGNING.md` | dev CSP 起得來 + 197 行 signing doc。**Deviation**：plan/execution 寫 `docs/build/SIGNING.md`，但 root .gitignore line 8 蓋掉 `build/` → 改放 `docs/sop/`（已有 release smoke / llama-sidecar release 相關 doc）|
| S0.11 | `tokens.css` + `tokens.ts` + tokens.test.ts | 8 類 token (type/space/radius/shadow/z/duration/size/icon) + 44 test 綠 |
| S0.12 | (`H18-DESIGN-SYSTEM.md` 已隨 cp70b 落地) | — |
| S0.15 | `docs/design/h18-deep/H18-TASKINDICATOR-MERGE.md` | offlineQueue + tracker 合併 schema 規範 |

## 進行中

- 即將開 Sprint 1 Round 1。Plan 標 Round 1 = 3 agent 平行：
  - Agent A: S1.0 (schema bump for AppSettings.shortcuts) + S1.1 (recordingSessionService singleton skeleton + S1.6 visibility/mic readyState 內聯) + tests
  - Agent B: S1.9 RecoveryHintBanner 獨立 component + test
  - Agent C: 略（test 框架 setup 已在 Sprint 0 做完）
- 預期 1 commit `feat(h18-cp71.0)`

## Skipped 跳過（明早回來人工裁示）

（目前無）

## Deviations 跟 plan 不同的判斷

- **S0.12 隨 cp70b 落地**：DESIGN-SYSTEM.md 已寫好，跟 PLAN/EXECUTION/AUDIT 一起在 cp70b 落地。
- **派 agent 合併 (Round 1)**：S0.1+S0.13+S0.14 動同檔 → 合併成單一 agent；S0.10+S0.16 動同檔 → 合併。
- **Phase 7 commit 編號**：cp70a / cp70b 是 Sprint 0 之前的 wrap-up；cp70.0 起為 Sprint 0；cp71.0 起為 Sprint 1。
- **S0.2 fixture Subtitle.type**：規格寫 `'live'`，實際 type union 是 `'rough' | 'fine'`（V11 重定義為 Sprint 3 才做）→ agent 用 `'rough'`，註解標明語意。
- **S0.4 init schema 沒改 signature**：agent 加 `pub(crate) fn open_in_memory()` + `conn()` accessor，包 `#[cfg(test)]`，不破 prod path。
- **S0.7 keymap reset()**：規格用 `__reset()` 名稱避免跟 user-facing reset(actionId) 撞。

## 新發現的 backlog（不做，記下）

- `--h18-scrim` token 名稱在 H18-MODAL-CONVENTIONS.md 引用，但 tokens.css 還沒有 — Sprint 3 真寫 Modal 時補。
- `audioRecorder.fallback.test.ts > saved deviceId throws OverconstrainedError` 也是 toast signature 的 pre-existing 紅，跟 storageService.syllabusPipeline 紅同一 root cause（toast() 多了 navRequest 第 4 參數）。Sprint 2 動 stop pipeline 時順便修。

## 環境問題（不影響進度）

- Rust prod target 目錄被執行中的 classnoteai.exe（PID 76332）鎖住 onnxruntime.dll，要 cargo test 需先關閉該 process。Sprint 1 後續 Rust 改動如果用 `CARGO_TARGET_DIR=target-test` workaround 即可。
- Working tree 乾淨（除了 PROGRESS.md 自己），ready commit cp70.0。

## Verify checklist

Sprint 0 verify (PHASE-7-PLAN §9.6 + §14)：
- [x] Sprint 0 完工：16 件 foundation 全綠 + tsc clean
- [x] tauri.conf.json CSP draft 配進去 (Sprint 1 W4 才真嚴格化)
- [x] setup.ts cleanup hook 未破既有 test (472 baseline 仍 472，2 紅同 pre-existing)
- [x] 3 contracts type-only 編譯過
- [x] Modal conventions doc 寫完
- [x] tokens.css 6 類補完，引用測試 44 綠
- [ ] Rust DB harness：3 test 綠（agent 用 target-test 跑，prod target 因檔鎖未驗，但 code path 一致）
- [x] H18-TASKINDICATOR-MERGE.md 規範寫完
- [x] SIGNING.md + Win timestampUrl 配置
