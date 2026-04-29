/**
 * recordingSessionService — Phase 7 Sprint 1 singleton.
 *
 * Owns the full recording lifecycle (mic → ASR → segment buffer →
 * stop pipeline) so it survives navigation between H18 pages. UI
 * components subscribe to {@link RecordingSessionState} and dispatch
 * commands through this service; they MUST NOT poke at the underlying
 * `AudioRecorder` / `transcriptionService` directly.
 *
 * This Sprint 1 commit ships the following surface only:
 *   - state machine (idle → recording → paused → stopping → stopped)
 *   - subscribe / getState / reset (TEST-ONLY)
 *   - DOM event dispatch on every transition (RECORDING_CHANGE_EVENT)
 *   - visibilitychange + MediaStreamTrack.onended detection
 *   - recordingDeviceMonitor (mic device label change → toast)
 *   - mustFinalizeSync() best-effort drain for app close
 *
 * The full 6-step stop pipeline (transcribe → segment → index →
 * summary → done) is Sprint 2 work (S2.3); for now stop() is a
 * minimum-viable shim that flips status and lets callers move on.
 *
 * Why a singleton (not a hook):
 *   - useRecordingSession used to own the AudioRecorder instance via a
 *     useRef. Switching from the recording page to "Home" unmounted the
 *     hook and tore the recorder down mid-recording. Pulling state up
 *     to a module-level singleton lets the user navigate freely.
 *
 * Lazy imports for toastService / storageService / recordingDeviceMonitor
 * keep this module from pulling in the toast UI tree (and
 * isomorphic-dompurify) at boot when only the type/contract is needed.
 */

import type { SubtitleState, SubtitleSegment } from '../types/subtitle';

import {
    type RecordingSessionService,
    type RecordingSessionState,
    type RecordingStatus,
    type RecordingSegment,
    type StopPhase,
    type StartRecordingOptions,
    RECORDING_CHANGE_EVENT,
    type RecordingChangeDetail,
} from './__contracts__/recordingSessionService.contract';

import { AudioRecorder } from './audioRecorder';
import { transcriptionService } from './transcriptionService';
import { subtitleService } from './subtitleService';
import { taskTrackerService } from './taskTrackerService';
import { translationPipeline } from './streaming/translationPipeline';
import { summarizeStream } from './llm/tasks';
import { buildDeviceChangeWarning, type RecordingInputSnapshot } from './recordingDeviceMonitor';
import { toRelativeSeconds } from '../utils/subtitleTimestamp';

// NOTE: `storageService` stays behind the existing dynamic-import
// `storage()` helper. Static-importing it here makes it visible to the
// downstream test boundary (H18DeepApp.test.tsx mocks it via a factory
// referencing test-scope `mockStorage`) BEFORE the test's top-level
// consts have finished evaluating, which trips a Cannot-access-before-
// init ReferenceError. Lazy import preserves that test's contract.
//
// `taskTrackerService`, `summarizeStream`, `globalSearchService`, and
// `translationPipeline` are NOT subject to that constraint — no test
// downstream uses the same factory-with-closure-var pattern for them.
// Static-importing them avoids a different bug we hit in S2.3: vitest's
// dynamic-import mock cache occasionally returned the *real* module
// instead of the mocked one when the same `await import()` was issued
// concurrently from multiple call sites in stop() (steps 4/5 race).

// Re-export contract symbols so callers don't have to know we live
// behind a contract dir. Same pattern subtitleService et al. follow.
export type {
    RecordingSessionService,
    RecordingSessionState,
    RecordingStatus,
    RecordingSegment,
    StopPhase,
    StartRecordingOptions,
    RecordingChangeDetail,
};
export { RECORDING_CHANGE_EVENT };

/** Default state used at boot and after `reset()`. */
const INITIAL_STATE: RecordingSessionState = Object.freeze({
    status: 'idle',
    lectureId: undefined,
    courseId: undefined,
    segments: [],
    currentText: '',
    elapsed: 0,
    stopPhase: undefined,
    sessionStartMs: undefined,
    error: undefined,
});

/** Hidden-then-visible threshold for the "system probably slept" toast.
 *  Below this we assume the user just clicked away briefly (alt-tab) and
 *  don't bother them. */
const VISIBILITY_SLEEP_THRESHOLD_MS = 30_000;

/** Elapsed-counter tick. 250 ms keeps the UI under 4 ticks/sec which is
 *  smooth for the running clock without blowing CPU. */
const ELAPSED_TICK_MS = 250;

class RecordingSessionServiceImpl implements RecordingSessionService {
    private state: RecordingSessionState = { ...INITIAL_STATE, segments: [] };
    private subscribers = new Set<(s: RecordingSessionState) => void>();
    /** Idempotence guard — concurrent `start()` calls for the same lecture
     *  share this promise instead of double-starting the recorder. */
    private startInProgress: Promise<void> | null = null;
    private elapsedTimer: ReturnType<typeof setInterval> | null = null;
    private visibilityHidden = false;
    private visibilityHiddenAt: number | null = null;
    /** Last-known input device snapshot — used by recordingDeviceMonitor
     *  to detect mid-recording switches and warn the user. */
    private lastInputSnapshot: RecordingInputSnapshot | null = null;
    /** Subtitle stream subscription (so `state.segments` mirrors live ASR). */
    private subtitleUnsub: (() => void) | null = null;
    /** Ref to the active mic track so we can subscribe `onended` and inspect
     *  `readyState` from the visibilitychange handler. */
    private micTrack: MediaStreamTrack | null = null;
    /** Set to `true` once `attachVisibilityListener()` has been called.
     *  Listener removal is idempotent. */
    private visibilityAttached = false;

