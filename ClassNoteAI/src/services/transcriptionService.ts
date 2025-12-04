/**
 * 實時轉錄服務 (Rolling Buffer Version)
 * 使用滾動緩衝區實現低延遲流式轉錄
 */

import { transcribeAudio } from './whisperService';
import { subtitleService } from './subtitleService';
import { AudioChunk } from './audioRecorder';
import { translateRough } from './translationService';
import { remoteService } from './remoteService';
import { detectSpeechSegments } from './vadService';
import { refinementService } from './refinementService';
import { autoAlignmentService } from './autoAlignmentService';

// 配置常量
const CONFIG = {
  SAMPLE_RATE: 16000,
  BUFFER_WINDOW_MS: 30000, // 增加緩衝區到 30 秒，避免長句子被截斷
  TRANSCRIPTION_INTERVAL_MS: 800, // 轉錄頻率
  VAD_ENERGY_THRESHOLD: 0.002,
  MIN_SPEECH_DURATION_MS: 500,
};

export class TranscriptionService {
  // 滾動緩衝區：存儲最近 N 秒的音頻數據
  private rollingBuffer: Int16Array = new Int16Array(0);


  private transcriptionInterval: ReturnType<typeof setInterval> | null = null;
  private isTranscribing: boolean = false;
  private initialPrompt: string = '';
  private lectureId: string | null = null;
  private keywords: string | undefined; // 存儲關鍵詞

  // 文本穩定相關
  private stableText: string = ''; // 已確認的穩定文本
  private lastPartialText: string = ''; // 上一次的臨時結果
  private lastValidPartialText: string = ''; // 上一次有效的臨時結果 (用於救援)
  private silenceCounter: number = 0; // 靜音計數器
  private stabilityCounter: number = 0; // 穩定性計數器

  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private pendingSubtitles: Array<any> = [];

  constructor() {
    // 綁定方法以避免 this 丟失
    this.checkAndTranscribe = this.checkAndTranscribe.bind(this);
  }

  /**
   * 設置初始提示詞（用於引導模型）
   * @param prompt 提示詞
   * @param keywords 領域關鍵詞（可選）
   */
  public setInitialPrompt(prompt: string, keywords?: string): void {
    let fullPrompt = prompt;
    this.keywords = keywords; // 保存關鍵詞供精修使用
    if (keywords) {
      // 將關鍵詞附加到提示詞中，使用 Glossary 格式
      fullPrompt = `${prompt} Glossary: ${keywords}.`;
    }
    this.initialPrompt = fullPrompt;
    console.log('[TranscriptionService] 設置初始提示詞:', this.initialPrompt);
  }

  setLectureId(lectureId: string | null): void {
    this.lectureId = lectureId;
    if (lectureId && !this.saveInterval) {
      this.startAutoSave();
    } else if (!lectureId && this.saveInterval) {
      this.stopAutoSave();
    }
  }

  private startAutoSave(): void {
    if (this.saveInterval) return;
    this.saveInterval = setInterval(() => this.savePendingSubtitles(), 10000);
  }

