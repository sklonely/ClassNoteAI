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
 * 粗翻譯（本地）
 * 帶緩存功能
 */
export async function translateRough(
  text: string,
  sourceLang: string = 'en',
  targetLang: string = 'zh',
  useCache: boolean = true
): Promise<TranslationResult> {
  // 檢查緩存
  if (useCache) {
    const cached = translationCache.get(text, sourceLang, targetLang, 'rough');
    if (cached) {
      return cached;
    }
  }

  try {
    const result = await invoke<TranslationResult>('translate_rough', {
      text,
      sourceLang,
      targetLang,
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

