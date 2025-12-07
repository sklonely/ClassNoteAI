import { invoke } from "@tauri-apps/api/core";

class EmbeddingService {
    private isLoaded = false;
    private loadingPromise: Promise<void> | null = null;

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
            // 使用 nomic-embed-text-v1 (中文效果較好)
            const modelDir = `${modelsDir}/nomic-embed-text-v1`;

            // safetensors 模型路徑
            const modelPath = `${modelDir}/model.safetensors`;
            const tokenizerPath = `${modelDir}/tokenizer.json`;

            console.log('[EmbeddingService] 正在加載模型...');
            console.log(`  模型路徑: ${modelPath}`);
            console.log(`  Tokenizer: ${tokenizerPath}`);

            await this.loadModel(modelPath, tokenizerPath);
            this.isLoaded = true;
            console.log('[EmbeddingService] 模型加載成功');
        } catch (error) {
            console.error('[EmbeddingService] 模型加載失敗:', error);
            this.loadingPromise = null;
            throw error;
        }
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
