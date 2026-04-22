/**
 * 音頻設備服務
 *
 * 這一層負責：
 * - app-level 裝置列表同步
 * - 持久化的 device_id 自癒
 * - 將 enumerate / devicechange / foreground refresh 與權限請求拆開
 */

import { storageService } from './storageService';
import {
  mediaPermissionService,
  type MicrophonePermissionState,
} from './mediaPermissionService';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  groupId?: string;
}

export interface AudioDeviceSnapshot {
  devices: AudioDevice[];
  defaultDeviceId: string | null;
  preferredDeviceId: string;
  hasPermissionDetails: boolean;
  permissionState: MicrophonePermissionState;
  lastRefreshReason: string | null;
}

type AudioDeviceSubscriber = (snapshot: AudioDeviceSnapshot) => void;

class AudioDeviceService {
  private devices: AudioDevice[] = [];
  private defaultDeviceId: string | null = null;
  private preferredDeviceId = '';
  private hasPermissionDetails = false;
  private permissionState: MicrophonePermissionState = 'unknown';
  private lastRefreshReason: string | null = null;

  private subscribers = new Set<AudioDeviceSubscriber>();
  private listenersAttached = false;
  private initialized = false;
  private settingsHydrated = false;
  private refreshPromise: Promise<AudioDevice[]> | null = null;

  private readonly handleDeviceChange = async () => {
    await this.refreshAudioInputDevices({ reason: 'devicechange' });
  };

  private readonly handleWindowFocus = async () => {
    await this.refreshAudioInputDevices({ reason: 'window-focus' });
  };

