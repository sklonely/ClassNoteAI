/**
 * 翻譯模型服務
 * 簡化翻譯模型的選擇和加載流程
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * 獲取可用的翻譯模型列表
 */
export async function getAvailableTranslationModels(): Promise<string[]> {
  try {
    const models = await invoke<string[]>('list_available_translation_models');
    return models;
  } catch (error) {
    console.error('[TranslationModelService] 獲取可用模型列表失敗:', error);
    return [];
  }
}

/**
 * 根據模型名稱加載翻譯模型
 * @param modelName 模型名稱（例如 "opus-mt-en-zh-onnx"）
 */
export async function loadTranslationModelByName(modelName: string): Promise<string> {
  try {
    const result = await invoke<string>('load_translation_model_by_name', {
      modelName: modelName,
    });
    console.log('[TranslationModelService] 模型加載成功:', result);
    return result;
  } catch (error) {
    console.error('[TranslationModelService] 模型加載失敗:', error);
    throw error;
  }
}

/**
 * 獲取模型的顯示名稱
 */
export function getModelDisplayName(modelName: string): string {
  const displayNames: Record<string, string> = {
    'opus-mt-en-zh-onnx': 'Opus-MT (英文→中文) - 推薦',
    // 大模型已排除
    // 'nllb-200-distilled-600M-onnx': 'NLLB-200 (多語言)',
    // 'mbart-large-50-onnx': 'MBart-Large-50 (多語言)',
  };
  
  return displayNames[modelName] || modelName;
}

/**
 * 下載翻譯模型
 * @param modelName 模型名稱（例如 "opus-mt-en-zh-onnx"）
 * @param outputDir 輸出目錄路徑
 * @param onProgress 進度回調（可選）
 */
export async function downloadTranslationModel(
  modelName: string,
  outputDir: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  try {
    // 模擬進度更新（實際進度需要通過 Tauri 事件系統獲取）
    if (onProgress) {
      const progressInterval = setInterval(() => {
        onProgress((prev) => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + 5;
        } as any);
      }, 500);
    }

    const result = await invoke<string>('download_translation_model', {
      modelName: modelName,
      outputDir: outputDir,
    });

    console.log('[TranslationModelService] 模型下載成功:', result);
    return result;
  } catch (error) {
    console.error('[TranslationModelService] 模型下載失敗:', error);
    throw error;
  }
}

