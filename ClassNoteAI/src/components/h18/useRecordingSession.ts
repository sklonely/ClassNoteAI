/**
 * useRecordingSession · Phase 7 Sprint 1 (S1.2) — thin reader hook.
 *
 * The recorder lifecycle now lives in the
 * {@link recordingSessionService} singleton (Sprint 1 Round 2). This
 * hook is a pure subscriber: it forwards the singleton state through
 * a manual subscribe/setState bridge and proxies start/pause/resume/
 * stop straight to the singleton.
 *
 * Note: we deliberately don't use the generic `useService`
 * (useSyncExternalStore) helper here because the singleton's
 * `getState()` returns a fresh object on every call (defensive copy);
 * useSyncExternalStore would loop. The singleton already pushes
 * snapshots through `subscribe(cb)`, so a plain `useState +
 * useEffect` does the right thing.
 *
 * Why thin? Because the previous incarnation of this hook owned the
 * AudioRecorder via a useRef — switching tabs unmounted the hook,
 * which tore the recorder down mid-session. Sprint 1 pulls all that
 * state up to a module-level singleton so the user can navigate
 * freely while a recording is live; this file is just the React
 * binding.
 *
 * Caller back-compat (Round 3):
 *   - The legacy call form `useRecordingSession({ courseId, lectureId })`
 *     remains supported. When opts are provided, the no-arg `start()`
 *     defers them through to `recordingSessionService.start(...)` so
 *     callers like H18RecordingPage don't have to change yet.
 *   - All flat fields the old hook exposed (status / elapsed / segments
 *     / currentText / stopPhase / error / sessionStartMs) are still
 *     present at the top of the return shape. `segments` keeps the
 *     legacy `SubtitleSegment[]` typing — the singleton's
 *     `RecordingSegment[]` (richer) is exposed via `state.segments`.
 *     Round 4 lifts callers off the legacy field.
 *   - {@link RECORDING_CHANGE_EVENT} is re-exported from the contract
 *     so existing `import { RECORDING_CHANGE_EVENT } from
 *     './useRecordingSession'` sites (H18DeepApp) keep compiling.
 *   - {@link fmtElapsed} stays here as a util — used by H18RecordingPage
 *     for transport-bar formatting.
 */

import { useEffect, useState } from 'react';
import { recordingSessionService } from '../../services/recordingSessionService';
import { subtitleService } from '../../services/subtitleService';
import type {
    RecordingSessionState,
    StartRecordingOptions,
    StopPhase as ContractStopPhase,
} from '../../services/__contracts__/recordingSessionService.contract';
import type { SubtitleSegment } from '../../types/subtitle';

// Re-export the canonical event name from the contract so existing
// callers that import it from this module keep working.
export { RECORDING_CHANGE_EVENT } from '../../services/__contracts__/recordingSessionService.contract';

/** Legacy status type alias kept for callers that referenced it. */
export type RecordingStatus = RecordingSessionState['status'];

/** Legacy stop-phase alias kept for callers; mirrors contract. */
export type StopPhase = ContractStopPhase | 'idle';

export interface UseRecordingSessionOpts {
    courseId: string;
    lectureId: string;
}

export interface UseRecordingSessionReturn {
    /** Canonical singleton state. Round-4 callers should prefer this
     *  over the flat back-compat fields below. */
    state: RecordingSessionState;

    // ─── Convenience booleans (deconstructed for caller convenience) ──
    isRecording: boolean;
    isPaused: boolean;
    isStopping: boolean;
    isIdle: boolean;

    // ─── Flat fields (legacy back-compat) ─────────────────────────────
    /** Current status string. Mirrors `state.status`. */
    status: RecordingStatus;
    /** Elapsed seconds since `sessionStartMs`. Mirrors `state.elapsed`. */
    elapsed: number;
    /** Live subtitle segments. Kept as `SubtitleSegment[]` (richer, with
     *  fine/rough split) for legacy callers — the singleton's
     *  `RecordingSegment[]` is on `state.segments`. */
    segments: SubtitleSegment[];
    /** Live transcription tail (current sentence-in-progress). */
    currentText: string;
    /** Last error message, or `null` if none. */
    error: string | null;
    /** Current finalize phase while `status === 'stopping'`. */
    stopPhase: StopPhase;
    /** Wall-clock epoch ms when `start()` was called, or `0` before that. */
    sessionStartMs: number;

