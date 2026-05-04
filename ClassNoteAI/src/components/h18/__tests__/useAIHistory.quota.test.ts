/**
 * Quota-failure tests for useAIHistory — Phase 7 W14.
 *
 * useEffect persists msgs on every change. If localStorage.setItem
 * throws, React mount/update must still complete; the hook degrades
 * to in-memory-only and the user keeps chatting.
 *
 * llm + ragService are mocked because useAIHistory imports them at
 * module load.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Module-level mocks — `vi.resetModules()` re-creates fresh module instances
// per test (so the in-store toast throttle resets) but vi.mock declarations
// survive resetModules, which is exactly what we want.
vi.mock('../../../services/llm', () => ({
    chatStream: vi.fn(async function* () {
        // Empty stream — nothing flowing through; this test only
        // exercises the persistence side-effect.
    }),
}));

vi.mock('../../../services/ragService', () => ({
    ragService: {
        retrieveContext: vi.fn(async () => ({ formattedContext: '', chunks: [] })),
        retrieveCourseContext: vi.fn(async () => ({ formattedContext: '', chunks: [] })),
    },
}));

describe('useAIHistory — quota safety (W14)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('persists default intro to localStorage on first mount (normal path)', async () => {
        const { useAIHistory } = await import('../useAIHistory');
        const { result } = renderHook(() => useAIHistory());
        expect(result.current.msgs.length).toBeGreaterThan(0);
        // useEffect runs after render — read should reflect at least the intro.
        // cp75.3: per-user-scoped key.
        const raw = localStorage.getItem('h18-ai-history-v1:default_user');
        expect(raw).toBeTruthy();
    });

    it('does NOT crash on mount when localStorage.setItem throws', async () => {
        const { useAIHistory } = await import('../useAIHistory');
        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            // The mount-time useEffect persists DEFAULT_INTRO. It must
            // swallow QuotaExceededError so React doesn't tear the tree.
            expect(() => renderHook(() => useAIHistory())).not.toThrow();
        } finally {
            setSpy.mockRestore();
        }
    });

    it('keeps in-memory state usable when setItem throws', async () => {
        const { useAIHistory } = await import('../useAIHistory');
        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        try {
            const { result } = renderHook(() => useAIHistory());
            // hook still returns msgs / streaming / send / clear
            expect(result.current.msgs).toBeDefined();
            expect(typeof result.current.send).toBe('function');
            expect(typeof result.current.clear).toBe('function');
            expect(result.current.streaming).toBe(false);
        } finally {
            setSpy.mockRestore();
        }
    });
});
