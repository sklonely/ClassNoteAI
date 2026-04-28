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
import { buildDeviceChangeWarning, type RecordingInputSnapshot } from './recordingDeviceMonitor';

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

    private async storage() {
        const m = await import('./storageService');
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
            if (!this.recorder) {
                this.recorder = new AudioRecorder({});
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
        // Capture identifiers BEFORE we wipe state — `dispatch('stop')`
        // needs them and the setState({ status: 'stopped' }) we do at
        // the end will leave them set, so we don't need to copy here.
        this.stopElapsedTimer();
        this.setState({ status: 'stopping', stopPhase: 'transcribe' });

        // Sprint 1 stub: minimum-viable stop. Sprint 2 (S2.3) replaces
        // the body of this try with the real 6-step pipeline.
        try {
            await transcriptionService.stop();
            await this.recorder?.stop();
            this.cleanupListeners();
            this.setState({ status: 'stopped', stopPhase: 'done' });
            this.dispatch('stop');
        } catch (err) {
            this.cleanupListeners();
            this.setState({
                status: 'stopped',
                stopPhase: 'failed',
                error: err instanceof Error ? err.message : String(err),
            });
            // Still dispatch stop — listeners (TopBar pulse etc.) need
            // to know the recording ended even if it ended badly.
            this.dispatch('stop');
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
            // live segment buffer.
            const storage = await this.storage();
            const segments = this.state.segments;
            if (segments.length > 0) {
                const subtitleRows = segments.map((s) => ({
                    id: s.id,
                    lecture_id: lectureId,
                    timestamp: Math.max(0, Math.floor(s.startMs / 1000)),
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
                    textZh: seg.fineTranslation ?? seg.roughTranslation,
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
            // Re-query device info from the recorder. If the active
            // input changed, surface a toast.
            const info = this.recorder?.getInputDeviceInfo();
            if (!info) return;
            const next: RecordingInputSnapshot = {
                label: info.label,
                sampleRate: info.sampleRate,
            };
            const warning = buildDeviceChangeWarning(this.lastInputSnapshot, next);
            this.lastInputSnapshot = next;
            if (!warning) return;
            void this.toast().then((toast) =>
                toast.warning(warning.message, warning.detail),
            );
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
