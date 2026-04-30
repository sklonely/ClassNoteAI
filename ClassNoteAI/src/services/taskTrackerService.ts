/**
 * taskTrackerService — Phase 7 Sprint 2 task S2.1 singleton.
 *
 * Owns the unified background-task registry. Long-running jobs
 * (post-recording summarisation, vector indexing, exports) register
 * themselves here so the H18 "Tasks" tray can render real progress
 * and so logout / app-close flows can cancel them deterministically.
 *
 * Sprint 2 surface:
 *   - start / update / complete / fail / cancel
 *   - getActive / getById
 *   - subscribe (immediate fire pattern, mirrors recordingSessionService)
 *   - reset (TEST-ONLY)
 *   - cancelAll (logout R-1 path)
 *   - restoreFromPersistence (S2.9 — called by App.tsx on boot)
 *   - W18 sticky completion toast (summarize / index only)
 *
 * Why a singleton (not a hook):
 *   - background tasks live across page navigation. A hook owning the
 *     Map would lose state every time the user clicked away from the
 *     tasks tray.
 *
 * subscribe() defensively copies the snapshot so callers can mutate
 * freely. Note: this means useService-style hooks would loop — Sprint
 * 2.5 (TaskIndicator) uses subscribe + useState directly, NOT useService.
 */

import {
    type TaskTrackerService,
    type TaskTrackerEntry,
    type TaskStartInput,
    type TaskKind,
    type TaskStatus,
} from './__contracts__/taskTrackerService.contract';

// Re-export contract symbols so callers don't have to know we live
// behind a contract dir. Same pattern recordingSessionService follows.
export type {
    TaskTrackerService,
    TaskTrackerEntry,
    TaskStartInput,
    TaskKind,
    TaskStatus,
};

/** Memory ceiling per H18-TASKINDICATOR-MERGE.md §8. Prevents the
 *  tasks Map from growing unboundedly if a long-running session fires
 *  many summarisation jobs. GC kicks the oldest terminal entries. */
const MAX_ENTRIES = 100;

/** Auto-remove delay for terminal `done` / `cancelled` tasks. Failed
 *  tasks are left around so the user can hit retry. */
const AUTO_REMOVE_DELAY_MS = 5_000;

/** cp75.14 fake-tween cadence — every TWEEN_INTERVAL_MS the tracker
 *  smoothly increments any running task's progress that hasn't received
 *  a real update recently. Stops the bar from looking "frozen at 95%"
 *  during the silent DB write / sticky reduce delta gaps. */
const TWEEN_INTERVAL_MS = 800;
/** Per-tick increment in fake-tween mode. With 800ms cadence and 0.005
 *  per tick, the bar drifts ~3.75% per minute — fast enough to feel
 *  alive, slow enough not to lap real progress. */
const TWEEN_STEP = 0.005;
/** Fake-tween will not push progress past this cap by itself — leaves
 *  the last 5% to be filled by the real `complete()` transition. */
const TWEEN_CAP = 0.95;

/**
 * S2.9 · localStorage persistence (退階方案).
 *
 * PHASE-7-PLAN §8.3 + §12 v3 audit S2.9 specifies that LLM tasks
 * (SUMMARIZE_LECTURE / INDEX_LECTURE) should persist via the existing
 * `pending_actions` SQLite table so an unexpected app close still
 * resumes the work on next launch. The proper implementation needs new
 * Tauri commands on the Rust side (`upsert_pending_action`,
 * `list_pending_actions_by_types`, `delete_pending_action`) which are
 * out of scope for this round.
 *
 * This commit ships the退階 path: persist LLM tasks to localStorage with
 * a `classnote-task-tracker:` key prefix. On launch, App.tsx calls
 * `restoreFromPersistence()` which rehydrates queued entries and emits
 * a single info toast. When the Rust commands land, swap the body of
 * `persistTask` / `removePersisted` / `restoreFromPersistence` to
 * invoke them — the call-sites and the contract are stable.
 *
 * Only `summarize` and `index` kinds are persisted. `export` is fully
 * synchronous from the user's perspective and isn't worth resuming
 * after an unclean shutdown — the underlying file artefact may not
 * even still be valid.
 */
