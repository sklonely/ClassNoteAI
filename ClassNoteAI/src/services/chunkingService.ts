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
     * 將文本分割為 chunks (支援頁面標記)
     * PDF 文本格式: [PAGE:1]\n內容\n\n[PAGE:2]\n內容...
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

        // 解析頁面標記 [PAGE:X]
        const pagePattern = /\[PAGE:(\d+)\]/g;
        const pages: Array<{ pageNumber: number; text: string; startPos: number }> = [];

        let match;
        while ((match = pagePattern.exec(text)) !== null) {
            if (pages.length > 0) {
                // 完成上一頁的文本
                pages[pages.length - 1].text = text.slice(pages[pages.length - 1].startPos, match.index).trim();
            }
            pages.push({
                pageNumber: parseInt(match[1], 10),
                text: '',
                startPos: match.index + match[0].length,
            });
        }

        // 處理最後一頁
        if (pages.length > 0) {
            pages[pages.length - 1].text = text.slice(pages[pages.length - 1].startPos).trim();
        }

        // 如果沒有頁面標記，整體處理
        if (pages.length === 0) {
            return this.chunkTextWithoutPageInfo(text, lectureId, sourceType, opts);
        }

        let chunkIndex = 0;

        // 按頁面處理
        for (const page of pages) {
            if (!page.text || page.text.length < opts.minChunkSize) {
                continue;
            }

            // 如果頁面內容小於 chunkSize，直接作為一個 chunk
            if (page.text.length <= opts.chunkSize) {
                chunks.push({
                    id: `${lectureId}_${sourceType}_${chunkIndex++}`,
                    text: page.text,
                    lectureId,
                    sourceType,
                    position: page.startPos,
                    pageNumber: page.pageNumber,
                });
                continue;
            }

            // 頁面內容較長，需要分塊 (保持相同頁碼)
            const paragraphs = this.splitByParagraphs(page.text);
            let currentChunk = '';

            for (const paragraph of paragraphs) {
                if (paragraph.length > opts.chunkSize) {
                    // 保存當前累積
                    if (currentChunk.length >= opts.minChunkSize) {
                        chunks.push({
                            id: `${lectureId}_${sourceType}_${chunkIndex++}`,
                            text: currentChunk.trim(),
                            lectureId,
                            sourceType,
                            position: page.startPos,
                            pageNumber: page.pageNumber,
                        });
                    }

                    // 分割大段落
                    const subChunks = this.splitLargeParagraph(paragraph, opts);
                    for (const subChunk of subChunks) {
                        chunks.push({
                            id: `${lectureId}_${sourceType}_${chunkIndex++}`,
                            text: subChunk,
                            lectureId,
                            sourceType,
                            position: page.startPos,
                            pageNumber: page.pageNumber,
                        });
                    }
                    currentChunk = '';
                    continue;
                }

                if (currentChunk.length + paragraph.length > opts.chunkSize) {
                    if (currentChunk.length >= opts.minChunkSize) {
                        chunks.push({
                            id: `${lectureId}_${sourceType}_${chunkIndex++}`,
                            text: currentChunk.trim(),
                            lectureId,
                            sourceType,
                            position: page.startPos,
                            pageNumber: page.pageNumber,
                        });
                        currentChunk = paragraph;
                    } else {
                        currentChunk += '\n' + paragraph;
                    }
                } else {
                    currentChunk += (currentChunk ? '\n' : '') + paragraph;
                }
            }

            // 保存頁面最後的 chunk
            if (currentChunk.length >= opts.minChunkSize) {
                chunks.push({
                    id: `${lectureId}_${sourceType}_${chunkIndex++}`,
                    text: currentChunk.trim(),
                    lectureId,
                    sourceType,
                    position: page.startPos,
                    pageNumber: page.pageNumber,
                });
            }
        }

        console.log(`[ChunkingService] 分塊完成: ${chunks.length} 個 chunks，原文長度: ${text.length}，頁數: ${pages.length}`);
        return chunks;
    }

    /**
     * 無頁面資訊時的分塊 (用於 transcript 或無標記 PDF)
     */
    private chunkTextWithoutPageInfo(
        text: string,
        lectureId: string,
        sourceType: 'pdf' | 'transcript',
        opts: ChunkingOptions
    ): TextChunk[] {
        const chunks: TextChunk[] = [];
        const cleanedText = this.cleanText(text);
        const paragraphs = this.splitByParagraphs(cleanedText);

        let currentChunk = '';
        let currentPosition = 0;
        let chunkIndex = 0;

        for (const paragraph of paragraphs) {
            if (paragraph.length > opts.chunkSize) {
                if (currentChunk.length >= opts.minChunkSize) {
                    chunks.push(this.createChunk(currentChunk, lectureId, sourceType, currentPosition, chunkIndex++));
                }
                const subChunks = this.splitLargeParagraph(paragraph, opts);
                for (const subChunk of subChunks) {
                    chunks.push(this.createChunk(subChunk, lectureId, sourceType, currentPosition, chunkIndex++));
                }
                currentChunk = '';
                currentPosition += paragraph.length;
                continue;
            }

            if (currentChunk.length + paragraph.length > opts.chunkSize) {
                if (currentChunk.length >= opts.minChunkSize) {
                    chunks.push(this.createChunk(currentChunk, lectureId, sourceType, currentPosition - currentChunk.length, chunkIndex++));
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

        if (currentChunk.length >= opts.minChunkSize) {
            chunks.push(this.createChunk(currentChunk, lectureId, sourceType, currentPosition - currentChunk.length, chunkIndex));
        }

        console.log(`[ChunkingService] 分塊完成 (無頁碼): ${chunks.length} 個 chunks，原文長度: ${text.length}`);
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
