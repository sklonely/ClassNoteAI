/**
 * Vitest Test Setup
 * 
 * This file runs before each test file.
 * Sets up global mocks for Tauri APIs and testing-library matchers.
 */

import '@testing-library/jest-dom/vitest';
import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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

// Mock @tauri-apps/api/webview + window — components that use
// useTauriFileDrop (DragDropZone) reach for getCurrentWebview() at mount,
// which crashes in jsdom because Tauri's runtime metadata isn't there.
vi.mock('@tauri-apps/api/webview', () => ({
    getCurrentWebview: vi.fn(() => ({
        onDragDropEvent: vi.fn(() => Promise.resolve(() => { })),
    })),
}));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: vi.fn(() => ({
        label: 'main',
        onCloseRequested: vi.fn(() => Promise.resolve(() => { })),
        onResized: vi.fn(() => Promise.resolve(() => { })),
        onFocusChanged: vi.fn(() => Promise.resolve(() => { })),
    })),
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

// Mock @tauri-apps/plugin-opener
vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve()),
    revealItemInDir: vi.fn(() => Promise.resolve()),
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

// jsdom doesn't implement Element.scrollIntoView. Components that auto-
// scroll on update (chat panels, log viewers) crash on mount under test
// without this stub. Cheap to install once globally; per-test overrides
// can still spy on it via `vi.spyOn(Element.prototype, 'scrollIntoView')`.
const elementPrototype = globalThis.Element?.prototype;
if (elementPrototype && typeof elementPrototype.scrollIntoView !== 'function') {
    elementPrototype.scrollIntoView = vi.fn();
}

// S0.13 · MockMediaStreamTrack + MediaDevices jsdom mock
// jsdom doesn't implement MediaStream / MediaStreamTrack / navigator.mediaDevices.
// Provide a minimal mock so recording-pipeline code can mount under test without
// crashing. Tests can `import { MockMediaStreamTrack } from '@/test/setup'` to
// build their own fixtures.
export class MockMediaStreamTrack {
    kind: 'audio' | 'video' = 'audio';
    readyState: 'live' | 'ended' = 'live';
    enabled = true;
    label = 'mock-track';
    private listeners = new Map<string, Set<(e: Event) => void>>();
    addEventListener(type: string, cb: (e: Event) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
    }
    removeEventListener(type: string, cb: (e: Event) => void) {
        this.listeners.get(type)?.delete(cb);
    }
    dispatchEvent(event: Event) {
        this.listeners.get(event.type)?.forEach(cb => cb(event));
        return true;
    }
    stop() {
        this.readyState = 'ended';
        this.dispatchEvent(new Event('ended'));
    }
    onended: ((e: Event) => void) | null = null;
}

// Stub the global MediaStreamTrack constructor so `instanceof` checks and
// `new MediaStreamTrack()` calls in production code work under jsdom.
(globalThis as unknown as { MediaStreamTrack: typeof MockMediaStreamTrack }).MediaStreamTrack =
    MockMediaStreamTrack;

// Stub navigator.mediaDevices minimal — just enough for getUserMedia() callers
// to not throw at mount. Per-test overrides can re-`vi.mock` this.
if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            getUserMedia: vi.fn(() =>
                Promise.resolve({
                    getTracks: () => [new MockMediaStreamTrack()],
                })
            ),
        },
    });
}

// S0.14 · Singleton beforeEach reset 自動化
// Service modules can register a reset callback at module-load time so each
// test starts from a clean singleton state. The Sprint 1 services will call
// `registerSingletonReset(this.reset.bind(this))` from their module file.
const __resetCallbacks: Set<() => void> = new Set();

export function registerSingletonReset(cb: () => void) {
    __resetCallbacks.add(cb);
}

// Reset mocks before each test
beforeEach(() => {
    vi.clearAllMocks();
    clearMockInvokeResults();
    localStorageMock.clear();
    __resetCallbacks.forEach(cb => cb());
});

// S0.1 · React Testing Library cleanup after each test
// React 18 Strict Mode double-mounts components and RTL no longer auto-cleans
// up between tests in vitest. Without this, listeners + DOM nodes leak across
// tests, surfacing as flaky "found multiple elements" errors.
afterEach(() => {
    cleanup();
});
