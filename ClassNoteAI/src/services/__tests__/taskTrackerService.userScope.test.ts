/**
 * taskTrackerService user-scope tests · cp75.34 P1.
 *
 * Pre-cp75.34 the tracker persisted to a single global localStorage
 * key prefix (`classnote-task-tracker:<id>`). On a shared machine that
 * meant User A's pending summarize / index tasks survived logout into
 * User B's task tray on next login. cp75.3 introduced the
 * `<userId>::<key>` composite-key pattern; cp75.26 retrofit usageTracker
 * to it; this test covers the same retrofit on taskTrackerService.
 *
 * Coverage:
 *   - new persistTask writes go to the user-scoped key, NOT the legacy
 *     unscoped one
 *   - simulating a user switch hides the previous user's persisted
 *     tasks from `restoreFromPersistence`
 *   - `restoreFromPersistence` only enumerates the current user's
 *     prefix (legacy unscoped rows are intentionally orphaned — there's
 *     no way to know which user owned them)
 *
 * vi.resetModules between tests so the taskTrackerService singleton
 * picks up the fresh authService mock for each scenario.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userIdSegmentMock = vi.fn(() => 'sk');

// Mock authService BEFORE importing taskTrackerService — the import
// of authService inside taskTrackerService.ts would otherwise pull the
// real module (which itself imports offlineQueueService, etc.).
vi.mock('../authService', () => ({
    authService: {
        get getUserIdSegment() {
            return userIdSegmentMock;
        },
        getUser: vi.fn(() => ({ username: 'sk', isVerified: true })),
        // taskTrackerService doesn't reach for these but the import
        // surface needs to remain non-throwing for any transitive caller.
        subscribe: vi.fn(() => () => {}),
    },
}));

// The minimal localStorage mock in test/setup.ts only implements
// getItem / setItem / removeItem / clear. taskTrackerService's
// `restoreFromPersistence` enumerates via length / key(i) on a real
// browser — install the shim here so the test exercises the
// production iteration path. Mirrors the persistence.test setup.
const seededKeys: string[] = [];
const realGetItem = localStorage.getItem.bind(localStorage);
const realSetItem = localStorage.setItem.bind(localStorage);
const realRemoveItem = localStorage.removeItem.bind(localStorage);

beforeEach(() => {
    localStorage.clear();
    seededKeys.length = 0;
    Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        value: (k: string, v: string) => {
            if (!seededKeys.includes(k)) seededKeys.push(k);
            return realSetItem(k, v);
        },
    });
    Object.defineProperty(localStorage, 'removeItem', {
        configurable: true,
        value: (k: string) => {
            const idx = seededKeys.indexOf(k);
            if (idx >= 0) seededKeys.splice(idx, 1);
            return realRemoveItem(k);
        },
    });
    Object.defineProperty(localStorage, 'getItem', {
        configurable: true,
        value: (k: string) => realGetItem(k),
    });
    Object.defineProperty(localStorage, 'length', {
        configurable: true,
        get: () => seededKeys.length,
    });
    Object.defineProperty(localStorage, 'key', {
        configurable: true,
        value: (i: number) => seededKeys[i] ?? null,
    });

    userIdSegmentMock = vi.fn(() => 'sk');
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('taskTrackerService — cp75.34 user-scoped persistence', () => {
    it('writes persisted tasks to a user-scoped key (and NOT the legacy unscoped one)', async () => {
        const { taskTrackerService } = await import('../taskTrackerService');
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'Lecture A summary',
            lectureId: 'lec-1',
        });

        // User-scoped key exists.
        expect(
            localStorage.getItem(`sk::classnote-task-tracker:${id}`),
        ).not.toBeNull();
        // Legacy unscoped key MUST NOT exist — it would re-introduce
        // the cross-user leak the cp75.34 retrofit closes.
        expect(localStorage.getItem(`classnote-task-tracker:${id}`)).toBeNull();
    });

    it('switching user hides previous user\'s persisted tasks from restore', async () => {
        // User "sk" persists two summarize/index tasks.
        let mod = await import('../taskTrackerService');
        const id1 = mod.taskTrackerService.start({
            kind: 'summarize',
            label: 'A',
            lectureId: 'lec-1',
        });
        const id2 = mod.taskTrackerService.start({
            kind: 'index',
            label: 'B',
            lectureId: 'lec-2',
        });
        expect(
            localStorage.getItem(`sk::classnote-task-tracker:${id1}`),
        ).not.toBeNull();
        expect(
            localStorage.getItem(`sk::classnote-task-tracker:${id2}`),
        ).not.toBeNull();

        // Simulate user switch: re-mock segment to 'other' and re-import
        // the module so the singleton drops "sk"'s in-memory state and
        // restoreFromPersistence reads only the new bucket.
        userIdSegmentMock = vi.fn(() => 'other');
        vi.resetModules();
        mod = await import('../taskTrackerService');
        await mod.taskTrackerService.restoreFromPersistence();

        // Other user has no persisted tasks → restore finds nothing.
        expect(mod.taskTrackerService.getById(id1)).toBeUndefined();
        expect(mod.taskTrackerService.getById(id2)).toBeUndefined();
        expect(mod.taskTrackerService.getActive()).toEqual([]);

        // sk's blobs are untouched — the new user just can't see them.
        expect(
            localStorage.getItem(`sk::classnote-task-tracker:${id1}`),
        ).not.toBeNull();
        expect(
            localStorage.getItem(`sk::classnote-task-tracker:${id2}`),
        ).not.toBeNull();
    });

    it('restoreFromPersistence only enumerates the current user\'s prefix', async () => {
        // Seed a row under SK's prefix and a row under "other"'s prefix
        // BEFORE import, simulating a prior-session shared device.
        localStorage.setItem(
            'sk::classnote-task-tracker:keep-1',
            JSON.stringify({
                id: 'keep-1',
                kind: 'summarize',
                label: 'sk task',
                lectureId: 'lec-sk',
                startedAt: 1700000000000,
            }),
        );
        localStorage.setItem(
            'other::classnote-task-tracker:hide-1',
            JSON.stringify({
                id: 'hide-1',
                kind: 'summarize',
                label: 'other task',
                lectureId: 'lec-other',
                startedAt: 1700000000000,
            }),
        );
        // Also seed a legacy unscoped row — must NEVER leak into a
        // user-scoped restore.
        localStorage.setItem(
            'classnote-task-tracker:legacy-1',
            JSON.stringify({
                id: 'legacy-1',
                kind: 'summarize',
                label: 'legacy task',
                lectureId: 'lec-legacy',
                startedAt: 1700000000000,
            }),
        );

        const { taskTrackerService } = await import('../taskTrackerService');
        await taskTrackerService.restoreFromPersistence();

        // SK's task surfaced.
        expect(taskTrackerService.getById('keep-1')).toBeDefined();
        // "other"'s task did NOT.
        expect(taskTrackerService.getById('hide-1')).toBeUndefined();
        // Legacy row did NOT (intentionally orphaned per cp75.34 design).
        expect(taskTrackerService.getById('legacy-1')).toBeUndefined();
    });

    it('falls back to default_user segment when authService returns no user', async () => {
        userIdSegmentMock = vi.fn(() => 'default_user');
        const { taskTrackerService } = await import('../taskTrackerService');
        const id = taskTrackerService.start({
            kind: 'index',
            label: 'no-user index',
            lectureId: 'lec-anon',
        });

        expect(
            localStorage.getItem(`default_user::classnote-task-tracker:${id}`),
        ).not.toBeNull();
        expect(localStorage.getItem(`classnote-task-tracker:${id}`)).toBeNull();
    });
});