    // ─── Methods (proxy to singleton) ─────────────────────────────────
    /** Start a session. If hook opts were provided, courseId/lectureId
     *  default to those; otherwise they must be passed explicitly. */
    start: (
        courseId?: string,
        lectureId?: string,
        opts?: StartRecordingOptions,
    ) => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    stop: () => Promise<void>;
}

export function useRecordingSession(
    opts?: UseRecordingSessionOpts,
): UseRecordingSessionReturn {
    // We can't use the generic `useService` (useSyncExternalStore)
    // helper here because the singleton's `getState()` returns a fresh
    // object on every call (defensive copy). useSyncExternalStore would
    // see that as a change-on-every-render and infinite-loop. Instead
    // we subscribe manually and store the snapshot in component state —
    // identical end result, no tearing because singleton.subscribe()
    // pushes the snapshot synchronously when state mutates.
    const [state, setState] = useState<RecordingSessionState>(() =>
        recordingSessionService.getState(),
    );

    useEffect(() => {
        // Push the latest snapshot in case state changed between
        // `useState` initial-call and effect mount.
        setState(recordingSessionService.getState());
        const unsub = recordingSessionService.subscribe((next) => {
            setState(next);
        });
        return unsub;
    }, []);

    // Legacy `segments` exposes SubtitleSegment[] for back-compat with
    // H18RecordingPage's SubPane (reads seg.startTime / seg.displayText /
    // seg.displayTranslation). The singleton remaps these into
    // RecordingSegment[] on state.segments — Round 4 will lift the
    // caller off this field.
    const [legacySegments, setLegacySegments] = useState<SubtitleSegment[]>(
        () => subtitleService.getSegments(),
    );
    const [legacyCurrentText, setLegacyCurrentText] = useState<string>(
        () => subtitleService.getCurrentText(),
    );

    useEffect(() => {
        // Push initial snapshot in case it changed between render and
        // effect-mount (concurrent React).
        setLegacySegments(subtitleService.getSegments());
        setLegacyCurrentText(subtitleService.getCurrentText());
        const unsub = subtitleService.subscribe((sub) => {
            setLegacySegments([...sub.segments]);
            setLegacyCurrentText(sub.currentText);
        });
        return unsub;
    }, []);

    // Adapt singleton's start signature to the legacy zero-arg form.
    // - If the caller passed opts to the hook AND calls start() with no
    //   args, fill from opts. (H18RecordingPage relies on this.)
    // - If the caller passes args explicitly, forward them.
    const start = async (
        courseId?: string,
        lectureId?: string,
        startOpts?: StartRecordingOptions,
    ): Promise<void> => {
        const cid = courseId ?? opts?.courseId;
        const lid = lectureId ?? opts?.lectureId;
        if (!cid || !lid) {
            throw new Error(
                'useRecordingSession.start: courseId/lectureId missing — ' +
                    'pass them as args or via hook opts',
            );
        }
        return recordingSessionService.start(cid, lid, startOpts);
    };

    const pause = (): Promise<void> => recordingSessionService.pause();
    const resume = (): Promise<void> => recordingSessionService.resume();
    const stop = (): Promise<void> => recordingSessionService.stop();

    // Map contract stopPhase (no 'idle') back to legacy alias that
    // includes 'idle' for the pre-stop default.
    const legacyStopPhase: StopPhase = state.stopPhase ?? 'idle';

    return {
        state,
        isRecording: state.status === 'recording',
        isPaused: state.status === 'paused',
        isStopping: state.status === 'stopping',
        isIdle: state.status === 'idle',
        status: state.status,
        elapsed: state.elapsed,
        segments: legacySegments,
        currentText: legacyCurrentText || state.currentText,
        error: state.error ?? null,
        stopPhase: legacyStopPhase,
        sessionStartMs: state.sessionStartMs ?? 0,
        start,
        pause,
        resume,
        stop,
    };
}

/** Format an elapsed seconds value as HH:MM:SS / MM:SS. */
export function fmtElapsed(seconds: number): string {
    if (seconds < 0 || !isFinite(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
