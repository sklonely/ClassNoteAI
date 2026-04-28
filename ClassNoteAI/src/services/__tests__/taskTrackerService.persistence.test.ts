/**
 * taskTrackerService — Phase 7 Sprint 2 task S2.9 + W18 tests.
 *
 * Coverage:
 *   - persistTask (called from start()): summarize/index kinds write a row
 *     to localStorage; export does NOT persist.
 *   - removePersisted: complete / cancel / fail all clean up the row.
 *   - restoreFromPersistence: reads localStorage on launch, hydrates the
 *     in-memory Map with status='queued', notifies subscribers, fires a
 *     single info toast.
 *   - W18 sticky toast: complete() of a summarize/index task fires a
 *     success toast; complete() of an export task does NOT.
 *
 * localStorage is stubbed in test/setup.ts with `localStorageMock.clear()`
 * in `beforeEach`, so each test starts clean. The tracker singleton is
 * also reset via `taskTrackerService.reset()`.
 *
 * Why a separate file (not append to taskTrackerService.test.ts):
 *   - keeps the original happy-path suite readable
 *   - the persistence path is a meaningfully separate feature surface
 *     (S2.9 / W18) that may grow more cases as the pending_actions
 *     Rust bridge lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { taskTrackerService } from '../taskTrackerService';

const PERSIST_KEY_PREFIX = 'classnote-task-tracker:';

/**
 * The minimal localStorage mock in test/setup.ts only implements
 * getItem / setItem / removeItem / clear. `restoreFromPersistence`
 * also enumerates via `length` + `key(i)` (the real Web Storage API
 * shape) — patch those in here so the tests exercise the production
 * iteration path. We bridge to the mock's already-stubbed getItem by
 * keeping our own ordered key list of seeded entries.
 *
 * The taskTrackerService itself maintains a `persistedKeys` mirror
 * which would also work as a fallback discovery path, but the tests
 * deliberately seed via raw setItem (simulating prior-session storage
 * the in-memory mirror can't possibly know about), so the iteration
 * path needs to function.
 */
const seededKeys: string[] = [];
const realGetItem = localStorage.getItem.bind(localStorage);
const realSetItem = localStorage.setItem.bind(localStorage);
const realRemoveItem = localStorage.removeItem.bind(localStorage);

beforeEach(() => {
    seededKeys.length = 0;
    // Re-wrap setItem / removeItem so seededKeys stays in sync.
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
    // Web Storage API iteration shim — production code uses these.
    Object.defineProperty(localStorage, 'length', {
        configurable: true,
        get: () => seededKeys.length,
    });
    Object.defineProperty(localStorage, 'key', {
        configurable: true,
        value: (i: number) => seededKeys[i] ?? null,
    });
    taskTrackerService.reset();
});

afterEach(() => {
    vi.useRealTimers();
});

// ─── persistTask via start() ────────────────────────────────────────────

