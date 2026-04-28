/**
 * H18RecordingPage tests · Phase 7 Sprint 1 (S1.4)
 *
 * 驗證 H18RecordingPage 是 singleton thin reader 的正確消費者：
 *   1. mount 時讀 singleton state (idle / recording 各種)
 *   2. unmount 時不呼叫 singleton.stop() — 切頁不停錄音
 *   3. stopPhase 變化時 transport bar 顯示對應 hint
 *   4. status='paused' 時顯示「PAUSED」徽章
 *   5. stopPhase='failed' 時顯示錯誤狀態
 *
 * AudioRecorder + transcriptionService + storageService 全 mock 掉，
 * 避免 mount 時跑真 AudioContext / Tauri invoke。subtitleService 用真，
 * 但 beforeEach .clear()。
 *
 * Reset 策略：beforeEach 顯式 `recordingSessionService.reset()` 跟 Sprint 0
 * S0.14 妥協方案一致（singleton 沒 auto-register reset）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ─── Module mocks (must be declared before importing component) ──
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

// storageService — return canned lecture / course / settings.
vi.mock('../../../services/storageService', () => ({
    storageService: {
        getLecture: vi.fn(async () => ({
            id: 'L1',
            course_id: 'C1',
            title: 'Test Lecture',
            date: '2026-04-28',
            duration: 0,
            status: 'completed',
            created_at: '2026-04-28T00:00:00.000Z',
            updated_at: '2026-04-28T00:00:00.000Z',
            is_deleted: false,
        })),
        getCourse: vi.fn(async () => ({
            id: 'C1',
            user_id: 'user-1',
            title: 'Test Course',
            created_at: '2026-04-28T00:00:00.000Z',
            updated_at: '2026-04-28T00:00:00.000Z',
            is_deleted: false,
        })),
        getAppSettings: vi.fn(async () => ({
            appearance: { recordingLayout: 'A' },
        })),
        saveAppSettings: vi.fn(async () => undefined),
        saveLecture: vi.fn(async () => undefined),
        saveSubtitles: vi.fn(async () => undefined),
    },
}));

// toastService — silent.
vi.mock('../../../services/toastService', () => ({
    toastService: {
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
    },
}));

// fileService — Import 按鈕用，不在這個測試範圍內觸發。
vi.mock('../../../services/fileService', () => ({
    selectPDFFile: vi.fn(async () => null),
}));

// FloatingNotesPanel — heavy markdown editor，無關。
vi.mock('../FloatingNotesPanel', () => ({
    default: () => null,
}));

// examMarksStore — 標記考點不在測試範圍。
vi.mock('../../../services/examMarksStore', () => ({
    addExamMark: vi.fn(),
    getExamMarks: vi.fn(() => []),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────
import H18RecordingPage from '../H18RecordingPage';
import { recordingSessionService } from '../../../services/recordingSessionService';
import { subtitleService } from '../../../services/subtitleService';
import { confirmService } from '../../../services/confirmService';

beforeEach(() => {
    recordingSessionService.reset();
    subtitleService.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    recordingSessionService.reset();
    // Drain any pending confirm so it doesn't bleed into the next test.
    if (confirmService.current()) confirmService.dismiss();
});

/** Drain async tasks queued by `useEffect` setState calls so DOM has the
 *  latest state. The component awaits Promise.all(getLecture/getCourse) at
 *  mount which is two microtasks — flush both. */
async function flushAsync() {
    // Two awaits: one for the inner Promise.all resolution, one for the
    // `setState` triggered re-render to flush.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
}

describe('H18RecordingPage — singleton state on mount', () => {
    it('mount when singleton status=idle → renders idle UI (start button + empty subtitle hint)', async () => {
        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // Idle 狀態 transport 按鈕文字
        expect(
            screen.getByRole('button', { name: /開始錄音/ }),
        ).toBeInTheDocument();
        // 字幕區的提示
        expect(
            screen.getByText(/開始錄音後 Parakeet 會即時轉錄/),
        ).toBeInTheDocument();
    });

    it('mount when singleton status=recording → renders recording UI + elapsed', async () => {
        // Pre-flip singleton before mount so the hook reads it on first render.
        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 65, // → "01:05"
            sessionStartMs: Date.now() - 65_000,
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // Transport button while recording shows "暫停"
        expect(screen.getByRole('button', { name: '暫停' })).toBeInTheDocument();
        // Elapsed format MM:SS in transport indicator
        expect(screen.getAllByText('01:05').length).toBeGreaterThan(0);
    });

    it('mount when singleton status=paused → renders PAUSED tag + 繼續錄 button', async () => {
        recordingSessionService._setStateForTest({
            status: 'paused',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 30,
            sessionStartMs: Date.now() - 30_000,
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // PAUSED hero badge
        expect(screen.getByLabelText('已暫停')).toBeInTheDocument();
        // Transport 按鈕在 paused 狀態文字 = "繼續錄"
        expect(
            screen.getByRole('button', { name: '繼續錄' }),
        ).toBeInTheDocument();
    });
});

describe('H18RecordingPage — unmount does NOT stop singleton', () => {
    it('unmount while singleton status=recording → singleton stays recording (no stop call)', async () => {
        const stopSpy = vi.spyOn(recordingSessionService, 'stop');

        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 10,
            sessionStartMs: Date.now() - 10_000,
        });

        const { unmount } = render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        unmount();
        await flushAsync();

        // 切頁不停錄音 — singleton.stop 不應被自動觸發
        expect(stopSpy).not.toHaveBeenCalled();
        // 且 singleton state 仍 'recording'
        expect(recordingSessionService.getState().status).toBe('recording');
    });
});