const PERSIST_KEY_PREFIX = 'classnote-task-tracker:';

interface PersistedTaskRow {
    id: string;
    kind: TaskKind;
    label: string;
    lectureId?: string;
    startedAt: number;
}

class TaskTrackerServiceImpl implements TaskTrackerService {
    private tasks = new Map<string, TaskTrackerEntry>();
    private subscribers = new Set<(tasks: TaskTrackerEntry[]) => void>();
    /** Monotonic counter for id generation. Combined with Date.now()
     *  to produce unique ids even if two start() calls land in the
     *  same millisecond. */
    private nextId = 1;

    /** cp75.14 — last wall-clock time `update()` mutated each task's
     *  progress. The fake-tween loop reads this to decide when to step
     *  in (only push progress forward when nothing real has happened
     *  for TWEEN_INTERVAL_MS). */
    private lastProgressUpdate = new Map<string, number>();
    /** cp75.14 — single shared tween interval. Created lazily when the
     *  first task starts running and torn down when no running tasks
     *  remain (so the page doesn't keep a 800ms timer around forever). */
    private tweenInterval: ReturnType<typeof setInterval> | null = null;
    /**
     * S2.9 — in-memory mirror of every key we've written to localStorage
     * under PERSIST_KEY_PREFIX. We keep it as a fallback discovery path
     * for `restoreFromPersistence`: the canonical Web Storage iteration
     * (`length` + `key(i)`) works in real browsers + jsdom but the
     * minimal localStorage mock in test/setup.ts doesn't implement it.
     * Same pattern as services/llm/keyStore.ts `knownKeys`.
     */
    private persistedKeys = new Set<string>();

    // ─── Public API ─────────────────────────────────────────────────────

    start(input: TaskStartInput): string {
        // cp75.14 — implicit dedup by (kind, lectureId). When the user
        // retries a summary on ReviewPage we want the new task to
        // *replace* whatever was in the tray for the same lecture, not
        // pile on top of it. This handles three messy cases the user
        // hit:
        //   (a) stop-pipeline summarize fails → ReviewPage retry success →
        //       old failed entry still showed "失敗" in the tray
        //   (b) "重試摘要" + "生成課程摘要" duplicate failure rows
        //   (c) any same-lecture task that already terminated stale
        // Cancel queued/running siblings; drop terminal-but-still-shown
        // siblings. Limited to 'summarize' + 'index' (export tasks
        // intentionally CAN run in parallel — different files).
        if (
            input.lectureId &&
            (input.kind === 'summarize' || input.kind === 'index')
        ) {
            for (const [otherId, otherEntry] of this.tasks) {
                if (
                    otherEntry.kind !== input.kind ||
                    otherEntry.lectureId !== input.lectureId
                ) {
                    continue;
                }
                if (
                    otherEntry.status === 'queued' ||
                    otherEntry.status === 'running'
                ) {
                    // Active sibling — cancel so it stops emitting
                    // progress (and the user doesn't see two bars).
                    this.tasks.set(otherId, {
                        ...otherEntry,
                        status: 'cancelled',
                    });
                    this.removePersisted(otherId);
                } else if (
                    otherEntry.status === 'failed' ||
                    otherEntry.status === 'done' ||
                    otherEntry.status === 'cancelled'
                ) {
                    // Terminal sibling — drop from the tray immediately.
                    // The new task will represent the truth from now on.
                    this.tasks.delete(otherId);
                    this.lastProgressUpdate.delete(otherId);
                }
            }
        }

        const id = `tracker-${Date.now()}-${this.nextId++}`;
        const entry: TaskTrackerEntry = {
            id,
            kind: input.kind,
            label: input.label,
            lectureId: input.lectureId,
            progress: 0,
            status: 'queued',
            startedAt: Date.now(),
        };
        this.tasks.set(id, entry);
        this.lastProgressUpdate.set(id, Date.now());
        // GC if exceeding cap (kick out oldest done/failed/cancelled).
        if (this.tasks.size > MAX_ENTRIES) {
            this.gc();
        }
        this.notify();
        this.startTweenIfNeeded();
        // S2.9: persist LLM tasks so an unclean shutdown doesn't lose
        // the work. Wrapped in a guard inside persistTask so this is a
        // safe no-op for export kind.
        this.persistTask(id);
        return id;
    }

