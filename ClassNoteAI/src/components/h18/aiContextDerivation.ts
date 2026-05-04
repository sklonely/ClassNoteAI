/**
 * cp75.30 — AI tutor context derivation + last-review persistence.
 *
 * H18DeepApp's nav router knows which page is rendered, but the AI
 * tutor (H18AIPage / H18AIDock) takes an opaque `AIContext`. This
 * helper centralises the parsed-route → AIContext mapping so:
 *   1. The dock + page derive the *same* context from the *same* state
 *   2. Navigating to the bare `/ai` page after a review still surfaces
 *      a lecture-scoped context (via `loadLastReview()`), so the AI
 *      knows what 「這堂課」 means.
 *
 * Persistence key is namespaced + versioned (`-v1`) so future schema
 * changes don't surprise users who never logged out.
 */

import type { AIContext } from './useAIHistory';

interface ParsedRoute {
    kind:
        | 'home'
        | 'ai'
        | 'review'
        | 'course'
        | 'course-edit'
        | 'recording'
        | 'profile'
        | 'notes'
        | string;
    lectureId?: string;
    courseId?: string;
}

export interface LastReviewState {
    lectureId: string;
    courseId: string;
}

const STORE_KEY = 'h18-last-review-context-v1';

export function storeLastReview(state: LastReviewState): void {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
        /* quota / unavailable — best effort, fallback derivation still works
           in-memory until next reload */
    }
}

export function loadLastReview(): LastReviewState | undefined {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            typeof parsed.lectureId === 'string' &&
            typeof parsed.courseId === 'string'
        ) {
            return { lectureId: parsed.lectureId, courseId: parsed.courseId };
        }
    } catch {
        /* swallow — malformed payload, treat as empty */
    }
    return undefined;
}

/**
 * Map a parsed nav route to the AIContext the tutor should use.
 *
 *   review:cid:lid  → { kind: 'lecture', lectureId, courseId }
 *   course:cid /
 *   course-edit:cid → { kind: 'course', courseId }
 *   ai (with last)  → { kind: 'lecture', lectureId, courseId } from
 *                     last-viewed review
 *   else            → undefined (caller falls back to global mode)
 */
export function deriveAIContextForPage(
    parsed: ParsedRoute,
    lastReview: LastReviewState | undefined,
): AIContext | undefined {
    if (parsed.kind === 'review' && parsed.lectureId && parsed.courseId) {
        return {
            kind: 'lecture',
            lectureId: parsed.lectureId,
            courseId: parsed.courseId,
        };
    }
    if (
        (parsed.kind === 'course' || parsed.kind === 'course-edit') &&
        parsed.courseId
    ) {
        return { kind: 'course', courseId: parsed.courseId };
    }
    if (parsed.kind === 'ai' && lastReview) {
        return {
            kind: 'lecture',
            lectureId: lastReview.lectureId,
            courseId: lastReview.courseId,
        };
    }
    return undefined;
}
