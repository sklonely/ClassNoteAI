import { describe, it, expect } from 'vitest';
import { detectSectionBoundaries, type SegmentInput } from '../topicSegmentation';

/**
 * Tests pin the topic-segmentation contract so behaviour stays
 * predictable across future tweaks to the smoothing window /
 * threshold / duration guardrails. Uses synthetic embeddings because
 * real Candle-generated ones would make the test slow + flaky.
 */

function seg(id: string, timestampSec: number, text = id): SegmentInput {
    return { id, startTime: timestampSec * 1000, text };
}

describe('detectSectionBoundaries', () => {
    it('returns [] for empty input', () => {
        expect(detectSectionBoundaries([])).toEqual([]);
    });

    it('returns a single starting boundary for one segment', () => {
        const result = detectSectionBoundaries([seg('a', 0)]);
        expect(result).toEqual([{ startIdx: 0, timestamp: 0 }]);
    });

    it('falls back to 5-min splits when no embeddings provided', () => {
        // 20 segments, one every 60s → 20 minutes total.
        const segs = Array.from({ length: 20 }, (_, i) => seg(`s${i}`, i * 60));
        const result = detectSectionBoundaries(segs);
        // Should land around 0s / 300s / 600s / 900s / 1200s.
        expect(result.length).toBeGreaterThanOrEqual(3);
        expect(result[0].timestamp).toBe(0);
        expect(result[1].timestamp).toBeGreaterThanOrEqual(300);
    });

    it('falls back to uniform split when embeddings length mismatches', () => {
        const segs = Array.from({ length: 20 }, (_, i) => seg(`s${i}`, i * 60));
        const result = detectSectionBoundaries(segs, [[1, 0]]);
        expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('returns only the starting boundary when too few segments for signal', () => {
        // 5 segments = below 8-segment signal threshold → fallback.
        const segs = Array.from({ length: 5 }, (_, i) => seg(`s${i}`, i * 30));
        const result = detectSectionBoundaries(segs, segs.map(() => [1, 0]));
        expect(result.length).toBe(1);
        expect(result[0].startIdx).toBe(0);
    });

    it('detects a topic boundary at an embedding-similarity dip', () => {
        // 10 segments: first 5 are topic A (embedding = [1, 0]), next 5
        // are topic B (embedding = [0, 1]). One crisp boundary at idx 5.
        // Each segment 30s apart → total 270s. We use min-duration 90s,
        // so a boundary at idx 5 (150s in) IS allowed. But idx 5 is the
        // first B segment so 150s - 0 = 150s ≥ 90 ✓.
        const segs = Array.from({ length: 10 }, (_, i) => seg(`s${i}`, i * 30));
        const embs: number[][] = [
            [1, 0], [1, 0], [1, 0], [1, 0], [1, 0],
            [0, 1], [0, 1], [0, 1], [0, 1], [0, 1],
        ];
        const result = detectSectionBoundaries(segs, embs);
        // Must have at least TWO boundaries (the starting one + the
        // topic-dip one). First is always index 0.
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result[0].startIdx).toBe(0);
        // Second boundary should be at or near idx 5 (first segment of
        // topic B). Allow a smoothing-window tolerance of ±2.
        expect(result[1].startIdx).toBeGreaterThanOrEqual(3);
        expect(result[1].startIdx).toBeLessThanOrEqual(7);
    });

    it('respects the MIN_SECTION_DURATION guardrail', () => {
        // All segments have identical "content" so every pairwise sim is
        // ~1. No dips. The segment-spacing is 5s → less than 90s between
        // adjacent segments means any topic-dip boundary gets rejected.
        // All we should see is the starting boundary + possibly a
        // MAX_DURATION boundary if the total exceeds 600s.
        const segs = Array.from({ length: 30 }, (_, i) => seg(`s${i}`, i * 5));
        const embs = segs.map(() => [1, 0, 0]);
        const result = detectSectionBoundaries(segs, embs);
        // 30 × 5s = 150s total — below MAX_DURATION 600s, so just one.
        expect(result.length).toBe(1);
    });

    it('respects the MAX_SECTION_DURATION guardrail', () => {
        // 20 segments one per minute = 19 minutes. Identical embeddings
        // (no topic dip). Should still split at ~10 min due to MAX guard.
        const segs = Array.from({ length: 20 }, (_, i) => seg(`s${i}`, i * 60));
        const embs = segs.map(() => [0.5, 0.5, 0.5]);
        const result = detectSectionBoundaries(segs, embs);
        // Starting boundary + at least one forced split.
        expect(result.length).toBeGreaterThanOrEqual(2);
        // Forced split should be at or just past 600s (10 min).
        const forced = result[1];
        expect(forced.timestamp).toBeGreaterThanOrEqual(600);
        expect(forced.timestamp).toBeLessThanOrEqual(660);
    });

    it('preserves chronological order of returned boundaries', () => {
        const segs = Array.from({ length: 20 }, (_, i) => seg(`s${i}`, i * 30));
        const embs: number[][] = segs.map((_, i) =>
            i < 7 ? [1, 0] : i < 14 ? [0, 1] : [0, 0, 1],
        );
        const result = detectSectionBoundaries(segs, embs);
        for (let i = 1; i < result.length; i++) {
            expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
        }
    });
});
