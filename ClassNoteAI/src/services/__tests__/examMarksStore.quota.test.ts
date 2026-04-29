/**
 * Quota-failure tests for examMarksStore — Phase 7 W14.
 *
 * The 「⚑ 標記考點」 button can fire mid-recording; if it crashes the
 * caller, the user loses their place in the lecture. Wrap setItem and
 * confirm a warning toast surfaces the failure instead.
 *
 * `vi.resetModules` between tests so the per-store 5s toast throttle
 * doesn't bleed across cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('examMarksStore — quota safety (W14)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('persists a mark normally to localStorage', async () => {
        const { addExamMark } = await import('../examMarksStore');
        addExamMark('lec-1', { elapsedSec: 30, text: 'foo', markedAtMs: 1 });
        // cp75.3: key is scoped per user. Tests run unauthenticated so
        // authService.getUserIdSegment() returns 'default_user'.
        const stored = JSON.parse(
            localStorage.getItem('classnote-exam-marks-v1:default_user:lec-1') ?? '[]',
        );
        expect(stored).toHaveLength(1);
        expect(stored[0].elapsedSec).toBe(30);
    });

    it('does NOT throw when setItem hits QuotaExceededError', async () => {
        const { addExamMark, getExamMarks } = await import('../examMarksStore');
        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            // addExamMark must return cleanly — caller (RecordingPage 的 ⚑
            // 按鈕 onClick) 不應 see exception bubble。
            expect(() =>
                addExamMark('lec-quota', {
                    elapsedSec: 12,
                    text: 'bar',
                    markedAtMs: 2,
                }),
            ).not.toThrow();
        } finally {
            setSpy.mockRestore();
        }
        // getItem 沒被 mock — 沒寫進去就 empty (預期 fail-safe behavior)。
        expect(getExamMarks('lec-quota')).toEqual([]);
    });

    it('fires warning toast when setItem throws', async () => {
        const { addExamMark } = await import('../examMarksStore');
        const { toastService } = await import('../toastService');
        const toastSpy = vi.spyOn(toastService, 'warning');

        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            addExamMark('lec-quota-toast', {
                elapsedSec: 5,
                text: '',
                markedAtMs: 3,
            });
            await vi.waitFor(() => {
                expect(toastSpy).toHaveBeenCalled();
            });
        } finally {
            setSpy.mockRestore();
            toastSpy.mockRestore();
        }
    });
});
