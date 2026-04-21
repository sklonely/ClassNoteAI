/**
 * OCR service (optional).
 *
 * If the user has a local Ollama running with `deepseek-ocr` loaded,
 * this service renders each PDF page and hands it to that model for
 * table/formula-aware OCR. Useful for slide decks with math, diagrams
 * or non-selectable text.
 *
 * If Ollama is unreachable (which is the default on Windows + fresh
 * installs), callers fall back to plain pdfjs text extraction via
 * `pdfToImageService.extractAllText()`. See `ragService.ts` for the
 * pre-flight + fallback path.
 */

import { storageService } from './storageService';
import { fetch } from '@tauri-apps/plugin-http';

const ocrContentHashCache = new Map<string, string>();

function decodeBase64ToBytes(base64: string): Uint8Array {
    const normalized = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export async function computeContentHash(bytes: ArrayBuffer | Uint8Array): Promise<string> {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const digest = await crypto.subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export interface OCRResult {
    pageNumber: number;
    text: string;
    success: boolean;
    error?: string;
}

class OCRService {
    private model = 'deepseek-ocr';
    // Cache a negative `isAvailable()` result for this TTL so repeated
    // RAG-indexing attempts don't each spend 2 s probing an Ollama host
    // we already know is down. Positive results also cached so we don't
    // hammer the /api/tags endpoint.
    private availabilityCache: { result: boolean; at: number } | null = null;
    private static readonly AVAILABILITY_TTL_MS = 60_000;

    /**
     * Get the configured Ollama host. Returns empty string if the user
     * hasn't configured one — callers should treat that as "OCR disabled"
     * and skip straight to the pdfjs fallback. The previous hardcoded
     * Tailscale IP (`100.118.7.50`) was a dev-machine artifact that made
     * every production user spin forever on connection timeouts. See
     * AI 助教 indexing hang report (v0.5.2 user feedback).
     */
    private async getHost(): Promise<string | null> {
        const settings = await storageService.getAppSettings();
        let host = settings?.ollama?.host?.trim() || '';
        if (!host) return null;
        if (host.endsWith('/')) host = host.slice(0, -1);
        return host;
    }

    /**
     * 單頁 OCR 識別
     * @param imageBase64 頁面圖片的 Base64 編碼 (不含 data:image/xxx;base64, 前綴)
     * @param pageNumber 頁碼
     */
    /**
     * 單頁 OCR 識別 (帶重試機制)
     * @param imageBase64 頁面圖片的 Base64 編碼
     * @param pageNumber 頁碼
     * @param retries 重試次數 (預設 2)
     */
    public async recognizePage(imageBase64: string, pageNumber: number, retries: number = 2): Promise<OCRResult> {
        try {
            const pageHash = await computeContentHash(decodeBase64ToBytes(imageBase64));
            const cachedText = ocrContentHashCache.get(pageHash);
            if (cachedText) {
                return {
                    pageNumber,
                    text: cachedText,
                    success: true,
                };
            }

            const host = await this.getHost();
            if (!host) {
                throw new Error('Ollama host not configured — skipping OCR');
            }

            // 設置 60 秒超時
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            try {
                const response = await fetch(`${host}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: this.model,
                        // 簡化提示詞：直接要求輸出 Markdown
                        prompt: 'OCR the image and output in Markdown format.',
                        images: [imageBase64],
                        stream: false,
                    }),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`OCR API 錯誤: ${response.status}`);
                }

                const data = await response.json() as { response: string };
                let text = data.response || '';

                // 檢查是否為垃圾輸出 (重複字符)
                if (text.includes('）。\n）。') || text.length < 5) {
                    console.warn(`[OCRService] 檢測到異常輸出 (${text.slice(0, 20)}...)`);
                    throw new Error('OCR 輸出異常 (重複字符或過短)');
                }

                // ... (後續代碼不變)

                // Debug 模式輸出 (顯示前 100 字)
                console.log(`[OCRService] 頁面 ${pageNumber} OCR 完成 (${text.length} 字):`);
                console.log(`--- Page ${pageNumber} Start ---\n${text.slice(0, 100)}${text.length > 100 ? '...' : ''}\n--- Page ${pageNumber} End ---`);

                ocrContentHashCache.set(pageHash, text);

                return {
                    pageNumber,
                    text: text,
                    success: true,
                };
            } catch (fetchError: unknown) {
                clearTimeout(timeoutId);
                if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                    throw new Error('OCR 請求超時 (60s)');
                }
                throw fetchError;
            }
        } catch (error) {
            console.error(`[OCRService] 頁面 ${pageNumber} OCR 失敗:`, error);

            // 自動重試邏輯
            if (retries > 0) {
                console.log(`[OCRService] 頁面 ${pageNumber} 嘗試重試 (剩餘 ${retries} 次)...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); // 等待 3 秒再重試 (讓模型冷卻)
                return this.recognizePage(imageBase64, pageNumber, retries - 1);
            }

            return {
                pageNumber,
                text: '',
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * 批量 OCR 識別多個頁面 (並行處理 + 緩存)
     * @param pages 頁面圖片陣列
     * @param onProgress 進度回調
     * @param concurrency 並行數量 (預設 2)
     * @param lectureId 課程 ID (若提供則啟用緩存)
     * @param forceRefresh 是否強制刷新 (忽略緩存)
     */
    public async recognizePages(
        pages: { pageNumber: number; imageBase64: string }[],
        onProgress?: (current: number, total: number) => void,
        concurrency: number = 2,
        lectureId?: string,
        forceRefresh: boolean = false
    ): Promise<OCRResult[]> {
        const results: OCRResult[] = new Array(pages.length);
        let completed = 0;

        // 並行處理函數
        const processPage = async (index: number) => {
            const page = pages[index];
            console.log(`[OCRService] 開始處理頁面 ${page.pageNumber} (Index: ${index})`);

            // 1. 檢查緩存 (如果沒有強制刷新)
            if (lectureId && !forceRefresh) {
                console.log(`[OCRService] 頁面 ${page.pageNumber} 檢查緩存...`);
                try {
                    const cachedText = await storageService.getOCRResult(lectureId, page.pageNumber);
                    if (cachedText) {
                        console.log(`[OCRService] 頁面 ${page.pageNumber} 使用緩存 (${cachedText.length} 字)`);
                        results[index] = {
                            pageNumber: page.pageNumber,
                            text: cachedText,
                            success: true
                        };
                        completed++;
                        onProgress?.(completed, pages.length);
                        return;
                    }
                    console.log(`[OCRService] 頁面 ${page.pageNumber} 無緩存`);
                } catch (e) {
                    console.error(`[OCRService] 頁面 ${page.pageNumber} 讀取緩存失敗:`, e);
                }
            }

            // 2. 執行 OCR
            console.log(`[OCRService] 頁面 ${page.pageNumber} 開始調用 LLM...`);

            // 強制延遲 1 秒，避免請求過快
            await new Promise(resolve => setTimeout(resolve, 1000));

            const result = await this.recognizePage(page.imageBase64, page.pageNumber);
            console.log(`[OCRService] 頁面 ${page.pageNumber} LLM 返回結果: ${result.success}`);
            results[index] = result;

            // 3. 保存緩存
            if (lectureId && result.success && result.text.length > 0) {
                console.log(`[OCRService] 頁面 ${page.pageNumber} 保存緩存...`);
                try {
                    await storageService.saveOCRResult(lectureId, page.pageNumber, result.text);
                    console.log(`[OCRService] 頁面 ${page.pageNumber} 緩存保存完成`);
                } catch (e) {
                    console.error(`[OCRService] 頁面 ${page.pageNumber} 保存緩存失敗:`, e);
                }
            }

            completed++;
            onProgress?.(completed, pages.length);
            console.log(`[OCRService] 頁面 ${page.pageNumber} 處理流程結束`);
        };

        // 分批並行處理
        for (let i = 0; i < pages.length; i += concurrency) {
            const batch = [];
            for (let j = 0; j < concurrency && i + j < pages.length; j++) {
                batch.push(processPage(i + j));
            }
            await Promise.all(batch);
        }

        const successCount = results.filter(r => r.success).length;
        console.log(`[OCRService] 批量 OCR 完成: ${successCount}/${pages.length} 成功 (並行: ${concurrency}, 緩存: ${!!lectureId})`);

        return results;
    }

    /**
     * Check whether an Ollama instance with `deepseek-ocr` is reachable.
     * Cheap (≤ 2.5 s) and cached — safe to call as a pre-flight from
     * buildIndex() without adding perceptible UI latency. Negative
     * results are cached for `AVAILABILITY_TTL_MS` so the 2.5 s probe
     * doesn't repeat for every page of a 30-page PDF.
     */
    public async isAvailable(): Promise<boolean> {
        const now = Date.now();
        if (
            this.availabilityCache &&
            now - this.availabilityCache.at < OCRService.AVAILABILITY_TTL_MS
        ) {
            return this.availabilityCache.result;
        }

        const set = (result: boolean) => {
            this.availabilityCache = { result, at: now };
            return result;
        };

        try {
            const host = await this.getHost();
            if (!host) return set(false);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);

            const response = await fetch(`${host}/api/tags`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) return set(false);

            const data = (await response.json()) as { models?: Array<{ name: string }> };
            const hasModel = (data.models || []).some((m) => m.name.includes('deepseek-ocr'));
            return set(hasModel);
        } catch {
            return set(false);
        }
    }
}

export const ocrService = new OCRService();
