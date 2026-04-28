/**
 * App close-request flow — Phase 7 Sprint 1 S1.10.
 *
 * Covers the V4 流程 (PHASE-7-PLAN §8.3):
 *   - idle / stopped → 不 preventDefault, 直接放行
 *   - recording / paused → confirmService.ask + preventDefault
 *   - confirm cancel → mustFinalizeSync 不執行, window 不關
 *   - confirm OK → mustFinalizeSync → toast.success → window.close
 *
 * We don't mount the full App (login / setup / boot 太貴 + 帶一堆 unrelated
 * mocks)；改測 export 出來的 handleCloseRequest pure function。它收一個
 * deps bag 把 confirmService / toast / recordingSessionService / window 都
 * 注入進去，所以 mocking 就是 vi.fn() 一把。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// pdfjs-dist references browser-only globals (DOMMatrix) at module load.
// App.tsx → ragService → pdfToImageService transitively imports it, so
// stub it before App's module factory runs.
vi.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn(() => ({
        promise: Promise.reject(new Error('not used in App.close tests')),
    })),
}));

import { handleCloseRequest, type CloseRequestDeps } from '../App';
import type { RecordingSessionState } from '../services/recordingSessionService';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeState(patch: Partial<RecordingSessionState> = {}): RecordingSessionState {
    return {
        status: 'idle',
        lectureId: undefined,
        courseId: undefined,
        segments: [],
        currentText: '',
        elapsed: 0,
        stopPhase: undefined,
        sessionStartMs: undefined,
        error: undefined,
        ...patch,
    };
}

interface DepsState {
    state: RecordingSessionState;
    confirmAnswer: boolean;
    finalizeResult: boolean;
}

function makeDeps(initial: DepsState): {
    deps: CloseRequestDeps;
    spies: {
        getState: ReturnType<typeof vi.fn>;
        mustFinalizeSync: ReturnType<typeof vi.fn>;
        confirmAsk: ReturnType<typeof vi.fn>;
        toastSuccess: ReturnType<typeof vi.fn>;
        toastWarning: ReturnType<typeof vi.fn>;
        windowClose: ReturnType<typeof vi.fn>;
        sleep: ReturnType<typeof vi.fn>;
    };
} {
    const getState = vi.fn(() => initial.state);
    const mustFinalizeSync = vi.fn(async () => initial.finalizeResult);
    const confirmAsk = vi.fn(async () => initial.confirmAnswer);
    const toastSuccess = vi.fn();
    const toastWarning = vi.fn();
    const windowClose = vi.fn(async () => undefined);
    // Sleep is injected so tests don't actually wait 600ms.
    const sleep = vi.fn(async (_ms: number) => undefined);

    return {
        deps: {
            recordingSession: {
                getState,
                mustFinalizeSync,
            },
            confirm: { ask: confirmAsk },
            toast: { success: toastSuccess, warning: toastWarning },
            win: { close: windowClose },
            sleep,
        },
        spies: {
            getState,
            mustFinalizeSync,
            confirmAsk,
            toastSuccess,
            toastWarning,
            windowClose,
            sleep,
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('handleCloseRequest — V4 close flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('idle 狀態 → 不 preventDefault, 不 confirm, 不 finalize', async () => {
        const { deps, spies } = makeDeps({
            state: makeState({ status: 'idle' }),
            confirmAnswer: false,
            finalizeResult: true,
        });
        const event = { preventDefault: vi.fn() };

        await handleCloseRequest(event, deps);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(spies.confirmAsk).not.toHaveBeenCalled();
        expect(spies.mustFinalizeSync).not.toHaveBeenCalled();
        expect(spies.windowClose).not.toHaveBeenCalled();
    });

    it('stopped 狀態 → 也不 preventDefault, 直接放行', async () => {
        const { deps, spies } = makeDeps({
            state: makeState({ status: 'stopped' }),
            confirmAnswer: false,
            finalizeResult: true,
        });
        const event = { preventDefault: vi.fn() };

        await handleCloseRequest(event, deps);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(spies.confirmAsk).not.toHaveBeenCalled();
        expect(spies.mustFinalizeSync).not.toHaveBeenCalled();
    });

    it('recording 狀態 → confirmService.ask 被呼叫 + event.preventDefault 被呼叫', async () => {
        const { deps, spies } = makeDeps({
            state: makeState({
                status: 'recording',
                lectureId: 'lec-1',
                courseId: 'course-1',
                elapsed: 125, // ~2 min
            }),
            confirmAnswer: false, // cancel — keeps test focused on prompt
            finalizeResult: true,
        });
        const event = { preventDefault: vi.fn() };

        await handleCloseRequest(event, deps);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(spies.confirmAsk).toHaveBeenCalledTimes(1);
        // Title / message 應該包含分鐘數 (2 min)
        const askPayload = spies.confirmAsk.mock.calls[0][0];
        expect(askPayload.title).toContain('正在錄音');
        expect(askPayload.message).toMatch(/2\s*分鐘/);
        expect(askPayload.variant).toBe('danger');
    });

    it('paused 狀態 → 跟 recording 一樣會 confirm + preventDefault', async () => {
        const { deps, spies } = makeDeps({
            state: makeState({
                status: 'paused',
                lectureId: 'lec-1',
                courseId: 'course-1',
                elapsed: 60,
            }),
            confirmAnswer: false,
            finalizeResult: true,
        });
        const event = { preventDefault: vi.fn() };

        await handleCloseRequest(event, deps);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(spies.confirmAsk).toHaveBeenCalledTimes(1);
    });

    it('confirm cancel → mustFinalizeSync 不被呼叫, window 不 close', async () => {
        const { deps, spies } = makeDeps({
            state: makeState({
                status: 'recording',
                lectureId: 'lec-1',
                courseId: 'course-1',
                elapsed: 30,
            }),
            confirmAnswer: false,
            finalizeResult: true,
        });
        const event = { preventDefault: vi.fn() };

        await handleCloseRequest(event, deps);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(spies.confirmAsk).toHaveBeenCalled();
        expect(spies.mustFinalizeSync).not.toHaveBeenCalled();
        expect(spies.toastSuccess).not.toHaveBeenCalled();
        expect(spies.windowClose).not.toHaveBeenCalled();
    });

    it('confirm OK → mustFinalizeSync 被呼叫 → toast.success 被呼叫 → window.close 被呼叫', async () => {
        const { deps, spies } = makeDeps({
            state: makeState({
                status: 'recording',
                lectureId: 'lec-1',
                courseId: 'course-1',
                elapsed: 180,
            }),
            confirmAnswer: true,
            finalizeResult: true,
        });
        const event = { preventDefault: vi.fn() };

        await handleCloseRequest(event, deps);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(spies.confirmAsk).toHaveBeenCalledTimes(1);
        expect(spies.mustFinalizeSync).toHaveBeenCalledTimes(1);
        expect(spies.toastSuccess).toHaveBeenCalledTimes(1);
        expect(spies.toastWarning).not.toHaveBeenCalled();
        expect(spies.windowClose).toHaveBeenCalledTimes(1);
        // 順序：先 toast 後 close (sleep 在中間)
        expect(spies.sleep).toHaveBeenCalled();
    });

    it('confirm OK 但 finalize 失敗 → toast.warning, 仍然 close', async () => {
        const { deps, spies } = makeDeps({
            state: makeState({
                status: 'recording',
                lectureId: 'lec-1',
                courseId: 'course-1',
                elapsed: 90,
            }),
            confirmAnswer: true,
            finalizeResult: false, // finalize 失敗
        });
        const event = { preventDefault: vi.fn() };

        await handleCloseRequest(event, deps);

        expect(spies.mustFinalizeSync).toHaveBeenCalledTimes(1);
        expect(spies.toastSuccess).not.toHaveBeenCalled();
        expect(spies.toastWarning).toHaveBeenCalledTimes(1);
        // 還是要關 — 使用者已經點 OK 了，不關他會懵
        expect(spies.windowClose).toHaveBeenCalledTimes(1);
    });
});
