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
    translateFine,
    checkRemoteService,
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

    // ===== Fine Translation Tests =====
    describe('Fine Translation', () => {
        it('should call invoke with service URL', async () => {
            const mockResult: TranslationResult = {
                translated_text: '精翻譯結果',
                source: 'fine',
                confidence: 0.99,
            };

            setMockInvokeResult('translate_fine', mockResult);

            const result = await translateFine(
                'Fine translation',
                'en',
                'zh',
                'http://localhost:8080',
                false
            );

            expect(invoke).toHaveBeenCalledWith('translate_fine', {
                text: 'Fine translation',
                sourceLang: 'en',
                targetLang: 'zh',
                serviceUrl: 'http://localhost:8080',
            });
            expect(result.translated_text).toBe('精翻譯結果');
            expect(result.source).toBe('fine');
        });

        it('should cache fine translation results', async () => {
            const mockResult: TranslationResult = {
                translated_text: '緩存精翻',
                source: 'fine',
            };

            setMockInvokeResult('translate_fine', mockResult);

            await translateFine('cached fine', 'en', 'zh', 'http://localhost:8080', true);
            expect(invoke).toHaveBeenCalledTimes(1);

            // Second call should use cache
            await translateFine('cached fine', 'en', 'zh', 'http://localhost:8080', true);
            expect(invoke).toHaveBeenCalledTimes(1);
        });
    });

    // ===== Remote Service Check Tests =====
    describe('Remote Service Check', () => {
        it('should return availability status', async () => {
            setMockInvokeResult('check_remote_service', true);

            const available = await checkRemoteService('http://localhost:8080');

            expect(invoke).toHaveBeenCalledWith('check_remote_service', {
                serviceUrl: 'http://localhost:8080',
            });
            expect(available).toBe(true);
        });

        it('should return false when service is unavailable', async () => {
            setMockInvokeResult('check_remote_service', false);

            const available = await checkRemoteService('http://unavailable:9999');

            expect(available).toBe(false);
        });

        it('should return false on error', async () => {
            setMockInvokeResult('check_remote_service', new Error('Network error'));

            const available = await checkRemoteService('http://error:8080');

            expect(available).toBe(false);
        });
    });
});
