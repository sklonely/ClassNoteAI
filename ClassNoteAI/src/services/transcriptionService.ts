/**
 * 實時轉錄服務 (Rolling Buffer Version)
 * 使用滾動緩衝區實現低延遲流式轉錄
 */

import { invoke } from '@tauri-apps/api/core';
import { transcribeAudio } from './whisperService';
import { subtitleService } from './subtitleService';
import { AudioChunk } from './audioRecorder';
import { translateRough } from './translationService';
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

// 待保存字幕的類型定義
interface PendingSubtitle {
  id: string;
  timestamp: number;
  text_en: string;
  text_zh?: string;
  type: 'rough' | 'fine';
}

interface LastCommitSnapshot {
  normalizedText: string;
  sampleCountAtCommit: number;
}

export function normalizeCommittedText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

// Phase 0 of speech-pipeline-v0.6.5 (#71): Whisper occasionally inserts a
// period after disfluency tokens like "um.", "uh.", "you know.", "I mean."
// — the punctuation regex alone treats those as sentence ends and triggers
// a smart-split mid-thought, fragmenting downstream translation context.
// Conservative list — only obvious fillers; "like." is NOT included
// because in lectures it can legitimately end a clause.
const STRONG_PUNCT_END = /[.?!。？！]$/;
const FILLER_END = /(?:^|[\s,])(?:um+|uh+|you know|i mean|so+|well)[.?!]\s*$/i;

export function isCommittableSentenceEnd(segText: string): boolean {
  if (!STRONG_PUNCT_END.test(segText)) return false;
  if (FILLER_END.test(segText)) return false;
  return true;
}

export function shouldSkipDuplicateCommit(
  normalizedText: string,
  lastCommitSnapshot: LastCommitSnapshot | null,
  totalSamplesReceived: number,
): boolean {
  if (!normalizedText || !lastCommitSnapshot) {
    return false;
  }

  return (
    lastCommitSnapshot.normalizedText === normalizedText &&
    lastCommitSnapshot.sampleCountAtCommit === totalSamplesReceived
  );
}

export class TranscriptionService {
  // 滾動緩衝區：存儲最近 N 秒的音頻數據
  private rollingBuffer: Int16Array = new Int16Array(0);


  private transcriptionInterval: ReturnType<typeof setInterval> | null = null;
  private isTranscribing: boolean = false;
  private isRunning: boolean = false; // 服務是否正在運行
  private initialPrompt: string = '';
  private lectureId: string | null = null;
  private keywords: string | undefined; // 存儲關鍵詞

  // 文本穩定相關
  private stableText: string = ''; // 已確認的穩定文本
  private lastPartialText: string = ''; // 上一次的臨時結果
  private lastValidPartialText: string = ''; // 上一次有效的臨時結果 (用於救援)
  private silenceCounter: number = 0; // 靜音計數器
  private stabilityCounter: number = 0; // 穩定性計數器
  private totalSamplesReceived: number = 0;
  private lastCommitSnapshot: LastCommitSnapshot | null = null;

  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private pendingSubtitles: PendingSubtitle[] = [];

  // Fine-translation batch queue (v0.5.0). Every N committed rough
  // segments (or after a short debounce) we send the batch to the
  // configured LLM provider for contextual refinement + translation.
  private fineQueue: Array<{ id: string; text: string }> = [];
  private fineFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FINE_BATCH_SIZE = 8;
  private static readonly FINE_DEBOUNCE_MS = 20_000;

  // Language pair for rough translation. Read from AppSettings when a
  // lecture starts. `auto` means "let Whisper detect". Introduced v0.5.1.
  private sourceLang: string = 'auto';
  private targetLang: string = 'zh-TW';

  // Cached check: is an LLM provider configured? If not, we skip the
  // fine-refinement queue entirely instead of spamming errors every
  // FINE_DEBOUNCE_MS. Re-checked each new recording session.
  private fineRefinementEnabled: boolean = false;
  private currentRefineIntensity: 'off' | 'light' | 'deep' = 'off';

