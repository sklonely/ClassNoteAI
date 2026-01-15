import { storageService } from './storageService';
import { fetch } from '@tauri-apps/plugin-http';
import { taskService } from './taskService';

export interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        families: string[] | null;
        parameter_size: string;
        quantization_level: string;
    };
}

export interface OllamaResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    context?: number[];
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

class OllamaService {
    private defaultHost = 'http://100.118.7.50:11434';

    /**
     * 獲取 Ollama Host 地址
     */
    private async getHost(): Promise<string> {
        const settings = await storageService.getAppSettings();
        let host = settings?.ollama?.host || this.defaultHost;
        // 確保 host 不以 / 結尾
        if (host.endsWith('/')) {
            host = host.slice(0, -1);
        }
        return host;
    }

    /**
     * 獲取選定的模型（預設/向後相容）
     */
    private async getModel(): Promise<string> {
        const settings = await storageService.getAppSettings();
        return settings?.ollama?.model || 'qwen3:235b-a22b';
    }

    /**
     * 獲取 AI 模型分層配置
     */
    public async getAiModelConfig() {
        const settings = await storageService.getAppSettings();
        const defaults = {
            embedding: 'nomic-embed-text',
            light: 'qwen3:8b',
            standard: 'qwen3:8b',
            heavy: 'qwen3:235b-a22b'
        };
        return settings?.ollama?.aiModels || defaults;
    }

    /**
     * 獲取輕量任務模型 (關鍵詞、壓縮)
     */
    public async getLightModel(): Promise<string> {
        const config = await this.getAiModelConfig();
        return config.light;
    }

    /**
     * 獲取標準任務模型 (RAG、對話)
     */
    public async getStandardModel(): Promise<string> {
        const config = await this.getAiModelConfig();
        return config.standard;
    }

    /**
     * 獲取重量任務模型 (總結)
     */
    public async getHeavyModel(): Promise<string> {
        const config = await this.getAiModelConfig();
        return config.heavy;
    }

    /**
     * 獲取 Embedding 模型
     */
    public async getEmbeddingModel(): Promise<string> {
        const config = await this.getAiModelConfig();
        return config.embedding;
    }

    /**
     * 檢查服務是否可用
     */
    public async checkConnection(host?: string): Promise<boolean> {
        try {
            const baseUrl = host || await this.getHost();
            const response = await fetch(`${baseUrl}/api/tags`);
            return response.ok;
        } catch (error) {
            console.error('[OllamaService] 連接檢查失敗:', error);
            return false;
        }
    }

    /**
     * 獲取可用模型列表
     */
    /**
     * 獲取可用模型列表
     */
    public async listModels(hostOverride?: string): Promise<OllamaModel[]> {
        try {
            const host = hostOverride || await this.getHost();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超時

            try {
                const response = await fetch(`${host}/api/tags`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`Failed to fetch models: ${response.statusText}`);
                }
                const data = await response.json();
                return data.models || [];
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        } catch (error) {
            console.error('[OllamaService] 獲取模型列表失敗:', error);
            throw error;
        }
    }

    /**
     * 生成文本 (Completion)
     */
    public async generate(prompt: string, options?: { model?: string, system?: string }): Promise<string> {
        // Check network connectivity first
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            throw new Error('目前處於離線狀態，無法連接 AI 服務。請恢復網路連線後再試。');
        }

        try {
            const host = await this.getHost();
            const model = options?.model || await this.getModel();

            console.log(`[OllamaService] 生成中... 模型: ${model}, Host: ${host}`);
            console.log('[OllamaService] === 輸入詳情 ===');
            console.log('[OllamaService] System Prompt 長度:', options?.system?.length || 0, '字元');
            console.log('[OllamaService] System Prompt:', options?.system?.slice(0, 500), options?.system && options.system.length > 500 ? '...(截斷)' : '');
            console.log('[OllamaService] User Prompt 長度:', prompt.length, '字元');
            console.log('[OllamaService] User Prompt:', prompt.slice(0, 500), prompt.length > 500 ? '...(截斷)' : '');
            console.log('[OllamaService] === 輸入詳情結束 ===');

            const response = await fetch(`${host}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    prompt,
                    system: options?.system,
                    stream: false, // 暫時不使用流式傳輸，簡化處理
                    options: {
                        temperature: 0.7,
                    }
                }),
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`);
            }

