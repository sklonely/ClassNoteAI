/**
 * TranslationService Unit Tests
 * 
 * Tests the translation cache logic and API calls.
 * Note: Translation will be replaced in v0.4.0 but cache logic remains.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { setMockInvokeResult, clearMockInvokeResults } from '../../test/setup';

// Mock storageService to avoid circular dependency issues in tests
vi.mock('../storageService', () => ({
    storageService: {
        getAppSettings: vi.fn(() => Promise.resolve({
            translation: {
                provider: 'local',
                google_api_key: undefined,
            },
        })),
    },
}));

// Import after mocking
import {
    translateRough,
    clearTranslationCache,
    getTranslationCacheStats,
    TranslationResult,
} from '../translationService';

describe('TranslationService', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        clearTranslationCache();
        vi.clearAllMocks();
    });

    // ===== Cache Tests =====
    describe('Translation Cache', () => {
        it('should cache translation results', async () => {
            const mockResult: TranslationResult = {
                translated_text: '你好',
                source: 'rough',
                confidence: 0.95,
            };

            setMockInvokeResult('translate_rough', mockResult);

            // First call - should invoke backend
            const result1 = await translateRough('Hello', 'en', 'zh', true);
            expect(result1.translated_text).toBe('你好');
            expect(invoke).toHaveBeenCalledTimes(1);

            // Second call with same params - should use cache
            const result2 = await translateRough('Hello', 'en', 'zh', true);
            expect(result2.translated_text).toBe('你好');
            // invoke should not be called again
            expect(invoke).toHaveBeenCalledTimes(1);
        });

        it('should bypass cache when useCache is false', async () => {
            const mockResult: TranslationResult = {
                translated_text: '世界',
                source: 'rough',
            };

            setMockInvokeResult('translate_rough', mockResult);

            await translateRough('World', 'en', 'zh', false);
            expect(invoke).toHaveBeenCalledTimes(1);

            // Second call without cache - should invoke again
            await translateRough('World', 'en', 'zh', false);
            expect(invoke).toHaveBeenCalledTimes(2);
        });

        it('should track cache stats', async () => {
            const mockResult: TranslationResult = {
                translated_text: '測試',
                source: 'rough',
            };

            setMockInvokeResult('translate_rough', mockResult);

            // Initial stats
            let stats = getTranslationCacheStats();
            expect(stats.size).toBe(0);
            expect(stats.maxSize).toBe(1000);

            // Add one translation
            await translateRough('test', 'en', 'zh', true);

            stats = getTranslationCacheStats();
            expect(stats.size).toBe(1);
        });

        it('should clear cache', async () => {
            const mockResult: TranslationResult = {
                translated_text: '清除',
                source: 'rough',
            };

            setMockInvokeResult('translate_rough', mockResult);

            await translateRough('clear', 'en', 'zh', true);
            expect(getTranslationCacheStats().size).toBe(1);

            clearTranslationCache();
            expect(getTranslationCacheStats().size).toBe(0);
        });
    });

    // ===== Rough Translation Tests =====
    describe('Rough Translation', () => {
        it('should call invoke with correct parameters', async () => {
            const mockResult: TranslationResult = {
                translated_text: '你好世界',
                source: 'rough',
            };

            setMockInvokeResult('translate_rough', mockResult);

            const result = await translateRough('Hello World', 'en', 'zh', false, 'local');

            expect(invoke).toHaveBeenCalledWith('translate_rough', {
                text: 'Hello World',
                sourceLang: 'en',
                targetLang: 'zh',
                provider: 'local',
                googleApiKey: undefined,
            });
            expect(result.translated_text).toBe('你好世界');
        });

        it('should use default language parameters', async () => {
            const mockResult: TranslationResult = {
                translated_text: '默認',
                source: 'rough',
            };

            setMockInvokeResult('translate_rough', mockResult);

            await translateRough('default', undefined, undefined, false);

            expect(invoke).toHaveBeenCalledWith('translate_rough', expect.objectContaining({
                sourceLang: 'en',
                targetLang: 'zh',
            }));
        });
    });

    // Fine translation + remote service tests removed in v0.5.0 alongside
    // the deletion of those functions. New tests will be added alongside
    // the LLMProvider implementation in a follow-up PR.
});
