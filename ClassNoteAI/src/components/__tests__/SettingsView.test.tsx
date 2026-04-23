/**
 * SettingsView smoke + sync-removal regression tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §SettingsView):
 *   - mounts cleanly (audio-device subscription, settings load)
 *   - default tab is "local-transcription"
 *   - tabs are clickable + switch the rendered content
 *   - REGRESSION GUARD: handleSave does NOT include any `sync` field
 *     in the saved AppSettings payload (cloud-sync removal)
 *
 * Heavy mocking — every settings sub-tab component is stubbed so we
 * can assert structural behaviour without dragging in their per-tab
 * service calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/storageService', () => ({
    storageService: {
        getAppSettings: vi.fn(),
        saveAppSettings: vi.fn(() => Promise.resolve()),
    },
}));

const subscribers: Array<(snap: unknown) => void> = [];
vi.mock('../../services/audioDeviceService', () => ({
    audioDeviceService: {
        initialize: vi.fn(() => Promise.resolve()),
        subscribe: (cb: (snap: unknown) => void) => {
            subscribers.push(cb);
            return () => {
                const i = subscribers.indexOf(cb);
                if (i >= 0) subscribers.splice(i, 1);
            };
        },
        getAudioInputDevices: vi.fn(() => Promise.resolve([])),
        requestMicrophonePermission: vi.fn(() => Promise.resolve()),
        setPreferredDevice: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('../../services/toastService', () => ({
    toastService: {
        error: vi.fn(),
        warning: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('@tauri-apps/api/app', () => ({
    getVersion: vi.fn(() => Promise.resolve('0.6.0-alpha.10')),
}));

// Stub every sub-tab so we don't drag in their service deps.
vi.mock('../settings/SettingsLocalTranscription', () => ({
    default: () => <div data-testid="tab-local-transcription">local</div>,
}));
vi.mock('../settings/SettingsTranslation', () => ({
    default: () => <div data-testid="tab-translation">translation</div>,
}));
vi.mock('../settings/SettingsCloudAI', () => ({
    default: () => <div data-testid="tab-cloud-ai">cloud-ai</div>,
}));
vi.mock('../settings/SettingsInterface', () => ({
    default: () => <div data-testid="tab-interface">interface</div>,
}));
vi.mock('../settings/SettingsAudioSubtitles', () => ({
    default: () => <div data-testid="tab-audio-subtitles">audio-subtitles</div>,
}));
vi.mock('../settings/SettingsDataManagement', () => ({
    default: () => <div data-testid="tab-data-management">data-management</div>,
}));
vi.mock('../settings/SettingsAboutUpdates', () => ({
    default: () => <div data-testid="tab-about-updates">about-updates</div>,
}));

import SettingsView from '../SettingsView';
import { storageService } from '../../services/storageService';
import type { AppSettings } from '../../types';

const mockedStorage = vi.mocked(storageService);

const baseAppSettings: AppSettings = {
    server: { url: 'http://localhost', port: 8080, enabled: false },
    audio: { sample_rate: 16000, chunk_duration: 2 },
    subtitle: {
        font_size: 18,
        font_color: '#FFFFFF',
        background_opacity: 0.8,
        position: 'bottom',
        display_mode: 'both',
    },
    theme: 'light',
};

beforeEach(() => {
    subscribers.length = 0;
    mockedStorage.getAppSettings.mockResolvedValue(null);
    mockedStorage.saveAppSettings.mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
});

describe('SettingsView (post-sync removal)', () => {
    it('mounts cleanly + renders the default tab (local-transcription)', async () => {
        render(<SettingsView />);
        // Default tab renders.
        expect(await screen.findByTestId('tab-local-transcription')).toBeInTheDocument();
    });

    it('clicking a different tab switches the rendered subview', async () => {
        const user = userEvent.setup();
        render(<SettingsView />);
        await screen.findByTestId('tab-local-transcription');

        // Find the "翻譯服務" nav button by visible label text.
        await user.click(screen.getByRole('button', { name: /翻譯服務/ }));
        expect(await screen.findByTestId('tab-translation')).toBeInTheDocument();
    });

    it('subscribes to audioDeviceService on mount and unsubscribes on unmount', async () => {
        const { unmount } = render(<SettingsView />);
        // The component subscribes synchronously inside its useEffect; allow
        // a tick for React's effect schedule.
        await new Promise((res) => setTimeout(res, 0));
        expect(subscribers.length).toBe(1);
        unmount();
        expect(subscribers.length).toBe(0);
    });

    // The handleSave path is debounced + auto-fires on settings changes.
    // To exercise it deterministically:
    //   1. Mock getAppSettings → concrete settings, so the load useEffect
    //      calls setSettings (settings ref diverges from DEFAULT_SETTINGS).
    //   2. That first divergence flips `didHydrate.current` to true on the
    //      auto-save effect's next pass (then early-returns).
    //   3. Push a device snapshot — selectedDeviceId changes, the auto-
    //      save effect re-runs past the guard and schedules a 300ms save.
    //   4. Wait past the debounce; assert at least one save fired AND
    //      that no payload carries a `sync` field.
    it('regression: any save payload via SettingsView NEVER carries a sync field', async () => {
        mockedStorage.getAppSettings.mockResolvedValue(baseAppSettings);

        render(<SettingsView />);
        // Wait for initial settings load to land + flush state update.
        await waitFor(() =>
            expect(mockedStorage.getAppSettings).toHaveBeenCalled(),
        );

        // Push a fresh device snapshot so handleSave eventually fires.
        await act(async () => {
            subscribers.forEach((cb) =>
                cb({
                    devices: [
                        {
                            deviceId: 'mic-1',
                            label: 'Built-in mic',
                            kind: 'audioinput',
                        },
                    ],
                    defaultDeviceId: 'mic-1',
                    preferredDeviceId: 'mic-1',
                    hasPermissionDetails: true,
                    permissionState: 'granted',
                    lastRefreshReason: 'initialize',
                }),
            );
        });

        // Wait past the 300ms debounce, then for the save to actually land.
        await waitFor(
            () => expect(mockedStorage.saveAppSettings).toHaveBeenCalled(),
            { timeout: 1000 },
        );

        const calls = mockedStorage.saveAppSettings.mock.calls;
        // Guard against the test silently passing if the save never fires
        // (was the original failure mode of this regression test).
        expect(calls.length).toBeGreaterThan(0);
        for (const [payload] of calls) {
            // payload typed as AppSettings; cast to inspect arbitrary keys.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect((payload as any).sync).toBeUndefined();
        }
    });
});
