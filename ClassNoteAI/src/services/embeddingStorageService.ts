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
import { generateLocalEmbedding } from './embeddingService';
import { storageService } from './storageService';
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
                    await invoke('save_embeddings', {
                        inputs: records.map(toBackend),
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
        await invoke('save_embedding', { input: toBackend(record) });
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
        await invoke('save_embeddings', { inputs });
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
     * In-process semantic search over a lecture's embeddings. Optionally
     * boosts matches near `preferredPage` so PDF-slide-aware queries
     * surface locally-relevant chunks first.
     */
    public async semanticSearch(
        lectureId: string,
        query: string,
        topK = 5,
        preferredPage?: number
    ): Promise<SearchResult[]> {
        const queryEmbedding = await generateLocalEmbedding(query);
        const records = await this.getEmbeddingsByLecture(lectureId);
        if (!records.length) return [];

        const scored: SearchResult[] = records.map((chunk) => {
            let sim = cosineSimilarity(queryEmbedding, chunk.embedding);
            if (preferredPage !== undefined && chunk.pageNumber !== undefined) {
                const gap = Math.abs(chunk.pageNumber - preferredPage);
                if (gap <= 5) sim += 0.1;
                else if (gap <= 10) sim += 0.05;
            }
            return { chunk, similarity: sim };
        });

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topK);
    }

    /**
     * Cross-lecture semantic search scoped to a course. Pulls the
     * course's lectures via storageService, unions their embeddings,
     * and ranks them all against `query`.
     */
    public async semanticSearchByCourse(
        query: string,
        courseId: string,
        topK = 5
    ): Promise<SearchResult[]> {
        const lectures = await storageService.listLecturesByCourse(courseId);
        const queryEmbedding = await generateLocalEmbedding(query);
        const all: EmbeddingRecord[] = [];
        for (const lecture of lectures) {
            all.push(...(await this.getEmbeddingsByLecture(lecture.id)));
        }
        return all
            .map((chunk) => ({ chunk, similarity: cosineSimilarity(queryEmbedding, chunk.embedding) }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    public async deleteByLecture(lectureId: string): Promise<void> {
        await invoke('delete_embeddings_by_lecture', { lectureId });
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
