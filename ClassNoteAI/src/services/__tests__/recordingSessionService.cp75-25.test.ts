/**
 * recordingSessionService — cp75.25 P1-B + P1-C tests.
 *
 * P1-B: pause()/resume() must also pause/resume the translation
 *       pipeline so queued translations don't keep arriving for ~10-15s
 *       after the user pressed pause.
 *
 * P1-C: resume() must surface AudioContext.resume() failures via toast
 *       (instead of swallowing with console.warn). State stays at
 *       'paused' so the user can retry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingSessionService } from '../recordingSessionService';
import { MockMediaStreamTrack } from '../../test/setup';

// AudioRecorder mock — same shape as recordingSessionService.test.ts but
// with `resume` configurable per-test (resolve / reject) to drive P1-C.
const mockRecorderInstance = {
    onChunk: vi.fn(),
    enablePersistence: vi.fn(),
    start: vi.fn(async () => {
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
    finalizeToDisk: vi.fn(async (path: string) => path),
    mediaStream: null as unknown,
};

let mockMediaStream: { getAudioTracks: () => MockMediaStreamTrack[] };

vi.mock('../audioRecorder', () => ({
    AudioRecorder: class MockAudioRecorder {
        constructor() {
            return mockRecorderInstance;
        }
    },
}));

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
        clear: vi.fn(),
    },
}));

// translationPipeline mock — capture pause/resume calls for assertion.
// Use vi.hoisted so the factory below can reference these closures even
// after vitest hoists the vi.mock() call to top-of-file.
const { translationPipelineMock, toastCalls } = vi.hoisted(() => ({
    translationPipelineMock: {
        pause: vi.fn(),
        resume: vi.fn(),
        enqueue: vi.fn(),
        reset: vi.fn(),
        awaitDrain: vi.fn(async () => undefined),
        isPaused: vi.fn(() => false),
    },
    toastCalls: {
        success: [] as Array<{ message: string; detail?: string }>,
        error: [] as Array<{ message: string; detail?: string }>,
        warning: [] as Array<{ message: string; detail?: string }>,
        info: [] as Array<{ message: string; detail?: string }>,
    },
}));

vi.mock('../streaming/translationPipeline', () => ({
    translationPipeline: translationPipelineMock,
}));

vi.mock('../toastService', () => ({
    toastService: {
        success: vi.fn((message: string, detail?: string) => {
            toastCalls.success.push({ message, detail });
        }),
        error: vi.fn((message: string, detail?: string) => {
            toastCalls.error.push({ message, detail });
        }),
        warning: vi.fn((message: string, detail?: string) => {
            toastCalls.warning.push({ message, detail });
        }),
        info: vi.fn((message: string, detail?: string) => {
            toastCalls.info.push({ message, detail });
        }),
    },
}));

vi.mock('../storageService', () => ({
    storageService: {
        saveSubtitles: vi.fn(async () => undefined),
        saveLecture: vi.fn(async () => undefined),
        getLecture: vi.fn(async () => ({
            id: 'lecture-1',
            status: 'recording',
        })),
    },
}));

vi.mock('../recordingDeviceMonitor', () => ({
    buildDeviceChangeWarning: vi.fn(() => null),
}));

beforeEach(() => {
    const track = new MockMediaStreamTrack();
    mockMediaStream = { getAudioTracks: () => [track] };
    mockRecorderInstance.mediaStream = null;
    mockRecorderInstance.resume.mockReset();
    mockRecorderInstance.resume.mockImplementation(async () => undefined);
    mockRecorderInstance.pause.mockReset();
    translationPipelineMock.pause.mockClear();
    translationPipelineMock.resume.mockClear();
    toastCalls.success.length = 0;
    toastCalls.error.length = 0;
    toastCalls.warning.length = 0;
    toastCalls.info.length = 0;
    recordingSessionService.reset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('recordingSessionService — cp75.25 P1-B (pause/resume translation pipeline)', () => {
    it('pause() also pauses translationPipeline', async () => {
        await recordingSessionService.start('c', 'l');
        expect(translationPipelineMock.pause).not.toHaveBeenCalled();

        await recordingSessionService.pause();

        expect(translationPipelineMock.pause).toHaveBeenCalledTimes(1);
    });

    it('resume() also resumes translationPipeline', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();
        translationPipelineMock.resume.mockClear();

        await recordingSessionService.resume();

        expect(translationPipelineMock.resume).toHaveBeenCalledTimes(1);
    });
});

describe('recordingSessionService — cp75.25 P1-C (resume failure surfacing)', () => {
    it('resume() failure fires error toast', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();

        const resumeErr = new Error('AudioContext suspended after lid close');
        mockRecorderInstance.resume.mockImplementationOnce(async () => {
            throw resumeErr;
        });

        await expect(recordingSessionService.resume()).rejects.toThrow(
            /AudioContext suspended/,
        );

        expect(toastCalls.error.length).toBe(1);
        expect(toastCalls.error[0].message).toContain('錄音續錄失敗');
        expect(toastCalls.error[0].detail).toContain('請手動重啟錄音');
    });

    it('resume() failure leaves state at paused (not recording)', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();

        mockRecorderInstance.resume.mockImplementationOnce(async () => {
            throw new Error('mic device disconnected');
        });

        await expect(recordingSessionService.resume()).rejects.toThrow(
            /mic device disconnected/,
        );

        expect(recordingSessionService.getState().status).toBe('paused');
        expect(recordingSessionService.getState().error).toContain(
            'mic device disconnected',
        );
    });

    it('resume() success does NOT fire error toast (regression guard)', async () => {
        await recordingSessionService.start('c', 'l');
        await recordingSessionService.pause();

        await recordingSessionService.resume();

        expect(toastCalls.error.length).toBe(0);
        expect(recordingSessionService.getState().status).toBe('recording');
    });
});
