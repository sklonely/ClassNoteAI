/**
 * Streaming ASR pipeline orchestrator for the in-process Nemotron engine.
 *
 * Raw deltas are useful for live UX feedback, but the final/cumulative
 * transcript is the stable source for subtitles and translation.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SentenceAccumulator } from './sentenceAccumulator';
import { findTranscriptBoundary } from './transcriptSegmenter';
import { translationPipeline } from './translationPipeline';
import { subtitleStream } from './subtitleStream';

export interface WordEvent {
  text: string;
  start: number;
  end: number;
  is_final: boolean;
}

interface ParakeetStatus {
  variants?: Array<{
    variant: 'int8' | 'fp32';
    present: boolean;
  }>;
  model_present?: boolean;
  model_loaded: boolean;
  session_active: boolean;
}

interface AsrTextEvent {
  session_id: string;
  delta: string;
  transcript?: string;
  audio_end_sec: number;
}

interface AsrSessionEndedEvent {
  session_id: string;
  transcript: string;
}

const SAMPLE_RATE = 16000;

function hasUsableParakeetModel(status: ParakeetStatus): boolean {
  if (status.model_loaded || status.model_present) return true;
  return status.variants?.some((variant) => variant.present) ?? false;
}

export class AsrPipeline {
  private sessionId: string | null = null;
  private fallbackAccumulator = new SentenceAccumulator();
  private startedAt = 0;
  private lastAudioEndSec = 0;
  private committedTranscript = '';
  private finalTailStartSec = 0;
  private previewText = '';
  private unlistenText: UnlistenFn | null = null;
  private unlistenEnded: UnlistenFn | null = null;

  async start(_language?: string): Promise<void> {
    if (this.sessionId) {
      console.warn('[asrPipeline] start() called twice; ending previous session first');
      await this.stop();
    }

    const status = await invoke<ParakeetStatus>('get_parakeet_status');
    if (!hasUsableParakeetModel(status)) {
      throw new Error(
        'Nemotron model is not available. Please install or load the bundled INT8 model in Settings > Local Transcription.',
      );
    }

    // Phase 7 cp74.2: read user-selected variant from settings (PTranscribe
    // → Parakeet Variant). FP32 is materially better on non-native /
    // accented English but the renderer used to drop the setting on the
    // floor — Rust auto-loaded INT8 regardless. Now we forward.
    let preferredVariant: 'int8' | 'fp32' | undefined;
    try {
      const { storageService } = await import('../storageService');
      const settings = await storageService.getAppSettings();
      preferredVariant = settings?.experimental?.parakeetVariant;
    } catch (err) {
      console.warn('[asrPipeline] could not read parakeet variant pref:', err);
    }

    const sessionId = crypto.randomUUID();
    await invoke('asr_start_session', {
      sessionId,
      preferredVariant: preferredVariant ?? null,
    });
    this.sessionId = sessionId;
    this.startedAt = Date.now();
    this.lastAudioEndSec = 0;
    this.committedTranscript = '';
    this.finalTailStartSec = 0;
    this.previewText = '';
    this.fallbackAccumulator.reset();
    translationPipeline.reset();

    subtitleStream.emit({
      kind: 'session_started',
      sessionId,
      sampleRate: SAMPLE_RATE,
      language: 'en',
    });

    this.unlistenText = await listen<AsrTextEvent>('asr-text', (event) => {
      this.onText(event.payload);
    });
    this.unlistenEnded = await listen<AsrSessionEndedEvent>('asr-session-ended', (event) => {
      if (event.payload.session_id !== this.sessionId) return;
      console.log('[asrPipeline] engine reported session ended:', event.payload.session_id);
    });

    console.log(`[asrPipeline] session ${this.sessionId} ready (in-process Nemotron)`);
  }

  async pushAudio(pcm: Int16Array): Promise<void> {
    if (!this.sessionId) {
      console.warn('[asrPipeline] pushAudio before start()');
      return;
    }
    try {
      await invoke('asr_push_audio', {
        sessionId: this.sessionId,
        pcm: Array.from(pcm),
      });
    } catch (e) {
      console.warn('[asrPipeline] pushAudio failed:', e);
    }
  }

  async stop(): Promise<void> {
    if (!this.sessionId) return;
    const id = this.sessionId;

    let transcript = '';
    try {
      transcript = await invoke<string>('asr_end_session', { sessionId: id });
      console.log(`[asrPipeline] session ${id} final transcript: ${transcript.length} chars`);
    } catch (e) {
      console.warn('[asrPipeline] end_session failed (non-fatal):', e);
    }

    if (this.unlistenText) {
      this.unlistenText();
      this.unlistenText = null;
    }
    if (this.unlistenEnded) {
      this.unlistenEnded();
      this.unlistenEnded = null;
    }

    if (typeof transcript === 'string' && transcript.trim().length > 0) {
      this.consumeTranscriptSnapshot(transcript, this.lastAudioEndSec, true);
    } else {
      for (const sent of this.fallbackAccumulator.flush()) {
        this.commitSentence(sent.text, sent.startSec, sent.endSec);
      }
    }

    this.sessionId = null;

    subtitleStream.emit({
      kind: 'session_ended',
      sessionId: id,
      finalWallClockMs: Date.now() - this.startedAt,
    });
  }

  private onText(payload: AsrTextEvent): void {
    if (!this.sessionId || payload.session_id !== this.sessionId) return;
    const sessionId = this.sessionId;

    this.appendPreviewDelta(payload.delta);
    if (payload.transcript && payload.transcript.trim().length > 0) {
      this.consumeTranscriptSnapshot(payload.transcript, payload.audio_end_sec, false);
    } else {
      this.consumeLegacyDelta(payload);
    }
    this.lastAudioEndSec = payload.audio_end_sec;

    subtitleStream.emit({
      kind: 'partial_text',
      sessionId,
      text: this.previewText,
      audioEndSec: payload.audio_end_sec,
    });
  }

  private appendPreviewDelta(delta: string): void {
    const text = delta.trim();
    if (!text) return;
    this.previewText = [this.previewText, text].filter(Boolean).join(' ');
  }

  private consumeLegacyDelta(payload: AsrTextEvent): void {
    const tokens = payload.delta.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return;

    const span = Math.max(0, payload.audio_end_sec - this.lastAudioEndSec);
    const perToken = span / tokens.length;

    let cursor = this.lastAudioEndSec;
    for (const text of tokens) {
      const word: WordEvent = {
        text,
        start: cursor,
        end: cursor + perToken,
        is_final: true,
      };
      cursor += perToken;
      const sentences = this.fallbackAccumulator.push(word);
      for (const s of sentences) {
        this.commitSentence(s.text, s.startSec, s.endSec);
        this.previewText = this.fallbackAccumulator.bufferedText;
      }
    }
  }

  private consumeTranscriptSnapshot(
    transcript: string,
    audioEndSec: number,
    forceFlush: boolean,
  ): void {
    if (!this.sessionId) return;

    if (this.committedTranscript && !transcript.startsWith(this.committedTranscript)) {
      const prefix = commonPrefixLength(this.committedTranscript, transcript);
      this.committedTranscript = this.committedTranscript.slice(0, prefix);
    }

    while (true) {
      const tailStart = this.committedTranscript.length;
      const rawTail = transcript.slice(tailStart);
      const leadingWhitespace = rawTail.match(/^\s*/)?.[0].length ?? 0;
      const tail = rawTail.slice(leadingWhitespace);

      if (!tail.trim()) {
        this.previewText = '';
        return;
      }

      const boundary = findTranscriptBoundary(tail, this.finalTailStartSec, audioEndSec, forceFlush);
      if (!boundary) {
        this.previewText = tail.trim();
        return;
      }

      const text = tail.slice(0, boundary.endIndex).trim();
      if (!text) return;

      const absoluteEnd = tailStart + leadingWhitespace + boundary.endIndex;
      this.commitSentence(text, this.finalTailStartSec, boundary.endSec);
      this.committedTranscript = transcript.slice(0, absoluteEnd);
      this.finalTailStartSec = boundary.endSec;
      this.previewText = transcript.slice(absoluteEnd).trim();
    }
  }

  private commitSentence(text: string, startSec: number, endSec: number): void {
    if (!this.sessionId) return;
    const id = crypto.randomUUID();
    subtitleStream.emit({
      kind: 'sentence_committed',
      id,
      sessionId: this.sessionId,
      audioStartSec: startSec,
      audioEndSec: endSec,
      wallClockMs: Date.now() - this.startedAt,
      textEn: text,
      speakerRole: 'unknown',
    });
    translationPipeline.enqueue({
      id,
      sessionId: this.sessionId,
      textEn: text,
      enqueuedAt: Date.now(),
    });
  }
}

export const asrPipeline = new AsrPipeline();

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}