    update(taskId: string, patch: Partial<TaskTrackerEntry>): void {
        const e = this.tasks.get(taskId);
        if (!e) return; // ignore unknown id (race-safe per contract)
        // cp75.25 P1-A: drop late-arriving updates from a generator that
        // didn't know its task was already terminated. Common case: the
        // dedup logic in start() flips a sibling 'summarize' task to
        // 'cancelled', but the underlying summarizeStream generator that's
        // mid-yield calls update(oldTaskId, ...) on its next iteration
        // and visually re-activates the cancelled row.
        if (
            e.status === 'cancelled' ||
            e.status === 'failed' ||
            e.status === 'done'
        ) {
            return;
        }
        // Don't allow id / startedAt overrides — those are immutable
        // identity fields. Strip them out of the patch.
        const { id: _ignoreId, startedAt: _ignoreStart, ...safePatch } =
            patch as Partial<TaskTrackerEntry> & {
                id?: string;
                startedAt?: number;
            };
        // Clamp progress 0..1.
        if (safePatch.progress !== undefined) {
            safePatch.progress = Math.max(0, Math.min(1, safePatch.progress));
            // cp75.14 — only count caller-driven progress moves toward
            // the tween's "is this task alive" timer. Status-only patches
            // shouldn't reset the idle clock (otherwise a queued→running
            // flip would suppress the tween for a tick).
            this.lastProgressUpdate.set(taskId, Date.now());
        }
        this.tasks.set(taskId, { ...e, ...safePatch });
        this.notify();
    }

    complete(taskId: string): void {
        const e = this.tasks.get(taskId);
        if (!e) return;
        // Already terminal? No-op. Importantly, this prevents `failed`
        // → `done` transitions which would lose error state.
        if (
            e.status === 'done' ||
            e.status === 'failed' ||
            e.status === 'cancelled'
        ) {
            return;
        }
        this.tasks.set(taskId, { ...e, status: 'done', progress: 1 });
        this.lastProgressUpdate.delete(taskId);
        // cp75.14 — sweep stale failed/cancelled siblings of the same
        // (kind, lectureId). Common case: stop-pipeline summarize failed,
        // ReviewPage retry just succeeded → the old failed entry is now
        // misleading (the user has a summary). Drop those rows from the
        // tray rather than make the user dismiss them by hand.
        if (e.lectureId && (e.kind === 'summarize' || e.kind === 'index')) {
            for (const [otherId, otherEntry] of this.tasks) {
                if (
                    otherId === taskId ||
                    otherEntry.kind !== e.kind ||
                    otherEntry.lectureId !== e.lectureId
                ) {
                    continue;
                }
                if (
                    otherEntry.status === 'failed' ||
                    otherEntry.status === 'cancelled'
                ) {
                    this.tasks.delete(otherId);
                    this.lastProgressUpdate.delete(otherId);
                    this.removePersisted(otherId);
                }
            }
        }
        this.notify();
        this.stopTweenIfIdle();
        // S2.9: drop the persisted row — task succeeded, no resume needed.
        this.removePersisted(taskId);
        // W18: sticky success toast for LLM task completion. Per
        // H18-TASKINDICATOR-MERGE.md §6, only the tracker side fires this
        // — the underlying pipeline does NOT also fire its own toast,
        // otherwise the user sees double notifications. Export tasks are
        // intentionally excluded; they're synchronous-feeling enough that
        // a sticky toast after every save dialog would be noise.
        if (e.kind === 'summarize') {
            void import('./toastService').then(({ toastService }) => {
                toastService.success(
                    '✦ 摘要已完成',
                    `課堂「${e.label}」摘要生成完畢`,
                );
            });
        } else if (e.kind === 'index') {
            void import('./toastService').then(({ toastService }) => {
                toastService.success(
                    '✦ 索引已建立',
                    `課堂「${e.label}」可開始 RAG 對話`,
                );
            });
        }
        // Auto-remove after AUTO_REMOVE_DELAY_MS so the UI gets a
        // brief checkmark fade before the row disappears.
        setTimeout(() => {
            const cur = this.tasks.get(taskId);
            if (cur && cur.status === 'done') {
                this.tasks.delete(taskId);
                this.notify();
            }
        }, AUTO_REMOVE_DELAY_MS);
    }

