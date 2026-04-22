export type MicrophonePermissionState =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unknown'
  | 'unsupported';

export interface MicrophonePermissionSnapshot {
  state: MicrophonePermissionState;
  supported: boolean;
}

class MediaPermissionService {
  isMediaDevicesSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices;
  }

  isMicrophoneAccessSupported(): boolean {
    return (
      this.isMediaDevicesSupported() &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  async getMicrophonePermissionState(): Promise<MicrophonePermissionSnapshot> {
    if (!this.isMicrophoneAccessSupported()) {
      return { state: 'unsupported', supported: false };
    }

    if (!navigator.permissions?.query) {
      return { state: 'unknown', supported: true };
    }

    try {
      const status = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });

      if (
        status.state === 'granted' ||
        status.state === 'prompt' ||
        status.state === 'denied'
      ) {
        return { state: status.state, supported: true };
      }
    } catch (error) {
      console.warn(
        '[MediaPermissionService] Failed to query microphone permission state:',
        error,
      );
    }

    return { state: 'unknown', supported: true };
  }

  async requestMicrophoneAccess(
    constraints: MediaTrackConstraints = {},
  ): Promise<MediaStream> {
    if (!this.isMicrophoneAccessSupported()) {
      throw new Error('目前環境不支援麥克風存取 API');
    }

    return navigator.mediaDevices.getUserMedia({ audio: constraints });
  }

  stopStream(stream: MediaStream | null | undefined): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  isRecoverableDeviceSelectionError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')
    );
  }

  normalizeMicrophoneError(error: unknown): Error {
    if (!(error instanceof Error)) {
      return new Error('麥克風初始化失敗');
    }

    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return new Error('麥克風權限被拒絕，請在系統設定允許 ClassNote AI 使用麥克風');
      case 'NotFoundError':
        return new Error('未找到可用的麥克風設備，請檢查設備連接');
      case 'NotReadableError':
        return new Error('麥克風設備無法訪問，可能被其他應用程式佔用');
      case 'OverconstrainedError':
        return new Error('先前選取的麥克風已不可用，請改用其他裝置或系統預設麥克風');
      case 'AbortError':
        return new Error('麥克風初始化被中斷，請再試一次');
      default:
        return error;
    }
  }
}

export const mediaPermissionService = new MediaPermissionService();
