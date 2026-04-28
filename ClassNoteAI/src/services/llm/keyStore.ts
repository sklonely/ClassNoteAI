/**
 * Credential storage for LLM providers.
 *
 * Uses localStorage, namespaced under `llm.<providerId>.<field>`. In a
 * Tauri desktop app the localStorage is per-webview and isolated to the
 * app directory, so the threat model is "protect against casual
 * filesystem snooping", not "defend against a local attacker with disk
 * access." A future PR can migrate hot providers to an OS keychain.
 */

const PREFIX = 'llm.';

export interface KeyStore {
  get(providerId: string, field: string): string | null;
  set(providerId: string, field: string, value: string): void;
  clear(providerId: string, field: string): void;
  has(providerId: string, field: string): boolean;
}

function keyOf(providerId: string, field: string): string {
  return `${PREFIX}${providerId}.${field}`;
}

/**
 * Module-level tracking of every storage key written through this
 * module's `set()`. clearAll() iterates this Set in addition to the
 * Web Storage API enumeration so it works in test environments whose
 * localStorage mock doesn't expose `length`/`key()` (the project's
 * vitest setup is one such case).
 *
 * On module load we seed the Set from any pre-existing PREFIX-matching
 * keys that *are* discoverable via the Web Storage API — this keeps
 * clearAll() effective for keys persisted from a previous session.
 */
const knownKeys = new Set<string>();

function rememberKey(k: string): void {
    knownKeys.add(k);
}

function forgetKey(k: string): void {
    knownKeys.delete(k);
}

function seedKnownKeysFromStorage(): void {
    try {
        const len = (localStorage as Storage).length;
        if (typeof len !== 'number') return;
        for (let i = 0; i < len; i++) {
            const k = (localStorage as Storage).key(i);
            if (typeof k === 'string' && k.startsWith(PREFIX)) {
                knownKeys.add(k);
            }
        }
    } catch {
        /* mock localStorage may lack length/key — that's fine */
    }
}
seedKnownKeysFromStorage();

/* ─── Quota-safe localStorage wrappers (W14) ──────────────────────
 * API keys are tiny (≤a few KB total), so a quota failure here
 * almost always means private-browsing / SecurityError rather than
 * "disk really full." Either way, swallow + warn instead of crashing
 * the provider config save flow. Toast is throttled to 5s.
 */
let __lastQuotaToastAt = 0;
const __TOAST_COOLDOWN_MS = 5_000;

function fireQuotaToast() {
    const now = Date.now();
    if (now - __lastQuotaToastAt < __TOAST_COOLDOWN_MS) return;
    __lastQuotaToastAt = now;
    void import('../toastService').then(({ toastService }) => {
        toastService.warning(
            '本機儲存空間不足',
            '部分資料無法儲存。請至個人資料 → 資料 → 清除舊資料釋放空間。',
        );
    }).catch(() => {/* toast not available — best effort */});
}

function safeSetItem(k: string, value: string): boolean {
    try {
        localStorage.setItem(k, value);
        return true;
    } catch (err) {
        console.warn('[keyStore] localStorage write failed', err);
        fireQuotaToast();
        return false;
    }
}

function safeRemoveItem(k: string): boolean {
    try {
        localStorage.removeItem(k);
        return true;
    } catch (err) {
        console.warn('[keyStore] localStorage remove failed', err);
        return false;
    }
}

class LocalStorageKeyStore implements KeyStore {
  get(providerId: string, field: string): string | null {
    return localStorage.getItem(keyOf(providerId, field));
  }
  set(providerId: string, field: string, value: string): void {
    const k = keyOf(providerId, field);
    if (safeSetItem(k, value)) {
        rememberKey(k);
    }
  }
  clear(providerId: string, field: string): void {
    const k = keyOf(providerId, field);
    safeRemoveItem(k);
    // Forget the key regardless of removeItem success so clearAll() and
    // has() don't keep referencing a key we tried to wipe — the in-memory
    // tracker should reflect intent, not just storage state.
    forgetKey(k);
  }
  has(providerId: string, field: string): boolean {
    return localStorage.getItem(keyOf(providerId, field)) !== null;
  }
}

export const keyStore: KeyStore = new LocalStorageKeyStore();

/**
 * Wipe every key/secret stored across all providers + fields.
 *
 * Used by the logout flow (Phase 7 R-1) — switching user must not
 * leave the previous user's API keys readable. The per-provider
 * `clear(providerId, field)` is too granular for logout: callers don't
 * know which providers the user configured, only that "everything
 * must go." This is the sweep variant.
 *
 * Discovery strategy combines two sources:
 *   1. The Web Storage API (`localStorage.length` + `key(i)`) — this is
 *      authoritative in real browsers and jsdom, and catches keys we
 *      may not have written ourselves (legacy migrations, pre-existing
 *      app data).
 *   2. `knownKeys` — the in-memory Set we maintain on every `set()` /
 *      `clear()`. This is the *only* discovery path that works under
 *      test mocks that don't expose `length`/`key()`.
 *
 * Each `removeItem` is wrapped so a single failure (e.g. mock throwing)
 * doesn't abort the sweep.
 */
export async function clearAll(): Promise<void> {
    const targets = new Set<string>();

    // Source 1: Web Storage API enumeration (production / jsdom).
    try {
        const len = (localStorage as Storage).length;
        if (typeof len === 'number') {
            for (let i = 0; i < len; i++) {
                const k = (localStorage as Storage).key(i);
                if (typeof k === 'string' && k.startsWith(PREFIX)) {
                    targets.add(k);
                }
            }
        }
    } catch (err) {
        console.warn('[keyStore] clearAll: storage enumeration failed', err);
    }

    // Source 2: tracked-key fallback (test mocks).
    for (const k of knownKeys) targets.add(k);

    for (const k of targets) {
        try {
            localStorage.removeItem(k);
        } catch (err) {
            console.warn('[keyStore] clearAll failed for', k, err);
        }
        knownKeys.delete(k);
    }
}
