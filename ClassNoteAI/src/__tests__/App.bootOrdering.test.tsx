/**
 * App boot ordering — cp75.27 P1-F.
 *
 * Pre-cp75.27 the orphan-recovery scan and the 30-day hard-delete
 * sweep ran on independent setTimeouts (1.5s vs 5s after appState=ready).
 * A lecture flagged for crash recovery at 1.5s could ALSO be 30+ days
 * into its `is_deleted = 1` window and get physically purged at 5s,
 * leaving the recovery modal pointing at a row that no longer exists.
 *
 * The fix chains the two phases through `runBootRecoveryThenSweep`
 * (DI'd async function, exported from App.tsx). Tests pass mocks for
 * the scan + hard-delete + sleep injections so we can assert the call
 * order without spinning the full App tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// pdfjs-dist is loaded transitively via App.tsx → ragService →
// pdfToImageService and references browser-only globals (DOMMatrix) at
// module-load time. Stub it before App's module factory runs.
vi.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn(() => ({
        promise: Promise.reject(new Error('not used in App.bootOrdering tests')),
    })),
}));

import { runBootRecoveryThenSweep, type BootRecoverySweepDeps } from '../App';

// ─── Helpers ────────────────────────────────────────────────────────────

interface Recorder {
    /** Wall-clock-ish ordering: each push gets a monotonically increasing
     *  index so tests can assert "scan ended before hardDelete fired". */
    log: Array<{ event: string; t: number }>;
}

function record(rec: Recorder, event: string): void {
    rec.log.push({ event, t: rec.log.length });
}

interface SetupOpts {
    rec: Recorder;
    /** Throw inside the scan to exercise the "scan errored, sweep still
     *  fires" path. */
    scanError?: unknown;
    /** Slow the scan down so we can prove the sweep waits for it. */
    scanDelayMs?: number;
    hardDeleteResult?: string[];
    /** Set to true to make `isCancelled()` flip after the scan finishes,
     *  so we can prove the sweep is skipped on early teardown. */
    cancelAfterScan?: boolean;
}

interface Setup {
    deps: BootRecoverySweepDeps;
    spies: {
        runRecoveryScan: ReturnType<typeof vi.fn>;
        hardDelete: ReturnType<typeof vi.fn>;
        toastInfo: ReturnType<typeof vi.fn>;
        sleep: ReturnType<typeof vi.fn>;
    };
}

