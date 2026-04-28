/**
 * taskTrackerService — Phase 7 Sprint 2 task S2.1 singleton.
 *
 * Owns the unified background-task registry. Long-running jobs
 * (post-recording summarisation, vector indexing, exports) register
 * themselves here so the H18 "Tasks" tray can render real progress
 * and so logout / app-close flows can cancel them deterministically.
 *
 * Sprint 2 surface (this commit ships):
 *   - start / update / complete / fail / cancel
 *   - getActive / getById
 *   - subscribe (immediate fire pattern, mirrors recordingSessionService)
 *   - reset (TEST-ONLY)
 *   - cancelAll (logout R-1 path)
 *
 * Out of scope (future Sprint 2 / W18 rounds):
 *   - pending_actions persistence (S2.9)
 *   - sticky toast on completion (W18)
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

class TaskTrackerServiceImpl implements TaskTrackerService {
    private tasks = new Map<string, TaskTrackerEntry>();
    private subscribers = new Set<(tasks: TaskTrackerEntry[]) => void>();
    /** Monotonic counter for id generation. Combined with Date.now()
     *  to produce unique ids even if two start() calls land in the
     *  same millisecond. */
    private nextId = 1;

    // ─── Public API ─────────────────────────────────────────────────────

    start(input: TaskStartInput): string {
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
        // GC if exceeding cap (kick out oldest done/failed/cancelled).
        if (this.tasks.size > MAX_ENTRIES) {
            this.gc();
        }
        this.notify();
        return id;
    }

    update(taskId: string, patch: Partial<TaskTrackerEntry>): void {
        const e = this.tasks.get(taskId);
        if (!e) return; // ignore unknown id (race-safe per contract)
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
        this.notify();
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
        this.notify();
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
        this.notify();
        // Auto-remove like complete().
        setTimeout(() => {
            const cur = this.tasks.get(taskId);
            if (cur && cur.status === 'cancelled') {
                this.tasks.delete(taskId);
                this.notify();
            }
        }, AUTO_REMOVE_DELAY_MS);
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
}

export const taskTrackerService: TaskTrackerService & TaskTrackerServiceImpl =
    new TaskTrackerServiceImpl();
