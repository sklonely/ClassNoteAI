/**
 * SetupWizard cp75.26 P1-E — Canvas URL save rollback.
 *
 * Bug: `saveCanvasCalendarRssAndContinue` saved the URL via
 * `storageService.saveAppSettings(...)`, then called `checkRequirements()`.
 * If `checkRequirements()` (or anything between save and step transition)
 * threw, the URL stayed persisted while the wizard stayed stuck on the
 * canvas-integration step. The user had no signal that a half-state had
 * landed in DB — they'd just retype and resave, layering the input on top.
 *
 * Fix: snapshot prior settings before save; on failure, write the
 * snapshot back and surface a toast. Path:
 *
 *   getAppSettings() → snapshot → saveAppSettings(next) → checkRequirements()
 *   ↳ throw → saveAppSettings(snapshot) [rollback] + toastService.error(...)
 *
 * This suite stubs `setupService.checkStatus` to throw on the first
 * call so we exercise the rollback branch end-to-end through the
 * wizard's UI flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Capture every saveAppSettings call so we can assert "save → rollback"
// shape. Use vi.hoisted so these are defined before vi.mock factories
// (which are themselves hoisted above all imports).
const { saveAppSettingsMock, getAppSettingsMock, checkStatusMock, toastErrorMock } =
    vi.hoisted(() => ({
        saveAppSettingsMock: vi.fn(() => Promise.resolve()),
        getAppSettingsMock: vi.fn(() =>
            Promise.resolve({
                server: { url: '', port: 0, enabled: false },
                audio: { sample_rate: 48000, chunk_duration: 5 },
                subtitle: {
                    font_size: 16,
                    font_color: '#fff',
                    background_opacity: 0.6,
                    position: 'bottom',
                    display_mode: 'en',
                },
                theme: 'light',
                // No integrations.canvas — the rollback should bring us back
                // to this baseline (NOT to the URL the user was about to type).
            } as any),
        ),
        checkStatusMock: vi.fn(),
        toastErrorMock: vi.fn(),
    }));

vi.mock('../../services/storageService', () => ({
    storageService: {
        getAppSettings: getAppSettingsMock,
        saveAppSettings: saveAppSettingsMock,
    },
}));

vi.mock('../../services/setupService', () => ({
    setupService: {
        checkStatus: checkStatusMock,
        installAll: vi.fn(() => Promise.resolve()),
        markComplete: vi.fn(() => Promise.resolve()),
        onProgress: vi.fn(() => Promise.resolve(() => {})),
        startInstallation: vi.fn(() => Promise.resolve()),
        cancelInstallation: vi.fn(() => Promise.resolve()),
        getAllMissingIds: vi.fn(() => []),
    },
}));

vi.mock('../../services/consentService', () => ({
    consentService: {
        // Must be UN-acknowledged so advanceToRecordingConsent stops on
        // the consent step (instead of skipping straight to
        // checkRequirements). User then ticks the consent and clicks
        // 繼續, which is what setStep('canvas-integration').
        getRecordingConsentState: vi.fn(() =>
            Promise.resolve({
                acknowledged: false,
                acknowledgedAt: undefined,
                version: 1,
            }),
        ),
        acknowledgeRecordingConsent: vi.fn(() => Promise.resolve()),
    },
    CONSENT_REMINDER_VERSION: 1,
}));

vi.mock('../../services/toastService', () => ({
    toastService: {
        error: toastErrorMock,
        warning: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
    },
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.reject(new Error('detect_gpu_backends not stubbed'))),
}));

vi.mock('../AIProviderSettings', () => ({
    default: () => null,
}));

import SetupWizard from '../SetupWizard';

/** Drive the wizard from the welcome screen to the canvas-integration
 *  step. Returns the userEvent instance for further interaction.
 *
 *  Path: welcome → language → ai-provider → (skip) → recording-consent
 *  → check-the-box + 繼續 → canvas-integration.
 */