    fail(taskId: string, err: string): void {
        const e = this.tasks.get(taskId);
        if (!e) return;
        // Don't transition out of `done` or `cancelled` — those are
        // already terminal. (`failed` → `failed` is fine, refreshes err.)
        if (e.status === 'done' || e.status === 'cancelled') return;
        this.tasks.set(taskId, { ...e, status: 'failed', error: err });
        this.lastProgressUpdate.delete(taskId);
        this.notify();
        this.stopTweenIfIdle();
        // S2.9 (v3 audit choice): drop persistence for failed tasks too.
        // Keeping the row would mean the next launch infinitely retries
        // a permanently-broken job. The user can rerun manually if they
        // want — that path opens a fresh task and a fresh persisted row.
        this.removePersisted(taskId);
        // Failed tasks are NOT auto-removed — the UI shows a retry
        // button until the user dismisses or retries.
    }

    cancel(taskId: string): void {
        const e = this.tasks.get(taskId);
        if (!e) return;
        // Only cancel active tasks. Completed / failed / already-cancelled
        // are no-ops.
        if (e.status !== 'queued' && e.status !== 'running') return;
        this.tasks.set(taskId, { ...e, status: 'cancelled' });
        this.lastProgressUpdate.delete(taskId);
        this.notify();
        this.stopTweenIfIdle();
        // S2.9: cancelled tasks are explicitly user-rejected — don't
        // resurrect them on next launch.
        this.removePersisted(taskId);
        // Auto-remove like complete().
        setTimeout(() => {
            const cur = this.tasks.get(taskId);
            if (cur && cur.status === 'cancelled') {
                this.tasks.delete(taskId);
                this.notify();
            }
        }, AUTO_REMOVE_DELAY_MS);
    }

    // ─── cp75.14 fake-tween machinery ───────────────────────────────
    /** Start the shared tween interval if at least one task is running
     *  or queued. Called from `start()` and `update()` (via the
     *  promotion to running). Idempotent — re-entrant call returns
     *  early without creating a second timer. */
    private startTweenIfNeeded(): void {
        if (this.tweenInterval) return;
        if (typeof setInterval !== 'function') return; // SSR / tests
        this.tweenInterval = setInterval(() => {
            const now = Date.now();
            let touched = false;
            for (const [id, entry] of this.tasks) {
                if (entry.status !== 'running' && entry.status !== 'queued') {
                    continue;
                }
                if (entry.progress >= TWEEN_CAP) continue;
                const last = this.lastProgressUpdate.get(id) ?? entry.startedAt;
                if (now - last < TWEEN_INTERVAL_MS) continue;
                // Quietly nudge progress forward. We do NOT overwrite
                // lastProgressUpdate so caller-driven updates win the
                // moment they happen — this just fills the silence.
                const next = Math.min(TWEEN_CAP, entry.progress + TWEEN_STEP);
                if (next > entry.progress) {
                    this.tasks.set(id, { ...entry, progress: next });
                    touched = true;
                }
            }
            if (touched) this.notify();
            this.stopTweenIfIdle();
        }, TWEEN_INTERVAL_MS);
    }

    /** Tear down the tween interval when no task remains in a non-
     *  terminal state. Called from terminal transitions + the tween
     *  loop itself (so it self-stops on the same tick the last task
     *  completes). */
    private stopTweenIfIdle(): void {
        if (!this.tweenInterval) return;
        let anyActive = false;
        for (const t of this.tasks.values()) {
            if (t.status === 'running' || t.status === 'queued') {
                anyActive = true;
                break;
            }
        }
        if (!anyActive) {
            clearInterval(this.tweenInterval);
            this.tweenInterval = null;
        }
    }

    getActive(): TaskTrackerEntry[] {
        return Array.from(this.tasks.values())
            .filter((t) => t.status === 'queued' || t.status === 'running')
            .map((t) => ({ ...t }));
    }

