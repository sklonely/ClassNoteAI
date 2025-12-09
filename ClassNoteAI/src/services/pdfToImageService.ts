/**
 * PDF 頁面轉圖片服務
 * 將 PDF 頁面渲染為 Base64 圖片供 OCR 使用
 */

import * as pdfjsLib from 'pdfjs-dist';

// Worker 設置
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

export interface PageImage {
    pageNumber: number;
    imageBase64: string; // Base64 編碼 (不含 data:image/png;base64, 前綴)
    width: number;
    height: number;
}

class PdfToImageService {
    /**
     * 將 PDF 頁面渲染為圖片
     * @param pdfData PDF 的 ArrayBuffer
     * @param pageNumber 頁碼 (1-indexed)
     * @param scale 縮放比例 (建議 1.5-2.0)
     */
    public async renderPage(
        pdfData: ArrayBuffer,
        pageNumber: number,
        scale: number = 1.5
    ): Promise<PageImage> {
        // 複製 ArrayBuffer 防止 detached 錯誤
        const pdfDataCopy = pdfData.slice(0);
        const loadingTask = pdfjsLib.getDocument({ data: pdfDataCopy });
        const pdf = await loadingTask.promise;

        if (pageNumber < 1 || pageNumber > pdf.numPages) {
            throw new Error(`頁碼 ${pageNumber} 超出範圍 (1-${pdf.numPages})`);
        }

        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        // 創建離屏 Canvas
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('無法創建 Canvas 2D 上下文');
        }

        // 渲染頁面
        await page.render({
            canvasContext: context,
            viewport,
            canvas,
        }).promise;

        // 轉換為 Base64 (移除 data:image/png;base64, 前綴)
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

        return {
            pageNumber,
            imageBase64: base64,
            width: viewport.width,
            height: viewport.height,
        };
    }

    /**
     * 渲染多個頁面
     * @param pdfData PDF 的 ArrayBuffer
     * @param pageNumbers 要渲染的頁碼陣列 (空陣列 = 全部頁面)
     * @param scale 縮放比例
     * @param onProgress 進度回調
     */
    public async renderPages(
        pdfData: ArrayBuffer,
        pageNumbers?: number[],
        scale: number = 1.5,
        onProgress?: (current: number, total: number) => void
    ): Promise<PageImage[]> {
        // 複製 ArrayBuffer 防止 detached 錯誤
        const pdfDataCopy = pdfData.slice(0);
        const loadingTask = pdfjsLib.getDocument({ data: pdfDataCopy });
        const pdf = await loadingTask.promise;

        // 如果沒指定頁碼，渲染全部頁面
        const pages = pageNumbers && pageNumbers.length > 0
            ? pageNumbers
            : Array.from({ length: pdf.numPages }, (_, i) => i + 1);

        const results: PageImage[] = [];

        for (let i = 0; i < pages.length; i++) {
            const pageNumber = pages[i];
            onProgress?.(i + 1, pages.length);

            try {
                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d')!;

                await page.render({
                    canvasContext: context,
                    viewport,
                    canvas,
                }).promise;

                const dataUrl = canvas.toDataURL('image/png');
                const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

                results.push({
                    pageNumber,
                    imageBase64: base64,
                    width: viewport.width,
                    height: viewport.height,
                });
            } catch (error) {
                console.error(`[PdfToImageService] 頁面 ${pageNumber} 渲染失敗:`, error);
            }
        }

        console.log(`[PdfToImageService] 渲染完成: ${results.length}/${pages.length} 頁`);
        return results;
    }

    /**
     * 獲取 PDF 總頁數
     */
    public async getTotalPages(pdfData: ArrayBuffer): Promise<number> {
        // 複製 ArrayBuffer 防止 detached 錯誤
        const pdfDataCopy = pdfData.slice(0);
        const loadingTask = pdfjsLib.getDocument({ data: pdfDataCopy });
        const pdf = await loadingTask.promise;
        return pdf.numPages;
    }

    /**
     * 從 PDF 頁面提取純文本 (Fallback 用)
     * @param pdfData PDF 的 ArrayBuffer
     * @param pageNumber 頁碼 (1-indexed)
     */
    public async extractText(
        pdfData: ArrayBuffer,
        pageNumber: number
    ): Promise<string> {
        // 複製 ArrayBuffer 防止 detached 錯誤
        const pdfDataCopy = pdfData.slice(0);
        const loadingTask = pdfjsLib.getDocument({ data: pdfDataCopy });
        const pdf = await loadingTask.promise;

        if (pageNumber < 1 || pageNumber > pdf.numPages) {
            throw new Error(`頁碼 ${pageNumber} 超出範圍 (1-${pdf.numPages})`);
        }

        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();

        // 將文本項拼接成字符串
        return textContent.items
            .map((item: any) => item.str)
            .join(' ');
    }
}

export const pdfToImageService = new PdfToImageService();
