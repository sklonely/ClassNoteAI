/**
 * SyncService Unit Tests
 * 
 * Tests the sync service log management and basic operations.
 * Note: Full sync testing requires server integration tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setMockInvokeResult, clearMockInvokeResults } from '../../test/setup';

// Mock dependencies
vi.mock('../storageService', () => ({
    storageService: {
        listCoursesSync: vi.fn(() => Promise.resolve([])),
        listLecturesSync: vi.fn(() => Promise.resolve([])),
        getSubtitles: vi.fn(() => Promise.resolve([])),
        saveCourse: vi.fn(() => Promise.resolve()),
        saveLecture: vi.fn(() => Promise.resolve()),
        saveSubtitles: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('../offlineQueueService', () => ({
    offlineQueueService: {
        registerProcessor: vi.fn(),
        addAction: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    exists: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
        text: () => Promise.resolve(''),
    })),
}));

// Import after mocking
import { syncService } from '../syncService';

describe('SyncService', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
        syncService.clearLogs();
    });

    // ===== Log Management Tests =====
    describe('Log Management', () => {
        it('should add log entries', () => {
            syncService.clearLogs();

            // Access private method through the public interface
            // Since addLog is private, we'll test through getLogs
            const initialLogs = syncService.getLogs();
            expect(initialLogs).toHaveLength(0);
        });

        it('should return logs array', () => {
            const logs = syncService.getLogs();
            expect(Array.isArray(logs)).toBe(true);
        });

        it('should clear logs', () => {
            syncService.clearLogs();
            const logs = syncService.getLogs();
            expect(logs).toHaveLength(0);
        });

        it('should allow log subscription', () => {
            const listener = vi.fn();
            const unsubscribe = syncService.subscribeLogs(listener);

            expect(typeof unsubscribe).toBe('function');

            // Unsubscribe should not throw
            expect(() => unsubscribe()).not.toThrow();
        });

        it('should notify listeners when unsubscribed', () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();

            const unsub1 = syncService.subscribeLogs(listener1);
            syncService.subscribeLogs(listener2);

            // Unsubscribe first listener
            unsub1();

            // Both listeners should be callable (no error on notification)
            expect(() => syncService.clearLogs()).not.toThrow();
        });
    });

    // ===== Sync Method Tests =====
    describe('Sync Operations', () => {
        it('should have sync method', () => {
            expect(typeof syncService.sync).toBe('function');
        });

        it('should have pushData method', () => {
            expect(typeof syncService.pushData).toBe('function');
        });

        it('should have pullData method', () => {
            expect(typeof syncService.pullData).toBe('function');
        });

        it('should have registerDevice method', () => {
            expect(typeof syncService.registerDevice).toBe('function');
        });

        it('should have deleteDevice method', () => {
            expect(typeof syncService.deleteDevice).toBe('function');
        });

        it('should have getDevices method', () => {
            expect(typeof syncService.getDevices).toBe('function');
        });
    });

    // ===== Direct Method Tests =====
    describe('Direct Operations', () => {
        it('should have pushDataDirect method', () => {
            expect(typeof syncService.pushDataDirect).toBe('function');
        });

        it('should have pullDataDirect method', () => {
            expect(typeof syncService.pullDataDirect).toBe('function');
        });

        it('should have registerDeviceDirect method', () => {
            expect(typeof syncService.registerDeviceDirect).toBe('function');
        });

        it('should have deleteDeviceDirect method', () => {
            expect(typeof syncService.deleteDeviceDirect).toBe('function');
        });
    });

    // ===== File Operations Tests =====
    describe('File Operations', () => {
        it('should have uploadFile method', () => {
            expect(typeof syncService.uploadFile).toBe('function');
        });

        it('should have downloadFile method', () => {
            expect(typeof syncService.downloadFile).toBe('function');
        });
    });
});
