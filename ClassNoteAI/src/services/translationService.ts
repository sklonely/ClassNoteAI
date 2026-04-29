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
   *
   * cp75.5 — `provider` joined the key. Without it, switching providers
   * (Gemma → Google → local) returned the previously-cached translation
   * for 24 h, masking provider-quality differences and preventing users
   * from validating their settings change. Empty string when caller
   * doesn't pass one (single-provider call sites).
   */
  private getCacheKey(
    text: string,
    sourceLang: string,
    targetLang: string,
    type: 'rough' | 'fine',
    provider: string = '',
  ): string {
    return `${type}:${provider}:${sourceLang}:${targetLang}:${text}`;
  }

  /**
   * 獲取緩存
   */
  get(
    text: string,
    sourceLang: string,
    targetLang: string,
    type: 'rough' | 'fine',
    provider: string = '',
  ): TranslationResult | null {
    const key = this.getCacheKey(text, sourceLang, targetLang, type, provider);
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
  set(
    text: string,
    sourceLang: string,
    targetLang: string,
    type: 'rough' | 'fine',
    result: TranslationResult,
    provider: string = '',
  ): void {
    const key = this.getCacheKey(text, sourceLang, targetLang, type, provider);

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
  provider?: 'local' | 'gemma' | 'google',
  googleApiKey?: string,
  gemmaEndpoint?: string
): Promise<TranslationResult> {
  try {
    // 確定使用的 provider 和 API key
    // cp75.5 — moved BEFORE the cache check so the cache key uses the
    // resolved provider, not the (often undefined) caller-supplied one.
    // Otherwise GET and SET ran with different keys → effectively no
    // cache hit ever.
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

    // 預設使用 gemma — pin here so the cache key downstream is stable.
    // Repeated downstream `actualProvider = actualProvider || 'gemma'`
    // line later is now a no-op for cache purposes.
    actualProvider = actualProvider || 'gemma';

    // 檢查緩存 — provider-aware key (cp75.5)
    if (useCache) {
      const cached = translationCache.get(
        text,
        sourceLang,
        targetLang,
        'rough',
        actualProvider,
      );
      if (cached) {
        return cached;
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

    // 預設使用 gemma（如果 sidecar 沒跑，translateRough 會自動 fallback）。
    // 早期預設 'local' 造成大量 dev build 失敗（沒 nmt-local feature）。
    actualProvider = actualProvider || 'gemma';

    console.log('[TranslationService] 翻譯配置:', {
      provider: actualProvider,
      hasApiKey: !!actualApiKey,
      apiKeyLength: actualApiKey?.length || 0,
      textLength: text.length,
      textPreview: text.substring(0, 50),
    });

    // For Gemma provider, also resolve endpoint from settings if caller
    // didn't pass one explicitly. Empty string → backend uses its default.
    let actualGemmaEndpoint = gemmaEndpoint;
    if (actualProvider === 'gemma' && actualGemmaEndpoint === undefined) {
      try {
        const { storageService } = await import('./storageService');
        const settings = await storageService.getAppSettings();
        actualGemmaEndpoint = settings?.translation?.gemma_endpoint || undefined;
      } catch {
        // best-effort; backend will fall back to DEFAULT_ENDPOINT
      }
    }

    // Generic fallback chain: try the user's choice first, then the
    // remaining backends in priority order. Stops at the first one that
    // returns non-empty text. Replaces the old "localâgoogle empty-string
    // only" path; that one never triggered when the backend threw (e.g.
    // "nmt-local not compiled" in dev builds), so subtitles silently
    // dropped to English-only with no Chinese rendered.
    const tried = new Set<string>();
    const order: Array<'local' | 'gemma' | 'google'> = [];
    for (const p of [actualProvider, 'gemma' as const, 'google' as const]) {
      if (!tried.has(p)) {
        tried.add(p);
        order.push(p as 'local' | 'gemma' | 'google');
      }
    }

    let result: TranslationResult | null = null;
    let firstError: unknown = null;
    for (const tryProvider of order) {
      try {
        const r = await invoke<TranslationResult>('translate_rough', {
          text,
          sourceLang,
          targetLang,
          provider: tryProvider,
          googleApiKey: actualApiKey,
          gemmaEndpoint: actualGemmaEndpoint,
        });
        if (r.translated_text && r.translated_text.trim() !== '') {
          if (tryProvider !== actualProvider) {
            console.log(
              `[TranslationService] èªåå¾ ${actualProvider} fallback å° ${tryProvider}`,
            );
          }
          result = r;
          break;
        }
        console.warn(`[TranslationService] ${tryProvider} åå³ç©ºçµæï¼åè©¦ä¸å backend`);
      } catch (e) {
        if (firstError === null) firstError = e;
        const msg = String((e as { message?: string })?.message ?? e ?? '');
        console.warn(`[TranslationService] ${tryProvider} å¤±æ: ${msg.slice(0, 120)}`);
      }
    }
    if (!result) {
      throw firstError ?? new Error('ææç¿»è­¯å¾ç«¯åä¸å¯ç¨');
    }

    // 保存到緩存 — keep the resolved provider in the key so a future
    // settings change (provider switch) doesn't return this entry.
    if (useCache) {
      translationCache.set(
        text,
        sourceLang,
        targetLang,
        'rough',
        result,
        actualProvider ?? '',
      );
    }

    return result;
  } catch (error) {
    console.error('[TranslationService] 粗翻譯失敗:', error);
    throw error;
  }
}

// Fine translation and remote service check were removed in v0.5.0 —
// they used to hit ClassNoteServer, which is now archived at git tag
// server-archive-v0.4.0. Fine translation will be re-implemented via
// LLMProvider (GitHub Models, OpenAI, Anthropic, etc.) in a follow-up PR.

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

