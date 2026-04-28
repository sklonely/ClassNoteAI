/**
 * inboxStateService · v0.7.x
 *
 * Per-item state for the home Inbox: 'pending' | 'snoozed' | 'done'.
 *
 * Why this exists separate from useAggregatedCanvasInbox: the Canvas
 * feed itself is read-only (RSS/iCal). User intent — 標記完成 / 推遲到
 * 明天 — is purely client side. Keeping it in localStorage keyed by
 * the same `InboxItem.id` (Atom tag URI / iCal UID) means the state
 * sticks to the actual underlying announcement / event regardless of
 * RSS reorder or feed re-fetch.
 *
 * Snooze auto-expiry is lazy: when getInboxState() reads a snoozed
 * record whose `snoozedUntil` is past, it deletes the record and
 * returns 'pending'. No background timer here — caller (H18Inbox)
 * uses a 60s setInterval to bump re-renders so expired snoozes
 * reappear in the待辦 list within a minute.
 *
 * Orphan cleanup: not implemented. If an announcement scrolls off
 * the RSS feed, its done/snoozed record stays in localStorage. Cheap
 * (each entry ~80 bytes) and harmless. Could add a sweep tied to
 * useAggregatedCanvasInbox.items diff later if needed.
 */

const KEY = 'classnote.inbox.states.v1';

interface InboxItemStateRaw {
    state: 'snoozed' | 'done';
    /** ms epoch — only present for snoozed. */
    snoozedUntil?: number;
    /** When the user marked it (for 「已完成 2 小時前」 badges). */
    markedAt: number;
}

type InboxStateMap = Record<string, InboxItemStateRaw>;

let cache: InboxStateMap | null = null;
const listeners = new Set<() => void>();

/* ─── Quota-safe localStorage wrappers (W14) ──────────────────────
 * QuotaExceededError / SecurityError (private browsing, sandboxed
 * iframe) must not crash the call-site. We log + fire one warning
 * toast (throttled per-store to 5s) and let the caller proceed.
 * Toast is lazy-imported to avoid a circular dep on toastService.
 */
let __lastQuotaToastAt = 0;
const __TOAST_COOLDOWN_MS = 5_000;

function fireQuotaToast() {
    const now = Date.now();
    if (now - __lastQuotaToastAt < __TOAST_COOLDOWN_MS) return;
    __lastQuotaToastAt = now;
    void import('./toastService').then(({ toastService }) => {
        toastService.warning(
            '本機儲存空間不足',
            '部分資料無法儲存。請至個人資料 → 資料 → 清除舊資料釋放空間。',
        );
    }).catch(() => {/* toast not available — best effort */});
}

function safeSetItem(key: string, value: string): boolean {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (err) {
        console.warn('[inboxStateService] localStorage write failed', err);
        fireQuotaToast();
        return false;
    }
}

// Note: this store doesn't expose a removeItem path — single-key whole-map
// rewrite via persist() is the only mutation. If you add per-id deletion
// hitting localStorage.removeItem, mirror the safeSetItem pattern here.

function load(): InboxStateMap {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(KEY);
        cache = raw ? (JSON.parse(raw) as InboxStateMap) : {};
    } catch {
        cache = {};
    }
    return cache;
}

function persist() {
    if (!cache) return;
    safeSetItem(KEY, JSON.stringify(cache));
}

function notify() {
    for (const l of listeners) l();
}

export type InboxItemEffectiveState = 'pending' | 'snoozed' | 'done';

export interface InboxStateInfo {
    state: InboxItemEffectiveState;
    /** When user set this state. Only for snoozed/done. */
    markedAt?: number;
    /** When snooze expires. Only for snoozed. */
    snoozedUntil?: number;
}

export function getInboxState(id: string, now = Date.now()): InboxStateInfo {
    const map = load();
    const raw = map[id];
    if (!raw) return { state: 'pending' };
    if (raw.state === 'snoozed') {
        if (!raw.snoozedUntil || raw.snoozedUntil <= now) {
            // Lazy expire — return pending without notifying (caller already
            // owns the read). Persist the cleanup so later reads are cheap.
            delete map[id];
            persist();
            return { state: 'pending' };
        }
        return {
            state: 'snoozed',
            markedAt: raw.markedAt,
            snoozedUntil: raw.snoozedUntil,
        };
    }
    return { state: 'done', markedAt: raw.markedAt };
}

export function setInboxSnooze(id: string, untilMs: number) {
    const map = load();
    map[id] = { state: 'snoozed', snoozedUntil: untilMs, markedAt: Date.now() };
    persist();
    notify();
}

export function setInboxDone(id: string) {
    const map = load();
    map[id] = { state: 'done', markedAt: Date.now() };
    persist();
    notify();
}

export function clearInboxState(id: string) {
    const map = load();
    if (map[id]) {
        delete map[id];
        persist();
        notify();
    }
}

export function subscribeInboxStates(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

/* ─── Snooze presets ──────────────────────────────────────────
 * Used by InboxRow's 推遲 popover. Computed lazily so the
 * relative labels / hints stay accurate across the day.
 */

export interface SnoozePreset {
    key: string;
    label: string;
    /** Sub-label e.g. "明早 08:00" so user knows the resulting time. */
    hint?: string;
    untilMs: number;
}

function fmtHM(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtMD(d: Date): string {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function buildSnoozePresets(now = new Date()): SnoozePreset[] {
    const oneHour = new Date(now.getTime() + 60 * 60 * 1000);

    const tonight = new Date(now);
    tonight.setHours(20, 0, 0, 0);
    const tonightUsable = tonight.getTime() > now.getTime() + 30 * 60 * 1000;

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);

    const oneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    oneWeek.setHours(8, 0, 0, 0);

    const presets: SnoozePreset[] = [];
    presets.push({
        key: '1h',
        label: '1 小時',
        hint: fmtHM(oneHour),
        untilMs: oneHour.getTime(),
    });
    if (tonightUsable) {
        presets.push({
            key: 'tonight',
            label: '今晚',
            hint: fmtHM(tonight),
            untilMs: tonight.getTime(),
        });
    }
    presets.push({
        key: 'tomorrow',
        label: '明天',
        hint: `${fmtMD(tomorrow)} ${fmtHM(tomorrow)}`,
        untilMs: tomorrow.getTime(),
    });
    presets.push({
        key: '1w',
        label: '1 週',
        hint: fmtMD(oneWeek),
        untilMs: oneWeek.getTime(),
    });
    return presets;
}

export function describeSnoozeUntil(untilMs: number, now = Date.now()): string {
    const ms = untilMs - now;
    if (ms <= 0) return '剛剛醒來';
    const mins = Math.round(ms / (60 * 1000));
    if (mins < 60) return `${mins} 分鐘後`;
    const hours = Math.round(mins / 60);
    const d = new Date(untilMs);
    if (hours < 24) return `${hours} 小時後 (${fmtHM(d)})`;
    const days = Math.round(hours / 24);
    if (days === 1) return `明天 ${fmtHM(d)}`;
    if (days < 7) return `${days} 天後 ${fmtHM(d)}`;
    return `${fmtMD(d)} ${fmtHM(d)}`;
}

export function describeMarkedAt(ms: number, now = Date.now()): string {
    const ago = now - ms;
    const mins = Math.floor(ago / (60 * 1000));
    if (mins < 1) return '剛剛';
    if (mins < 60) return `${mins} 分前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小時前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    return fmtMD(new Date(ms));
}
