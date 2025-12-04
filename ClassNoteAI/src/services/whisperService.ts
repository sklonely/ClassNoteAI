/**
 * Whisper 服務
 * 提供模型下載、加載、轉錄等功能
 */

import { invoke } from '@tauri-apps/api/core';
import { path } from '@tauri-apps/api';

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  language: string | null;
  duration_ms: number;
}

export interface TranscriptionSegment {
  text: string;
  start_ms: number;
  end_ms: number;
}

export type ModelType = 'tiny' | 'base' | 'small' | 'medium' | 'large' | 'small-q5' | 'medium-q5';

/**
 * 獲取應用數據目錄
 */
async function getAppDataDir(): Promise<string> {
  try {
    const appDataDir = await path.appDataDir();
    return appDataDir;
  } catch (error) {
    console.error('[WhisperService] 獲取應用數據目錄失敗:', error);
    // 回退到當前目錄
    return './models';
  }
}

/**
 * 獲取模型文件路徑
 */
async function getModelPath(modelType: ModelType = 'base'): Promise<string> {
  const appDataDir = await getAppDataDir();
  // 處理量化模型的文件名
  let modelFileName = `ggml-${modelType}.bin`;
  if (modelType === 'small-q5') {
    modelFileName = 'ggml-small-q5.bin';
  } else if (modelType === 'medium-q5') {
    modelFileName = 'ggml-medium-q5.bin';
  }

  return await path.join(appDataDir, 'models', modelFileName);
}

/**
 * 檢查模型文件是否存在
 */
export async function checkModelFile(modelType: ModelType = 'base'): Promise<boolean> {
  try {
    const modelPath = await getModelPath(modelType);
    console.log('[WhisperService] 檢查模型文件:', modelPath);
    const exists = await invoke<boolean>('check_whisper_model', {
      modelPath: modelPath,
    });
    console.log('[WhisperService] 模型文件檢查結果:', exists);
    return exists;
  } catch (error) {
    console.error('[WhisperService] 檢查模型文件失敗:', error);
    return false;
  }
}

/**
 * 下載進度信息
 */
export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
  speed_mbps: number;
  eta_seconds: number | null;
}

/**
 * 下載 Whisper 模型（支持真實進度顯示和斷點續傳）
 * @param modelType 模型類型
 * @param onProgress 進度回調（可選，接收真實下載進度）
 * @returns 下載結果消息
 */
export async function downloadModel(
  modelType: ModelType = 'base',
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  try {
    const { listen } = await import('@tauri-apps/api/event');

    const appDataDir = await getAppDataDir();
    const modelsDir = await path.join(appDataDir, 'models');

    console.log('[WhisperService] 開始下載模型:', modelType);
    console.log('[WhisperService] 保存目錄:', modelsDir);

    // 監聽下載進度事件
    const progressEventName = `download-progress-${modelType}`;
    const unlistenProgress = onProgress ? await listen<DownloadProgress>(
      progressEventName,
      (event) => {
        if (onProgress) {
          onProgress(event.payload);
        }
      }
    ) : null;

    // 監聽下載完成事件
    const completedEventName = `download-completed-${modelType}`;
    const unlistenCompleted = await listen(completedEventName, () => {
      console.log('[WhisperService] 下載完成事件收到');
    });

    // 監聽下載錯誤事件
    const errorEventName = `download-error-${modelType}`;
    const unlistenError = await listen<string>(errorEventName, (event) => {
      console.error('[WhisperService] 下載錯誤事件:', event.payload);
    });

    try {
      const result = await invoke<string>('download_whisper_model', {
        modelType: modelType,
        outputDir: modelsDir,
      });

      console.log('[WhisperService] 下載完成:', result);
      return result;
    } finally {
      // 清理事件監聽器
      if (unlistenProgress) {
        unlistenProgress();
      }
      unlistenCompleted();
      unlistenError();
    }
  } catch (error) {
    console.error('[WhisperService] 下載失敗:', error);
    throw error;
  }
}

/**
 * 加載 Whisper 模型
 */
export async function loadModel(modelType: ModelType = 'base'): Promise<string> {
  try {
    const modelPath = await getModelPath(modelType);
    console.log('[WhisperService] 加載模型:', modelPath);

    const result = await invoke<string>('load_whisper_model', {
      modelPath: modelPath,
    });

    console.log('[WhisperService] 模型加載成功');
    return result;
  } catch (error) {
    console.error('[WhisperService] 模型加載失敗:', error);
    throw error;
  }
}

/**
 * 轉錄音頻數據
 */
export interface TranscriptionOptions {
  strategy: 'greedy' | 'beam_search';
  beam_size?: number;
  patience?: number;
}

export async function transcribeAudio(
  audioData: Int16Array,
  sampleRate: number,
  initialPrompt?: string,
  options?: TranscriptionOptions
): Promise<any> {
  try {
    // 將 Int16Array 轉換為普通數組傳遞給 Rust
    const audioArray = Array.from(audioData);

    const result = await invoke('transcribe_audio', {
      audioData: audioArray,
      sampleRate,
      initialPrompt,
      options,
    });

    return result;
  } catch (error) {
    console.error('轉錄失敗:', error);
    throw error;
  }
}

/**
 * 獲取模型文件大小（MB）
 */
export function getModelSize(modelType: ModelType): number {
  const sizes: Record<ModelType, number> = {
    tiny: 75,
    base: 142,
    small: 466,
    medium: 1500,
    large: 2900,
    'small-q5': 180,
    'medium-q5': 530,
  };
  return sizes[modelType] || 142;
}

/**
 * 獲取模型顯示名稱
 */
export function getModelDisplayName(modelType: ModelType): string {
  const names: Record<ModelType, string> = {
    tiny: 'Tiny (75MB) - 最快，準確度較低',
    base: 'Base (142MB) - 推薦，平衡速度和準確度',
    small: 'Small (466MB) - 更準確，較慢',
    medium: 'Medium (1.5GB) - 高準確度，較慢',
    large: 'Large (2.9GB) - 最高準確度，很慢',
    'small-q5': 'Small Quantized (180MB) - 🚀 推薦 (快且準)',
    'medium-q5': 'Medium Quantized (530MB) - 🎯 最佳平衡',
  };
  return names[modelType] || 'Base';
}