    getById(taskId: string): TaskTrackerEntry | undefined {
        const e = this.tasks.get(taskId);
        return e ? { ...e } : undefined; // defensive copy
    }

    subscribe(cb: (tasks: TaskTrackerEntry[]) => void): () => void {
        this.subscribers.add(cb);
        // Immediate fire — mirrors recordingSessionService pattern so a
        // late subscriber doesn't miss the snapshot it needed.
        try {
            cb(this.snapshot());
        } catch (err) {
            console.error('[taskTracker] initial sub cb failed', err);
        }
        return () => {
            this.subscribers.delete(cb);
        };
    }

    /**
     * TEST-ONLY. Production code MUST NOT call this. Wipes all tasks
     * and notifies subscribers with an empty list. Subscribers Set is
     * intentionally NOT cleared (tests register their own cleanup).
     */
    reset(): void {
        this.tasks.clear();
        this.lastProgressUpdate.clear();
        if (this.tweenInterval) {
            clearInterval(this.tweenInterval);
            this.tweenInterval = null;
        }
        this.nextId = 1;
        // Notify subscribers so any UI bound to the service clears.
        this.subscribers.forEach((cb) => {
            try {
                cb([]);
            } catch (err) {
                console.error('[taskTracker] reset cb failed', err);
            }
        });
    }

    cancelAll(): void {
        // Used by the logout flow (R-1) and forced app close to flip
        // every active task to `cancelled` in one pass. Does NOT delete
        // the entries — auto-remove timers from the per-task cancel()
        // path don't fire here, so cancelled entries linger until the
        // next reset() / GC. That's fine — logout is followed by a
        // navigation that drops the in-memory state anyway.
        let mutated = false;
        for (const [id, e] of this.tasks) {
            if (e.status === 'queued' || e.status === 'running') {
                this.tasks.set(id, { ...e, status: 'cancelled' });
                mutated = true;
            }
        }
        if (mutated) this.notify();
    }

    // ─── Internals ──────────────────────────────────────────────────────

    private snapshot(): TaskTrackerEntry[] {
        return Array.from(this.tasks.values()).map((t) => ({ ...t }));
    }

    private notify(): void {
        const snap = this.snapshot();
        this.subscribers.forEach((cb) => {
            try {
                cb(snap);
            } catch (err) {
                console.error('[taskTracker] sub cb failed', err);
            }
        });
    }

    private gc(): void {
        // Drop oldest terminal entries (done / failed / cancelled)
        // until size <= MAX_ENTRIES. Active tasks are NEVER gc'd —
        // they represent in-flight work that the user expects to see.
        const completed = Array.from(this.tasks.entries())
            .filter(
                ([, e]) => e.status !== 'queued' && e.status !== 'running',
            )
            .sort((a, b) => a[1].startedAt - b[1].startedAt);
        for (const [id] of completed) {
            if (this.tasks.size <= MAX_ENTRIES) break;
            this.tasks.delete(id);
        }
    }

    // ─── TEST-ONLY helpers ─────────────────────────────────────────────

    /**
     * TEST-ONLY: returns a snapshot of all entries (active + terminal).
     * Not part of the public contract — subscribe() is the canonical
     * way to read state. Exposed here for assertion convenience in
     * tests and for any hook bridge that might want a sync read.
     *
     * Note: same defensive-copy semantics as subscribe(), so consumers
     * that wrap this in useService would infinite-loop on render. Use
     * subscribe + useState directly instead (TaskIndicator pattern).
     */
    getState(): TaskTrackerEntry[] {
        return this.snapshot();
    }

    // ─── S2.9 persistence ──────────────────────────────────────────────

