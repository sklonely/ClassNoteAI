/**
 * 音頻設備服務
 * 用於獲取和管理音頻輸入設備
 */

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  groupId?: string;
}

class AudioDeviceService {
  private devices: AudioDevice[] = [];
  private defaultDeviceId: string | null = null;

  /**
   * 獲取所有音頻輸入設備
   */
  async getAudioInputDevices(): Promise<AudioDevice[]> {
    try {
      // 檢查 navigator.mediaDevices 是否可用
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('[AudioDeviceService] navigator.mediaDevices 不可用，返回空列表');
        return [];
      }

      // 請求權限以獲取設備標籤
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      
      // 過濾出音頻輸入設備
      const audioInputDevices = allDevices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `麥克風 ${device.deviceId.substring(0, 8)}`,
          kind: device.kind as MediaDeviceKind,
          groupId: device.groupId,
        }));

      this.devices = audioInputDevices;
      
      // 設置默認設備（第一個設備）
      if (audioInputDevices.length > 0 && !this.defaultDeviceId) {
        this.defaultDeviceId = audioInputDevices[0].deviceId;
      }

      return audioInputDevices;
    } catch (error) {
      console.error('[AudioDeviceService] 獲取音頻設備失敗:', error);
      // 在 Tauri 環境中，如果無法獲取設備，返回空列表而不是拋出錯誤
      return [];
    }
  }

  /**
   * 獲取當前緩存的設備列表
   */
  getDevices(): AudioDevice[] {
    return this.devices;
  }

  /**
   * 獲取默認設備 ID
   */
  getDefaultDeviceId(): string | null {
    return this.defaultDeviceId;
  }

  /**
   * 設置默認設備
   */
  setDefaultDevice(deviceId: string): void {
    this.defaultDeviceId = deviceId;
  }

  /**
   * 監聽設備變化
   */
  onDeviceChange(callback: (devices: AudioDevice[]) => void): () => void {
    // 檢查 navigator.mediaDevices 是否可用
    if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) {
      console.warn('[AudioDeviceService] navigator.mediaDevices 不可用，無法監聽設備變化');
      // 返回一個空的清理函數
      return () => {};
    }

    const handleDeviceChange = async () => {
      const updatedDevices = await this.getAudioInputDevices();
      callback(updatedDevices);
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    // 返回清理函數
    return () => {
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
    };
  }

  /**
   * 測試設備是否可用
   */
  async testDevice(deviceId: string): Promise<boolean> {
    try {
      // 檢查 navigator.mediaDevices 是否可用
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('[AudioDeviceService] navigator.mediaDevices 不可用');
        return false;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
        },
      });
      
      // 清理測試流
      stream.getTracks().forEach(track => track.stop());
      
      return true;
    } catch (error) {
      console.error(`[AudioDeviceService] 設備 ${deviceId} 測試失敗:`, error);
      return false;
    }
  }
}

export const audioDeviceService = new AudioDeviceService();

