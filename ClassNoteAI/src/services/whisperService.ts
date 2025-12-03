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

export type ModelType = 'base' | 'small' | 'tiny';

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
  const modelFileName = `ggml-${modelType}.bin`;
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
 * 下載 Whisper 模型
 * @param modelType 模型類型
 * @param onProgress 進度回調（可選，目前未實現實時進度）
 * @returns 下載結果消息
 */
export async function downloadModel(
  modelType: ModelType = 'base',
  _onProgress?: (progress: number) => void
): Promise<string> {
  try {
    const appDataDir = await getAppDataDir();
    const modelsDir = await path.join(appDataDir, 'models');
    
    console.log('[WhisperService] 開始下載模型:', modelType);
    console.log('[WhisperService] 保存目錄:', modelsDir);
    
    // 注意：目前的實現中，進度回調是在 Rust 後端通過 println 輸出的
    // 如果需要實時進度更新，需要使用 Tauri 事件系統（後續實現）
    const result = await invoke<string>('download_whisper_model', {
      modelType: modelType,
      outputDir: modelsDir,
    });
    
    console.log('[WhisperService] 下載完成:', result);
    return result;
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
export async function transcribeAudio(
  audioData: Int16Array,
  sampleRate: number,
  initialPrompt?: string
): Promise<TranscriptionResult> {
  try {
    // 將 Int16Array 轉換為 number[]
    const audioArray = Array.from(audioData);
    
    const result = await invoke<TranscriptionResult>('transcribe_audio', {
      audioData: audioArray,
      sampleRate: sampleRate,
      initialPrompt: initialPrompt || null,
    });
    
    return result;
  } catch (error) {
    console.error('[WhisperService] 轉錄失敗:', error);
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
  };
  return names[modelType] || 'Base';
}