    /**
     * Persist a single LLM task to localStorage. Called from `start()`
     * for `summarize` / `index` kinds; no-op otherwise.
     *
     * NOTE: This is the退階 implementation. The proper path goes through
     * the `pending_actions` SQLite table via Tauri commands and survives
     * across user accounts / devices. See PERSIST_KEY_PREFIX comment.
     *
     * Failures (quota exceeded, storage disabled in private browsing,
     * etc.) are swallowed with a warn — task tracking is non-critical
     * and we'd rather drop persistence than crash the start() call site.
     */
    private persistTask(taskId: string): void {
        const t = this.tasks.get(taskId);
        if (!t) return;
        if (t.kind !== 'summarize' && t.kind !== 'index') return;
        const row: PersistedTaskRow = {
            id: t.id,
            kind: t.kind,
            label: t.label,
            lectureId: t.lectureId,
            startedAt: t.startedAt,
        };
        const key = `${PERSIST_KEY_PREFIX}${t.id}`;
        try {
            localStorage.setItem(key, JSON.stringify(row));
            this.persistedKeys.add(key);
        } catch (err) {
            console.warn('[taskTracker] persistTask failed:', err);
        }
    }

    /**
     * Drop a task's persisted row. Called from complete / fail / cancel.
     * Always safe to call — missing rows are a no-op and storage errors
     * are swallowed.
     */
    private removePersisted(taskId: string): void {
        const key = `${PERSIST_KEY_PREFIX}${taskId}`;
        try {
            localStorage.removeItem(key);
        } catch {
            // Best-effort; nothing to do if storage is unavailable.
        }
        this.persistedKeys.delete(key);
    }

    /**
     * Hydrate the in-memory task Map from persisted rows. Called once
     * by App.tsx ~2s after the app reaches `ready` (gives other boot
     * effects a moment to run first).
     *
     * Restored tasks land in `status: 'queued'` — actual re-execution
     * is the caller's job (the post-recording pipeline / RAG indexer
     * picks them up by kind + lectureId on its next run). For now, the
     * surface here is "the Task indicator shows the work didn't get
     * lost", which is what the toast advertises.
     *
     * Async because the toast import is lazy (avoids a top-level cycle
     * with toastService).
     */
    async restoreFromPersistence(): Promise<void> {
        try {
            const keys = new Set<string>();
            // Source 1: Web Storage API enumeration (production / jsdom).
            // Wrapped in a defensive guard because the minimal localStorage
            // mock in test/setup.ts doesn't implement length / key().
            try {
                const len = (localStorage as Storage).length;
                if (typeof len === 'number') {
                    for (let i = 0; i < len; i++) {
                        const k = (localStorage as Storage).key(i);
                        if (k && k.startsWith(PERSIST_KEY_PREFIX)) {
                            keys.add(k);
                        }
                    }
                }
            } catch (err) {
                console.warn(
                    '[taskTracker] storage enumeration failed',
                    err,
                );
            }
            // Source 2: in-memory mirror — needed for tests that seed via
            // localStorage.setItem directly (no Web Storage iteration
            // available on the mock). In production this is a strict
            // subset of Source 1 and adds nothing.
            for (const k of this.persistedKeys) keys.add(k);
            let restored = 0;
            for (const k of keys) {
                try {
                    const raw = localStorage.getItem(k);
                    if (!raw) continue;
                    const data = JSON.parse(raw) as PersistedTaskRow;
                    if (
                        !data ||
                        typeof data.id !== 'string' ||
                        (data.kind !== 'summarize' && data.kind !== 'index')
                    ) {
                        continue;
                    }
                    this.tasks.set(data.id, {
                        id: data.id,
                        kind: data.kind,
                        label: data.label || `恢復 ${data.kind} 任務`,
                        lectureId: data.lectureId,
                        progress: 0,
                        status: 'queued',
                        startedAt:
                            typeof data.startedAt === 'number'
                                ? data.startedAt
                                : Date.now(),
                    });
                    restored++;
                } catch (err) {
                    console.warn(
                        '[taskTracker] restore parse failed for',
                        k,
                        err,
                    );
                }
            }
            if (restored > 0) {
                this.notify();
                try {
                    const { toastService } = await import('./toastService');
                    toastService.info(
                        `${restored} 個任務恢復執行`,
                        '從上次未完成的工作繼續',
                    );
                } catch (err) {
                    console.warn('[taskTracker] restore toast failed:', err);
                }
            }
        } catch (err) {
            console.warn('[taskTracker] restoreFromPersistence failed:', err);
        }
    }
}

export const taskTrackerService: TaskTrackerService & TaskTrackerServiceImpl =
    new TaskTrackerServiceImpl();
