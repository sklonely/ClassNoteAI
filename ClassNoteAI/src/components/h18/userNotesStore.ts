/**
 * userNotesStore · v0.7.0
 *
 * Free-form markdown notes the user types during a lecture, kept
 * separate from the AI-generated `Note.sections` shape.
 *
 * Persisted in localStorage keyed by lecture_id so the floating notes
 * window in H18RecordingPage and the 筆記 tab in H18ReviewPage share
 * the same content. No DB schema change required.
 *
 * Schema upgrade path: when we eventually add a `user_note` column to
 * the lectures table this module becomes the single migration point —
 * load/save signatures stay the same.
 */

// cp75.3 — multi-user prefix. Key is now
// `classnote-h18-user-notes:<userId>:<lectureId>` so switching account
// hides previous user's free-form notes (data left on disk for manual
// recovery; not auto-migrated to avoid leaking content across accounts).
const PREFIX = 'classnote-h18-user-notes:';
const EVT = 'classnote-h18-user-notes-changed';

import { authService } from '../../services/authService';

function key(lectureId: string): string {
    const userId = authService.getUserIdSegment();
    return `${PREFIX}${userId}:${lectureId}`;
}

/* ─── Quota-safe localStorage wrappers (W14) ──────────────────────
 * Throttled warning toast so multiple stores hitting quota in the
 * same frame coalesce. Lazy import dodges circular deps.
 */
let __lastQuotaToastAt = 0;
const __TOAST_COOLDOWN_MS = 5_000;

function fireQuotaToast() {
    const now = Date.now();
    if (now - __lastQuotaToastAt < __TOAST_COOLDOWN_MS) return;
    __lastQuotaToastAt = now;
    void import('../../services/toastService').then(({ toastService }) => {
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
        console.warn('[userNotesStore] localStorage write failed', err);
        fireQuotaToast();
        return false;
    }
}

function safeRemoveItem(k: string): boolean {
    try {
        localStorage.removeItem(k);
        return true;
    } catch (err) {
        console.warn('[userNotesStore] localStorage remove failed', err);
        return false;
    }
}

export function loadUserNotes(lectureId: string): string {
    if (!lectureId) return '';
    try {
        return localStorage.getItem(key(lectureId)) ?? '';
    } catch {
        return '';
    }
}

export function saveUserNotes(lectureId: string, text: string): void {
    if (!lectureId) return;
    if (text.length === 0) {
        safeRemoveItem(key(lectureId));
    } else {
        safeSetItem(key(lectureId), text);
    }
    // The event is fired regardless of write success: subscribers refresh
    // their view from loadUserNotes(), and a failed write means the next
    // load returns the previous text — which is the correct UI state.
    try {
        window.dispatchEvent(
            new CustomEvent(EVT, { detail: { lectureId } }),
        );
    } catch (err) {
        console.warn('[userNotesStore] dispatch failed:', err);
    }
}

/** Subscribe to changes for one lecture. Returns unsubscribe. */
export function subscribeUserNotes(
    lectureId: string,
    cb: () => void,
): () => void {
    const onChange = (e: Event) => {
        const detail = (e as CustomEvent<{ lectureId: string }>).detail;
        if (!detail || detail.lectureId === lectureId) cb();
    };
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
}
