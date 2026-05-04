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
// cp75.22 — track call order for clear vs. subscribe so tests can assert
// the start-of-session clean-up happens BEFORE the subscriber hooks up.
const subtitleCallOrder: string[] = [];
vi.mock('../subtitleService', () => ({
    subtitleService: {
        getSegments: vi.fn(() => subtitleSegments),
        getCurrentText: vi.fn(() => ''),
        subscribe: vi.fn((cb: (s: unknown) => void) => {
            subtitleCallOrder.push('subscribe');
            cb({
                segments: [],
                currentText: '',
                isRecording: false,
                isTranscribing: false,
                lastUpdateTime: Date.now(),
            });
            return () => undefined;
        }),
        // cp75.22 — clear() wipes the underlying singleton segments
        // array. recordingSessionService must call this on both session
        // boundaries so the next start doesn't inherit the previous
        // session's stale segments via the subscriber's first fire.
        clear: vi.fn(() => {
            subtitleCallOrder.push('clear');
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
        // cp75.25 P1-B: recordingSessionService.pause/resume now drives
        // these. Stub them so the existing pause/resume tests don't trip.
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
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
    subtitleCallOrder.length = 0;
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
        // Poll for background completion instead of fixed sleep.
        // cp75.17 first bumped 30→100ms after adding async getLecture +
        // segmentSections + dynamic llm/tasks import; v0.7.1 saw it still
        // flake on Windows CI under parallel load. Poll up to 5s with
        // 25ms steps so it stays fast on the happy path but doesn't
        // false-fail under heavy CPU pressure.
        const deadline = Date.now() + 5000;
        while (storageMockState.saveNoteCalls.length === 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 25));
        }
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

// ─── cp75.22 · subtitle service cleanup on session boundary ─────────────
//
// Pre cp75.22 root cause (audit 3.1 + 3.2):
//   _doStart() resets state.segments = [] AFTER attachSubtitleSubscriber()
//   ran. The subscriber callback mirrors subtitleService.segments into
//   state. subtitleService is a singleton and was never cleared between
//   sessions, so the new session's first subscribe-fire arrived with the
//   prior session's stale segments — flashed in the UI for one tick
//   before the local state reset wiped them. Likewise, stop()'s
//   cleanupListeners() unsubscribed but didn't clear the underlying
//   global segments array, so the *next* start() inherited the leftover.
//
// Fix: clear() the subtitleService singleton on BOTH boundaries —
// _doStart() before attachSubtitleSubscriber, and stop() after
// cleanupListeners.

describe('cp75.22 · subtitleService cleanup on session boundaries', () => {
    it('start() clears subtitleService BEFORE attachSubtitleSubscriber', async () => {
        const { subtitleService } = await import('../subtitleService');
        await recordingSessionService.start('c', 'lecture-1');

        // clear() was called.
        expect(subtitleService.clear).toHaveBeenCalled();

        // And it happened before the first subscribe — otherwise the
        // subscriber's initial-state fire would carry stale segments.
        const firstClearIdx = subtitleCallOrder.indexOf('clear');
        const firstSubscribeIdx = subtitleCallOrder.indexOf('subscribe');
        expect(firstClearIdx).toBeGreaterThanOrEqual(0);
        expect(firstSubscribeIdx).toBeGreaterThanOrEqual(0);
        expect(firstClearIdx).toBeLessThan(firstSubscribeIdx);
    });

    it('stop() clears subtitleService after cleanupListeners (so next start sees empty)', async () => {
        const { subtitleService } = await import('../subtitleService');
        await recordingSessionService.start('c', 'lecture-1');
        (subtitleService.clear as ReturnType<typeof vi.fn>).mockClear();
        await recordingSessionService.stop();
        // Once stop has resolved, clear must have been called as part
        // of the teardown so a future start doesn't inherit residue.
        expect(subtitleService.clear).toHaveBeenCalled();
    });

    it('back-to-back start → stop → start: second start invokes clear() again', async () => {
        const { subtitleService } = await import('../subtitleService');
        await recordingSessionService.start('c', 'lecture-1');
        await recordingSessionService.stop();
        const callsAfterFirstCycle = (subtitleService.clear as ReturnType<typeof vi.fn>)
            .mock.calls.length;
        await recordingSessionService.start('c', 'lecture-2');
        expect(
            (subtitleService.clear as ReturnType<typeof vi.fn>).mock.calls.length,
        ).toBeGreaterThan(callsAfterFirstCycle);
    });
});

// ─── cp75.22 · pause/resume elapsed math ────────────────────────────────
//
// Pre cp75.22 root cause (audit 3.3):
//   The elapsed-tick handler computed `elapsed = (Date.now() -
//   sessionStartMs) / 1000` with no pause-duration accounting. Pause for
//   5 minutes, resume → the running clock jumped 5 minutes the moment
//   the timer restarted. The user perceives this as the recording
//   "skipping ahead" by exactly the pause duration.
//
// Fix: track pauseStartedAtMs on pause(), accumulate pauseTotalMs on
// resume(), subtract from wall-clock in the tick handler.

describe('cp75.22 · pause/resume elapsed math', () => {
    it('elapsed clock excludes pause duration', async () => {
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'l');

        // Run for 60s.
        vi.setSystemTime(t0 + 60_000);
        vi.advanceTimersByTime(500); // tick once
        const beforePause = recordingSessionService.getState().elapsed;
        expect(beforePause).toBeGreaterThanOrEqual(60);
        expect(beforePause).toBeLessThan(62);

        // Pause for 60s.
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 120_000);

        // Resume; another 30s passes.
        await recordingSessionService.resume();
        vi.setSystemTime(t0 + 150_000);
        vi.advanceTimersByTime(500);

        const after = recordingSessionService.getState().elapsed;
        // Recording was live for 60s + 30s = 90s total. Wall clock
        // shows 150s but pause excluded → ~90.  We allow ±2s tolerance
        // for the 250ms tick interval plus the microtasks scattered
        // through `_doStart` / `pause` / `resume`.
        expect(after).toBeGreaterThanOrEqual(89);
        expect(after).toBeLessThanOrEqual(92);
        // Most importantly: it MUST NOT be ≥ 120, which would mean
        // pause time was not subtracted at all (the pre-cp75.22 bug).
        expect(after).toBeLessThan(120);
    });

    it('multiple pause/resume cycles correctly accumulate paused time', async () => {
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'l');

        // Cycle 1: record 10s, pause 20s.
        vi.setSystemTime(t0 + 10_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 30_000);
        await recordingSessionService.resume();

        // Cycle 2: record 10s, pause 30s.
        vi.setSystemTime(t0 + 40_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 70_000);
        await recordingSessionService.resume();

        // Final stretch: 10 more seconds of recording.
        vi.setSystemTime(t0 + 80_000);
        vi.advanceTimersByTime(500);

        const elapsed = recordingSessionService.getState().elapsed;
        // Live recording stretches: 10 + 10 + 10 = 30s. Wall = 80s,
        // total paused = 50s. Allow ±2s tolerance.
        expect(elapsed).toBeGreaterThanOrEqual(29);
        expect(elapsed).toBeLessThanOrEqual(32);
        expect(elapsed).toBeLessThan(80);
    });

    // cp75.37 · 5.2 — three-cycle pause/resume regression. The existing
    // 2-cycle test catches "totalPausedMs is plain assigned not added";
    // this 3-cycle variant additionally catches "first cycle is dropped"
    // / "last cycle is dropped" off-by-one accumulator bugs that 2
    // cycles can't disambiguate (the failing pattern would still match
    // the spec arithmetic on 2 cycles by coincidence).
    it('cp75.37 — three-cycle pause/resume correctly accumulates totalPausedMs', async () => {
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'l');

        // Cycle 1: record 30s, pause 30s.
        vi.setSystemTime(t0 + 30_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 60_000);
        await recordingSessionService.resume();

        // Cycle 2: record 30s, pause 30s.
        vi.setSystemTime(t0 + 90_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 120_000);
        await recordingSessionService.resume();

        // Cycle 3: record 30s.
        vi.setSystemTime(t0 + 150_000);
        vi.advanceTimersByTime(500);

        const elapsed = recordingSessionService.getState().elapsed;
        // Live recording stretches: 30 + 30 + 30 = 90s. Wall = 150s,
        // total paused = 60s. Allow ±2s for the 250ms tick interval.
        expect(elapsed).toBeGreaterThanOrEqual(89);
        expect(elapsed).toBeLessThanOrEqual(92);
        // Must subtract BOTH pauses, not just one (if either fold was
        // dropped, elapsed would land at ≥119, well outside our band).
        expect(elapsed).toBeLessThan(120);
    });

    // cp75.37 · 5.2 — pause-while-already-paused must not double-count
    // the pause window. The early return in pause() (status !== 'recording')
    // is what guarantees this; if a future refactor swaps the guard for
    // a setState() that also restamps pauseStartedAtMs, the SECOND pause
    // would overwrite the FIRST's timestamp and the resume() fold would
    // under-count by however long the first pause window ran.
    it('cp75.37 — pause while already paused is a no-op (idempotent)', async () => {
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'l');

        // Record 10s, pause.
        vi.setSystemTime(t0 + 10_000);
        await recordingSessionService.pause();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const internal = recordingSessionService as any;
        const firstPauseAt = internal.pauseStartedAtMs;
        expect(firstPauseAt).toBe(t0 + 10_000);

        // Advance 20s into the paused window, then "pause" again. The
        // second pause must NOT restamp pauseStartedAtMs — otherwise the
        // 20s already elapsed would silently disappear from the
        // resume() fold.
        vi.setSystemTime(t0 + 30_000);
        await recordingSessionService.pause();
        expect(internal.pauseStartedAtMs).toBe(firstPauseAt);

        // Resume at t0+40s → fold should be 30s (10s..40s), not 10s.
        vi.setSystemTime(t0 + 40_000);
        await recordingSessionService.resume();
        expect(internal.pauseStartedAtMs).toBe(null);
        expect(internal.totalPausedMs).toBe(30_000);
    });

    it('start() resets paused-time accumulators (no carry-over between sessions)', async () => {
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'lecture-1');
        vi.setSystemTime(t0 + 10_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 60_000);
        await recordingSessionService.resume();
        await recordingSessionService.stop();

        // Second session — wall-clock origin is fresh; pause carry-over
        // must not subtract from this session's elapsed.
        const t1 = t0 + 100_000;
        vi.setSystemTime(t1);
        await recordingSessionService.start('c', 'lecture-2');
        vi.setSystemTime(t1 + 30_000);
        vi.advanceTimersByTime(500);

        const elapsed = recordingSessionService.getState().elapsed;
        // Second session ran 30s with no pauses; carry-over from
        // session 1 (50s of pause) must NOT be subtracted here.
        expect(elapsed).toBeGreaterThanOrEqual(29);
        expect(elapsed).toBeLessThanOrEqual(32);
    });
});

