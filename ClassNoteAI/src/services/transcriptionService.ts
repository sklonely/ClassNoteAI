/**
 * 實時轉錄服務
 * 管理音頻切片、轉錄請求、結果處理
 */

import { transcribeAudio, type TranscriptionResult } from './whisperService';
import { subtitleService } from './subtitleService';
import { AudioChunk } from './audioRecorder';
import { translateRough, translateFine } from './translationService';
import { remoteService } from './remoteService';

interface TranscriptionBuffer {
  chunks: Int16Array[];
  totalSamples: number;
  startTime: number;
  sampleRate: number;
}

export class TranscriptionService {
  private buffer: TranscriptionBuffer | null = null;
  private transcriptionInterval: ReturnType<typeof setInterval> | null = null;
  private isTranscribing: boolean = false;
  private initialPrompt: string = '';
  private minChunkDuration: number = 2000; // 最小切片時長（毫秒）：2秒
  private maxChunkDuration: number = 4000; // 最大切片時長（毫秒）：4秒
  private sampleRate: number = 16000; // Whisper 標準採樣率

  /**
   * 設置初始提示
   */
  setInitialPrompt(prompt: string): void {
    this.initialPrompt = prompt;
  }

  /**
   * 開始實時轉錄
   */
  start(): void {
    console.log('[TranscriptionService] 開始實時轉錄');
    this.buffer = {
      chunks: [],
      totalSamples: 0,
      startTime: Date.now(),
      sampleRate: this.sampleRate,
    };

    // 每 3 秒檢查一次是否需要轉錄
    this.transcriptionInterval = setInterval(() => {
      this.checkAndTranscribe();
    }, 1000); // 每秒檢查一次
  }

  /**
   * 停止實時轉錄
   */
  stop(): void {
    console.log('[TranscriptionService] 停止實時轉錄');
    
    if (this.transcriptionInterval) {
      clearInterval(this.transcriptionInterval);
      this.transcriptionInterval = null;
    }

    // 處理剩餘的緩衝區數據
    if (this.buffer && this.buffer.totalSamples > 0) {
      this.processBuffer();
    }

    this.buffer = null;
  }

  /**
   * 添加音頻塊到緩衝區
   */
  addAudioChunk(chunk: AudioChunk): void {
    if (!this.buffer) {
      return;
    }

    this.buffer.chunks.push(chunk.data);
    this.buffer.totalSamples += chunk.data.length;

    // 檢查是否達到最大時長，立即觸發轉錄
    const duration = (this.buffer.totalSamples / this.sampleRate) * 1000;
    if (duration >= this.maxChunkDuration) {
      this.processBuffer();
    }
  }

  /**
   * 檢查並觸發轉錄
   */
  private async checkAndTranscribe(): Promise<void> {
    if (!this.buffer || this.isTranscribing) {
      return;
    }

    const duration = (this.buffer.totalSamples / this.sampleRate) * 1000;
    
    // 如果達到最小時長，觸發轉錄
    if (duration >= this.minChunkDuration) {
      await this.processBuffer();
    }
  }

  /**
   * 處理緩衝區並執行轉錄
   */
  private async processBuffer(): Promise<void> {
    if (!this.buffer || this.buffer.totalSamples === 0 || this.isTranscribing) {
      return;
    }

    // 合併所有音頻塊
    const mergedAudio = new Int16Array(this.buffer.totalSamples);
    let offset = 0;
    for (const chunk of this.buffer.chunks) {
      mergedAudio.set(chunk, offset);
      offset += chunk.length;
    }

    const startTime = this.buffer.startTime;
    const duration = (this.buffer.totalSamples / this.sampleRate) * 1000;

    // 重置緩衝區
    this.buffer = {
      chunks: [],
      totalSamples: 0,
      startTime: Date.now(),
      sampleRate: this.sampleRate,
    };

    // 執行轉錄
    this.isTranscribing = true;
    try {
      console.log('[TranscriptionService] 開始轉錄，音頻時長:', duration.toFixed(2), 'ms');
      
      const result = await transcribeAudio(
        mergedAudio,
        this.sampleRate,
        this.initialPrompt || undefined
      );

      console.log('[TranscriptionService] 粗轉錄完成:', result.text);

      // 處理粗轉錄結果（包含粗翻譯）
      await this.handleRoughTranscription(result, startTime, duration, mergedAudio);
    } catch (error) {
      console.error('[TranscriptionService] 轉錄失敗:', error);
      // 可以添加重試邏輯
    } finally {
      this.isTranscribing = false;
    }
  }

