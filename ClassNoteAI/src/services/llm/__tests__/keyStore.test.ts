/**
 * keyStore tests · Phase 7 Sprint 1 R-1
 *
 * Covers the `clearAll()` method added so logout (R-1) can wipe every
 * provider's keys when the user signs out — the per-provider `clear()`
 * isn't enough because logout doesn't know which providers the user
 * configured.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { keyStore, clearAll } from '../keyStore';

describe('keyStore.clearAll', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('removes every keyStore-prefixed key from localStorage', async () => {
        keyStore.set('anthropic', 'API_KEY', 'sk-ant-1');
        keyStore.set('openai', 'API_KEY', 'sk-2');
        // Add an unrelated key — must NOT be removed.
        localStorage.setItem('not-key-store-key', 'preserve');

        await clearAll();

        expect(keyStore.get('anthropic', 'API_KEY')).toBe(null);
        expect(keyStore.get('openai', 'API_KEY')).toBe(null);
        expect(localStorage.getItem('not-key-store-key')).toBe('preserve');
    });

    it('handles empty store (no-op)', async () => {
        await expect(clearAll()).resolves.not.toThrow();
    });

    it('continues if removeItem throws on one key', async () => {
        keyStore.set('p', 'F', 'v');
        // Spy directly on the active localStorage mock so we exercise
        // the catch path inside clearAll. The project's vitest setup
        // installs a plain-object mock (not a Storage instance), so
        // spying on Storage.prototype would be a no-op here.
        const spy = vi
            .spyOn(localStorage, 'removeItem')
            .mockImplementation(() => {
                throw new Error('boom');
            });
        await expect(clearAll()).resolves.not.toThrow();
        spy.mockRestore();
    });
});
