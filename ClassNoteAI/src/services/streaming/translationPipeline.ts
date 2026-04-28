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

  /**
   * Hard cap on queued (not in-flight) translation jobs. If the
   * translator stalls (sidecar dies mid-lecture, llama-server hung) we
   * could otherwise grow `queue` unboundedly with one job per sentence
   * for the rest of the recording. 5000 is high enough that a healthy
   * 2-3hr lecture never hits it (typical: 1500-2500 sentences) but low
   * enough to bound memory at a few MB.
   *
   * `private static` rather than a `const` at module scope so tests can
   * shrink it via {@link __setMaxQueueSizeForTest}.
   */
  private static DEFAULT_MAX_QUEUE_SIZE = 5_000;
  private maxQueueSize: number = TranslationPipeline.DEFAULT_MAX_QUEUE_SIZE;

  /**
   * Counter of jobs we've dropped since the last `translation_backlog`
   * event. Reset to 0 each emit. Used so the UI can show "X sentences
   * lost" rather than re-firing per-job.
   */
  private droppedDueToBacklog = 0;
  /** Wall-clock ms of last `translation_backlog` emit. Throttle = 1s. */
  private lastBacklogEmit = 0;

  /** Push a sentence for async translation. Non-blocking. */
  enqueue(job: TranslationJob): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.droppedDueToBacklog += 1;
      const now = Date.now();
      // 1s throttle — translator backlog tends to fire in bursts and
      // we don't want to spam the listener (or the console) per job.
      if (now - this.lastBacklogEmit > 1_000) {
        this.lastBacklogEmit = now;
        const dropped = this.droppedDueToBacklog;
        this.droppedDueToBacklog = 0;
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(
            new CustomEvent('translation_backlog', {
              detail: { dropped, queueSize: this.queue.length },
            }),
          );
        }
      }
      return; // dropped — never enters the queue
    }
    this.queue.push(job);
    void this.drain();
  }

  /**
   * Resolve once the queue is empty AND no job is currently in flight.
   * Used by `recordingSessionService.stop()` so we don't flip the
   * lecture to 'completed' before the final sentence's zh translation
   * has come back from the translator.
   *
   * 50ms polling (per Phase 7 plan) — simpler than threading an
   * event-emitter through the existing drain loop, and the latency
   * budget for stop is several hundred ms anyway.
   */
  awaitDrain(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && !this.processing) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  /** Test-only: read current queue length. */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Test-only escape hatch — pass a number to shrink the cap (so unit
   * tests don't have to push 5000+ jobs), or `null` to restore the
   * production default. Prefixed with `__` to discourage callers from
   * touching it outside tests.
   *
   * Also drops any queued (not in-flight) jobs and zeroes the backlog
   * counters so a previous test's leftovers don't leak into the next.
   * The currently in-flight job is not cancellable — the next call to
   * `drain()` will see it through; tests that hold the translator with
   * a never-resolving promise should accept that single in-flight job
   * is effectively "lost" for the rest of the run (process will exit).
   */
  __setMaxQueueSizeForTest(size: number | null): void {
    this.maxQueueSize = size ?? TranslationPipeline.DEFAULT_MAX_QUEUE_SIZE;
    this.queue = [];
    this.droppedDueToBacklog = 0;
    this.lastBacklogEmit = 0;
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
        await this.translateOne(job);
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
}

export const translationPipeline = new TranslationPipeline();
