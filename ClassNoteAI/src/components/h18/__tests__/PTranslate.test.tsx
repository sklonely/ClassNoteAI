/**
 * PTranslate · Phase 7 Sprint 3 R1 (S3g) tests.
 *
 * Coverage:
 *   1. mount → invoke get_gemma_status returns model_present=true
 *      → "✓ 已下載" rendered, no download button
 *   2. mount → model_present=false → 「✗ 模型尚未下載」 rendered + 下載 button
 *   3. click 下載 → invoke('download_gemma_model') called
 *   4. while downloading → button disabled + label「下載中…」
 *   5. progress event payload → taskTracker.update called with progress 0-1
 *   6. download success → taskTracker.complete + toast.success + status refresh
 *   7. download fail → taskTracker.fail + toast.error
 *   8. concurrent click 第二次 → no-op (only one invoke)
 *
 * The test mounts only the named-export `PTranslate` component to avoid
 * pulling the rest of ProfilePanes / ProfilePage shell.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import * as core from '@tauri-apps/api/core';
import * as tauriEvent from '@tauri-apps/api/event';

// ─── service mocks (must be set up before component import) ──────────

// useAppSettings — return stable settings so PTranslate doesn't await
// storageService.
vi.mock('../useAppSettings', () => ({
    useAppSettings: () => ({
        settings: {
            translation: {
                provider: 'gemma',
                source_language: 'auto',
                target_language: 'zh-TW',
                gemma_endpoint: 'http://127.0.0.1:8080',
                google_api_key: '',
            },
            subtitle: {
                font_size: 16,
                font_color: '#fff',
                background_opacity: 0.6,
                position: 'bottom',
                display_mode: 'en',
            },
        },
        loading: false,
        update: vi.fn(),
        reload: vi.fn(),
    }),
}));

// taskTrackerService + toastService spies. We use vi.hoisted so the
// factories below (which run before module-level code thanks to
// vi.mock hoisting) can capture the same references that the test
// bodies assert against.
const { mockTaskTracker, mockToast } = vi.hoisted(() => ({
    mockTaskTracker: {
        start: vi.fn(
            (_input: { kind: string; label: string; lectureId?: string }) =>
                'tracker-mock-1',
        ),
        update: vi.fn(
            (_taskId: string, _patch: Record<string, unknown>) => undefined,
        ),
        complete: vi.fn((_taskId: string) => undefined),
        fail: vi.fn((_taskId: string, _err: string) => undefined),
        cancel: vi.fn((_taskId: string) => undefined),
        getActive: vi.fn(() => [] as unknown[]),
        getById: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        reset: vi.fn(),
        cancelAll: vi.fn(),
    },
    mockToast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        show: vi.fn(),
        dismiss: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        clear: vi.fn(),
        pauseAll: vi.fn(),
        resumeAll: vi.fn(),
    },
}));

vi.mock('../../../services/taskTrackerService', () => ({
    taskTrackerService: mockTaskTracker,
}));

vi.mock('../../../services/toastService', () => ({
    toastService: mockToast,
}));

// ─── imports (after mocks) ────────────────────────────────────────────
import { PTranslate } from '../ProfilePanes';

interface GemmaSidecarStatus {
    binary_path: string | null;
    model_path: string;
    model_present: boolean;
    model_size_bytes: number;
    model_url: string;
    sidecar_running: boolean;
}

const STATUS_MISSING: GemmaSidecarStatus = {
    binary_path: null,
    model_path: '/tmp/gemma.gguf',
    model_present: false,
    model_size_bytes: 2_500_000_000,
    model_url: 'https://example.com/gemma.gguf',
    sidecar_running: false,
};

const STATUS_PRESENT: GemmaSidecarStatus = {
    ...STATUS_MISSING,
    model_present: true,
};

/**
 * Configurable invoke mock — each test seeds the responses it needs.
 * Default: get_gemma_status → STATUS_MISSING, download_gemma_model
 * resolves immediately, others → null.
 */