describe('H18RecordingPage — stopPhase progress hints', () => {
    it('stopPhase=transcribe → 顯示「正在收尾字幕…」', async () => {
        recordingSessionService._setStateForTest({
            status: 'stopping',
            stopPhase: 'transcribe',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(screen.getByText(/正在收尾字幕/)).toBeInTheDocument();
    });

    it('stopPhase=segment → 顯示「正在儲存錄音…」', async () => {
        recordingSessionService._setStateForTest({
            status: 'stopping',
            stopPhase: 'segment',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(screen.getByText(/正在儲存錄音/)).toBeInTheDocument();
    });

    it('stopPhase=index → 顯示「建立字幕索引…」', async () => {
        recordingSessionService._setStateForTest({
            status: 'stopping',
            stopPhase: 'index',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(screen.getByText(/建立字幕索引/)).toBeInTheDocument();
    });

    it('stopPhase=summary → 顯示「生成摘要中（可離開）…」', async () => {
        recordingSessionService._setStateForTest({
            status: 'stopping',
            stopPhase: 'summary',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(screen.getByText(/生成摘要中/)).toBeInTheDocument();
    });

    it('stopPhase=failed → 顯示「儲存失敗 · 已嘗試保留現有字幕」', async () => {
        recordingSessionService._setStateForTest({
            status: 'stopped',
            stopPhase: 'failed',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
            error: 'pipeline crashed',
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(screen.getByText(/儲存失敗/)).toBeInTheDocument();
    });

    it('stopPhase=done → 不顯示任何 progress hint', async () => {
        recordingSessionService._setStateForTest({
            status: 'stopped',
            stopPhase: 'done',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // 'done' 不該出現任何進度文案 (transcribe / segment / index / summary / failed)
        expect(screen.queryByText(/正在收尾字幕/)).toBeNull();
        expect(screen.queryByText(/正在儲存錄音/)).toBeNull();
        expect(screen.queryByText(/建立字幕索引/)).toBeNull();
        expect(screen.queryByText(/生成摘要中/)).toBeNull();
        expect(screen.queryByText(/儲存失敗/)).toBeNull();
    });
});

describe('H18RecordingPage · S3h — 結束按鈕 confirm gate', () => {
    it('結束按鈕 → 顯示 confirm dialog (走 confirmService.ask)', async () => {
        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });
        const askSpy = vi.spyOn(confirmService, 'ask');

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        const stopBtn = screen.getByRole('button', { name: /結束.*儲存/ });
        stopBtn.click();
        // Yield once so the ask() lands in confirmService.
        await Promise.resolve();

        expect(askSpy).toHaveBeenCalledTimes(1);
        const req = askSpy.mock.calls[0][0];
        expect(req.title).toBe('結束錄音？');
        expect(req.confirmLabel).toBe('結束');
        expect(req.cancelLabel).toBe('繼續錄音');
    });

    it('confirm cancel → 不呼叫 session.stop（仍在錄音）', async () => {
        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });
        const stopSpy = vi
            .spyOn(recordingSessionService, 'stop')
            .mockResolvedValue();

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        screen.getByRole('button', { name: /結束.*儲存/ }).click();
        // Yield so handleStop awaits confirmService.ask().
        await Promise.resolve();
        expect(confirmService.current()).not.toBeNull();

        // 使用者按「繼續錄音」 → dismiss → handleStop 短路。
        confirmService.dismiss();
        await Promise.resolve();
        await Promise.resolve();

        expect(stopSpy).not.toHaveBeenCalled();
    });

    it('confirm OK → 真的 session.stop()', async () => {
        recordingSessionService._setStateForTest({
            status: 'recording',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });
        const stopSpy = vi
            .spyOn(recordingSessionService, 'stop')
            .mockResolvedValue();

        render(
            <H18RecordingPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        screen.getByRole('button', { name: /結束.*儲存/ }).click();
        await Promise.resolve();
        expect(confirmService.current()).not.toBeNull();

        // 使用者按「結束」 → accept → handleStop 走完 session.stop()。
        confirmService.accept();
        // Two ticks: one for await ask() to resolve, one for await session.stop().
        await Promise.resolve();
        await Promise.resolve();

        expect(stopSpy).toHaveBeenCalledTimes(1);
    });
});
