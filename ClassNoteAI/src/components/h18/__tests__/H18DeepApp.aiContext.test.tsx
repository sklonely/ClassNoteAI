/**
 * cp75.30 — aiContextDerivation helpers test.
 *
 * H18DeepApp page-level wiring depends on a small pure helper that
 * maps a parsed nav route + last-viewed-review state to an AIContext.
 * Testing the helper in isolation keeps us out of H18DeepApp's heavy
 * mock graph (storageService / canvasCacheService / recordingSession /
 * 各種 settings dispatch). Once helpers are green, the H18DeepApp call
 * site is a one-liner.
 *
 * Persistence: storeLastReview / loadLastReview round-trip a simple
 * blob in localStorage so navigating review → ai still surfaces a
 * lecture-scoped context for the AI tutor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    deriveAIContextForPage,
    storeLastReview,
    loadLastReview,
} from '../aiContextDerivation';

describe('aiContextDerivation · cp75.30', () => {
    it('returns lecture context from parsed=review', () => {
        expect(
            deriveAIContextForPage(
                { kind: 'review', courseId: 'C1', lectureId: 'L1' },
                undefined,
            ),
        ).toEqual({ kind: 'lecture', lectureId: 'L1', courseId: 'C1' });
    });

    it('falls back to lastReview when on /ai page', () => {
        expect(
            deriveAIContextForPage(
                { kind: 'ai' },
                { lectureId: 'L1', courseId: 'C1' },
            ),
        ).toEqual({ kind: 'lecture', lectureId: 'L1', courseId: 'C1' });
    });

    it('returns undefined when on /ai page and no lastReview', () => {
        expect(deriveAIContextForPage({ kind: 'ai' }, undefined)).toBeUndefined();
    });

    it('returns course context when on course page', () => {
        expect(
            deriveAIContextForPage({ kind: 'course', courseId: 'C1' }, undefined),
        ).toEqual({ kind: 'course', courseId: 'C1' });
    });

    it('returns course context when on course-edit page', () => {
        expect(
            deriveAIContextForPage(
                { kind: 'course-edit', courseId: 'C1' },
                undefined,
            ),
        ).toEqual({ kind: 'course', courseId: 'C1' });
    });

    it('returns undefined for home page', () => {
        expect(deriveAIContextForPage({ kind: 'home' }, undefined)).toBeUndefined();
    });
});

describe('aiContextDerivation · localStorage persistence · cp75.30', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('localStorage persistence: storeLastReview / loadLastReview round-trip', () => {
        storeLastReview({ lectureId: 'L1', courseId: 'C1' });
        expect(loadLastReview()).toEqual({ lectureId: 'L1', courseId: 'C1' });
    });

    it('loadLastReview returns undefined when nothing was stored', () => {
        expect(loadLastReview()).toBeUndefined();
    });

    it('loadLastReview returns undefined on malformed JSON', () => {
        localStorage.setItem('h18-last-review-context-v1', 'not-json{{{');
        expect(loadLastReview()).toBeUndefined();
    });

    it('loadLastReview rejects payload missing required fields', () => {
        localStorage.setItem(
            'h18-last-review-context-v1',
            JSON.stringify({ lectureId: 'L1' }),
        );
        expect(loadLastReview()).toBeUndefined();
    });
});
