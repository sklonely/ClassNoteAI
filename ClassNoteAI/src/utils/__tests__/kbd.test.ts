/**
 * kbd helper tests — Phase 7 Sprint 3 task S3a-1.
 *
 * Covers detectOS / parseCombo / formatComboLabel / comboFromEvent /
 * matchesEvent across mac + win + linux. Modifier-key resolution is the
 * load-bearing bit: a regression here would cause every shortcut in the
 * app to silently stop firing on someone's machine.
 *
 * `detectOS` reads `navigator`. We stub it per-test instead of mocking
 * the module so the rest of the helpers get the real platform-detect
 * code path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    comboFromEvent,
    detectOS,
    formatComboLabel,
    matchesEvent,
    parseCombo,
} from '../kbd';

/** Patch navigator.platform / userAgent for the duration of one test. */
function stubNavigator(platform: string, ua = ''): () => void {
    const orig = {
        platform: Object.getOwnPropertyDescriptor(navigator, 'platform'),
        userAgent: Object.getOwnPropertyDescriptor(navigator, 'userAgent'),
    };
    Object.defineProperty(navigator, 'platform', {
        configurable: true,
        get: () => platform,
    });
    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => ua,
    });
    return () => {
        if (orig.platform) Object.defineProperty(navigator, 'platform', orig.platform);
        if (orig.userAgent) Object.defineProperty(navigator, 'userAgent', orig.userAgent);
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ─── detectOS ───────────────────────────────────────────────────────────

describe('detectOS', () => {
    it('returns "mac" when navigator.platform contains MacIntel', () => {
        const restore = stubNavigator('MacIntel');
        try {
            expect(detectOS()).toBe('mac');
        } finally {
            restore();
        }
    });

    it('returns "mac" when userAgent contains "Mac OS X" even if platform is empty', () => {
        const restore = stubNavigator('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
        try {
            expect(detectOS()).toBe('mac');
        } finally {
            restore();
        }
    });

    it('returns "linux" when navigator.platform contains Linux', () => {
        const restore = stubNavigator('Linux x86_64');
        try {
            expect(detectOS()).toBe('linux');
        } finally {
            restore();
        }
    });

    it('returns "win" when navigator.platform contains Win32', () => {
        const restore = stubNavigator('Win32');
        try {
            expect(detectOS()).toBe('win');
        } finally {
            restore();
        }
    });

    it('falls back to "win" for unknown platforms', () => {
        const restore = stubNavigator('FreeBSD amd64');
        try {
            expect(detectOS()).toBe('win');
        } finally {
            restore();
        }
    });
});

// ─── parseCombo ─────────────────────────────────────────────────────────

describe('parseCombo', () => {
    it('parses Mod+K — sets mod, key=k', () => {
        const p = parseCombo('Mod+K');
        expect(p).toEqual({ mod: true, ctrl: false, shift: false, alt: false, key: 'k' });
    });

    it('parses Mod+Shift+N — multiple modifiers', () => {
        const p = parseCombo('Mod+Shift+N');
        expect(p).toEqual({ mod: true, ctrl: false, shift: true, alt: false, key: 'n' });
    });

    it('parses Mod+Comma to key ","', () => {
        expect(parseCombo('Mod+Comma').key).toBe(',');
    });

    it('parses Mod+Backslash to key "\\"', () => {
        expect(parseCombo('Mod+Backslash').key).toBe('\\');
    });

    it('is case-insensitive on modifiers (mod+shift+k)', () => {
        const p = parseCombo('mod+shift+k');
        expect(p.mod).toBe(true);
        expect(p.shift).toBe(true);
        expect(p.key).toBe('k');
    });

    it('treats "Control" as ctrl', () => {
        const p = parseCombo('Mod+Control+K');
        expect(p.mod).toBe(true);
        expect(p.ctrl).toBe(true);
    });

    it('treats "Option" as alt', () => {
        expect(parseCombo('Option+K').alt).toBe(true);
    });

    it('treats raw "Meta" / "Cmd" / "Command" as Mod (defensive)', () => {
        expect(parseCombo('Meta+K').mod).toBe(true);
        expect(parseCombo('Cmd+K').mod).toBe(true);
        expect(parseCombo('Command+K').mod).toBe(true);
    });

    it('tolerates whitespace around tokens', () => {
        const p = parseCombo(' Mod + Shift + K ');
        expect(p.mod).toBe(true);
        expect(p.shift).toBe(true);
        expect(p.key).toBe('k');
    });

    it('keeps multi-character key tokens lowercase ("ArrowUp" → "arrowup")', () => {
        expect(parseCombo('Mod+ArrowUp').key).toBe('arrowup');
    });
});

// ─── formatComboLabel ───────────────────────────────────────────────────

describe('formatComboLabel — macOS', () => {
    it('renders Mod+K as ⌘K', () => {
        expect(formatComboLabel('Mod+K', 'mac')).toBe('⌘K');
    });

    it('renders Mod+Shift+N as ⇧⌘N (Apple HIG order: Shift before Cmd)', () => {
        expect(formatComboLabel('Mod+Shift+N', 'mac')).toBe('⇧⌘N');
    });

    it('renders Mod+Comma as ⌘,', () => {
        expect(formatComboLabel('Mod+Comma', 'mac')).toBe('⌘,');
    });

    it('renders Mod+Backslash as ⌘\\', () => {
        expect(formatComboLabel('Mod+Backslash', 'mac')).toBe('⌘\\');
    });

    it('renders Mod+Ctrl+K as ⌃⌘K (separate ⌃ and ⌘ glyphs)', () => {
        expect(formatComboLabel('Mod+Ctrl+K', 'mac')).toBe('⌃⌘K');
    });

    it('renders multi-char keys title-cased (Mod+ArrowUp → ⌘Arrowup)', () => {
        // Title-case is good enough — PKeyboard renders these in a chip,
        // not in body text, so casing is purely cosmetic.
        const out = formatComboLabel('Mod+ArrowUp', 'mac');
        expect(out.startsWith('⌘')).toBe(true);
        expect(out).toContain('Arrow');
    });
});

describe('formatComboLabel — win / linux', () => {
    it('renders Mod+K as Ctrl+K on win', () => {
        expect(formatComboLabel('Mod+K', 'win')).toBe('Ctrl+K');
    });

    it('renders Mod+Shift+N as Ctrl+Shift+N on win', () => {
        expect(formatComboLabel('Mod+Shift+N', 'win')).toBe('Ctrl+Shift+N');
    });

    it('renders Mod+Comma as Ctrl+, on linux', () => {
        expect(formatComboLabel('Mod+Comma', 'linux')).toBe('Ctrl+,');
    });
});

// ─── comboFromEvent ─────────────────────────────────────────────────────

describe('comboFromEvent', () => {
    it('emits Mod+K on mac for ⌘+k event', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
            expect(comboFromEvent(e)).toBe('Mod+K');
        } finally {
            restore();
        }
    });

    it('emits Mod+K on win for Ctrl+k event', () => {
        const restore = stubNavigator('Win32');
        try {
            const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
            expect(comboFromEvent(e)).toBe('Mod+K');
        } finally {
            restore();
        }
    });

    it('emits Mod+Comma for ⌘+, event on mac', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', { key: ',', metaKey: true });
            expect(comboFromEvent(e)).toBe('Mod+Comma');
        } finally {
            restore();
        }
    });

    it('emits Mod+Backslash for Ctrl+\\ event on win', () => {
        const restore = stubNavigator('Win32');
        try {
            const e = new KeyboardEvent('keydown', { key: '\\', ctrlKey: true });
            expect(comboFromEvent(e)).toBe('Mod+Backslash');
        } finally {
            restore();
        }
    });

    it('emits Mod+Shift+N for ⌘+Shift+n on mac', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', {
                key: 'n',
                metaKey: true,
                shiftKey: true,
            });
            expect(comboFromEvent(e)).toBe('Mod+Shift+N');
        } finally {
            restore();
        }
    });

    it('on mac emits Mod+Ctrl+K when both ⌘ and ⌃ are held', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', {
                key: 'k',
                metaKey: true,
                ctrlKey: true,
            });
            expect(comboFromEvent(e)).toBe('Mod+Ctrl+K');
        } finally {
            restore();
        }
    });
});

