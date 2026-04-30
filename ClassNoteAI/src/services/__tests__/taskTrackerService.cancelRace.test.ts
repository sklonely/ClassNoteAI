/**
 * taskTrackerService — cp75.25 P1-A cancel-race protection tests.
 *
 * The dedup logic in `start()` cancels sibling tasks (kind+lectureId), but
 * the underlying `summarizeStream` generator that's mid-yield doesn't see
 * the cancel. Its next `taskTrackerService.update(oldTaskId, ...)` call
 * would otherwise hit a task that's been flipped to 'cancelled' and
 * visually re-activate it.
 *
 * Fix: `update()` is a no-op on already-terminal tasks (cancelled / failed
 * / done). Active tasks (queued / running) accept patches as before — that
 * regression guard is in this same file.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { taskTrackerService } from '../taskTrackerService';

describe('taskTrackerService — cp75.25 cancel race protection', () => {
    beforeEach(() => taskTrackerService.reset());

    it('update() on a cancelled task is a no-op', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'x',
            lectureId: 'L1',
        });
        taskTrackerService.cancel(id);
        expect(taskTrackerService.getById(id)?.status).toBe('cancelled');

        taskTrackerService.update(id, { progress: 0.8, status: 'running' });

        // Status must NOT flip back to 'running'
        expect(taskTrackerService.getById(id)?.status).toBe('cancelled');
        expect(taskTrackerService.getById(id)?.progress).not.toBe(0.8);
    });

    it('update() on a failed task is a no-op', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'x',
            lectureId: 'L1',
        });
        taskTrackerService.fail(id, 'boom');
        expect(taskTrackerService.getById(id)?.status).toBe('failed');

        taskTrackerService.update(id, { progress: 0.5, status: 'running' });

        expect(taskTrackerService.getById(id)?.status).toBe('failed');
        expect(taskTrackerService.getById(id)?.progress).not.toBe(0.5);
        expect(taskTrackerService.getById(id)?.error).toBe('boom');
    });

    it('update() on a done task is a no-op', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'x',
            lectureId: 'L1',
        });
        taskTrackerService.complete(id);
        expect(taskTrackerService.getById(id)?.status).toBe('done');
        const beforeProgress = taskTrackerService.getById(id)?.progress;

        taskTrackerService.update(id, { progress: 0.3, status: 'running' });

        expect(taskTrackerService.getById(id)?.status).toBe('done');
        // complete() sets progress=1; update should not roll it back.
        expect(taskTrackerService.getById(id)?.progress).toBe(beforeProgress);
    });

    it('update() on a running task still works (regression guard)', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'x',
        });
        taskTrackerService.update(id, { progress: 0.5, status: 'running' });
        expect(taskTrackerService.getById(id)?.progress).toBe(0.5);
        expect(taskTrackerService.getById(id)?.status).toBe('running');
    });

    it('update() on a queued task still works (regression guard)', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'x',
        });
        // Default status is 'queued' — verify that's still mutable.
        expect(taskTrackerService.getById(id)?.status).toBe('queued');
        taskTrackerService.update(id, { progress: 0.2 });
        expect(taskTrackerService.getById(id)?.progress).toBe(0.2);
    });

    it('reproduces the dedup race: start() cancels sibling, late update on old id is dropped', () => {
        // Stage 1: original summarize task starts and runs.
        const oldId = taskTrackerService.start({
            kind: 'summarize',
            label: 'lecture A',
            lectureId: 'L1',
        });
        taskTrackerService.update(oldId, { progress: 0.4, status: 'running' });
        expect(taskTrackerService.getById(oldId)?.status).toBe('running');

        // Stage 2: user retries on ReviewPage → start() flips the old
        // sibling to 'cancelled'.
        const newId = taskTrackerService.start({
            kind: 'summarize',
            label: 'lecture A',
            lectureId: 'L1',
        });
        expect(newId).not.toBe(oldId);
        expect(taskTrackerService.getById(oldId)?.status).toBe('cancelled');

        // Stage 3: the still-running summarizeStream generator (which
        // doesn't know about the cancel) emits one more update on the
        // old id. WITHOUT the fix, this would visually re-activate the
        // cancelled row.
        taskTrackerService.update(oldId, {
            progress: 0.7,
            status: 'running',
        });

        expect(taskTrackerService.getById(oldId)?.status).toBe('cancelled');
        expect(taskTrackerService.getById(oldId)?.progress).not.toBe(0.7);
        // The new task is unaffected.
        expect(taskTrackerService.getById(newId)?.status).toBe('queued');
    });
});
