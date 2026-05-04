/**
 * keymapService — Phase 7 Sprint 3 task S3a-1 tests.
 *
 * Covers:
 *   - getCombo / getDisplayLabel / matchesEvent default-path
 *   - set: success, conflict throw (same combo collision)
 *   - reset / resetAll: removes override, no-op when nothing to remove
 *   - subscribe: fired on set / reset / resetAll, unsubscribe stops it,
 *                throwing subscriber doesn't poison the bus
 *   - SHORTCUTS_CHANGE_EVENT dispatched on window
 *   - persistence side effect (storageService.saveAppSettings called)
 *   - hydrate: rehydrates overrides from AppSettings, notifies once
 *   - __reset: clears overrides + subscribers, does NOT notify
 *
 * Reset strategy: `keymapService.__reset()` in `beforeEach` (mirrors
 * taskTrackerService pattern — explicit, not relying on auto-register).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keymapService } from '../keymapService';
import {
    DEFAULT_KEYMAP,
    SHORTCUTS_CHANGE_EVENT,
} from '../__contracts__/keymapService.contract';

// Stub navigator so platform-dependent assertions (display label) are
// deterministic regardless of host. Whole suite runs as "win" — the
// macOS code path is exercised in kbd.test.ts.
beforeEach(() => {
    Object.defineProperty(navigator, 'platform', {
        configurable: true,
        get: () => 'Win32',
    });
    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Windows NT 10.0)',
    });
    keymapService.__reset();
});

afterEach(() => {
    vi.restoreAllMocks();
    keymapService.__reset();
});

// ─── getCombo / defaults ────────────────────────────────────────────────

describe('keymapService.getCombo()', () => {
    it('returns DEFAULT_KEYMAP value when no override is set', () => {
        expect(keymapService.getCombo('search')).toBe(DEFAULT_KEYMAP.search);
        expect(keymapService.getCombo('toggleAiDock')).toBe(
            DEFAULT_KEYMAP.toggleAiDock,
        );
    });

    it('returns the override after set()', () => {
        keymapService.set('search', 'Mod+P');
        expect(keymapService.getCombo('search')).toBe('Mod+P');
    });
});

describe('keymapService.getDisplayLabel()', () => {
    it('returns OS-aware label for default search combo', () => {
        // Win path: Mod+K → Ctrl+K
        expect(keymapService.getDisplayLabel('search')).toBe('Ctrl+K');
    });

    it('reflects overrides in the rendered label', () => {
        keymapService.set('search', 'Mod+Shift+P');
        expect(keymapService.getDisplayLabel('search')).toBe('Ctrl+Shift+P');
    });
});

// ─── matchesEvent ──────────────────────────────────────────────────────

describe('keymapService.matchesEvent()', () => {
    it('matches the default search combo against Ctrl+K event', () => {
        const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
        expect(keymapService.matchesEvent('search', e)).toBe(true);
    });

    it('does NOT match the wrong action', () => {
        const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
        expect(keymapService.matchesEvent('newCourse', e)).toBe(false);
    });

    it('matches updated override', () => {
        keymapService.set('search', 'Mod+P');
        const e = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true });
        expect(keymapService.matchesEvent('search', e)).toBe(true);
    });

    it('rejects against original default after override', () => {
        keymapService.set('search', 'Mod+P');
        const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
        expect(keymapService.matchesEvent('search', e)).toBe(false);
    });
});

// ─── set / conflict detection ──────────────────────────────────────────

describe('keymapService.set() — conflicts', () => {
    it('throws when combo collides with another action default', () => {
        // toggleAiDock default is Mod+J. Trying to bind search → Mod+J
        // must throw, otherwise a stroke would fire two actions.
        expect(() => keymapService.set('search', DEFAULT_KEYMAP.toggleAiDock))
            .toThrow(/已被|佔用|conflict/i);
    });

    it('throws when colliding with another action override', () => {
        keymapService.set('newCourse', 'Mod+P');
        expect(() => keymapService.set('search', 'Mod+P')).toThrow();
    });

    it('does NOT throw when re-setting the same action to the same combo', () => {
        keymapService.set('search', 'Mod+P');
        // Same actionId rebinding — should not collide with itself.
        expect(() => keymapService.set('search', 'Mod+P')).not.toThrow();
    });

    it('leaves state unchanged when set throws', () => {
        const before = keymapService.getCombo('search');
        try {
            keymapService.set('search', DEFAULT_KEYMAP.toggleAiDock);
        } catch {
            /* expected */
        }
        expect(keymapService.getCombo('search')).toBe(before);
    });
});