            const data = await response.json() as OllamaResponse;
            console.log('[OllamaService] 回應長度:', data.response?.length || 0, '字元');
            return data.response;
        } catch (error) {
            console.error('[OllamaService] 生成失敗:', error);
            throw error;
        }
    }

    /**
     * 對話式生成 (支持對話歷史)
     * 使用 Ollama /api/chat 端點
     */
    /**
     * 對話式生成 (Server-First)
     */
    public async chat(
        messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
        options?: { model?: string; system?: string; lectureId?: string }
    ): Promise<string> {
        // If lectureId is provided, used for context logging or RAG in future.
        const lectureId = options?.lectureId || 'temp_chat';

        // Combine system prompt with messages
        const allMessages = options?.system
            ? [{ role: 'system' as const, content: options.system }, ...messages]
            : messages;

        console.log(`[OllamaService] 觸發 Chat 任務 (Server-First)... Lecture: ${lectureId}`);

        try {
            // 1. Trigger Task (Priority 1)
            const task = await taskService.triggerChat(lectureId, allMessages);

            if (!task) {
                // Queued offline
                return "已離線，訊息已加入佇列。恢復連線後將自動發送。";
            }

            // 2. Poll for completion
            // Note: For Chat, we might want faster polling or SSE.
            const result = await taskService.pollUntilCompletion(task.id, 1000); // 1s polling

            const content = result.result?.content || '';
            return content;

        } catch (error) {
            console.error('[OllamaService] Chat 任務失敗:', error);
            throw error;
        }
    }

    /**
     * 從文本中提取關鍵詞
     */
    public async extractKeywords(text: string): Promise<string[]> {
        const prompt = `
      Analyze the following course text and extract 15-20 essential technical keywords.
      
      CRITICAL INSTRUCTIONS:
      1. EXTRACT ONLY: Domain-specific jargon, technical concepts, theories, algorithms, and acronyms.
      2. EXCLUDE: 
         - Administrative details (e.g., "office hours", "syllabus", "grading", "exams", "homework").
         - Locations and Universities (e.g., "Oregon State University", "Kelley Engineering Center").
         - Names of people (instructors, TAs).
         - Generic academic terms (e.g., "textbook", "chapter", "edition", "course").
         - Policies (e.g., "citation", "disability accommodations", "conduct").
      3. FORMAT: Return ONLY a comma-separated list of keywords. No numbering, no bullet points.

      Text:
      ${text.slice(0, 4000)}... (truncated)
    `;

        try {
            const lightModel = await this.getLightModel();
            const response = await this.generate(prompt, {
                model: lightModel,
                system: "You are a helpful assistant that extracts technical keywords from text."
            });

            // 清理和分割結果
            return response
                .split(/[,，\n]/)
                .map(k => k.trim())
                .filter(k => k.length > 0 && !k.toLowerCase().includes('keyword'));
        } catch (error) {
            console.error('[OllamaService] 關鍵詞提取失敗:', error);
            return [];
        }
    }

    /**
     * 生成課程總結
     */
    /**
     * 生成課程總結 (Deep Summarization)
     * @param text 錄音轉錄文本
     * @param language 目標語言
     * @param pdfContext PDF 課件內容 (可選，用於增強結構和術語準確性)
     */
    public async summarizeCourse(text: string, language: 'zh' | 'en' = 'zh', pdfContext?: string): Promise<string> {
        const systemPrompt = language === 'zh'
            ? "你是一個專業的課程助教。請根據提供的課程內容生成一份詳細的總結。如果提供了 PDF 課件內容，請以其為結構骨架，並結合錄音內容進行補充和解釋。請確保術語準確，邏輯清晰。使用 Markdown 格式。請用繁體中文回答。"
            : "You are a professional teaching assistant. Please generate a detailed summary based on the provided course content. If PDF slides content is provided, use it as the structural backbone and supplement it with the lecture recording for explanation. Ensure accurate terminology and clear logic. Use Markdown format.";

        // 截斷處理
        const maxTextLen = pdfContext ? 8000 : 12000; // 如果有 PDF，減少轉錄文本長度以留空間
        const truncatedText = text.length > maxTextLen ? text.slice(0, maxTextLen) + "...(content truncated)" : text;

        let prompt = "";

        if (pdfContext) {
            // Deep Summarization Prompt
            const truncatedPdf = pdfContext.length > 8000 ? pdfContext.slice(0, 8000) + "...(pdf truncated)" : pdfContext;
            prompt = `
            Please synthesize the following sources into a comprehensive course summary:
            
            SOURCE 1: Course Slides (Structure & Key Terms)
            ${truncatedPdf}
            
            SOURCE 2: Lecture Transcript (Explanation & Details)
            ${truncatedText}
            
            Instructions:
            1. Use the Slides to determine the main topics and structure.
            2. Use the Transcript to provide detailed explanations and examples for each topic.
            3. Correct any potential transcription errors using terms found in the Slides.
            `;
        } else {
            // Standard Summarization Prompt
            prompt = `
            Please summarize the following course content:
            
            ${truncatedText}
            `;
        }

        const heavyModel = await this.getHeavyModel();
        return await this.generate(prompt, { model: heavyModel, system: systemPrompt });
    }
    /**
     * 從文本中提取課程大綱結構化信息
     */
    public async extractSyllabusInfo(text: string): Promise<any> {
        const prompt = `
      Analyze the following course text and extract structured syllabus information.
      
      CRITICAL INSTRUCTIONS:
      1. EXTRACT the following fields into a JSON object:
         - "topic": What is this course mainly about? (Short summary)
         - "time": Meeting times (e.g., "Mon/Wed/Fri 11:00-11:50am")
         - "instructor": Instructor's name
         - "office_hours": Instructor's office hours and location (e.g., "Mon 2-3pm at KEC 100")
         - "teaching_assistants": TA names and their office hours (e.g., "John Doe (Fri 10am)")
         - "location": Class location
         - "grading": An array of objects, each with "item" (e.g., "Homework") and "percentage" (e.g., "60%")
         - "schedule": An array of strings, each representing a weekly topic or lecture title (e.g., ["Week 1: Introduction", "Week 2: DFA"])
      
      2. FORMAT: Return ONLY the valid JSON object. No markdown formatting, no other text.
      3. LANGUAGE: Translate the content to Traditional Chinese (繁體中文) if the input is in English, but keep proper nouns (like "DFA") in English if appropriate.

      Text:
      ${text.slice(0, 6000)}... (truncated)
    `;

        try {
            const lightModel = await this.getLightModel();
            const response = await this.generate(prompt, {
                model: lightModel,
                system: "You are a helpful assistant that extracts structured course information into JSON format."
            });

            // 嘗試解析 JSON
            try {
                // 清理可能存在的 Markdown 代碼塊標記
                const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(jsonStr);
            } catch (e) {
                console.error('[OllamaService] JSON 解析失敗:', e);
                return {};
            }
        } catch (error) {
            console.error('[OllamaService] 大綱提取失敗:', error);
            return {};
        }
    }

    /**
     * 生成文本嵌入向量
     * @param text 要嵌入的文本
     * @param model 嵌入模型 (預設: nomic-embed-text)
     */
    /**
     * 生成文本嵌入向量 (Server-First)
     */
    public async generateEmbedding(text: string, model: string = 'nomic-embed-text'): Promise<number[]> {
        // Server-First: Proxy through Server
        try {
            return await taskService.generateEmbedding(text, model);
        } catch (error) {
            console.error('[OllamaService] Embedding generation failed:', error);
            throw error;
        }
    }

    /**
     * @deprecated Use taskService.getLectureEmbeddings or taskService.generateEmbedding instead
     */
    public async generateEmbeddings(
        texts: string[],
        model: string = 'nomic-embed-text',
        onProgress?: (current: number, total: number) => void
    ): Promise<number[][]> {
        console.warn('Using deprecated generateEmbeddings');
        const embeddings: number[][] = [];

        for (let i = 0; i < texts.length; i++) {
            const embedding = await this.generateEmbedding(texts[i], model);
            embeddings.push(embedding);

            if (onProgress) {
                onProgress(i + 1, texts.length);
            }
        }
        return embeddings;
    }

    /**
     * 計算兩個向量的餘弦相似度
     */
    public cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) {
            throw new Error('向量維度不匹配');
        }

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

export const ollamaService = new OllamaService();

