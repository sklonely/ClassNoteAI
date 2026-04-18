import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../bm25Service';

/**
 * Tests pin the RRF fusion contract. The BM25 search itself wraps
 * `minisearch` which has its own test suite; mocking its network of
 * indexing + tokenisation just to re-test the library would add
 * complexity without catching anything. The fusion function IS pure
 * and deterministic, so it's what regression-tests are needed for.
 */

describe('reciprocalRankFusion', () => {
    it('returns empty array for empty input', () => {
        expect(reciprocalRankFusion([])).toEqual([]);
    });

    it('returns single-list ranking unchanged when only one list given', () => {
        const result = reciprocalRankFusion([['a', 'b', 'c']]);
        expect(result.map((r) => r.chunkId)).toEqual(['a', 'b', 'c']);
        // Scores should be strictly descending.
        for (let i = 1; i < result.length; i++) {
            expect(result[i].score).toBeLessThan(result[i - 1].score);
        }
    });

    it('boosts chunks that appear in both lists over single-list hits', () => {
        // 'x' at rank 0 in both lists — should top the fused ranking.
        // 'a' only at rank 0 in list 1, 'b' only at rank 0 in list 2.
        const result = reciprocalRankFusion([
            ['x', 'a', 'c'],
            ['x', 'b', 'd'],
        ]);
        expect(result[0].chunkId).toBe('x');
        expect(result[0].score).toBeGreaterThan(result[1].score);
    });

    it('handles k=60 default contribution correctly', () => {
        // At rank 0, contribution = 1/(60 + 1) = 1/61 ≈ 0.0164.
        // A chunk in both lists at rank 0 gets 2/61 ≈ 0.0328.
        const result = reciprocalRankFusion([['x'], ['x']]);
        expect(result[0].score).toBeCloseTo(2 / 61, 6);
    });

    it('respects custom k parameter', () => {
        // With k=1, rank-0 contribution is 1/2 = 0.5, rank-1 is 1/3 ≈ 0.333.
        const result = reciprocalRankFusion([['a', 'b']], 1);
        expect(result[0].score).toBeCloseTo(0.5, 6);
        expect(result[1].score).toBeCloseTo(1 / 3, 6);
    });

    it('preserves chunk id uniqueness across lists', () => {
        // Same chunk at different ranks in two lists — should appear
        // exactly once in output with fused score. 'b' is at rank 1 in
        // both → 2 × 1/62 = 0.0323. 'a' and 'c' both get 1/61 + 1/63
        // = 0.0323 — numerically close enough to be within rounding
        // that order isn't stable. We just assert all three appear
        // exactly once with positive score.
        const result = reciprocalRankFusion([
            ['a', 'b', 'c'],
            ['c', 'b', 'a'],
        ]);
        const ids = result.map((r) => r.chunkId);
        expect(ids.length).toBe(3);
        expect(new Set(ids).size).toBe(3);
        for (const r of result) expect(r.score).toBeGreaterThan(0);
    });

    it('does not mutate input arrays', () => {
        const l1 = ['a', 'b'];
        const l2 = ['c', 'd'];
        reciprocalRankFusion([l1, l2]);
        expect(l1).toEqual(['a', 'b']);
        expect(l2).toEqual(['c', 'd']);
    });

    it('handles many lists (not just two) — useful for future 3-way fusion', () => {
        // Just make sure the arithmetic generalises correctly when we
        // one day add a reranker as a third source.
        const result = reciprocalRankFusion([['x'], ['x'], ['x']]);
        expect(result[0].score).toBeCloseTo(3 / 61, 6);
    });

    it('returns results sorted by score descending', () => {
        const result = reciprocalRankFusion([
            ['a', 'b', 'c', 'd', 'e'],
            ['e', 'd', 'c', 'b', 'a'],
        ]);
        for (let i = 1; i < result.length; i++) {
            expect(result[i].score).toBeLessThanOrEqual(result[i - 1].score);
        }
    });
});
