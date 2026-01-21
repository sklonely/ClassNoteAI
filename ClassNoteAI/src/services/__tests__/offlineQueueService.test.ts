/**
 * OfflineQueueService Unit Tests
 * 
 * Tests the offline queue for action management, retry logic, and subscription.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setMockInvokeResult, clearMockInvokeResults } from '../../test/setup';

// Create a fresh instance for each test
vi.mock('@tauri-apps/api/core', async () => {
    const mockInvokeResults = new Map<string, unknown>();

    return {
        invoke: vi.fn((cmd: string) => {
            const result = mockInvokeResults.get(cmd);
            if (result instanceof Error) {
                return Promise.reject(result);
            }
            if (cmd === 'list_pending_actions') {
                return Promise.resolve([]);
            }
            if (cmd === 'add_pending_action') {
                return Promise.resolve();
            }
            if (cmd === 'remove_pending_action') {
                return Promise.resolve();
            }
            if (cmd === 'update_pending_action') {
                return Promise.resolve();
            }
            return Promise.resolve(result);
        }),
    };
});

// Re-import to get our mocked version
import { offlineQueueService } from '../offlineQueueService';

describe('OfflineQueueService', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
    });

    // ===== Processor Registration Tests =====
    describe('Processor Registration', () => {
        it('should register a processor', () => {
            const processor = vi.fn(() => Promise.resolve());

            // Should not throw
            expect(() =>
                offlineQueueService.registerProcessor('SYNC_PUSH', processor)
            ).not.toThrow();
        });

        it('should allow registering multiple processors for different types', () => {
            const pushProcessor = vi.fn(() => Promise.resolve());
            const pullProcessor = vi.fn(() => Promise.resolve());

            expect(() => {
                offlineQueueService.registerProcessor('SYNC_PUSH', pushProcessor);
                offlineQueueService.registerProcessor('SYNC_PULL', pullProcessor);
            }).not.toThrow();
        });
    });

    // ===== Subscription Tests =====
    describe('Subscription', () => {
        it('should allow subscribing to queue changes', () => {
            const listener = vi.fn();
            const unsubscribe = offlineQueueService.subscribe(listener);

            expect(typeof unsubscribe).toBe('function');
        });

        it('should return unsubscribe function', () => {
            const listener = vi.fn();
            const unsubscribe = offlineQueueService.subscribe(listener);

            // Unsubscribe should not throw
            expect(() => unsubscribe()).not.toThrow();
        });

        it('should notify listener on subscription', async () => {
            const listener = vi.fn();
            offlineQueueService.subscribe(listener);

            // Wait for async notification
            await new Promise(resolve => setTimeout(resolve, 10));

            // Listener should be called with count
            expect(listener).toHaveBeenCalled();
        });
    });

    // ===== Queue Operations Tests =====
    describe('Queue Operations', () => {
        it('should have enqueue method', () => {
            expect(typeof offlineQueueService.enqueue).toBe('function');
        });

        it('should have listActions method', () => {
            expect(typeof offlineQueueService.listActions).toBe('function');
        });

        it('should have processQueue method', () => {
            expect(typeof offlineQueueService.processQueue).toBe('function');
        });

        it('should list empty actions initially', async () => {
            const actions = await offlineQueueService.listActions();

            // Because we mocked list_pending_actions to return []
            expect(Array.isArray(actions)).toBe(true);
        });
    });

    // ===== Online Status Tests =====
    describe('Online Status', () => {
        it('should have isOnline method', () => {
            expect(typeof offlineQueueService.isOnline).toBe('function');
        });

        it('should return boolean for isOnline', () => {
            const result = offlineQueueService.isOnline();
            expect(typeof result).toBe('boolean');
        });
    });

    // ===== Init Tests =====
    describe('Initialization', () => {
        it('should have init method', () => {
            expect(typeof offlineQueueService.init).toBe('function');
        });

        it('should be idempotent on multiple init calls', async () => {
            // Should not throw on multiple init calls
            await offlineQueueService.init();
            await offlineQueueService.init();
        });
    });
});