async function navigateToCanvasStep() {
    const user = userEvent.setup();
    render(<SetupWizard onComplete={vi.fn()} />);

    // Welcome → 開始設置
    await user.click(screen.getByRole('button', { name: /開始設置/ }));
    // Language → 繼續
    await user.click(await screen.findByRole('button', { name: /繼續/ }));
    // AI provider → 跳過此步驟 → recording-consent (since we mocked
    // acknowledged=false, this lands on the consent step, NOT
    // checkRequirements)
    await user.click(
        await screen.findByRole('button', { name: /跳過此步驟/ }),
    );

    // Recording consent: tick the checkbox + click 繼續.
    const consentCheckbox = await screen.findByRole('checkbox');
    await user.click(consentCheckbox);
    await user.click(screen.getByRole('button', { name: /繼續/ }));

    // Wait for canvas-integration heading.
    await screen.findByText(/整合 Canvas/);
    return user;
}

beforeEach(() => {
    // cp75.37 · 5.7 — mockClear() vs mockReset() rationale.
    //
    //   - saveAppSettingsMock / getAppSettingsMock / toastErrorMock are
    //     declared in vi.hoisted() with stable default impls (the
    //     getAppSettingsMock impl returns a baseline AppSettings shape
    //     used by every test). We want to keep those defaults — only
    //     clear the call HISTORY between tests. mockClear() is correct.
    //     Tests that need a different impl explicitly call mockReset()
    //     + mockResolvedValue/mockRejectedValue inside the test body
    //     (see the rollback / failure cases below).
    //
    //   - checkStatusMock is created bare (`vi.fn()`), so it has no
    //     stable default. Every test that touches it sets its own impl
    //     via mockResolvedValue/mockRejectedValue. mockReset() here is
    //     correct: clears history AND impl so a stale impl from the
    //     previous test can't bleed through.
    //
    // Don't blanket-swap these to mockReset — doing so wipes the
    // hoisted default impl on getAppSettingsMock and the entire
    // navigation harness collapses on the language-step save.
    saveAppSettingsMock.mockClear();
    getAppSettingsMock.mockClear();
    checkStatusMock.mockReset();
    toastErrorMock.mockClear();
});

afterEach(() => {
    cleanup();
});

