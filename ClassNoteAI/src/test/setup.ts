/**
 * Vitest Test Setup
 * 
 * This file runs before each test file.
 * Sets up global mocks for Tauri APIs and testing-library matchers.
 */

import '@testing-library/jest-dom/vitest';
import { vi, beforeEach } from 'vitest';

// Mock Tauri's invoke function
const mockInvokeResults: Record<string, unknown> = {};

export function setMockInvokeResult(command: string, result: unknown) {
    mockInvokeResults[command] = result;
}

export function clearMockInvokeResults() {
    Object.keys(mockInvokeResults).forEach(key => delete mockInvokeResults[key]);
}

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn((command: string, _args?: unknown) => {
        if (command in mockInvokeResults) {
            const result = mockInvokeResults[command];
            if (result instanceof Error) {
                return Promise.reject(result);
            }
            return Promise.resolve(result);
        }
        // Default: return empty/success response
        return Promise.resolve(null);
    }),
}));

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => { })),
    emit: vi.fn(() => Promise.resolve()),
    once: vi.fn(() => Promise.resolve(() => { })),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(() => Promise.resolve(null)),
    save: vi.fn(() => Promise.resolve(null)),
    message: vi.fn(() => Promise.resolve()),
    ask: vi.fn(() => Promise.resolve(true)),
    confirm: vi.fn(() => Promise.resolve(true)),
}));

// Mock @tauri-apps/plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
    readTextFile: vi.fn(() => Promise.resolve('')),
    writeTextFile: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
    writeFile: vi.fn(() => Promise.resolve()),
    exists: vi.fn(() => Promise.resolve(false)),
    mkdir: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    readDir: vi.fn(() => Promise.resolve([])),
    BaseDirectory: {
        AppData: 'AppData',
        AppConfig: 'AppConfig',
        Document: 'Document',
        Download: 'Download',
        Home: 'Home',
        Temp: 'Temp',
    },
}));

// Mock @tauri-apps/plugin-http
vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
    })),
}));

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();

Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
});

// Reset mocks before each test
beforeEach(() => {
    vi.clearAllMocks();
    clearMockInvokeResults();
    localStorageMock.clear();
});
