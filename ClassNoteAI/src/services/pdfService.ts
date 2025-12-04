import * as pdfjsLib from 'pdfjs-dist';

// 設置 worker
// 注意：在 Vite 中使用 pdfjs-dist 需要正確設置 worker
// 這裡使用 CDN 版本以避免構建問題，或者可以配置 vite 插件
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export const pdfService = {
    /**
     * 從 ArrayBuffer 中提取文本
     * @param data PDF 文件的 ArrayBuffer
     * @param maxPages 最大讀取頁數，默認為 5 頁（為了性能）
     */
    async extractText(data: ArrayBuffer, maxPages: number = 5): Promise<string> {
        try {
            // 載入 PDF 文檔
            const loadingTask = pdfjsLib.getDocument({ data });
            const doc = await loadingTask.promise;

            let fullText = '';
            const numPages = Math.min(doc.numPages, maxPages);

            // 遍歷頁面提取文本
            for (let i = 1; i <= numPages; i++) {
                const page = await doc.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(' ');

                fullText += pageText + '\n\n';
            }

            return fullText;
        } catch (error) {
            console.error('PDF 文本提取失敗:', error);
            throw error;
        }
    },

    /**
     * 提取每一頁的文本
     * @param data PDF 文件的 ArrayBuffer
     */
    async extractAllPagesText(data: ArrayBuffer): Promise<{ page: number; text: string }[]> {
        try {
            const loadingTask = pdfjsLib.getDocument({ data });
            const doc = await loadingTask.promise;
            const results: { page: number; text: string }[] = [];

            for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(' ');

                if (pageText.trim().length > 0) {
                    results.push({ page: i, text: pageText });
                }
            }

            return results;
        } catch (error) {
            console.error('PDF 全文提取失敗:', error);
            return [];
        }
    }
};
