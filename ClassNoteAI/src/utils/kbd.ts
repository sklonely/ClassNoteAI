/**
 * kbd — keyboard combo DSL helpers shared by keymapService + Profile UI.
 *
 * Phase 7 Sprint 3 task S3a-1. The combo string format is documented in
 * `services/__contracts__/keymapService.contract.ts`:
 *
 *   - tokens are joined with `+` (no spaces required, but tolerated)
 *   - `Mod`     — placeholder, resolves to ⌘ on macOS / Ctrl elsewhere
 *   - `Ctrl`    — explicit Ctrl (mac: ⌃, others: same as Mod → still Ctrl)
 *   - `Shift`, `Alt`/`Option` — modifiers
 *   - `Comma`, `Backslash` — named keys (so `Mod+,` doesn't collide with
 *     the `+` separator)
 *   - everything else is treated as a single literal key (lowercased
 *     internally; rendered uppercase for single-char keys)
 *
 * Why keep this in `utils/` and not the service: PKeyboard's settings
 * pane needs `formatComboLabel` for display chips, and the DragDrop /
 * future macro panes need `comboFromEvent` for capture. Pulling the
 * service in everywhere would couple unrelated UI to the singleton.
 */

/** OS family — only what the modifier-key rendering branches on. */
export type OS = 'mac' | 'win' | 'linux';

/**
 * Sniff the host OS once per call. SSR-safe (returns `'win'` if there's
 * no `navigator`, since Tauri shell on Linux/Win still presents Ctrl).
 *
 * We don't cache the result: tests stub `navigator` per-case and the
 * real runtime never re-platforms.
 */
export function detectOS(): OS {
    if (typeof navigator === 'undefined') return 'win';
    const platform = (navigator.platform || '').toLowerCase();
    const ua = (navigator.userAgent || '').toLowerCase();
    if (platform.includes('mac') || ua.includes('mac os x')) return 'mac';
    if (platform.includes('linux') || ua.includes('linux')) return 'linux';
    return 'win';
}

/**
 * Decoded combo. `mod` and `ctrl` are kept separate so macOS users can
 * bind `Mod+Ctrl+K` (⌘⌃K) without ambiguity; on win/linux there's no
 * ⌘ key so `mod` and `ctrl` collapse onto the same physical Ctrl.
 */
export interface ParsedCombo {
    mod: boolean;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    /** Lowercased key — `'k'`, `','`, `'\\'`, `'arrowup'`, etc. */
    key: string;
}

/** Parse a combo string into a {@link ParsedCombo}. Case-insensitive. */
export function parseCombo(combo: string): ParsedCombo {
    const result: ParsedCombo = {
        mod: false,
        ctrl: false,
        shift: false,
        alt: false,
        key: '',
    };
    const parts = combo.split('+').map((p) => p.trim()).filter((p) => p.length > 0);
    for (const p of parts) {
        const lower = p.toLowerCase();
        if (lower === 'mod') {
            result.mod = true;
        } else if (lower === 'ctrl' || lower === 'control') {
            result.ctrl = true;
        } else if (lower === 'shift') {
            result.shift = true;
        } else if (lower === 'alt' || lower === 'option') {
            result.alt = true;
        } else if (lower === 'meta' || lower === 'cmd' || lower === 'command') {
            // Treat raw Meta as Mod — callers should prefer Mod, but
            // accept Meta defensively so events captured via comboFromEvent
            // don't desync if someone hand-edits the override.
            result.mod = true;
        } else if (lower === 'comma') {
            result.key = ',';
        } else if (lower === 'backslash') {
            result.key = '\\';
        } else {
            result.key = lower;
        }
    }
    return result;
}

/**
 * Render a combo as a human-readable label.
 *
 *   macOS  → `⌘K`, `⌘⇧N`, `⌘,`, `⌘\`
 *   other  → `Ctrl+K`, `Ctrl+Shift+N`, `Ctrl+,`, `Ctrl+\`
 *
 * `Mod` resolves to `⌘` on mac, `Ctrl` elsewhere. Standalone `Ctrl`
 * shows as `⌃` on mac so a `Mod+Ctrl+K` binding renders as `⌘⌃K`.
 *
 * Order matches the macOS HIG keyboard convention (Ctrl, Opt, Shift,
 * Cmd) for the mac path, and the more common Ctrl-Shift-Alt-Key for
 * non-mac. We bias to readability over rigour here.
 */
