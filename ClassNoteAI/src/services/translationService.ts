/**
 * 翻譯服務
 * 提供粗翻譯（本地）和精翻譯（遠程）功能
 * 包含翻譯緩存以提高性能
 */

import { invoke } from '@tauri-apps/api/core';

export interface TranslationResult {
  translated_text: string;
  source: 'rough' | 'fine';
  confidence?: number;
}

interface CacheEntry {
  result: TranslationResult;
  timestamp: number;
}

/**
 * 翻譯緩存
 * 使用 LRU 策略，最多緩存 1000 條翻譯結果
 */
class TranslationCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxSize: number = 1000;
  private readonly ttl: number = 24 * 60 * 60 * 1000; // 24小時

  /**
   * 生成緩存鍵
   */
  private getCacheKey(text: string, sourceLang: string, targetLang: string, type: 'rough' | 'fine'): string {
    return `${type}:${sourceLang}:${targetLang}:${text}`;
  }

  /**
   * 獲取緩存
   */
  get(text: string, sourceLang: string, targetLang: string, type: 'rough' | 'fine'): TranslationResult | null {
    const key = this.getCacheKey(text, sourceLang, targetLang, type);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // 檢查是否過期
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * 設置緩存
   */
  set(text: string, sourceLang: string, targetLang: string, type: 'rough' | 'fine', result: TranslationResult): void {
    const key = this.getCacheKey(text, sourceLang, targetLang, type);

    // 如果緩存已滿，刪除最舊的條目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * 清除緩存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 獲取緩存統計
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

const translationCache = new TranslationCache();

/**
 * 粗翻譯（本地或 Google API）
 * 帶緩存功能
 */
export async function translateRough(
  text: string,
  sourceLang: string = 'en',
  targetLang: string = 'zh',
  useCache: boolean = true,
  provider?: 'local' | 'google',
  googleApiKey?: string
): Promise<TranslationResult> {
  // 檢查緩存
  if (useCache) {
    const cached = translationCache.get(text, sourceLang, targetLang, 'rough');
    if (cached) {
      return cached;
    }
  }

  try {
    // 確定使用的 provider 和 API key
    let actualProvider = provider;
    let actualApiKey = googleApiKey;
    
    // 如果沒有指定 provider，從設置中獲取
    if (!actualProvider) {
      try {
        const { storageService } = await import('./storageService');
        const settings = await storageService.getAppSettings();
        if (settings?.translation?.provider) {
          actualProvider = settings.translation.provider;
          console.log('[TranslationService] 從設置讀取 provider:', actualProvider);
        }
      } catch (e) {
        console.warn('[TranslationService] 無法讀取設置，使用默認本地翻譯');
      }
    }
    
    // 如果選擇 Google 翻譯但沒有提供 API key，嘗試從設置中獲取（可選）
    // 注意：即使沒有 API key，也應該使用 Google（非官方接口），而不是回退到本地
    if (actualProvider === 'google' && !actualApiKey) {
      try {
        const { storageService } = await import('./storageService');
        const settings = await storageService.getAppSettings();
        if (settings?.translation?.google_api_key) {
          actualApiKey = settings.translation.google_api_key;
          console.log('[TranslationService] 從設置讀取 Google API key');
        } else {
          console.log('[TranslationService] 未提供 Google API key，將使用非官方接口');
        }
      } catch (e) {
        console.warn('[TranslationService] 無法讀取設置中的 Google API key');
      }
    }
    
    // 默認使用本地翻譯（只有在 provider 完全未指定時）
    actualProvider = actualProvider || 'local';
    
    console.log('[TranslationService] 翻譯配置:', {
      provider: actualProvider,
      hasApiKey: !!actualApiKey,
      apiKeyLength: actualApiKey?.length || 0,
      textLength: text.length,
      textPreview: text.substring(0, 50),
    });
    
    const result = await invoke<TranslationResult>('translate_rough', {
      text,
      sourceLang,
      targetLang,
      provider: actualProvider,
      googleApiKey: actualApiKey,
    });
    
    console.log('[TranslationService] 翻譯結果:', {
      translatedText: result.translated_text,
      translatedTextLength: result.translated_text?.length || 0,
      source: result.source,
      confidence: result.confidence,
      hasChinese: /[\u4e00-\u9fa5]/.test(result.translated_text || ''),
    });
    
    // 保存到緩存
    if (useCache) {
      translationCache.set(text, sourceLang, targetLang, 'rough', result);
    }
    
    return result;
  } catch (error) {
    console.error('[TranslationService] 粗翻譯失敗:', error);
    throw error;
  }
}

/**
 * 精翻譯（遠程）
 * 帶緩存功能
 */
export async function translateFine(
  text: string,
  sourceLang: string = 'en',
  targetLang: string = 'zh',
  serviceUrl: string,
  useCache: boolean = true
): Promise<TranslationResult> {
  // 檢查緩存
  if (useCache) {
    const cached = translationCache.get(text, sourceLang, targetLang, 'fine');
    if (cached) {
      return cached;
    }
  }

  try {
    const result = await invoke<TranslationResult>('translate_fine', {
      text,
      sourceLang,
      targetLang,
      serviceUrl,
    });
    
    // 保存到緩存
    if (useCache) {
      translationCache.set(text, sourceLang, targetLang, 'fine', result);
    }
    
    return result;
  } catch (error) {
    console.error('[TranslationService] 精翻譯失敗:', error);
    throw error;
  }
}

/**
 * 檢查遠程服務是否可用
 */
export async function checkRemoteService(serviceUrl: string): Promise<boolean> {
  try {
    const available = await invoke<boolean>('check_remote_service', {
      serviceUrl,
    });
    return available;
  } catch (error) {
    console.error('[TranslationService] 檢查遠程服務失敗:', error);
    return false;
  }
}

/**
 * 清除翻譯緩存
 */
export function clearTranslationCache(): void {
  translationCache.clear();
}

/**
 * 獲取緩存統計
 */
export function getTranslationCacheStats(): { size: number; maxSize: number } {
  return translationCache.getStats();
}