// ─── cp75.35 · stop-while-paused folds pending pause into elapsed ───────
//
// Pre cp75.35 root cause (Audit 1):
//   cp75.22 added pauseStartedAtMs / totalPausedMs accumulation in
//   pause()/resume(). But if the user clicks 停止 while the session is
//   in `paused` state, pauseStartedAtMs is non-null at stop-time and
//   never gets folded into totalPausedMs. The final `state.elapsed`
//   computed from the last tick before pause was correct, but if any
//   code (or a regression) re-derived elapsed from
//   `(Date.now() - sessionStartMs - totalPausedMs) / 1000` after stop,
//   it would include the unfolded pause window as live recording time.
//
// Fix: at the start of stop()'s elapsed-finalisation, if
// pauseStartedAtMs is non-null, fold the pending pause window into
// totalPausedMs and clear pauseStartedAtMs.

describe('cp75.35 · stop while paused folds pending pause into elapsed', () => {
    it('stop() while paused folds the pending pause window before draining', async () => {
        // We can't keep fake timers active across the full stop()
        // pipeline (it awaits dynamic imports + persistence), but the
        // FOLD operation in stop() reads Date.now() exactly once at the
        // top of the method. Stub Date.now directly so the fold sees
        // the right "now" without us having to keep the fake timer
        // global timer queue installed.
        const t0 = 1_700_000_000_000;
        const realNow = Date.now;

        // Phase 1 — fake timers for the start + pause sequence so we
        // can drive sessionStartMs and pauseStartedAtMs to known values.
        vi.useFakeTimers();
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'lecture-1');

        // Record for 60s. We DON'T call advanceTimersByTime here because
        // it bumps Date.now() by the advance amount, which would push
        // pauseStartedAtMs off the precise t0+60_000 we want to assert
        // against below. (The elapsed-tick handler doesn't need to run
        // for this test — we're only inspecting fold math.)
        vi.setSystemTime(t0 + 60_000);

        // Pause at t=60s; never resume.
        await recordingSessionService.pause();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const internal = recordingSessionService as any;
        // Sanity: the pause start was captured at t0 + 60_000.
        expect(internal.pauseStartedAtMs).toBe(t0 + 60_000);
        const beforeFoldTotal = internal.totalPausedMs;

        // Phase 2 — switch off fake timers but stub Date.now so stop()'s
        // fold computation reads "120s from session start = 60s after
        // pause" instead of real wall clock.
        vi.useRealTimers();
        const stubbedNow = t0 + 120_000;
        const dateSpy = vi
            .spyOn(Date, 'now')
            .mockImplementationOnce(() => stubbedNow);

        await recordingSessionService.stop();

        dateSpy.mockRestore();
        // Restore in case the spy is somehow still installed.
        Date.now = realNow;

        // After stop(), the pending pause must have been folded —
        // pauseStartedAtMs cleared, totalPausedMs grew by the full 60s
        // pause window.
        expect(internal.pauseStartedAtMs).toBe(null);
        expect(internal.totalPausedMs).toBe(beforeFoldTotal + 60_000);
    });

    it('stop while not paused leaves accumulators untouched (regression)', async () => {
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'lecture-1');

        // Record 30s, pause 10s, resume — the resume() fold runs at this
        // point, so totalPausedMs == 10_000 and pauseStartedAtMs == null
        // before stop() is called.
        vi.setSystemTime(t0 + 30_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 40_000);
        await recordingSessionService.resume();
        vi.setSystemTime(t0 + 50_000);
        vi.advanceTimersByTime(500);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const internal = recordingSessionService as any;
        expect(internal.pauseStartedAtMs).toBe(null);
        expect(internal.totalPausedMs).toBe(10_000);

        vi.useRealTimers();
        await recordingSessionService.stop();

        // The fold branch is a no-op when pauseStartedAtMs is already
        // null — totalPausedMs should be unchanged from its
        // pre-stop value of 10_000.
        expect(internal.pauseStartedAtMs).toBe(null);
        expect(internal.totalPausedMs).toBe(10_000);
    });
});

