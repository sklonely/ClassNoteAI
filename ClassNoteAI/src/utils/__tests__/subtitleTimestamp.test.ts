/**
 * subtitleTimestamp tests — Phase 7 Sprint 2 (S2.11).
 *
 * 鎖住 V12 spec 對 subtitle.timestamp 的「relative seconds since lecture start」
 * 規格 + legacy ms→s migration 行為，確保未來 schema migration (Sprint 3)
 * 跑這些 helper 時資料不會被疊加或誤判。
 */

import { describe, it, expect } from 'vitest';
import {
    toRelativeSeconds,
    fromRelativeSeconds,
    formatRelativeTime,
    migrateSubtitleTimestamp,
} from '../subtitleTimestamp';

describe('subtitleTimestamp', () => {
    describe('toRelativeSeconds()', () => {
        it('returns 0 for (0, 0)', () => {
            expect(toRelativeSeconds(0, 0)).toBe(0);
        });

        it('returns input unchanged when already relative seconds (input < 1e9)', () => {
            expect(toRelativeSeconds(60, undefined)).toBe(60);
            expect(toRelativeSeconds(60, 1_714_291_200_000)).toBe(60);
            expect(toRelativeSeconds(12.345, 1_714_291_200_000)).toBeCloseTo(12.345);
        });

        it('converts unix ms timestamp into relative seconds against lectureStartedAtMs', () => {
            // start at 2024-04-28 04:00:00 UTC → +60s
            const start = 1_714_291_200_000;
            const oneMinLater = start + 60_000;
            expect(toRelativeSeconds(oneMinLater, start)).toBe(60);
        });

        it('preserves fractional seconds (no Math.floor)', () => {
            const start = 1_714_291_200_000;
            const ts = start + 12_345; // 12.345s
            expect(toRelativeSeconds(ts, start)).toBeCloseTo(12.345, 3);
        });

        it('clamps to 0 when timestamp predates lectureStartedAtMs (clock skew)', () => {
            const start = 1_714_291_200_000;
            const earlier = start - 5_000;
            expect(toRelativeSeconds(earlier, start)).toBe(0);
        });

        it('treats null/undefined lectureStartedAtMs as 0 (legacy fallback)', () => {
            // unix ms with no start anchor → return absolute / 1000 (still positive)
            const ts = 1_714_291_260_000;
            expect(toRelativeSeconds(ts, null)).toBe(1_714_291_260);
            expect(toRelativeSeconds(ts, undefined)).toBe(1_714_291_260);
        });

        it('returns 0 for non-finite input', () => {
            expect(toRelativeSeconds(NaN, 0)).toBe(0);
            expect(toRelativeSeconds(Infinity, 0)).toBe(0);
        });
    });

    describe('fromRelativeSeconds()', () => {
        it('inverts toRelativeSeconds for typical values', () => {
            const start = 1_714_291_200_000;
            expect(fromRelativeSeconds(60, start)).toBe(1_714_291_260_000);
            expect(fromRelativeSeconds(0, start)).toBe(start);
        });

        it('round-trips with toRelativeSeconds', () => {
            const start = 1_714_291_200_000;
            const ms = 1_714_291_212_345;
            const rel = toRelativeSeconds(ms, start);
            expect(fromRelativeSeconds(rel, start)).toBe(ms);
        });

        it('returns lectureStartedAtMs for non-finite input', () => {
            const start = 1_714_291_200_000;
            expect(fromRelativeSeconds(NaN, start)).toBe(start);
        });
    });

    describe('formatRelativeTime()', () => {
        it("formats 0 as '00:00'", () => {
            expect(formatRelativeTime(0)).toBe('00:00');
        });

        it("formats 65 as '01:05'", () => {
            expect(formatRelativeTime(65)).toBe('01:05');
        });

        it("formats 3600 as '60:00' (MM:SS, no hour split)", () => {
            expect(formatRelativeTime(3600)).toBe('60:00');
        });

        it('floors fractional seconds', () => {
            expect(formatRelativeTime(12.9)).toBe('00:12');
        });

        it('clamps negative input to 00:00', () => {
            expect(formatRelativeTime(-5)).toBe('00:00');
        });

        it('handles non-finite input gracefully', () => {
            expect(formatRelativeTime(NaN)).toBe('00:00');
        });
    });

    describe('migrateSubtitleTimestamp()', () => {
        it('converts unix-ms timestamp to relative seconds', () => {
            const start = 1_714_291_200_000;
            const out = migrateSubtitleTimestamp(
                { timestamp: 1_714_291_260_000 },
                start,
            );
            expect(out.timestamp).toBe(60);
        });

        it('is idempotent — already-relative timestamps are returned unchanged', () => {
            const out = migrateSubtitleTimestamp({ timestamp: 60 }, 0);
            expect(out.timestamp).toBe(60);

            // Run twice in a row — still 60.
            const twice = migrateSubtitleTimestamp(out, 1_714_291_200_000);
            expect(twice.timestamp).toBe(60);
        });

        it('preserves other fields when migrating', () => {
            const start = 1_714_291_200_000;
            const sub = {
                id: 'sub-1',
                lecture_id: 'lec-1',
                timestamp: 1_714_291_260_000,
                text_en: 'hello',
                text_zh: '你好',
                type: 'rough' as const,
            };
            const out = migrateSubtitleTimestamp(sub, start);
            expect(out).toEqual({
                id: 'sub-1',
                lecture_id: 'lec-1',
                timestamp: 60,
                text_en: 'hello',
                text_zh: '你好',
                type: 'rough',
            });
        });

        it('does not mutate the input row', () => {
            const start = 1_714_291_200_000;
            const sub = { timestamp: 1_714_291_260_000, text: 'orig' };
            const before = { ...sub };
            migrateSubtitleTimestamp(sub, start);
            expect(sub).toEqual(before);
        });
    });
});
