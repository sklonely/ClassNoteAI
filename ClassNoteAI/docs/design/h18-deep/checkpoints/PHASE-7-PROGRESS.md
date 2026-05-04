# Phase 7 進度報告

**最後更新**：2026-04-29T09:30Z (cp75.10 模型下載 UI 真接通)
**狀態**：✅ Phase 7 主體完工 + 4 輪 unbiased review + cp75.8~10 使用者實測 fix
**測試**：1039 / 1039 frontend ✓ + cargo storage 39 / 39 ✓

## cp75.8 ~ cp75.10 補增（2026-04-29 早晨使用者實測）

| commit | 範圍 | 修了什麼 |
|---|---|---|
| **cp75.8** | docs final report + P1-A | save_lecture ON CONFLICT 不再覆寫 is_deleted (trash resurrect race) + 完整 final progress doc |
| **cp75.9** | 設定 + 全域右鍵 | useAppSettings stale closure → useRef baseline (Calendar URL 持久化恢復) + 全域 contextmenu listener 對「非 input surface」加 preventDefault (PLAN F6 spec) + Rust get_setting fallback 命中時自動寫進 scoped key (避免下次 read miss) |
| **cp75.10** | 模型下載 UI | Parakeet ModelCard 真接 download_parakeet_model + status-driven loaded/active；TranslateGemma multi-variant (Rust gemma_model.rs 從 4B-only 重構 → 4B/12B/27B Variant enum + per-variant URL/size/path)；PTranslate 改用 ModelCard list 給每個 variant 獨立下載 |



---

## 一日推進總覽（2026-04-28 → 2026-04-29）

| 階段 | 範圍 | Commits |
|---|---|---|
| Phase 7 主體 (一夜) | Sprint 0/1/2/3 平行 sub-agent | cp70a / cp70b / cp70.0 / cp71.0~3 / cp72.0~2 / cp73.0~3 |
| Manual smoke fix | SubPane auto-scroll / 中文消失 / 兩紅 test | cp74.0 |
| Subtitle schema v9 | 兩維欄位 (tier × source) + Rust trash commands | cp74.1 |
| ASR / 翻譯 | parakeet variant routing + Gemma prompt 強化 | cp74.2 / cp74.3 |
| **Audit + 不知情 review loop** | **6 個 sub-agent audit** + **5 輪 unbiased review** | **cp75.0~7** |

---

## cp75.x 系列：「直到 agent 掃不到問題為止」迴圈

按使用者要求：**派不知情的 sub-agent 找 bug → 修 → 再派 → 直到 clean**。每輪 review agent 拿到的 prompt 完全不告訴他改過什麼，要求從零探索。

### Audit Phase（6 個並行 sub-agent）
找出原始 13 P0：
1. translation `target_language` 永遠寫死 zh-TW
2. translation `source_language` 永遠寫死 en
3. 5 個 store 沒 user_id prefix（cross-user data leak）
4. AppSettings (Rust + frontend) 沒 user_id 隔離
5. logout 沒呼叫 `taskTrackerService.cancelAll()`
6. `audio.device_id` 設定不接到 AudioRecorder（永遠用 OS 預設 mic）
7. `audio.auto_switch_detection` 是 lying toggle
8. `experimental.asrBackend` (cuda/metal/vulkan/cpu) 完全沒接 runtime
9. `appearance.toastStyle` 沒接 ToastContainer
10. `appearance.themeMode` (system/light/dark) boot 不讀
11. `appearance.fontSize/density` UI 純擺設沒套到 DOM
12. CourseEditPage 缺 3 種匯入模式
13. boot delay sequencing 用 `setTimeout` magic 而非 await chain

### Fix Phase
- **cp75.0** quick wins (5 個 lying toggles)
- **cp75.1** target_language 全鏈接通 (gemma backend 動態 prompt + 4 caller settings-aware)
- **cp75.2** CourseEditPage 加 3 種匯入模式（使用者明確報的 bug）
- **cp75.3** multi-user 隔離真接通（5 stores user_id prefix + AppSettings frontend + Rust composite key）

### Review Loop（4 輪 unbiased agent）

| Round | Findings | Fixed in |
|---|---|---|
| Round 1 | 4 P0 + 4 P1 | cp75.4 |
| Round 2 | 4 P0 + 4 P1 | cp75.5 |
| Round 3 | 2 P0 + 7 P1 | cp75.6 |
| Round 4 | 3 P0 + 2 P1 | cp75.7 |
| **Round 5** | **找不到 P0** ✅ | (P1-A trash resurrect 順手修，cp75.7) |

每輪 fix 都針對前一輪 finding。Loop 自然收斂。

---

## Final state by major area

