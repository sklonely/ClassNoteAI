# Regression Test Coverage Checklist

> **Purpose**: closes [#101](https://github.com/sklonely/ClassNoteAI/issues/101). Drives the "Phase 1 / Phase 2 / Phase 3" plan agreed in the alpha.10 retro: focus on **component-level + workflow** tests where 99% of recent regressions actually broke us, defer real E2E.
>
> **How to use**: tick each checkbox as the test lands in `src/**/__tests__/`. When ticking, include the test file path so future readers can audit coverage. Add new rows liberally — this is a living document.

---

## Issue Coverage Map

Every issue (closed or open) that a unit/integration test could meaningfully guard. Run this audit before declaring "test framework complete". A row stays unchecked until at least one test case exists in the corresponding section below.

### Closed issues — these regressed once, must not regress again

| Issue | Title | Test section |
|---|---|---|
| #100 | 編輯課程時 PDF 拖入未接線 | Phase 1 → CourseCreationDialog, CourseListView |
| #99  | deviceId 失效不回退預設麥克風 | Phase 2 → audioRecorder + audioDeviceService |
| #98  | 課程總結 / 大綱流程失效 | Phase 1 → CourseDetailView; Phase 2 → storageService syllabus pipeline |
| #97  | Tailwind v4 layout 跑版 | Phase 3 → build smoke (`npm run build` boots) |
| #94  | 麥克風權限文案還是瀏覽器語境 | Phase 2 → audioRecorder normalizeMicrophoneError |
| #93  | jsonMode 400 缺 json 關鍵字 | Phase 2 → chatgpt-oauth jsonMode |
| #73  | 缺持久化 runtime log | Phase 2 → **logDiagnostics service** (NEW) |
| #72  | audio_path 不會自動 relink | Phase 2 → audioPathService |
| #70  | 錄音中切 AI refine 精度不生效 | Phase 2 → **refinementService config switch** (NEW) |
| #69  | Auto follow 沒作用 | Phase 1 → **PDFViewer auto-follow** (NEW) |
| #68  | AI 助教浮動視窗可拖到不可操作區 | Phase 1 → **AIChatWindow draggable bounds** (NEW) |
| #66  | AI 助教重複 OCR / RAG 浪費 token | Phase 2 → ragService ocr-routing dedup (existing) |
| #63  | 錄音法律 / 同意提示 | Phase 2 → consentService |
| #61  | AirPods 搶麥克風防護 | Phase 2 → **recordingDeviceMonitor mic-stolen detection** (NEW) |
| #49  | SetupWizard LLM provider 綁定步驟 | Phase 1 → **SetupWizard provider step** (NEW) |
| #47  | LLM Provider Model List 從真實 API 取得 | Phase 2 → **provider listAvailableModels contract** (NEW) |
| #34  | vendor crate SHA256 verify | Phase 3 → bootstrap-vendor.sh smoke |
| #33  | updater per-platform manifest | (workflow PR test — out of unit-test scope) |
| #31  | transcript 去重誤殺合法重複 | Phase 2 → transcriptionService dedup |
| #30  | OAuth 埠號 fallback race | Phase 2 → **oauth listener-bind ordering** (NEW) |
| #29  | CI 速度 | (CI config — out of unit-test scope) |

### Open issues — pre-write tests where the spec is clear

| Issue | Title | Test section |
|---|---|---|
| #71  | 轉錄斷句破壞翻譯上下文 | Phase 2 → **transcriptionService sentence-boundary** (NEW) |
| #67  | 翻譯品質異常 | (needs human eval; partial coverage in translationService.test.ts) |
| #62  | 長 session chunk + auto-stop | Phase 2 → **session length cap** (NEW; gate test until feature lands) |
| #53  | Whisper hallucination guards | Phase 2 → **hallucination filter** (NEW; gate test until feature lands) |
| #52  | 錄音 crash recovery / autosave | Phase 2 → recordingRecoveryService (existing — extend) |
| #50  | 統一 httpClient 抽象層 | Phase 2 → **httpClient retry/timeout** (NEW; gate test until feature lands) |
| #36  | ChatGPT OAuth Windows callback | (needs real network; covered by manual smoke) |
| #32  | GitHub Models fallback model IDs | Phase 2 → **github-models catalog parser** (NEW) |

### Out-of-scope from this checklist (covered elsewhere or wrong layer)

- Roadmap epics #112 / #74 / #64 / #60 / #58 / #57 / #56 / #55 / #54 / #51 / #48 / #76 / #75 — feature work, write tests when the feature lands.
- Translation quality #67 → covered by `evals/scripts/asr-wer.ts` style harness, not unit tests.

---

## Phase 1 — Component-level tests (testing-library/react + jsdom)

Stack: `@testing-library/react`, `@testing-library/user-event`, vitest's existing jsdom env. Mock `@tauri-apps/api/core` `invoke` via the existing `src/test/setup.ts` pattern.

### CourseCreationDialog

The recent crash hotspot. Edit-mode + null-prop + drag-drop are the broken contracts.

- [ ] renders `creates` heading in create mode
- [ ] renders `edits` heading in edit mode
- [ ] **regression #100/null-trim**: edit mode with `initialDescription={null}` does NOT crash on submit
- [ ] **regression #100/null-trim**: edit mode with `initialTitle={undefined}` renders empty input, no crash
- [ ] resets state on `isOpen` toggle (re-mount-style)
- [ ] submit with title only → `onSubmit(title, '', undefined, '')`
- [ ] submit with title + description → `onSubmit(title, '', undefined, description)`
- [ ] submit with PDF → `onSubmit(title, '', pdfArrayBuffer, '')`
- [ ] submit blocked when title is whitespace-only
- [ ] PDF picker: `selectPDFFile` returns null (user cancelled) → no state change
- [ ] PDF picker: 60 MB PDF rejected by `applySelectedPdf` size guard, toast fires, pdfData stays null
- [ ] DragDropZone: drop a `.pdf` path → `readPDFFile` called → state populated
- [ ] DragDropZone: drop a `.txt` path → toast warning, no state change
- [ ] DragDropZone: drop a 60 MB PDF → toast error, no state change
- [ ] DragDropZone disabled when `contextTab='text'`
- [ ] keyword extraction button disabled when title empty
- [ ] keyword extraction with `shouldClose=false` keeps dialog open
- [ ] cancel button resets fields in create mode
- [ ] cancel button preserves fields in edit mode

### CourseDetailView — syllabus lifecycle rendering

The four-state machine added in alpha.9. Back-compat with pre-alpha.9 `syllabus_info` is the critical invariant.

- [ ] state `'ready'` + content → renders structured tree (`topic / time / instructor / grading / schedule`)
- [ ] state `'ready'` + only `topic` → only topic block renders, no empty siblings
- [ ] state `'generating'` + description → pulse badge above description text
- [ ] state `'generating'` + no description → pulse badge alone (no `暫無` fallback)
- [ ] state `'failed'` → red box + `重試生成` button + error message from `_classnote_error_message`
- [ ] state `'failed'` + no error message → fallback `生成失敗` text
- [ ] state `'idle'` + description → renders description text only
- [ ] state `'idle'` empty → `暫無課程大綱信息`
- [ ] **back-compat**: pre-alpha.9 course (`{topic: 'X'}`, no meta keys) → renders as `'ready'`
- [ ] retry button click → `storageService.retryCourseSyllabusGeneration(course.id)` called
- [ ] retry button disabled while in flight
- [ ] retry failure → `toastService.error('重試失敗', ...)` called
- [ ] `classnote-course-updated` event with matching courseId → `loadData()` called
- [ ] `classnote-course-updated` event with different courseId → `loadData()` NOT called
- [ ] `handleUpdateCourse` with descriptionChanged → calls `saveCourseWithSyllabus`
- [ ] `handleUpdateCourse` with title-only change → calls plain `saveCourse`

### CourseListView

The dead-pipeline regression hotspot. Wire-up correctness is the contract.

- [ ] **regression #100/dead-pipeline**: create branch always calls `saveCourseWithSyllabus({pdfData, triggerSyllabusGeneration:true})`
- [ ] **regression #100/dead-pipeline**: edit + descriptionChanged → calls `saveCourseWithSyllabus`
- [ ] edit + title-only change → calls plain `saveCourse`
- [ ] edit + pdfData truthy → calls `saveCourseWithSyllabus` regardless of descriptionChanged
- [ ] create returns the new course id (auto-save callers depend on it)
- [ ] storageService throw → caught + console.error, dialog stays open

### ProfileView (post-sync removal)

Catches future "someone re-adds sync UI by mistake".

- [ ] renders user card with `user.username`
- [ ] renders `未登錄` placeholder when `useAuth` returns no user
- [ ] logout button calls `useAuth().logout`
- [ ] **regression**: should NOT contain any of these strings: `雲端同步 / 立即同步 / 自動同步 / 已連接設備 / 同步狀態`
- [ ] `onClose` fires when 關閉 button clicked

### SettingsView (post-PR #111 + post-sync removal)

- [ ] subscribes to `audioDeviceService` on mount
- [ ] device selection change → `audioDeviceService.setPreferredDevice` called
- [ ] permission request button → `audioDeviceService.requestMicrophonePermission` called
- [ ] handleSave does NOT include a `sync` field in the AppSettings payload
- [ ] unsubscribes on unmount

### TaskIndicator

Behavior contract: only renders the action types we still support.

- [ ] AUTH_REGISTER action → renders `用戶註冊`
- [ ] PURGE_ITEM action → renders `永久刪除`
- [ ] **regression**: SYNC_PUSH / SYNC_PULL / DEVICE_REGISTER / DEVICE_DELETE labels do NOT appear (cloud sync removal sanity check)
- [ ] hides badge when `pendingActions` is empty

### DragDropZone

Reusable, used by CourseCreationDialog + future drop targets. Worth isolating.

- [ ] renders overlay only while drag is over the zone bounds
- [ ] `onFileDrop` called with paths array
- [ ] `enabled={false}` blocks the drop event
- [ ] cleans up listener on unmount

### SubtitleDisplay

Critical + state-update-heavy. Easy to regress on the rough → fine in-place upgrade.

- [ ] renders rough subtitle (en + zh)
- [ ] in-place upgrade rough → fine: same DOM node, no flicker (assert `key` stable)
- [ ] `display_mode='en'` hides zh
- [ ] `display_mode='zh'` hides en
- [ ] `display_mode='both'` shows both
- [ ] position `top` / `bottom` / `floating` apply correct CSS classes
- [ ] empty subtitle list → renders nothing (no error)

### PDFViewer

- [ ] `currentPage` prop change scrolls to that page
- [ ] navigation buttons emit page change events
- [ ] out-of-bounds page → clamps to valid range, no crash
- [ ] mounting without `pdfData` → renders empty state, no pdfjs error

### PDFViewer auto-follow (regression #69)

The "auto-follow" mode that aligns the slide with the current subtitle's `page_number`. Used to silently no-op.

- [ ] auto-follow on + new subtitle with `page_number=N` → `setCurrentPage(N)` called
- [ ] auto-follow on + subtitle without `page_number` → page does NOT change
- [ ] auto-follow off + new subtitle with `page_number=N` → page does NOT change
- [ ] user manual page nav while auto-follow on → temporarily suspends auto-follow until next subtitle (or whatever the agreed UX is — capture in test)
- [ ] auto-follow toggle persists to settings

### AIChatWindow / AIChatPanel (regression #68 + #66)

Two adjacent surfaces. #68 was the floating-window-off-screen bug, #66 was double-OCR.

- [ ] floating mode: drag end with cursor below viewport → window position clamped to visible area
- [ ] floating mode: drag end with cursor above/left/right of viewport → clamped on each axis
- [ ] resize mode: minimum width/height enforced
- [ ] regression #66: opening AI tutor twice on same lecture does NOT trigger a second `ragService.indexLecture` call (idempotency)
- [ ] regression #66: question against an already-indexed lecture skips OCR pre-pass
- [ ] sidebar mode: docks to right column with no drag handles
- [ ] detached mode: spawns webview window with `?aiTutorWindow=1` query

### SetupWizard (regression #49 + #47)

Wizard step navigation + provider validation. #49 was the missing LLM provider binding step, #47 was the model list not coming from the real API.

- [ ] step navigation: 下一步 disabled until current-step requirements met
- [ ] regression #49: completing wizard requires at least one configured LLM provider
- [ ] regression #49: skipping LLM provider step warns + blocks finish
- [ ] regression #47: model picker pulls from `provider.listAvailableModels()` not a hardcoded list
- [ ] regression #47: failed model fetch → shows error toast, picker stays empty (does not crash)
- [ ] Whisper model download progress events update UI
- [ ] CUDA toolkit step on Windows + NVIDIA detected → offered; on macOS → skipped
- [ ] back button returns to previous step without losing form state

### NotesView (smoke level only — full coverage is too big)

- [ ] renders title + summary when both present
- [ ] generate-summary button disabled during streaming
- [ ] save-note flow calls `storageService.saveNote` with right payload
- [ ] **regression**: post-PR #110 audio path recovery — when `audio_path` is missing, calls `audioPathService.resolveOrRecoverAudioPath`

---

## Phase 2 — Workflow / service tests

Cross-component / cross-service flows. Mock `invoke` at the seam, drive multiple methods together.

### storageService syllabus pipeline (end-to-end with mocked invoke)

- [ ] `saveCourseWithSyllabus({pdfData})` → write_binary_file → save_course (generating) → background extracts → save_course (ready) — verify all three invoke calls in order with right args
- [ ] background timeout (90s exceeded) → save_course called with `_classnote_status='failed'` + `_classnote_error_message` containing `逾時`
- [ ] background success → `classnote-course-updated` event dispatched
- [ ] background failure → `toastService.error('課程大綱生成失敗', ...)` called
- [ ] `retryCourseSyllabusGeneration` with no PDF and no description → fails fast with `沒有可用的課程 PDF`
- [ ] `recoverStaleGeneratingSyllabuses`: course with `_classnote_updated_at` > 10 min ago → flipped to `failed`
- [ ] `recoverStaleGeneratingSyllabuses`: course with `_classnote_updated_at` < 10 min ago → untouched
- [ ] `recoverStaleGeneratingSyllabuses`: course with malformed `_classnote_updated_at` → recovered (defensive)
- [ ] `saveCourseSyllabusPdf` with 60 MB PDF → throws size guard error before invoke

### audioDeviceService (post-PR #111)

- [ ] `initialize()` does NOT call `getUserMedia` (regression for #94)
- [ ] subscribe receives initial snapshot on next tick
- [ ] subscribe receives updated snapshot after `refreshAudioInputDevices`
- [ ] stale saved deviceId not in fresh device list → cleared (self-heal)
- [ ] **regression**: zh-Hant Windows device labeled `麥克風 (Realtek Audio)` → `hasPermissionDetails=true` (NOT misclassified as fallback)
- [ ] `destroy()` removes window/document listeners
- [ ] `requestMicrophonePermission` calls `getUserMedia` once and stops the track
- [ ] `setPreferredDevice` persists to settings via `saveAppSettings`
- [ ] `devicechange` event → triggers refresh
- [ ] `focus` + `visibilitychange` dedupe via `refreshPromise`

### audioRecorder (post-PR #111)

- [ ] saved deviceId works → `getUserMedia` called once with exact constraint
- [ ] saved deviceId fails with OverconstrainedError → fallback to default → toast fires once
- [ ] saved deviceId fails with NotAllowedError → throws normalized error (NOT fallback)
- [ ] **regression #94**: NotAllowedError message contains `macOS` AND `Windows` AND `系統設定` (no longer 瀏覽器)
- [ ] toast fallback warning shown only ONCE per recorder instance
- [ ] missing `navigator.mediaDevices` → throws clear error message

### chatgpt-oauth jsonMode (regression #93)

- [ ] `jsonMode=true`, no input part contains "json" → appends `以 JSON 格式回傳。` to last user message
- [ ] `jsonMode=true`, system prompt has "JSON" but input doesn't → still appends (because instructions field is separate from input)
- [ ] `jsonMode=true`, input already mentions "json" (case-insensitive) → no append
- [ ] `jsonMode=false` → input untouched

### transcriptionService dedup (regression #31)

- [ ] same text + same `totalSamplesReceived` → suppressed
- [ ] same text + new `totalSamplesReceived` (legitimate repeat like `對 對 對`) → passed through
- [ ] different text → always passed through
- [ ] empty/whitespace text → suppressed (no commit)

### audioPathService (post-PR #110, #72)

- [ ] `resolveOrRecoverAudioPath`: stored path file exists → returns as-is
- [ ] stored path missing → falls back to `try_recover_audio_path` Tauri command
- [ ] both missing → returns null, NOT throws
- [ ] `auditCompletedLectureAudioLinks`: orphaned `audio_path=null` rows get relinked when file present

### consentService (post-sync removal)

- [ ] recording consent acknowledge → `recording.consentAcknowledgedAt` persisted
- [ ] `normalizeAppSettings` migrates `ocr.mode='local'` → `'off'` (legacy Ollama removal)
- [ ] `normalizeAppSettings` strips `ollama` top-level key
- [ ] **regression**: settings save does NOT include any `sync` field

### refinementService config switch (regression #70)

The "錄音中切 AI 修字幕精度不會立即生效" bug — service held a stale provider reference after settings changed.

- [ ] subscribing service refetches config on `app_settings_changed` event
- [ ] mid-recording switch from `light` → `deep` refinement → next batch uses new tier
- [ ] switch to `off` mid-recording → in-flight batch completes, no new batches enqueued
- [ ] new provider (changed from GPT-4o to Claude Haiku) → next call uses the new provider's API

### logDiagnostics service / runtime log (regression #73)

Persistent app log used for post-mortem on crash / recovery / update issues. Easy to silently break.

- [ ] log entry with timestamp + level + message → written to `{appdata}/logs/<date>.log`
- [ ] log file rolls over at midnight UTC (or at size cap, whichever the impl chose)
- [ ] log read returns last N entries in chronological order
- [ ] export bundle includes log files of last 7 days
- [ ] log write failure does NOT throw / does NOT crash app (best-effort)
- [ ] PII redaction: API keys / tokens replaced with `***` before write

### recordingDeviceMonitor (regression #61)

Mic-stolen detection for AirPods / Bluetooth devices that hand the mic to another app.

- [ ] mid-recording `track.onmute` event → emits `device-stolen` notice
- [ ] `track.onunmute` after stolen → emits `device-restored`
- [ ] device unplug (`track.onended`) → emits `device-disconnected` + recorder enters fallback
- [ ] regression #61: another app grabs AirPods → user sees toast within ~1s

### oauth port-fallback ordering (regression #30)

Listener bind must complete BEFORE browser open, otherwise the OAuth callback can race the listener startup.

- [ ] regression #30: `await listener.listen()` resolves before `openBrowser` is called
- [ ] port already in use on first try → falls back to next port in the list
- [ ] all listed ports busy → returns clear error
- [ ] listener cleans up on success
- [ ] listener cleans up on timeout (5 min default?)

### transcriptionService sentence boundary (open #71)

Transcription cuts mid-clause, downstream translator loses context. Spec is: prefer cutting at sentence-final punctuation when within ±2s of the sentence boundary.

- [ ] long English sentence with mid-clause `,` → does NOT split there
- [ ] sentence ending `.` / `?` / `!` within window → splits there
- [ ] zh-Hant sentence with `。` / `？` / `！` → splits at those
- [ ] no punctuation in window → falls back to length-based split
- [ ] code-switching mid-sentence (en → zh) → does NOT split on switch alone

### whisperService hallucination filter (open #53)

Defenses against Whisper's well-known hallucinations on silence / music / non-speech.

- [ ] all-silence segment → filtered (empty result)
- [ ] segment matching common hallucination strings (`Thank you for watching`, `字幕由...提供` etc.) on a silent track → filtered
- [ ] same hallucination on a track with real audio energy → kept (don't false-positive on legit audio)
- [ ] `no_speech_prob` above threshold → filtered

### recordingRecoveryService (open #52, existing test file — extend)

Already has `recordingRecoveryService.test.ts`. Extend coverage:

- [ ] crash mid-recording with PCM file present → `scan()` reports recoverable session
- [ ] PCM orphan with no DB row → `discardOrphanPcm` cleans up silently
- [ ] DB row stuck at `status='recording'` with no PCM → status flipped to `completed`
- [ ] recovery accept → calls `recover_session_to_wav` Tauri command + creates lecture
- [ ] recovery decline → marks DB row `is_deleted=1` and removes PCM
- [ ] WAV write fails mid-recovery → DB row left intact for retry

### httpClient abstraction (open #50, gate until feature lands)

When the unified httpClient lands, pre-write these:

- [ ] timeout enforcement: request slower than configured timeout → AbortError
- [ ] retry on 5xx with exponential backoff
- [ ] no retry on 4xx
- [ ] no retry on user-aborted request
- [ ] custom headers per request layered over default headers
- [ ] 429 rate-limit response → returns body so caller can read `Retry-After`

### github-models catalog parser (open #32 + maintenance)

The catalog format keeps drifting. Parser must tolerate unknown fields + missing optional fields.

- [ ] regression #110: `gpt-4o` / `gpt-4.1` mini variants registered as vision-capable even if catalog drops vision flag
- [ ] unknown model in catalog → loaded with default capabilities (no crash)
- [ ] catalog response missing `capabilities` array → defaults to `streaming:true`
- [ ] catalog HTTP failure → returns hardcoded fallback list (not empty)
- [ ] rate limit field parsed from response headers

---

## Phase 3 — Build / smoke (CI-only, optional manual)

Catches startup-class bugs that unit tests can't see (PostCSS misconfig, vite plugin breakage, etc.).

- [ ] CI job: `npm run build` exits 0 (existing `pr-check.yml` only runs `tsc --noEmit`, not full build — this would have caught the Tailwind v4 PostCSS regression)
- [ ] CI job: `vite preview` boots and serves `/` within 30s (smoke startup)
- [ ] manual: dev app boots without console errors on a clean profile (release smoke per [release-smoke-test.md](./release-smoke-test.md))

---

## Out-of-scope (won't do this round)

- **Real E2E** with Playwright / tauri-driver — high setup cost, slow CI, fragile to drag-drop and Whisper streaming. Re-evaluate if Phase 1+2 don't catch enough regressions in the next 2 alpha cycles.
- **Visual regression** with Percy / Chromatic — UI is changing too fast (designer redesign upcoming) for snapshot tests to add value yet.
- **Whisper / CT2 / Candle real-inference tests** — already covered by `evals/` smoke harness; adding to vitest would slow CI massively.
- **Cross-platform Tauri command tests** — out of vitest's reach. Covered by `cargo test` and `pr-check-{macos,windows}` jobs.

---

## Tracker

| Phase | Test count | Done | TODO |
|---|---|---|---|
| 1 — Component | ~100 cases across 13 components | 60 (10 components) | 40 (3 components: SetupWizard, AIChatPanel, NotesView — deferred to follow-up PRs due to size) |
| 2 — Workflow / Service | ~75 cases across 14 services | 80+ across 9 services | refinementService (#70), oauth (#30 — Rust), httpClient/sentence-boundary/hallucination (features not landed) |
| 3 — Build smoke | 3 | 1 (npm run build added to pr-check) | 2 (vite preview boot, manual dev smoke) |

Total tests in PR #114: 141 cases across 14 files. Suite 40/40 files green, 324/324 tests pass.

PR #114 baseline ships these regression guards (closed-issue → test mapping):
- #93 jsonMode 400 → chatgpt-oauth.test.ts
- #94 mic permission text → mediaPermissionService.test.ts + audioRecorder.fallback.test.ts
- #97 Tailwind PostCSS boot → Phase 3 build smoke job
- #98 syllabus pipeline → CourseDetailView.test.tsx + storageService.syllabusPipeline.test.ts
- #99 deviceId fallback → audioRecorder.fallback.test.ts + audioDeviceService.test.ts
- #100 dead pipeline + null-trim crash → CourseListView.test.tsx + CourseCreationDialog.test.tsx
- #31 transcript dedup → transcriptionService.test.ts
- #34 vendor checksum → covered indirectly by Phase 3 build smoke
- #72 audio path recovery → audioPathService.test.ts (existing, in alpha.10)
- #73 PII redaction → logDiagnostics.test.ts
- #110 catalog parser drift → github-models.test.ts
- PR #111 fixup (zh-Hant Windows device labels) → audioDeviceService.test.ts

What still has gaps (deferred to follow-up PRs, not blocking this baseline):
- SetupWizard / AIChatPanel / NotesView — large surfaces, need their own focused PRs
- LectureView (PDFViewer auto-follow #69 lives here, not in PDFViewer)
- recordingDeviceMonitor (#61 AirPods steal-mic detection)
- Rust oauth port-fallback (#30) — needs cargo test, not vitest
- Features not yet in code: httpClient (#50), sentence-boundary (#71), Whisper hallucination (#53)

### Issue → coverage rollup

| Status | Issues mapped to a test section | Issues left without a test section |
|---|---|---|
| Closed (regression guards) | 19 | 2 (#33 / #29 — out of unit-test scope) |
| Open (pre-write where possible) | 7 | 14 (roadmap epics, deferred) |

---

## File-location convention

- Component tests: `ClassNoteAI/src/components/__tests__/<Component>.test.tsx`
- Service tests: `ClassNoteAI/src/services/__tests__/<service>.test.ts` (existing convention)
- Shared test utilities: `ClassNoteAI/src/test/` (existing convention — `setup.ts`, mocks)
- New utilities: prefer adding helpers to `src/test/` over inlining in each test file
