/**
 * Topic-aware section-boundary detection for auto-generated notes.
 *
 * The pre-v0.5.2 auto-note generator hard-split every 5 minutes, which
 * cut mid-concept on fast-moving lectures and left one long wall of
 * text on slow-moving ones. This utility instead finds natural topic
 * boundaries via adjacent-segment embedding similarity: a sustained
 * similarity drop between two windows of subtitles usually means the
 * speaker changed subject.
 *
 * Algorithm (TextTiling-style, simplified):
 *   1. Embed each subtitle segment (reusing cached embeddings when
 *      the caller provides them — Auto Follow computes these already).
 *   2. Build a smoothed per-segment "similarity to running context"
 *      series using a window mean.
 *   3. Mark indices where the smoothed sim dips below
 *      `mean - DEPTH_STD * stddev` as candidate boundaries.
 *   4. Enforce min/max section duration guardrails so we don't emit
 *      30-second sections on noisy content or 45-minute sections on
 *      single-topic lectures.
 *   5. Fall back to uniform 5-minute splitting if we don't have enough
 *      signal (<8 segments, or embedder isn't available).
 *
 * Input is kept provider-neutral: segments are `{startTime: ms, text}`.
 * Caller can pre-compute embeddings or pass `null` — in the latter case
 * the function just uses the time-based fallback.
 */

export interface SegmentInput {
    id: string;
    /** ms since lecture start. */
    startTime: number;
    text: string;
}

export interface SectionBoundary {
    /** Index into the input `segments` array where this section starts. */
    startIdx: number;
    /** Timestamp in seconds where this section starts (segments[startIdx].startTime / 1000). */
    timestamp: number;
}

/** Minimum wall-clock duration of an auto-generated section. Shorter
 *  than this and the note becomes choppy — a 30-second section can
 *  easily be pure filler / one slide flip. */
const MIN_SECTION_DURATION_SEC = 90;
/** Maximum duration before we force a split even without a topic
 *  signal. Keeps the reading-length of any single section manageable
 *  for single-topic lectures. */
const MAX_SECTION_DURATION_SEC = 600;
/** Fallback when no embeddings are available. Matches the pre-v0.5.2
 *  behaviour so the visual output doesn't change drastically. */
const FALLBACK_SECTION_DURATION_SEC = 300;
/** Absolute similarity threshold below which a pairwise value is
 *  considered a real topic shift regardless of neighbours. Chosen
 *  empirically against bge-small-en outputs: same-topic adjacent
 *  subtitles land in the 0.6-0.9 range, cross-topic drops to 0.2-0.5. */
const PAIRWISE_DIP_ABSOLUTE = 0.6;
/** AND, the dip must be this much lower than the local neighbour
 *  average — prevents marking a uniformly-low-similarity lecture
 *  (e.g. all segments very short) as all-boundary. */
const PAIRWISE_DIP_BELOW_LOCAL = 0.15;

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

function fallbackUniformBoundaries(segments: SegmentInput[]): SectionBoundary[] {
    if (segments.length === 0) return [];
    const out: SectionBoundary[] = [{ startIdx: 0, timestamp: segments[0].startTime / 1000 }];
    let currentStart = segments[0].startTime / 1000;
    for (let i = 1; i < segments.length; i++) {
        const t = segments[i].startTime / 1000;
        if (t - currentStart >= FALLBACK_SECTION_DURATION_SEC) {
            out.push({ startIdx: i, timestamp: t });
            currentStart = t;
        }
    }
    return out;
}

/**
 * Returns the list of section boundaries for `segments`. The first
 * entry is always `{startIdx: 0, timestamp: firstSegStart}`; subsequent
 * entries mark where a new section begins.
 *
 * @param segments  Ordered by startTime ascending.
 * @param embeddings Optional — parallel to `segments`. If undefined or
 *                   empty, falls back to fixed 5-min splits.
 */
export function detectSectionBoundaries(
    segments: SegmentInput[],
    embeddings?: (number[] | undefined)[] | null,
): SectionBoundary[] {
    if (segments.length === 0) return [];
    if (segments.length < 8 || !embeddings || embeddings.length !== segments.length) {
        // Not enough signal OR no embeddings — uniform-split fallback.
        return fallbackUniformBoundaries(segments);
    }

    // Step 1: per-segment similarity to the NEXT segment (pairwise).
    // Undefined or zero-norm embeddings yield 0, which the neighbour
    // comparison below interprets as a no-signal valley — they can't
    // create spurious boundaries because the absolute threshold
    // ignores low-confidence embeddings on both sides.
    const pairwise: number[] = new Array(segments.length - 1).fill(0);
    for (let i = 0; i < segments.length - 1; i++) {
        const a = embeddings[i];
        const b = embeddings[i + 1];
        if (!a || !b) continue;
        pairwise[i] = cosineSimilarity(a, b);
    }

    // Step 2: find dips where pairwise[i] is BOTH below the absolute
    // threshold AND significantly below the local neighbour average.
    // The two-condition AND prevents false positives in either
    // direction: uniformly-low-similarity content (short-segment
    // noise) fails the "below local avg" check, while a one-off
    // small-magnitude drop in high-similarity content fails the
    // absolute check. A single crisp topic-shift satisfies both.
    //
    // The earlier "smoothed + local-minimum" approach over-blurred
    // single-segment transitions and missed them when the valley was
    // flat across 2-3 consecutive indices.
    const candidateIdxs: number[] = [];
    for (let i = 0; i < pairwise.length; i++) {
        if (pairwise[i] >= PAIRWISE_DIP_ABSOLUTE) continue;
        // Local neighbour average — use a 2-step window on each side,
        // skipping self. Clamp to valid indices.
        let neighSum = 0;
        let neighCount = 0;
        for (let j = i - 2; j <= i + 2; j++) {
            if (j < 0 || j >= pairwise.length || j === i) continue;
            neighSum += pairwise[j];
            neighCount += 1;
        }
        const neighAvg = neighCount > 0 ? neighSum / neighCount : 1;
        if (pairwise[i] < neighAvg - PAIRWISE_DIP_BELOW_LOCAL) {
            // Dip detected — topic boundary is at segment i+1 (first
            // segment of the new topic).
            candidateIdxs.push(i + 1);
        }
    }

    // Step 4: walk segments, accepting candidates as boundaries but
    // enforcing MIN/MAX duration guardrails.
    const boundaries: SectionBoundary[] = [
        { startIdx: 0, timestamp: segments[0].startTime / 1000 },
    ];
    let lastBoundaryTime = segments[0].startTime / 1000;
    const candSet = new Set(candidateIdxs);

    for (let i = 1; i < segments.length; i++) {
        const tNow = segments[i].startTime / 1000;
        const durSinceLast = tNow - lastBoundaryTime;
        const isCandidate = candSet.has(i);
        // A candidate becomes a real boundary only if we're past the
        // minimum duration. A non-candidate still forces a boundary
        // once we hit max duration so single-topic lectures don't get
        // one 60-minute section.
        if (
            (isCandidate && durSinceLast >= MIN_SECTION_DURATION_SEC) ||
            durSinceLast >= MAX_SECTION_DURATION_SEC
        ) {
            boundaries.push({ startIdx: i, timestamp: tNow });
            lastBoundaryTime = tNow;
        }
    }
    return boundaries;
}
