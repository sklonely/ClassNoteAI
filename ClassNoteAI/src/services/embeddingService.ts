import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

class EmbeddingService {
    private isLoaded = false;
    private loadingPromise: Promise<void> | null = null;
    /** In-flight download promise. Deduplicated so parallel `ensureLoaded`
     *  calls share one download instead of racing each other. */
    private downloadPromise: Promise<void> | null = null;
    /** Latest progress value (0-100) for any UI that wants to poll while
     *  the download runs. Frontend consumers can alternatively subscribe
     *  to the Tauri event `embedding_download_progress`. */
    public downloadProgress: number = 0;

    /**
     * 獲取 Embedding 模型目錄
     */
    private async getModelDir(): Promise<string> {
        return await invoke("get_embedding_models_dir");
    }

    /**
     * 確保模型已加載
     */
    async ensureLoaded(): Promise<void> {
        if (this.isLoaded) return;

        // 如果正在加載中，等待加載完成
        if (this.loadingPromise) {
            await this.loadingPromise;
            return;
        }

        this.loadingPromise = this.doLoad();
        await this.loadingPromise;
    }

    private async doLoad(): Promise<void> {
        try {
            const modelsDir = await this.getModelDir();
            // BAAI/bge-small-en-v1.5 — 標準 BERT (384-d, ~33MB)，Candle 原生支援。
            // v0.5.2 從 nomic-embed-text-v1 換過來，因為 nomic 是 NomicBert
            // 架構（rotary + SwiGLU），Candle 的 BertModel::load 無法載入。
            // 中文 query 由 ragService 先透過 LLM 翻譯成英文再 embed。
            const modelDir = `${modelsDir}/bge-small-en-v1.5`;

            // safetensors 模型路徑
            const modelPath = `${modelDir}/model.safetensors`;
            const tokenizerPath = `${modelDir}/tokenizer.json`;

            console.log('[EmbeddingService] 正在加載模型...');
            console.log(`  模型路徑: ${modelPath}`);
            console.log(`  Tokenizer: ${tokenizerPath}`);

            try {
                await this.loadModel(modelPath, tokenizerPath);
            } catch (err) {
                // v0.5.2 migration: users upgrading from <=v0.5.1 still have
                // nomic-embed-text-v1 on disk but not bge-small-en-v1.5.
                // Auto-download on the first failed load so the AI 助教
                // feature "just works" instead of showing a cryptic
                // "Model file not found" error. Download is a shared
                // promise — concurrent `ensureLoaded` calls piggy-back.
                //
                // Match broadly: "not found" covers fresh upgrades,
                // "損壞" / "下載未完成" covers the partial-download case
                // that service.rs::new specifically rejects. All of these
                // have the same fix (download the files) and the Rust
                // downloader now detects + repairs truncated files so a
                // second attempt is safe.
                const msg = String(err);
                const needsDownload =
                    msg.includes('not found') ||
                    msg.includes('Model file not found') ||
                    msg.includes('損壞') ||
                    msg.includes('下載未完成');
                if (!needsDownload) throw err;
                console.warn('[EmbeddingService] 偵測到模型檔案缺失/不完整，自動下載 (~33MB)...');
                await this.ensureDownloaded();
                // Retry. If this second attempt also fails, surface the
                // real error — something is wrong beyond a missing file.
                await this.loadModel(modelPath, tokenizerPath);
            }
            this.isLoaded = true;
            console.log('[EmbeddingService] 模型加載成功');
        } catch (error) {
            console.error('[EmbeddingService] 模型加載失敗:', error);
            this.loadingPromise = null;
            throw error;
        }
    }

    /** Trigger a fresh download of the bge-small-en-v1.5 model via the
     *  existing Tauri command. Subscribes to the
     *  `embedding_download_progress` event so callers can poll
     *  `downloadProgress` for a progress bar. Deduplicated — calling
     *  this while a download is in flight returns the same promise. */
    async ensureDownloaded(): Promise<void> {
        if (this.downloadPromise) return this.downloadPromise;
        this.downloadProgress = 0;
        let unlisten: UnlistenFn | null = null;
        this.downloadPromise = (async () => {
            try {
                unlisten = await listen<number>('embedding_download_progress', (e) => {
                    this.downloadProgress = e.payload;
                });
                await invoke('download_embedding_model_cmd');
                this.downloadProgress = 100;
            } finally {
                if (unlisten) unlisten();
                // Null out AFTER success so a failed download doesn't
                // leave `downloadPromise` stuck in rejected state, but
                // a successful one is cached for the life of the session.
                if (this.downloadProgress < 100) this.downloadPromise = null;
            }
        })();
        return this.downloadPromise;
    }

    /**
     * 加載 Embedding 模型
     * @param modelPath 模型文件路徑 (.safetensors)
     * @param tokenizerPath Tokenizer 文件路徑 (tokenizer.json)
     */
    async loadModel(modelPath: string, tokenizerPath: string): Promise<string> {
        return await invoke("load_embedding_model", { modelPath, tokenizerPath });
    }

    /**
     * 生成文本 Embedding (自動加載模型)
     * @param text 輸入文本
     * @returns Embedding 向量 (float32 array)
     */
    async generateEmbedding(text: string): Promise<number[]> {
        await this.ensureLoaded();
        return await invoke("generate_embedding", { text });
    }

    /**
     * 計算兩個文本的餘弦相似度
     * @param textA 文本 A
     * @param textB 文本 B
     * @returns 相似度分數 (-1.0 ~ 1.0)
     */
    async calculateSimilarity(textA: string, textB: string): Promise<number> {
        await this.ensureLoaded();
        return await invoke("calculate_similarity", { textA, textB });
    }

    /**
     * 計算兩個向量的餘弦相似度 (純前端計算，避免頻繁調用後端)
     */
    cosineSimilarityVector(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

export const embeddingService = new EmbeddingService();

/**
 * Convenience wrapper for callers that only need a text → vector call.
 * Routed through the local Candle-backed model, not the cloud.
 */
export async function generateLocalEmbedding(text: string): Promise<number[]> {
    return embeddingService.generateEmbedding(text);
}