describe('taskTrackerService — persistence on start()', () => {
    it('writes a localStorage row for kind=summarize', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'Lecture A summary',
            lectureId: 'lec-1',
        });
        const raw = localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`);
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw!);
        expect(parsed.id).toBe(id);
        expect(parsed.kind).toBe('summarize');
        expect(parsed.label).toBe('Lecture A summary');
        expect(parsed.lectureId).toBe('lec-1');
        expect(typeof parsed.startedAt).toBe('number');
    });

    it('writes a localStorage row for kind=index', () => {
        const id = taskTrackerService.start({
            kind: 'index',
            label: 'idx',
            lectureId: 'lec-2',
        });
        const raw = localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`);
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw!);
        expect(parsed.kind).toBe('index');
    });

    it('does NOT persist kind=export (only LLM tasks are persisted)', () => {
        const id = taskTrackerService.start({
            kind: 'export',
            label: 'export',
        });
        const raw = localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`);
        expect(raw).toBeNull();
    });

    it('survives a localStorage.setItem throw without crashing start()', () => {
        const setSpy = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('quota', 'QuotaExceededError');
            });
        const warnSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        try {
            expect(() =>
                taskTrackerService.start({
                    kind: 'summarize',
                    label: 'L',
                    lectureId: 'lec-x',
                }),
            ).not.toThrow();
        } finally {
            setSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });
});

// ─── removePersisted via complete / cancel / fail ───────────────────────

describe('taskTrackerService — persistence cleanup', () => {
    it('complete() removes the localStorage row', () => {
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
            lectureId: 'lec-1',
        });
        expect(localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`)).toBeTruthy();
        taskTrackerService.complete(id);
        expect(localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`)).toBeNull();
    });

    it('cancel() removes the localStorage row', () => {
        const id = taskTrackerService.start({
            kind: 'index',
            label: 'L',
            lectureId: 'lec-1',
        });
        expect(localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`)).toBeTruthy();
        taskTrackerService.cancel(id);
        expect(localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`)).toBeNull();
    });

    it('fail() removes the localStorage row (next launch will not retry)', () => {
        // Per PHASE-7-PLAN §8.3 v3 audit S2.9 design choice: failed tasks
        // are removed from persistence so app restart does not infinitely
        // retry permanently broken work.
        const id = taskTrackerService.start({
            kind: 'summarize',
            label: 'L',
            lectureId: 'lec-1',
        });
        expect(localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`)).toBeTruthy();
        taskTrackerService.fail(id, 'boom');
        expect(localStorage.getItem(`${PERSIST_KEY_PREFIX}${id}`)).toBeNull();
    });
});

// ─── restoreFromPersistence ─────────────────────────────────────────────

