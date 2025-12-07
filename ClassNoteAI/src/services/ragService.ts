/**
 * RAG (Retrieval-Augmented Generation) 服務
 * 整合文本分塊、向量嵌入和語義檢索
 * 使用 Ollama 遠程 nomic-embed-text 模型
 */

import { chunkingService, TextChunk } from './chunkingService';
import { embeddingStorageService, SearchResult } from './embeddingStorageService';
import { ollamaService } from './ollamaService';

export interface RAGContext {
    chunks: SearchResult[];
    formattedContext: string;
}

export interface IndexingProgress {
    stage: 'chunking' | 'embedding' | 'storing';
    current: number;
    total: number;
    message: string;
}

class RAGService {
    /**
     * 為課堂建立索引 (分塊 + 嵌入)
     */
    public async indexLecture(
        lectureId: string,
        pdfText: string | null,
        transcriptText: string | null,
        onProgress?: (progress: IndexingProgress) => void
    ): Promise<{ chunksCount: number; success: boolean }> {
        try {
            const allChunks: TextChunk[] = [];

            // 階段 1: 文本分塊
            onProgress?.({
                stage: 'chunking',
                current: 0,
                total: 2,
                message: '正在分割文本...',
            });

            if (pdfText && pdfText.trim().length > 0) {
                const pdfChunks = chunkingService.chunkText(pdfText, lectureId, 'pdf');
                allChunks.push(...pdfChunks);
                console.log(`[RAGService] PDF 分塊完成: ${pdfChunks.length} 個 chunks`);
            }

            onProgress?.({
                stage: 'chunking',
                current: 1,
                total: 2,
                message: '正在分割轉錄文本...',
            });

            if (transcriptText && transcriptText.trim().length > 0) {
                const transcriptChunks = chunkingService.chunkText(transcriptText, lectureId, 'transcript');
                allChunks.push(...transcriptChunks);
                console.log(`[RAGService] 轉錄分塊完成: ${transcriptChunks.length} 個 chunks`);
            }

            if (allChunks.length === 0) {
                console.log('[RAGService] 沒有可索引的內容');
                return { chunksCount: 0, success: true };
            }

            // 階段 2: 生成嵌入向量
            onProgress?.({
                stage: 'embedding',
                current: 0,
                total: allChunks.length,
                message: '正在生成嵌入向量...',
            });

            const texts = allChunks.map(c => c.text);
            const embeddings: number[][] = [];

            // 使用 Ollama 遠程 nomic-embed-text 模型生成嵌入向量
            const EMBEDDING_MODEL = 'nomic-embed-text';

            for (let i = 0; i < texts.length; i++) {
                const embedding = await ollamaService.generateEmbedding(texts[i], EMBEDDING_MODEL);
                embeddings.push(embedding);

                onProgress?.({
                    stage: 'embedding',
                    current: i + 1,
                    total: texts.length,
                    message: `生成嵌入向量 (${i + 1}/${texts.length})`,
                });
            }

            // 階段 3: 存儲到數據庫
            onProgress?.({
                stage: 'storing',
                current: 0,
                total: 1,
                message: '正在存儲索引...',
            });

            // 先清除舊的嵌入向量
            await embeddingStorageService.deleteByLecture(lectureId);

            // 存儲新的嵌入向量
            await embeddingStorageService.storeEmbeddings(allChunks, embeddings);

            onProgress?.({
                stage: 'storing',
                current: 1,
                total: 1,
                message: '索引完成',
            });

            console.log(`[RAGService] 課堂 ${lectureId} 索引完成: ${allChunks.length} 個 chunks`);
            return { chunksCount: allChunks.length, success: true };
        } catch (error) {
            console.error('[RAGService] 索引失敗:', error);
            return { chunksCount: 0, success: false };
        }
    }

    /**
     * 語義檢索增強
     */
    public async retrieveContext(
        query: string,
        lectureId: string,
        topK: number = 5
    ): Promise<RAGContext> {
        const results = await embeddingStorageService.semanticSearch(query, lectureId, topK);

        // 格式化上下文
        const formattedContext = this.formatContext(results);

        return {
            chunks: results,
            formattedContext,
        };
    }

    /**
     * 跨課堂語義檢索 (課程級別)
     */
    public async retrieveCourseContext(
        query: string,
        courseId: string,
        topK: number = 5
    ): Promise<RAGContext> {
        const results = await embeddingStorageService.semanticSearchByCourse(query, courseId, topK);
        const formattedContext = this.formatContext(results);

        return {
            chunks: results,
            formattedContext,
        };
    }

    /**
     * RAG 增強問答
     */
    public async chat(
        question: string,
        lectureId: string,
        options?: {
            topK?: number;
            systemPrompt?: string;
            model?: string;
        }
    ): Promise<{ answer: string; sources: SearchResult[] }> {
        const topK = options?.topK || 5;

        // 檢索相關上下文
        const context = await this.retrieveContext(question, lectureId, topK);

        if (context.chunks.length === 0) {
            // 沒有找到相關內容，使用通用回答
            const answer = await ollamaService.generate(question, {
                system: options?.systemPrompt || '你是一個專業的課程助教，請用繁體中文回答。',
                model: options?.model,
            });
            return { answer, sources: [] };
        }

        // 構建增強的系統提示
        const enhancedSystemPrompt = this.buildEnhancedPrompt(
            options?.systemPrompt || '你是一個專業的課程助教，請用繁體中文回答。',
            context.formattedContext
        );

        // 生成回答
        const answer = await ollamaService.generate(question, {
            system: enhancedSystemPrompt,
            model: options?.model,
        });

        return {
            answer,
            sources: context.chunks,
        };
    }

    /**
     * 格式化檢索到的上下文
     */
    private formatContext(results: SearchResult[]): string {
        if (results.length === 0) return '';

        const sections = results.map((result, index) => {
            const source = result.chunk.sourceType === 'pdf'
                ? `講義${result.chunk.pageNumber ? ` (第${result.chunk.pageNumber}頁)` : ''}`
                : '課堂錄音';

            return `[來源 ${index + 1}: ${source}]\n${result.chunk.chunkText}`;
        });

        return sections.join('\n\n');
    }

    /**
     * 構建增強的系統提示
     */
    private buildEnhancedPrompt(basePrompt: string, context: string): string {
        return `${basePrompt}

以下是與用戶問題相關的課程內容，請基於這些內容回答問題：

${context}

請注意：
1. 優先使用上述內容回答問題
2. 如果內容不足以回答，請說明
3. 回答時可以引用來源編號 (如 [來源 1])`;
    }

    /**
     * 檢查課堂是否已建立索引
     */
    public async hasIndex(lectureId: string): Promise<boolean> {
        return embeddingStorageService.hasEmbeddings(lectureId);
    }

    /**
     * 獲取索引統計
     */
    public async getIndexStats(lectureId: string): Promise<{ total: number; pdf: number; transcript: number }> {
        return embeddingStorageService.getStats(lectureId);
    }

    /**
     * 刪除課堂索引
     */
    public async deleteIndex(lectureId: string): Promise<void> {
        await embeddingStorageService.deleteByLecture(lectureId);
    }
}

export const ragService = new RAGService();
