import { invoke } from "@tauri-apps/api/core";

class EmbeddingService {
    /**
     * 加載 Embedding 模型
     * @param modelPath 模型文件路徑 (.onnx)
     * @param tokenizerPath Tokenizer 文件路徑 (tokenizer.json)
     */
    async loadModel(modelPath: string, tokenizerPath: string): Promise<string> {
        return await invoke("load_embedding_model", { modelPath, tokenizerPath });
    }

    /**
     * 生成文本 Embedding
     * @param text 輸入文本
     * @returns Embedding 向量 (float32 array)
     */
    async generateEmbedding(text: string): Promise<number[]> {
        return await invoke("generate_embedding", { text });
    }

    /**
     * 計算兩個文本的餘弦相似度
     * @param textA 文本 A
     * @param textB 文本 B
     * @returns 相似度分數 (-1.0 ~ 1.0)
     */
    async calculateSimilarity(textA: string, textB: string): Promise<number> {
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
