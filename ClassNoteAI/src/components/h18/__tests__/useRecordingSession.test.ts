/**
 * useRecordingSession (thin reader) · Phase 7 Sprint 1 (S1.2)
 *
 * Verifies the hook is a faithful subscriber to recordingSessionService
 * — it exposes the right shape, re-renders on singleton state changes,
 * unsubscribes on unmount, and proxies command methods directly to the
 * singleton.
 *
 * AudioRecorder + transcriptionService are mocked at module scope to
 * avoid spinning up a real AudioContext just to drive the singleton.
 *
 * Reset strategy — explicit `recordingSessionService.reset()` in
 * `beforeEach` per the Sprint 0 contract (S0.14 妥協方案).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ─── Module mocks (must be declared before importing the singleton) ──
const mockRecorderInstance = {
    onChunk: vi.fn(),
    enablePersistence: vi.fn(),
    start: vi.fn(async () => undefined),
    pause: vi.fn(),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    getInputDeviceInfo: vi.fn(() => ({
        deviceId: 'mock-device',
        label: 'Mock Microphone',
        sampleRate: 48_000,
    })),
    flushPersistenceNow: vi.fn(async () => true),
    mediaStream: null as unknown,
};

vi.mock('../../../services/audioRecorder', () => ({
    AudioRecorder: class MockAudioRecorder {
        constructor() {
            return mockRecorderInstance;
        }
    },
}));

vi.mock('../../../services/transcriptionService', () => ({
    transcriptionService: {
        setLectureId: vi.fn(),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        pause: vi.fn(),
        resume: vi.fn(),
        addAudioChunk: vi.fn(),
        clear: vi.fn(),
        setLanguages: vi.fn(),
    },
}));

// subtitleService is real — the hook subscribes to it for legacy back-
// compat segments. Reset its state per-test by calling .clear().

// ─── Imports (after mocks) ───────────────────────────────────────────
import { useRecordingSession, RECORDING_CHANGE_EVENT, fmtElapsed } from '../useRecordingSession';
import { recordingSessionService } from '../../../services/recordingSessionService';
import { subtitleService } from '../../../services/subtitleService';
import { RECORDING_CHANGE_EVENT as CONTRACT_EVENT } from '../../../services/__contracts__/recordingSessionService.contract';

beforeEach(() => {
    recordingSessionService.reset();
    subtitleService.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    recordingSessionService.reset();
});

describe('useRecordingSession — return shape', () => {
    it('on mount returns an object with state + flat fields + booleans + methods', () => {
        const { result } = renderHook(() => useRecordingSession());
        const v = result.current;

        // Canonical state
        expect(v.state).toBeDefined();
        expect(v.state.status).toBe('idle');

        // Flat back-compat fields
        expect(v.status).toBe('idle');
        expect(v.elapsed).toBe(0);
        expect(Array.isArray(v.segments)).toBe(true);
        expect(typeof v.currentText).toBe('string');
        expect(v.error).toBe(null);
        expect(v.stopPhase).toBe('idle');
        expect(typeof v.sessionStartMs).toBe('number');

        // Booleans
        expect(v.isRecording).toBe(false);
        expect(v.isPaused).toBe(false);
        expect(v.isStopping).toBe(false);
        expect(v.isIdle).toBe(true);

        // Methods
        expect(typeof v.start).toBe('function');
        expect(typeof v.pause).toBe('function');
        expect(typeof v.resume).toBe('function');
        expect(typeof v.stop).toBe('function');
    });
});

describe('useRecordingSession — singleton state propagation', () => {
    it('re-renders with new state when singleton transitions', () => {
        const { result } = renderHook(() => useRecordingSession());
        expect(result.current.isIdle).toBe(true);

        act(() => {
            recordingSessionService._setStateForTest({
                status: 'recording',
                lectureId: 'L1',
                courseId: 'C1',
                elapsed: 5,
            });
        });

        expect(result.current.isRecording).toBe(true);
        expect(result.current.isIdle).toBe(false);
        expect(result.current.status).toBe('recording');
        expect(result.current.elapsed).toBe(5);
        expect(result.current.state.lectureId).toBe('L1');
        expect(result.current.state.courseId).toBe('C1');
    });

    it('stopPhase + error fields surface from singleton state', () => {
        const { result } = renderHook(() => useRecordingSession());

        act(() => {
            recordingSessionService._setStateForTest({
                status: 'stopping',
                stopPhase: 'segment',
                error: 'mic died',
            });
        });

        expect(result.current.isStopping).toBe(true);
        expect(result.current.stopPhase).toBe('segment');
        expect(result.current.error).toBe('mic died');
    });
});

describe('useRecordingSession — subscription lifecycle', () => {
    it('unmount calls the unsubscribe fn returned by singleton.subscribe', () => {
        const subscribeSpy = vi.spyOn(recordingSessionService, 'subscribe');

        const { unmount } = renderHook(() => useRecordingSession());

        // useService calls subscribe once at mount.
        expect(subscribeSpy).toHaveBeenCalledTimes(1);
        const unsubReturned = subscribeSpy.mock.results[0].value as () => void;
        const unsubSpy = vi.fn(unsubReturned);

        // Patch the returned unsub so we can detect the call. Replace
        // last-result entry; hard to do post-hoc, so wrap via a fresh
        // subscribe instead.
        // Simpler: directly assert that AFTER unmount the singleton has
        // one fewer subscriber than before.
        const beforeCount = (recordingSessionService as unknown as {
            subscribers: Set<unknown>;
        }).subscribers.size;
        unmount();
        const afterCount = (recordingSessionService as unknown as {
            subscribers: Set<unknown>;
        }).subscribers.size;
        expect(afterCount).toBe(beforeCount - 1);

        // Reference the wrapped fn just to silence unused warning if
        // the path above changes.
        void unsubSpy;
    });
});

describe('useRecordingSession — method proxies', () => {
    it('start() forwards to singleton.start with passed args', async () => {
        const startSpy = vi
            .spyOn(recordingSessionService, 'start')
            .mockResolvedValue();

        const { result } = renderHook(() => useRecordingSession());
        await act(async () => {
            await result.current.start('CX', 'LY');
        });

        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(startSpy).toHaveBeenCalledWith('CX', 'LY', undefined);
    });

    it('start() with hook opts defaults courseId/lectureId from opts', async () => {
        const startSpy = vi
            .spyOn(recordingSessionService, 'start')
            .mockResolvedValue();

        const { result } = renderHook(() =>
            useRecordingSession({ courseId: 'C1', lectureId: 'L1' }),
        );
        await act(async () => {
            await result.current.start();
        });

        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(startSpy).toHaveBeenCalledWith('C1', 'L1', undefined);
    });

    it('stop() forwards to singleton.stop', async () => {
        const stopSpy = vi
            .spyOn(recordingSessionService, 'stop')
            .mockResolvedValue();

        const { result } = renderHook(() => useRecordingSession());
        await act(async () => {
            await result.current.stop();
        });

        expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it('pause() and resume() forward to singleton.pause / .resume', async () => {
        const pauseSpy = vi
            .spyOn(recordingSessionService, 'pause')
            .mockResolvedValue();
        const resumeSpy = vi
            .spyOn(recordingSessionService, 'resume')
            .mockResolvedValue();

        const { result } = renderHook(() => useRecordingSession());
        await act(async () => {
            await result.current.pause();
        });
        await act(async () => {
            await result.current.resume();
        });

        expect(pauseSpy).toHaveBeenCalledTimes(1);
        expect(resumeSpy).toHaveBeenCalledTimes(1);
    });
});

describe('useRecordingSession — exports', () => {
    it('RECORDING_CHANGE_EVENT is the same constant as the contract', () => {
        expect(RECORDING_CHANGE_EVENT).toBe(CONTRACT_EVENT);
        expect(typeof RECORDING_CHANGE_EVENT).toBe('string');
        expect(RECORDING_CHANGE_EVENT.length).toBeGreaterThan(0);
    });

    it('fmtElapsed formats seconds correctly', () => {
        expect(fmtElapsed(0)).toBe('00:00');
        expect(fmtElapsed(65)).toBe('01:05');
        expect(fmtElapsed(3661)).toBe('01:01:01');
        // Edge cases handled
        expect(fmtElapsed(-1)).toBe('00:00');
        expect(fmtElapsed(NaN)).toBe('00:00');
    });
});

describe('useRecordingSession — multi-instance', () => {
    it('two hook instances mounted concurrently both reflect singleton updates', () => {
        const a = renderHook(() => useRecordingSession());
        const b = renderHook(() => useRecordingSession());

        expect(a.result.current.isIdle).toBe(true);
        expect(b.result.current.isIdle).toBe(true);

        act(() => {
            recordingSessionService._setStateForTest({
                status: 'recording',
                lectureId: 'shared-L',
                courseId: 'shared-C',
                elapsed: 12,
            });
        });

        expect(a.result.current.isRecording).toBe(true);
        expect(b.result.current.isRecording).toBe(true);
        expect(a.result.current.elapsed).toBe(12);
        expect(b.result.current.elapsed).toBe(12);
        expect(a.result.current.state.lectureId).toBe('shared-L');
        expect(b.result.current.state.lectureId).toBe('shared-L');

        a.unmount();
        b.unmount();
    });
});
