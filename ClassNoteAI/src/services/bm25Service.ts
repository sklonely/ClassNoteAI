/**
 * Lightweight BM25-style keyword search over lecture chunks.
 *
 * Used by `ragService.chat` as the sparse half of hybrid retrieval.
 * The dense side continues to use `embeddingStorageService.semanticSearch`;
 * results from both are fused via Reciprocal Rank Fusion so the final
 * ranking captures BOTH keyword overlap (good for specific technical
 * terms like "Fitts's Law") AND semantic similarity (good for
 * paraphrased queries).
 *
 * Why this helps: a pure dense embedder often under-ranks passages
 * whose exact keyword match is the most informative signal. For
 * example, a query "GDPR Article 17" against a lecture with 50
 * semantically-similar privacy chunks — pure cosine can bury the ONE
 * chunk that actually mentions Article 17 specifically. BM25 surfaces
 * it on the keyword side, RRF lifts it in the fused rank.
 *
 * Implementation: `minisearch` — tiny JS library (20 KB), no native
 * deps, BM25 scoring by default, handles prefix / fuzzy / stemming
 * via configuration. Indexing is in-memory; the app's lectures are
 * small enough (~5k chunks worst case) that persisting the BM25 index
 * to disk isn't worth the complexity. We rebuild per-lecture from
 * the embeddings table on first chat call and keep it cached.
 */

import MiniSearch from 'minisearch';
import { embeddingStorageService, type EmbeddingRecord } from './embeddingStorageService';

export interface BM25Result {
    chunkId: string;
    score: number;
}

class BM25Service {
    /** Cache of MiniSearch instances keyed by lecture id. Rebuilt when
     *  a lecture's embeddings change (we don't currently subscribe to
     *  that — callers invalidate explicitly via `invalidate`). */
    private indices: Map<string, { index: MiniSearch; chunks: EmbeddingRecord[] }> = new Map();

    /** Build or reuse the index for a lecture. Pulls chunk text from
     *  the embeddings table so we inherit whatever chunking the dense
     *  side used — keeps BM25 and dense voting on the same unit. */
    private async ensureIndex(lectureId: string) {
        const hit = this.indices.get(lectureId);
        if (hit) return hit;

        const chunks = await embeddingStorageService.getEmbeddingsByLecture(lectureId);
        const index = new MiniSearch<{ id: string; text: string }>({
            fields: ['text'],
            storeFields: ['id'],
            searchOptions: {
                boost: { text: 1 },
                // BM25-like defaults: MiniSearch uses tf-idf by default;
                // the combineWith: 'AND' is too strict for user queries
                // that may include stop words or typos — OR with prefix +
                // fuzzy gives us graceful fallbacks.
                combineWith: 'OR',
                prefix: true,
                fuzzy: 0.2,
            },
        });
        index.addAll(chunks.map((c) => ({ id: c.id, text: c.chunkText })));
        const entry = { index, chunks };
        this.indices.set(lectureId, entry);
        return entry;
    }

    /** Drop the cache for a lecture (call after re-indexing embeddings). */
    public invalidate(lectureId: string) {
        this.indices.delete(lectureId);
    }

    /** Top-K chunks for `query`. Returns chunk ids + raw BM25-ish score.
     *  Callers fuse this with dense results via RRF, so the absolute
     *  score doesn't need to be cross-method-comparable. */
    public async search(lectureId: string, query: string, topK = 20): Promise<BM25Result[]> {
        if (!query.trim()) return [];
        const { index } = await this.ensureIndex(lectureId);
        const hits = index.search(query).slice(0, topK);
        return hits.map((h) => ({ chunkId: String(h.id), score: h.score }));
    }
}

export const bm25Service = new BM25Service();

/**
 * Reciprocal Rank Fusion — merges two ranked lists of chunk ids into
 * a single ranking. The standard `k = 60` from the original Cormack
 * et al. 2009 paper — any ranks beyond ~60 contribute diminishing
 * returns, so the constant effectively caps single-method dominance.
 *
 * Returns an array of `{chunkId, score}` sorted by fused score desc.
 * A chunk present in only one list still appears, just weighted lower.
 */
export function reciprocalRankFusion(
    rankedLists: string[][],
    k = 60,
): { chunkId: string; score: number }[] {
    const scores = new Map<string, number>();
    for (const list of rankedLists) {
        for (let rank = 0; rank < list.length; rank++) {
            const id = list[rank];
            scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
        }
    }
    return Array.from(scores.entries())
        .map(([chunkId, score]) => ({ chunkId, score }))
        .sort((a, b) => b.score - a.score);
}
