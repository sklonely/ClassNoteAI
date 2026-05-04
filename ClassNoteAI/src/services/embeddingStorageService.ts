/**
 * Vector store for lecture chunks (RAG / semantic search).
 *
 * v0.5.0: backed by the Tauri-side SQLite `embeddings` table.
 * Previous versions used localStorage under `embeddings_<lectureId>`;
 * a one-shot migration below pulls any legacy entries into SQLite the
 * first time each lecture is accessed.
 *
 * Embeddings themselves are produced by the local Candle-backed
 * generator (see embeddingService.ts).
 */

import { invoke } from '@tauri-apps/api/core';
import { authService } from './authService';
import { TextChunk } from './chunkingService';

export interface EmbeddingRecord {
    id: string;
    lectureId: string;
    chunkText: string;
    embedding: number[];
    sourceType: 'pdf' | 'transcript';
    position: number;
    pageNumber?: number;
    createdAt: string;
}

export interface SearchResult {
    chunk: EmbeddingRecord;
    similarity: number;
}

interface BackendEmbeddingRow {
    id: string;
    lecture_id: string;
    chunk_text: string;
    embedding: number[];
    source_type: string;
    position: number;
    page_number: number | null;
    created_at: string;
}

const LEGACY_PREFIX = 'embeddings_';
const MIGRATED_FLAG_PREFIX = 'embeddings_migrated_';

function toRecord(row: BackendEmbeddingRow): EmbeddingRecord {
    return {
        id: row.id,
        lectureId: row.lecture_id,
        chunkText: row.chunk_text,
        embedding: row.embedding,
        sourceType: row.source_type === 'transcript' ? 'transcript' : 'pdf',
        position: row.position,
        pageNumber: row.page_number ?? undefined,
        createdAt: row.created_at,
    };
}

function toBackend(r: EmbeddingRecord) {
    return {
        id: r.id,
        lecture_id: r.lectureId,
        chunk_text: r.chunkText,
        embedding: r.embedding,
        source_type: r.sourceType,
        position: r.position,
        page_number: r.pageNumber ?? null,
        created_at: r.createdAt,
    };
}

/// Backend `SearchHit` payload from `semantic_search_*` commands.
/// Shape mirrors `BackendEmbeddingRow` (so we can reuse field names)
/// plus a `similarity` score.
interface BackendSearchHit {
    id: string;
    lecture_id: string;
    chunk_text: string;
    source_type: string;
    position: number;
    page_number: number | null;
    created_at: string;
    similarity: number;
}

function hitToResult(hit: BackendSearchHit): SearchResult {
    return {
        chunk: {
            id: hit.id,
            lectureId: hit.lecture_id,
            chunkText: hit.chunk_text,
            // Omit `embedding` — search consumers only need text + metadata,
            // and skipping it saves a ~1.5 KB copy per result across the IPC.
            embedding: [],
            sourceType: hit.source_type === 'transcript' ? 'transcript' : 'pdf',
            position: hit.position,
            pageNumber: hit.page_number ?? undefined,
            createdAt: hit.created_at,
        },
        similarity: hit.similarity,
    };
}

