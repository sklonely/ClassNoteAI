/**
 * Transcription service - v2 streaming pipeline shim.
 *
 * Replaces the v1 1093-line Whisper rolling-buffer + 3-strategy commit
 * monolith with a thin facade over the new streaming pipeline. All real
 * work lives in the modules under `services/streaming/`:
 *
 *   - `asrPipeline`            owns Parakeet sidecar lifecycle + sessions
 *   - `sentenceAccumulator`    word stream -> complete sentence detection
 *   - `translationPipeline`    sentence -> translated, with rolling context
 *   - `subtitleStream`         append-only event bus
 *
 * This file exists only to preserve the public method names that
 * `LectureView.tsx` and `NotesView.tsx` already call (`addAudioChunk`,
 * `start`, `stop`, `setLectureId`, etc.) so we don't have to touch
 * those components in the same PR. Each method delegates to the
 * pipeline; consumers see the same API but get streaming-native
 * behaviour underneath.
 *
 * Concepts that no longer exist in v2 (and so are no-ops here):
 *   - audio rolling buffer / 30 s window  -> not needed; sidecar streams
 *   - 3 commit strategies + stability counter -> SentenceAccumulator
 *   - inline translation in `commitStableText` -> TranslationPipeline
 *   - audio-slice fine refinement -> dropped (Parakeet accuracy is good
 *     enough; refinement was a Whisper bandaid)
 */

import { subtitleService } from './subtitleService';
import { asrPipeline } from './streaming/asrPipeline';
import { subtitleStream } from './streaming/subtitleStream';
import type { AudioChunk } from './audioRecorder';

class TranscriptionService {
  // Retained as part of the public API for callers that may persist
  // the active lecture id; v2 doesn't act on it directly because the
  // streaming pipeline isn't lecture-aware (subtitles flow through
  // subtitleStream which is session-keyed, not lecture-keyed). Exposed
  // as a getter so tsc doesn't warn about the field being write-only.
  private _lectureId: string | null = null;
  get lectureId(): string | null {
    return this._lectureId;
  }
  /**
   * BCP-47-ish source language; "auto" is treated as "en" for now since
   * Parakeet TDT v2 is English-only. Multi-language ASR is a follow-up
   * (canary-1b-v2 is the candidate, swappable behind the same backend
   * trait).
   */
  private sourceLang: string = 'auto';
  /** Subtitle-stream subscription cleanup. */
  private unsubscribe: (() => void) | null = null;
  /** True between start() and stop(). */
  private active = false;
  /** Coalesces concurrent explicit/implicit starts while ASR warms up. */
  private startPromise: Promise<void> | null = null;
  /** True between pause() and resume(). Independent of `active` so
   *  pausing doesn't fool `addAudioChunk` into starting a fresh session
   *  on the next chunk while the engine still holds the previous one. */
  private paused = false;
  /** Track committed segments so translation_ready can find them. */
  private startTimeWall = 0;

  /**
   * @deprecated v1 hint plumbing. The streaming backend doesn't accept
   * an initial-prompt parameter (Parakeet RNN-T can't be biased the way
   * Whisper's prompt could). Kept as no-op so callers don't break.
   */
  setInitialPrompt(_prompt: string, _keywords?: string): void {
    // intentionally empty
  }

  /**
   * @deprecated Refinement was a Whisper-specific 2nd pass; v2 doesn't
   * need it. No-op.
   */
  setRefineIntensity(_intensity: 'off' | 'light' | 'deep'): void {
    // intentionally empty
  }

  /**
   * @deprecated Same - fine refinement is gone. Returns an immediately-
   * resolving promise so callers awaiting it don't hang.
   */
  async refreshFineRefinementAvailability(): Promise<void> {
    // intentionally empty
  }

  setLectureId(lectureId: string | null): void {
    this._lectureId = lectureId;
  }

  setLanguages(source: string, _target: string): void {
    this.sourceLang = source || 'auto';
  }

