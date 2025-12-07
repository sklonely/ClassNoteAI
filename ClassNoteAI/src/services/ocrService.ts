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
    public async recognizePage(imageBase64: string, pageNumber: number): Promise<OCRResult> {
        try {
            const host = await this.getHost();
            const response = await fetch(`${host}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    prompt: 'Please extract all text from this document image. For tables, use Markdown table format. Preserve the document structure.',
                    images: [imageBase64], // Ollama 接受 base64 圖片陣列
                    stream: false,
                }),
            });

            if (!response.ok) {
                throw new Error(`OCR API 錯誤: ${response.status}`);
            }

            const data = await response.json() as { response: string };

            console.log(`[OCRService] 頁面 ${pageNumber} OCR 完成，文本長度: ${data.response?.length || 0}`);

            return {
                pageNumber,
                text: data.response || '',
                success: true,
            };
        } catch (error) {
            console.error(`[OCRService] 頁面 ${pageNumber} OCR 失敗:`, error);
            return {
                pageNumber,
                text: '',
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * 批量 OCR 識別多個頁面
     * @param pages 頁面圖片陣列
     * @param onProgress 進度回調
     */
    public async recognizePages(
        pages: { pageNumber: number; imageBase64: string }[],
        onProgress?: (current: number, total: number) => void
    ): Promise<OCRResult[]> {
        const results: OCRResult[] = [];

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            onProgress?.(i + 1, pages.length);

            const result = await this.recognizePage(page.imageBase64, page.pageNumber);
            results.push(result);

            // 避免過快請求
            if (i < pages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const successCount = results.filter(r => r.success).length;
        console.log(`[OCRService] 批量 OCR 完成: ${successCount}/${pages.length} 成功`);

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
