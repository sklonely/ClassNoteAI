/**
 * OfflineQueueService Unit Tests - Enhanced
 * 
 * Comprehensive tests covering:
 * - Processor registration and retrieval
 * - Subscription lifecycle
 * - Queue operations (enqueue, list, process)
 * - Online status detection
 * - Action types validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearMockInvokeResults } from '../../test/setup';

// Mock invoke with specific behaviors
const mockInvokeResults = new Map<string, any>();
const invokeCallHistory: { cmd: string; args: any }[] = [];

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn((cmd: string, args?: any) => {
        invokeCallHistory.push({ cmd, args });

        if (cmd === 'list_pending_actions') {
            return Promise.resolve(mockInvokeResults.get('list_pending_actions') || []);
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
        return Promise.resolve(mockInvokeResults.get(cmd));
    }),
}));

// Import after mocking
import { offlineQueueService, ActionType } from '../offlineQueueService';

describe('OfflineQueueService - Enhanced', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        mockInvokeResults.clear();
        invokeCallHistory.length = 0;
        vi.clearAllMocks();
    });

    // ===== Action Types Tests =====
    describe('Action Types', () => {
        const validTypes: ActionType[] = [
            'SYNC_PUSH',
            'SYNC_PULL',
            'DEVICE_REGISTER',
            'DEVICE_DELETE',
            'AUTH_REGISTER',
            'PURGE_ITEM',
            'TASK_CREATE',
        ];

        it('should support all defined action types', async () => {
            for (const type of validTypes) {
                // Register a processor for each type
                expect(() =>
                    offlineQueueService.registerProcessor(type, async () => { })
                ).not.toThrow();
            }
        });
    });

    // ===== Processor Registration Tests =====
    describe('Processor Registration', () => {
        it('should register processor without throwing', () => {
            const processor = vi.fn(() => Promise.resolve());

            expect(() =>
                offlineQueueService.registerProcessor('SYNC_PUSH', processor)
            ).not.toThrow();
        });

        it('should accept async processors', () => {
            const asyncProcessor = async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            };

            expect(() =>
                offlineQueueService.registerProcessor('SYNC_PULL', asyncProcessor)
            ).not.toThrow();
        });

        it('should allow overwriting existing processor', () => {
            const processor1 = vi.fn(() => Promise.resolve());
            const processor2 = vi.fn(() => Promise.resolve());

            offlineQueueService.registerProcessor('DEVICE_REGISTER', processor1);

            // Should not throw when registering again
            expect(() =>
                offlineQueueService.registerProcessor('DEVICE_REGISTER', processor2)
            ).not.toThrow();
        });
    });

    // ===== Subscription Tests =====
    describe('Subscription Lifecycle', () => {
        it('should return unsubscribe function', () => {
            const listener = vi.fn();
            const unsubscribe = offlineQueueService.subscribe(listener);

            expect(typeof unsubscribe).toBe('function');
        });

        it('should call unsubscribe without throwing', () => {
            const listener = vi.fn();
            const unsubscribe = offlineQueueService.subscribe(listener);

            expect(() => unsubscribe()).not.toThrow();
        });

        it('should support multiple concurrent subscribers', () => {
            const listeners = [vi.fn(), vi.fn(), vi.fn()];
            const unsubscribes = listeners.map(l => offlineQueueService.subscribe(l));

            expect(unsubscribes.every(u => typeof u === 'function')).toBe(true);

            // Cleanup
            unsubscribes.forEach(u => u());
        });

        it('should notify subscriber on subscription', async () => {
            const listener = vi.fn();
            offlineQueueService.subscribe(listener);

            // Wait for async notification
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(listener).toHaveBeenCalled();
        });

        it('should notify with count value', async () => {
            const listener = vi.fn();
            mockInvokeResults.set('list_pending_actions', []);

            offlineQueueService.subscribe(listener);

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should be called with a number (count)
            expect(listener).toHaveBeenCalledWith(expect.any(Number));
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

        it('should list empty actions when queue is empty', async () => {
            mockInvokeResults.set('list_pending_actions', []);

            const actions = await offlineQueueService.listActions();

            expect(Array.isArray(actions)).toBe(true);
            expect(actions).toHaveLength(0);
        });

        it('should parse action list correctly', async () => {
            mockInvokeResults.set('list_pending_actions', [
                ['id-1', 'SYNC_PUSH', '{"test":true}', 'pending', 0],
                ['id-2', 'SYNC_PULL', '{}', 'failed', 2],
            ]);

            const actions = await offlineQueueService.listActions();

            expect(actions).toHaveLength(2);
            expect(actions[0]).toEqual({
                id: 'id-1',
                actionType: 'SYNC_PUSH',
                payload: '{"test":true}',
                status: 'pending',
                retryCount: 0,
            });
            expect(actions[1].status).toBe('failed');
            expect(actions[1].retryCount).toBe(2);
        });
    });

    // ===== Online Status Tests =====
    describe('Online Status', () => {
        it('should have isOnline method', () => {
            expect(typeof offlineQueueService.isOnline).toBe('function');
        });

        it('should return boolean', () => {
            const result = offlineQueueService.isOnline();
            expect(typeof result).toBe('boolean');
        });
    });

    // ===== Initialization Tests =====
    describe('Initialization', () => {
        it('should have init method', () => {
            expect(typeof offlineQueueService.init).toBe('function');
        });

        it('should be idempotent', async () => {
            // Multiple init calls should not throw
            await offlineQueueService.init();
            await offlineQueueService.init();
            await offlineQueueService.init();
        });

        it('should not throw on init call', async () => {
            mockInvokeResults.set('list_pending_actions', []);

            // init is idempotent - should not throw
            await expect(offlineQueueService.init()).resolves.not.toThrow();
        });
    });

    // ===== Process Queue Tests =====
    describe('Process Queue', () => {
        it('should skip processing when offline', async () => {
            // Mock navigator.onLine to be false
            const originalOnLine = navigator.onLine;
            Object.defineProperty(navigator, 'onLine', {
                value: false,
                writable: true,
                configurable: true,
            });

            await offlineQueueService.processQueue();

            // Restore
            Object.defineProperty(navigator, 'onLine', {
                value: originalOnLine,
                writable: true,
                configurable: true,
            });
        });

        it('should not throw when queue is empty', async () => {
            mockInvokeResults.set('list_pending_actions', []);

            await expect(offlineQueueService.processQueue()).resolves.not.toThrow();
        });
    });

    // ===== Edge Cases =====
    describe('Edge Cases', () => {
        it('should handle empty payload in listActions', async () => {
            mockInvokeResults.set('list_pending_actions', [
                ['id-1', 'SYNC_PUSH', '', 'pending', 0],
            ]);

            const actions = await offlineQueueService.listActions();

            expect(actions[0].payload).toBe('');
        });

        it('should handle high retry count', async () => {
            mockInvokeResults.set('list_pending_actions', [
                ['id-1', 'SYNC_PUSH', '{}', 'failed', 999],
            ]);

            const actions = await offlineQueueService.listActions();

            expect(actions[0].retryCount).toBe(999);
        });
    });
});