  /**
   * Open a streaming session. Brings up the Parakeet sidecar if needed
   * (idempotent), opens an ASR session, and subscribes to the subtitle
   * stream so the UI's existing `subtitleService` keeps getting fed.
   */
  async start(): Promise<void> {
    if (this.active) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      this.paused = false;
      this.startTimeWall = Date.now();

      // Bridge subtitleStream events into the existing subtitleService
      // API. Lets the UI keep working without rewriting SubtitleDisplay
      // in this PR. UI components that want finer-grained signals
      // (sub-second partial updates, provider tags, latency) can
      // subscribe to subtitleStream directly.
      if (this.unsubscribe) {
        this.unsubscribe();
      }
      this.unsubscribe = subtitleStream.subscribe((event) => {
        switch (event.kind) {
          case 'sentence_committed': {
            subtitleService.addSegment({
              id: event.id,
              roughText: event.textEn,
              roughTranslation: undefined,
              displayText: event.textEn,
              displayTranslation: undefined,
              startTime: this.startTimeWall + event.audioStartSec * 1000,
              endTime: this.startTimeWall + event.audioEndSec * 1000,
              source: 'rough',
              translationSource: undefined,
              speakerRole: event.speakerRole,
              speakerId: event.speakerId,
              text: event.textEn,
            });
            break;
          }
          case 'translation_ready': {
            // Persist into BOTH roughTranslation (the canonical rough-tier
            // store) and displayTranslation (the UI's current pointer).
            // Stop pipeline reads only roughTranslation/fineTranslation
            // when serializing to DB — if we update displayTranslation
            // alone, ReviewPage shows blank Chinese after stop because
            // text_zh persisted as undefined. (Phase 7 Bug 2 root cause.)
            subtitleService.updateSegment(event.id, {
              roughTranslation: event.textZh,
              displayTranslation: event.textZh,
              translationSource: 'rough',
            });
            break;
          }
          case 'partial_text': {
            subtitleService.updateCurrentText(event.text, undefined);
            break;
          }
          case 'session_ended':
          case 'translation_failed':
          case 'session_started':
          case 'pipeline_status':
            // No UI side-effect needed here; consumers that care
            // subscribe to subtitleStream directly.
            break;
        }
      });

      try {
        const language = this.sourceLang === 'auto' ? undefined : this.sourceLang;
        await asrPipeline.start(language);
        this.active = true;
      } catch (error) {
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = null;
        }
        this.active = false;
        this.paused = false;
        throw error;
      }
    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // A failed start has already cleaned up its subscription.
      }
    }
    if (!this.active) return;
    this.active = false;
    try {
      await asrPipeline.stop();
    } finally {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
    }
  }

  /**
   * Pause/resume the audio stream. Parakeet idles on no input, so
   * "pause" just means "drop incoming chunks until resume()". Crucially
   * we keep the engine session alive — the previous implementation
   * cleared `active`, which made the next `addAudioChunk` after pause
   * trigger a fresh `start()` while the backend session was still open,
   * losing both the in-flight session and the chunk that triggered it.
   */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /**
   * Forward a chunk from the mic recorder to the ASR sidecar. The
   * pipeline auto-starts on first chunk if the caller didn't explicitly
   * `start()` - historical UI flow relied on this implicit start.
   * Chunks arriving while paused are dropped silently.
   */
  addAudioChunk(chunk: AudioChunk): void {
    if (this.paused) return;
    void this.pushWhenReady(chunk);
  }

  private async pushWhenReady(chunk: AudioChunk): Promise<void> {
    if (!this.active) {
      await this.start();
    } else if (this.startPromise) {
      await this.startPromise;
    }
    if (!this.paused && this.active) {
      await asrPipeline.pushAudio(chunk.data);
    }
  }

  /**
   * Reset all state for a fresh recording on the same screen instance.
   * v1 also nuked an audio buffer here; v2 has no such buffer.
   */
  clear(): void {
    void this.stop();
    this._lectureId = null;
    this.sourceLang = 'auto';
  }
}

export const transcriptionService = new TranscriptionService();
