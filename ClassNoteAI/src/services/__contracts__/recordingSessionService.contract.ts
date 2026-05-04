/**
 * Recording Session Service — type-only contract.
 *
 * Sprint 1 (Phase 7) introduces a centralised state machine that owns the
 * full recording lifecycle: idle → recording → paused → stopping (6-step
 * pipeline) → stopped. UI components subscribe to the state and dispatch
 * commands via this interface; they MUST NOT poke at internal recorders /
 * transcript stores directly.
 *
 * This module is type-only. No runtime singleton lives here — implementation
 * is wired up under `src/services/recordingSessionService.ts` (Sprint 1).
 */

export type RecordingStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'stopped';

/**
 * Six-phase pipeline executed when the user stops a recording.
 * Phases run sequentially up to `done`; `failed` is a terminal error state
 * surfaced through {@link RecordingSessionState.error}.
 */
export type StopPhase =
  | 'transcribe'
  | 'segment'
  | 'index'
  | 'summary'
  | 'done'
  | 'failed';

export interface RecordingSegment {
  id: string;
  lectureId: string;
  startMs: number;
  endMs: number;
  textEn?: string;
  textZh?: string;
}

export interface RecordingSessionState {
  status: RecordingStatus;
  lectureId?: string;
  courseId?: string;
  segments: RecordingSegment[];
  /** Live ASR text not yet committed to a {@link RecordingSegment}. */
  currentText: string;
  /** Seconds since {@link sessionStartMs} (monotonic, paused-aware). */
  elapsed: number;
  stopPhase?: StopPhase;
  sessionStartMs?: number;
  error?: string;
}

export interface StartRecordingOptions {
  /**
   * Override the lecture's scheduled date (used by the "record-for-past-class"
   * flow). Defaults to `new Date()` when omitted.
   */
  scheduledDate?: Date;
}

export interface RecordingSessionService {
  /**
   * Start a new session. Idempotent — multiple parallel `start()` calls for
   * the same `(courseId, lectureId)` resolve to the same session.
   */
  start(
    courseId: string,
    lectureId: string,
    opts?: StartRecordingOptions,
  ): Promise<void>;

  pause(): Promise<void>;

  resume(): Promise<void>;

  /**
   * Run the full 6-step stop pipeline. Resolves when `status === 'stopped'`
   * and `stopPhase === 'done'`. Background tasks (summary / index) tracked
   * via TaskTrackerService may continue running after this resolves.
   */
  stop(): Promise<void>;

  /** Subscribe to state transitions. Returns an unsubscribe fn. */
  subscribe(cb: (state: RecordingSessionState) => void): () => void;

  /** Read current snapshot (always defined; never null). */
  getState(): RecordingSessionState;

  /**
   * TEST-ONLY — reset to idle state, clear segments, drop subscribers.
   * Production code MUST NOT call this; it bypasses the stop pipeline and
   * will leak any running native recorder handles.
   */
  reset(): void;

  /**
   * App-close path — drain ASR buffers, persist subtitles, mark the lecture
   * as `completed`. Returns `true` if the drain completed successfully.
   * Intended for `beforeunload` / `app.on('before-quit')` hooks where async
   * work must finish synchronously enough to avoid data loss.
   */
  mustFinalizeSync(): Promise<boolean>;
}

/**
 * DOM CustomEvent name dispatched on `window` whenever the recording state
 * crosses a major boundary. Payload is {@link RecordingChangeDetail}.
 *
 * Listeners are non-canonical observers (e.g. menu badges, OS tray icons).
 * The canonical state source is {@link RecordingSessionService.subscribe}.
 */
export const RECORDING_CHANGE_EVENT = 'h18:recording-change';

export interface RecordingChangeDetail {
  kind: 'start' | 'pause' | 'resume' | 'stop';
  lectureId: string;
  courseId: string;
}
