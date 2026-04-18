import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockComplete } = vi.hoisted(() => ({
    mockComplete: vi.fn(),
}));

vi.mock('../registry', () => {
    const fakeProvider = {
        descriptor: { id: 'test-provider' },
        complete: mockComplete,
        listModels: async () => [{ id: 'test-model' }],
    };
    return {
        resolveActiveProvider: vi.fn(async () => fakeProvider),
    };
});

import { translateForRetrieval } from '../tasks';

describe('translateForRetrieval (cross-lingual query normalisation)', () => {
    beforeEach(() => {
        mockComplete.mockReset();
    });

    it('returns the provider translation when the call succeeds', async () => {
        mockComplete.mockResolvedValueOnce({
            content: 'What are the principles of heuristic evaluation?',
            usage: { inputTokens: 10, outputTokens: 8 },
        });

        const out = await translateForRetrieval('啟發式評估法有哪些原則？', 'en');

        expect(out).toBe('What are the principles of heuristic evaluation?');
        expect(mockComplete).toHaveBeenCalledTimes(1);
        const [args] = mockComplete.mock.calls[0];
        expect(args.messages[0].role).toBe('system');
        expect(args.messages[0].content).toContain('English');
        expect(args.messages[1]).toEqual({
            role: 'user',
            content: '啟發式評估法有哪些原則？',
        });
        // Translation should be deterministic — temperature must be 0 so the
        // same query maps to the same English string across calls (and so
        // downstream embedding caches are actually useful).
        expect(args.temperature).toBe(0);
    });

    it('strips leading/trailing whitespace on the returned translation', async () => {
        mockComplete.mockResolvedValueOnce({
            content: '   heuristic evaluation principles   \n',
            usage: {},
        });
        const out = await translateForRetrieval('啟發式評估法');
        expect(out).toBe('heuristic evaluation principles');
    });

    it('returns the original query unchanged on provider error', async () => {
        // Graceful-degradation contract: a translation failure must not
        // break the RAG pipeline. The worst case is that retrieval
        // quality drops for a single Chinese query — not a crashed
        // AI assistant panel.
        mockComplete.mockRejectedValueOnce(new Error('provider timeout'));
        const out = await translateForRetrieval('啟發式評估法', 'en');
        expect(out).toBe('啟發式評估法');
    });

    it('returns the original query if the provider returns an empty string', async () => {
        mockComplete.mockResolvedValueOnce({ content: '   \n', usage: {} });
        const out = await translateForRetrieval('啟發式評估法', 'en');
        expect(out).toBe('啟發式評估法');
    });

    it('returns the original immediately for empty input (no LLM call)', async () => {
        const out = await translateForRetrieval('', 'en');
        expect(out).toBe('');
        expect(mockComplete).not.toHaveBeenCalled();
    });
});
