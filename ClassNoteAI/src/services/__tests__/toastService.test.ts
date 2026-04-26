import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toastService } from '../toastService';

describe('toastService', () => {
    beforeEach(() => {
        toastService.clear();
    });

    it('delivers the current list to new subscribers immediately', () => {
        toastService.info('already here');
        const received: unknown[][] = [];
        toastService.subscribe((list) => received.push(list.slice()));
        // The subscribe callback runs synchronously with the current
        // snapshot — important so a late-mounting <ToastContainer>
        // doesn't miss toasts that fired during its React setup.
        expect(received.length).toBe(1);
        expect((received[0] as { message: string }[])[0].message).toBe('already here');
    });

    it('notifies subscribers on show and dismiss', () => {
        const listener = vi.fn();
        toastService.subscribe(listener);
        listener.mockClear();

        const id = toastService.success('done');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0][0].message).toBe('done');
        expect(listener.mock.calls[0][0][0].type).toBe('success');

        toastService.dismiss(id);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls[1][0]).toEqual([]);
    });

    it('auto-dismisses after the default duration (2s for info)', () => {
        vi.useFakeTimers();
        try {
            const listener = vi.fn();
            toastService.subscribe(listener);
            listener.mockClear();

            toastService.info('briefly');
            expect(listener).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(2_000);
            expect(listener).toHaveBeenCalledTimes(2);
            expect(listener.mock.calls[1][0]).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('errors get a longer default duration than info', () => {
        vi.useFakeTimers();
        try {
            const listener = vi.fn();
            toastService.subscribe(listener);
            listener.mockClear();

            toastService.error('boom');
            // At 2000ms an info toast would be gone, but the error
            // still has ~3s left — proves the defaults really differ.
            vi.advanceTimersByTime(2_000);
            const middleList = listener.mock.calls[listener.mock.calls.length - 1][0];
            expect(middleList.length).toBe(1);

            vi.advanceTimersByTime(3_500); // total 5500 > 5000 error default
            const finalList = listener.mock.calls[listener.mock.calls.length - 1][0];
            expect(finalList).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('durationMs: 0 means "pin until dismissed"', () => {
        vi.useFakeTimers();
        try {
            const listener = vi.fn();
            toastService.subscribe(listener);
            listener.mockClear();

            toastService.show({ message: 'sticky', durationMs: 0 });
            vi.advanceTimersByTime(60_000);
            // Only one notification (the show); no auto-dismiss fired.
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener.mock.calls[0][0].length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('dismissing an unknown id is a no-op', () => {
        const listener = vi.fn();
        toastService.subscribe(listener);
        listener.mockClear();
        toastService.dismiss(99_999);
        expect(listener).not.toHaveBeenCalled();
    });

    it('each show() returns a unique id usable for manual dismiss', () => {
        const id1 = toastService.info('a');
        const id2 = toastService.info('b');
        expect(id1).not.toBe(id2);
        toastService.dismiss(id1);
        // Only id2 remains
        const listener = vi.fn();
        toastService.subscribe(listener);
        const snap = listener.mock.calls[0][0];
        expect(snap.length).toBe(1);
        expect(snap[0].id).toBe(id2);
    });

    it('detail field is preserved through the snapshot', () => {
        toastService.show({ message: 'top', detail: 'sub', type: 'success' });
        const listener = vi.fn();
        toastService.subscribe(listener);
        const snap = listener.mock.calls[0][0];
        expect(snap[0].detail).toBe('sub');
    });

    // v0.7.0 H18 — toast.durationMs surfaced + pauseAll/resumeAll for
    // hover-pause behavior in the new container.
    describe('v0.7.0 surfaces durationMs + supports pause/resume', () => {
        it('toast.durationMs reflects the actual scheduled duration', () => {
            const listener = vi.fn();
            toastService.subscribe(listener);
            listener.mockClear();

            toastService.info('a');
            expect(listener.mock.calls[0][0][0].durationMs).toBe(2_000);

            toastService.error('b');
            expect(listener.mock.calls[1][0].length).toBe(2);
            const errorToast = listener.mock.calls[1][0].find(
                (t: { message: string }) => t.message === 'b',
            );
            expect(errorToast.durationMs).toBe(5_000);

            toastService.show({ message: 'c', durationMs: 0 });
            const stickyToast = listener.mock.calls[2][0].find(
                (t: { message: string }) => t.message === 'c',
            );
            expect(stickyToast.durationMs).toBe(0);
        });

        it('pauseAll prevents scheduled timers from firing', () => {
            vi.useFakeTimers();
            try {
                const listener = vi.fn();
                toastService.subscribe(listener);
                listener.mockClear();

                toastService.info('paused');
                toastService.pauseAll();
                vi.advanceTimersByTime(10_000); // 遠超 2s default
                // 仍只有 show 那一次 notify，沒被 dismiss
                expect(listener).toHaveBeenCalledTimes(1);
                expect(listener.mock.calls[0][0].length).toBe(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('resumeAll re-schedules with remaining time', () => {
            vi.useFakeTimers();
            try {
                const listener = vi.fn();
                toastService.subscribe(listener);
                listener.mockClear();

                toastService.info('resume me');
                vi.advanceTimersByTime(800); // 經過 800ms (剩 1200ms)
                toastService.pauseAll();
                vi.advanceTimersByTime(60_000); // 暫停期間時間流逝不該影響
                expect(listener).toHaveBeenCalledTimes(1); // 還沒被 dismiss

                toastService.resumeAll();
                vi.advanceTimersByTime(1_300); // 過 1200ms remaining + 100ms 緩衝
                expect(listener.mock.calls[listener.mock.calls.length - 1][0]).toEqual([]);
            } finally {
                vi.useRealTimers();
            }
        });

        it('resumeAll does NOT re-schedule sticky toasts (durationMs=0)', () => {
            vi.useFakeTimers();
            try {
                const listener = vi.fn();
                toastService.subscribe(listener);
                listener.mockClear();

                toastService.show({ message: 'sticky', durationMs: 0 });
                toastService.pauseAll();
                toastService.resumeAll();
                vi.advanceTimersByTime(60_000);
                expect(listener).toHaveBeenCalledTimes(1);
                expect(listener.mock.calls[0][0].length).toBe(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('pauseAll twice is idempotent', () => {
            vi.useFakeTimers();
            try {
                toastService.info('test');
                toastService.pauseAll();
                toastService.pauseAll();
                vi.advanceTimersByTime(10_000);
                // 沒被 dismiss = ok
                const listener = vi.fn();
                toastService.subscribe(listener);
                expect(listener.mock.calls[0][0].length).toBe(1);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