  /**
   * 處理粗轉錄結果（包含粗翻譯）
   */
  private async handleRoughTranscription(
    result: TranscriptionResult,
    startTime: number,
    duration: number,
    audioData: Int16Array
  ): Promise<void> {
    if (!result.text || result.text.trim().length === 0) {
      return; // 忽略空結果
    }

    // 1. 立即進行粗翻譯
    let roughTranslation: string | undefined;
    try {
      const translationResult = await translateRough(result.text, 'en', 'zh');
      roughTranslation = translationResult.translated_text;
      console.log('[TranscriptionService] 粗翻譯完成:', roughTranslation);
    } catch (error) {
      console.error('[TranscriptionService] 粗翻譯失敗:', error);
      // 翻譯失敗不影響轉錄結果顯示
    }

    // 2. 添加字幕片段（粗層）
    let segmentIds: string[] = [];
    
    if (result.segments && result.segments.length > 0) {
      result.segments.forEach((segment) => {
        subtitleService.addSegment({
          roughText: segment.text,
          roughTranslation: roughTranslation,
          displayText: segment.text,
          displayTranslation: roughTranslation,
          startTime: startTime + segment.start_ms,
          endTime: startTime + segment.end_ms,
          language: result.language || undefined,
          source: 'rough',
          translationSource: roughTranslation ? 'rough' : undefined,
          // 向後兼容
          text: segment.text,
          translatedText: roughTranslation,
        });
        
        // 獲取剛添加的片段 ID
        const segments = subtitleService.getSegments();
        if (segments.length > 0) {
          segmentIds.push(segments[segments.length - 1].id);
        }
      });
    } else {
      // 如果沒有片段，使用完整文本
      subtitleService.addSegment({
        roughText: result.text,
        roughTranslation: roughTranslation,
        displayText: result.text,
        displayTranslation: roughTranslation,
        startTime: startTime,
        endTime: startTime + duration,
        language: result.language || undefined,
        source: 'rough',
        translationSource: roughTranslation ? 'rough' : undefined,
        // 向後兼容
        text: result.text,
        translatedText: roughTranslation,
      });
      
      // 獲取剛添加的片段 ID
      const segments = subtitleService.getSegments();
      if (segments.length > 0) {
        segmentIds.push(segments[segments.length - 1].id);
      }
    }

    // 更新當前文本
    subtitleService.updateCurrentText(result.text, roughTranslation);

    // 3. 如果有遠程服務，發送精層請求（異步，不阻塞）
    if (remoteService.isServiceAvailable()) {
      this.requestFineLayer(result.text, audioData, segmentIds, startTime, duration).catch(error => {
        console.error('[TranscriptionService] 精層處理失敗:', error);
        // 精層失敗不影響粗層顯示
      });
    }
  }

  /**
   * 請求精層處理（精轉錄 + 精翻譯）
   */
  private async requestFineLayer(
    roughText: string,
    _audioData: Int16Array,
    segmentIds: string[],
    _startTime: number,
    _duration: number
  ): Promise<void> {
    const serviceUrl = remoteService.getServiceUrl();
    if (!serviceUrl) {
      return;
    }

    // 更新狀態為 pending
    segmentIds.forEach(id => {
      subtitleService.updateSegment(id, { fineStatus: 'pending' });
    });

    try {
      // TODO: 實現精轉錄（遠程 Whisper Large）
      // 目前先使用粗轉錄文本進行精翻譯
      console.log('[TranscriptionService] 開始精層處理...');

      // 精翻譯（使用粗轉錄文本）
      const fineTranslationResult = await translateFine(
        roughText,
        'en',
        'zh',
        serviceUrl
      );

      console.log('[TranscriptionService] 精翻譯完成:', fineTranslationResult.translated_text);

      // 更新所有相關片段
      segmentIds.forEach(id => {
        subtitleService.updateSegment(id, {
          fineTranslation: fineTranslationResult.translated_text,
          displayTranslation: fineTranslationResult.translated_text,
          translationSource: 'fine',
          fineStatus: 'completed',
        });
      });

      // TODO: 當精轉錄實現後，這裡應該：
      // 1. 先發送音頻進行精轉錄
      // 2. 使用精轉錄結果進行精翻譯
      // 3. 更新 fineText 和 fineTranslation
    } catch (error) {
      console.error('[TranscriptionService] 精層處理失敗:', error);
      
      // 標記為失敗，保留粗層結果
      segmentIds.forEach(id => {
        subtitleService.updateSegment(id, { fineStatus: 'failed' });
      });
    }
  }

  /**
   * 清除所有字幕
   */
  clear(): void {
    subtitleService.clear();
  }
}

// 導出單例
export const transcriptionService = new TranscriptionService();