  private stopAutoSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    this.savePendingSubtitles();
  }

  private async savePendingSubtitles(): Promise<void> {
    if (!this.lectureId || this.pendingSubtitles.length === 0) return;
    try {
      const { storageService } = await import('./storageService');

      // Safety check: Ensure lecture exists to avoid FOREIGN KEY error
      const lecture = await storageService.getLecture(this.lectureId);
      if (!lecture) {
        console.warn(`[TranscriptionService] Lecture ${this.lectureId} not found. Stopping auto-save.`);
        this.stopAutoSave();
        return;
      }

      const now = new Date().toISOString();
      // 簡單去重：避免保存重複 ID
      const uniqueSubs = Array.from(new Map(this.pendingSubtitles.map(item => [item.id, item])).values());

      const subtitles = uniqueSubs.map(sub => ({
        ...sub,
        lecture_id: this.lectureId!,
        created_at: now,
      }));

      await storageService.saveSubtitles(subtitles);
      console.log(`[TranscriptionService] 自動保存 ${subtitles.length} 個字幕片段`);
      this.pendingSubtitles = [];
    } catch (error) {
      console.error('[TranscriptionService] 自動保存失敗:', error);
    }
  }

  start(): void {
    console.log('[TranscriptionService] 啟動流式轉錄 (Rolling Buffer)');
    this.rollingBuffer = new Int16Array(0);
    this.stableText = '';
    this.lastPartialText = '';
    this.lastValidPartialText = '';

    // 啟動定時轉錄循環
    if (this.transcriptionInterval) clearInterval(this.transcriptionInterval);
    this.transcriptionInterval = setInterval(this.checkAndTranscribe, CONFIG.TRANSCRIPTION_INTERVAL_MS);
  }

  stop(): void {
    console.log('[TranscriptionService] 停止流式轉錄');
    if (this.transcriptionInterval) {
      clearInterval(this.transcriptionInterval);
      this.transcriptionInterval = null;
    }
    // 最後一次處理剩餘緩衝區
    this.processRemainingBuffer();
    // 確保清除"正在聆聽..."的狀態
    subtitleService.updateCurrentText('', undefined);
    this.stopAutoSave();
  }

  addAudioChunk(chunk: AudioChunk): void {
    // 1. 將新數據追加到滾動緩衝區
    const newBuffer = new Int16Array(this.rollingBuffer.length + chunk.data.length);
    newBuffer.set(this.rollingBuffer);
    newBuffer.set(chunk.data, this.rollingBuffer.length);
    this.rollingBuffer = newBuffer;

    // 2. 安全限制：防止內存溢出，但給予足夠大的空間 (例如 60秒)
    // 只有在極端情況下才強制丟棄舊數據
    const absoluteMaxSamples = CONFIG.SAMPLE_RATE * 60;
    if (this.rollingBuffer.length > absoluteMaxSamples) {
      console.warn('[TranscriptionService] 緩衝區過大，強制丟棄舊數據');
      this.rollingBuffer = this.rollingBuffer.slice(this.rollingBuffer.length - absoluteMaxSamples);
    }
  }

  private async checkAndTranscribe(): Promise<void> {
    if (this.isTranscribing || this.rollingBuffer.length === 0) return;

    // 檢查是否有足夠的數據進行轉錄 (至少 0.5 秒)
    const minSamples = (CONFIG.SAMPLE_RATE * CONFIG.MIN_SPEECH_DURATION_MS) / 1000;
    if (this.rollingBuffer.length < minSamples) return;

    this.isTranscribing = true;

    try {
      // 1. VAD 檢查：當前緩衝區是否有語音？
      // 我們只檢查最近的 2-3 秒，看用戶是否還在說話
      const recentSamples = this.rollingBuffer.slice(-16000 * 2); // 最近 2 秒
      const segments = await detectSpeechSegments(recentSamples, CONFIG.SAMPLE_RATE, {
        energy_threshold: CONFIG.VAD_ENERGY_THRESHOLD,
        min_speech_duration_ms: 200, // VAD 檢查可以更靈敏
      });

      const hasSpeech = segments.length > 0;

      if (!hasSpeech) {
        this.silenceCounter++;
        // 如果連續靜音超過一定次數（例如 2次 * 0.8s = 1.6s），且有未提交的文本，則提交它
        if (this.silenceCounter > 2 && this.lastPartialText) {
          this.commitStableText(this.lastPartialText);
          this.lastPartialText = '';
          // 清空緩衝區，準備下一句話
          this.rollingBuffer = new Int16Array(0);
        }
        this.isTranscribing = false;
        return;
      }

      this.silenceCounter = 0;

      // 檢查緩衝區是否過大（接近 30 秒），如果是，強制提交
      // 這是為了解決用戶連續說話不暫停的情況
      const maxSafeSamples = (CONFIG.SAMPLE_RATE * CONFIG.BUFFER_WINDOW_MS * 0.9) / 1000; // 90% 滿
      if (this.rollingBuffer.length > maxSafeSamples) {
        console.log('[TranscriptionService] 緩衝區接近滿，準備強制提交');
        // 這裡不直接提交 lastPartialText，而是依賴 handleTranscriptionResult 中的邏輯來處理
        // 但我們可以設置一個標誌或強制處理
      }

      // 2. 轉錄當前緩衝區
      const result = await transcribeAudio(
        this.rollingBuffer,
        CONFIG.SAMPLE_RATE,
        this.initialPrompt || this.stableText.slice(-100) // 使用最近的穩定文本作為提示
      );

      if (result.text) {
        this.handleTranscriptionResult(result);
      }

    } catch (error) {
      console.error('[TranscriptionService] 轉錄循環錯誤:', error);
    } finally {
      this.isTranscribing = false;
    }
  }

  private handleTranscriptionResult(result: any): void {
    const text = result.text;
    const cleaned = this.preprocessText(text);
    if (!cleaned) return;

    // 更新有效文本緩存
    if (this.isValidText(cleaned)) {
      this.lastValidPartialText = cleaned;
    }

    // 策略 A: 緩衝區過滿強制提交
    const maxSafeSamples = (CONFIG.SAMPLE_RATE * CONFIG.BUFFER_WINDOW_MS * 0.8) / 1000;
    if (this.rollingBuffer.length > maxSafeSamples) {
      console.log('[TranscriptionService] 緩衝區過滿，強制提交當前結果');
      // 優先提交當前有效文本，如果沒有則嘗試救援上一次有效文本
      const textToCommit = this.isValidText(cleaned) ? cleaned : this.lastValidPartialText;

      if (textToCommit && this.isValidText(textToCommit)) {
        this.commitStableText(textToCommit);
      }

      this.rollingBuffer = new Int16Array(0); // 簡單粗暴清空，避免死循環
      this.lastPartialText = '';
      this.lastValidPartialText = '';
      this.stabilityCounter = 0;
      return;
    }

    // 策略 B: 穩定性檢測 (Repetition Check)
    if (cleaned === this.lastPartialText && cleaned.length > 0) {
      this.stabilityCounter++;
      console.log(`[TranscriptionService] 文本穩定計數: ${this.stabilityCounter}`);

      // 如果穩定超過閾值（例如 2 次 = 約 1.6 秒），則提交
      if (this.stabilityCounter >= 2) {
        console.log('[TranscriptionService] 文本已穩定，執行提交');

        if (this.isValidText(cleaned)) {
          const segmentId = this.commitStableText(cleaned);

          // 根據時間戳清理緩衝區
          if (result.segments && result.segments.length > 0) {
            const lastSegment = result.segments[result.segments.length - 1];
            const endMs = lastSegment.end_ms;
            const samplesToRemove = Math.floor((endMs * CONFIG.SAMPLE_RATE) / 1000);

            if (samplesToRemove > 0 && samplesToRemove <= this.rollingBuffer.length) {
              // 捕獲音頻數據用於精修
              const audioForRefinement = this.rollingBuffer.slice(0, samplesToRemove);
              refinementService.addToQueue(
                segmentId,
                audioForRefinement,
                cleaned,
                Date.now(),
                this.keywords
              );

              const overlapSamples = Math.floor(CONFIG.SAMPLE_RATE * 0.2);
              const safeRemove = Math.max(0, samplesToRemove - overlapSamples);
              console.log(`[TranscriptionService] 清理緩衝區: 移除 ${safeRemove} 樣本`);
              this.rollingBuffer = this.rollingBuffer.slice(safeRemove);
            } else {
              this.rollingBuffer = new Int16Array(0);
            }
          } else {
            this.rollingBuffer = new Int16Array(0);
          }
        } else {
          // 如果當前穩定的是無效文本（如標點），但我們有之前的有效文本，則救援它
          if (this.lastValidPartialText && this.isValidText(this.lastValidPartialText)) {
            console.log('[TranscriptionService] 檢測到穩定無效文本，救援上一次有效文本:', this.lastValidPartialText);
            this.commitStableText(this.lastValidPartialText);
          } else {
            console.log('[TranscriptionService] 忽略無效文本:', cleaned);
          }
          // 清空緩衝區，重新開始
          this.rollingBuffer = new Int16Array(0);
        }

        this.lastPartialText = '';
        this.lastValidPartialText = '';
        this.stabilityCounter = 0;
        return;
      }
    } else {
      this.stabilityCounter = 0;
    }

    // 更新 UI (僅當文本有效時)
    if (this.isValidText(cleaned)) {
      subtitleService.updateCurrentText(cleaned, undefined);
    }

    // Feed to Auto Alignment
    if (cleaned.startsWith(this.lastPartialText)) {
      const newText = cleaned.slice(this.lastPartialText.length).trim();
      if (newText && this.isValidText(newText)) {
        autoAlignmentService.addTranscription(newText);
      }
    } else {
      if (this.isValidText(cleaned)) {
        autoAlignmentService.addTranscription(cleaned);
      }
    }

    this.lastPartialText = cleaned;
  }

  private isValidText(text: string): boolean {
    // 過濾掉只有標點符號的文本
    if (/^[,\.\?!;:\s]+$/.test(text)) return false;
    // 過濾掉太短的非中文文本 (例如單個字母)
    if (text.length < 2 && !/[\u4e00-\u9fa5]/.test(text)) return false;
    return true;
  }

  private commitStableText(text: string): string {
    console.log('[TranscriptionService] 提交穩定文本:', text);
    this.stableText += (this.stableText ? ' ' : '') + text;

    // 1. 保存到字幕服務（作為一條確定的記錄）
    const now = Date.now();
    const segmentId = crypto.randomUUID();

    // 立即翻譯這個穩定的句子
    this.translateAndSave(segmentId, text, now);

    // 更新 UI：清空當前浮動文本
    subtitleService.updateCurrentText('', undefined);

    return segmentId;
  }

  private async translateAndSave(id: string, text: string, timestamp: number) {
    let translation = undefined;
    try {
      const res = await translateRough(text, 'en', 'zh');
      translation = res.translated_text;
    } catch (e) {
      console.warn('翻譯失敗', e);
    }

    // 添加到 UI 歷史
    subtitleService.addSegment({
      id,
      roughText: text,
      roughTranslation: translation,
      displayText: text,
      displayTranslation: translation,
      startTime: timestamp,
      endTime: timestamp + 2000, // 估算
      source: 'rough',
      translationSource: translation ? 'rough' : undefined,
      text: text,
      translatedText: translation
    });

    // 添加到待保存隊列
    if (this.lectureId) {
      this.pendingSubtitles.push({
        id,
        timestamp: timestamp / 1000,
        text_en: text,
        text_zh: translation,
        type: 'rough'
      });
    }

    // 觸發精細翻譯（可選）
    if (remoteService.isServiceAvailable()) {
      // TODO: Call fine translation
    }
  }

  private async processRemainingBuffer() {
    // 優先提交 lastPartialText，如果無效則嘗試 lastValidPartialText
    const textToCommit = (this.lastPartialText && this.isValidText(this.lastPartialText))
      ? this.lastPartialText
      : this.lastValidPartialText;

    if (textToCommit && this.isValidText(textToCommit)) {
      this.commitStableText(textToCommit);
    }
  }

  private preprocessText(text: string): string {
    return text.trim()
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, ' ');
  }

  // 保持接口兼容
  clear() {
    this.rollingBuffer = new Int16Array(0);
    this.stableText = '';
    this.lastPartialText = '';
    this.lastValidPartialText = '';
    this.keywords = undefined;
    subtitleService.clear();
    refinementService.clear(); // 清空精修隊列
  }
}

export const transcriptionService = new TranscriptionService();

