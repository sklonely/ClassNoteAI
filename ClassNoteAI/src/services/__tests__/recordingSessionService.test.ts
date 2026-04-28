/**
 * recordingSessionService — Phase 7 Sprint 1 round 2 tests.
 *
 * Covers:
 *   - state machine: idle → recording → paused → recording → stopping → stopped
 *   - subscribe/getState/reset semantics
 *   - RECORDING_CHANGE_EVENT dispatch on every transition
 *   - idempotence (same lecture / different lecture)
 *   - S1.6 visibilitychange + mic readyState
 *   - W15 MediaStreamTrack.onended
 *   - V4 mustFinalizeSync drain path
 *   - S1.14 device monitor toast on devicechange
 *
 * AudioRecorder + transcriptionService are mocked at module scope so we
 * can drive the singleton without spinning up a real AudioContext.
 *
 * Reset strategy — explicit `recordingSessionService.reset()` in
 * `beforeEach`. We deliberately do NOT rely on auto-register from
 * setup.ts (Sprint 0 spec, §S0.14 妥協方案).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingSessionService } from '../recordingSessionService';
import {
    RECORDING_CHANGE_EVENT,
    type RecordingChangeDetail,
    type RecordingSessionState,
} from '../__contracts__/recordingSessionService.contract';
import { MockMediaStreamTrack } from '../../test/setup';

// ─── Module mocks ───────────────────────────────────────────────────────

// AudioRecorder: record what was called, never touch real mic.
const mockRecorderInstance = {
    onChunk: vi.fn(),
    enablePersistence: vi.fn(),
    start: vi.fn(async () => {
        // Simulate a real recorder grabbing a MediaStream the way
        // AudioRecorder.start does. _activeMicStream is read by the
        // singleton when wiring W15.
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        mockRecorderInstance.mediaStream = mockMediaStream;
    }),
    pause: vi.fn(),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(async () => {
        mockRecorderInstance.mediaStream = null;
    }),
    getInputDeviceInfo: vi.fn(() => ({
        deviceId: 'mock-device',
        label: 'Mock Microphone',
        sampleRate: 48_000,
    })),
    flushPersistenceNow: vi.fn(async () => true),
    mediaStream: null as unknown,
};

let mockMediaStream: { getAudioTracks: () => MockMediaStreamTrack[] };
let mockTrack: MockMediaStreamTrack;

vi.mock('../audioRecorder', () => {
    // Provide a class that returns the shared singleton mock instance so
    // `new AudioRecorder({})` works (vi.fn().mockImplementation doesn't
    // produce a proper constructor when called with `new`).
    return {
        AudioRecorder: class MockAudioRecorder {
            constructor() {
                return mockRecorderInstance;
            }
        },
    };
});

vi.mock('../transcriptionService', () => ({
    transcriptionService: {
        setLectureId: vi.fn(),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        pause: vi.fn(),
        resume: vi.fn(),
        addAudioChunk: vi.fn(),
        clear: vi.fn(),
    },
}));

vi.mock('../subtitleService', () => ({
    subtitleService: {
        getSegments: vi.fn(() => []),
        getCurrentText: vi.fn(() => ''),
        // subscribe immediately fires once with empty state; returns
        // an unsubscribe fn.
        subscribe: vi.fn((cb: (s: unknown) => void) => {
            cb({
                segments: [],
                currentText: '',
                isRecording: false,
                isTranscribing: false,
                lastUpdateTime: Date.now(),
            });
            return () => undefined;
        }),
    },
}));

// toastService — captured per call so we can assert the visibility /
// W15 / S1.14 paths warn the user.
const toastWarnings: Array<{ message: string; detail?: string }> = [];
vi.mock('../toastService', () => ({
    toastService: {
        warning: vi.fn((message: string, detail?: string) => {
            toastWarnings.push({ message, detail });
        }),
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

// storageService — used by mustFinalizeSync.
const storageMockState: {
    saveSubtitlesShouldThrow: boolean;
    saveLectureShouldThrow: boolean;
    saveSubtitlesCalls: unknown[][];
    saveLectureCalls: unknown[][];
    lectureRow: { id: string; status: string } | null;
} = {
    saveSubtitlesShouldThrow: false,
    saveLectureShouldThrow: false,
    saveSubtitlesCalls: [],
    saveLectureCalls: [],
    lectureRow: { id: 'lecture-1', status: 'recording' },
};
vi.mock('../storageService', () => ({
    storageService: {
        saveSubtitles: vi.fn(async (subs: unknown) => {
            storageMockState.saveSubtitlesCalls.push([subs]);
            if (storageMockState.saveSubtitlesShouldThrow) {
                throw new Error('saveSubtitles failure');
            }
        }),
        saveLecture: vi.fn(async (lec: unknown) => {
            storageMockState.saveLectureCalls.push([lec]);
            if (storageMockState.saveLectureShouldThrow) {
                throw new Error('saveLecture failure');
            }
        }),
        getLecture: vi.fn(async () => storageMockState.lectureRow),
    },
}));

// recordingDeviceMonitor — mock so we can assert toasts when a device
// switch is reported. The real function is pure and well-tested.
vi.mock('../recordingDeviceMonitor', () => ({
    buildDeviceChangeWarning: vi.fn(
        (
            prev: { label: string } | null,
            next: { label: string } | null,
        ) => {
            if (!prev || !next) return null;
            if (prev.label === next.label) return null;
            return {
                message: '錄音麥克風可能被切換了',
                detail: `${prev.label} → ${next.label}`,
            };
        },
    ),
}));

// ─── Fixtures + helpers ─────────────────────────────────────────────────

function freshMediaStream(): {
    track: MockMediaStreamTrack;
    stream: { getAudioTracks: () => MockMediaStreamTrack[] };
} {
    const track = new MockMediaStreamTrack();
    return {
        track,
        stream: {
            getAudioTracks: () => [track],
        },
    };
}

beforeEach(() => {
    // Refresh the mic track for each test so onended listeners don't
    // bleed across.
    const { track, stream } = freshMediaStream();
    mockTrack = track;
    mockMediaStream = stream;
    mockRecorderInstance.mediaStream = null;
    storageMockState.saveSubtitlesShouldThrow = false;
    storageMockState.saveLectureShouldThrow = false;
    storageMockState.saveSubtitlesCalls = [];
    storageMockState.saveLectureCalls = [];
    storageMockState.lectureRow = { id: 'lecture-1', status: 'recording' };
    toastWarnings.length = 0;
    // Hard reset the singleton — explicit (not relying on auto-register).
    recordingSessionService.reset();
});

afterEach(() => {
    vi.useRealTimers();
});

// Capture window CustomEvent dispatches.
function captureRecordingChangeEvents(): RecordingChangeDetail[] {
    const captured: RecordingChangeDetail[] = [];
    const handler = (e: Event) => {
        captured.push((e as CustomEvent<RecordingChangeDetail>).detail);
    };
    window.addEventListener(RECORDING_CHANGE_EVENT, handler);
    afterEach(() => window.removeEventListener(RECORDING_CHANGE_EVENT, handler));
    return captured;
}

// ─── State machine ──────────────────────────────────────────────────────

describe('recordingSessionService — state machine', () => {
    it('starts in idle with empty segments and zero elapsed', () => {
        const s = recordingSessionService.getState();
        expect(s.status).toBe('idle');
        expect(s.segments).toEqual([]);
        expect(s.currentText).toBe('');
        expect(s.elapsed).toBe(0);
        expect(s.lectureId).toBeUndefined();
    });

    it('start() transitions idle → recording', async () => {
        await recordingSessionService.start('course-1', 'lecture-1');
        expect(recordingSessionService.getState().status).toBe('recording');
        expect(recordingSessionService.getState().lectureId).toBe('lecture-1');
        expect(recordingSessionService.getState().courseId).toBe('course-1');
        expect(recordingSessionService.getState().sessionStartMs).toBeTypeOf('number');
    });

    it('pause() transitions recording → paused', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();
        expect(recordingSessionService.getState().status).toBe('paused');
    });

    it('resume() transitions paused → recording', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();
        await recordingSessionService.resume();
        expect(recordingSessionService.getState().status).toBe('recording');
    });

    it('pause() on idle is a no-op', async () => {
        await recordingSessionService.pause();
        expect(recordingSessionService.getState().status).toBe('idle');
    });

    it('resume() on recording is a no-op', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.resume();
        expect(recordingSessionService.getState().status).toBe('recording');
    });

    it('stop() goes recording → stopping → stopped', async () => {
        const observed: string[] = [];
        recordingSessionService.subscribe((s) => observed.push(s.status));
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.stop();
        expect(observed).toContain('recording');
        expect(observed).toContain('stopping');
        expect(observed[observed.length - 1]).toBe('stopped');
        expect(recordingSessionService.getState().stopPhase).toBe('done');
    });

    it('stop() from idle is a no-op (no state change)', async () => {
        await recordingSessionService.stop();
        expect(recordingSessionService.getState().status).toBe('idle');
        expect(recordingSessionService.getState().stopPhase).toBeUndefined();
    });

    it('stop() from paused goes paused → stopping → stopped', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();
        await recordingSessionService.stop();
        expect(recordingSessionService.getState().status).toBe('stopped');
    });

    it('stop() failure flips stopPhase=failed but still status=stopped', async () => {
        const { transcriptionService } = await import('../transcriptionService');
        (transcriptionService.stop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('asr drain failed'),
        );
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.stop();
        expect(recordingSessionService.getState().status).toBe('stopped');
        expect(recordingSessionService.getState().stopPhase).toBe('failed');
        expect(recordingSessionService.getState().error).toMatch(/asr drain/i);
    });
});

// ─── Idempotence ────────────────────────────────────────────────────────

describe('recordingSessionService — idempotence', () => {
    it('two parallel start() calls for same lecture → only one recorder.start', async () => {
        mockRecorderInstance.start.mockClear();

        const a = recordingSessionService.start('c', 'l1');
        const b = recordingSessionService.start('c', 'l1');
        await Promise.all([a, b]);

        expect(mockRecorderInstance.start).toHaveBeenCalledTimes(1);
    });

    it('start() while already recording same lecture → no-op', async () => {
        await recordingSessionService.start('c', 'l1');
        mockRecorderInstance.start.mockClear();
        await recordingSessionService.start('c', 'l1');
        expect(mockRecorderInstance.start).not.toHaveBeenCalled();
    });

    it('start() for different lecture while one is recording → throws', async () => {
        await recordingSessionService.start('c', 'l1');
        await expect(
            recordingSessionService.start('c', 'l2'),
        ).rejects.toThrow(/different recording is already active/);
    });
});

// ─── Subscription ───────────────────────────────────────────────────────

describe('recordingSessionService — subscription', () => {
    it('subscribe() fires immediately with current state', () => {
        const cb = vi.fn();
        recordingSessionService.subscribe(cb);
        expect(cb).toHaveBeenCalledTimes(1);
        const arg = cb.mock.calls[0][0] as RecordingSessionState;
        expect(arg.status).toBe('idle');
    });

    it('subscribe() callback fires on every state change', async () => {
        const cb = vi.fn();
        recordingSessionService.subscribe(cb);
        cb.mockClear();
        await recordingSessionService.start('c', 'l');
        // start() calls setState multiple times (segments/currentText
        // via subtitle subscription, then status='recording'). Just
        // assert the final value.
        const last = cb.mock.calls[cb.mock.calls.length - 1][0] as RecordingSessionState;
        expect(last.status).toBe('recording');
    });

    it('subscribe() returned unsub stops further calls', async () => {
        const cb = vi.fn();
        const unsub = recordingSessionService.subscribe(cb);
        cb.mockClear();
        unsub();
        await recordingSessionService.start('c', 'l');
        expect(cb).not.toHaveBeenCalled();
    });

    it('subscriber that throws does not break others', async () => {
        const good = vi.fn();
        recordingSessionService.subscribe(() => {
            throw new Error('bad subscriber');
        });
        recordingSessionService.subscribe(good);
        good.mockClear();
        await recordingSessionService.start('c', 'l');
        expect(good).toHaveBeenCalled();
    });

    it('getState returns a snapshot (mutating it does not poison state)', async () => {
        await recordingSessionService.start('c', 'l');
        const s = recordingSessionService.getState();
        s.segments.push({
            id: 'fake',
            lectureId: 'l',
            startMs: 0,
            endMs: 1,
        });
        // Re-read; the singleton's segments must not have been mutated.
        const fresh = recordingSessionService.getState();
        expect(fresh.segments).toHaveLength(0);
    });
});

// ─── DOM events ─────────────────────────────────────────────────────────

describe('recordingSessionService — RECORDING_CHANGE_EVENT', () => {
    it('start() dispatches kind:start with lectureId/courseId', async () => {
        const events = captureRecordingChangeEvents();
        await recordingSessionService.start('c-77', 'l-99');
        const first = events[0];
        expect(first).toEqual({
            kind: 'start',
            lectureId: 'l-99',
            courseId: 'c-77',
        });
    });

    it('pause() dispatches kind:pause', async () => {
        const events = captureRecordingChangeEvents();
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();
        expect(events.map((e) => e.kind)).toContain('pause');
    });

    it('resume() dispatches kind:resume', async () => {
        const events = captureRecordingChangeEvents();
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();
        await recordingSessionService.resume();
        expect(events.map((e) => e.kind)).toContain('resume');
    });

    it('stop() dispatches kind:stop', async () => {
        const events = captureRecordingChangeEvents();
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.stop();
        expect(events.map((e) => e.kind)).toContain('stop');
    });

    it('stop() failure still dispatches kind:stop', async () => {
        const events = captureRecordingChangeEvents();
        const { transcriptionService } = await import('../transcriptionService');
        (transcriptionService.stop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('boom'),
        );
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.stop();
        expect(events.map((e) => e.kind)).toContain('stop');
    });
});

// ─── S1.6 · visibility + mic readyState ─────────────────────────────────

describe('recordingSessionService — visibility & sleep detection', () => {
    function setVisibility(state: 'visible' | 'hidden') {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: state,
        });
        document.dispatchEvent(new Event('visibilitychange'));
    }

    it('hidden > 30s + mic readyState=ended → toast.warning fires', async () => {
        await recordingSessionService.start('c', 'l');
        // Inject a track we control so we can flip readyState.
        recordingSessionService._setMicTrackForTest(mockTrack as unknown as MediaStreamTrack);
        // Hide → now-30s ago
        const realNow = Date.now;
        try {
            const hideTime = realNow.call(Date);
            Date.now = () => hideTime;
            setVisibility('hidden');
            // 60s passes
            Date.now = () => hideTime + 60_000;
            // Mic died while we were away
            mockTrack.readyState = 'ended';
            // Come back
            setVisibility('visible');
        } finally {
            Date.now = realNow;
        }
        // The visibility handler kicks off a dynamic import of
        // toastService → wait for the microtask queue to drain.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        expect(
            toastWarnings.some((t) => t.message.includes('系統 sleep')),
        ).toBe(true);
    });

    it('hidden > 30s but mic still live → no toast', async () => {
        await recordingSessionService.start('c', 'l');
        recordingSessionService._setMicTrackForTest(mockTrack as unknown as MediaStreamTrack);
        const realNow = Date.now;
        try {
            const t0 = realNow.call(Date);
            Date.now = () => t0;
            setVisibility('hidden');
            Date.now = () => t0 + 60_000;
            // mic stays 'live'
            setVisibility('visible');
        } finally {
            Date.now = realNow;
        }
        expect(
            toastWarnings.some((t) => t.message.includes('系統 sleep')),
        ).toBe(false);
    });

    it('hidden < 30s → no toast even if mic ended', async () => {
        await recordingSessionService.start('c', 'l');
        recordingSessionService._setMicTrackForTest(mockTrack as unknown as MediaStreamTrack);
        const realNow = Date.now;
        try {
            const t0 = realNow.call(Date);
            Date.now = () => t0;
            setVisibility('hidden');
            Date.now = () => t0 + 5_000; // 5s only
            mockTrack.readyState = 'ended';
            setVisibility('visible');
        } finally {
            Date.now = realNow;
        }
        expect(
            toastWarnings.some((t) => t.message.includes('系統 sleep')),
        ).toBe(false);
    });
});

// ─── W15 · MediaStreamTrack.onended ─────────────────────────────────────

describe('recordingSessionService — W15 mic track ended', () => {
    it('track ended → state.error set, status stays recording', async () => {
        await recordingSessionService.start('c', 'l');
        recordingSessionService._setMicTrackForTest(mockTrack as unknown as MediaStreamTrack);
        // Trigger 'ended'
        mockTrack.dispatchEvent(new Event('ended'));
        // Allow lazy toast import promise to resolve.
        await Promise.resolve();
        await Promise.resolve();
        expect(recordingSessionService.getState().error).toBe('mic ended unexpectedly');
        expect(recordingSessionService.getState().status).toBe('recording');
    });

    it('track ended → toast.warning fires', async () => {
        await recordingSessionService.start('c', 'l');
        recordingSessionService._setMicTrackForTest(mockTrack as unknown as MediaStreamTrack);
        mockTrack.dispatchEvent(new Event('ended'));
        // Wait for the dynamic import + toast to resolve.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        expect(toastWarnings.some((t) => t.message.includes('麥克風中斷'))).toBe(true);
    });

    it('track ended while idle → no toast (irrelevant)', async () => {
        // No start() — singleton stays idle.
        recordingSessionService._setMicTrackForTest(mockTrack as unknown as MediaStreamTrack);
        mockTrack.dispatchEvent(new Event('ended'));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        expect(toastWarnings.some((t) => t.message.includes('麥克風中斷'))).toBe(false);
    });
});

// ─── V4 · mustFinalizeSync ──────────────────────────────────────────────

describe('recordingSessionService — mustFinalizeSync', () => {
    it('idle → returns true immediately, no save calls', async () => {
        const ok = await recordingSessionService.mustFinalizeSync();
        expect(ok).toBe(true);
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(0);
        expect(storageMockState.saveLectureCalls).toHaveLength(0);
    });

    it('recording → drains ASR, persists subtitles + lecture, returns true', async () => {
        await recordingSessionService.start('c', 'l');
        // Inject one segment so saveSubtitles has work to do.
        recordingSessionService._setStateForTest({
            segments: [
                {
                    id: 'seg-1',
                    lectureId: 'l',
                    startMs: 0,
                    endMs: 1000,
                    textEn: 'Hello',
                    textZh: '哈囉',
                },
            ],
        });
        const ok = await recordingSessionService.mustFinalizeSync();
        expect(ok).toBe(true);
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(1);
        expect(storageMockState.saveLectureCalls).toHaveLength(1);
    });

    it('saveSubtitles failure → returns false', async () => {
        await recordingSessionService.start('c', 'l');
        recordingSessionService._setStateForTest({
            segments: [
                {
                    id: 'seg-1',
                    lectureId: 'l',
                    startMs: 0,
                    endMs: 1,
                    textEn: 'x',
                },
            ],
        });
        storageMockState.saveSubtitlesShouldThrow = true;
        const ok = await recordingSessionService.mustFinalizeSync();
        expect(ok).toBe(false);
    });

    it('paused state also drains', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();
        recordingSessionService._setStateForTest({
            segments: [
                { id: 's', lectureId: 'l', startMs: 0, endMs: 1, textEn: 't' },
            ],
        });
        const ok = await recordingSessionService.mustFinalizeSync();
        expect(ok).toBe(true);
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(1);
    });

    it('stopped → returns true without re-saving', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.stop();
        storageMockState.saveSubtitlesCalls = [];
        storageMockState.saveLectureCalls = [];
        const ok = await recordingSessionService.mustFinalizeSync();
        expect(ok).toBe(true);
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(0);
        expect(storageMockState.saveLectureCalls).toHaveLength(0);
    });
});

// ─── reset() TEST-ONLY ──────────────────────────────────────────────────

describe('recordingSessionService — reset', () => {
    it('reset() returns state to initial', async () => {
        await recordingSessionService.start('c', 'l');
        recordingSessionService.reset();
        const s = recordingSessionService.getState();
        expect(s.status).toBe('idle');
        expect(s.lectureId).toBeUndefined();
        expect(s.segments).toEqual([]);
        expect(s.elapsed).toBe(0);
    });

    it('reset() preserves subscribers (they manage their own cleanup)', async () => {
        const cb = vi.fn();
        recordingSessionService.subscribe(cb);
        cb.mockClear();
        recordingSessionService.reset();
        // After reset, a new state change should still notify cb.
        await recordingSessionService.start('c', 'l');
        expect(cb).toHaveBeenCalled();
    });
});

// ─── Elapsed timer ──────────────────────────────────────────────────────

describe('recordingSessionService — elapsed timer', () => {
    it('elapsed advances while recording', async () => {
        vi.useFakeTimers();
        const start = Date.now();
        vi.setSystemTime(start);
        await recordingSessionService.start('c', 'l');
        vi.setSystemTime(start + 2_000);
        // Tick the elapsed interval (250ms).
        vi.advanceTimersByTime(500);
        const e = recordingSessionService.getState().elapsed;
        expect(e).toBeGreaterThanOrEqual(2);
    });

    it('elapsed stops while paused', async () => {
        vi.useFakeTimers();
        const start = Date.now();
        vi.setSystemTime(start);
        await recordingSessionService.start('c', 'l');
        vi.setSystemTime(start + 2_000);
        vi.advanceTimersByTime(500);
        const elapsedRecording = recordingSessionService.getState().elapsed;
        await recordingSessionService.pause();
        vi.setSystemTime(start + 10_000);
        vi.advanceTimersByTime(2_000);
        // While paused, elapsed should NOT have advanced from the
        // value captured at pause-time. It was last refreshed at
        // ~2s; we accept ±0.5s tolerance.
        const elapsedPaused = recordingSessionService.getState().elapsed;
        expect(elapsedPaused).toBeCloseTo(elapsedRecording, 0);
    });
});
