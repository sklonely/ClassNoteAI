import { transcribeAudio } from './whisperService';
import { subtitleService } from './subtitleService';
import { translateRough } from './translationService';

interface RefinementTask {
    id: string;
    audioData: Int16Array;
    roughText: string;
    timestamp: number;
    keywords?: string;
}

class RefinementService {
    private queue: RefinementTask[] = [];
    private isProcessing: boolean = false;
    private SAMPLE_RATE = 16000;

    /**
     * 添加任務到精修隊列
     */
    public addToQueue(id: string, audioData: Int16Array, roughText: string, timestamp: number, keywords?: string) {
        // 複製音頻數據，因為原始 buffer 會被修改
        const audioCopy = new Int16Array(audioData);

        this.queue.push({
            id,
            audioData: audioCopy,
            roughText,
            timestamp,
            keywords
        });

        console.log(`[RefinementService] 添加任務到隊列: ${id}, 當前隊列長度: ${this.queue.length}`);
        this.processQueue();
    }

    /**
     * 處理隊列
     */
    private async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const task = this.queue.shift();

        if (!task) {
            this.isProcessing = false;
            return;
        }

        try {
            console.log(`[RefinementService] 開始精修片段: ${task.id}`);

            // 使用 Beam Search 進行精修
            const result = await transcribeAudio(
                task.audioData,
                this.SAMPLE_RATE,
                task.keywords, // 使用關鍵詞作為提示
                {
                    strategy: 'beam_search',
                    beam_size: 5,
                    patience: 1.0
                }
            );

            if (result && result.text) {
                const refinedText = result.text.trim();
                console.log(`[RefinementService] 精修完成: "${task.roughText}" -> "${refinedText}"`);

                // 如果文本有變化，則更新字幕
                if (refinedText !== task.roughText) {
                    // 重新翻譯
                    let refinedTranslation = undefined;
                    try {
                        const transResult = await translateRough(refinedText, 'en', 'zh');
                        refinedTranslation = transResult.translated_text;
                    } catch (e) {
                        console.warn('[RefinementService] 重翻譯失敗:', e);
                    }

                    // 更新字幕服務
                    subtitleService.updateSegment(task.id, {
                        text: refinedText,
                        translatedText: refinedTranslation,
                        source: 'fine',
                        translationSource: refinedTranslation ? 'fine' : undefined
                    });
                } else {
                    console.log(`[RefinementService] 文本未變化，標記為 fine`);
                    // 即使文本沒變，也標記為 fine，表示已經過精修
                    subtitleService.updateSegment(task.id, {
                        source: 'fine'
                    });
                }
            }
        } catch (error) {
            console.error(`[RefinementService] 精修失敗 (${task.id}):`, error);
        } finally {
            this.isProcessing = false;
            // 繼續處理下一個
            if (this.queue.length > 0) {
                setTimeout(() => this.processQueue(), 100); // 短暫延遲讓 CPU 喘口氣
            }
        }
    }

    /**
     * 清空隊列
     */
    public clear() {
        this.queue = [];
        this.isProcessing = false;
    }
}

export const refinementService = new RefinementService();