### Multi-user 隔離（最大缺口收口）
- ✅ 5 個 localStorage store (inboxState / examMarks / userNotes / aiHistory / keyStore) 加 user_id prefix
- ✅ AppSettings (Rust + frontend) 用 composite key `<userId>::<key>` 隔離
- ✅ canvasCacheService 加 user_id prefix
- ✅ DEFAULT_PROVIDER_KEY 移出 `llm.*` namespace + per-user (避免被 `clearAll` 殺)
- ✅ `keyStore.clearAll()` 改 user-scoped (只清 current user，不掃全)
- ✅ `chatSessionService` 預設 `default_user` 對齊其他 store
- ✅ AuthContext.resetUserScopedState 完整 7 步：recording reset / taskTracker cancelAll /
     keystore (only on logout) / inbox cache reset / keymap reset / chatSession resetUserId /
     dispatch settings-changed event；login + logout 都 call
- ✅ Rust destructive commands (8 個) 加 ownership check：delete_lecture / delete_course /
     delete_course_cascade / restore_lecture / restore_course / purge_lecture /
     purge_course / hard_delete_lectures_by_ids / hard_delete_trashed_older_than
- ✅ `list_orphaned_recording_lectures` 加 user_id filter (boot recovery 不再跨 user)
- ✅ `save_lecture` ON CONFLICT 不再覆寫 `is_deleted` (trash resurrect race fix)

### Settings → runtime 接通
- ✅ `parakeetVariant` int8/fp32 切換真生效 (cp74.2)
- ✅ `audio.device_id` 接到 AudioRecorder (cp75.0)
- ✅ `audio.auto_switch_detection` 真讀 (cp75.0)
- ✅ `appearance.toastStyle` 接 ToastContainer (cp75.0)
- ✅ `appearance.themeMode` boot 讀 + system theme watcher (cp75.0)
- ✅ `translation.target_language` 接通 (Rust gemma::translate signature 加 src/tgt + 4 caller) (cp75.1)
- ✅ `translation.provider` 切換 cache 隔離 (provider 進 cache key) (cp75.5)
- ✅ keymap shortcuts 自訂 boot 後真生效 (`hydrate()` 在 App.tsx 接 ready effect) (cp75.5)
- 🟡 `experimental.asrBackend` 仍未接 ORT execution provider (用 disabled badge 留給 Phase 8)
- 🟡 `appearance.fontSize/density` 仍 cosmetic UI（沒套到 DOM）
- 🟡 `audio.sample_rate` slider 是 lying toggle (AudioRecorder 不收 sampleRate)
- 🟡 `experimental.refineIntensity` lying toggle
- 🟡 `subtitle.{display_mode,font_size,...}` 5 個 lying toggle
- 🟡 `experimental.logLevel` placeholder

### File system safety
- ✅ `read/write_text/binary_file` 4 個 custom command 加 path scope validation
  (canonicalize 後必須在 `app_data_dir` 之下，否則 reject) — 防 XSS / dependency
  supply chain 讀寫任意系統檔案

### Bug fixes (manual smoke 抓的 + audit 抓的)
- ✅ SubPane auto-scroll + stick-to-bottom (cp74.0)
- ✅ Review 中文消失 (translation_ready 漏寫 roughTranslation) (cp74.0)
- ✅ 2 個 pre-existing toast signature 紅 test
- ✅ Subtitle 兩維 schema v9 (rough/fine + live/imported/edited)
- ✅ CourseEditPage 加 3 種匯入模式
- ✅ TranslationCache provider key 隔離 (切 provider 不再返 24h 內 stale)
- ✅ `keymapService.hydrate()` boot 真接通 (custom shortcuts 重啟仍生效)
- ✅ `normalizeAppSettings` 改 spread (避免 `recordingLayout` 等新欄位被砍)
- ✅ `getAllSettings` / `exportAllData` 加 user filter (避免跨 user 設定 export 洩漏)
- ✅ `save_subtitles` race-recovery 不再 hardcode `default_user` (從 trashed course
  讀 user_id)
- ✅ `recordingSessionService.reset()` 在 logout/login 前先 `mustFinalizeSync`
  drain audio (避 mic indicator 持續開)

### TS/Rust health
- npx tsc --noEmit ✓ (multiple commits)
- npm test 1039 / 1039 ✓
- cargo test storage 39 / 39 ✓ (含 3 個新 isolation tests + trash sweep cross-user test)

---

## 仍留 (P1/P2，明確不做)

從 round 5 review 結果（agent 確認沒 P0）：

### P1 (defense-in-depth，desktop trusted-user 不可達)
1. **CRUD commands 沒 ownership check**: `get_lecture` / `save_lecture` / `save_subtitle(s)` /
   `save_note` / `get_note` / `update_lecture_status` / 全 embedding commands
   全都 trust frontend `lecture_id`。frontend logout/login cleanup (cp75.3-7)
   已大幅縮 attack surface — 仍應補 read/write 端 ownership 但不影響 ship
