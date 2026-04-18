import { describe, it, expect } from 'vitest';
import { computeWer } from '../asr-wer';
import { reciprocalRank, recallAt } from '../rag-mrr';

/**
 * Pin the pure math used by the nightly eval harness so silent drift
 * in the scoring function can't make metrics look better/worse than
 * they are. Every line of this file corresponds to the standard
 * definition of the metric; if it ever fails, something changed in
 * the math, not in the app.
 */

describe('computeWer (word error rate)', () => {
    it('is 0 for identical strings', () => {
        expect(computeWer('the cat sat', 'the cat sat')).toBe(0);
    });

    it('counts a single substitution as 1/N', () => {
        expect(computeWer('the cat sat', 'the dog sat')).toBeCloseTo(1 / 3, 5);
    });

    it('counts a deletion', () => {
        expect(computeWer('the cat sat on mat', 'the cat sat on')).toBeCloseTo(1 / 5, 5);
    });

    it('counts an insertion', () => {
        expect(computeWer('hello world', 'hello big world')).toBeCloseTo(1 / 2, 5);
    });

    it('is case-insensitive', () => {
        expect(computeWer('Hello World', 'hello world')).toBe(0);
    });

    it('treats empty hypothesis against non-empty reference as 100% WER', () => {
        expect(computeWer('some reference text', '')).toBe(1);
    });

    it('treats two empty strings as 0 WER', () => {
        expect(computeWer('', '')).toBe(0);
    });
});

describe('reciprocalRank', () => {
    it('returns 1 when gold is at position 0', () => {
        expect(reciprocalRank(['a', 'b', 'c'], ['a'])).toBe(1);
    });

    it('returns 1/2 when gold is at position 1', () => {
        expect(reciprocalRank(['a', 'b', 'c'], ['b'])).toBe(1 / 2);
    });

    it('returns 1/3 when gold is at position 2', () => {
        expect(reciprocalRank(['a', 'b', 'c'], ['c'])).toBe(1 / 3);
    });

    it('returns the best reciprocal when multiple golds match', () => {
        expect(reciprocalRank(['a', 'b', 'c'], ['c', 'b'])).toBe(1 / 2);
    });

    it('returns 0 when no gold matches', () => {
        expect(reciprocalRank(['a', 'b', 'c'], ['x', 'y'])).toBe(0);
    });
});

describe('recallAt', () => {
    it('is 1.0 when every gold is in top-K', () => {
        expect(recallAt(5, ['a', 'b', 'c'], ['a', 'b'])).toBe(1);
    });

    it('is 0.5 when half the golds are in top-K', () => {
        expect(recallAt(2, ['a', 'b', 'c', 'd'], ['a', 'c'])).toBeCloseTo(0.5, 5);
    });

    it('is 0 when empty gold list', () => {
        expect(recallAt(5, ['a', 'b'], [])).toBe(0);
    });
});
