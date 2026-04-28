/**
 * Keymap Service — type-only contract.
 *
 * Sprint 3 (Phase 7) replaces the scattered `useEffect` keyboard listeners
 * with a single keymap registry. Components ask for an action's combo or
 * test an event against an action; users can override defaults from
 * Profile → Shortcuts.
 *
 * Combos use a string DSL with `+` separators. Recognised modifier tokens:
 *   - `Mod`   — placeholder resolved at runtime (`⌘` on macOS, `Ctrl` else)
 *   - `Ctrl`, `Shift`, `Alt`, `Meta`
 * Key tokens follow `KeyboardEvent.key` casing for letters/digits and the
 * named tokens used in {@link DEFAULT_KEYMAP} (`Comma`, `Backslash`, ...).
 *
 * This module is type-only.
 */

export type ActionId =
  | 'search'
  | 'toggleAiDock'
  | 'newCourse'
  | 'goHome'
  | 'goProfile'
  | 'toggleTheme'
  | 'floatingNotes';

/**
 * Default combos shipped with the app. `Mod` is a placeholder — the
 * implementation translates it to the platform-appropriate modifier when
 * matching events and rendering display labels.
 */
export const DEFAULT_KEYMAP: Record<ActionId, string> = {
  search: 'Mod+K',
  toggleAiDock: 'Mod+J',
  newCourse: 'Mod+N',
  goHome: 'Mod+H',
  goProfile: 'Mod+Comma',
  toggleTheme: 'Mod+Backslash',
  floatingNotes: 'Mod+Shift+N',
};

export interface KeymapService {
  /** Current combo string for the action (with `Mod` left unresolved). */
  getCombo(actionId: ActionId): string;

  /**
   * OS-aware human-readable label. Examples:
   *   macOS  → `⌘K`, `⌘⇧N`
   *   other  → `Ctrl+K`, `Ctrl+Shift+N`
   */
  getDisplayLabel(actionId: ActionId): string;

  /**
   * Test whether a `KeyboardEvent` matches the combo bound to `actionId`.
   * Implementations should respect `Mod` resolution and ignore
   * `event.repeat` decisions (callers handle that).
   */
  matchesEvent(actionId: ActionId, e: KeyboardEvent): boolean;

  /**
   * Override the combo for an action. Throws if `combo` collides with an
   * existing binding. Persists to local settings storage.
   */
  set(actionId: ActionId, combo: string): void;

  /** Restore one action to its {@link DEFAULT_KEYMAP} value. */
  reset(actionId: ActionId): void;

  /** Restore all actions to defaults. */
  resetAll(): void;

  /** Subscribe to any keymap change. Callback receives no arguments. */
  subscribe(cb: () => void): () => void;

  /** TEST-ONLY — wipe overrides and subscribers, restore defaults. */
  __reset(): void;
}

/**
 * DOM CustomEvent name dispatched on `window` whenever a binding is added,
 * removed, or reset. Listeners refresh cached display labels.
 */
export const SHORTCUTS_CHANGE_EVENT = 'h18:shortcuts-changed';
