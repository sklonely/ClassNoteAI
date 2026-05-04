/**
 * theme utility regression tests.
 *
 * Tiny but load-bearing: these run on app boot to wire the dark-mode
 * class onto <html>. A regression here would make every dark-mode user
 * think the app is broken on launch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTheme, getSystemTheme, watchSystemTheme } from '../theme';

beforeEach(() => {
    document.documentElement.classList.remove('dark');
});

describe('applyTheme', () => {
    it('adds the .dark class on the <html> element when theme=dark', () => {
        applyTheme('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes the .dark class when theme=light', () => {
        document.documentElement.classList.add('dark');
        applyTheme('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('is idempotent — calling dark twice leaves exactly one .dark class', () => {
        applyTheme('dark');
        applyTheme('dark');
        // classList semantics dedup automatically; assert a single occurrence.
        const classes = Array.from(document.documentElement.classList);
        expect(classes.filter((c) => c === 'dark')).toHaveLength(1);
    });

    it('switching back-and-forth ends up reflecting the LAST call', () => {
        applyTheme('dark');
        applyTheme('light');
        applyTheme('dark');
        applyTheme('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
});

describe('getSystemTheme', () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
        originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: originalMatchMedia,
        });
    });

    it('returns "dark" when the OS prefers dark', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: (query: string) => ({
                matches: query === '(prefers-color-scheme: dark)',
                media: query,
                addEventListener: () => { },
                removeEventListener: () => { },
                addListener: () => { },
                removeListener: () => { },
                dispatchEvent: () => false,
                onchange: null,
            }),
        });
        expect(getSystemTheme()).toBe('dark');
    });

    it('returns "light" when the OS prefers light', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({
                matches: false,
                media: '',
                addEventListener: () => { },
                removeEventListener: () => { },
                addListener: () => { },
                removeListener: () => { },
                dispatchEvent: () => false,
                onchange: null,
            }),
        });
        expect(getSystemTheme()).toBe('light');
    });

    it('returns "light" defensively when matchMedia is unavailable', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: undefined,
        });
        expect(getSystemTheme()).toBe('light');
    });
});

// v0.7.0 — applyTheme 接受 'system' mode 且回傳實際生效的 theme
describe('applyTheme · system mode (v0.7.0)', () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
        originalMatchMedia = window.matchMedia;
        document.documentElement.classList.remove('dark');
    });

    afterEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: originalMatchMedia,
        });
    });

    it('resolves "system" to dark when OS prefers dark', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: (query: string) => ({
                matches: query === '(prefers-color-scheme: dark)',
                media: query,
                addEventListener: () => { },
                removeEventListener: () => { },
                addListener: () => { },
                removeListener: () => { },
                dispatchEvent: () => false,
                onchange: null,
            }),
        });
        applyTheme('system');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('resolves "system" to light when OS prefers light', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({
                matches: false,
                media: '',
                addEventListener: () => { },
                removeEventListener: () => { },
                addListener: () => { },
                removeListener: () => { },
                dispatchEvent: () => false,
                onchange: null,
            }),
        });
        applyTheme('system');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('returns the effective theme that was applied', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: (query: string) => ({
                matches: query === '(prefers-color-scheme: dark)',
                media: query,
                addEventListener: () => { },
                removeEventListener: () => { },
                addListener: () => { },
                removeListener: () => { },
                dispatchEvent: () => false,
                onchange: null,
            }),
        });
        // applyTheme 回傳實際生效的 theme，方便 caller (例 useTheme hook)
        // 同步取得 effective state 不必 race condition 等 useEffect
        expect(applyTheme('dark')).toBe('dark');
        expect(applyTheme('light')).toBe('light');
        expect(applyTheme('system')).toBe('dark'); // matches above mock
    });
});

// v0.7.0 — watchSystemTheme: 訂閱系統主題變化，回 unsubscribe
describe('watchSystemTheme', () => {
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
        originalMatchMedia = window.matchMedia;
    });

    afterEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: originalMatchMedia,
        });
    });

    it('calls callback with "dark" when system change event matches dark', () => {
        let registered: ((e: MediaQueryListEvent) => void) | null = null;
        const removeEventListener = vi.fn();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({
                matches: false,
                media: '',
                addEventListener: (event: string, handler: (e: MediaQueryListEvent) => void) => {
                    if (event === 'change') registered = handler;
                },
                removeEventListener,
                addListener: () => { },
                removeListener: () => { },
                dispatchEvent: () => false,
                onchange: null,
            }),
        });

        const callback = vi.fn();
        watchSystemTheme(callback);

        // 模擬系統切到 dark
        registered!({ matches: true } as MediaQueryListEvent);
        expect(callback).toHaveBeenCalledWith('dark');

        // 切回 light
        registered!({ matches: false } as MediaQueryListEvent);
        expect(callback).toHaveBeenCalledWith('light');
    });

    it('returns an unsubscribe function that removes the listener', () => {
        const removeEventListener = vi.fn();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({
                matches: false,
                media: '',
                addEventListener: () => { },
                removeEventListener,
                addListener: () => { },
                removeListener: () => { },
                dispatchEvent: () => false,
                onchange: null,
            }),
        });

        const unsubscribe = watchSystemTheme(() => { });
        unsubscribe();
        expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('falls back to legacy addListener/removeListener for older browsers', () => {
        // Safari < 14 / 部分 Edge：MediaQueryList 沒有 addEventListener，
        // 只有 deprecated addListener / removeListener
        const addListener = vi.fn();
        const removeListener = vi.fn();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({
                matches: false,
                media: '',
                addEventListener: undefined,
                removeEventListener: undefined,
                addListener,
                removeListener,
                dispatchEvent: () => false,
                onchange: null,
            }),
        });

        const unsubscribe = watchSystemTheme(() => { });
        expect(addListener).toHaveBeenCalled();
        unsubscribe();
        expect(removeListener).toHaveBeenCalled();
    });

    it('returns no-op unsubscribe when matchMedia is unavailable', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: undefined,
        });
        const callback = vi.fn();
        const unsubscribe = watchSystemTheme(callback);
        // 不該爆炸
        expect(() => unsubscribe()).not.toThrow();
        expect(callback).not.toHaveBeenCalled();
    });
});