  private readonly handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      await this.refreshAudioInputDevices({ reason: 'visibility-visible' });
    }
  };

  async initialize(): Promise<void> {
    await this.hydratePreferredDevice();

    if (!this.initialized) {
      this.initialized = true;
      this.attachGlobalListeners();
    }

    await this.refreshAudioInputDevices({ reason: 'initialize' });
  }

  destroy(): void {
    if (this.listenersAttached) {
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener(
          'devicechange',
          this.handleDeviceChange,
        );
      }

      window.removeEventListener('focus', this.handleWindowFocus);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);

      this.listenersAttached = false;
    }

    this.initialized = false;
    this.settingsHydrated = false;
    this.refreshPromise = null;
    this.devices = [];
    this.defaultDeviceId = null;
    this.preferredDeviceId = '';
    this.hasPermissionDetails = false;
    this.permissionState = 'unknown';
    this.lastRefreshReason = null;
    this.subscribers.clear();
  }

  subscribe(callback: AudioDeviceSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.getSnapshot());

    return () => {
      this.subscribers.delete(callback);
    };
  }

  getSnapshot(): AudioDeviceSnapshot {
    return {
      devices: [...this.devices],
      defaultDeviceId: this.defaultDeviceId,
      preferredDeviceId: this.getPreferredDeviceId(),
      hasPermissionDetails: this.hasPermissionDetails,
      permissionState: this.permissionState,
      lastRefreshReason: this.lastRefreshReason,
    };
  }

  /**
   * 與舊 API 相容：純 refresh，不主動觸發權限請求。
   */
  async getAudioInputDevices(): Promise<AudioDevice[]> {
    return this.refreshAudioInputDevices({ reason: 'manual-refresh' });
  }

  getDevices(): AudioDevice[] {
    return [...this.devices];
  }

  getDefaultDeviceId(): string | null {
    return this.defaultDeviceId;
  }

  getPreferredDeviceId(): string {
    return this.preferredDeviceId || this.defaultDeviceId || '';
  }

  hasMicrophonePermissionDetails(): boolean {
    return this.hasPermissionDetails;
  }

  getPermissionState(): MicrophonePermissionState {
    return this.permissionState;
  }

  async setPreferredDevice(
    deviceId?: string,
    options: { persist?: boolean; emit?: boolean } = {},
  ): Promise<void> {
    const { persist = true, emit = true } = options;
    await this.hydratePreferredDevice();

    const normalizedDeviceId = deviceId ?? '';
    if (this.preferredDeviceId === normalizedDeviceId) {
      return;
    }

    this.preferredDeviceId = normalizedDeviceId;

    if (persist) {
      await this.persistPreferredDeviceId(normalizedDeviceId || undefined);
    }

    if (emit) {
      this.emitSnapshot();
    }
  }

  async requestMicrophonePermission(): Promise<AudioDevice[]> {
    let stream: MediaStream | null = null;

    try {
      stream = await mediaPermissionService.requestMicrophoneAccess();
      this.permissionState = 'granted';
      return await this.refreshAudioInputDevices({ reason: 'permission-request' });
    } catch (error) {
      const normalizedError = mediaPermissionService.normalizeMicrophoneError(error);
      if (
        error instanceof Error &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      ) {
        this.permissionState = 'denied';
      }
      throw normalizedError;
    } finally {
      mediaPermissionService.stopStream(stream);
    }
  }

  async preparePreferredInputDeviceForRecording(): Promise<string | undefined> {
    await this.initialize();
    await this.refreshAudioInputDevices({ reason: 'before-recording' });

    if (!this.hasPermissionDetails) {
      await this.requestMicrophonePermission();
    }

    return this.getPreferredDeviceId() || undefined;
  }

  /**
   * 與舊 API 相容。現在改為 service-level snapshot 訂閱，而不是
   * 由設定頁自己綁 navigator.mediaDevices 的 listener。
   */
  onDeviceChange(callback: (devices: AudioDevice[]) => void): () => void {
    return this.subscribe((snapshot) => callback(snapshot.devices));
  }

  async testDevice(deviceId: string): Promise<boolean> {
    try {
      const stream = await mediaPermissionService.requestMicrophoneAccess({
        deviceId: { exact: deviceId },
      });
      mediaPermissionService.stopStream(stream);
      return true;
    } catch (error) {
      console.error(`[AudioDeviceService] 設備 ${deviceId} 測試失敗:`, error);
      return false;
    }
  }

  async refreshAudioInputDevices(options: { reason?: string } = {}): Promise<AudioDevice[]> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const { reason = 'refresh' } = options;

    this.refreshPromise = (async () => {
      await this.hydratePreferredDevice();

      const permissionSnapshot =
        await mediaPermissionService.getMicrophonePermissionState();
      this.permissionState = permissionSnapshot.state;

      if (
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.enumerateDevices !== 'function'
      ) {
        console.warn(
          '[AudioDeviceService] navigator.mediaDevices.enumerateDevices 不可用，返回空列表',
        );
        this.devices = [];
        this.defaultDeviceId = null;
        this.hasPermissionDetails = false;
        this.lastRefreshReason = reason;
        this.emitSnapshot();
        return [];
      }

      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();

        const audioInputDevices = allDevices
          .filter((device) => device.kind === 'audioinput')
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label || `麥克風 ${device.deviceId.substring(0, 8)}`,
            kind: device.kind as MediaDeviceKind,
            groupId: device.groupId,
          }));

        this.devices = audioInputDevices;
        this.defaultDeviceId =
          audioInputDevices.find((device) => device.deviceId === 'default')?.deviceId ??
          audioInputDevices[0]?.deviceId ??
          null;
        this.hasPermissionDetails = audioInputDevices.some(
          (device) =>
            Boolean(device.label) && !device.label.startsWith('麥克風 '),
        );

        if (!this.preferredDeviceId && this.defaultDeviceId) {
          this.preferredDeviceId = this.defaultDeviceId;
        }

        await this.reconcilePreferredDevice(audioInputDevices);
        this.lastRefreshReason = reason;
        this.emitSnapshot();

        return [...audioInputDevices];
      } catch (error) {
        console.error('[AudioDeviceService] 刷新音頻設備列表失敗:', error);
        this.lastRefreshReason = reason;
        this.emitSnapshot();
        return [...this.devices];
      }
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private attachGlobalListeners(): void {
    if (this.listenersAttached) return;

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener(
        'devicechange',
        this.handleDeviceChange,
      );
    }

    window.addEventListener('focus', this.handleWindowFocus);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.listenersAttached = true;
  }

  private async hydratePreferredDevice(): Promise<void> {
    if (this.settingsHydrated) return;

    this.settingsHydrated = true;

    try {
      const settings = await storageService.getAppSettings();
      this.preferredDeviceId = settings?.audio?.device_id ?? '';
    } catch (error) {
      console.warn(
        '[AudioDeviceService] Failed to hydrate saved audio device selection:',
        error,
      );
      this.preferredDeviceId = '';
    }
  }

  private async reconcilePreferredDevice(devices: AudioDevice[]): Promise<void> {
    if (!this.preferredDeviceId || devices.length === 0) {
      return;
    }

    const preferredStillExists = devices.some(
      (device) => device.deviceId === this.preferredDeviceId,
    );
    if (preferredStillExists) {
      return;
    }

    // 沒有 labels 的 enumerate 結果通常不完整，這時不能把使用者
    // 的持久化選擇誤判為 stale。
    if (!this.hasPermissionDetails) {
      console.warn(
        '[AudioDeviceService] Preferred device missing from an incomplete device list; skip self-heal until labels are available.',
      );
      return;
    }

    const fallbackDeviceId =
      this.defaultDeviceId ?? devices[0]?.deviceId ?? '';

    console.warn(
      `[AudioDeviceService] Preferred device ${this.preferredDeviceId} is no longer available; falling back to ${fallbackDeviceId || 'system default'}.`,
    );

    this.preferredDeviceId = fallbackDeviceId;
    await this.persistPreferredDeviceId(fallbackDeviceId || undefined);
  }

  private async persistPreferredDeviceId(deviceId?: string): Promise<void> {
    try {
      const settings = await storageService.getAppSettings();
      if (!settings) {
        return;
      }

      const nextDeviceId = deviceId || undefined;
      if (settings.audio?.device_id === nextDeviceId) {
        return;
      }

      await storageService.saveAppSettings({
        ...settings,
        audio: {
          sample_rate: settings.audio?.sample_rate ?? 16000,
          chunk_duration: settings.audio?.chunk_duration ?? 2,
          device_id: nextDeviceId,
        },
      });
    } catch (error) {
      console.warn(
        '[AudioDeviceService] Failed to persist preferred device selection:',
        error,
      );
    }
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const subscriber of this.subscribers) {
      try {
        subscriber(snapshot);
      } catch (error) {
        console.warn('[AudioDeviceService] Subscriber threw:', error);
      }
    }
  }
}

export const audioDeviceService = new AudioDeviceService();
