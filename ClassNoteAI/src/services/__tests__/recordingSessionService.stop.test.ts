/**
 * recordingSessionService.stop — Phase 7 Sprint 2 task S2.3 tests.
 *
 * Covers the 6-step stop pipeline:
 *   1. transcribe — transcriptionService.stop + translationPipeline.awaitDrain
 *   2. segment    — recorder.finalizeToDisk
 *   3. index      — storageService.saveSubtitles + globalSearchService invalidate
 *   4. summary    — taskTrackerService.start (background; not awaited by stop())
 *   5. index/RAG  — taskTrackerService.start (background; not awaited)
 *   6. done       — storageService.saveLecture(status='completed')
 *
 * Failure policy assertions:
 *   • Step 1 fail → non-fatal, pipeline continues
 *   • Step 2 fail → fatal, stopPhase=failed, dispatch stop, early return
 *   • Step 3 saveSubtitles fail → fatal, same as step 2
 *   • Step 3 globalSearch invalidate fail → non-fatal, continues to step 4
 *   • Step 4 / Step 5 background failures → tracker fail; status stays done
 *   • Step 6 saveLecture fail → log only, status still flips to stopped/done
 *
 * The stop pipeline is the most important user-facing path in Phase 7
 * (recording → review). These tests are the regression net.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingSessionService } from '../recordingSessionService';
import * as toastModule from '../toastService';
import {
    RECORDING_CHANGE_EVENT,
    type RecordingChangeDetail,
} from '../__contracts__/recordingSessionService.contract';

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
    finalizeToDisk: vi.fn(
        async (path: string) => path,
    ) as ReturnType<typeof vi.fn>,
    // cp75.28 — recordingSessionService.stop step 6 reads this to stamp
    // lecture.duration. Default null = "no PCM samples" (which is what
    // a fresh test fixture would normally report); individual tests
    // override via mockReturnValue / mockReturnValueOnce.
    getRecordingInfo: vi.fn(
        () =>
            null as
                | { duration: number; sampleRate: number; chunks: number }
                | null,
    ),
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

// subtitleService — drives step-3 segment → Subtitle row mapping. Default
// mock returns one segment so saveSubtitles has work to do.
const subtitleSegments: unknown[] = [];
vi.mock('../subtitleService', () => ({
    subtitleService: {
        getSegments: vi.fn(() => subtitleSegments),
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
    },
}));

// translationPipeline — needs awaitDrain to exist and resolve. Track the
// in-flight promise so tests can confirm we awaited it.
const translationDrainResolvers: Array<() => void> = [];
const awaitDrainCalls: number[] = [];
vi.mock('../streaming/translationPipeline', () => ({
    translationPipeline: {
        awaitDrain: vi.fn(() => {
            awaitDrainCalls.push(Date.now());
            return new Promise<void>((resolve) => {
                // Default: resolve on next tick.
                queueMicrotask(resolve);
                translationDrainResolvers.push(resolve);
            });
        }),
        enqueue: vi.fn(),
    },
}));

// taskTrackerService — capture every start/complete/fail/update call.
const trackerCalls: Array<
    | { fn: 'start'; input: { kind: string; label: string; lectureId?: string }; id: string }
    | { fn: 'update'; id: string; patch: unknown }
    | { fn: 'complete'; id: string }
    | { fn: 'fail'; id: string; err: string }
> = [];
let trackerNextId = 1;
vi.mock('../taskTrackerService', () => ({
    taskTrackerService: {
        start: vi.fn((input: { kind: string; label: string; lectureId?: string }) => {
            const id = `task-${trackerNextId++}`;
            trackerCalls.push({ fn: 'start', input, id });
            return id;
        }),
        update: vi.fn((id: string, patch: unknown) => {
            trackerCalls.push({ fn: 'update', id, patch });
        }),
        complete: vi.fn((id: string) => {
            trackerCalls.push({ fn: 'complete', id });
        }),
        fail: vi.fn((id: string, err: string) => {
            trackerCalls.push({ fn: 'fail', id, err });
        }),
        cancel: vi.fn(),
        getActive: vi.fn(() => []),
        getById: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
        cancelAll: vi.fn(),
        reset: vi.fn(),
    },
}));

// globalSearchService — invalidate is the contract step 3 calls.
const globalSearchInvalidateCalls: number[] = [];
let globalSearchInvalidateThrows = false;
vi.mock('../globalSearchService', () => ({
    globalSearchService: {
        invalidate: vi.fn(() => {
            globalSearchInvalidateCalls.push(Date.now());
            if (globalSearchInvalidateThrows) {
                throw new Error('search index invalidate boom');
            }
        }),
    },
}));

// storageService — drives steps 3 and 6.
const storageMockState: {
    saveSubtitlesShouldThrow: boolean;
    saveLectureShouldThrow: boolean;
    saveSubtitlesCalls: unknown[][];
    saveLectureCalls: unknown[][];
    saveNoteCalls: unknown[][];
    getSubtitlesCalls: string[];
    lectureRow: { id: string; status: string; audio_path?: string } | null;
    note: { lecture_id: string; sections: unknown[]; qa_records: unknown[] } | null;
    subsForLecture: unknown[];
} = {
    saveSubtitlesShouldThrow: false,
    saveLectureShouldThrow: false,
    saveSubtitlesCalls: [],
    saveLectureCalls: [],
    saveNoteCalls: [],
    getSubtitlesCalls: [],
    lectureRow: { id: 'lecture-1', status: 'recording' },
    note: null,
    subsForLecture: [],
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
        getSubtitles: vi.fn(async (lectureId: string) => {
            storageMockState.getSubtitlesCalls.push(lectureId);
            return storageMockState.subsForLecture;
        }),
        getNote: vi.fn(async () => storageMockState.note),
        saveNote: vi.fn(async (note: unknown) => {
            storageMockState.saveNoteCalls.push([note]);
        }),
    },
}));

vi.mock('../toastService', () => ({
    toastService: {
        warning: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../recordingDeviceMonitor', () => ({
    buildDeviceChangeWarning: vi.fn(() => null),
}));

// ragService — only used by step 5 background. Default = succeed.
let ragShouldThrow = false;
vi.mock('../ragService', () => ({
    ragService: {
        indexLecture: vi.fn(
            async (
                _lectureId: string,
                _pdfText: string | null,
                _transcriptText: string | null,
                onProgress?: (p: { stage: string; current: number; total: number; message: string }) => void,
            ) => {
                onProgress?.({
                    stage: 'embedding',
                    current: 1,
                    total: 1,
                    message: 'done',
                });
                if (ragShouldThrow) throw new Error('rag indexLecture boom');
                return { chunksCount: 1, success: true };
            },
        ),
    },
}));

// llm/tasks — default returns a tiny stream so background summary
// completes cleanly when the transcript is long enough.
let summarizeShouldThrow = false;
vi.mock('../llm/tasks', () => ({
    summarizeStream: vi.fn(
        // eslint-disable-next-line require-yield
        async function* (_params: { content: string; language: 'zh' | 'en' }) {
            if (summarizeShouldThrow) {
                throw new Error('summarize stream boom');
            }
            yield { phase: 'reduce-delta' as const, delta: '## 摘要\n' };
            yield { phase: 'reduce-delta' as const, delta: '本堂課重點...' };
            yield {
                phase: 'done' as const,
                fullText: '## 摘要\n本堂課重點...',
            };
        },
    ),
    // cp75.17 — segmentSections runs in parallel with summarize. Default
    // stub returns null so the runBackgroundSummary path falls through
    // to summary's `## headings` extraction, matching the pre-cp75.17
    // behaviour these tests were written against. Tests that want to
    // verify segmenter wiring can override via `.mockResolvedValueOnce`.
    segmentSections: vi.fn(async () => null),
    // cp75.32 — generateQA + extractActionItems also run in parallel.
    // Default stubs return [] so existing tests don't see Q&A surface
    // unless they explicitly opt in via `.mockResolvedValueOnce`.
    generateQA: vi.fn(async () => []),
    extractActionItems: vi.fn(async () => []),
}));

// ─── Helpers ────────────────────────────────────────────────────────────

function captureRecordingChangeEvents(): RecordingChangeDetail[] {
    const captured: RecordingChangeDetail[] = [];
    const handler = (e: Event) => {
        captured.push((e as CustomEvent<RecordingChangeDetail>).detail);
    };
    window.addEventListener(RECORDING_CHANGE_EVENT, handler);
    afterEach(() => window.removeEventListener(RECORDING_CHANGE_EVENT, handler));
    return captured;
}

beforeEach(() => {
    storageMockState.saveSubtitlesShouldThrow = false;
    storageMockState.saveLectureShouldThrow = false;
    storageMockState.saveSubtitlesCalls = [];
    storageMockState.saveLectureCalls = [];
    storageMockState.saveNoteCalls = [];
    storageMockState.getSubtitlesCalls = [];
    storageMockState.lectureRow = { id: 'lecture-1', status: 'recording' };
    storageMockState.note = null;
    storageMockState.subsForLecture = [];
    subtitleSegments.length = 0;
    subtitleSegments.push({
        id: 'seg-1',
        startTime: 1_000,
        endTime: 2_500,
        roughText: 'Hello world',
        roughTranslation: '你好',
        displayText: 'Hello world',
        displayTranslation: '你好',
        source: 'rough' as const,
    });
    awaitDrainCalls.length = 0;
    translationDrainResolvers.length = 0;
    trackerCalls.length = 0;
    trackerNextId = 1;
    globalSearchInvalidateCalls.length = 0;
    globalSearchInvalidateThrows = false;
    summarizeShouldThrow = false;
    ragShouldThrow = false;
    mockRecorderInstance.finalizeToDisk = vi.fn(async (p: string) => p);
    mockRecorderInstance.start.mockClear();
    mockRecorderInstance.stop.mockClear();
    mockRecorderInstance.getRecordingInfo.mockReset();
    mockRecorderInstance.getRecordingInfo.mockReturnValue(null);
    recordingSessionService.reset();
});

afterEach(() => {
    vi.useRealTimers();
});

// ─── 6-step pipeline order + status transitions ─────────────────────────

describe('stop() · 6-step pipeline', () => {
    it('runs all 6 steps and ends at status=stopped, stopPhase=done', async () => {
        const observed: Array<{ status: string; stopPhase?: string }> = [];
        recordingSessionService.subscribe((s) => {
            observed.push({ status: s.status, stopPhase: s.stopPhase });
        });
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();

        // Final state
        const final = recordingSessionService.getState();
        expect(final.status).toBe('stopped');
        expect(final.stopPhase).toBe('done');

        // Each phase passed through (we don't require all observers to
        // see *every* one because setState batches micro-tasks, but we
        // require the user-visible boundaries.)
        const phases = observed.map((s) => s.stopPhase).filter(Boolean);
        expect(phases).toContain('transcribe');
        expect(phases).toContain('segment');
        expect(phases).toContain('index');
        expect(phases).toContain('summary');
        expect(phases).toContain('done');

        // status went through stopping
        expect(observed.map((s) => s.status)).toContain('stopping');
        expect(observed[observed.length - 1].status).toBe('stopped');
    });

    it('Step 1: calls transcriptionService.stop + translationPipeline.awaitDrain', async () => {
        const { transcriptionService } = await import('../transcriptionService');
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        expect(transcriptionService.stop).toHaveBeenCalled();
        expect(awaitDrainCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('Step 1 transcription failure is non-fatal — pipeline continues', async () => {
        const { transcriptionService } = await import('../transcriptionService');
        (transcriptionService.stop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('asr drain failed'),
        );
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Despite step 1 failing, step 2/3/6 still ran:
        expect(mockRecorderInstance.finalizeToDisk).toHaveBeenCalled();
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(1);
        expect(storageMockState.saveLectureCalls).toHaveLength(1);
        expect(recordingSessionService.getState().status).toBe('stopped');
        expect(recordingSessionService.getState().stopPhase).toBe('done');
    });

    it('Step 2: calls recorder.finalizeToDisk with a lecture-scoped path', async () => {
        await recordingSessionService.start('c', 'lecture-77');
        await recordingSessionService.stop();
        expect(mockRecorderInstance.finalizeToDisk).toHaveBeenCalledTimes(1);
        const path = (mockRecorderInstance.finalizeToDisk as ReturnType<typeof vi.fn>)
            .mock.calls[0]?.[0] as string;
        expect(path).toContain('lecture_lecture-77_');
        expect(path.endsWith('.wav')).toBe(true);
    });

    it('Step 2 finalize failure is fatal — stopPhase=failed, dispatch stop, early return', async () => {
        const events = captureRecordingChangeEvents();
        mockRecorderInstance.finalizeToDisk = vi.fn(async () => {
            throw new Error('disk full');
        });
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();

        // Pipeline aborted: step 3 (saveSubtitles) and step 6 (saveLecture)
        // never ran, but `stop` event still fired.
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(0);
        expect(storageMockState.saveLectureCalls).toHaveLength(0);
        expect(recordingSessionService.getState().stopPhase).toBe('failed');
        expect(recordingSessionService.getState().status).toBe('stopped');
        expect(recordingSessionService.getState().error).toMatch(/audio finalize/i);
        expect(events.map((e) => e.kind)).toContain('stop');
    });

    it('Step 3: persists subtitles built from subtitleService.getSegments()', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(1);
        const subs = storageMockState.saveSubtitlesCalls[0][0] as Array<{
            id: string;
            lecture_id: string;
            text_en: string;
            text_zh?: string;
            type: string;
        }>;
        expect(subs).toHaveLength(1);
        expect(subs[0].lecture_id).toBe('lecture-1');
        expect(subs[0].text_en).toBe('Hello world');
        expect(subs[0].text_zh).toBe('你好');
        expect(subs[0].type).toBe('rough');
    });

    it('Step 3: invalidates globalSearchService so next ⌘K rebuilds', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        expect(globalSearchInvalidateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('Step 3 globalSearch invalidate failure is non-fatal — pipeline continues', async () => {
        globalSearchInvalidateThrows = true;
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Step 6 still ran:
        expect(storageMockState.saveLectureCalls).toHaveLength(1);
        expect(recordingSessionService.getState().stopPhase).toBe('done');
    });

    it('Step 3 saveSubtitles failure is fatal — stopPhase=failed, dispatch stop', async () => {
        const events = captureRecordingChangeEvents();
        storageMockState.saveSubtitlesShouldThrow = true;
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Step 6 (saveLecture) must NOT have run since step 3 was fatal.
        expect(storageMockState.saveLectureCalls).toHaveLength(0);
        expect(recordingSessionService.getState().stopPhase).toBe('failed');
        expect(recordingSessionService.getState().status).toBe('stopped');
        expect(recordingSessionService.getState().error).toMatch(/subtitles save/i);
        expect(events.map((e) => e.kind)).toContain('stop');
    });

    it('Step 4: kicks off taskTracker summarize task (background, not awaited)', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        const summarizeStarts = trackerCalls.filter(
            (c) => c.fn === 'start' && c.input.kind === 'summarize',
        );
        expect(summarizeStarts).toHaveLength(1);
        expect(
            (summarizeStarts[0] as Extract<typeof trackerCalls[number], { fn: 'start' }>)
                .input.lectureId,
        ).toBe('lecture-1');
    });

    it('Step 5: kicks off taskTracker index task', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        const indexStarts = trackerCalls.filter(
            (c) => c.fn === 'start' && c.input.kind === 'index',
        );
        expect(indexStarts).toHaveLength(1);
        expect(
            (indexStarts[0] as Extract<typeof trackerCalls[number], { fn: 'start' }>)
                .input.lectureId,
        ).toBe('lecture-1');
    });

    it('Step 6: storageService.saveLecture with status=completed', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        expect(storageMockState.saveLectureCalls).toHaveLength(1);
        const saved = storageMockState.saveLectureCalls[0][0] as {
            id: string;
            status: string;
            audio_path?: string;
        };
        expect(saved.id).toBe('lecture-1');
        expect(saved.status).toBe('completed');
        // finalizeToDisk returned its argument by default — audio_path
        // is the wav path we built.
        expect(saved.audio_path).toMatch(/lecture_lecture-1_.*\.wav$/);
    });

    it('Step 6 saveLecture failure is logged but state still flips to stopped/done', async () => {
        const events = captureRecordingChangeEvents();
        storageMockState.saveLectureShouldThrow = true;
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Even though saveLecture threw, the user state and the event
        // still flip.
        expect(recordingSessionService.getState().status).toBe('stopped');
        expect(recordingSessionService.getState().stopPhase).toBe('done');
        expect(events.map((e) => e.kind)).toContain('stop');
    });

    it('done state is final: stopPhase=done, dispatches RECORDING_CHANGE_EVENT { kind:stop }', async () => {
        const events = captureRecordingChangeEvents();
        await recordingSessionService.start('course-9', 'lecture-1');
        await recordingSessionService.stop();
        const stopEvents = events.filter((e) => e.kind === 'stop');
        expect(stopEvents).toHaveLength(1);
        expect(stopEvents[0]).toEqual({
            kind: 'stop',
            lectureId: 'lecture-1',
            courseId: 'course-9',
        });
    });

    it('background summary tasks are NOT awaited — stop() resolves before summary completes', async () => {
        // Set up enough subtitle volume so runBackgroundSummary actually
        // calls summarizeStream (the < 100 char short-circuit otherwise
        // resolves the tracker without ever invoking the stream).
        const longText =
            'lorem ipsum dolor sit amet consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ut enim ad minim veniam, quis nostrud exercitation';
        storageMockState.subsForLecture = [
            {
                id: 'sub-x-0',
                lecture_id: 'lecture-1',
                timestamp: 0,
                text_en: longText,
                type: 'rough',
                created_at: new Date().toISOString(),
            },
        ];
        // Block summarizeStream forever — if stop() awaited it, the
        // test would time out.
        const { summarizeStream } = await import('../llm/tasks');
        let neverResolveCalled = false;
        (summarizeStream as ReturnType<typeof vi.fn>).mockImplementationOnce(
            // eslint-disable-next-line require-yield
            async function* () {
                neverResolveCalled = true;
                await new Promise(() => undefined);
            },
        );
        await recordingSessionService.start('c', 'lecture-1');
        const t0 = Date.now();
        await recordingSessionService.stop();
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeLessThan(2000);
        // Final state still done — stop() did NOT wait for summarize.
        expect(recordingSessionService.getState().stopPhase).toBe('done');
        // Allow the background microtask to enter summarizeStream.
        await new Promise((r) => setTimeout(r, 30));
        expect(neverResolveCalled).toBe(true);
    });
});

// ─── Background task behaviour (Step 4 / 5) ─────────────────────────────

describe('stop() · background summary', () => {
    it('skips LLM call (just completes tracker) when transcript < 100 chars', async () => {
        // No subtitles for the lecture → empty transcript → < 100 chars.
        storageMockState.subsForLecture = [];
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Wait for background task to settle.
        await new Promise((r) => setTimeout(r, 30));
        // We expect at least one start + complete for summarize, no fail.
        const summarizeStart = trackerCalls.find(
            (c) => c.fn === 'start' && c.input.kind === 'summarize',
        );
        expect(summarizeStart).toBeDefined();
        const summarizeId = (summarizeStart as Extract<typeof trackerCalls[number], { fn: 'start' }>).id;
        const completed = trackerCalls.find(
            (c) => c.fn === 'complete' && c.id === summarizeId,
        );
        expect(completed).toBeDefined();
        const failed = trackerCalls.find(
            (c) => c.fn === 'fail' && c.id === summarizeId,
        );
        expect(failed).toBeUndefined();
        // Definitely no saveNote on the short path.
        expect(storageMockState.saveNoteCalls).toHaveLength(0);
    });

    it('runs summarizeStream + persists note when transcript ≥ 100 chars', async () => {
        // Pretend the just-saved subtitles total > 100 chars (the
        // short-circuit threshold inside runBackgroundSummary).
        const longSentence =
            'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ut enim ad minim veniam, quis nostrud exercitation';
        storageMockState.subsForLecture = [
            {
                id: 'sub-x-0',
                lecture_id: 'lecture-1',
                timestamp: 0,
                text_en: longSentence,
                text_zh: '夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容',
                type: 'rough',
                created_at: new Date().toISOString(),
            },
        ];
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Wait for background to finish. cp75.17 — bumped 30 → 100ms
        // because runBackgroundSummary now awaits getLecture +
        // segmentSections (parallel) + dynamic import of llm/tasks
        // before persisting; 30ms was on the edge under load.
        await new Promise((r) => setTimeout(r, 100));
        expect(storageMockState.saveNoteCalls.length).toBeGreaterThanOrEqual(1);
        const note = storageMockState.saveNoteCalls[0][0] as {
            lecture_id: string;
            summary?: string;
            sections: unknown[];
            qa_records: unknown[];
        };
        expect(note.lecture_id).toBe('lecture-1');
        expect(note.summary).toMatch(/摘要/);
    });

    it('summarize failure → tracker fail (status of stop pipeline stays done)', async () => {
        // Long enough transcript so we actually call summarizeStream.
        const longSentence =
            'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';
        storageMockState.subsForLecture = [
            {
                id: 'sub-x-0',
                lecture_id: 'lecture-1',
                timestamp: 0,
                text_en: longSentence,
                text_zh: '夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容',
                type: 'rough',
                created_at: new Date().toISOString(),
            },
        ];
        summarizeShouldThrow = true;
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        await new Promise((r) => setTimeout(r, 30));
        // Stop pipeline reported done despite background fail.
        expect(recordingSessionService.getState().stopPhase).toBe('done');
        expect(recordingSessionService.getState().status).toBe('stopped');
        // Tracker has a fail entry for the summarize task.
        const summarizeStart = trackerCalls.find(
            (c) => c.fn === 'start' && c.input.kind === 'summarize',
        );
        expect(summarizeStart).toBeDefined();
        const summarizeId = (summarizeStart as Extract<typeof trackerCalls[number], { fn: 'start' }>).id;
        const failed = trackerCalls.find(
            (c) => c.fn === 'fail' && c.id === summarizeId,
        );
        expect(failed).toBeDefined();
    });
});

describe('stop() · background RAG index', () => {
    it('failure → tracker fail (does not affect stop pipeline status)', async () => {
        ragShouldThrow = true;
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        await new Promise((r) => setTimeout(r, 30));
        expect(recordingSessionService.getState().stopPhase).toBe('done');
        const indexStart = trackerCalls.find(
            (c) => c.fn === 'start' && c.input.kind === 'index',
        );
        expect(indexStart).toBeDefined();
        const indexId = (indexStart as Extract<typeof trackerCalls[number], { fn: 'start' }>).id;
        const failed = trackerCalls.find(
            (c) => c.fn === 'fail' && c.id === indexId,
        );
        expect(failed).toBeDefined();
    });

    it('success → tracker complete', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        await new Promise((r) => setTimeout(r, 30));
        const indexStart = trackerCalls.find(
            (c) => c.fn === 'start' && c.input.kind === 'index',
        );
        expect(indexStart).toBeDefined();
        const indexId = (indexStart as Extract<typeof trackerCalls[number], { fn: 'start' }>).id;
        const completed = trackerCalls.find(
            (c) => c.fn === 'complete' && c.id === indexId,
        );
        expect(completed).toBeDefined();
    });
});

// ─── Edge cases ─────────────────────────────────────────────────────────

describe('stop() · edge cases', () => {
    it('idle stop is still a no-op (no state change, no events)', async () => {
        const events = captureRecordingChangeEvents();
        await recordingSessionService.stop();
        expect(recordingSessionService.getState().status).toBe('idle');
        expect(events).toHaveLength(0);
        expect(storageMockState.saveLectureCalls).toHaveLength(0);
    });

    it('stop from paused still runs the full pipeline', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.pause();
        await recordingSessionService.stop();
        expect(mockRecorderInstance.finalizeToDisk).toHaveBeenCalled();
        expect(storageMockState.saveSubtitlesCalls).toHaveLength(1);
        expect(storageMockState.saveLectureCalls).toHaveLength(1);
    });

    it('elapsed timer is stopped on stop()', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        const before = recordingSessionService.getState().elapsed;
        // Advance real time. If the timer were still alive, elapsed
        // would tick (eventually).
        await new Promise((r) => setTimeout(r, 60));
        const after = recordingSessionService.getState().elapsed;
        expect(after).toBe(before);
    });
});

// ─── W17 · coalesced toast at end of stop() ─────────────────────────────

describe('stop() · W17 toast coalescing', () => {
    beforeEach(() => {
        // Module-level vi.mock above already replaced toastService's
        // methods with vi.fn(); just clear them between tests so call
        // counts don't bleed across cases.
        (toastModule.toastService.success as ReturnType<typeof vi.fn>).mockClear();
        (toastModule.toastService.warning as ReturnType<typeof vi.fn>).mockClear();
        (toastModule.toastService.error as ReturnType<typeof vi.fn>).mockClear();
        (toastModule.toastService.info as ReturnType<typeof vi.fn>).mockClear();
    });

    it('全 6 step OK → 結尾發 1 個 toast.success「錄音已儲存」', async () => {
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Wait a microtask so the awaited toast emit has fully landed.
        await Promise.resolve();
        expect(toastModule.toastService.success).toHaveBeenCalledTimes(1);
        const [message, detail] = (
            toastModule.toastService.success as ReturnType<typeof vi.fn>
        ).mock.calls[0];
        expect(message).toMatch(/錄音已儲存/);
        expect(detail).toMatch(/背景/);
        expect(toastModule.toastService.warning).not.toHaveBeenCalled();
        expect(toastModule.toastService.error).not.toHaveBeenCalled();
    });

    it('step 2 (segment) 失敗 → 1 個 toast.warning + state.stopPhase=failed', async () => {
        mockRecorderInstance.finalizeToDisk = vi.fn(async () => {
            throw new Error('disk full');
        });
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        await Promise.resolve();
        expect(recordingSessionService.getState().stopPhase).toBe('failed');
        expect(toastModule.toastService.warning).toHaveBeenCalledTimes(1);
        expect(toastModule.toastService.success).not.toHaveBeenCalled();
        const [message] = (
            toastModule.toastService.warning as ReturnType<typeof vi.fn>
        ).mock.calls[0];
        expect(message).toMatch(/錄音儲存發生問題/);
    });

    it('step 3 (subtitles save) 失敗 → 1 個 toast.warning + state.stopPhase=failed', async () => {
        storageMockState.saveSubtitlesShouldThrow = true;
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        await Promise.resolve();
        expect(recordingSessionService.getState().stopPhase).toBe('failed');
        expect(toastModule.toastService.warning).toHaveBeenCalledTimes(1);
        expect(toastModule.toastService.success).not.toHaveBeenCalled();
        const [, detail] = (
            toastModule.toastService.warning as ReturnType<typeof vi.fn>
        ).mock.calls[0];
        // Step 3 fails *before* segmentSaved flips, so the detail must
        // reflect "partial" rather than "fully" persisted.
        expect(detail).toMatch(/部分/);
        expect(detail).toMatch(/subtitles save/);
    });

    it('step 4-5 background 失敗 → stop() 不發 toast (tracker 自己 fail() 處理)', async () => {
        // Force background paths to fail. Stop pipeline status should
        // still flip to done and ONLY the success toast fires.
        const longSentence =
            'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua';
        storageMockState.subsForLecture = [
            {
                id: 'sub-x-0',
                lecture_id: 'lecture-1',
                timestamp: 0,
                text_en: longSentence,
                text_zh: '夠長的中文翻譯內容夠長的中文翻譯內容',
                type: 'rough',
                created_at: new Date().toISOString(),
            },
        ];
        summarizeShouldThrow = true;
        ragShouldThrow = true;
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Let background tasks settle so any (incorrect) extra toasts
        // would have a chance to fire.
        await new Promise((r) => setTimeout(r, 30));
        expect(recordingSessionService.getState().stopPhase).toBe('done');
        // Exactly one toast — the coalesced success bar — and nothing
        // from the background failures.
        expect(toastModule.toastService.success).toHaveBeenCalledTimes(1);
        expect(toastModule.toastService.warning).not.toHaveBeenCalled();
        expect(toastModule.toastService.error).not.toHaveBeenCalled();
    });
});

// ─── cp75.28 · stamps lecture.duration from recorder.getRecordingInfo() ──
//
// Pre cp75.28: stop step 6 hardcoded `duration: 0` on the lecture row.
// That zero cascaded into runBackgroundSummary → segmentSections (the
// segmenter's heading-spread fallback formula clamped every section to
// timestamp=0) → groupSubsBySections (all subs land in section 0 → "1
// para wall of text"). Both Issue 1 (章節 timestamp 全 00:00) and
// Issue 2 (段落不分段) shared this single root cause; stamping the
// real duration once fixes both.

describe('stop() · cp75.28 stamps lecture.duration', () => {
    it('saveLecture is called with duration > 0 when recorder produced PCM samples', async () => {
        // Recorder reports a real duration (sub-second precision allowed —
        // the impl rounds to the nearest integer second for storage).
        mockRecorderInstance.getRecordingInfo.mockReturnValue({
            duration: 1234.5,
            sampleRate: 48_000,
            chunks: 12,
        });
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();

        expect(storageMockState.saveLectureCalls).toHaveLength(1);
        const saved = storageMockState.saveLectureCalls[0][0] as {
            duration?: number;
        };
        // Math.round(1234.5) === 1235 — spec the rounding so future
        // refactors don't silently swap it for floor() and lose half a
        // second.
        expect(saved.duration).toBe(1235);
    });

    it('saveLecture stamps duration=0 gracefully when getRecordingInfo returns null', async () => {
        // Default mock already returns null; assert the no-op path.
        mockRecorderInstance.getRecordingInfo.mockReturnValue(null);
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();

        expect(storageMockState.saveLectureCalls).toHaveLength(1);
        const saved = storageMockState.saveLectureCalls[0][0] as {
            duration?: number;
        };
        expect(saved.duration).toBe(0);
    });

    it('saveLecture stamps duration=0 gracefully when getRecordingInfo throws', async () => {
        mockRecorderInstance.getRecordingInfo.mockImplementation(() => {
            throw new Error('recorder went away');
        });
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();

        expect(storageMockState.saveLectureCalls).toHaveLength(1);
        const saved = storageMockState.saveLectureCalls[0][0] as {
            duration?: number;
        };
        expect(saved.duration).toBe(0);
        // Pipeline still succeeded — duration sourcing is best-effort.
        expect(recordingSessionService.getState().stopPhase).toBe('done');
    });

    it('cp75.32 — runBackgroundSummary populates qa_records and action_items via generateQA + extractActionItems', async () => {
        // Long enough transcript so summarize fires. Override the Q&A +
        // action-items stubs to return non-empty arrays so we can
        // assert the values land on the saved Note.
        const longSentence =
            'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ut enim ad minim veniam, quis nostrud exercitation';
        storageMockState.subsForLecture = [
            {
                id: 'sub-x-0',
                lecture_id: 'lecture-1',
                timestamp: 0,
                text_en: longSentence,
                text_zh:
                    '夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容',
                type: 'rough',
                created_at: new Date().toISOString(),
            },
        ];
        const { generateQA, extractActionItems } = await import(
            '../llm/tasks'
        );
        (generateQA as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
            {
                question: 'What is X?',
                answer: 'X is Y.',
                timestamp: 60,
                level: 'recall',
            },
            {
                question: 'How does X relate to Y?',
                answer: 'Through Z.',
                timestamp: 120,
                level: 'comprehend',
            },
            {
                question: 'Apply X to a real problem.',
                answer: 'Step 1: ...',
                timestamp: 180,
                level: 'apply',
            },
        ]);
        (extractActionItems as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
            {
                description: 'Submit problem set 3',
                due_date: '2026-05-06',
                mentioned_at_timestamp: 1500,
            },
            {
                description: 'Read chapter 5',
                due_date: null,
                mentioned_at_timestamp: 2400,
            },
        ]);

        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Wait long enough for the parallel awaits in saveNote to land.
        await new Promise((r) => setTimeout(r, 100));

        expect(storageMockState.saveNoteCalls.length).toBeGreaterThanOrEqual(1);
        const note = storageMockState.saveNoteCalls[0][0] as {
            qa_records?: unknown[];
            action_items?: unknown[];
        };
        expect(note.qa_records).toBeDefined();
        expect(note.qa_records).toHaveLength(3);
        expect(note.action_items).toBeDefined();
        expect(note.action_items).toHaveLength(2);
    });

    it('runBackgroundSummary reads the just-stamped duration and passes it to segmentSections', async () => {
        // cp75.28 — the stamped duration must propagate. Set up a long
        // enough transcript so the summary path actually runs (and thus
        // segmentSections is called); set up the recorder to report
        // duration=600.
        mockRecorderInstance.getRecordingInfo.mockReturnValue({
            duration: 600,
            sampleRate: 48_000,
            chunks: 6,
        });
        // Step 6 saveLecture in the impl writes through to the in-memory
        // mock; downstream getLecture (called from runBackgroundSummary
        // for durationSec lookup) reads that updated row. Wire it.
        const originalSaveLecture =
            storageMockState.saveLectureCalls; // for tracking
        // Update getLecture mock side: re-import storageService and
        // patch getLecture to return the most recent saveLecture row.
        const { storageService } = await import('../storageService');
        (storageService.getLecture as ReturnType<typeof vi.fn>).mockImplementation(
            async () => {
                const last =
                    originalSaveLecture[originalSaveLecture.length - 1]?.[0];
                if (last) return last;
                return storageMockState.lectureRow;
            },
        );

        // Long enough transcript — runBackgroundSummary's < 100 char
        // short-circuit otherwise skips summarizeStream entirely.
        const longSentence =
            'lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ut enim ad minim veniam, quis nostrud exercitation';
        storageMockState.subsForLecture = [
            {
                id: 'sub-x-0',
                lecture_id: 'lecture-1',
                timestamp: 0,
                text_en: longSentence,
                text_zh: '夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容夠長的中文翻譯內容',
                type: 'rough',
                created_at: new Date().toISOString(),
            },
        ];

        const { segmentSections } = await import('../llm/tasks');
        (segmentSections as ReturnType<typeof vi.fn>).mockClear();

        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        // Allow background summary to enter segmentSections.
        await new Promise((r) => setTimeout(r, 100));

        // segmentSections should have been called with durationSec=600,
        // i.e. the value just stamped onto the lecture row by step 6.
        expect(segmentSections).toHaveBeenCalled();
        const call = (segmentSections as ReturnType<typeof vi.fn>).mock
            .calls[0]?.[0] as { durationSec?: number } | undefined;
        expect(call).toBeDefined();
        expect(call?.durationSec).toBe(600);
    });
});
