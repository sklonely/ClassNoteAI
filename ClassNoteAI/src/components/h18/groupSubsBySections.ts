/**
 * groupSubsBySections · cp75.28
 *
 * Bucket a flat `Subtitle[]` into `Para[]` whose breakpoints are the
 * `Section[]` timestamps from `note.sections`. Each subtitle joins the
 * latest section whose `timestamp` ≤ `sub.timestamp`; subtitles before
 * the first section's timestamp land in a "pre-section" bucket so they
 * still render.
 *
 * Why it lives in its own module
 * ───────────────────────────────
 * Prior to cp75.28, this helper was a private function inside
 * H18ReviewPage.tsx. The cp75.28 audit found it sat directly downstream
 * of recordingSessionService.stop's `duration: 0` bug — when sections
 * all carry timestamp=0, every subtitle matches section 0 → "1 段到底"
 * wall of text. Extracting to a standalone module lets us pin its
 * contract with focused unit tests (groupSubsBySections.test.tsx)
 * without standing up the whole ReviewPage component.
 *
 * Behavioural contract (verified by tests)
 * ─────────────────────────────────────────
 *   - sections=[]  + subs=[]   → []                       (empty)
 *   - sections=[]  + subs=[…]  → 1 pre-section bucket    (no TOC)
 *   - sections=[N] + subs=[…]  → ≤N+1 buckets, only non-empty kept
 *   - sub.timestamp ≥ section[i].timestamp → joins section i
 *   - all sections share timestamp → 1 bucket (degenerate; pre-cp75.28
 *     surface, kept as a regression-test pin so we notice if this
 *     surface comes back)
 */

import type { Section, Subtitle } from '../../types';

export interface Para {
    section: Section | null;
    sectionIndex: number;
    items: Subtitle[];
}

export function groupSubsBySections(
    subs: Subtitle[],
    sections: Section[],
): Para[] {
    const sortedSubs = [...subs].sort((a, b) => a.timestamp - b.timestamp);
    if (sections.length === 0) {
        return sortedSubs.length > 0
            ? [{ section: null, sectionIndex: -1, items: sortedSubs }]
            : [];
    }
    const sortedSections = [...sections].sort(
        (a, b) => a.timestamp - b.timestamp,
    );
    const groups: Para[] = sortedSections.map((sec, i) => ({
        section: sec,
        sectionIndex: i,
        items: [],
    }));
    // pre-section bucket for any subs before the first section's timestamp
    const preSection: Para = { section: null, sectionIndex: -1, items: [] };
    for (const sub of sortedSubs) {
        let placed = false;
        for (let i = sortedSections.length - 1; i >= 0; i--) {
            if (sub.timestamp >= sortedSections[i].timestamp) {
                groups[i].items.push(sub);
                placed = true;
                break;
            }
        }
        if (!placed) preSection.items.push(sub);
    }
    return preSection.items.length > 0
        ? [preSection, ...groups.filter((g) => g.items.length > 0)]
        : groups.filter((g) => g.items.length > 0);
}