  constructor() {
    // 綁定方法以避免 this 丟失
    this.checkAndTranscribe = this.checkAndTranscribe.bind(this);
  }

  /** Update the language pair used for rough translation. Called from
   *  NotesView right before a recording starts so settings changes take
   *  effect mid-session. */
  public setLanguages(source: string, target: string): void {
    this.sourceLang = source || 'auto';
    this.targetLang = target || 'zh-TW';
    console.log('[TranscriptionService] Language pair:', this.sourceLang, '→', this.targetLang);
  }

  /** Pre-flight: check if any LLM provider is configured. We skip the
   *  fine-refinement queue entirely if not. */
  public async refreshFineRefinementAvailability(): Promise<void> {
    try {
      const { storageService } = await import('./storageService');
      const settings = await storageService.getAppSettings().catch(() => null);
      const intensity = settings?.experimental?.refineIntensity ?? 'off';
      this.currentRefineIntensity = intensity;
      if (intensity === 'off') {
        this.fineRefinementEnabled = false;
        return;
      }

      const { resolveActiveProvider } = await import('./llm');
      const defaultId = localStorage.getItem('llm.defaultProvider') || undefined;
      const provider = await resolveActiveProvider(defaultId);
      this.fineRefinementEnabled = !!provider;
    } catch {
      this.currentRefineIntensity = 'off';
      this.fineRefinementEnabled = false;
    }
  }

  /**
   * 設置初始提示詞（用於引導模型）
   * @param prompt 提示詞
   * @param keywords 領域關鍵詞（可選）
   */
  public setInitialPrompt(prompt: string, keywords?: string): void {
    this.keywords = keywords; // 保存關鍵詞供精修使用
    // Prompt is now constructed by the caller (NotesView) as a natural sentence
    this.initialPrompt = prompt;
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
    // Fire one last fine-refinement flush so trailing segments also get
    // the LLM pass before we persist them.
    //
    // v0.5.2 audit follow-up: the old form
    // `void this.flushFineRefinement().finally(() => this.savePendingSubtitles())`
    // swallowed BOTH exceptions silently. If the fine-refinement LLM
    // call 429'd or the persist call hit a DB lock, no retry, no log,
    // no visible error. Now we explicitly log each leg so `console.error`
    // produces actionable output, and the save still fires regardless
    // of refinement outcome (saving rough-only subtitles is strictly
    // better than saving nothing).
    void (async () => {
      try {
        await this.flushFineRefinement();
      } catch (err) {
        console.error('[TranscriptionService] final flushFineRefinement failed:', err);
      }
      try {
        await this.savePendingSubtitles();
      } catch (err) {
        console.error('[TranscriptionService] final savePendingSubtitles failed:', err);
      }
    })();
  }

  /**
   * Phase 1 of speech-pipeline-v0.6.5 (#52): mirror every committed
   * segment into an append-only JSONL on disk so a crash between sqlite
   * flushes (we batch every 10 s, see {@link saveInterval}) doesn't
   * silently lose the segments captured in the gap. The Rust side
   * cleans the file up on `discard_orphaned_recording` /
   * `discard_orphaned_transcript`; the recovery flow imports it back
   * into sqlite before the user sees a "completed" lecture.
   *
   * Best-effort: if the IPC throws (disk full, no in-progress dir,
   * lecture id rejected), we log and move on — the in-memory
   * pendingSubtitles plus the 10 s flush is still the primary path,
   * the JSONL only matters when crash precedes flush.
   */
  private persistSegmentToDisk(segment: {
    id: string;
    timestamp: number;
    text_en: string;
    text_zh?: string;
    type: 'rough' | 'fine';
  }): void {
    if (!this.lectureId) return;
    void invoke('append_transcript_segment', {
      lectureId: this.lectureId,
      segment,
    }).catch((err) => {
      console.warn('[TranscriptionService] transcript JSONL append failed:', err);
    });
  }