    private recorder: AudioRecorder | null = null;
    /** Lazy-imported handle to toastService. We avoid top-level import so
     *  test bundles that don't render toasts (most of them) skip pulling
     *  the React tree. */
    private async toast() {
        const m = await import('./toastService');
        return m.toastService;
    }

    /**
     * Lazy-imported handle to storageService. Cached per-instance after
     * first import so we don't pay the dynamic-import roundtrip on every
     * step of the stop pipeline. Caching also dodges a vitest quirk
     * we hit in S2.3 where repeated `await import()` of the same module
     * occasionally resolved to the *real* module instead of the mocked
     * one when the imports overlapped in time.
     */
    private storageCache: typeof import('./storageService').storageService | null = null;
    private async storage() {
        if (this.storageCache) return this.storageCache;
        const m = await import('./storageService');
        this.storageCache = m.storageService;
        return m.storageService;
    }

    // ─── Public API ─────────────────────────────────────────────────────

    async start(
        courseId: string,
        lectureId: string,
        opts?: StartRecordingOptions,
    ): Promise<void> {
        // Idempotence: if a start is in flight, share its promise.
        if (this.startInProgress) {
            // If the in-flight start is for a *different* lecture, that's
            // a programming error — the caller should have stopped first.
            if (
                this.state.lectureId &&
                this.state.lectureId !== lectureId
            ) {
                throw new Error(
                    `recordingSessionService: another start() is in flight ` +
                        `for lecture ${this.state.lectureId}; refuse to ` +
                        `start ${lectureId}`,
                );
            }
            return this.startInProgress;
        }

        // Already actively recording? Match-or-reject.
        if (
            this.state.status === 'recording' ||
            this.state.status === 'paused'
        ) {
            if (this.state.lectureId === lectureId) {
                // No-op — same session already live.
                return;
            }
            throw new Error(
                `recordingSessionService: a different recording is ` +
                    `already active (lecture=${this.state.lectureId}); ` +
                    `stop it before starting ${lectureId}`,
            );
        }

        this.startInProgress = this._doStart(courseId, lectureId, opts);
        try {
            await this.startInProgress;
        } finally {
            this.startInProgress = null;
        }
    }

