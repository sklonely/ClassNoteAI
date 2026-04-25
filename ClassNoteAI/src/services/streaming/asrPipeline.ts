/**
 * Streaming ASR pipeline orchestrator (v2.1: in-process Nemotron).
 *
 * Owns the full lifecycle:
 *   1. Make sure the Nemotron model is loaded into RAM (auto-load on
 *      first start; download required separately via Settings).
 *   2. Open an ASR session (the renderer picks the id).
 *   3. Listen for `asr-text` Tauri events (delta text + audio time).
 *   4. Forward audio chunks pushed by the mic recorder.
 *   5. Convert each delta into per-word events for SentenceAccumulator.
 *   6. Hand confirmed sentences to the TranslationPipeline.
 *   7. Emit subtitle events to subtitleStream.
 *
 * v2.0 → v2.1 protocol changes:
 *   * No more EventSource / SSE / port number — events come from
 *     `@tauri-apps/api/event` instead of `http://127.0.0.1:8090`.
 *   * `transcribe_chunk` returns delta text, not word events with
 *     timestamps. We synthesise per-word timestamps by distributing
 *     `audio_end_sec - lastAudioEndSec` evenly across the words in
 *     the delta. Good enough for SentenceAccumulator's boundary
 *     rules (which only care about coarse word duration); not a
 *     substitute for true ASR word timing if a future feature needs it.
 *   * Nemotron is cache-aware streaming — committed text doesn't get
 *     retracted. So every word is `is_final=true`; the speculative
 *     `partial_text` channel is mostly dead weight now (kept emitting
 *     empty for compatibility with subtitleStream subscribers).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { SentenceAccumulator } from './sentenceAccumulator';
import { translationPipeline } from './translationPipeline';
import { subtitleStream } from './subtitleStream';

export interface WordEvent {
  text: string;
  start: number; // seconds since session start
  end: number;
  is_final: boolean;
}

interface ParakeetStatus {
  model_present: boolean;
  model_loaded: boolean;
  session_active: boolean;
  total_model_size: number;
  bytes_on_disk: number;
  model_dir: string | null;
}

interface AsrTextEvent {
  session_id: string;
  delta: string;
  audio_end_sec: number;
}

interface AsrSessionEndedEvent {
  session_id: string;
  transcript: string;
}

const SAMPLE_RATE = 16000;

export class AsrPipeline {
  private sessionId: string | null = null;
  private accumulator = new SentenceAccumulator();
  private startedAt = 0;
  private lastAudioEndSec = 0;
  private unlistenText: UnlistenFn | null = null;
  private unlistenEnded: UnlistenFn | null = null;

  /**
   * Open a session. Auto-loads the Nemotron model on first call (the
   * first session pays the ~3-5 s ort session creation cost, later
   * ones are instant).
   */
  async start(_language?: string): Promise<void> {
    if (this.sessionId) {
      console.warn('[asrPipeline] start() called twice; ending previous session first');
      await this.stop();
    }

    // Sanity-check the model is on disk; the engine will produce a
    // clearer error than `transcribe_chunk` deep in the stack would.
    const status = await invoke<ParakeetStatus>('get_parakeet_status');
    if (!status.model_present) {
      throw new Error(
        'Nemotron 模型尚未下載。請至 設定 → 本地轉錄 下載模型（約 2.5 GB）。',
      );
    }

    const sessionId = crypto.randomUUID();
    await invoke('asr_start_session', { sessionId });
    this.sessionId = sessionId;
    this.startedAt = Date.now();
    this.lastAudioEndSec = 0;
    this.accumulator.reset();
    translationPipeline.reset();

    subtitleStream.emit({
      kind: 'session_started',
      sessionId: this.sessionId,
      sampleRate: SAMPLE_RATE,
      language: 'en',
    });

    // Subscribe to engine events. We listen on the global topic and
    // filter by session_id inside the handler — Tauri's listen API
    // doesn't support per-payload filters directly.
    this.unlistenText = await listen<AsrTextEvent>('asr-text', (event) => {
      this.onText(event.payload);
    });
    this.unlistenEnded = await listen<AsrSessionEndedEvent>('asr-session-ended', (event) => {
      // Engine fired its own end signal (e.g. from a background
      // shutdown). The renderer's stop() also fires this through the
      // engine, so this listener mostly serves as a safety net.
      if (event.payload.session_id !== this.sessionId) return;
      console.log('[asrPipeline] engine reported session ended:', event.payload.session_id);
    });

    console.log(`[asrPipeline] session ${this.sessionId} ready (in-process Nemotron)`);
  }

  /**
   * Push int16 PCM audio. Called by audioRecorder for each captured
   * chunk; the engine accumulates internally until it has a 560 ms
   * worth of samples (8960), then runs one cache-aware transcribe
   * step.
   */
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

  /**
   * End the session. Flushes any tail text from the engine, closes
   * event subscriptions, and tells the engine to release session
   * state (the model stays loaded for the next session).
   */
  async stop(): Promise<void> {
    if (!this.sessionId) return;
    const id = this.sessionId;
    this.sessionId = null;

    if (this.unlistenText) {
      this.unlistenText();
      this.unlistenText = null;
    }
    if (this.unlistenEnded) {
      this.unlistenEnded();
      this.unlistenEnded = null;
    }

    try {
      // Engine emits any tail-end deltas via "asr-text" before
      // returning, but our listener is already torn down by the time
      // those fire — so we drain via the function return value
      // instead. The cumulative transcript is logged for diagnostics
      // but the streaming events are the source of truth for
      // subtitleStream consumers.
      const transcript = await invoke<string>('asr_end_session', { sessionId: id });
      console.log(`[asrPipeline] session ${id} final transcript: ${transcript.length} chars`);
    } catch (e) {
      console.warn('[asrPipeline] end_session failed (non-fatal):', e);
    }

    // Force-flush whatever the SentenceAccumulator still buffers.
    for (const sent of this.accumulator.flush()) {
      this.commitSentence(sent.text, sent.startSec, sent.endSec);
    }

    subtitleStream.emit({
      kind: 'session_ended',
      sessionId: id,
      finalWallClockMs: Date.now() - this.startedAt,
    });
  }

  private onText(payload: AsrTextEvent): void {
    if (!this.sessionId || payload.session_id !== this.sessionId) return;

    // Split delta into word tokens. Nemotron emits punctuation
    // attached to words ("Hello," is one token), which is exactly
    // what SentenceAccumulator's boundary rules expect.
    const tokens = payload.delta.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return;

    // Distribute audio time evenly across the new tokens. Coarse —
    // the engine processed one 560 ms cache-aware chunk and committed
    // however many words landed in it, so the per-word duration we
    // synthesise here is closer to "average", not actual.
    const span = Math.max(0, payload.audio_end_sec - this.lastAudioEndSec);
    const perToken = tokens.length > 0 ? span / tokens.length : 0;

    let cursor = this.lastAudioEndSec;
    for (const text of tokens) {
      const word: WordEvent = {
        text,
        start: cursor,
        end: cursor + perToken,
        is_final: true,
      };
      cursor += perToken;
      const sentences = this.accumulator.push(word);
      for (const s of sentences) {
        this.commitSentence(s.text, s.startSec, s.endSec);
      }
    }
    this.lastAudioEndSec = payload.audio_end_sec;

    // Clear the partial-text channel — Nemotron is cache-aware so
    // there's no speculative tail to display. Existing UI subscribers
    // expect occasional empty payloads to clear their draft buffer.
    subtitleStream.emit({
      kind: 'partial_text',
      sessionId: this.sessionId,
      text: '',
      audioEndSec: payload.audio_end_sec,
    });
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
