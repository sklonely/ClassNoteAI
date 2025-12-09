/**
 * OCR 服務
 * 使用 Ollama deepseek-ocr 模型進行 PDF 頁面識別
 * 特別適合表格、數學公式等複雜排版
 */

import { storageService } from './storageService';
import { fetch } from '@tauri-apps/plugin-http';

export interface OCRResult {
    pageNumber: number;
    text: string;
    success: boolean;
    error?: string;
}

class OCRService {
    private model = 'deepseek-ocr';

    /**
     * 獲取 Ollama Host 地址
     */
    private async getHost(): Promise<string> {
        const settings = await storageService.getAppSettings();
        let host = settings?.ollama?.host || 'http://100.118.7.50:11434';
        if (host.endsWith('/')) {
            host = host.slice(0, -1);
        }
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
            const host = await this.getHost();

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
     * 檢查 OCR 模型是否可用
     */
    public async isAvailable(): Promise<boolean> {
        try {
            const host = await this.getHost();
            const response = await fetch(`${host}/api/tags`);

            if (!response.ok) return false;

            const data = await response.json() as { models?: Array<{ name: string }> };
            const models = data.models || [];

            return models.some(m => m.name.includes('deepseek-ocr'));
        } catch {
            return false;
        }
    }
}

export const ocrService = new OCRService();