describe('SetupWizard · cp75.26 Canvas URL rollback on checkRequirements failure', () => {
    it('does NOT roll back when the canvas URL save itself throws (nothing was committed)', async () => {
        // Realistic failure: storageService.saveAppSettings rejects (IPC,
        // quota, etc.). Because `didSave` is set AFTER the await
        // resolves, the catch block sees didSave=false and skips the
        // rollback write — there's nothing to roll back since the save
        // never landed. The toast still fires + the wizard stays put.
        const user = await navigateToCanvasStep();

        // Reset the mock counters AFTER navigation: the language step's
        // 繼續 button calls saveAppSettings to persist the language
        // pair, which we don't want polluting our canvas assertions.
        saveAppSettingsMock.mockReset();
        getAppSettingsMock.mockClear();
        toastErrorMock.mockClear();
        // Now arm: the canvas URL save rejects; subsequent calls
        // (none expected in this flow) would also reject deterministically.
        saveAppSettingsMock.mockRejectedValue(
            new Error('IPC storage save failed'),
        );

        const input = screen.getByPlaceholderText(/canvas\.example\.edu/);
        await user.type(input, 'https://canvas.test/feeds/calendars/u_1.ics');

        await user.click(
            screen.getByRole('button', { name: /儲存並繼續|繼續/ }),
        );

        // Toast fires — user needs to know something went wrong.
        await waitFor(() => {
            expect(toastErrorMock).toHaveBeenCalled();
        });

        // Exactly ONE save: the failed URL write. No rollback because
        // didSave never flipped to true.
        expect(saveAppSettingsMock).toHaveBeenCalledTimes(1);

        // Wizard stays on canvas-integration step.
        expect(screen.getByText(/整合 Canvas/)).toBeInTheDocument();
    });

    it('rolls back the Canvas URL when an error throws AFTER a successful save', async () => {
        // The P1-E scenario: save commits, then something downstream
        // throws BEFORE the wizard advances out. In production
        // `checkRequirements` catches its own errors so the natural
        // failure point is the post-save window. Simulate that here
        // by making `window.dispatchEvent` throw — it fires immediately
        // after saveAppSettings resolves and before checkRequirements
        // runs, which lands us in the catch branch.

        const user = await navigateToCanvasStep();

        // Reset counters after navigation (see above).
        saveAppSettingsMock.mockReset();
        getAppSettingsMock.mockClear();
        toastErrorMock.mockClear();
        // Both the URL save AND the rollback save resolve.
        saveAppSettingsMock.mockResolvedValue(undefined);

        const dispatchSpy = vi
            .spyOn(window, 'dispatchEvent')
            .mockImplementation((evt: Event) => {
                // Only throw on the wizard's own settings-changed
                // notification, not on every event (else React DOM
                // event delegation breaks). Matches by event type.
                if (
                    evt instanceof CustomEvent &&
                    evt.type === 'classnote-settings-changed'
                ) {
                    throw new Error('CustomEvent dispatch failed (simulated)');
                }
                return true;
            });

        try {
            const input = screen.getByPlaceholderText(/canvas\.example\.edu/);
            await user.type(input, 'https://canvas.test/feeds/calendars/u_2.ics');

            await user.click(
                screen.getByRole('button', { name: /儲存並繼續|繼續/ }),
            );

            // Two saves: 1st = the URL write, 2nd = the rollback.
            await waitFor(() => {
                expect(saveAppSettingsMock).toHaveBeenCalledTimes(2);
            });

            // Rollback call passes settings WITHOUT the new URL we typed —
            // it's the snapshot from getAppSettings (no integrations.canvas).
            // Cast through `unknown` because saveAppSettingsMock is typed
            // as `() => Promise<void>` (no positional args) at the vi.fn
            // declaration site — we know calls[1] exists thanks to the
            // toHaveBeenCalledTimes(2) assertion above.
            const rollbackCall = (saveAppSettingsMock.mock.calls as unknown as unknown[][])[1];
            const rollbackArg = rollbackCall[0] as {
                integrations?: { canvas?: { calendar_rss?: string } };
            };
            expect(rollbackArg?.integrations?.canvas?.calendar_rss).toBeUndefined();

            // Toast fired.
            await waitFor(() => {
                expect(toastErrorMock).toHaveBeenCalled();
            });

            // Stuck on canvas-integration step.
            expect(screen.getByText(/整合 Canvas/)).toBeInTheDocument();
        } finally {
            dispatchSpy.mockRestore();
        }
    });

    it('does NOT roll back on the happy path (save → checkRequirements → advance)', async () => {
        // Happy path: save resolves, checkStatus resolves, wizard
        // advances out of canvas-integration. We expect EXACTLY ONE
        // save (the URL write); no rollback, no toast.
        checkStatusMock.mockResolvedValue({
            is_complete: false,
            missing_components: [],
            installed_components: [],
            requirements: [],
        });

        const user = await navigateToCanvasStep();

        // Reset counters after navigation.
        saveAppSettingsMock.mockReset();
        getAppSettingsMock.mockClear();
        toastErrorMock.mockClear();
        saveAppSettingsMock.mockResolvedValue(undefined);

        const input = screen.getByPlaceholderText(/canvas\.example\.edu/);
        await user.type(input, 'https://canvas.test/feeds/calendars/u_3.ics');

        await user.click(
            screen.getByRole('button', { name: /儲存並繼續|繼續/ }),
        );

        // Wizard transitions through 'checking' → 'gpu-check' so the
        // canvas integration heading goes away.
        await waitFor(() => {
            expect(screen.queryByText(/整合 Canvas/)).not.toBeInTheDocument();
        });

        // Exactly one save (the URL write). No rollback fired.
        expect(saveAppSettingsMock).toHaveBeenCalledTimes(1);
        expect(toastErrorMock).not.toHaveBeenCalled();
    });
});