    private async _doStart(
        courseId: string,
        lectureId: string,
        _opts?: StartRecordingOptions,
    ): Promise<void> {
        try {
            // Pre-flight: subscribe to subtitleService BEFORE asking the
            // recorder for a track so the very first ASR sentence isn't
            // dropped on the floor.
            this.attachSubtitleSubscriber();

            // Wire transcription. setLectureId for downstream consumers
            // that key off it (subtitle persistence will land in S2.3).
            try {
                transcriptionService.setLectureId(lectureId);
            } catch {
                /* fields may not exist in test stubs; tolerate */
            }
            await transcriptionService.start();

            // Bring up the recorder. Lazy-construct so test runs that
            // never call start() don't pay the AudioContext cost.
            //
            // cp75: pull the user-preferred mic from settings.audio.device_id
            // so the picker actually works. Before this, AudioRecorder({})
            // was hardcoded with no deviceId → getUserMedia always fell back
            // to the OS default mic, ignoring whatever the user picked in
            // PAudio. Tolerate failure — if device prep blows up we still
            // want to record (with the OS default).
            let preferredDeviceId: string | undefined;
            try {
                const { audioDeviceService } = await import('./audioDeviceService');
                const prepared = await audioDeviceService
                    .preparePreferredInputDeviceForRecording()
                    .catch(() => null);
                preferredDeviceId =
                    typeof prepared === 'string' && prepared.length > 0
                        ? prepared
                        : undefined;
            } catch (err) {
                console.warn(
                    '[recordingSession] device prep failed; using default mic',
                    err,
                );
            }
            if (!this.recorder) {
                this.recorder = new AudioRecorder(
                    preferredDeviceId ? { deviceId: preferredDeviceId } : {},
                );
            } else if (preferredDeviceId) {
                try {
                    this.recorder.setDeviceId(preferredDeviceId);
                } catch (err) {
                    console.warn('[recordingSession] setDeviceId failed', err);
                }
            }
            // Wire mic chunks → ASR. (useRecordingSession had this — the
            // reason 字幕 pane stayed blank in P6.5 before they wired it.)
            this.recorder.onChunk((chunk) => {
                transcriptionService.addAudioChunk(chunk);
            });

            try {
                this.recorder.enablePersistence(lectureId);
            } catch {
                // Persistence is a recovery feature; not fatal if it
                // fails to wire up.
            }

            await this.recorder.start();

            // Track the mic snapshot for device-change detection.
            const info = this.recorder.getInputDeviceInfo();
            if (info) {
                this.lastInputSnapshot = {
                    label: info.label,
                    sampleRate: info.sampleRate,
                };
            }

            // W15: subscribe MediaStreamTrack.onended so we notice when
            // the OS yanks the mic mid-session (sleep, headset unplug,
            // permission revoked, etc.).
            this.attachMicTrackListener();

            // S1.14: spin up devicechange detection too. The helper
            // `buildDeviceChangeWarning` is pure — we drive it from
            // navigator.mediaDevices' devicechange event below.
            this.attachDeviceMonitor();

            // S1.6: visibilitychange — if hidden long enough that mic
            // probably went to sleep, warn on resume.
            this.attachVisibilityListener();

            // Flip state + start elapsed ticker.
            const now = Date.now();
            this.setState({
                status: 'recording',
                lectureId,
                courseId,
                segments: [],
                currentText: '',
                elapsed: 0,
                sessionStartMs: now,
                error: undefined,
                stopPhase: undefined,
            });
            this.startElapsedTimer();
            this.dispatch('start');
        } catch (err) {
            // Best-effort cleanup so callers can retry.
            this.cleanupListeners();
            try {
                await this.recorder?.stop();
            } catch {
                /* swallow */
            }
            try {
                await transcriptionService.stop();
            } catch {
                /* swallow */
            }
            this.setState({
                status: 'idle',
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }

    async pause(): Promise<void> {
        if (this.state.status !== 'recording') return;
        try {
            this.recorder?.pause();
            transcriptionService.pause();
        } catch (err) {
            console.warn('[recordingSessionService] pause failed:', err);
        }
        this.stopElapsedTimer();
        this.setState({ status: 'paused' });
        this.dispatch('pause');
    }

    async resume(): Promise<void> {
        if (this.state.status !== 'paused') return;
        try {
            await this.recorder?.resume();
            transcriptionService.resume();
        } catch (err) {
            console.warn('[recordingSessionService] resume failed:', err);
        }
        this.startElapsedTimer();
        this.setState({ status: 'recording' });
        this.dispatch('resume');
    }

    async stop(): Promise<void> {
        if (
            this.state.status !== 'recording' &&
            this.state.status !== 'paused'
        ) {
            // Idle / stopping / stopped → no-op. Callers that need
            // idempotence can call without checking.
            return;
        }

        const lectureId = this.state.lectureId;
        const courseId = this.state.courseId;
        if (!lectureId || !courseId) {
            // Defensive — start() always sets both. If we somehow got
            // here without identifiers we cannot run the pipeline at all.
            this.stopElapsedTimer();
            this.cleanupListeners();
            this.setState({
                status: 'stopped',
                stopPhase: 'failed',
                error: 'no active lecture',
            });
            this.dispatch('stop');
            await this.emitFinalStopToast(/* segmentSaved */ false);
            return;
        }

        // Stop the elapsed-timer regardless of which step we end up on.
        this.stopElapsedTimer();
        this.setState({ status: 'stopping', stopPhase: 'transcribe' });

        // W17 · track step-by-step persistence outcomes so the final
        // coalesced toast at the bottom of stop() can describe what
        // actually got saved. We treat "subtitles persisted" as the
        // user-visible success bar — if step 3 succeeds the user can
        // still find their session even when step 2/6 had hiccups.
        let segmentSaved = false;

        // ──────────────────────────────────────────────────────────────
        // Step 1 · transcribe — flush ASR + drain pending translations
        // Failure here is NOT fatal; we lose the very last sentence's
        // zh translation in the worst case, but the user still has
        // everything that was already committed by step-2 onward.
        // ──────────────────────────────────────────────────────────────
        try {
            await transcriptionService.stop();
        } catch (err) {
            console.error(
                '[recordingSession.stop] step 1 (transcribe) failed:',
                err,
            );
            // not fatal — keep going
        }
        try {
            await translationPipeline.awaitDrain();
        } catch (err) {
            console.error(
                '[recordingSession.stop] step 1 (translation drain) failed:',
                err,
            );
            // not fatal
        }

        // ──────────────────────────────────────────────────────────────
        // Step 2 · segment — wrap PCM → WAV on disk via the Rust side.
        // Audio is the user's source-of-truth; if this fails we abort
        // the pipeline and surface a failure so the user knows their
        // recording wasn't saved.
        // ──────────────────────────────────────────────────────────────
        this.setState({ stopPhase: 'segment' });
        let finalAudioPath: string | null = null;
        try {
            // Build the canonical audio path the same way the recovery
            // service does (recordingRecoveryService.recover) so the
            // app's audio-path conventions stay consistent.
            const { invoke } = await import('@tauri-apps/api/core');
            const audioDir = await invoke<string>('get_audio_dir');
            const sep =
                typeof navigator !== 'undefined' &&
                navigator.userAgent.includes('Windows')
                    ? '\\'
                    : '/';
            const finalPath = `${audioDir}${sep}lecture_${lectureId}_${Date.now()}.wav`;
            const written = await this.recorder?.finalizeToDisk(finalPath);
            // finalizeToDisk returns null when persistence wasn't enabled
            // (test paths, mostly). Still treat it as "non-fatal but no
            // audio saved" — the JS-side WAV fallback is gone after the
            // recorder was destroyed. Down-stream lecture row simply
            // won't have audio_path, the rest of the pipeline still runs.
            finalAudioPath = written ?? null;
            // Also stop the recorder's audio graph if it's still running.
            try {
                await this.recorder?.stop();
            } catch (err) {
                console.warn(
                    '[recordingSession.stop] recorder.stop after finalize failed:',
                    err,
                );
            }
        } catch (err) {
            console.error(
                '[recordingSession.stop] step 2 (segment) failed:',
                err,
            );
            this.cleanupListeners();
            this.setState({
                status: 'stopped',
                stopPhase: 'failed',
                error:
                    err instanceof Error
                        ? `audio finalize failed: ${err.message}`
                        : 'audio finalize failed',
            });
            this.dispatch('stop');
            await this.emitFinalStopToast(segmentSaved);
            return;
        }

        // ──────────────────────────────────────────────────────────────
        // Step 3 · index — saveSubtitles + invalidate global search
        // Subtitles are the user's other source-of-truth (search /
        // review). Failure here is fatal for the pipeline.
        // ──────────────────────────────────────────────────────────────
        this.setState({ stopPhase: 'index' });
        try {
            const storage = await this.storage();
            const segments = subtitleService.getSegments();

            // Map SubtitleSegment → Subtitle for DB persistence.
            // We use 'rough' for `type` because Sprint 3 'live' enum
            // expansion (V11) hasn't shipped yet — fixture S0.2 also
            // uses 'rough'. timestamps stored as **relative seconds (float)**
            // since lecture start, per V12 schema (PHASE-7-PLAN §8.1 / S2.11).
            // `toRelativeSeconds` is idempotent against already-relative input
            // and clamps any clock-skew negatives to 0.
            const sessionStart = this.state.sessionStartMs ?? 0;
            const subtitles = segments.map((seg, i) => {
                const relSec = toRelativeSeconds(seg.startTime, sessionStart);
                const startMs = Math.max(0, seg.startTime - sessionStart);
                // Phase 7 cp74.1: persist BOTH layers separately so we
                // never overwrite the rough original with the LLM-refined
                // version. text_en / text_zh hold rough; fine_text /
                // fine_translation hold the refined version (undefined
                // until a future fine-refinement pipeline runs).
                //
                // type = 'fine' iff fine_text is set, else 'rough'. This
                // makes `type` a derived "best available tier" pointer.
                // Keep displayTranslation in the rough fallback chain as
                // last-resort because older code paths may set it without
                // writing back to roughTranslation (Bug 2 defensive).
                const roughEn = seg.roughText ?? seg.displayText ?? '';
                const roughZh =
                    seg.roughTranslation ?? seg.displayTranslation;
                return {
                    id: `sub-${lectureId}-${i}`,
                    lecture_id: lectureId,
                    timestamp: relSec,
                    text_en: roughEn,
                    text_zh: roughZh,
                    fine_text: seg.fineText,
                    fine_translation: seg.fineTranslation,
                    fine_confidence: seg.fineConfidence,
                    type: (seg.fineText ? 'fine' : 'rough') as 'fine' | 'rough',
                    source: 'live' as const,
                    confidence: seg.roughConfidence,
                    created_at: new Date(
                        (this.state.sessionStartMs ?? Date.now()) + startMs,
                    ).toISOString(),
                };
            });

            await storage.saveSubtitles(subtitles);
            segmentSaved = true;

            // N4 · keep global search index in sync. The service builds
            // its own index from storageService on next search; we just
            // need to invalidate so the *next* ⌘K query rebuilds with
            // the new lecture's data included. Dynamic import to keep
            // globalSearchService (which statically imports storageService)
            // out of the H18DeepApp.test.tsx mock-hoist hot path.
            try {
                const { globalSearchService } = await import('./globalSearchService');
                globalSearchService.invalidate();
            } catch (err) {
                console.warn(
                    '[recordingSession.stop] global search invalidate failed:',
                    err,
                );
                // not fatal — search will still rebuild from
                // classnote-courses-changed when the lecture row flips.
            }
        } catch (err) {
            console.error(
                '[recordingSession.stop] step 3 (index) failed:',
                err,
            );
            this.cleanupListeners();
            this.setState({
                status: 'stopped',
                stopPhase: 'failed',
                error:
                    err instanceof Error
                        ? `subtitles save failed: ${err.message}`
                        : 'subtitles save failed',
            });
            this.dispatch('stop');
            await this.emitFinalStopToast(segmentSaved);
            return;
        }

        // ──────────────────────────────────────────────────────────────
        // Step 4 · summary — kick off background task. We do NOT await
        // — stop() should return to the user in seconds, not the 30-60s
        // a long lecture's reduce phase takes.
        // ──────────────────────────────────────────────────────────────
        this.setState({ stopPhase: 'summary' });
        try {
            const summaryTaskId = taskTrackerService.start({
                kind: 'summarize',
                label: '生成課堂摘要',
                lectureId,
            });
            // Fire-and-forget. runBackgroundSummary handles its own
            // tracker complete/fail bookkeeping.
            void this.runBackgroundSummary(summaryTaskId, lectureId);
        } catch (err) {
            console.warn(
                '[recordingSession.stop] step 4 (summary kick-off) failed:',
                err,
            );
            // not fatal — review page can manually retry from the regen
            // button.
        }

        // ──────────────────────────────────────────────────────────────
        // Step 5 · index lecture — RAG embeddings. Same fire-and-forget
        // pattern as step 4.
        // ──────────────────────────────────────────────────────────────
        try {
            const indexTaskId = taskTrackerService.start({
                kind: 'index',
                label: '建立 RAG 索引',
                lectureId,
            });
            void this.runBackgroundIndex(indexTaskId, lectureId);
        } catch (err) {
            console.warn(
                '[recordingSession.stop] step 5 (index kick-off) failed:',
                err,
            );
            // not fatal — RAG retrieval will fall back to BM25 only.
        }

        // ──────────────────────────────────────────────────────────────
        // Step 6 · done — flip the lecture row to 'completed', wire in
        // the audio_path we got from step 2, dispatch the event.
        // ──────────────────────────────────────────────────────────────
        try {
            const storage = await this.storage();
            const lecture = await storage.getLecture(lectureId);
            if (lecture) {
                await storage.saveLecture({
                    ...lecture,
                    status: 'completed',
                    audio_path: finalAudioPath ?? lecture.audio_path,
                    updated_at: new Date().toISOString(),
                });
            } else {
                // No row yet — happens in tests that never created one.
                // Do a minimal upsert with the canonical shape. Cast
                // because Lecture type requires fields we don't have
                // here; the Rust side rejects truly invalid rows.
                await storage.saveLecture({
                    id: lectureId,
                    course_id: courseId,
                    title: '',
                    date: new Date().toISOString(),
                    duration: 0,
                    status: 'completed',
                    audio_path: finalAudioPath ?? undefined,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                } as unknown as Parameters<typeof storage.saveLecture>[0]);
            }
        } catch (err) {
            console.error(
                '[recordingSession.stop] step 6 (lecture status) failed:',
                err,
            );
            // not fatal — we still flip our own state to stopped/done
            // and dispatch so the UI advances to review.
        }

        this.cleanupListeners();
        this.setState({ status: 'stopped', stopPhase: 'done' });
        this.dispatch('stop');
        await this.emitFinalStopToast(segmentSaved);
    }

    /**
     * W17 · Emit a single coalesced toast at the end of stop(). Each
     * step-level handler stays toast-free (just console.error +
     * setState({error})) so the user sees one summary toast instead of
     * a parade of red bars when something goes wrong mid-pipeline.
     *
     * Background tasks (step 4 summary, step 5 RAG index) own their own
     * tracker.fail() bookkeeping — they intentionally do NOT route
     * through this helper, since they fire long after stop() resolves.
     */
    private async emitFinalStopToast(segmentSaved: boolean): Promise<void> {
        const { stopPhase, error } = this.state;
        // Only emit once we've reached a terminal stopPhase. Anything
        // else is a programming error in stop()'s control flow.
        if (stopPhase !== 'failed' && stopPhase !== 'done') return;
        try {
            const toast = await this.toast();
            if (stopPhase === 'failed') {
                toast.warning(
                    '錄音儲存發生問題',
                    `字幕${segmentSaved ? '已' : '部分'}保留。${error ?? ''}`.trim(),
                );
            } else {
                toast.success(
                    '✓ 錄音已儲存',
                    '字幕入庫；摘要與索引在背景生成中。',
                );
            }
        } catch (err) {
            console.warn(
                '[recordingSession.stop] final toast emit failed:',
                err,
            );
        }
    }

    /**
     * Step 4 background task — pull subtitles from storage, run them
     * through `summarizeStream`, persist the resulting note, and update
     * the task tracker with progress along the way.
     *
     * Failure is captured in the tracker only — `stop()` already
     * resolved by the time we get here. ReviewPage's note tab is
     * responsible for surfacing retry UI to the user.
     */
    private async runBackgroundSummary(
        taskId: string,
        lectureId: string,
    ): Promise<void> {
        try {
            const storage = await this.storage();
            const subs = await storage
                .getSubtitles(lectureId)
                .catch(() => [] as Awaited<ReturnType<typeof storage.getSubtitles>>);
            // Build the source text. Prefer English (richer transcript);
            // fall back to zh per-row when text_en is empty so we still
            // produce *something* for the user.
            const text = subs
                .map((s) => s.text_en || s.text_zh || '')
                .filter(Boolean)
                .join('\n');

            // Don't waste an LLM call on a 5-second test ping.
            // 100 chars ≈ one short paragraph, which matches the
            // PHASE-7-PLAN §S2.3 minimum.
            if (text.trim().length < 100) {
                taskTrackerService.complete(taskId);
                return;
            }

            taskTrackerService.update(taskId, { status: 'running' });

            let fullSummary = '';
            let chunkCount = 0;

            for await (const event of summarizeStream({
                content: text,
                language: 'zh',
            })) {
                if (
                    event.phase === 'reduce-delta' &&
                    typeof event.delta === 'string'
                ) {
                    fullSummary += event.delta;
                    chunkCount += 1;
                    // Cap progress at 0.95 — we still need to do the DB
                    // write before we can call it done.
                    taskTrackerService.update(taskId, {
                        progress: Math.min(0.95, chunkCount * 0.05),
                        status: 'running',
                    });
                } else if (
                    event.phase === 'done' &&
                    typeof event.fullText === 'string'
                ) {
                    fullSummary = event.fullText;
                }
            }

            // Persist into the note row. Merge with whatever's already
            // there (qa_records, sections from a prior run) so we don't
            // wipe user work when re-summarising.
            try {
                const existing = await storage.getNote(lectureId);
                const now = new Date().toISOString();
                await storage.saveNote({
                    lecture_id: lectureId,
                    title: existing?.title ?? '',
                    summary: fullSummary,
                    sections: existing?.sections ?? [],
                    qa_records: existing?.qa_records ?? [],
                    generated_at: now,
                });
            } catch (err) {
                console.error(
                    '[recordingSession.runBackgroundSummary] saveNote failed:',
                    err,
                );
                // Surface as a failed task — but the summary text is
                // gone unless we also store it elsewhere; today we don't.
                taskTrackerService.fail(
                    taskId,
                    err instanceof Error
                        ? err.message
                        : '保存筆記失敗',
                );
                return;
            }

            taskTrackerService.complete(taskId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            taskTrackerService.fail(taskId, msg);
        }
    }

    /**
     * Step 5 background task — run RAG indexing for the lecture, with
     * progress reported into the task tracker. Failure is non-fatal:
     * RAG falls back to BM25-only retrieval if there are no embeddings.
     */
    private async runBackgroundIndex(
        taskId: string,
        lectureId: string,
    ): Promise<void> {
        try {
            taskTrackerService.update(taskId, { status: 'running' });

            // ragService pulls in pdfjs-dist which crashes when loaded
            // at module-eval time in jsdom (`DOMMatrix is not defined`).
            // Lazy-load it here so it stays out of recordingSessionService's
            // import graph.
            const { ragService } = await import('./ragService');

            // Build transcriptText from the just-saved subtitles. PDF
            // text is a separate import flow; we don't have one yet
            // for live recordings, so pass null.
            const storage = await this.storage();
            const subs = await storage
                .getSubtitles(lectureId)
                .catch(() => [] as Awaited<ReturnType<typeof storage.getSubtitles>>);
            const transcriptText = subs
                .map((s) => s.text_en || s.text_zh || '')
                .filter(Boolean)
                .join('\n');

            await ragService.indexLecture(
                lectureId,
                /* pdfText */ null,
                transcriptText.length > 0 ? transcriptText : null,
                (progress) => {
                    // IndexingProgress.{stage,current,total}; map to 0..1.
                    if (progress.total > 0) {
                        const p = Math.min(
                            0.99,
                            progress.current / progress.total,
                        );
                        taskTrackerService.update(taskId, {
                            progress: p,
                            status: 'running',
                        });
                    }
                },
            );

            taskTrackerService.complete(taskId);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            taskTrackerService.fail(taskId, msg);
        }
    }

    subscribe(cb: (state: RecordingSessionState) => void): () => void {
        this.subscribers.add(cb);
        // Push current state immediately so a late subscriber doesn't
        // miss the snapshot it needed to render with.
        try {
            cb(this.getState());
        } catch (err) {
            console.warn('[recordingSessionService] subscriber threw on initial fire:', err);
        }
        return () => {
            this.subscribers.delete(cb);
        };
    }

    getState(): RecordingSessionState {
        // Defensive copy — segments[] is the only reference type that
        // could leak mutation. Spread the array; `error/stopPhase/etc`
        // are primitives.
        return { ...this.state, segments: [...this.state.segments] };
    }

    /**
     * TEST-ONLY. Production code MUST NOT call this — bypasses the
     * stop pipeline and will leak the AudioRecorder if a session is
     * live. Wired into setup.ts beforeEach via registerSingletonReset.
     */
    reset(): void {
        // Tear down listeners + timers without trying to clean up
        // anything async; tests want sync state.
        this.cleanupListeners();
        this.stopElapsedTimer();
        this.startInProgress = null;
        this.recorder = null;
        this.micTrack = null;
        this.lastInputSnapshot = null;
        this.visibilityHidden = false;
        this.visibilityHiddenAt = null;
        this.storageCache = null;
        this.state = { ...INITIAL_STATE, segments: [] };
        // NOTE: subscribers Set is intentionally NOT cleared. Tests
        // that subscribe register their own cleanup; clearing here
        // would surprise tests that subscribe during beforeAll.
    }

    /**
     * App-close path (V4). Best-effort sync drain:
     *   1. transcriptionService.stop() — flushes the in-flight ASR sentence
     *   2. recorder.flushPersistenceNow() — drain pending PCM chunks to disk
     *   3. saveSubtitles() — persist whatever the live segment buffer holds
     *   4. saveLecture(status='completed') — flip the lecture row
     * Returns true on overall success; false lets the caller (App-level
     * onCloseRequested) decide whether to cancel the close.
     */
    async mustFinalizeSync(): Promise<boolean> {
        const lectureId = this.state.lectureId;
        const status = this.state.status;
        if (status === 'idle' || status === 'stopped') return true;
        if (!lectureId) return true;

        try {
            // 1. ASR drain
            try {
                await transcriptionService.stop();
            } catch (err) {
                console.warn('[recordingSessionService] mustFinalizeSync: stop ASR failed:', err);
            }

            // 2. Persist any pending PCM
            try {
                await this.recorder?.flushPersistenceNow?.();
            } catch (err) {
                console.warn('[recordingSessionService] mustFinalizeSync: flush PCM failed:', err);
            }

            // 3. Persist subtitles. Build minimal Subtitle rows from the
            // live segment buffer. `s.startMs` is already session-relative
            // ms (see attachSubtitleSubscriber); divide by 1000 to land on
            // the V12 spec format of relative-seconds-float (S2.11).
            const storage = await this.storage();
            const segments = this.state.segments;
            if (segments.length > 0) {
                const subtitleRows = segments.map((s) => ({
                    id: s.id,
                    lecture_id: lectureId,
                    timestamp: Math.max(0, s.startMs / 1000),
                    text_en: s.textEn || '',
                    text_zh: s.textZh,
                    type: 'rough' as const,
                    created_at: new Date(s.startMs).toISOString(),
                }));
                await storage.saveSubtitles(subtitleRows);
            }

            // 4. Flip lecture status. 'failed' enum is Sprint 2 (S2.10)
            // — for now we stay within `'completed'`.
            const lecture = await storage.getLecture(lectureId);
            if (lecture) {
                await storage.saveLecture({
                    ...lecture,
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                });
            }

            // Note: summary + index intentionally NOT run here. They
            // get queued into pending_actions in S2.9 — this method's
            // job is purely to keep the user's data alive across close.
            return true;
        } catch (err) {
            console.error('[recordingSessionService] mustFinalizeSync failed:', err);
            return false;
        }
    }

    // ─── Internals ──────────────────────────────────────────────────────

    private setState(patch: Partial<RecordingSessionState>): void {
        this.state = { ...this.state, ...patch };
        const snapshot = this.getState();
        this.subscribers.forEach((cb) => {
            try {
                cb(snapshot);
            } catch (err) {
                console.warn('[recordingSessionService] subscriber threw:', err);
            }
        });
    }

    private dispatch(kind: 'start' | 'pause' | 'resume' | 'stop'): void {
        if (typeof window === 'undefined') return;
        const lectureId = this.state.lectureId;
        const courseId = this.state.courseId;
        if (!lectureId || !courseId) return;
        const detail: RecordingChangeDetail = { kind, lectureId, courseId };
        try {
            window.dispatchEvent(
                new CustomEvent(RECORDING_CHANGE_EVENT, { detail }),
            );
        } catch (err) {
            console.warn('[recordingSessionService] dispatch failed:', err);
        }
    }

    private startElapsedTimer(): void {
        this.stopElapsedTimer();
        this.elapsedTimer = setInterval(() => {
            const t0 = this.state.sessionStartMs;
            if (typeof t0 !== 'number') return;
            this.setState({ elapsed: Math.max(0, (Date.now() - t0) / 1000) });
        }, ELAPSED_TICK_MS);
    }

    private stopElapsedTimer(): void {
        if (this.elapsedTimer) {
            clearInterval(this.elapsedTimer);
            this.elapsedTimer = null;
        }
    }

    private attachSubtitleSubscriber(): void {
        if (this.subtitleUnsub) return;
        this.subtitleUnsub = subtitleService.subscribe((sub: SubtitleState) => {
            // Map SubtitleSegment[] → RecordingSegment[]. Live segments
            // store `startTime/endTime` as **wall-clock ms**; convert to
            // session-relative ms here so RecordingSegment is consistent.
            const sessionStart = this.state.sessionStartMs ?? 0;
            const segments: RecordingSegment[] = sub.segments.map(
                (seg: SubtitleSegment) => ({
                    id: seg.id,
                    lectureId: this.state.lectureId ?? '',
                    startMs: Math.max(0, seg.startTime - sessionStart),
                    endMs: Math.max(0, seg.endTime - sessionStart),
                    textEn:
                        seg.fineText ?? seg.roughText ?? seg.displayText ?? '',
                    textZh:
                        seg.fineTranslation ??
                        seg.roughTranslation ??
                        seg.displayTranslation,
                }),
            );
            this.setState({
                segments,
                currentText: sub.currentText,
            });
        });
    }

    /** S1.6 — visibilitychange. */
    private attachVisibilityListener(): void {
        if (typeof document === 'undefined') return;
        if (this.visibilityAttached) return;
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        this.visibilityAttached = true;
    }

    private detachVisibilityListener(): void {
        if (typeof document === 'undefined') return;
        if (!this.visibilityAttached) return;
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.visibilityAttached = false;
    }

    private readonly onVisibilityChange = (): void => {
        if (typeof document === 'undefined') return;
        if (document.visibilityState === 'hidden') {
            this.visibilityHidden = true;
            this.visibilityHiddenAt = Date.now();
            return;
        }
        // visibilityState becomes 'visible'.
        if (!this.visibilityHidden) return;
        const hiddenAt = this.visibilityHiddenAt;
        this.visibilityHidden = false;
        this.visibilityHiddenAt = null;
        if (hiddenAt === null) return;
        const elapsedHidden = Date.now() - hiddenAt;
        if (elapsedHidden < VISIBILITY_SLEEP_THRESHOLD_MS) return;
        // Only worry about live recordings.
        if (this.state.status !== 'recording') return;
        // The mic survived? Nothing to warn about.
        if (this.micTrack && this.micTrack.readyState !== 'ended') return;
        // OK, mic is dead AND we were hidden long enough that this looks
        // like a real OS sleep — alert the user.
        const minutes = Math.max(1, Math.round(elapsedHidden / 60_000));
        void this.toast().then((toast) =>
            toast.warning(
                '錄音可能因系統 sleep 中斷',
                `麥克風在約 ${minutes} 分鐘前停止。請去 Review 確認。`,
            ),
        );
    };

    /** W15 — MediaStreamTrack.onended.
     *  AudioRecorder doesn't (yet) expose its MediaStream publicly; we
     *  reach in via a private-field cast. When AudioRecorder gains a
     *  `getMediaStream()` accessor (Sprint 1 follow-up), drop the cast. */
    private attachMicTrackListener(): void {
        if (!this.recorder) return;
        const recorderInternal = this.recorder as unknown as {
            mediaStream?: MediaStream | null;
        };
        const stream = recorderInternal.mediaStream ?? null;
        const track = stream?.getAudioTracks?.()[0] ?? null;
        this.micTrack = track;
        if (!this.micTrack) return;
        this.micTrack.addEventListener('ended', this.onTrackEnded);
    }

    private detachMicTrackListener(): void {
        if (this.micTrack) {
            this.micTrack.removeEventListener('ended', this.onTrackEnded);
            this.micTrack = null;
        }
    }

    private readonly onTrackEnded = (): void => {
        if (this.state.status !== 'recording' && this.state.status !== 'paused') {
            return;
        }
        // Don't auto-stop — the user might want a moment to decide
        // whether to keep the partial. Just record the error and warn.
        this.setState({ error: 'mic ended unexpectedly' });
        void this.toast().then((toast) =>
            toast.warning(
                '麥克風中斷',
                '錄音裝置失去連線。建議結束錄音以保留現有字幕。',
            ),
        );
    };

    /** S1.14 — recordingDeviceMonitor (pure helper) integration.
     *  Subscribes to navigator.mediaDevices.devicechange and feeds the
     *  resulting label diff through `buildDeviceChangeWarning`. */
    private deviceChangeHandler: (() => void) | null = null;

    private attachDeviceMonitor(): void {
        if (typeof navigator === 'undefined') return;
        const md = (navigator as Navigator).mediaDevices;
        if (!md || typeof md.addEventListener !== 'function') return;
        if (this.deviceChangeHandler) return;
        this.deviceChangeHandler = () => {
            // cp75: respect settings.audio.auto_switch_detection. The toggle
            // existed in PAudio (ProfilePanes) since cp70a but the handler
            // never read it — turning it off did nothing. Lazy-import the
            // storage service so test environments without it don't break.
            void (async () => {
                try {
                    const { storageService } = await import('./storageService');
                    const settings = await storageService.getAppSettings();
                    if (settings?.audio?.auto_switch_detection === false) {
                        return; // user explicitly disabled monitoring
                    }
                } catch {
                    // Could not read settings — default to monitoring on.
                }

                // Re-query device info from the recorder. If the active
                // input changed, surface a toast.
                const info = this.recorder?.getInputDeviceInfo();
                if (!info) return;
                const next: RecordingInputSnapshot = {
                    label: info.label,
                    sampleRate: info.sampleRate,
                };
                const warning = buildDeviceChangeWarning(
                    this.lastInputSnapshot,
                    next,
                );
                this.lastInputSnapshot = next;
                if (!warning) return;
                void this.toast().then((toast) =>
                    toast.warning(warning.message, warning.detail),
                );
            })();
        };
        md.addEventListener('devicechange', this.deviceChangeHandler);
    }

    private detachDeviceMonitor(): void {
        if (typeof navigator === 'undefined') return;
        const md = (navigator as Navigator).mediaDevices;
        if (!md || typeof md.removeEventListener !== 'function') return;
        if (!this.deviceChangeHandler) return;
        md.removeEventListener('devicechange', this.deviceChangeHandler);
        this.deviceChangeHandler = null;
    }

    private cleanupListeners(): void {
        if (this.subtitleUnsub) {
            try {
                this.subtitleUnsub();
            } catch {
                /* swallow */
            }
            this.subtitleUnsub = null;
        }
        this.detachMicTrackListener();
        this.detachDeviceMonitor();
        this.detachVisibilityListener();
    }

    // ─── TEST-ONLY helpers (used by recordingSessionService.test.ts) ───
    /** @internal Inject a fake mic track for W15 tests. Not part of the
     *  public contract — production code never sets this. */
    public _setMicTrackForTest(track: MediaStreamTrack | null): void {
        this.detachMicTrackListener();
        this.micTrack = track;
        if (track) {
            track.addEventListener('ended', this.onTrackEnded);
        }
    }

    /** @internal Force state for tests that need to assert downstream
     *  effects (e.g. visibilitychange behaviour while recording). */
    public _setStateForTest(patch: Partial<RecordingSessionState>): void {
        this.setState(patch);
    }
}

export const recordingSessionService: RecordingSessionService &
    RecordingSessionServiceImpl = new RecordingSessionServiceImpl();

// S0.14 wiring is opt-in: tests `import { registerSingletonReset } from
// '../test/setup'` and call `registerSingletonReset(() =>
// recordingSessionService.reset())` themselves in their setup file.
// We don't auto-register here because that would import test infra at
// production runtime — see PHASE-7-PLAN §S0.14 "妥協方案" note.
