/**
 * 文本分塊服務
 * 將長文本分割為適合 embedding 的小塊
 */

export interface TextChunk {
    id: string;
    text: string;
    lectureId: string;
    sourceType: 'pdf' | 'transcript';
    position: number;      // 在原文中的起始位置
    pageNumber?: number;   // PDF 頁碼 (僅 PDF)
    metadata?: Record<string, any>;
}

export interface ChunkingOptions {
    chunkSize: number;      // 每個 chunk 的最大字符數
    chunkOverlap: number;   // chunk 之間的重疊字符數
    minChunkSize: number;   // 最小 chunk 大小，小於此值會合併到前一個
}

const DEFAULT_OPTIONS: ChunkingOptions = {
    chunkSize: 512,
    chunkOverlap: 50,
    minChunkSize: 100,
};

class ChunkingService {
    /**
     * 將文本分割為 chunks
     */
    public chunkText(
        text: string,
        lectureId: string,
        sourceType: 'pdf' | 'transcript',
        options: Partial<ChunkingOptions> = {}
    ): TextChunk[] {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const chunks: TextChunk[] = [];

        if (!text || text.trim().length === 0) {
            return chunks;
        }

        // 清理文本
        const cleanedText = this.cleanText(text);

        // 按段落分割，保持語義完整性
        const paragraphs = this.splitByParagraphs(cleanedText);

        let currentChunk = '';
        let currentPosition = 0;
        let chunkIndex = 0;

        for (const paragraph of paragraphs) {
            // 如果單個段落超過 chunkSize，需要進一步分割
            if (paragraph.length > opts.chunkSize) {
                // 先保存當前累積的 chunk
                if (currentChunk.length >= opts.minChunkSize) {
                    chunks.push(this.createChunk(
                        currentChunk,
                        lectureId,
                        sourceType,
                        currentPosition,
                        chunkIndex++
                    ));
                }

                // 分割大段落
                const subChunks = this.splitLargeParagraph(paragraph, opts);
                for (const subChunk of subChunks) {
                    chunks.push(this.createChunk(
                        subChunk,
                        lectureId,
                        sourceType,
                        currentPosition,
                        chunkIndex++
                    ));
                }

                currentChunk = '';
                currentPosition += paragraph.length;
                continue;
            }

            // 如果加入這個段落會超過 chunkSize，先保存當前 chunk
            if (currentChunk.length + paragraph.length > opts.chunkSize) {
                if (currentChunk.length >= opts.minChunkSize) {
                    chunks.push(this.createChunk(
                        currentChunk,
                        lectureId,
                        sourceType,
                        currentPosition - currentChunk.length,
                        chunkIndex++
                    ));

                    // 保留 overlap
                    const overlapText = currentChunk.slice(-opts.chunkOverlap);
                    currentChunk = overlapText + paragraph;
                } else {
                    currentChunk += '\n' + paragraph;
                }
            } else {
                currentChunk += (currentChunk ? '\n' : '') + paragraph;
            }

            currentPosition += paragraph.length;
        }

        // 保存最後一個 chunk
        if (currentChunk.length >= opts.minChunkSize) {
            chunks.push(this.createChunk(
                currentChunk,
                lectureId,
                sourceType,
                currentPosition - currentChunk.length,
                chunkIndex
            ));
        }

        console.log(`[ChunkingService] 分塊完成: ${chunks.length} 個 chunks，原文長度: ${text.length}`);
        return chunks;
    }

    /**
     * 清理文本
     */
    private cleanText(text: string): string {
        return text
            .replace(/\r\n/g, '\n')           // 統一換行符
            .replace(/\n{3,}/g, '\n\n')       // 多個換行變兩個
            .replace(/[ \t]+/g, ' ')          // 多個空格變一個
            .trim();
    }

    /**
     * 按段落分割文本
     */
    private splitByParagraphs(text: string): string[] {
        return text
            .split(/\n\n+/)
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    /**
     * 分割超大段落
     */
    private splitLargeParagraph(paragraph: string, opts: ChunkingOptions): string[] {
        const chunks: string[] = [];
        const sentences = paragraph.split(/(?<=[。！？.!?])\s*/);

        let currentChunk = '';

        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length > opts.chunkSize) {
                if (currentChunk.length >= opts.minChunkSize) {
                    chunks.push(currentChunk.trim());
                    // 保留 overlap
                    currentChunk = currentChunk.slice(-opts.chunkOverlap) + sentence;
                } else {
                    currentChunk += sentence;
                }
            } else {
                currentChunk += sentence;
            }
        }

        if (currentChunk.length >= opts.minChunkSize) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /**
     * 創建 chunk 對象
     */
    private createChunk(
        text: string,
        lectureId: string,
        sourceType: 'pdf' | 'transcript',
        position: number,
        index: number
    ): TextChunk {
        return {
            id: `${lectureId}_${sourceType}_${index}`,
            text: text.trim(),
            lectureId,
            sourceType,
            position,
        };
    }

    /**
     * 將 PDF 按頁面分塊
     */
    public chunkPdfByPages(
        pages: { pageNumber: number; text: string }[],
        lectureId: string,
        options: Partial<ChunkingOptions> = {}
    ): TextChunk[] {
        const allChunks: TextChunk[] = [];

        for (const page of pages) {
            const pageChunks = this.chunkText(page.text, lectureId, 'pdf', options);

            // 添加頁碼信息
            for (const chunk of pageChunks) {
                chunk.pageNumber = page.pageNumber;
                chunk.id = `${lectureId}_pdf_p${page.pageNumber}_${allChunks.length}`;
                allChunks.push(chunk);
            }
        }

        return allChunks;
    }
}

export const chunkingService = new ChunkingService();
