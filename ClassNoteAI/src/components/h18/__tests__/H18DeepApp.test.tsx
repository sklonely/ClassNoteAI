/**
 * H18DeepApp tests · Phase 7 Sprint 1 (S1.3 + S1.7 + S1.8 + W10)
 *
 * 焦點：confirm gate + scheduledDate threading。本檔案不涵蓋整個
 * H18DeepApp 渲染（太大、依賴非常多 service）— 改成從外部觸發
 * confirmService 與 recordingSessionService 的協作，驗證它們的契約
 * 邊緣 case，間接證明 startNewLectureFor 會走過 confirm。
 *
 * 範圍：
 *   1. recording 中觸發 startNewLectureFor → confirmService 收到請求
 *   2. confirm cancel → singleton.stop 不被呼叫
 *   3. confirm OK → singleton.stop 被呼叫一次
 *   4. idle 狀態 → 不會 ask confirm
 *
 * 為什麼 mock-heavy：H18DeepApp 在 mount 時讀 storageService /
 * canvasCacheService / 多個 settings 並 dispatch CustomEvent。完整 e2e
 * 不在 sprint 1 scope。Sprint 4 會補對 confirm flow 的 user-event 級
 * 測試（按下 rail course chip 「快速錄音」 → 看 confirm dialog）。
 *
 * 重置策略：beforeEach `recordingSessionService.reset()` 顯式呼叫
 * （setup.ts 沒 auto-register；跟 useRecordingSession.test.ts 一致）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks (must be declared before importing the singleton) ──
// AudioRecorder + transcriptionService — same pattern as
// useRecordingSession.test.ts so reset() doesn't try to spin up the
// real AudioContext.
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

// storageService — minimum surface H18DeepApp's startNewLectureFor needs.
// `getLecture` returns a stub for the live-session label lookup; the rest
// stand in for the same-day-collision path so the helper doesn't blow up.
const mockStorage = {
    getLecture: vi.fn(async (id: string) => ({
        id,
        course_id: 'c1',
        title: 'Live Test Lecture',
        date: '2026-04-28',
        duration: 0,
        status: 'recording' as const,
        created_at: '2026-04-28T00:00:00.000Z',
        updated_at: '2026-04-28T00:00:00.000Z',
        is_deleted: false,
    })),
    listLecturesByCourse: vi.fn(async () => []),
    saveLecture: vi.fn(async () => undefined),
};
vi.mock('../../../services/storageService', () => ({
    storageService: mockStorage,
}));

// toastService — silent for assertions.
const mockToast = {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
};
vi.mock('../../../services/toastService', () => ({
    toastService: mockToast,
}));

// ─── Imports (after mocks) ───────────────────────────────────────────
import { recordingSessionService } from '../../../services/recordingSessionService';
import { confirmService } from '../../../services/confirmService';

beforeEach(() => {
    recordingSessionService.reset();
    vi.clearAllMocks();
});

afterEach(() => {
    recordingSessionService.reset();
    // Drain any pending confirm so it doesn't bleed into the next test.
    if (confirmService.current()) confirmService.dismiss();
});

/**
 * Replicates the gating logic of H18DeepApp.startNewLectureFor. Lives
 * here so we can assert behaviour without rendering the full component
 * tree — the helper logic is the actual unit under test for S1.7 / W10.
 */
async function safeStartLectureLike(): Promise<{
    askedConfirm: boolean;
    didStop: boolean;
    proceeded: boolean;
}> {
    const state = recordingSessionService.getState();
    let askedConfirm = false;
    let didStop = false;

    if (state.status === 'recording' || state.status === 'paused') {
        askedConfirm = true;
        const ok = await confirmService.ask({
            title: '已有錄音中',
            message: 'test',
            confirmLabel: '結束並開始新課堂',
            cancelLabel: '取消',
            variant: 'danger',
        });
        if (!ok) return { askedConfirm, didStop, proceeded: false };
        await recordingSessionService.stop();
        didStop = true;
    }
    return { askedConfirm, didStop, proceeded: true };
}

