/**
 * Sentence → translation pipeline.
 *
 * Replaces the v1 inline translation call inside `commitStableText` with
 * a queue-based async pipeline that:
 *
 *  1. Runs translation off the hot path (the audio thread doesn't block
 *     waiting for the LLM).
 *  2. Caches per-sentence (via `translateRough`'s built-in cache) so
 *     duplicate utterances don't re-translate.
 *  3. Retries once on transient HTTP errors before giving up — a single
 *     dropped sentence in a 70-min lecture is jarring; mid-stream
 *     llama-server hiccups are common enough to be worth a single
 *     retry.
 *  4. Surfaces translations via the subtitle stream rather than direct
 *     subtitleService writes — UI subscribes once, gets everything.
 *
 * Rolling-context-window prompting is **not** implemented yet — see
 * the `context` field's comment. The v1-style "prepend prior sentences"
 * trick interacts badly with TranslateGemma's chat template (the model
 * starts translating the prefix as part of the answer). The proper
 * structured-history wiring is deferred until we either switch to
 * Gemma's chat-completions endpoint or add a context-aware system
 * prompt. Callers that need cross-sentence pronoun resolution today
 * should use the fine-translation pass.
 */

import { translateRough } from '../translationService';
import { subtitleStream } from './subtitleStream';

interface TranslationJob {
  id: string;
  sessionId: string;
  textEn: string;
  enqueuedAt: number;
}

/** Wait `ms` milliseconds. Small helper to keep the retry path readable. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detect retryable errors from `translateRough`. Connection refused,
 * timeouts, and 5xx-ish messages are retryable; "model not loaded" or
 * "invalid input" are not. Heuristic — `translateRough` only surfaces
 * the message string from the Rust backend.
 */
function isRetryable(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    msg.includes('未啟動') ||      // gemma_sidecar's friendly Chinese connect-error
    msg.includes('connect') ||     // generic connect refused
    msg.includes('timeout') ||
    msg.includes('逾時') ||
    msg.includes('http error') ||  // gemma::translate's catch-all
    msg.includes('5')              // 5xx status (loose; translation is idempotent so over-retrying is cheap)
  );
}

class TranslationPipeline {
  private queue: TranslationJob[] = [];
  private processing = false;

  /** Push a sentence for async translation. Non-blocking. */
  enqueue(job: TranslationJob): void {
    this.queue.push(job);
    this.emitStatus(job.sessionId);
    void this.drain();
  }

  /**
   * Reset between recording sessions. No durable state to clear today
   * (no rolling context yet) — kept for forward compatibility so callers
   * don't have to start tracking a new lifecycle when context lands.
   */
  reset(): void {
    // intentionally empty
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        this.emitStatus(job.sessionId);
        await this.translateOne(job);
        this.emitStatus(job.sessionId);
      }
    } finally {
      this.processing = false;
    }
  }

  private async translateOne(job: TranslationJob): Promise<void> {
    const start = performance.now();
    const RETRY_DELAY_MS = 500;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await translateRough(
          job.textEn,
          'en',
          'zh',
          /* useCache */ true,
        );
        const latencyMs = performance.now() - start;
        const zh = (result.translated_text || '').trim();
        if (!zh) {
          subtitleStream.emit({
            kind: 'translation_failed',
            id: job.id,
            sessionId: job.sessionId,
            error: 'translator returned empty',
          });
          return;
        }
        // The TranslationResult.source field ('Rough' | 'Fine') doesn't
        // distinguish between local CT2 / Gemma / Google. Until backend
        // returns provider tag, mark as 'gemma' (current default) — the UI
        // only uses this for telemetry/badges, not for correctness.
        subtitleStream.emit({
          kind: 'translation_ready',
          id: job.id,
          sessionId: job.sessionId,
          textZh: zh,
          provider: 'gemma',
          latencyMs,
        });
        return;
      } catch (e) {
        lastError = e;
        if (attempt === 0 && isRetryable(e)) {
          await delay(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }

    subtitleStream.emit({
      kind: 'translation_failed',
      id: job.id,
      sessionId: job.sessionId,
      error: String((lastError as { message?: string })?.message ?? lastError),
    });
  }

  private emitStatus(sessionId: string): void {
    const oldest = this.queue[0];
    subtitleStream.emit({
      kind: 'pipeline_status',
      sessionId,
      translationQueueDepth: this.queue.length,
      oldestTranslationAgeMs: oldest ? Math.max(0, Date.now() - oldest.enqueuedAt) : 0,
    });
  }
}

export const translationPipeline = new TranslationPipeline();
