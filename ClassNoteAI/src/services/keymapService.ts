/**
 * keymapService — Phase 7 Sprint 3 task S3a-1 singleton.
 *
 * Single source of truth for keyboard shortcuts in H18. Components used to
 * each ship their own `useEffect` keydown listener with hardcoded combos;
 * Sprint 3 replaces that with `keymapService.matchesEvent('search', e)`
 * + `keymapService.getDisplayLabel('search')` for the chip in the
 * SearchOverlay placeholder.
 *
 * State model:
 *   - `DEFAULT_KEYMAP` (from contract) is the baseline.
 *   - `overrides` is a sparse map of user-customised bindings, persisted
 *     to `AppSettings.shortcuts` via storageService.
 *   - `getCombo(actionId)` returns override ?? default.
 *
 * Subscribers:
 *   - In-process: `subscribe(cb)` — Sprint 3 PKeyboard pane uses this to
 *     re-render its rows when the user remaps something.
 *   - Cross-window / DOM listeners: a `CustomEvent('h18:shortcuts-changed')`
 *     is also dispatched on `window` so legacy plain-DOM listeners (the
 *     command palette overlay, etc.) can refresh their displayed chip
 *     without subscribing to the service directly.
 *
 * Persistence:
 *   - `set` / `reset` / `resetAll` fire-and-forget through storageService
 *     in the background. Callers don't await — UI updates synchronously
 *     against the in-memory state and the disk write catches up.
 *   - `hydrate()` is called on app boot (App.tsx) to restore overrides.
 *
 * Why a singleton (not a hook): the keymap is consulted from component
 * effects, the search overlay, the AI dock, and (eventually) globalShortcut
 * registrations. A hook owning the state would force every consumer to
 * thread props or context, and the conflict-detection logic in `set` needs
 * a single global view of all bindings anyway.
 */

import {
    type KeymapService,
    type ActionId,
    DEFAULT_KEYMAP,
    SHORTCUTS_CHANGE_EVENT,
} from './__contracts__/keymapService.contract';
import {
    matchesEvent as kbdMatches,
    formatComboLabel,
} from '../utils/kbd';

// Re-export the contract bits callers commonly need so import sites only
// have to know about `services/keymapService`.
export type { KeymapService, ActionId };
export { DEFAULT_KEYMAP, SHORTCUTS_CHANGE_EVENT };

class KeymapServiceImpl implements KeymapService {
    private overrides: Partial<Record<ActionId, string>> = {};
    private subscribers = new Set<() => void>();

    // ─── Public read API ───────────────────────────────────────────────

    getCombo(actionId: ActionId): string {
        return this.overrides[actionId] ?? DEFAULT_KEYMAP[actionId];
    }

    getDisplayLabel(actionId: ActionId): string {
        return formatComboLabel(this.getCombo(actionId));
    }

    matchesEvent(actionId: ActionId, e: KeyboardEvent): boolean {
        return kbdMatches(this.getCombo(actionId), e);
    }

    // ─── Public write API ──────────────────────────────────────────────

    set(actionId: ActionId, combo: string): void {
        // Conflict check: scan every other action and reject if its
        // current effective combo matches `combo`. Comparison is on the
        // raw DSL string (already case-normalised because callers always
        // build combos via `comboFromEvent`).
        for (const id of Object.keys(DEFAULT_KEYMAP) as ActionId[]) {
            if (id === actionId) continue;
            if (this.getCombo(id) === combo) {
                throw new Error(
                    `Combo "${combo}" 已被 action "${id}" 佔用，請先解綁`,
                );
            }
        }
        this.overrides[actionId] = combo;
        this.notify();
        this.persist();
    }

    reset(actionId: ActionId): void {
        if (!(actionId in this.overrides)) return; // nothing to do
        delete this.overrides[actionId];
        this.notify();
        this.persist();
    }

    resetAll(): void {
        if (Object.keys(this.overrides).length === 0) return;
        this.overrides = {};
        this.notify();
        this.persist();
    }

    subscribe(cb: () => void): () => void {
        this.subscribers.add(cb);
        return () => {
            this.subscribers.delete(cb);
        };
    }

    /** TEST-ONLY — see contract. Wipes overrides + subscribers silently. */
    __reset(): void {
        this.overrides = {};
        this.subscribers.clear();
        // Intentionally NO notify — tests want a clean slate, not a
        // change event dispatched into whatever the next test sets up.
    }

    // ─── Internals ─────────────────────────────────────────────────────

    private notify(): void {
        // Local subscribers first.
        this.subscribers.forEach((cb) => {
            try {
                cb();
            } catch (err) {
                // A throwing subscriber must not poison the bus — log
                // and continue.
                console.error('[keymap] subscriber failed', err);
            }
        });
        // DOM event for legacy listeners.
        if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
            try {
                window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGE_EVENT));
            } catch (err) {
                console.warn('[keymap] dispatch event failed', err);
            }
        }
    }

    /**
     * Fire-and-forget persistence. Wrapped so synchronous callers (`set`,
     * `reset`, etc.) don't have to await — the in-memory state is the
     * authority during a session, disk just catches up.
     */
    private persist(): void {
        void this._persist().catch((err) => {
            console.warn('[keymap] persist failed', err);
        });
    }

    private async _persist(): Promise<void> {
        try {
            const { storageService } = await import('./storageService');
            const existing = await storageService.getAppSettings();
            // Don't fabricate an AppSettings out of thin air — the type
            // requires `server`, `audio`, `subtitle`, `theme`. If the
            // user hasn't completed first-run setup yet, `getAppSettings`
            // returns null and SetupWizard owns the eventual write.
            // We only bolt on `shortcuts` once a settings row exists.
            if (!existing) return;
            await storageService.saveAppSettings({
                ...existing,
                shortcuts: { ...this.overrides },
            });
        } catch (err) {
            console.warn('[keymap] _persist storage error', err);
        }
    }

    /**
     * Hydrate from `AppSettings.shortcuts` on app boot. Safe to call
     * multiple times — later calls just overwrite in-memory overrides
     * with whatever's on disk.
     *
     * Notifies subscribers iff anything actually changed so PKeyboard
     * doesn't re-render every boot for users with default bindings.
     */
    async hydrate(): Promise<void> {
        try {
            const { storageService } = await import('./storageService');
            const settings = await storageService.getAppSettings();
            const shortcuts = settings?.shortcuts;
            if (shortcuts && Object.keys(shortcuts).length > 0) {
                this.overrides = { ...shortcuts } as Partial<Record<ActionId, string>>;
                this.notify();
            }
        } catch (err) {
            console.warn('[keymap] hydrate failed', err);
        }
    }
}

export const keymapService: KeymapService & KeymapServiceImpl =
    new KeymapServiceImpl();

// S0.14 wiring is opt-in: tests `import { registerSingletonReset }
// from '../../test/setup'` and call `registerSingletonReset(() =>
// keymapService.__reset())` themselves. We don't auto-register here
// because that would import test infra at production runtime.
