/**
 * Default LLM provider preference — per-user scoped, NOT in the `llm.*`
 * keyStore namespace.
 *
 * cp75.4 — was a single shared key `'llm.defaultProvider'` co-located
 * with API keys. Two problems:
 *   1. `keyStore.clearAll()` sweeps every key with prefix `'llm.'`, so
 *      logout (R-1) deleted the default-provider preference along with
 *      API keys. Re-login as the same user → preference forgotten,
 *      every AI task fell back to "first configured provider" silently.
 *   2. Single shared key — user A's choice was visible to user B.
 *
 * Fix: move out of `'llm.'` namespace (so clearAll leaves it alone) AND
 * scope per user. logout still implicitly hides it because authService's
 * `getUserIdSegment()` flips to the next user's bucket.
 *
 * Two callers import from here (was duplicated as a const string in
 * `services/llm/tasks.ts` AND `components/AIProviderSettings.tsx` —
 * any drift between the two would have been silent).
 */

import { authService } from '../authService';

const STORAGE_KEY_BASE = 'classnote-llm-default-provider';

function storageKey(): string {
    return `${STORAGE_KEY_BASE}:${authService.getUserIdSegment()}`;
}

export function getDefaultProvider(): string | undefined {
    try {
        return localStorage.getItem(storageKey()) || undefined;
    } catch {
        return undefined;
    }
}

export function setDefaultProvider(providerId: string | null): void {
    try {
        const k = storageKey();
        if (providerId) {
            localStorage.setItem(k, providerId);
        } else {
            localStorage.removeItem(k);
        }
    } catch {
        // best-effort — quota / private mode shouldn't break provider config
    }
}