class EmbeddingStorageService {
    /** One-time migration of legacy localStorage data for a given lecture. */
    private async migrateLegacyIfNeeded(lectureId: string): Promise<void> {
        const flag = `${MIGRATED_FLAG_PREFIX}${lectureId}`;
        if (localStorage.getItem(flag)) return;

        const key = `${LEGACY_PREFIX}${lectureId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
            try {
                const records = JSON.parse(raw) as EmbeddingRecord[];
                if (Array.isArray(records) && records.length) {
                    // cp75.34 — userId for the Rust-side per-batch
                    // lecture-ownership verify.
                    const userId = authService.getUser()?.username || 'default_user';
                    await invoke('save_embeddings', {
                        inputs: records.map(toBackend),
                        userId,
                    });
                }
                localStorage.removeItem(key);
            } catch (e) {
                console.warn('[EmbeddingStorage] Legacy migration skipped:', e);
            }
        }
        localStorage.setItem(flag, '1');
    }

    public async storeEmbedding(chunk: TextChunk, embedding: number[]): Promise<void> {
        const record: EmbeddingRecord = {
            id: chunk.id,
            lectureId: chunk.lectureId,
            chunkText: chunk.text,
            embedding,
            sourceType: chunk.sourceType,
            position: chunk.position,
            pageNumber: chunk.pageNumber,
            createdAt: new Date().toISOString(),
        };
        // cp75.34 — userId for the Rust-side lecture-ownership verify.
        const userId = authService.getUser()?.username || 'default_user';
        await invoke('save_embedding', { input: toBackend(record), userId });
    }

    public async storeEmbeddings(chunks: TextChunk[], embeddings: number[][]): Promise<void> {
        if (chunks.length !== embeddings.length) {
            throw new Error('chunks 和 embeddings 數量不匹配');
        }
        if (!chunks.length) return;

        const now = new Date().toISOString();
        const inputs = chunks.map((chunk, i) =>
            toBackend({
                id: chunk.id,
                lectureId: chunk.lectureId,
                chunkText: chunk.text,
                embedding: embeddings[i],
                sourceType: chunk.sourceType,
                position: chunk.position,
                pageNumber: chunk.pageNumber,
                createdAt: now,
            })
        );
        // cp75.34 — userId for the Rust-side per-batch
        // lecture-ownership verify.
        const userId = authService.getUser()?.username || 'default_user';
        await invoke('save_embeddings', { inputs, userId });
    }

    /**
     * Atomically replace every embedding for a lecture with a fresh set.
     *
     * Uses a single Rust-side transaction (BEGIN; DELETE; INSERT...; COMMIT)
     * so a crash mid-insert rolls back the delete and leaves the prior
     * index intact. Before v0.5.2 the JS-side flow was
     * `deleteByLecture` → loop `save_embedding`, and a crash in the
     * insert loop silently left the lecture with zero embeddings. See
     * audit F-4.
     */
    public async replaceEmbeddingsForLecture(
        lectureId: string,
        chunks: TextChunk[],
        embeddings: number[][],
    ): Promise<void> {
        if (chunks.length !== embeddings.length) {
            throw new Error('chunks 和 embeddings 數量不匹配');
        }
        const now = new Date().toISOString();
        const inputs = chunks.map((chunk, i) =>
            toBackend({
                id: chunk.id,
                lectureId: chunk.lectureId,
                chunkText: chunk.text,
                embedding: embeddings[i],
                sourceType: chunk.sourceType,
                position: chunk.position,
                pageNumber: chunk.pageNumber,
                createdAt: now,
            })
        );
        // cp75.34 — userId for the Rust-side lecture-ownership verify.
        const userId = authService.getUser()?.username || 'default_user';
        await invoke('replace_embeddings_for_lecture', { lectureId, inputs, userId });
    }

    public async getEmbeddingsByLecture(lectureId: string): Promise<EmbeddingRecord[]> {
        await this.migrateLegacyIfNeeded(lectureId);
        const rows = await invoke<BackendEmbeddingRow[]>('get_embeddings_by_lecture', {
            lectureId,
        });
        return rows.map(toRecord);
    }

    public async getChunksByPage(
        lectureId: string,
        pageNumber: number
    ): Promise<EmbeddingRecord[]> {
        const all = await this.getEmbeddingsByLecture(lectureId);
        return all.filter((r) => r.pageNumber === pageNumber);
    }

    /**
     * Semantic search over a single lecture. Delegates to the Rust
     * `semantic_search_lecture` command, which does the whole pipeline
     * (query embed → batched cosine matmul → page boost → top-K) on
     * whichever Candle device the embedding service picked — CUDA on
     * GPU builds, Metal on macOS, CPU otherwise. Previously this ran
     * a per-chunk JS cosine loop on the main renderer thread, which
     * was the last CPU-bound step in the RAG query path.
     */
    public async semanticSearch(
        lectureId: string,
        query: string,
        topK = 5,
        preferredPage?: number
    ): Promise<SearchResult[]> {
        const hits = await invoke<BackendSearchHit[]>('semantic_search_lecture', {
            lectureId,
            query,
            topK,
            preferredPage: preferredPage ?? null,
        });
        return hits.map(hitToResult);
    }

    /**
     * Cross-lecture search scoped to a course. The Rust side unions
     * every lecture's embeddings into a single matrix and runs one
     * matmul against the query, so a 10-lecture × 200-chunk course
     * finishes in the same few ms as a single-lecture search.
     */
    public async semanticSearchByCourse(
        query: string,
        courseId: string,
        topK = 5
    ): Promise<SearchResult[]> {
        const userId = authService.getUser()?.username || 'default_user';
        const hits = await invoke<BackendSearchHit[]>('semantic_search_course', {
            courseId,
            userId,
            query,
            topK,
        });
        return hits.map(hitToResult);
    }

    public async deleteByLecture(lectureId: string): Promise<void> {
        // cp75.34 — userId for the Rust-side lecture-ownership verify.
        const userId = authService.getUser()?.username || 'default_user';
        await invoke('delete_embeddings_by_lecture', { lectureId, userId });
        localStorage.removeItem(`${LEGACY_PREFIX}${lectureId}`);
    }

    public async hasEmbeddings(lectureId: string): Promise<boolean> {
        await this.migrateLegacyIfNeeded(lectureId);
        const count = await invoke<number>('count_embeddings', { lectureId });
        return count > 0;
    }

    public async getStats(
        lectureId: string
    ): Promise<{ total: number; pdf: number; transcript: number }> {
        const records = await this.getEmbeddingsByLecture(lectureId);
        return {
            total: records.length,
            pdf: records.filter((r) => r.sourceType === 'pdf').length,
            transcript: records.filter((r) => r.sourceType === 'transcript').length,
        };
    }
}

export const embeddingStorageService = new EmbeddingStorageService();
