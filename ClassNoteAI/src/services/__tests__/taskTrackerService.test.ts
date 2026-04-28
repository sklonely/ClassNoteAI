/**
 * taskTrackerService — Phase 7 Sprint 2 task S2.1 tests.
 *
 * Covers the full singleton surface:
 *   - start() — id generation, default fields, queued status, subscriber notify
 *   - update() — patch merging, progress clamping, immutable id/startedAt,
 *                unknown-id no-op
 *   - complete() — status=done + progress=1, 5s auto-remove, terminal guards
 *   - fail() — status=failed + error wired, no auto-remove
 *   - cancel() — only acts on queued/running, 5s auto-remove
 *   - getActive() / getById() — filter + defensive copy
 *   - subscribe() — immediate fire, mutation fires, unsubscribe stops fires,
 *                   throwing subscribers don't poison the bus
 *   - reset() — clears tasks but keeps subscribers Set
 *   - cancelAll() — flips active to cancelled, leaves terminal alone
 *   - gc / MAX_ENTRIES — oldest terminal entries dropped, active untouched
 *
 * Reset strategy — explicit `taskTrackerService.reset()` in `beforeEach`
 * (not relying on auto-register from setup.ts, per Sprint 0 §S0.14).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { taskTrackerService } from '../taskTrackerService';
import type {
    TaskStartInput,
    TaskTrackerEntry,
} from '../__contracts__/taskTrackerService.contract';
import { makeTaskTrackerEntry } from '../../test/h18-fixtures';

beforeEach(() => {
    taskTrackerService.reset();
});

afterEach(() => {
    vi.useRealTimers();
});

// ─── start() ────────────────────────────────────────────────────────────

describe('taskTrackerService.start()', () => {
    it('returns a unique non-empty id', () => {
        const id1 = taskTrackerService.start({
            kind: 'summarize',
            label: 'A',
        });
        const id2 = taskTrackerService.start({
            kind: 'summarize',
            label: 'B',
        });
        expect(id1).toBeTruthy();
        expect(id2).toBeTruthy();
        expect(id1).not.toBe(id2);
    });

    it('id is namespaced with "tracker-" prefix for traceability', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        expect(id.startsWith('tracker-')).toBe(true);
    });

    it('creates entry with status=queued and progress=0', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        const e = taskTrackerService.getById(id);
        expect(e).toBeDefined();
        expect(e!.status).toBe('queued');
        expect(e!.progress).toBe(0);
        expect(e!.label).toBe('L');
        expect(e!.kind).toBe('summarize');
    });

    it('persists optional lectureId on the entry', () => {
        const id = taskTrackerService.start({
            kind: 'index',
            label: 'idx',
            lectureId: 'lec-42',
        });
        const e = taskTrackerService.getById(id);
        expect(e!.lectureId).toBe('lec-42');
    });

    it('startedAt is set to a recent epoch ms', () => {
        const before = Date.now();
        const id = taskTrackerService.start({
            kind: 'export',
            label: 'exp',
        });
        const after = Date.now();
        const e = taskTrackerService.getById(id);
        expect(e!.startedAt).toBeGreaterThanOrEqual(before);
        expect(e!.startedAt).toBeLessThanOrEqual(after);
    });

    it('new task appears in getActive()', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        const active = taskTrackerService.getActive();
        expect(active.find((t) => t.id === id)).toBeDefined();
    });

    it('notifies subscribers on start', () => {
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear(); // drop the immediate-fire on subscribe
        taskTrackerService.start({ kind: 'summarize', label: 'L' });
        expect(cb).toHaveBeenCalledTimes(1);
        const arg = cb.mock.calls[0][0] as TaskTrackerEntry[];
        expect(arg.length).toBe(1);
        expect(arg[0].status).toBe('queued');
    });
});

// ─── update() ───────────────────────────────────────────────────────────

describe('taskTrackerService.update()', () => {
    it('patches progress', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, { progress: 0.42 });
        expect(taskTrackerService.getById(id)!.progress).toBe(0.42);
    });

    it('patches label', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'old',
        });
        taskTrackerService.update(id, { label: 'new' });
        expect(taskTrackerService.getById(id)!.label).toBe('new');
    });

    it('patches status (queued → running)', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, { status: 'running' });
        expect(taskTrackerService.getById(id)!.status).toBe('running');
    });

    it('clamps progress < 0 to 0', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, { progress: -5 });
        expect(taskTrackerService.getById(id)!.progress).toBe(0);
    });

    it('clamps progress > 1 to 1', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, { progress: 99 });
        expect(taskTrackerService.getById(id)!.progress).toBe(1);
    });

    it('ignores attempts to change id', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, {
            id: 'hacked',
        } as Partial<TaskTrackerEntry>);
        expect(taskTrackerService.getById(id)).toBeDefined();
        expect(taskTrackerService.getById('hacked')).toBeUndefined();
        expect(taskTrackerService.getById(id)!.id).toBe(id);
    });

    it('ignores attempts to change startedAt', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        const original = taskTrackerService.getById(id)!.startedAt;
        taskTrackerService.update(id, {
            startedAt: 0,
        } as Partial<TaskTrackerEntry>);
        expect(taskTrackerService.getById(id)!.startedAt).toBe(original);
    });

    it('is a no-op for unknown ids (race-safe)', () => {
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        // Should not throw and should not notify subscribers.
        expect(() =>
            taskTrackerService.update('nope', { progress: 0.5 }),
        ).not.toThrow();
        expect(cb).not.toHaveBeenCalled();
    });

    it('notifies subscribers on update', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        taskTrackerService.update(id, { progress: 0.5 });
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

// ─── complete() ─────────────────────────────────────────────────────────

describe('taskTrackerService.complete()', () => {
    it('sets status=done and progress=1', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, { progress: 0.7 });
        taskTrackerService.complete(id);
        const e = taskTrackerService.getById(id);
        expect(e!.status).toBe('done');
        expect(e!.progress).toBe(1);
    });

    it('auto-removes the entry after 5s', () => {
        vi.useFakeTimers();
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.complete(id);
        expect(taskTrackerService.getById(id)).toBeDefined();
        vi.advanceTimersByTime(5_000);
        expect(taskTrackerService.getById(id)).toBeUndefined();
    });

    it('is a no-op when called twice (already done)', () => {
        vi.useFakeTimers();
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.complete(id);
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        taskTrackerService.complete(id);
        // No fresh notification should have been emitted by the second
        // complete (state didn't change).
        expect(cb).not.toHaveBeenCalled();
    });

    it('cannot transition a failed task to done', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.fail(id, 'boom');
        taskTrackerService.complete(id);
        const e = taskTrackerService.getById(id);
        expect(e!.status).toBe('failed');
        expect(e!.error).toBe('boom');
    });

    it('cannot transition a cancelled task to done', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.cancel(id);
        taskTrackerService.complete(id);
        expect(taskTrackerService.getById(id)!.status).toBe('cancelled');
    });

    it('is a no-op for unknown ids', () => {
        expect(() => taskTrackerService.complete('nope')).not.toThrow();
    });
});

// ─── fail() ─────────────────────────────────────────────────────────────

describe('taskTrackerService.fail()', () => {
    it('sets status=failed and writes the error', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.fail(id, 'something exploded');
        const e = taskTrackerService.getById(id);
        expect(e!.status).toBe('failed');
        expect(e!.error).toBe('something exploded');
    });

    it('does NOT auto-remove (retry button stays)', () => {
        vi.useFakeTimers();
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.fail(id, 'err');
        vi.advanceTimersByTime(60_000);
        expect(taskTrackerService.getById(id)).toBeDefined();
        expect(taskTrackerService.getById(id)!.status).toBe('failed');
    });

    it('cannot fail an already-done task', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.complete(id);
        taskTrackerService.fail(id, 'too late');
        expect(taskTrackerService.getById(id)!.status).toBe('done');
    });

    it('cannot fail a cancelled task', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.cancel(id);
        taskTrackerService.fail(id, 'too late');
        expect(taskTrackerService.getById(id)!.status).toBe('cancelled');
    });

    it('is a no-op for unknown ids', () => {
        expect(() => taskTrackerService.fail('nope', 'err')).not.toThrow();
    });
});

// ─── cancel() ───────────────────────────────────────────────────────────

describe('taskTrackerService.cancel()', () => {
    it('cancels a queued task', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.cancel(id);
        expect(taskTrackerService.getById(id)!.status).toBe('cancelled');
    });

    it('cancels a running task', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, { status: 'running' });
        taskTrackerService.cancel(id);
        expect(taskTrackerService.getById(id)!.status).toBe('cancelled');
    });

    it('cannot cancel a done task', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.complete(id);
        taskTrackerService.cancel(id);
        expect(taskTrackerService.getById(id)!.status).toBe('done');
    });

    it('cannot cancel a failed task', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.fail(id, 'err');
        taskTrackerService.cancel(id);
        expect(taskTrackerService.getById(id)!.status).toBe('failed');
    });

    it('auto-removes the entry after 5s', () => {
        vi.useFakeTimers();
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.cancel(id);
        expect(taskTrackerService.getById(id)).toBeDefined();
        vi.advanceTimersByTime(5_000);
        expect(taskTrackerService.getById(id)).toBeUndefined();
    });

    it('is a no-op for unknown ids', () => {
        expect(() => taskTrackerService.cancel('nope')).not.toThrow();
    });
});

// ─── getActive() / getById() ────────────────────────────────────────────

describe('taskTrackerService.getActive() / getById()', () => {
    it('getActive returns only queued + running tasks', () => {
        const a = taskTrackerService.start({ kind: 'summarize', label: 'A' });
        const b = taskTrackerService.start({ kind: 'summarize', label: 'B' });
        const c = taskTrackerService.start({ kind: 'summarize', label: 'C' });
        const d = taskTrackerService.start({ kind: 'summarize', label: 'D' });
        // a stays queued, b → running, c → done, d → failed.
        taskTrackerService.update(b, { status: 'running' });
        taskTrackerService.complete(c);
        taskTrackerService.fail(d, 'err');
        const active = taskTrackerService.getActive();
        const ids = active.map((t) => t.id).sort();
        expect(ids).toEqual([a, b].sort());
    });

    it('getActive returns defensive copies', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        const active = taskTrackerService.getActive();
        active[0].label = 'mutated';
        expect(taskTrackerService.getById(id)!.label).toBe('L');
    });

    it('getById returns a defensive copy', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        const e = taskTrackerService.getById(id)!;
        e.label = 'mutated';
        expect(taskTrackerService.getById(id)!.label).toBe('L');
    });

    it('getById returns undefined for unknown ids', () => {
        expect(taskTrackerService.getById('nope')).toBeUndefined();
    });
});

// ─── subscribe() ────────────────────────────────────────────────────────

describe('taskTrackerService.subscribe()', () => {
    it('fires immediately with the current snapshot on subscribe', () => {
        taskTrackerService.start({ kind: 'summarize', label: 'L' });
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        expect(cb).toHaveBeenCalledTimes(1);
        const arg = cb.mock.calls[0][0] as TaskTrackerEntry[];
        expect(arg.length).toBe(1);
    });

    it('fires on every mutation', () => {
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.update(id, { progress: 0.5 });
        taskTrackerService.complete(id);
        expect(cb).toHaveBeenCalledTimes(3);
    });

    it('returns an unsubscribe function that stops further fires', () => {
        const cb = vi.fn();
        const unsub = taskTrackerService.subscribe(cb);
        cb.mockClear();
        unsub();
        taskTrackerService.start({ kind: 'summarize', label: 'L' });
        expect(cb).not.toHaveBeenCalled();
    });

    it('isolates subscribers — one throwing does not affect others', () => {
        const errSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const bad = vi.fn(() => {
            throw new Error('boom');
        });
        const good = vi.fn();
        const unsubBad = taskTrackerService.subscribe(bad);
        const unsubGood = taskTrackerService.subscribe(good);
        try {
            bad.mockClear();
            good.mockClear();
            taskTrackerService.start({ kind: 'summarize', label: 'L' });
            expect(bad).toHaveBeenCalledTimes(1);
            expect(good).toHaveBeenCalledTimes(1);
        } finally {
            // Critical: unsubscribe before restoring the spy so a stray
            // notify in a later test doesn't leak the boom error to stderr.
            unsubBad();
            unsubGood();
            errSpy.mockRestore();
        }
    });

    it('subscriber receives defensive-copy snapshots (mutation-safe)', () => {
        let captured: TaskTrackerEntry[] | null = null;
        taskTrackerService.subscribe((tasks) => {
            captured = tasks;
        });
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        // Mutate the captured snapshot — store should be unaffected.
        if (captured !== null) {
            const arr = captured as TaskTrackerEntry[];
            arr[0].label = 'mutated';
        }
        expect(taskTrackerService.getById(id)!.label).toBe('L');
    });
});

// ─── reset() ────────────────────────────────────────────────────────────

describe('taskTrackerService.reset() (TEST-ONLY)', () => {
    it('clears every task', () => {
        taskTrackerService.start({ kind: 'summarize', label: 'A' });
        taskTrackerService.start({ kind: 'summarize', label: 'B' });
        taskTrackerService.reset();
        expect(taskTrackerService.getActive()).toEqual([]);
    });

    it('notifies subscribers with an empty list', () => {
        taskTrackerService.start({ kind: 'summarize', label: 'A' });
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        taskTrackerService.reset();
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0][0]).toEqual([]);
    });

    it('does NOT clear the subscribers Set', () => {
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        taskTrackerService.reset();
        cb.mockClear(); // drop the reset fire
        // After reset, the same subscriber should still receive events.
        taskTrackerService.start({ kind: 'summarize', label: 'L' });
        expect(cb).toHaveBeenCalledTimes(1);
    });
});

// ─── cancelAll() ────────────────────────────────────────────────────────

describe('taskTrackerService.cancelAll()', () => {
    it('cancels every queued and running task', () => {
        const a = taskTrackerService.start({ kind: 'summarize', label: 'A' });
        const b = taskTrackerService.start({ kind: 'summarize', label: 'B' });
        taskTrackerService.update(b, { status: 'running' });
        taskTrackerService.cancelAll();
        expect(taskTrackerService.getById(a)!.status).toBe('cancelled');
        expect(taskTrackerService.getById(b)!.status).toBe('cancelled');
    });

    it('leaves done tasks alone', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.complete(id);
        taskTrackerService.cancelAll();
        expect(taskTrackerService.getById(id)!.status).toBe('done');
    });

    it('leaves failed tasks alone', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
        });
        taskTrackerService.fail(id, 'err');
        taskTrackerService.cancelAll();
        expect(taskTrackerService.getById(id)!.status).toBe('failed');
    });

    it('notifies subscribers exactly once per cancelAll call', () => {
        taskTrackerService.start({ kind: 'summarize', label: 'A' });
        taskTrackerService.start({ kind: 'summarize', label: 'B' });
        taskTrackerService.start({ kind: 'summarize', label: 'C' });
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        taskTrackerService.cancelAll();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('is silent (no notify) when there is nothing to cancel', () => {
        const cb = vi.fn();
        taskTrackerService.subscribe(cb);
        cb.mockClear();
        taskTrackerService.cancelAll();
        expect(cb).not.toHaveBeenCalled();
    });
});

// ─── MAX_ENTRIES gc ─────────────────────────────────────────────────────

describe('taskTrackerService MAX_ENTRIES gc', () => {
    it('evicts oldest terminal entries when over the cap', () => {
        // Spawn 100 + complete the first 50, then add one more to push
        // over the cap. The earliest-completed entry should be evicted.
        const ids: string[] = [];
        for (let i = 0; i < 100; i++) {
            ids.push(
                taskTrackerService.start({
                    kind: 'summarize',
                    label: `T${i}`,
                }),
            );
        }
        // Complete the first 50 — these become eligible for gc.
        for (let i = 0; i < 50; i++) {
            taskTrackerService.complete(ids[i]);
        }
        // 101st task — should trigger gc since terminal entries exist.
        const overflow = taskTrackerService.start({
            kind: 'summarize',
            label: 'overflow',
        });
        // The very first completed entry should be the one evicted.
        expect(taskTrackerService.getById(ids[0])).toBeUndefined();
        // The overflow task itself must survive.
        expect(taskTrackerService.getById(overflow)).toBeDefined();
    });

    it('never evicts active (queued / running) tasks', () => {
        // 100 active tasks + 1 more — none should be evicted because
        // there are no terminal entries to drop.
        const ids: string[] = [];
        for (let i = 0; i < 101; i++) {
            ids.push(
                taskTrackerService.start({
                    kind: 'summarize',
                    label: `T${i}`,
                }),
            );
        }
        // All 101 should still be present.
        for (const id of ids) {
            expect(taskTrackerService.getById(id)).toBeDefined();
        }
    });
});

// ─── fixture compatibility ──────────────────────────────────────────────

describe('makeTaskTrackerEntry fixture compatibility', () => {
    it('produces an entry whose shape matches the contract', () => {
        // The fixture lives in test/h18-fixtures.ts and is the canonical
        // test builder. It must produce something assignable to the
        // contract's TaskTrackerEntry type.
        const e: TaskTrackerEntry = makeTaskTrackerEntry();
        expect(e.id).toBeTruthy();
        expect(e.kind).toBe('summarize');
        expect(e.status).toBe('queued');
        expect(e.progress).toBe(0);
    });

    it('start() creates entries shaped like the fixture default', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'Test summarize task',
            lectureId: 'lecture-test-1',
        });
        const e = taskTrackerService.getById(id);
        const fixture = makeTaskTrackerEntry();
        expect(e!.kind).toBe(fixture.kind);
        expect(e!.label).toBe(fixture.label);
        expect(e!.lectureId).toBe(fixture.lectureId);
        expect(e!.progress).toBe(fixture.progress);
        expect(e!.status).toBe(fixture.status);
    });
});

// ─── TaskStartInput type smoke test ─────────────────────────────────────

describe('TaskStartInput accepts all TaskKind values', () => {
    it.each<TaskStartInput>([
        { kind: 'summarize', label: 'sum' },
        { kind: 'index', label: 'idx' },
        { kind: 'export', label: 'exp' },
    ])('accepts kind=%s', (input) => {
        const id = taskTrackerService.start(input);
        expect(taskTrackerService.getById(id)!.kind).toBe(input.kind);
    });
});