// ─── matchesEvent ───────────────────────────────────────────────────────

describe('matchesEvent — macOS', () => {
    it('matches Mod+K against ⌘+k event', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
            expect(matchesEvent('Mod+K', e)).toBe(true);
        } finally {
            restore();
        }
    });

    it('does NOT match Mod+K against Ctrl+k on mac (Ctrl ≠ Mod on mac)', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
            expect(matchesEvent('Mod+K', e)).toBe(false);
        } finally {
            restore();
        }
    });

    it('matches Mod+Shift+N against ⌘+Shift+n event', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', {
                key: 'n',
                metaKey: true,
                shiftKey: true,
            });
            expect(matchesEvent('Mod+Shift+N', e)).toBe(true);
        } finally {
            restore();
        }
    });

    it('matches Mod+Comma against ⌘+, event', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', { key: ',', metaKey: true });
            expect(matchesEvent('Mod+Comma', e)).toBe(true);
        } finally {
            restore();
        }
    });

    it('rejects when shift state differs', () => {
        const restore = stubNavigator('MacIntel');
        try {
            const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
            expect(matchesEvent('Mod+Shift+K', e)).toBe(false);
        } finally {
            restore();
        }
    });
});

describe('matchesEvent — win / linux', () => {
    it('matches Mod+K against Ctrl+k on win', () => {
        const restore = stubNavigator('Win32');
        try {
            const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
            expect(matchesEvent('Mod+K', e)).toBe(true);
        } finally {
            restore();
        }
    });

    it('does NOT match Mod+K against ⌘+k on win (no metaKey path)', () => {
        const restore = stubNavigator('Win32');
        try {
            const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
            expect(matchesEvent('Mod+K', e)).toBe(false);
        } finally {
            restore();
        }
    });

    it('matches case-insensitively (Mod+K vs uppercase K event)', () => {
        const restore = stubNavigator('Win32');
        try {
            const e = new KeyboardEvent('keydown', { key: 'K', ctrlKey: true });
            expect(matchesEvent('Mod+K', e)).toBe(true);
        } finally {
            restore();
        }
    });

    it('returns false for empty/keyless combo strings', () => {
        const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
        expect(matchesEvent('Mod', e)).toBe(false);
    });
});
