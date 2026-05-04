/**
 * Quota-failure tests for userNotesStore — Phase 7 W14.
 *
 * Free-form note text grows monotonically; long lectures are a
 * realistic quota trigger. Save must not crash the editor on failure.
 *
 * `vi.resetModules` between tests so the per-store 5s toast throttle
 * doesn't bleed across cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('userNotesStore — quota safety (W14)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('round-trips note text via localStorage normally', async () => {
        const { saveUserNotes, loadUserNotes } = await import('../userNotesStore');
        saveUserNotes('lec-notes', 'hello world');
        expect(loadUserNotes('lec-notes')).toBe('hello world');
    });

    it('does NOT throw when setItem hits QuotaExceededError', async () => {
        const { saveUserNotes } = await import('../userNotesStore');
        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            expect(() =>
                saveUserNotes('lec-quota', 'a long note string'),
            ).not.toThrow();
        } finally {
            setSpy.mockRestore();
        }
    });

    it('does NOT throw when removeItem (empty text path) hits SecurityError', async () => {
        const { saveUserNotes } = await import('../userNotesStore');
        // Pre-populate so saveUserNotes('') hits the removeItem branch.
        saveUserNotes('lec-rm', 'pre-filled');
        const rmSpy = vi
            .spyOn(localStorage, 'removeItem')
            .mockImplementation(() => {
                throw new DOMException('blocked', 'SecurityError');
            });
        try {
            expect(() => saveUserNotes('lec-rm', '')).not.toThrow();
        } finally {
            rmSpy.mockRestore();
        }
    });

    it('fires warning toast when setItem throws', async () => {
        const { saveUserNotes } = await import('../userNotesStore');
        const { toastService } = await import('../../../services/toastService');
        const toastSpy = vi.spyOn(toastService, 'warning');

        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            saveUserNotes('lec-quota-toast', 'x');
            await vi.waitFor(() => {
                expect(toastSpy).toHaveBeenCalled();
            });
        } finally {
            setSpy.mockRestore();
            toastSpy.mockRestore();
        }
    });
});
