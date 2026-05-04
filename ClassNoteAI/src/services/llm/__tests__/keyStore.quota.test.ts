/**
 * Quota-failure tests for keyStore — Phase 7 W14.
 *
 * Saving a provider API key in private-browsing / sandboxed contexts
 * raises SecurityError. Wrap setItem/removeItem so the provider config
 * dialog doesn't blow up; surface a single warning toast.
 *
 * `vi.resetModules` between tests so the per-store 5s toast throttle
 * doesn't bleed across cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('keyStore — quota safety (W14)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('writes a key normally to localStorage', async () => {
        const { keyStore } = await import('../keyStore');
        keyStore.set('openai', 'apiKey', 'sk-test-123');
        expect(keyStore.get('openai', 'apiKey')).toBe('sk-test-123');
        expect(keyStore.has('openai', 'apiKey')).toBe(true);
    });

    it('does NOT throw when setItem hits QuotaExceededError', async () => {
        const { keyStore } = await import('../keyStore');
        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            expect(() =>
                keyStore.set('anthropic', 'apiKey', 'sk-ant-foo'),
            ).not.toThrow();
        } finally {
            setSpy.mockRestore();
        }
    });

    it('does NOT throw when removeItem hits SecurityError', async () => {
        const { keyStore } = await import('../keyStore');
        // Pre-populate so we have something to clear.
        keyStore.set('openai', 'apiKey', 'sk-x');
        const rmSpy = vi
            .spyOn(localStorage, 'removeItem')
            .mockImplementation(() => {
                throw new DOMException('blocked', 'SecurityError');
            });
        try {
            expect(() => keyStore.clear('openai', 'apiKey')).not.toThrow();
        } finally {
            rmSpy.mockRestore();
        }
    });

    it('fires warning toast when setItem throws', async () => {
        const { keyStore } = await import('../keyStore');
        const { toastService } = await import('../../toastService');
        const toastSpy = vi.spyOn(toastService, 'warning');

        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            keyStore.set('openai', 'apiKey', 'sk-toast');
            await vi.waitFor(() => {
                expect(toastSpy).toHaveBeenCalled();
            });
        } finally {
            setSpy.mockRestore();
            toastSpy.mockRestore();
        }
    });
});