function setupInvoke(opts: {
    status?: GemmaSidecarStatus | (() => GemmaSidecarStatus);
    statusError?: unknown;
    download?: () => Promise<string>;
} = {}) {
    const statusFn = typeof opts.status === 'function'
        ? opts.status
        : () => opts.status ?? STATUS_MISSING;
    const downloadFn = opts.download ?? (async () => '/tmp/gemma.gguf');

    return vi.spyOn(core, 'invoke').mockImplementation(
        async (cmd: string, _args?: unknown) => {
            if (cmd === 'get_gemma_status') {
                if (opts.statusError) throw opts.statusError;
                return statusFn() as unknown as never;
            }
            if (cmd === 'download_gemma_model') {
                return (await downloadFn()) as unknown as never;
            }
            // Sidecar / health / etc. just resolve null so the polling
            // refreshes don't blow up.
            return null as unknown as never;
        },
    );
}

/**
 * Capture the listen callback so tests can fire a synthetic progress
 * event whenever they want.
 */
function setupListen() {
    type ProgressPayload = {
        downloaded: number;
        total: number;
        percent: number;
        speed_mbps: number;
        eta_seconds: number | null;
    };
    let captured: ((e: { payload: ProgressPayload }) => void) | null = null;
    const unlistenSpy = vi.fn();
    const listenSpy = vi.spyOn(tauriEvent, 'listen').mockImplementation(
        async (eventName: string, handler: unknown) => {
            if (eventName === 'gemma-download-progress') {
                captured = handler as (e: { payload: ProgressPayload }) => void;
            }
            return unlistenSpy as unknown as () => void;
        },
    );
    return {
        listenSpy,
        unlistenSpy,
        emit: (payload: ProgressPayload) => {
            captured?.({ payload });
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// Drain the few promise ticks PTranslate's mount effect needs to land
// (dynamic-import + invoke + setState).
async function flush(times = 4) {
    for (let i = 0; i < times; i++) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        await act(async () => {});
    }
}

describe('PTranslate · S3g model download', () => {
    // cp75.10: legacy STATUS_* doesn't carry per-variant info → exercises
    // the legacy single-card fallback path. The card surfaces "下載" /
    // "切換" / "使用中" labels via ModelCard rather than the old
    // 「✓ 已下載 / ✗ 模型尚未下載」 prose row.
    it('1. mount → model_present=true → no 下載 button (loaded card shows 切換)', async () => {
        setupInvoke({ status: STATUS_PRESENT });
        setupListen();

        render(<PTranslate />);
        await flush();

        // The fallback card name should be visible.
        expect(screen.getByText(/translategemma-4b/)).toBeInTheDocument();
        // Loaded + active sidecar → button label is 「使用中」 (legacy
        // fallback treats sidecar_running as active). model_present=true
        // + sidecar_running=false → button is 「切換」. Either way no
        // "下載" download button.
        expect(screen.queryByRole('button', { name: '下載' })).toBeNull();
        expect(screen.queryByRole('button', { name: '下載中…' })).toBeNull();
    });

    it('2. mount → model_present=false → 下載 button rendered', async () => {
        setupInvoke({ status: STATUS_MISSING });
        setupListen();

        render(<PTranslate />);
        await flush();

        const btn = screen.getByRole('button', { name: '下載' });
        expect(btn).toBeInTheDocument();
        expect(btn).not.toBeDisabled();
    });

    it('3. click 下載 → invoke download_gemma_model({variant:"4b"}) + taskTracker.start', async () => {
        const invokeSpy = setupInvoke({
            status: STATUS_MISSING,
            download: async () => '/tmp/gemma.gguf',
        });
        setupListen();

        render(<PTranslate />);
        await flush();

        const btn = screen.getByRole('button', { name: '下載' });
        await act(async () => {
            fireEvent.click(btn);
        });

        // cp75.10: now passes variant param
        expect(invokeSpy).toHaveBeenCalledWith('download_gemma_model', {
            variant: '4b',
        });
        expect(mockTaskTracker.start).toHaveBeenCalledTimes(1);
        const startArg = mockTaskTracker.start.mock.calls[0][0];
        expect(startArg.kind).toBe('export');
        expect(typeof startArg.label).toBe('string');
    });

    it('4. while downloading → button disabled + label 下載中…', async () => {
        // Make download_gemma_model hang so the UI stays in the
        // "downloading" branch until we choose to release it.
        let releaseDownload: ((v: string) => void) | undefined;
        const downloadPromise = new Promise<string>((res) => {
            releaseDownload = res;
        });
        setupInvoke({
            status: STATUS_MISSING,
            download: () => downloadPromise,
        });
        setupListen();

        render(<PTranslate />);
        await flush();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '下載' }));
        });

        const btn = screen.getByRole('button', { name: '下載中…' });
        expect(btn).toBeDisabled();

        // Cleanup: release the hung promise so afterEach doesn't hang.
        await act(async () => {
            releaseDownload?.('/tmp/gemma.gguf');
        });
    });

    it('5. progress event → taskTracker.update called with normalized 0-1 progress', async () => {
        let releaseDownload: ((v: string) => void) | undefined;
        const downloadPromise = new Promise<string>((res) => {
            releaseDownload = res;
        });
        setupInvoke({
            status: STATUS_MISSING,
            download: () => downloadPromise,
        });
        const { emit } = setupListen();

        render(<PTranslate />);
        await flush();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '下載' }));
        });

        // PTranslate calls listen(...) inside handleDownload (lazy);
        // we need to flush the listen await before firing.
        await flush();

        await act(async () => {
            emit({
                downloaded: 500_000_000,
                total: 2_500_000_000,
                percent: 20,
                speed_mbps: 12.3,
                eta_seconds: 30,
            });
        });

        expect(mockTaskTracker.update).toHaveBeenCalled();
        const calls = mockTaskTracker.update.mock.calls;
        const lastCall = calls[calls.length - 1];
        const [taskId, patch] = lastCall;
        expect(taskId).toBe('tracker-mock-1');
        // 20% → 0.2 (clamped to [0,1])
        expect(patch.progress).toBeCloseTo(0.2, 5);
        expect(patch.status).toBe('running');

        await act(async () => {
            releaseDownload?.('/tmp/gemma.gguf');
        });
    });

    it('6. download success → taskTracker.complete + toast.success + 重抓 status', async () => {
        let presentCalls = 0;
        setupInvoke({
            status: () => {
                presentCalls++;
                // First call (mount) returns missing, post-download
                // call returns present.
                return presentCalls === 1 ? STATUS_MISSING : STATUS_PRESENT;
            },
            download: async () => '/tmp/gemma.gguf',
        });
        setupListen();

        render(<PTranslate />);
        await flush();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '下載' }));
        });
        await flush(6);

        expect(mockTaskTracker.complete).toHaveBeenCalledWith('tracker-mock-1');
        expect(mockTaskTracker.fail).not.toHaveBeenCalled();
        expect(mockToast.success).toHaveBeenCalled();

        // Refreshed status: loaded card no longer shows the 下載 button.
        await waitFor(() => {
            expect(
                screen.queryByRole('button', { name: '下載' }),
            ).toBeNull();
        });
    });

    it('7. download fail → taskTracker.fail + toast.error', async () => {
        setupInvoke({
            status: STATUS_MISSING,
            download: async () => {
                throw new Error('network down');
            },
        });
        setupListen();

        render(<PTranslate />);
        await flush();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: '下載' }));
        });
        await flush(6);

        expect(mockTaskTracker.fail).toHaveBeenCalled();
        const failCall = mockTaskTracker.fail.mock.calls[0];
        expect(failCall[0]).toBe('tracker-mock-1');
        expect(String(failCall[1])).toMatch(/network down/);
        expect(mockToast.error).toHaveBeenCalled();
        expect(mockTaskTracker.complete).not.toHaveBeenCalled();
    });

    it('8. concurrent click → 第二次 click no-op (only one invoke + one task start)', async () => {
        let releaseDownload: ((v: string) => void) | undefined;
        const downloadPromise = new Promise<string>((res) => {
            releaseDownload = res;
        });
        const invokeSpy = setupInvoke({
            status: STATUS_MISSING,
            download: () => downloadPromise,
        });
        setupListen();

        render(<PTranslate />);
        await flush();

        const btn = screen.getByRole('button', { name: '下載' });
        await act(async () => {
            fireEvent.click(btn);
        });
        // Now the button label flipped to 下載中… and is disabled.
        const busyBtn = screen.getByRole('button', { name: '下載中…' });
        await act(async () => {
            fireEvent.click(busyBtn);
        });

        const downloadInvocations = invokeSpy.mock.calls.filter(
            (c) => c[0] === 'download_gemma_model',
        );
        expect(downloadInvocations.length).toBe(1);
        expect(mockTaskTracker.start).toHaveBeenCalledTimes(1);

        await act(async () => {
            releaseDownload?.('/tmp/gemma.gguf');
        });
    });
});