// ─── cp75.35 · reset() clears pause accumulators ────────────────────────
//
// Pre cp75.35 root cause (Audit 8):
//   cp75.22 reset pauseStartedAtMs / totalPausedMs inside _doStart() —
//   but only there. If the user logs out or hits a code path that calls
//   `recordingSessionService.reset()` directly without going through a
//   clean start/stop cycle, the accumulators stay populated. A future
//   start() does eventually wipe them in _doStart(), but any code that
//   inspects the singleton between reset() and the next start() (e.g.
//   diagnostics, contract tests) would observe stale pause counters
//   that belong to the previous user.
//
// Fix: explicitly clear totalPausedMs and pauseStartedAtMs inside
// reset() too.

describe('cp75.35 · reset() clears pause accumulators', () => {
    it('after reset() pauseStartedAtMs and totalPausedMs are zero', async () => {
        // Build up some pause accumulator state from a session that
        // ends abruptly via reset (not stop) — mirrors the logout path
        // resetUserScopedState.
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'lecture-1');
        vi.setSystemTime(t0 + 10_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 70_000);
        await recordingSessionService.resume();
        // Pause again and DON'T resume (so pauseStartedAtMs is also non-null).
        vi.setSystemTime(t0 + 80_000);
        await recordingSessionService.pause();

        vi.useRealTimers();

        // Sanity: accumulators are populated before reset.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const internalBefore = recordingSessionService as any;
        expect(internalBefore.totalPausedMs).toBeGreaterThan(0);
        expect(internalBefore.pauseStartedAtMs).not.toBe(null);

        // RESET (not stop). Production: invoked from resetUserScopedState
        // on logout.
        recordingSessionService.reset();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const internalAfter = recordingSessionService as any;
        expect(internalAfter.totalPausedMs).toBe(0);
        expect(internalAfter.pauseStartedAtMs).toBe(null);
    });

    it('next session after reset() does not inherit prior pause counters', async () => {
        // Same logical scenario as the cp75.22 carry-over test, but
        // crossing a reset() (logout) boundary instead of a stop().
        vi.useFakeTimers();
        const t0 = 1_700_000_000_000;
        vi.setSystemTime(t0);
        await recordingSessionService.start('c', 'lecture-1');
        vi.setSystemTime(t0 + 10_000);
        await recordingSessionService.pause();
        vi.setSystemTime(t0 + 60_000);
        // 50s of pause built up in totalPausedMs.

        vi.useRealTimers();
        recordingSessionService.reset();

        // Brand-new session post-reset; assume the next user does not
        // pause at all.
        vi.useFakeTimers();
        const t1 = t0 + 100_000;
        vi.setSystemTime(t1);
        await recordingSessionService.start('c', 'lecture-2');
        vi.setSystemTime(t1 + 30_000);
        vi.advanceTimersByTime(500);

        const elapsed = recordingSessionService.getState().elapsed;
        // Second session ran 30s with no pauses; the pre-reset 50s
        // pause must NOT subtract from this session.
        expect(elapsed).toBeGreaterThanOrEqual(29);
        expect(elapsed).toBeLessThanOrEqual(32);
    });
});
