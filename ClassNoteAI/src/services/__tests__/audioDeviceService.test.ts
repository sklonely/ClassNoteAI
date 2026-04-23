import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { audioDeviceService } from '../audioDeviceService';
import { storageService } from '../storageService';

type MockAudioDevice = Pick<
  MediaDeviceInfo,
  'deviceId' | 'groupId' | 'kind' | 'label'
>;

function makeAudioInputDevice(
  deviceId: string,
  label: string,
): MockAudioDevice {
  return {
    deviceId,
    groupId: 'group-1',
    kind: 'audioinput',
    label,
  };
}

describe('audioDeviceService', () => {
  const enumerateDevices = vi.fn<() => Promise<MockAudioDevice[]>>();
  const getUserMedia = vi.fn();
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();

  beforeEach(() => {
    audioDeviceService.destroy();

    vi.spyOn(storageService, 'getAppSettings').mockResolvedValue(null);
    vi.spyOn(storageService, 'saveAppSettings').mockResolvedValue();

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices,
        getUserMedia,
        addEventListener,
        removeEventListener,
      },
    });

    enumerateDevices.mockReset();
    getUserMedia.mockReset();
    addEventListener.mockReset();
    removeEventListener.mockReset();
  });

  afterEach(() => {
    audioDeviceService.destroy();
    vi.restoreAllMocks();
  });

  it('refreshes device list without touching getUserMedia during app init', async () => {
    enumerateDevices.mockResolvedValue([
      makeAudioInputDevice('default', ''),
      makeAudioInputDevice('mic-1', ''),
    ]);

    await audioDeviceService.initialize();

    expect(enumerateDevices).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(audioDeviceService.getPreferredDeviceId()).toBe('default');
    expect(audioDeviceService.hasMicrophonePermissionDetails()).toBe(false);
  });

  it('requests microphone permission explicitly and stops the temporary stream', async () => {
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop }],
    });
    enumerateDevices.mockResolvedValue([
      makeAudioInputDevice('default', 'MacBook Air Microphone'),
      makeAudioInputDevice('mic-1', 'USB Audio Interface'),
    ]);

    await audioDeviceService.requestMicrophonePermission();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(audioDeviceService.hasMicrophonePermissionDetails()).toBe(true);
    expect(audioDeviceService.getPreferredDeviceId()).toBe('default');
  });

  it('self-heals a stale saved device once a detailed device list confirms it is gone', async () => {
    vi.spyOn(storageService, 'getAppSettings').mockResolvedValue({
      server: { url: 'http://localhost', port: 8080, enabled: false },
      audio: { device_id: 'missing-device', sample_rate: 16000, chunk_duration: 2 },
      subtitle: {
        font_size: 18,
        font_color: '#FFFFFF',
        background_opacity: 0.8,
        position: 'bottom',
        display_mode: 'both',
      },
      theme: 'light',
    });
    const saveSpy = vi.spyOn(storageService, 'saveAppSettings').mockResolvedValue();
    enumerateDevices.mockResolvedValue([
      makeAudioInputDevice('default', 'MacBook Air Microphone'),
      makeAudioInputDevice('mic-1', 'USB Audio Interface'),
    ]);

    await audioDeviceService.initialize();

    expect(audioDeviceService.getPreferredDeviceId()).toBe('default');
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ device_id: 'default' }),
      }),
    );
  });

  // Regression for the alpha.10 fixup commit (47c108e on PR #111). The
  // original PR #111 used `!device.label.startsWith('麥克風 ')` to detect
  // "is this a real label or a synthetic fallback?". On zh-Hant Windows,
  // legitimate device names commonly start with "麥克風" (e.g.
  // "麥克風 (Realtek Audio)"), so the heuristic false-positived: real
  // devices were classified as fallback labels, hasPermissionDetails was
  // wrongly reported as false, and self-heal got suppressed.
  //
  // The fixup captures hasPermissionDetails from the RAW device.label
  // BEFORE the synthetic fallback is applied. This test locks in that
  // behaviour against future refactors that might naively reintroduce
  // the startsWith heuristic.
  it('regression: zh-Hant Windows device labeled like "麥克風 (Realtek Audio)" reports permission details', async () => {
    enumerateDevices.mockResolvedValue([
      makeAudioInputDevice('default', '麥克風 (Realtek Audio)'),
      makeAudioInputDevice('mic-1', '麥克風陣列 (Intel SST)'),
    ]);

    await audioDeviceService.initialize();

    // Real labels exist → permission details ARE available.
    expect(audioDeviceService.hasMicrophonePermissionDetails()).toBe(true);
  });

  it('regression: stale saved device is self-healed when zh-Hant labels confirm absence', async () => {
    // Builds on the test above: with real (zh-Hant) labels confirming the
    // missing-device is gone, self-heal must fire. Pre-fixup it would
    // have been suppressed because the labels look like fallbacks.
    vi.spyOn(storageService, 'getAppSettings').mockResolvedValue({
      server: { url: 'http://localhost', port: 8080, enabled: false },
      audio: { device_id: 'missing-device', sample_rate: 16000, chunk_duration: 2 },
      subtitle: {
        font_size: 18,
        font_color: '#FFFFFF',
        background_opacity: 0.8,
        position: 'bottom',
        display_mode: 'both',
      },
      theme: 'light',
    });
    const saveSpy = vi.spyOn(storageService, 'saveAppSettings').mockResolvedValue();
    enumerateDevices.mockResolvedValue([
      makeAudioInputDevice('default', '麥克風 (Realtek Audio)'),
      makeAudioInputDevice('mic-1', '麥克風陣列 (Intel SST)'),
    ]);

    await audioDeviceService.initialize();

    expect(audioDeviceService.getPreferredDeviceId()).toBe('default');
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ device_id: 'default' }),
      }),
    );
  });

  it('subscribers receive a snapshot containing the resolved device list', async () => {
    enumerateDevices.mockResolvedValue([
      makeAudioInputDevice('default', 'MacBook Air Microphone'),
      makeAudioInputDevice('mic-1', 'USB Audio Interface'),
    ]);
    const snapshots: Array<{
      devices: { deviceId: string; label: string }[];
      hasPermissionDetails: boolean;
    }> = [];
    const unsubscribe = audioDeviceService.subscribe((snap) => {
      snapshots.push({
        devices: snap.devices.map((d) => ({ deviceId: d.deviceId, label: d.label })),
        hasPermissionDetails: snap.hasPermissionDetails,
      });
    });

    await audioDeviceService.initialize();

    // At least one snapshot delivered with the resolved devices.
    const last = snapshots[snapshots.length - 1];
    expect(last.devices.map((d) => d.deviceId)).toEqual(['default', 'mic-1']);
    expect(last.hasPermissionDetails).toBe(true);

    unsubscribe();
  });

  it('does not clear a saved device from an incomplete unlabeled device list', async () => {
    vi.spyOn(storageService, 'getAppSettings').mockResolvedValue({
      server: { url: 'http://localhost', port: 8080, enabled: false },
      audio: { device_id: 'missing-device', sample_rate: 16000, chunk_duration: 2 },
      subtitle: {
        font_size: 18,
        font_color: '#FFFFFF',
        background_opacity: 0.8,
        position: 'bottom',
        display_mode: 'both',
      },
      theme: 'light',
    });
    const saveSpy = vi.spyOn(storageService, 'saveAppSettings').mockResolvedValue();
    enumerateDevices.mockResolvedValue([
      makeAudioInputDevice('default', ''),
      makeAudioInputDevice('mic-1', ''),
    ]);

    await audioDeviceService.initialize();

    expect(audioDeviceService.getPreferredDeviceId()).toBe('missing-device');
    expect(audioDeviceService.hasMicrophonePermissionDetails()).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
