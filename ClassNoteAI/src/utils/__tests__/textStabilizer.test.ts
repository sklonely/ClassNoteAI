/**
 * TextStabilizer regression tests.
 *
 * Locks in the current MVP behaviour:
 *   - new transcript becomes "unstable", history is "stable"
 *   - empty input doesn't disturb history
 *   - commit() appends to history with a separating space
 *   - reset() clears history
 *
 * The current implementation is intentionally simple — long internal
 * comments document the eventual "Local Agreement" / suffix-matching
 * direction. These tests guard the MVP contract so a future refactor
 * has a baseline to diff behaviour against.
 */

import { describe, it, expect } from 'vitest';
import { TextStabilizer } from '../textStabilizer';

describe('TextStabilizer', () => {
    describe('stabilize()', () => {
        it('returns empty stable + empty unstable on first call with empty input', () => {
            const t = new TextStabilizer();
            expect(t.stabilize('')).toEqual({ stable: '', unstable: '' });
        });

        it('returns the new transcript as unstable when no history yet', () => {
            const t = new TextStabilizer();
            const out = t.stabilize('Hello world');
            expect(out.stable).toBe('');
            expect(out.unstable).toBe('Hello world');
        });

        it('preserves committed history as the stable portion', () => {
            const t = new TextStabilizer();
            t.commit('Hello world');
            const out = t.stabilize('this is the next chunk');
            expect(out.stable).toBe('Hello world');
            expect(out.unstable).toBe('this is the next chunk');
        });

        it('whitespace-only input is treated as silence (history unchanged)', () => {
            const t = new TextStabilizer();
            t.commit('Existing history');
            const out = t.stabilize('   \n\t  ');
            expect(out.stable).toBe('Existing history');
            expect(out.unstable).toBe('');
        });
    });

    describe('commit()', () => {
        it('seeds history with the first commit', () => {
            const t = new TextStabilizer();
            t.commit('first chunk');
            expect(t.getStableHistory()).toBe('first chunk');
        });

        it('separates subsequent commits with a single space', () => {
            const t = new TextStabilizer();
            t.commit('first');
            t.commit('second');
            t.commit('third');
            expect(t.getStableHistory()).toBe('first second third');
        });
    });

    describe('reset()', () => {
        it('clears all stable history', () => {
            const t = new TextStabilizer();
            t.commit('lots of history');
            t.commit('more');
            t.reset();
            expect(t.getStableHistory()).toBe('');
            // After reset, a fresh stabilize call sees an empty history.
            expect(t.stabilize('new lecture').stable).toBe('');
        });
    });
});
