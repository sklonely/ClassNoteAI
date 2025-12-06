/**
 * 向量存儲服務
 * 使用 localStorage 作為快速原型 (Phase 1)
 * TODO Phase 2: 遷移到 Rust 後端 SQLite
 */

import { embeddingService } from './embeddingService';
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

const STORAGE_KEY_PREFIX = 'embeddings_';

class EmbeddingStorageService {
    /**
     * 獲取存儲 key
     */
    private getStorageKey(lectureId: string): string {
        return `${STORAGE_KEY_PREFIX}${lectureId}`;
    }

    /**
     * 存儲單個嵌入向量
     */
    public async storeEmbedding(
        chunk: TextChunk,
        embedding: number[]
    ): Promise<void> {
        const records = await this.getEmbeddingsByLecture(chunk.lectureId);

        // 檢查是否已存在，如果存在則更新
        const existingIndex = records.findIndex(r => r.id === chunk.id);

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

        if (existingIndex >= 0) {
            records[existingIndex] = record;
        } else {
            records.push(record);
        }

        localStorage.setItem(this.getStorageKey(chunk.lectureId), JSON.stringify(records));
    }

    /**
     * 批量存儲嵌入向量
     */
    public async storeEmbeddings(
        chunks: TextChunk[],
        embeddings: number[][]
    ): Promise<void> {
        if (chunks.length !== embeddings.length) {
            throw new Error('chunks 和 embeddings 數量不匹配');
        }

        if (chunks.length === 0) return;

        const lectureId = chunks[0].lectureId;
        const records: EmbeddingRecord[] = chunks.map((chunk, i) => ({
            id: chunk.id,
            lectureId: chunk.lectureId,
            chunkText: chunk.text,
            embedding: embeddings[i],
            sourceType: chunk.sourceType,
            position: chunk.position,
            pageNumber: chunk.pageNumber,
            createdAt: new Date().toISOString(),
        }));

        localStorage.setItem(this.getStorageKey(lectureId), JSON.stringify(records));
        console.log(`[EmbeddingStorageService] 已存儲 ${records.length} 個嵌入向量`);
    }

    /**
     * 獲取課堂的所有嵌入向量
     */
    public async getEmbeddingsByLecture(lectureId: string): Promise<EmbeddingRecord[]> {
        const data = localStorage.getItem(this.getStorageKey(lectureId));
        if (!data) return [];

        try {
            return JSON.parse(data) as EmbeddingRecord[];
        } catch {
            return [];
        }
    }

    /**
     * 語義搜索：找到最相似的 chunks
     */
    public async semanticSearch(
        query: string,
        lectureId: string,
        topK: number = 5
    ): Promise<SearchResult[]> {
        // 使用本地 ONNX 模型生成查詢的嵌入向量
        const queryEmbedding = await embeddingService.generateEmbedding(query);

        // 獲取課堂的所有嵌入向量
        const records = await this.getEmbeddingsByLecture(lectureId);

        if (records.length === 0) {
            console.log('[EmbeddingStorageService] 沒有找到嵌入向量');
            return [];
        }

        // 計算相似度並排序
        const results: SearchResult[] = records.map(record => ({
            chunk: record,
            similarity: embeddingService.cosineSimilarityVector(queryEmbedding, record.embedding),
        }));

        // 按相似度降序排序，取 topK
        results.sort((a, b) => b.similarity - a.similarity);
        const topResults = results.slice(0, topK);

        console.log(`[EmbeddingStorageService] 搜索完成，返回 ${topResults.length} 個結果`);
        return topResults;
    }

    /**
     * 跨課堂語義搜索（課程級別）
     * TODO: 需要從 storageService 獲取課程下的所有課堂
     */
    public async semanticSearchByCourse(
        _query: string,
        _courseId: string,
        _topK: number = 5,
        _embeddingModel: string = 'nomic-embed-text'
    ): Promise<SearchResult[]> {
        // 暫時返回空結果，Phase 2 實現
        console.log('[EmbeddingStorageService] 跨課堂搜索尚未實現');
        return [];
    }

    /**
     * 刪除課堂的所有嵌入向量
     */
    public async deleteByLecture(lectureId: string): Promise<void> {
        localStorage.removeItem(this.getStorageKey(lectureId));
        console.log(`[EmbeddingStorageService] 已刪除課堂 ${lectureId} 的所有嵌入向量`);
    }

    /**
     * 檢查課堂是否已有嵌入向量
     */
    public async hasEmbeddings(lectureId: string): Promise<boolean> {
        const records = await this.getEmbeddingsByLecture(lectureId);
        return records.length > 0;
    }

    /**
     * 獲取嵌入向量統計
     */
    public async getStats(lectureId: string): Promise<{ total: number; pdf: number; transcript: number }> {
        const records = await this.getEmbeddingsByLecture(lectureId);

        let pdf = 0, transcript = 0;
        for (const record of records) {
            if (record.sourceType === 'pdf') pdf++;
            if (record.sourceType === 'transcript') transcript++;
        }

        return { total: records.length, pdf, transcript };
    }
}

export const embeddingStorageService = new EmbeddingStorageService();
