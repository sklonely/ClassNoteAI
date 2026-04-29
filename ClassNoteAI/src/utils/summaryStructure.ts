/**
 * summaryStructure · cp75.14
 *
 * Extract a `Section[]` from the markdown body that `summarizeStream`
 * produces. Until this commit, both `runBackgroundSummary` (in the stop
 * pipeline) and `runSummary` (manual retry on ReviewPage) saved the
 * markdown into `note.summary` but left `note.sections` as the empty
 * array — so the ReviewPage left-rail TOC ("章節 · 0") was always
 * empty even though the markdown body did have `## Heading` sections.
 *
 * The Section schema (types/index.ts) requires a `timestamp` per
 * section — but the model doesn't emit per-section timestamps in its
 * markdown output. We approximate by spreading the headings evenly
 * across the recorded duration. Two practical reasons that's good
 * enough:
 *   1. The TOC is a "jump roughly to here" affordance, not a precise
 *      cue. ±10% on a 60-min lecture is fine.
 *   2. Concept-extraction (Phase 8) will eventually do this with
 *      proper RAG-aligned timestamps; this helper retires then.
 *
 * Heading rules:
 *   - We pick `^## ` (level-2) headings — the model's section markers.
 *   - We skip H1 ("# 課堂｜...") since it's the document title, not a
 *     navigable section.
 *   - We skip H3+ since those are intra-section structure, too fine-
 *     grained for the TOC.
 *   - Headings inside fenced code blocks are ignored.
 */

import type { Section } from '../types';

/**
 * Parse the markdown summary into a Section[] suitable for
 * `note.sections`. `durationSec` is the lecture's recorded length;
 * sections get evenly-spread timestamps inside `[0, durationSec)`.
 *
 * Returns `[]` when no `## ` headings are found — caller should keep
 * the existing sections array in that case (don't overwrite with [],
 * to preserve any user-edited or future concept-extracted state).
 */
export function extractSectionsFromSummary(
    markdown: string,
    durationSec: number,
): Section[] {
    if (!markdown || typeof markdown !== 'string') return [];

    const lines = markdown.split(/\r?\n/);
    const headings: { title: string; lineIdx: number }[] = [];

    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (/^\s*```/.test(ln)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        // Match `## Title` exactly — not `### Sub` (3+ hashes) and not
        // `# Title` (h1). The trailing `(?!#)` lookahead rejects ###+.
        const m = /^##\s+(?!#)(.+?)\s*#*\s*$/.exec(ln);
        if (m) {
            const title = m[1].trim();
            if (title.length > 0) {
                headings.push({ title, lineIdx: i });
            }
        }
    }

    if (headings.length === 0) return [];

    // Build a body slice per heading: from this heading's line+1 to the
    // next heading's line (exclusive), or to EOF for the last one. We
    // store the body in `content` for completeness — most consumers
    // only use `title` + `timestamp`, but the schema has the field.
    const sections: Section[] = headings.map((h, i) => {
        const start = h.lineIdx + 1;
        const end = i + 1 < headings.length ? headings[i + 1].lineIdx : lines.length;
        const body = lines.slice(start, end).join('\n').trim();

        // Even spread across [0, durationSec). For 4 sections in a 60-min
        // lecture: [0s, 900s, 1800s, 2700s].
        const timestamp = headings.length > 1
            ? Math.round((i / headings.length) * Math.max(0, durationSec))
            : 0;

        return {
            title: h.title,
            content: body,
            timestamp,
        };
    });

    return sections;
}

/**
 * Convenience wrapper. Falls back to the existing sections when
 * extraction returns empty (e.g. the model produced an unexpected
 * format and we don't want to wipe a previous good extraction).
 */
export function mergeExtractedSections(
    markdown: string,
    durationSec: number,
    fallback: Section[] = [],
): Section[] {
    const extracted = extractSectionsFromSummary(markdown, durationSec);
    return extracted.length > 0 ? extracted : fallback;
}
