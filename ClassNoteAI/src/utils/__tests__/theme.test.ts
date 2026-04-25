/**
 * theme utility regression tests.
 *
 * Tiny but load-bearing: these run on app boot to wire the dark-mode
 * class onto <html>. A regression here would make every dark-mode user
 * think the app is broken on launch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyTheme, getSystemTheme } from '../theme';

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
