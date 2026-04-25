/**
 * Append-only subtitle event stream.
 *
 * The pipeline emits events here; UI / DB / analytics subscribe.
 * Replaces the v1 model where transcriptionService called
 * subtitleService.addSegment / updateCurrentText directly.
 *
 * Why a stream:
 *   - Multiple consumers (UI, persistence, RAG indexer) without
 *     coupling them to each other.
 *   - Easy to add new consumers (e.g. live caption for second window).
 *   - Test fixtures can mock by subscribing and asserting events.
 *   - Time-ordered log of everything that happened in a session, useful
 *     for replay / debug.
 */

export type SubtitleEvent =
  | {
      kind: 'sentence_committed';
      id: string;
      sessionId: string;
      audioStartSec: number;
      audioEndSec: number;
      wallClockMs: number;
      textEn: string;
    }
  | {
      kind: 'translation_ready';
      id: string;
      sessionId: string;
      textZh: string;
      provider: 'gemma' | 'local' | 'google';
      latencyMs: number;
    }
  | {
      kind: 'translation_failed';
      id: string;
      sessionId: string;
      error: string;
    }
  | {
      kind: 'partial_text';
      sessionId: string;
      text: string;
      audioEndSec: number;
    }
  | {
      kind: 'session_started';
      sessionId: string;
      sampleRate: number;
      language?: string;
    }
  | {
      kind: 'session_ended';
      sessionId: string;
      finalWallClockMs: number;
    };

type Listener = (event: SubtitleEvent) => void;

class SubtitleStream {
  private listeners = new Set<Listener>();

  emit(event: SubtitleEvent): void {
    // Snapshot listeners so a subscriber that unsubscribes during dispatch
    // doesn't trip the iteration.
    for (const l of [...this.listeners]) {
      try {
        l(event);
      } catch (e) {
        console.error('[subtitleStream] listener threw:', e);
      }
    }
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const subtitleStream = new SubtitleStream();