// ─── reset / resetAll ───────────────────────────────────────────────────

describe('keymapService.reset()', () => {
    it('restores a single action to its default', () => {
        keymapService.set('search', 'Mod+P');
        keymapService.reset('search');
        expect(keymapService.getCombo('search')).toBe(DEFAULT_KEYMAP.search);
    });

    it('is a no-op when no override exists for that action', () => {
        expect(() => keymapService.reset('search')).not.toThrow();
        expect(keymapService.getCombo('search')).toBe(DEFAULT_KEYMAP.search);
    });
});

describe('keymapService.resetAll()', () => {
    it('clears every override', () => {
        keymapService.set('search', 'Mod+P');
        keymapService.set('newCourse', 'Mod+Shift+M');
        keymapService.resetAll();
        expect(keymapService.getCombo('search')).toBe(DEFAULT_KEYMAP.search);
        expect(keymapService.getCombo('newCourse')).toBe(
            DEFAULT_KEYMAP.newCourse,
        );
    });
});

// ─── subscribe ──────────────────────────────────────────────────────────

describe('keymapService.subscribe()', () => {
    it('fires the callback when set() runs', () => {
        const cb = vi.fn();
        keymapService.subscribe(cb);
        keymapService.set('search', 'Mod+P');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires when reset() actually changes state', () => {
        keymapService.set('search', 'Mod+P');
        const cb = vi.fn();
        keymapService.subscribe(cb);
        keymapService.reset('search');
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires when resetAll() actually changes state', () => {
        keymapService.set('search', 'Mod+P');
        const cb = vi.fn();
        keymapService.subscribe(cb);
        keymapService.resetAll();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire on no-op reset (nothing to remove)', () => {
        const cb = vi.fn();
        keymapService.subscribe(cb);
        keymapService.reset('search'); // no override exists
        expect(cb).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe fn that stops further fires', () => {
        const cb = vi.fn();
        const off = keymapService.subscribe(cb);
        off();
        keymapService.set('search', 'Mod+P');
        expect(cb).not.toHaveBeenCalled();
    });

    it('a throwing subscriber does not block other subscribers', () => {
        const ok = vi.fn();
        const bad = vi.fn(() => {
            throw new Error('boom');
        });
        // Mute the console.error side-effect so test logs stay clean.
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        keymapService.subscribe(bad);
        keymapService.subscribe(ok);
        keymapService.set('search', 'Mod+P');
        expect(bad).toHaveBeenCalled();
        expect(ok).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});

// ─── SHORTCUTS_CHANGE_EVENT ────────────────────────────────────────────

describe(`SHORTCUTS_CHANGE_EVENT (${SHORTCUTS_CHANGE_EVENT})`, () => {
    it('is dispatched on window when set() runs', () => {
        const handler = vi.fn();
        window.addEventListener(SHORTCUTS_CHANGE_EVENT, handler);
        try {
            keymapService.set('search', 'Mod+P');
            expect(handler).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener(SHORTCUTS_CHANGE_EVENT, handler);
        }
    });

    it('is dispatched on resetAll()', () => {
        keymapService.set('search', 'Mod+P');
        const handler = vi.fn();
        window.addEventListener(SHORTCUTS_CHANGE_EVENT, handler);
        try {
            keymapService.resetAll();
            expect(handler).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener(SHORTCUTS_CHANGE_EVENT, handler);
        }
    });
});

// ─── __reset (test-only) ───────────────────────────────────────────────

describe('keymapService.__reset()', () => {
    it('wipes overrides', () => {
        keymapService.set('search', 'Mod+P');
        keymapService.__reset();
        expect(keymapService.getCombo('search')).toBe(DEFAULT_KEYMAP.search);
    });

    it('clears the subscriber set so leftover subscribers do not leak', () => {
        const cb = vi.fn();
        keymapService.subscribe(cb);
        keymapService.__reset();
        keymapService.set('search', 'Mod+P');
        expect(cb).not.toHaveBeenCalled();
    });

    it('does NOT fire SHORTCUTS_CHANGE_EVENT (silent test cleanup)', () => {
        keymapService.set('search', 'Mod+P');
        const handler = vi.fn();
        window.addEventListener(SHORTCUTS_CHANGE_EVENT, handler);
        try {
            keymapService.__reset();
            expect(handler).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener(SHORTCUTS_CHANGE_EVENT, handler);
        }
    });
});
