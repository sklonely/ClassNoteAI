import { storageService } from './storageService';
import { fetch } from '@tauri-apps/plugin-http';

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
    private defaultHost = 'http://100.117.82.111:11434';

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
     * 獲取選定的模型
     */
    private async getModel(): Promise<string> {
        const settings = await storageService.getAppSettings();
        return settings?.ollama?.model || 'llama3'; // 默認使用 llama3
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
        try {
            const host = await this.getHost();
            const model = options?.model || await this.getModel();

            console.log(`[OllamaService] 生成中... 模型: ${model}, Host: ${host}`);

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
            return data.response;
        } catch (error) {
            console.error('[OllamaService] 生成失敗:', error);
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
            const response = await this.generate(prompt, {
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

        return await this.generate(prompt, { system: systemPrompt });
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
            const response = await this.generate(prompt, {
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
}

export const ollamaService = new OllamaService();
