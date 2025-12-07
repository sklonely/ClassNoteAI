import { ollamaService } from './ollamaService';

export interface PageEmbedding {
    pageNumber: number;
    text: string;
    embedding: number[];
}

export interface AlignmentSuggestion {
    pageNumber: number;
    confidence: number;
    reason: string;
}

type AlignmentListener = (suggestion: AlignmentSuggestion) => void;

class AutoAlignmentService {
    private pageEmbeddings: PageEmbedding[] = [];
    private transcriptionBuffer: string = '';
    private bufferWindowSize: number = 200; // 字符數
    private lastCheckTime: number = 0;
    private checkInterval: number = 5000; // 5秒檢查一次
    private listeners: AlignmentListener[] = [];
    private isEnabled: boolean = true;

    /**
     * 設置頁面 Embeddings
     */
    public setPageEmbeddings(embeddings: PageEmbedding[]) {
        this.pageEmbeddings = embeddings;
        console.log(`[AutoAlignment] Loaded ${embeddings.length} page embeddings`);
    }

    /**
     * 添加轉錄文本到緩衝區
     */
    public addTranscription(text: string) {
        if (!this.isEnabled || this.pageEmbeddings.length === 0) return;

        this.transcriptionBuffer += text + ' ';

        // 保持緩衝區大小
        if (this.transcriptionBuffer.length > this.bufferWindowSize * 2) {
            this.transcriptionBuffer = this.transcriptionBuffer.slice(-this.bufferWindowSize);
        }

        // 檢查是否需要執行對齊
        const now = Date.now();
        if (now - this.lastCheckTime > this.checkInterval) {
            this.checkAlignment();
            this.lastCheckTime = now;
        }
    }

    private lastBestPage: number = -1;
    private stabilityCounter: number = 0;
    private currentPage: number = 1; // Track current verified page

    /**
     * 執行對齊檢查
     */
    private async checkAlignment() {
        if (this.transcriptionBuffer.length < 50) return; // 內容太少不檢查

        try {
            // 生成緩衝區的 Embedding
            // 取最後一段文本進行匹配
            const textToCheck = this.transcriptionBuffer.slice(-this.bufferWindowSize);
            const EMBEDDING_MODEL = 'nomic-embed-text';
            const bufferEmbedding = await ollamaService.generateEmbedding(textToCheck, EMBEDDING_MODEL);

            let bestPage = -1;
            let maxSimilarity = -1;

            // 與每一頁進行比對
            for (const page of this.pageEmbeddings) {
                let similarity = ollamaService.cosineSimilarity(bufferEmbedding, page.embedding);

                // Locality Bias: 給當前頁和相鄰頁一點加成，防止亂跳
                // 如果是當前頁或下一頁，加成 5%
                if (page.pageNumber === this.currentPage || page.pageNumber === this.currentPage + 1) {
                    similarity *= 1.05;
                }

                if (similarity > maxSimilarity) {
                    maxSimilarity = similarity;
                    bestPage = page.pageNumber;
                }
            }

            console.log(`[AutoAlignment] Best match: Page ${bestPage}, Similarity: ${maxSimilarity.toFixed(4)}`);

            // 閾值判斷 (提高到 0.35)
            if (maxSimilarity > 0.35) {
                // 穩定性檢測 (Smoothing)
                if (bestPage === this.lastBestPage) {
                    this.stabilityCounter++;
                } else {
                    this.stabilityCounter = 0;
                    this.lastBestPage = bestPage;
                }

                // 只有連續 2 次檢測到同一頁才切換 (約 10秒穩定)
                // 或者如果相似度非常高 (>0.6)，則立即切換
                if (this.stabilityCounter >= 1 || maxSimilarity > 0.6) {
                    if (bestPage !== this.currentPage) {
                        this.currentPage = bestPage;
                        this.notifyListeners({
                            pageNumber: bestPage,
                            confidence: maxSimilarity,
                            reason: `Context match (${(maxSimilarity * 100).toFixed(1)}%)`
                        });
                        // 重置穩定性，避免重複觸發
                        this.stabilityCounter = 0;
                    }
                }
            }
        } catch (error) {
            console.error('[AutoAlignment] Alignment check failed:', error);
        }
    }

    /**
     * 訂閱對齊建議
     */
    public onSuggestion(listener: AlignmentListener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners(suggestion: AlignmentSuggestion) {
        this.listeners.forEach(l => l(suggestion));
    }

    public setEnabled(enabled: boolean) {
        this.isEnabled = enabled;
    }

    public clear() {
        this.transcriptionBuffer = '';
        this.pageEmbeddings = [];
    }
}

export const autoAlignmentService = new AutoAlignmentService();
