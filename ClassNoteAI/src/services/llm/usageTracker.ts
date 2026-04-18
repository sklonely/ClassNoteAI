/**
 * LLM token-usage bookkeeping. Every task-level function in tasks.ts
 * calls `usageTracker.record(...)` after it completes so the UI can:
 *
 *   1. Render per-call "in:X out:Y" hints next to the feature that just
 *      fired (assistant chat bubble, Summary footer, 精修 badge on
 *      subtitles, etc.)
 *   2. Aggregate totals per provider × model for the settings/about
 *      surface so users see "how much have I spent today".
 *
 * Rationale for NOT threading usage through function returns: most
 * callers don't care, and extending every return type to `{content,
 * usage}` is a ripple of breaking changes across CourseDetailView /
 * CourseListView / NotesView / AIChatPanel. The tracker-with-timestamp
 * pattern means legacy callers keep their `.then((text) => ...)`
 * shape while new display surfaces subscribe or query on demand.
 */

export type UsageTask =
  | 'summarize'
  | 'syllabus'
  | 'keywords'
  | 'chat'
  | 'chatStream'
  | 'fineRefine';

export interface UsageEvent {
  providerId: string;
  model: string;
  task: UsageTask;
  inputTokens: number;
  outputTokens: number;
  /** Number of subtitle segments covered by this call, when applicable.
   *  `fineRefine` aggregates a batch, so callers may want to attribute
   *  roughly `totalTokens / segments` per segment. */
  segments?: number;
  /** ms since epoch when the call returned. */
  at: number;
}

type Listener = (e: UsageEvent) => void;

class UsageTracker {
  private events: UsageEvent[] = [];
  private listeners = new Set<Listener>();
  // Events older than this are forgotten. Conservative: 24 h is
  // plenty for "today's usage" displays and caps memory growth during
  // long sessions.
  private static readonly RETENTION_MS = 24 * 60 * 60 * 1000;

  record(e: Omit<UsageEvent, 'at'>): UsageEvent {
    const event: UsageEvent = { ...e, at: Date.now() };
    this.events.push(event);
    this.prune();
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.warn('[UsageTracker] listener threw:', err);
      }
    }
    return event;
  }

  /** Most-recent event of a given task, useful for per-call inline
   *  display right after `await llmTask(...)` resolves. */
  latest(task?: UsageTask): UsageEvent | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (!task || e.task === task) return e;
    }
    return null;
  }

  /** All events since the given ms timestamp. Defaults to everything
   *  still in the retention window. */
  since(ms: number = 0): UsageEvent[] {
    if (ms <= 0) return this.events.slice();
    return this.events.filter((e) => e.at >= ms);
  }

  /** Per-provider totals over the given window. Sorted by total tokens
   *  desc so the busiest provider is first. */
  totals(ms: number = 0): Array<{
    providerId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  }> {
    const map = new Map<
      string,
      { providerId: string; model: string; inputTokens: number; outputTokens: number; calls: number }
    >();
    for (const e of this.since(ms)) {
      const key = `${e.providerId}|${e.model}`;
      const cur = map.get(key) || {
        providerId: e.providerId,
        model: e.model,
        inputTokens: 0,
        outputTokens: 0,
        calls: 0,
      };
      cur.inputTokens += e.inputTokens;
      cur.outputTokens += e.outputTokens;
      cur.calls += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
    );
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private prune() {
    const cutoff = Date.now() - UsageTracker.RETENTION_MS;
    if (this.events.length > 0 && this.events[0].at < cutoff) {
      this.events = this.events.filter((e) => e.at >= cutoff);
    }
  }
}

export const usageTracker = new UsageTracker();