  private async savePendingSubtitles(): Promise<void> {
    if (!this.lectureId || this.pendingSubtitles.length === 0) return;
    try {
      const { storageService } = await import('./storageService');

      // Safety check: Ensure lecture exists to avoid FOREIGN KEY error
      const lecture = await storageService.getLecture(this.lectureId);
      if (!lecture) {
        // DON'T stop auto-save - just log warning and keep pending subtitles for retry
        console.warn(`[TranscriptionService] Lecture ${this.lectureId} not found in DB yet. Keeping ${this.pendingSubtitles.length} pending subtitles for retry.`);
        return; // Keep pending subtitles, will retry on next interval
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
      this.pendingSubtitles = []; // Only clear after successful save
    } catch (error) {
      console.error(`[TranscriptionService] 自動保存失敗 (LectureID: ${this.lectureId}):`, error);
      // Keep pending subtitles for retry on error
    }
  }

  start(): void {
    console.log('[TranscriptionService] 啟動流式轉錄 (Rolling Buffer)');
    this.isRunning = true; // 標記服務開始運行
    this.rollingBuffer = new Int16Array(0);
    this.stableText = '';
    this.lastPartialText = '';
    this.lastValidPartialText = '';
    this.totalSamplesReceived = 0;
    this.lastCommitSnapshot = null;

    // 啟動定時轉錄循環
    if (this.transcriptionInterval) clearInterval(this.transcriptionInterval);
    this.transcriptionInterval = setInterval(this.checkAndTranscribe, CONFIG.TRANSCRIPTION_INTERVAL_MS);
  }

  pause(): void {
    console.log('[TranscriptionService] 暫停流式轉錄');
    if (this.transcriptionInterval) {
      clearInterval(this.transcriptionInterval);
      this.transcriptionInterval = null;
    }
    // 處理剩餘緩衝區
    this.processRemainingBuffer();
    this.stopAutoSave();
  }

  resume(): void {
    console.log('[TranscriptionService] 恢復流式轉錄');
    // 確保之前已停止
    if (this.transcriptionInterval) clearInterval(this.transcriptionInterval);

    // 重置部分狀態但保留 stableText
    this.rollingBuffer = new Int16Array(0);
    this.lastPartialText = '';

    this.transcriptionInterval = setInterval(this.checkAndTranscribe, CONFIG.TRANSCRIPTION_INTERVAL_MS);
    if (this.lectureId) {
      this.startAutoSave();
    }
  }

  stop(): void {
    console.log('[TranscriptionService] 停止流式轉錄');
    this.isRunning = false; // 標記服務停止運行
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
    this.totalSamplesReceived += chunk.data.length;

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
        // Phase 0 of speech-pipeline-v0.6.5: bumped silence commit
        // threshold 3 → 4 ticks (≈ +800ms) — #71 reports lecturers
        // pausing to think mid-sentence still get cut at 2.4s. Phase 4
        // (smart segmentation) replaces this counter with a multi-signal
        // decision; this is the bandaid until then.
        // History: v0.5.2 bumped 2 → 3 for the same reason.
        // See docs/design/speech-pipeline-v0.6.5.md.
        if (this.silenceCounter > 4 && this.lastPartialText) {
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
      // `this.sourceLang` comes from setLanguages() (default 'auto'). It's
      // normalised on the Rust side — "auto" / undefined → whisper detects
      // the language from the first 30s, anything else ("en", "zh-TW", ...)
      // forces that language. Pre-v0.5.2 this was hardcoded to "en" and
      // the UI's selection was silently ignored.
      const result = await transcribeAudio(
        this.rollingBuffer,
        CONFIG.SAMPLE_RATE,
        this.initialPrompt || this.stableText.slice(-100), // 使用最近的穩定文本作為提示
        this.sourceLang,
        {
          strategy: 'beam_search',
          beam_size: 5,
          patience: 1.0
        }
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
    // 如果服務已停止，不再處理結果（避免停止後仍更新 UI）
    if (!this.isRunning) {
      console.log('[TranscriptionService] 服務已停止，忽略轉錄結果');
      return;
    }

    const text = result.text;
    const cleaned = this.preprocessText(text);
    if (!cleaned) return;

    // 更新有效文本緩存
    if (this.isValidText(cleaned)) {
      this.lastValidPartialText = cleaned;
    }

    // 策略 A: 緩衝區過滿 - 智能切分 (Smart Splitting)
    // 不再粗暴地清空整個緩衝區，而是尋找句子邊界進行切分
    const maxSafeSamples = (CONFIG.SAMPLE_RATE * CONFIG.BUFFER_WINDOW_MS * 0.8) / 1000;
    if (this.rollingBuffer.length > maxSafeSamples) {
      console.log('[TranscriptionService] 緩衝區接近滿，啟動智能切分...');

      // 如果 Whisper 返回了 segments，嘗試找到最後一個完整句子的邊界
      if (result.segments && result.segments.length > 0) {
        // 1. 優先尋找以句號/問號/感嘆號結尾的 segment
        let splitIndex = -1;
        let splitEndMs = 0;

        for (let i = result.segments.length - 1; i >= 0; i--) {
          const seg = result.segments[i];
          const segText = seg.text?.trim() || '';
          // 如果這個 segment 以句子結束符號結尾且不是 filler 收尾
          if (isCommittableSentenceEnd(segText)) {
            splitIndex = i;
            splitEndMs = seg.end_ms;
            break;
          }
        }

        // 2. 如果沒找到句子結尾，但緩衝區非常滿 (> 90%)，則退而求其次，在最後一個 segment 處切分
        // 這樣可以避免強制提交導致的上下文丟失（因為我們會保留重疊部分）
        if (splitIndex === -1 && this.rollingBuffer.length > (CONFIG.SAMPLE_RATE * CONFIG.BUFFER_WINDOW_MS * 0.9) / 1000) {
          console.log('[TranscriptionService] 緩衝區危急，未找到句子邊界，強制在最後一個 segment 切分');
          // 保留最後一個 segment 作為上下文，切分倒數第二個 (如果有多個)
          // 或者直接切分最後一個
          if (result.segments.length > 1) {
            splitIndex = result.segments.length - 2;
            splitEndMs = result.segments[splitIndex].end_ms;
          } else {
            // 只有一個 segment，只能切分它
            splitIndex = 0;
            splitEndMs = result.segments[0].end_ms;
          }
        }

        if (splitIndex >= 0 && splitEndMs > 0) {
          // 構建要提交的文本 (從第一個 segment 到 splitIndex)
          const textToCommit = result.segments
            .slice(0, splitIndex + 1)
            .map((s: any) => s.text?.trim())
            .filter(Boolean)
            .join(' ');

          if (textToCommit && this.isValidText(textToCommit)) {
            console.log(`[TranscriptionService] 智能切分: 提交到 segment ${splitIndex}, 時間 ${splitEndMs}ms`);
            const segmentId = this.commitStableText(textToCommit);

            // 計算要保留的樣本數 (切分點之後的音頻)
            const samplesToRemove = Math.floor((splitEndMs * CONFIG.SAMPLE_RATE) / 1000);
            // 保留一小段重疊 (300ms) 作為上下文
            const overlapSamples = Math.floor(CONFIG.SAMPLE_RATE * 0.3);
            const safeRemove = Math.max(0, samplesToRemove - overlapSamples);

            if (safeRemove > 0 && safeRemove < this.rollingBuffer.length) {
              // 捕獲音頻用於精修
              const audioForRefinement = this.rollingBuffer.slice(0, samplesToRemove);
              refinementService.addToQueue(
                segmentId,
                audioForRefinement,
                textToCommit,
                Date.now(),
                this.keywords
              );

              console.log(`[TranscriptionService] 智能切分: 移除 ${safeRemove} 樣本，保留 ${this.rollingBuffer.length - safeRemove} 樣本作為上下文`);
              this.rollingBuffer = this.rollingBuffer.slice(safeRemove);
            } else {
              // 回退：如果計算出的移除量不合理，使用舊邏輯
              this.rollingBuffer = new Int16Array(0);
            }

            this.resetPartialState(false); // buffer已部分清理
            return;
          }
        }
      }

      // 回退邏輯: 如果仍然無法切分，只能強制提交
      console.log('[TranscriptionService] 無法切分，回退到強制提交');
      const textToCommit = this.isValidText(cleaned) ? cleaned : this.lastValidPartialText;
      if (textToCommit && this.isValidText(textToCommit)) {
        this.commitStableText(textToCommit);
      }
      this.rollingBuffer = new Int16Array(0);
      this.resetPartialState(false); // buffer已清空
      return;
    }

    // 策略 B: 穩定性檢測 (Repetition Check)
    if (cleaned === this.lastPartialText && cleaned.length > 0) {
      this.stabilityCounter++;
      console.log(`[TranscriptionService] 文本穩定計數: ${this.stabilityCounter}`);

      // v0.5.2: bumped stability threshold from 2 → 3 ticks (≈ 1.6s → 2.4s).
      // Rough Whisper typically takes 2-3 ticks to settle on its final
      // word-level output; committing at 2 ticks catches mid-correction
      // text, feeds garbage into M2M100 and bakes the error into a
      // fine-refinement batch. Waiting one more tick costs ~0.8s of
      // latency but sharply improves both rough and fine quality.
      if (this.stabilityCounter >= 3) {
        console.log('[TranscriptionService] 文本已穩定，執行提交');

        if (this.isValidText(cleaned)) {
          const segmentId = this.commitStableText(cleaned);

          // Buffer clearing after commit. v0.5.1: be more aggressive —
          // if endMs is 0 / undefined / out-of-range we still clear the
          // whole rolling buffer rather than leaving the audio around,
          // because leaving it causes Whisper to re-transcribe the same
          // sentence on the next polling tick, which then duplicates the
          // committed subtitle when processRemainingBuffer fires.
          const lastSegment = result.segments?.[result.segments.length - 1];
          const endMs = lastSegment?.end_ms ?? 0;
          const samplesToRemove = Math.floor((endMs * CONFIG.SAMPLE_RATE) / 1000);
          const validTimestamp = samplesToRemove > 0 && samplesToRemove <= this.rollingBuffer.length;

          if (validTimestamp && segmentId) {
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
            // No usable timestamp (whisper-rs bindings vary by platform
            // and segmentation mode) OR the commit was a duplicate that
            // we just deduped — nuke the whole buffer. Losing audio
            // overlap is the lesser evil compared to duplicate captions.
            if (!validTimestamp) {
              console.log('[TranscriptionService] 無有效時間戳，全清緩衝區');
            }
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

        this.resetPartialState(false); // buffer已在上面處理
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
    // Dedup only when we're re-committing the exact same text from the
    // exact same audio snapshot (e.g. stop/replay of an uncleared tail).
    // This preserves legitimate repeated speech such as "對 對 對" once
    // new audio chunks have actually arrived.
    const normalized = normalizeCommittedText(text);
    if (shouldSkipDuplicateCommit(normalized, this.lastCommitSnapshot, this.totalSamplesReceived)) {
      console.log('[TranscriptionService] 重複文本，跳過提交:', normalized.slice(0, 40));
      return '';
    }

    console.log('[TranscriptionService] 提交穩定文本:', text);
    this.stableText += (this.stableText ? ' ' : '') + text;
    this.lastCommitSnapshot = {
      normalizedText: normalized,
      sampleCountAtCommit: this.totalSamplesReceived,
    };

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
    // 1. 立即添加字幕到 UI（無需等待翻譯）
    subtitleService.addSegment({
      id,
      roughText: text,
      roughTranslation: undefined, // 翻譯稍後更新
      displayText: text,
      displayTranslation: undefined, // 翻譯稍後更新
      startTime: timestamp,
      endTime: timestamp + 2000, // 估算
      source: 'rough',
      translationSource: undefined,
      text: text,
      translatedText: undefined
    });

    // 2. 立即添加到待保存隊列（翻譯完成後會更新）
    if (this.lectureId) {
      this.pendingSubtitles.push({
        id,
        timestamp: timestamp / 1000,
        text_en: text,
        text_zh: undefined, // 翻譯完成後更新
        type: 'rough'
      });
      // Crash-safety: write the rough segment to the JSONL sidecar NOW,
      // before the next sqlite flush. This is the only line of defence
      // against a crash inside the 10 s save window.
      this.persistSegmentToDisk({
        id,
        timestamp: timestamp / 1000,
        text_en: text,
        text_zh: undefined,
        type: 'rough',
      });
    }

    // 3. 異步進行翻譯，完成後更新字幕（不阻塞 UI）
    this.translateAndUpdateSegment(id, text);
  }

  /**
   * 異步翻譯並更新現有字幕段落。v0.5.1 改動：
   *  - 使用使用者在 Settings 設定的 source/target language，不再寫死 en/zh
   *  - 翻譯失敗時把錯誤標記寫入字幕，讓 UI 能顯示 "⚠️ 翻譯模型未載入"
   *    而不是空白（先前使用者會誤以為是字幕自己重複）
   */
  private async translateAndUpdateSegment(id: string, text: string) {
    // If source is 'auto' we let M2M100 default to English; Whisper's
    // language-detect result should eventually feed back via setLanguages
    // but we don't want to block translation waiting for it.
    const src = this.sourceLang === 'auto' ? 'en' : this.sourceLang;
    const tgt = this.targetLang || 'zh-TW';

    try {
      const res = await translateRough(text, src, tgt);
      const translation = res.translated_text;

      if (!translation || !translation.trim()) {
        throw new Error('translator returned empty string');
      }

      console.log('[TranscriptionService] 翻譯完成，更新字幕:', {
        id,
        translation: translation.substring(0, 30),
      });

      subtitleService.updateSegment(id, {
        roughTranslation: translation,
        displayTranslation: translation,
        translationSource: 'rough',
        translatedText: translation,
      });

      const pending = this.pendingSubtitles.find((s) => s.id === id);
      if (pending) {
        pending.text_zh = translation;
        // Append a second JSONL line carrying the translation. Recovery
        // takes the latest line per id, so this upgrades the row from
        // text_zh=undefined to text_zh=<translation> if the next sqlite
        // flush misses.
        this.persistSegmentToDisk({
          id,
          timestamp: pending.timestamp,
          text_en: text,
          text_zh: translation,
          type: 'rough',
        });
      }
    } catch (e) {
      console.warn('[TranscriptionService] 翻譯失敗', e);
      // Surface the failure to the UI so the user knows what's going on
      // instead of seeing a blank gray row (which used to look like the
      // caption duplicated itself).
      const marker = '⚠️ 翻譯失敗（模型可能未載入，請至設定檢查）';
      subtitleService.updateSegment(id, {
        displayTranslation: marker,
        translationSource: 'error',
        translatedText: marker,
      });
      // Don't write the marker into the persistence queue — store leaves
      // text_zh null so a successful retry later can populate it.
    }

    // Queue this segment for LLM-backed fine refinement (batched).
    this.enqueueFineRefinement(id, text);
  }

  /**
   * Fine-translation batching. Accumulates rough segments and flushes
   * either when FINE_BATCH_SIZE is reached or after FINE_DEBOUNCE_MS of
   * inactivity. Each flush asks the user's configured LLM provider to
   * correct ASR errors and produce a natural Chinese translation in one
   * shot, which we then apply to both the UI and the pending-subtitle
   * persistence queue.
   *
   * v0.5.1: completely skips the queue when no LLM provider is
   * configured, so the console doesn't get spammed every 20 s with
   * "No AI provider configured" errors. `refreshFineRefinementAvailability`
   * is called once per recording session from NotesView.
   */
  private enqueueFineRefinement(id: string, text: string): void {
    if (!this.fineRefinementEnabled || this.currentRefineIntensity === 'off') return;

    this.fineQueue.push({ id, text });
    if (this.fineQueue.length >= TranscriptionService.FINE_BATCH_SIZE) {
      void this.flushFineRefinement();
      return;
    }
    if (this.fineFlushTimer) clearTimeout(this.fineFlushTimer);
    this.fineFlushTimer = setTimeout(
      () => void this.flushFineRefinement(),
      TranscriptionService.FINE_DEBOUNCE_MS
    );
  }

  private async flushFineRefinement(): Promise<void> {
    if (this.fineFlushTimer) {
      clearTimeout(this.fineFlushTimer);
      this.fineFlushTimer = null;
    }
    const { storageService } = await import('./storageService');
    const settings = await storageService.getAppSettings().catch(() => null);
    const intensity = settings?.experimental?.refineIntensity ?? 'off';
    if (intensity === 'off') return;
    this.currentRefineIntensity = intensity;
    if (!this.fineQueue.length) return;
    const batch = this.fineQueue.splice(0, this.fineQueue.length);

    try {
      const { refineTranscripts, usageTracker } = await import('./llm');
      const refinements = await refineTranscripts(batch);
      if (!refinements.length) return;

      // Grab the batch-level usage event that refineTranscripts just
      // recorded so each segment in the batch can display its share.
      // We split the batch total across segments so the inline hint
      // next to the "✓ 已精修" badge feels proportional rather than
      // slapping the whole batch total on every row.
      const batchUsage = usageTracker.latest('fineRefine');
      const perSegIn = batchUsage
        ? Math.round(batchUsage.inputTokens / Math.max(1, batch.length))
        : 0;
      const perSegOut = batchUsage
        ? Math.round(batchUsage.outputTokens / Math.max(1, batch.length))
        : 0;

      const byId = new Map(refinements.map((r) => [r.id, r]));
      for (const item of batch) {
        const r = byId.get(item.id);
        if (!r) continue;
        subtitleService.updateSegment(item.id, {
          text: r.en,
          displayText: r.en,
          roughTranslation: r.zh,
          displayTranslation: r.zh,
          translatedText: r.zh,
          translationSource: 'fine',
          source: 'fine',
          fineUsage: batchUsage
            ? { inputTokens: perSegIn, outputTokens: perSegOut }
            : undefined,
        });

        const pending = this.pendingSubtitles.find((s) => s.id === item.id);
        if (pending) {
          pending.text_en = r.en;
          pending.text_zh = r.zh;
          pending.type = 'fine';
        }
      }
    } catch (e) {
      console.warn('[TranscriptionService] Fine refinement batch failed; keeping rough output:', e);
    }
  }

  public setRefineIntensity(intensity: 'off' | 'light' | 'deep'): void {
    this.currentRefineIntensity = intensity;
    if (intensity === 'off') {
      this.fineRefinementEnabled = false;
    } else {
      this.refreshFineRefinementAvailability().catch((e) =>
        console.warn('[TranscriptionService] refresh after intensity change failed:', e)
      );
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

  /**
   * 重置部分狀態（用於提交後或強制清空時）
   * @param clearBuffer 是否同時清空緩衝區
   */
  private resetPartialState(clearBuffer: boolean = true): void {
    if (clearBuffer) {
      this.rollingBuffer = new Int16Array(0);
    }
    this.lastPartialText = '';
    this.lastValidPartialText = '';
    this.stabilityCounter = 0;
  }

  // 保持接口兼容
  clear() {
    this.rollingBuffer = new Int16Array(0);
    this.stableText = '';
    this.lastPartialText = '';
    this.lastValidPartialText = '';
    this.totalSamplesReceived = 0;
    this.lastCommitSnapshot = null;
    this.keywords = undefined;
    subtitleService.clear();
    refinementService.clear(); // 清空精修隊列
  }
}

export const transcriptionService = new TranscriptionService();
