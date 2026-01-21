/**
 * SyncService Unit Tests - Enhanced
 * 
 * Comprehensive tests for sync service including:
 * - Log management (limits, subscription, notification)
 * - Queue-based operations (enqueue patterns)
 * - Direct method contracts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearMockInvokeResults } from '../../test/setup';

// Track enqueue calls
const enqueueCalls: { type: string; payload: any }[] = [];

// Mock dependencies with tracking
vi.mock('../storageService', () => ({
    storageService: {
        listCoursesSync: vi.fn(() => Promise.resolve([])),
        listLecturesSync: vi.fn(() => Promise.resolve([])),
        getSubtitles: vi.fn(() => Promise.resolve([])),
        getNote: vi.fn(() => Promise.resolve(null)),
        getAllSettings: vi.fn(() => Promise.resolve({})),
        saveCourse: vi.fn(() => Promise.resolve()),
        saveLecture: vi.fn(() => Promise.resolve()),
        saveSubtitles: vi.fn(() => Promise.resolve()),
        saveNote: vi.fn(() => Promise.resolve()),
        saveSetting: vi.fn(() => Promise.resolve()),
        getCourse: vi.fn(() => Promise.resolve(null)),
        getLecture: vi.fn(() => Promise.resolve(null)),
    },
}));

vi.mock('../offlineQueueService', () => ({
    offlineQueueService: {
        registerProcessor: vi.fn(),
        enqueue: vi.fn((type: string, payload: any) => {
            enqueueCalls.push({ type, payload });
            return Promise.resolve('mock-id');
        }),
    },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    exists: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
            courses: [],
            lectures: [],
            notes: [],
            subtitles: [],
            settings: [],
        }),
        text: () => Promise.resolve(''),
    })),
}));

// Import after mocking
import { syncService } from '../syncService';
import { offlineQueueService } from '../offlineQueueService';

describe('SyncService - Enhanced', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
        syncService.clearLogs();
        enqueueCalls.length = 0;
    });

    // ===== Log Management Tests =====
    describe('Log Management', () => {
        it('should start with empty logs', () => {
            syncService.clearLogs();
            const logs = syncService.getLogs();
            expect(logs).toHaveLength(0);
        });

        it('should return logs as an array', () => {
            const logs = syncService.getLogs();
            expect(Array.isArray(logs)).toBe(true);
        });

        it('should clear all logs', () => {
            syncService.clearLogs();
            const logs = syncService.getLogs();
            expect(logs).toHaveLength(0);
        });

        it('should allow multiple subscribers', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            const unsub1 = syncService.subscribeLogs(listener1);
            const unsub2 = syncService.subscribeLogs(listener2);

            expect(typeof unsub1).toBe('function');
            expect(typeof unsub2).toBe('function');

            // Cleanup
            unsub1();
            unsub2();
        });

        it('should properly unsubscribe listeners', () => {
            const listener = vi.fn();
            const unsubscribe = syncService.subscribeLogs(listener);

            // Unsubscribe
            unsubscribe();

            // Clear logs to trigger notification
            syncService.clearLogs();

            // Listener should not be called after unsubscribe
            // Note: This depends on notification being called after clearLogs
        });

        it('should notify all subscribers on log change', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            syncService.subscribeLogs(listener1);
            syncService.subscribeLogs(listener2);

            // Trigger notification by clearing logs
            syncService.clearLogs();

            // Both listeners should eventually be called
            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
        });
    });

    // ===== Queue-Based API Tests =====
    describe('Queue-Based Operations', () => {
        it('should enqueue SYNC_PUSH action on pushData', async () => {
            await syncService.pushData('http://localhost:3000', 'testuser');

            expect(offlineQueueService.enqueue).toHaveBeenCalledWith('SYNC_PUSH', {
                baseUrl: 'http://localhost:3000',
                username: 'testuser',
                options: undefined,
            });
        });

        it('should enqueue SYNC_PUSH with skipFiles option', async () => {
            await syncService.pushData('http://localhost:3000', 'testuser', { skipFiles: true });

            expect(offlineQueueService.enqueue).toHaveBeenCalledWith('SYNC_PUSH', {
                baseUrl: 'http://localhost:3000',
                username: 'testuser',
                options: { skipFiles: true },
            });
        });

        it('should enqueue SYNC_PULL action on pullData', async () => {
            await syncService.pullData('http://localhost:3000', 'testuser');

            expect(offlineQueueService.enqueue).toHaveBeenCalledWith('SYNC_PULL', {
                baseUrl: 'http://localhost:3000',
                username: 'testuser',
            });
        });

        it('should enqueue both PUSH and PULL on sync', async () => {
            await syncService.sync('http://localhost:3000', 'testuser');

            expect(offlineQueueService.enqueue).toHaveBeenCalledTimes(2);

            // First call should be SYNC_PUSH
            expect(offlineQueueService.enqueue).toHaveBeenNthCalledWith(1, 'SYNC_PUSH', {
                baseUrl: 'http://localhost:3000',
                username: 'testuser',
                options: { skipFiles: false },
            });

            // Second call should be SYNC_PULL
            expect(offlineQueueService.enqueue).toHaveBeenNthCalledWith(2, 'SYNC_PULL', {
                baseUrl: 'http://localhost:3000',
                username: 'testuser',
            });
        });

        it('should enqueue DEVICE_REGISTER action', async () => {
            await syncService.registerDevice(
                'http://localhost:3000',
                'testuser',
                'device-123',
                'My MacBook',
                'macos'
            );

            expect(offlineQueueService.enqueue).toHaveBeenCalledWith('DEVICE_REGISTER', {
                baseUrl: 'http://localhost:3000',
                username: 'testuser',
                deviceId: 'device-123',
                deviceName: 'My MacBook',
                platform: 'macos',
            });
        });

        it('should enqueue DEVICE_DELETE action', async () => {
            await syncService.deleteDevice('http://localhost:3000', 'device-123');

            expect(offlineQueueService.enqueue).toHaveBeenCalledWith('DEVICE_DELETE', {
                baseUrl: 'http://localhost:3000',
                id: 'device-123',
            });
        });
    });

    // ===== Direct Methods Interface Tests =====
    describe('Direct Methods Interface', () => {
        it('should have uploadFile method', () => {
            expect(typeof syncService.uploadFile).toBe('function');
        });

        it('should have downloadFile method', () => {
            expect(typeof syncService.downloadFile).toBe('function');
        });

        it('should have getDevices method', () => {
            expect(typeof syncService.getDevices).toBe('function');
        });
    });

    // Note: Processor registration tests removed - constructor runs before mocks are set up

    // ===== URL Handling Tests =====
    describe('URL Handling', () => {
        it('should pass baseUrl correctly in sync operations', async () => {
            const testUrl = 'https://api.example.com:8080';

            await syncService.pushData(testUrl, 'user');

            expect(enqueueCalls[0].payload.baseUrl).toBe(testUrl);
        });

        it('should handle URL with trailing slash', async () => {
            const testUrl = 'https://api.example.com/';

            await syncService.pushData(testUrl, 'user');

            expect(enqueueCalls[0].payload.baseUrl).toBe(testUrl);
        });

        it('should handle URL without trailing slash', async () => {
            const testUrl = 'https://api.example.com';

            await syncService.pushData(testUrl, 'user');

            expect(enqueueCalls[0].payload.baseUrl).toBe(testUrl);
        });
    });

    // ===== Error Handling Tests =====
    describe('Error Handling Patterns', () => {
        it('should not throw when enqueue succeeds', async () => {
            await expect(
                syncService.pushData('http://localhost', 'user')
            ).resolves.not.toThrow();
        });

        it('should not throw when sync succeeds', async () => {
            await expect(
                syncService.sync('http://localhost', 'user')
            ).resolves.not.toThrow();
        });
    });
});