describe('taskTrackerService.restoreFromPersistence()', () => {
    it('hydrates tasks from localStorage and notifies subscribers', async () => {
        // Seed two persisted entries directly (simulating prior session).
        localStorage.setItem(
            `${PERSIST_KEY_PREFIX}restore-1`,
            JSON.stringify({
                id: 'restore-1',
                kind: 'summarize',
                label: '恢復摘要',
                lectureId: 'lec-rest-1',
                startedAt: 1700000000000,
            }),
        );
        localStorage.setItem(
            `${PERSIST_KEY_PREFIX}restore-2`,
            JSON.stringify({
                id: 'restore-2',
                kind: 'index',
                label: '恢復索引',
                lectureId: 'lec-rest-2',
                startedAt: 1700000001000,
            }),
        );

        await taskTrackerService.restoreFromPersistence();

        const a = taskTrackerService.getById('restore-1');
        const b = taskTrackerService.getById('restore-2');
        expect(a).toBeDefined();
        expect(a!.kind).toBe('summarize');
        expect(a!.status).toBe('queued');
        expect(a!.label).toBe('恢復摘要');
        expect(a!.lectureId).toBe('lec-rest-1');
        expect(b).toBeDefined();
        expect(b!.kind).toBe('index');
        expect(b!.status).toBe('queued');
    });

    it('fires a single info toast summarising restored task count', async () => {
        localStorage.setItem(
            `${PERSIST_KEY_PREFIX}r-1`,
            JSON.stringify({
                id: 'r-1',
                kind: 'summarize',
                label: 'A',
                lectureId: 'lec-1',
                startedAt: 1,
            }),
        );
        localStorage.setItem(
            `${PERSIST_KEY_PREFIX}r-2`,
            JSON.stringify({
                id: 'r-2',
                kind: 'index',
                label: 'B',
                lectureId: 'lec-2',
                startedAt: 2,
            }),
        );

        const { toastService } = await import('../toastService');
        const infoSpy = vi.spyOn(toastService, 'info');

        try {
            await taskTrackerService.restoreFromPersistence();
            await vi.waitFor(() => {
                expect(infoSpy).toHaveBeenCalledTimes(1);
            });
            const [msg, detail] = infoSpy.mock.calls[0];
            expect(typeof msg).toBe('string');
            // Message must surface the count.
            expect(msg as string).toMatch(/2/);
            expect(typeof detail).toBe('string');
        } finally {
            infoSpy.mockRestore();
        }
    });

    it('does NOT fire a toast when nothing was persisted', async () => {
        const { toastService } = await import('../toastService');
        const infoSpy = vi.spyOn(toastService, 'info');
        try {
            await taskTrackerService.restoreFromPersistence();
            // Allow any deferred microtasks to settle.
            await Promise.resolve();
            expect(infoSpy).not.toHaveBeenCalled();
        } finally {
            infoSpy.mockRestore();
        }
    });

    it('skips and warns on malformed JSON rows without throwing', async () => {
        localStorage.setItem(`${PERSIST_KEY_PREFIX}bad`, 'not json {{{');
        localStorage.setItem(
            `${PERSIST_KEY_PREFIX}good`,
            JSON.stringify({
                id: 'good',
                kind: 'summarize',
                label: 'G',
                lectureId: 'lec-g',
                startedAt: 1,
            }),
        );
        const warnSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});
        try {
            await expect(
                taskTrackerService.restoreFromPersistence(),
            ).resolves.toBeUndefined();
            expect(taskTrackerService.getById('good')).toBeDefined();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('ignores localStorage keys outside the tracker namespace', async () => {
        localStorage.setItem('some-other-key', 'whatever');
        localStorage.setItem(
            'classnote.inbox.states.v1',
            JSON.stringify({ foo: 'bar' }),
        );
        const initial = taskTrackerService.getActive().length;
        await taskTrackerService.restoreFromPersistence();
        expect(taskTrackerService.getActive().length).toBe(initial);
    });
});

// ─── W18 sticky toast on complete() ─────────────────────────────────────

describe('taskTrackerService — W18 sticky toast on complete()', () => {
    it('fires success toast for kind=summarize', async () => {
        const { toastService } = await import('../toastService');
        const successSpy = vi.spyOn(toastService, 'success');
        try {
            const id = taskTrackerService.start({
                kind: 'summarize',
                label: 'My Lecture',
                lectureId: 'lec-1',
            });
            successSpy.mockClear();
            taskTrackerService.complete(id);
            await vi.waitFor(() => {
                expect(successSpy).toHaveBeenCalledTimes(1);
            });
            const [msg, detail] = successSpy.mock.calls[0];
            expect(typeof msg).toBe('string');
            // Detail should include the lecture label so the user knows
            // which task just finished.
            expect(detail as string).toContain('My Lecture');
        } finally {
            successSpy.mockRestore();
        }
    });

    it('fires success toast for kind=index', async () => {
        const { toastService } = await import('../toastService');
        const successSpy = vi.spyOn(toastService, 'success');
        try {
            const id = taskTrackerService.start({
                kind: 'index',
                label: 'My RAG',
                lectureId: 'lec-2',
            });
            successSpy.mockClear();
            taskTrackerService.complete(id);
            await vi.waitFor(() => {
                expect(successSpy).toHaveBeenCalledTimes(1);
            });
            const [, detail] = successSpy.mock.calls[0];
            expect(detail as string).toContain('My RAG');
        } finally {
            successSpy.mockRestore();
        }
    });

    it('does NOT fire a sticky toast for kind=export (W18 scope = LLM only)', async () => {
        const { toastService } = await import('../toastService');
        const successSpy = vi.spyOn(toastService, 'success');
        try {
            const id = taskTrackerService.start({
                kind: 'export',
                label: 'export.zip',
            });
            successSpy.mockClear();
            taskTrackerService.complete(id);
            // Allow lazy-import microtasks to settle, then assert silence.
            await Promise.resolve();
            await Promise.resolve();
            expect(successSpy).not.toHaveBeenCalled();
        } finally {
            successSpy.mockRestore();
        }
    });

    it('does NOT fire a sticky toast on no-op complete (already terminal)', async () => {
        const { toastService } = await import('../toastService');
        const successSpy = vi.spyOn(toastService, 'success');
        try {
            const id = taskTrackerService.start({
                kind: 'summarize',
                label: 'L',
                lectureId: 'lec-1',
            });
            taskTrackerService.complete(id);
            await vi.waitFor(() => {
                expect(successSpy).toHaveBeenCalledTimes(1);
            });
            successSpy.mockClear();
            // Second complete is a no-op — must not fire another toast.
            taskTrackerService.complete(id);
            await Promise.resolve();
            expect(successSpy).not.toHaveBeenCalled();
        } finally {
            successSpy.mockRestore();
        }
    });
});
