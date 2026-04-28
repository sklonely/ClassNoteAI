/**
 * Quota-failure tests for inboxStateService — Phase 7 W14.
 *
 * Verifies that QuotaExceededError out of localStorage.setItem is caught
 * (no unhandled exception bubbling to caller) and that a warning toast
 * is emitted via toastService. Toast is lazy-imported in source, so we
 * await microtasks before asserting on the spy.
 *
 * Each test re-imports the store via `vi.resetModules` so the in-module
 * 5s toast cooldown doesn't bleed across cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('inboxStateService — quota safety (W14)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('writes through normally when localStorage works', async () => {
        const { setInboxDone } = await import('../inboxStateService');
        setInboxDone('inbox-id-ok');
        const raw = localStorage.getItem('classnote.inbox.states.v1');
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw!);
        expect(parsed['inbox-id-ok']?.state).toBe('done');
    });

    it('does NOT throw when localStorage.setItem hits QuotaExceededError', async () => {
        const { setInboxDone, setInboxSnooze } = await import('../inboxStateService');
        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            // setInboxDone calls persist() → safeSetItem(); a thrown error
            // here would crash the InboxRow callback that triggered it.
            expect(() => setInboxDone('inbox-id-quota')).not.toThrow();
            expect(() =>
                setInboxSnooze('inbox-id-quota-2', Date.now() + 60_000),
            ).not.toThrow();
        } finally {
            setSpy.mockRestore();
        }
    });

    it('fires a warning toast when setItem throws', async () => {
        const { setInboxDone } = await import('../inboxStateService');
        const { toastService } = await import('../toastService');
        const toastSpy = vi.spyOn(toastService, 'warning');

        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            setInboxDone('inbox-id-quota-toast');
            // Toast is lazy-imported via dynamic import → resolve microtasks.
            await vi.waitFor(() => {
                expect(toastSpy).toHaveBeenCalled();
            });
            const firstCall = toastSpy.mock.calls[0];
            expect(firstCall[0]).toMatch(/儲存空間/);
        } finally {
            setSpy.mockRestore();
            toastSpy.mockRestore();
        }
    });
});