function makeDeps(opts: SetupOpts): Setup {
    let cancelled = false;

    const runRecoveryScan = vi.fn(async () => {
        record(opts.rec, 'scan:start');
        if (opts.scanDelayMs && opts.scanDelayMs > 0) {
            await new Promise((r) => setTimeout(r, opts.scanDelayMs));
        }
        if (opts.scanError) {
            record(opts.rec, 'scan:error');
            if (opts.cancelAfterScan) cancelled = true;
            throw opts.scanError;
        }
        record(opts.rec, 'scan:end');
        if (opts.cancelAfterScan) cancelled = true;
    });

    const hardDelete = vi.fn(async (_days: number, _userId: string) => {
        record(opts.rec, 'hardDelete:call');
        return opts.hardDeleteResult ?? [];
    });

    const toastInfo = vi.fn();
    // Tests skip the real grace-period wait: sleep just yields a microtask.
    const sleep = vi.fn(async (_ms: number) => undefined);

    return {
        deps: {
            runRecoveryScan,
            hardDelete,
            getUserId: () => 'test-user',
            toast: { info: toastInfo },
            sleep,
            isCancelled: () => cancelled,
            sweepGraceMs: 100,
        },
        spies: {
            runRecoveryScan,
            hardDelete,
            toastInfo,
            sleep,
        },
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('runBootRecoveryThenSweep — cp75.27 P1-F', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('hardDelete only runs AFTER the recovery scan completes', async () => {
        const rec: Recorder = { log: [] };
        const { deps, spies } = makeDeps({ rec });

        await runBootRecoveryThenSweep(deps);

        expect(spies.runRecoveryScan).toHaveBeenCalledTimes(1);
        expect(spies.hardDelete).toHaveBeenCalledTimes(1);
        expect(spies.sleep).toHaveBeenCalledTimes(1);

        // The scan-end event must come strictly before the hardDelete
        // call. This is the regression guard for the 1.5s/5s race.
        const scanEnd = rec.log.findIndex((e) => e.event === 'scan:end');
        const hd = rec.log.findIndex((e) => e.event === 'hardDelete:call');
        expect(scanEnd).toBeGreaterThanOrEqual(0);
        expect(hd).toBeGreaterThanOrEqual(0);
        expect(hd).toBeGreaterThan(scanEnd);
    });

    it('hardDelete waits even if the recovery scan is slow', async () => {
        const rec: Recorder = { log: [] };
        // Scan delays 30ms — far longer than the (no-op) sleep.
        const { deps, spies } = makeDeps({ rec, scanDelayMs: 30 });

        await runBootRecoveryThenSweep(deps);

        expect(spies.hardDelete).toHaveBeenCalledTimes(1);

        const scanEnd = rec.log.findIndex((e) => e.event === 'scan:end');
        const hd = rec.log.findIndex((e) => e.event === 'hardDelete:call');
        // Scan must still come first regardless of duration.
        expect(hd).toBeGreaterThan(scanEnd);
    });

    it('hardDelete still fires when the recovery scan throws', async () => {
        // Trash GC must not be hostage to a transient scan IPC failure —
        // otherwise users with a buggy recovery codepath would never
        // see their 30-day-old trash get cleaned up.
        const rec: Recorder = { log: [] };
        const { deps, spies } = makeDeps({
            rec,
            scanError: new Error('list_orphaned_recording_lectures failed'),
        });

        await runBootRecoveryThenSweep(deps);

        expect(spies.runRecoveryScan).toHaveBeenCalledTimes(1);
        expect(spies.hardDelete).toHaveBeenCalledTimes(1);

        const scanError = rec.log.findIndex((e) => e.event === 'scan:error');
        const hd = rec.log.findIndex((e) => e.event === 'hardDelete:call');
        expect(hd).toBeGreaterThan(scanError);
    });

    it('toast.info fires when hardDelete returns purged ids', async () => {
        const rec: Recorder = { log: [] };
        const { deps, spies } = makeDeps({
            rec,
            hardDeleteResult: ['lec-old-1', 'lec-old-2'],
        });

        await runBootRecoveryThenSweep(deps);

        expect(spies.toastInfo).toHaveBeenCalledTimes(1);
        expect(spies.toastInfo.mock.calls[0][0]).toMatch(/已永久清除/);
        expect(spies.toastInfo.mock.calls[0][1]).toContain('2');
    });

    it('toast stays silent when nothing was old enough to purge', async () => {
        const rec: Recorder = { log: [] };
        const { deps, spies } = makeDeps({ rec, hardDeleteResult: [] });

        await runBootRecoveryThenSweep(deps);

        expect(spies.hardDelete).toHaveBeenCalledTimes(1);
        expect(spies.toastInfo).not.toHaveBeenCalled();
    });

    it('hardDelete is skipped if the caller cancels (unmount) between phases', async () => {
        // Simulates: appState flips off `ready` (e.g. forced logout)
        // while the scan was running. We must NOT fire the sweep — the
        // user_id in `getUserId()` may have just changed.
        const rec: Recorder = { log: [] };
        const { deps, spies } = makeDeps({ rec, cancelAfterScan: true });

        await runBootRecoveryThenSweep(deps);

        expect(spies.runRecoveryScan).toHaveBeenCalledTimes(1);
        expect(spies.hardDelete).not.toHaveBeenCalled();
    });
});
