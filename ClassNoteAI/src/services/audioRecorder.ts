/**
 * 音頻錄製服務
 * 使用 Web Audio API 實現麥克風音頻錄製
 */

import { AudioProcessor } from '../utils/audioProcessor';

export interface AudioRecorderConfig {
  sampleRate?: number; // 採樣率，默認 48000（後續會轉換為 16kHz）
  channelCount?: number; // 聲道數，默認 1（Mono）
  deviceId?: string; // 設備 ID，可選
}

export interface AudioChunk {
  data: Int16Array; // 16-bit PCM 數據
  sampleRate: number;
  timestamp: number; // 時間戳（毫秒）
}

export type AudioRecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped' | 'error';

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private gainNode: GainNode | null = null;
  private status: AudioRecorderStatus = 'idle';
  private config: Required<AudioRecorderConfig>;
  private onChunkCallback: ((chunk: AudioChunk) => void) | null = null;
  private onStatusChangeCallback: ((status: AudioRecorderStatus) => void) | null = null;
  private onErrorCallback: ((error: Error) => void) | null = null;
  private startTime: number = 0;

  // 測試用途：存儲錄製的音頻數據
  private recordedChunks: Int16Array[] = [];
  private recordingSampleRate: number = 0;

  // 音頻處理器（用於格式轉換）
  private audioProcessor!: AudioProcessor;

  constructor(config: AudioRecorderConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate || 48000,
      channelCount: config.channelCount || 1,
      deviceId: config.deviceId || '',
    };

    // 初始化音頻處理器（目標採樣率：16kHz）
    this.audioProcessor = new AudioProcessor(16000);
  }

  /**
   * 初始化音頻上下文
   */
  private async initAudioContext(): Promise<AudioContext> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      return this.audioContext;
    }

    // 創建 AudioContext，使用配置的採樣率
    this.audioContext = new AudioContext({
      sampleRate: this.config.sampleRate,
      latencyHint: 'interactive', // 低延遲模式
    });

    console.log('[AudioRecorder] AudioContext 初始化成功:', {
      sampleRate: this.audioContext.sampleRate,
      state: this.audioContext.state,
    });

    return this.audioContext;
  }

  /**
   * 請求麥克風權限並獲取音頻流
   */
  private async getMediaStream(): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: this.config.deviceId ? { exact: this.config.deviceId } : undefined,
        sampleRate: this.config.sampleRate,
        channelCount: this.config.channelCount,
        echoCancellation: true, // 回音消除
        noiseSuppression: true, // 噪音抑制
        autoGainControl: true, // 自動增益控制
      },
    };

    try {
      console.log('[AudioRecorder] 請求麥克風權限...');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('瀏覽器不支持音頻錄製 API (navigator.mediaDevices.getUserMedia)');
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[AudioRecorder] 麥克風權限獲取成功');

      // 獲取實際的音頻軌道信息
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const track = audioTracks[0];
        const settings = track.getSettings();
        console.log('[AudioRecorder] 音頻軌道設置:', {
          deviceId: settings.deviceId,
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          label: track.label,
        });
      }

      return stream;
    } catch (error) {
      console.error('[AudioRecorder] 麥克風權限獲取失敗:', error);

      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          throw new Error('麥克風權限被拒絕，請在瀏覽器設置中允許麥克風訪問');
        } else if (error.name === 'NotFoundError') {
          throw new Error('未找到麥克風設備，請檢查設備連接');
        } else if (error.name === 'NotReadableError') {
          throw new Error('麥克風設備無法訪問，可能被其他應用佔用');
        }
      }

      throw error;
    }
  }

  /**
   * 處理音頻數據
   */
  private handleAudioProcess = (event: AudioProcessingEvent) => {
    if (this.status !== 'recording') {
      return;
    }

    const inputBuffer = event.inputBuffer;
    const inputData = inputBuffer.getChannelData(0); // 獲取第一個聲道（Mono）

    // 轉換為 Float32Array（如果需要的話）
    const floatData = new Float32Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      floatData[i] = inputData[i];
    }

    // 使用音頻處理器轉換為 Whisper 格式（16kHz, 16-bit, Mono）
    const whisperFormatData = this.audioProcessor.convertToWhisperFormat(
      floatData,
      inputBuffer.sampleRate,
      this.config.channelCount
    );

    // 測試用途：保存原始音頻數據（用於 WAV 保存）
    const originalPcmData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const sample = Math.max(-1, Math.min(1, inputData[i]));
      originalPcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    this.recordedChunks.push(originalPcmData);
    if (this.recordingSampleRate === 0) {
      this.recordingSampleRate = inputBuffer.sampleRate;
    }

    // 計算時間戳
    const timestamp = Date.now() - this.startTime;

    // 創建音頻塊（使用轉換後的格式）
    const chunk: AudioChunk = {
      data: whisperFormatData, // 使用轉換後的 16kHz 數據
      sampleRate: 16000, // Whisper 標準採樣率
      timestamp,
    };

    // 調用回調
    if (this.onChunkCallback) {
      this.onChunkCallback(chunk);
    }
  };

  /**
   * 設置音頻數據回調
   */
  onChunk(callback: (chunk: AudioChunk) => void): void {
    this.onChunkCallback = callback;
  }

  /**
   * 設置狀態變化回調
   */
  onStatusChange(callback: (status: AudioRecorderStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  /**
   * 設置錯誤回調
   */
  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * 更新狀態並觸發回調
   */
  private setStatus(status: AudioRecorderStatus): void {
    if (this.status === status) {
      return;
    }

    this.status = status;
    console.log('[AudioRecorder] 狀態變化:', status);

    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(status);
    }
  }

  /**
   * 開始錄製
   */
  async start(): Promise<void> {
    if (this.status === 'recording') {
      console.warn('[AudioRecorder] 已經在錄製中');
      return;
    }

    try {
      // 初始化音頻上下文
      const audioContext = await this.initAudioContext();

      // 如果上下文被暫停，恢復它
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('[AudioRecorder] AudioContext 已恢復');
      }

      // 獲取音頻流
      this.mediaStream = await this.getMediaStream();

      // 創建音頻源節點
      this.sourceNode = audioContext.createMediaStreamSource(this.mediaStream);

      // 創建音頻處理節點
      // bufferSize: 4096 是一個較大的緩衝區，可以減少處理頻率
      // inputChannels: 1 (Mono)
      // outputChannels: 1 (需要至少一個輸出通道才能連接到 destination)
      this.processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      this.processorNode.onaudioprocess = this.handleAudioProcess;

      // 創建一個 GainNode 用於靜音輸出（我們不需要聽到錄製的聲音）
      this.gainNode = audioContext.createGain();
      this.gainNode.gain.value = 0; // 設置增益為 0，靜音輸出

      // 連接節點
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.gainNode);
      this.gainNode.connect(audioContext.destination); // 連接到 destination 以激活處理

      // 記錄開始時間
      this.startTime = Date.now();

      // 測試用途：重置錄製數據
      this.recordedChunks = [];
      this.recordingSampleRate = 0;

      // 更新狀態
      this.setStatus('recording');

      console.log('[AudioRecorder] 錄製開始');
    } catch (error) {
      console.error('[AudioRecorder] 錄製啟動失敗:', error);
      this.setStatus('error');

      if (this.onErrorCallback && error instanceof Error) {
        this.onErrorCallback(error);
      } else if (this.onErrorCallback) {
        this.onErrorCallback(new Error('未知錯誤'));
      }

      // 清理資源
      await this.cleanup();
      throw error;
    }
  }

  /**
   * 暫停錄製
   */
  pause(): void {
    if (this.status !== 'recording') {
      console.warn('[AudioRecorder] 當前狀態不允許暫停:', this.status);
      return;
    }

    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend();
      console.log('[AudioRecorder] AudioContext 已暫停');
    }

    this.setStatus('paused');
    console.log('[AudioRecorder] 錄製已暫停');
  }

  /**
   * 恢復錄製
   */
  async resume(): Promise<void> {
    if (this.status !== 'paused') {
      console.warn('[AudioRecorder] 當前狀態不允許恢復:', this.status);
      return;
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      console.log('[AudioRecorder] AudioContext 已恢復');
    }

    this.setStatus('recording');
    console.log('[AudioRecorder] 錄製已恢復');
  }

  /**
   * 停止錄製
   */
  async stop(): Promise<void> {
    if (this.status === 'idle' || this.status === 'stopped') {
      console.warn('[AudioRecorder] 當前狀態不允許停止:', this.status);
      return;
    }

    await this.cleanup();
    this.setStatus('stopped');
    console.log('[AudioRecorder] 錄製已停止');
  }

  /**
   * 清理資源
   */
  private async cleanup(): Promise<void> {
    // 斷開音頻節點
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // 停止音頻軌道
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        console.log('[AudioRecorder] 音頻軌道已停止:', track.label);
      });
      this.mediaStream = null;
    }

    // 關閉 AudioContext（可選，保留以便後續使用）
    // 如果完全不需要了，可以關閉
    // if (this.audioContext && this.audioContext.state !== 'closed') {
    //   await this.audioContext.close();
    //   this.audioContext = null;
    // }
  }

  /**
   * 獲取當前狀態
   */
  getStatus(): AudioRecorderStatus {
    return this.status;
  }

  /**
   * 獲取當前音頻上下文
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AudioRecorderConfig>): void {
    if (this.status === 'recording') {
      console.warn('[AudioRecorder] 錄製中無法更新配置');
      return;
    }

    this.config = {
      ...this.config,
      ...config,
    };

    console.log('[AudioRecorder] 配置已更新:', this.config);
  }

  /**
   * 測試用途：將錄製的音頻保存為 WAV 文件
   */
  async saveAsWAV(filename: string = `recording-${Date.now()}.wav`): Promise<void> {
    if (this.recordedChunks.length === 0) {
      throw new Error('沒有錄製的音頻數據');
    }

    // 合併所有音頻塊
    const totalLength = this.recordedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const mergedData = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of this.recordedChunks) {
      mergedData.set(chunk, offset);
      offset += chunk.length;
    }

    // 創建 WAV 文件
    const sampleRate = this.recordingSampleRate || this.config.sampleRate;
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = mergedData.length * 2; // 每個樣本 2 字節

    // WAV 文件頭
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // RIFF 頭
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // 文件大小 - 8
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk 大小
    view.setUint16(20, 1, true); // 音頻格式 (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // 將 Int16Array 轉換為 ArrayBuffer
    const pcmBuffer = mergedData.buffer.slice(
      mergedData.byteOffset,
      mergedData.byteOffset + mergedData.byteLength
    );

    // 合併 WAV 頭和 PCM 數據
    const wavFile = new Blob([wavHeader, pcmBuffer], { type: 'audio/wav' });

    // 創建下載鏈接
    const url = URL.createObjectURL(wavFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[AudioRecorder] 音頻已保存:', filename, {
      duration: (mergedData.length / sampleRate).toFixed(2) + 's',
      sampleRate,
      size: (wavFile.size / 1024).toFixed(2) + 'KB',
    });
  }

  /**
   * 測試用途：獲取錄製的音頻信息
   */
  getRecordingInfo(): { duration: number; sampleRate: number; chunks: number } | null {
    if (this.recordedChunks.length === 0) {
      return null;
    }

    const totalSamples = this.recordedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const sampleRate = this.recordingSampleRate || this.config.sampleRate;
    const duration = totalSamples / sampleRate;

    return {
      duration,
      sampleRate,
      chunks: this.recordedChunks.length,
    };
  }

  /**
   * 銷毀實例
   */
  async destroy(): Promise<void> {
    await this.stop();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.onChunkCallback = null;
    this.onStatusChangeCallback = null;
    this.onErrorCallback = null;
    this.recordedChunks = [];
    this.recordingSampleRate = 0;

    console.log('[AudioRecorder] 實例已銷毀');
  }
}

