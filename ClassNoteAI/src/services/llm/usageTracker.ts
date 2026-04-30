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
 *
 * cp75.26 — STORAGE_KEY is now user-scoped via the cp75.3 composite-key
 * pattern (`<userIdSegment>::<base>`). Previously a single global bucket
 * meant User A's usage bled into User B's "today" summary on multi-user
 * machines. The legacy unscoped key is left orphaned — no auto-migration
 * because we have no way to know which user the legacy data belongs to.
 */

import { authService } from '../authService';

export type UsageTask =
  | 'summarize'
  | 'syllabus'
  | 'keywords'
  | 'chat'
  | 'chatStream'
  // Short LLM-backed query-translation used by RAG cross-lingual
  // retrieval. Kept separate from 'chat' so the AI 助教 token
  // counter doesn't get polluted by these small helper calls.
  | 'translate'
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

/**
 * cp75.26 — base key, prefixed at use-site by the active user's
 * id-segment so multi-user machines isolate usage history. Resolved
 * lazily via `getStorageKey()` rather than captured at module-load time
 * so a user switch (logout → login as different user) re-targets the
 * next `persist()` / `loadFromStorage()` call to the new bucket.
 */
const BASE_STORAGE_KEY = 'llm.usageTracker.events.v1';

function getStorageKey(): string {
  return `${authService.getUserIdSegment()}::${BASE_STORAGE_KEY}`;
}

class UsageTracker {
  private events: UsageEvent[] = [];
  private listeners = new Set<Listener>();
  // Events older than this are forgotten. Conservative: 24 h is
  // plenty for "today's usage" displays and caps memory growth during
  // long sessions.
  private static readonly RETENTION_MS = 24 * 60 * 60 * 1000;

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Load persisted events from localStorage on boot so users see
   * cumulative usage across app restarts, not just the current session.
   * Any parse error clears the slate — the tracker is a telemetry
   * convenience, not source-of-truth billing.
   */
  private loadFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.events = parsed.filter(
          (e): e is UsageEvent =>
            e &&
            typeof e.providerId === 'string' &&
            typeof e.model === 'string' &&
            typeof e.task === 'string' &&
            typeof e.inputTokens === 'number' &&
            typeof e.outputTokens === 'number' &&
            typeof e.at === 'number',
        );
        this.prune();
      }
    } catch (err) {
      console.warn('[UsageTracker] localStorage parse failed; starting clean:', err);
      this.events = [];
    }
  }

  private persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(this.events));
    } catch (err) {
      // Quota / disabled storage — non-fatal; we just lose persistence.
      console.warn('[UsageTracker] localStorage write failed:', err);
    }
  }

  record(e: Omit<UsageEvent, 'at'>): UsageEvent {
    const event: UsageEvent = { ...e, at: Date.now() };
    this.events.push(event);
    this.prune();
    this.persist();
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.warn('[UsageTracker] listener threw:', err);
      }
    }
    return event;
  }

  /** Wipe all persisted events. Used by Settings → "重置用量" button. */
  clear() {
    this.events = [];
    this.persist();
    for (const l of this.listeners) {
      try {
        l({ providerId: '', model: '', task: 'chat', inputTokens: 0, outputTokens: 0, at: 0 });
      } catch {
        // ignore
      }
    }
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
