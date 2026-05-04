/**
 * recordingSessionService — cp75.35 P1: AbortController propagation to 4
 * parallel LLM tasks.
 *
 * cp75.14 added (kind, lectureId) dedup in taskTrackerService.start. cp75.32
 * fanned out summarize, segmentSections, generateQA, extractActionItems
 * into 4 PARALLEL promises that share a single `summarize` task entry.
 * Result: when the user clicks 重新生成 (or any path triggers dedup), only
 * the wrapper task is cancelled — the 4 underlying LLM promises keep
 * running (and racing the new ones).
 *
 * Fix: runBackgroundSummary creates a service-level AbortController,
 * subscribes to taskTrackerService, aborts the controller when the task
 * transitions to cancelled or failed, and threads the signal into all 4
 * tasks.ts call sites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingSessionService } from '../recordingSessionService';

// ─── Module mocks ───────────────────────────────────────────────────────

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
    finalizeToDisk: vi.fn(async (path: string) => path),
    getRecordingInfo: vi.fn(() => ({
        duration: 120,
        sampleRate: 48_000,
        chunks: 12,
    })),
    mediaStream: null as unknown,
};

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

vi.mock('../streaming/translationPipeline', () => ({
    translationPipeline: {
        awaitDrain: vi.fn(async () => undefined),
        enqueue: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
    },
}));

vi.mock('../recordingDeviceMonitor', () => ({
    buildDeviceChangeWarning: vi.fn(() => null),
}));

vi.mock('../toastService', () => ({
    toastService: {
        warning: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../globalSearchService', () => ({
    globalSearchService: {
        invalidate: vi.fn(),
    },
}));

vi.mock('../ragService', () => ({
    ragService: {
        indexLecture: vi.fn(async () => ({ chunksCount: 0, success: true })),
    },
}));

vi.mock('../storageService', () => ({
    storageService: {
        saveSubtitles: vi.fn(async () => undefined),
        saveLecture: vi.fn(async () => undefined),
        getLecture: vi.fn(async () => ({
            id: 'lecture-1',
            duration: 120,
            status: 'recording',
        })),
        // Long enough to clear the 100-char short-circuit.
        getSubtitles: vi.fn(async () => [
            {
                id: 'sub-x-0',
                lecture_id: 'lecture-1',
                timestamp: 0,
                text_en:
                    'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ut enim ad minim veniam, quis nostrud exercitation',
                text_zh:
                    '夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容',
                type: 'rough',
                created_at: new Date().toISOString(),
            },
        ]),
        getNote: vi.fn(async () => null),
        saveNote: vi.fn(async () => undefined),
        getAppSettings: vi.fn(async () => ({
            translation: { target_language: 'zh-TW' },
        })),
    },
}));

// ─── Real taskTrackerService (so subscribe → cancel transitions land) ──
//
// We DO NOT mock taskTrackerService here — the whole point of this test
// is that runBackgroundSummary must subscribe to the real service and
// react to its 'cancelled' status transition by aborting the shared
// controller. Mocking subscribe would defeat the test.

// ─── llm/tasks: capture signal arg per call ────────────────────────────

const capturedSignals: Record<string, AbortSignal | undefined> = {};
// Promises that resolve when each task is *entered*, so the test can
// know when to fire the cancel.
const enteredPromises: Record<string, Promise<void>> = {};
const enteredResolvers: Record<string, () => void> = {};
for (const k of [
    'summarizeStream',
    'segmentSections',
    'generateQA',
    'extractActionItems',
]) {
    enteredPromises[k] = new Promise<void>((r) => {
        enteredResolvers[k] = r;
    });
}

vi.mock('../llm/tasks', () => ({
    summarizeStream: vi.fn(
        // eslint-disable-next-line require-yield
        async function* (params: {
            content: string;
            language: 'zh' | 'en';
            signal?: AbortSignal;
        }) {
            capturedSignals.summarizeStream = params.signal;
            enteredResolvers.summarizeStream();
            // Keep open until aborted or test resolves.
            await new Promise<void>((resolve) => {
                if (params.signal?.aborted) {
                    resolve();
                    return;
                }
                params.signal?.addEventListener('abort', () => resolve(), {
                    once: true,
                });
            });
        },
    ),
    segmentSections: vi.fn(
        async (params: {
            transcript: string;
            language: 'zh' | 'en';
            durationSec: number;
            signal?: AbortSignal;
        }) => {
            capturedSignals.segmentSections = params.signal;
            enteredResolvers.segmentSections();
            await new Promise<void>((resolve) => {
                if (params.signal?.aborted) {
                    resolve();
                    return;
                }
                params.signal?.addEventListener('abort', () => resolve(), {
                    once: true,
                });
            });
            return null;
        },
    ),
    generateQA: vi.fn(
        async (params: {
            transcript: string;
            language: 'zh' | 'en';
            signal?: AbortSignal;
        }) => {
            capturedSignals.generateQA = params.signal;
            enteredResolvers.generateQA();
            await new Promise<void>((resolve) => {
                if (params.signal?.aborted) {
                    resolve();
                    return;
                }
                params.signal?.addEventListener('abort', () => resolve(), {
                    once: true,
                });
            });
            return [];
        },
    ),
    extractActionItems: vi.fn(
        async (params: {
            transcript: string;
            language: 'zh' | 'en';
            durationSec: number;
            signal?: AbortSignal;
        }) => {
            capturedSignals.extractActionItems = params.signal;
            enteredResolvers.extractActionItems();
            await new Promise<void>((resolve) => {
                if (params.signal?.aborted) {
                    resolve();
                    return;
                }
                params.signal?.addEventListener('abort', () => resolve(), {
                    once: true,
                });
            });
            return [];
        },
    ),
}));

beforeEach(async () => {
    for (const k of Object.keys(capturedSignals)) {
        delete capturedSignals[k];
    }
    for (const k of [
        'summarizeStream',
        'segmentSections',
        'generateQA',
        'extractActionItems',
    ]) {
        enteredPromises[k] = new Promise<void>((r) => {
            enteredResolvers[k] = r;
        });
    }
    recordingSessionService.reset();
    const { taskTrackerService } = await import('../taskTrackerService');
    taskTrackerService.reset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('cp75.35 · parallel task dedup via AbortController', () => {
    it('cancelling the summarize task aborts all 4 parallel LLM calls', async () => {
        const { taskTrackerService } = await import('../taskTrackerService');

        await recordingSessionService.start('c', 'lecture-1');
        // stop() fires runBackgroundSummary in the background.
        await recordingSessionService.stop();

        // Wait until ALL 4 tasks have been entered (so each captured a
        // signal and is parked on the abort listener).
        await Promise.all([
            enteredPromises.summarizeStream,
            enteredPromises.segmentSections,
            enteredPromises.generateQA,
            enteredPromises.extractActionItems,
        ]);

        // All 4 signals must be defined and not yet aborted.
        expect(capturedSignals.summarizeStream).toBeDefined();
        expect(capturedSignals.segmentSections).toBeDefined();
        expect(capturedSignals.generateQA).toBeDefined();
        expect(capturedSignals.extractActionItems).toBeDefined();
        expect(capturedSignals.summarizeStream?.aborted).toBe(false);
        expect(capturedSignals.segmentSections?.aborted).toBe(false);
        expect(capturedSignals.generateQA?.aborted).toBe(false);
        expect(capturedSignals.extractActionItems?.aborted).toBe(false);

        // Find the summarize task that runBackgroundSummary started.
        const active = taskTrackerService.getActive();
        const summarize = active.find((t) => t.kind === 'summarize');
        expect(summarize).toBeDefined();

        // Cancel it — simulates the dedup path (e.g. user clicks
        // 重新生成 and a fresh summarize-task supersedes this one).
        taskTrackerService.cancel(summarize!.id);

        // Microtask boundary so the subscriber callback fires + the
        // abort listeners on each captured signal run.
        await Promise.resolve();
        await Promise.resolve();

        expect(capturedSignals.summarizeStream?.aborted).toBe(true);
        expect(capturedSignals.segmentSections?.aborted).toBe(true);
        expect(capturedSignals.generateQA?.aborted).toBe(true);
        expect(capturedSignals.extractActionItems?.aborted).toBe(true);
    });

    it('non-cancelled tasks complete normally without aborting the signal', async () => {
        const { taskTrackerService } = await import('../taskTrackerService');
        const { storageService } = await import('../storageService');

        // Make all 4 LLM mocks resolve quickly with empty / null output
        // for this test only — we want to observe completion, not cancellation.
        const { summarizeStream, segmentSections, generateQA, extractActionItems } =
            await import('../llm/tasks');
        (summarizeStream as ReturnType<typeof vi.fn>).mockImplementationOnce(
            // eslint-disable-next-line require-yield
            async function* (params: { signal?: AbortSignal }) {
                capturedSignals.summarizeStream = params.signal;
                enteredResolvers.summarizeStream();
                yield {
                    phase: 'done' as const,
                    fullText: '## 摘要\n本堂課重點...',
                };
            },
        );
        (segmentSections as ReturnType<typeof vi.fn>).mockImplementationOnce(
            async (params: { signal?: AbortSignal }) => {
                capturedSignals.segmentSections = params.signal;
                enteredResolvers.segmentSections();
                return null;
            },
        );
        (generateQA as ReturnType<typeof vi.fn>).mockImplementationOnce(
            async (params: { signal?: AbortSignal }) => {
                capturedSignals.generateQA = params.signal;
                enteredResolvers.generateQA();
                return [];
            },
        );
        (extractActionItems as ReturnType<typeof vi.fn>).mockImplementationOnce(
            async (params: { signal?: AbortSignal }) => {
                capturedSignals.extractActionItems = params.signal;
                enteredResolvers.extractActionItems();
                return [];
            },
        );

        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();

        // Wait for the background task to fully resolve.
        await new Promise((r) => setTimeout(r, 80));

        // saveNote should have been called — i.e. runBackgroundSummary
        // ran to completion.
        expect(storageService.saveNote).toHaveBeenCalled();

        // None of the signals should be aborted on the happy path.
        expect(capturedSignals.summarizeStream?.aborted).toBe(false);
        expect(capturedSignals.segmentSections?.aborted).toBe(false);
        expect(capturedSignals.generateQA?.aborted).toBe(false);
        expect(capturedSignals.extractActionItems?.aborted).toBe(false);

        // And the summarize task is no longer active.
        const summarizeActive = taskTrackerService
            .getActive()
            .find((t) => t.kind === 'summarize');
        expect(summarizeActive).toBeUndefined();
    });
});