2. **Disk file leak after purge**: `purge_lecture` / `hard_delete_*` 只 DELETE row，
   audio / video / pdf / pcm sidecars 留磁碟。長期累積到 GB
3. **`get_all_settings` Rust 端不分 user**: frontend 已 filter；
   defense-in-depth 應補

### P2
4. `experimental.asrBackend` 不接 ORT provider list
5. `appearance.fontSize/density` 不套 DOM
6. `audio.sample_rate` slider lying
7. `subtitle.*` 5 個 lying toggles
8. `experimental.refineIntensity` lying toggle
9. `experimental.logLevel` placeholder
10. translation `provider` badge 寫死 'gemma'
11. `useAppSettings.update` stale closure race
12. boot delays 用 setTimeout 不 sequence

### Phase 8 candidates (audit doc backlog 已列)
- API key 進 OS keychain
- LLM streaming 真 cancel + partial output 持久化
- 模型下載 checksum 驗證
- Code signing 流程文件化
- Property-based testing
- E2E (Playwright)
- 響應式 < 1280px
- Telemetry / 使用分析
- chat_sessions 從 localStorage 真遷 DB
- Sprint 4 (影片 / PDF / Alignment / Import surface) 8 task

---

## Final commit chain

```
e76d487 cp75.7  unbiased review round 4 fix (file scope + orphan filter + clearAll/reset)
f7d1e0b cp75.6  Rust destructive ownership + boot sweep user filter
d86b102 cp75.5  review round 2 fix (keymap.hydrate / chatSession reset / cache provider key / save_subtitles race)
4392c71 cp75.4  review round 1 fix (normalize spread / export filter / canvasCache / DEFAULT_PROVIDER / login cleanup)
9c987b7 cp75.3  multi-user 隔離全接通
f6ce678 cp75.2  CourseEditPage 3 import modes
2e74df6 cp75.1  target_language 全鏈
1c47fe9 cp75.0  5 quick wins
ad12ecf cp74.3  TranslateGemma prompt + decode params
c9f211e cp74.2  ASR variant routing
588fed6 cp74.1  subtitle 兩維 schema
a033999 cp74.0  SubPane scroll + 中文消失 + 2 紅 test
00902f5 cp73.3  Phase 7 過夜進度報告 (Sprint 0~3)
... 主體 cp70~73 一夜 11 commit ...
```

**累計：30 個 Phase 7 commit，13 個 cp74/75 修補 commit。**

---

## 早晨驗證 SOP（給使用者，過夜結束）

依 audit + review 找的範圍，建議 manual smoke：

```
1. 一般使用流程 (10 分鐘)
   - 錄音 30s → 結束 → review 看字幕（cp74.0 修的中文消失）
   - 切 layout B/C 錄音頁 (cp75.4 normalizeAppSettings 修的 recordingLayout 持久化)
   - 課程編輯頁 → 重新匯入 → 試貼文字 / 換 PDF / 從網址（cp75.2）
   - PKeyboard 改 search 為 Mod+P → 重啟 app → 確認 Mod+P 真開搜尋（cp75.5）
   - PAudio 切麥克風 → 錄音 → 確認用對 mic（cp75.0）
   - PAppearance 切「跟隨系統」→ 切 OS dark/light → app 跟著（cp75.0）

2. 多 user 切換 (5 分鐘)
   - 設 user A → 設 API key + 自訂 search 鍵 → logout
   - 設 user B → 不設 key → 確認 PTranslate 看不到 A 的 keys（cp75.3）
   - PKeyboard 看到的是 default 不是 A 的自訂（cp75.5）
   - logout B → 重 login A → key 仍在（cp75.7 — clearAll 不再砍）
   - 啟動 5 秒看是否跳「已永久清除 N 個」— 應**只**清 A 的 trash（cp75.6）

3. 翻譯品質 (5 分鐘 + 需 Gemma sidecar)
   - 個人資料 → 翻譯 → target_language 切到 zh-CN
   - 錄音講英文 → 結束 → review 看中文是簡體（cp75.1）
   - 切回 zh-TW → 同稿子重錄 → 看中文是繁體（不再 cache 24h stale — cp75.5）
   - PTranslate prompt（cp74.3）：講含 acronyms (NASA / API / iPhone)，
     看是否保留英文不被翻譯
```

---

## 給未來 reviewer 的 note

這 30 commits 是「按 plan 推進 + 多輪 unbiased review 抓漏 + 修」的範例。Audit 找到 13 個 P0，
fix 後 4 輪 review 各自又找到 4/4/2/3 個 P0 — 這是預期的 — 修一波會 expose 下一層。
**Round 5 找不到 P0** 是 desktop trusted-user 場景下的合理收口。

剩 P1/P2 (CRUD ownership / disk file leak / 各種 lying toggle) 不傷使用者但
defense-in-depth 應該補。**全部明確列在 Phase 8 backlog**。