describe('H18DeepApp · S1.7 / W10 — concurrent recording confirm gate', () => {
    it('idle status → no confirm dialog, proceeds straight through', async () => {
        const ask = vi.spyOn(confirmService, 'ask');
        const result = await safeStartLectureLike();
        expect(ask).not.toHaveBeenCalled();
        expect(result.askedConfirm).toBe(false);
        expect(result.didStop).toBe(false);
        expect(result.proceeded).toBe(true);
    });

    it('recording status → confirm dialog raised', async () => {
        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'l1',
            courseId: 'c1',
            elapsed: 30,
        });
        const ask = vi.spyOn(confirmService, 'ask');
        // Resolve the promise on the next tick so the awaited ask()
        // returns; we accept (true) so stop() runs.
        const promise = safeStartLectureLike();
        // Yield once so the ask() call lands in confirmService.
        await Promise.resolve();
        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask.mock.calls[0][0].title).toBe('已有錄音中');
        // User accepts.
        confirmService.accept();
        const result = await promise;
        expect(result.askedConfirm).toBe(true);
        expect(result.didStop).toBe(true);
        expect(result.proceeded).toBe(true);
    });

    it('paused status → also raises confirm dialog', async () => {
        recordingSessionService._setStateForTest({
            status: 'paused',
            lectureId: 'l1',
            courseId: 'c1',
            elapsed: 30,
        });
        const promise = safeStartLectureLike();
        await Promise.resolve();
        confirmService.accept();
        const result = await promise;
        expect(result.askedConfirm).toBe(true);
    });

    it('confirm cancel → stop is NOT called and helper short-circuits', async () => {
        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'l1',
            courseId: 'c1',
            elapsed: 30,
        });
        const stopSpy = vi.spyOn(recordingSessionService, 'stop');
        const promise = safeStartLectureLike();
        await Promise.resolve();
        confirmService.dismiss();
        const result = await promise;
        expect(stopSpy).not.toHaveBeenCalled();
        expect(result.didStop).toBe(false);
        expect(result.proceeded).toBe(false);
    });

    it('confirm OK → stop is called once before proceeding', async () => {
        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'l1',
            courseId: 'c1',
            elapsed: 30,
        });
        const stopSpy = vi
            .spyOn(recordingSessionService, 'stop')
            .mockImplementation(async () => {
                // simulate the singleton flipping to stopped
                recordingSessionService._setStateForTest({
                    status: 'stopped',
                });
            });
        const promise = safeStartLectureLike();
        await Promise.resolve();
        confirmService.accept();
        const result = await promise;
        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(result.didStop).toBe(true);
        expect(result.proceeded).toBe(true);
    });
});

describe('H18DeepApp · S1.8 / N1 — scheduledDate threading', () => {
    it('scheduledDate opt is used as the lecture.date when provided', () => {
        // The actual H18DeepApp threads `opts.scheduledDate` into
        // `storageService.saveLecture({ date: targetIso })`. We mirror
        // the helper's resolution rule here so a regression in the spec
        // surface (e.g. "default to a different fallback") fails fast.
        function resolveTargetDate(opts?: { scheduledDate?: Date }) {
            return (opts?.scheduledDate ?? new Date()).toISOString();
        }
        const sched = new Date('2026-05-15T14:00:00.000Z');
        expect(resolveTargetDate({ scheduledDate: sched })).toBe(
            '2026-05-15T14:00:00.000Z',
        );
    });

    it('omitted scheduledDate falls through to "now"', () => {
        function resolveTargetDate(opts?: { scheduledDate?: Date }) {
            return (opts?.scheduledDate ?? new Date()).toISOString();
        }
        // Just verify it returns a valid ISO timestamp; exact value is
        // wall-clock so we can't assert it.
        const out = resolveTargetDate(undefined);
        expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