export function formatComboLabel(combo: string, os: OS = detectOS()): string {
    const p = parseCombo(combo);
    const parts: string[] = [];

    if (os === 'mac') {
        // Apple HIG order: Ctrl ⌃, Opt ⌥, Shift ⇧, Cmd ⌘, Key.
        if (p.ctrl) parts.push('⌃');
        if (p.alt) parts.push('⌥');
        if (p.shift) parts.push('⇧');
        if (p.mod) parts.push('⌘');
    } else {
        // Windows / Linux: spelled out, joined by `+`.
        if (p.mod || p.ctrl) parts.push('Ctrl');
        if (p.shift) parts.push('Shift');
        if (p.alt) parts.push('Alt');
    }

    let keyLabel = p.key;
    if (keyLabel.length === 1) {
        // Uppercase letters; punctuation passes through (`,`, `\`).
        keyLabel = keyLabel.toUpperCase();
    } else if (keyLabel.length > 1) {
        // Function keys / arrow keys etc. Title-case for readability.
        keyLabel = keyLabel.charAt(0).toUpperCase() + keyLabel.slice(1);
    }
    parts.push(keyLabel);

    return os === 'mac' ? parts.join('') : parts.join('+');
}

/**
 * Convert a live `KeyboardEvent` into a canonical combo string. Used by
 * the (future) "press the keys you want" capture UI in PKeyboard.
 *
 * - macOS: emits `Mod` for ⌘, `Ctrl` for ⌃ (so the two can coexist).
 * - other: emits `Mod` for Ctrl. (Win-key / Super never fires `Mod`
 *   because it doesn't carry app-level meaning here.)
 *
 * Modifier order is fixed (`Mod, Ctrl, Shift, Alt, Key`) so the same
 * physical chord always serialises the same way regardless of press
 * order — important because the persisted overrides are compared
 * stringwise on conflict checks.
 */
export function comboFromEvent(e: KeyboardEvent): string {
    const os = detectOS();
    const parts: string[] = [];

    const mod = os === 'mac' ? e.metaKey : e.ctrlKey;
    if (mod) parts.push('Mod');
    // On mac, Ctrl is its own thing. On win/linux Ctrl == Mod, so we
    // don't emit it twice.
    if (os === 'mac' && e.ctrlKey) parts.push('Ctrl');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');

    let key = e.key;
    if (key === ',') key = 'Comma';
    else if (key === '\\') key = 'Backslash';
    else if (key.length === 1) key = key.toUpperCase();
    parts.push(key);

    return parts.join('+');
}

/**
 * Test whether a `KeyboardEvent` matches the given combo string.
 *
 * Resolution rules:
 *   - `Mod` matches ⌘ on mac, Ctrl on win/linux.
 *   - `Ctrl` is explicit ⌃ on mac; on win/linux it's the same physical
 *     key as Mod, so a binding written as `Ctrl+K` matches Ctrl+K events.
 *   - Shift / Alt must match exactly.
 *   - Key matches case-insensitively (so 'K' and 'k' both work).
 *
 * Returns `false` if `combo` doesn't define a key (caller bug — empty
 * binding string).
 */
export function matchesEvent(combo: string, e: KeyboardEvent): boolean {
    const p = parseCombo(combo);
    if (!p.key) return false;
    const os = detectOS();

    let modOk: boolean;
    let ctrlOk: boolean;
    if (os === 'mac') {
        modOk = p.mod === e.metaKey;
        ctrlOk = p.ctrl === e.ctrlKey;
    } else {
        // win / linux: collapse Mod and Ctrl onto the physical Ctrl key.
        // Either token in the binding accepts Ctrl. We don't require
        // metaKey to be false (Win key) because user agents fire it
        // inconsistently and it shouldn't gate keybindings.
        const wantsCtrl = p.mod || p.ctrl;
        modOk = wantsCtrl === e.ctrlKey;
        ctrlOk = true;
    }

    return (
        modOk &&
        ctrlOk &&
        p.shift === e.shiftKey &&
        p.alt === e.altKey &&
        p.key.toLowerCase() === e.key.toLowerCase()
    );
}
