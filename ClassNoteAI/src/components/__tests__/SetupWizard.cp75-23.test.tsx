/**
 * SetupWizard cp75.23 — progress dots include canvas-integration.
 *
 * Finding 6.2: the inline `visualSteps` array used to compute the dot
 * indicator was missing `'canvas-integration'`, so when the wizard
 * actually renders that step the indicator hides it (no dot, mis-aligned
 * "done" colouring on later dots).
 *
 * Fix: extract the array to a top-level export `SETUP_VISUAL_STEPS` so
 * tests can pin the contract, with `'canvas-integration'` slotted between
 * `'recording-consent'` and `'checking'` (matches the runtime flow:
 * `setStep('recording-consent') → setStep('canvas-integration') → checkRequirements()`
 * which calls `setStep('checking')`).
 */

import { describe, it, expect, vi } from 'vitest';

// AIProviderSettings is mounted inside the wizard's ai-config step. It
// has its own service deps (LLMRegistry, keyStore). Stub it so importing
// SetupWizard doesn't require the world.
vi.mock('../AIProviderSettings', () => ({
    default: () => null,
}));

vi.mock('../../services/setupService', () => ({
    setupService: {
        checkStatus: vi.fn(() =>
            Promise.resolve({
                is_complete: false,
                missing_components: [],
                installed_components: [],
            }),
        ),
        installAll: vi.fn(() => Promise.resolve()),
        markComplete: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('../../services/consentService', () => ({
    consentService: {
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

vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn(() => Promise.resolve()),
}));

describe('SetupWizard · cp75.23', () => {
    it('SETUP_VISUAL_STEPS includes canvas-integration', async () => {
        const mod = await import('../SetupWizard');
        expect(mod.SETUP_VISUAL_STEPS).toBeDefined();
        expect(mod.SETUP_VISUAL_STEPS).toContain('canvas-integration');
    });

    it('canvas-integration appears AFTER recording-consent in step order', async () => {
        const mod = await import('../SetupWizard');
        const steps = mod.SETUP_VISUAL_STEPS;
        const iConsent = steps.indexOf('recording-consent');
        const iCanvas = steps.indexOf('canvas-integration');
        expect(iConsent).toBeGreaterThanOrEqual(0);
        expect(iCanvas).toBeGreaterThan(iConsent);
    });

    it('canvas-integration appears BEFORE checking in step order', async () => {
        const mod = await import('../SetupWizard');
        const steps = mod.SETUP_VISUAL_STEPS;
        const iCanvas = steps.indexOf('canvas-integration');
        const iChecking = steps.indexOf('checking');
        expect(iChecking).toBeGreaterThanOrEqual(0);
        expect(iCanvas).toBeLessThan(iChecking);
    });
});
