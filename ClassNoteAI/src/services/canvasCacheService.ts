/**
 * canvasCacheService · v0.7.x
 *
 * Stale-while-revalidate cache for Canvas LMS feeds (announcements + calendar).
 * 本機 localStorage，不上雲。
 *
 * 行為：
 *  1. 元件 mount 時 `loadCanvasCache(key)` 同步拿 cached data，先 render。
 *  2. 隨後背景跑 fetcher；成功就寫回 cache + 廣播事件。
 *  3. Throttle：同一 key 60 秒內只能再 fetch 一次（避免使用者狂切頁面狂打）。
 *  4. TTL：30 分鐘背景排程也用得到（看調用方用不用）；UI 強制 view-time
 *     refresh 不看 TTL，但會看 throttle。
 *
 * Cache shape (JSON in localStorage)：
 *   {
 *     data: T,
 *     fetched_at: ISO 8601,
 *     ok: boolean,        // 上次 fetch 成功 = true / 失敗 = false
 *     error?: string      // 失敗訊息
 *   }
 */

import { useEffect, useRef, useState } from 'react';

const PREFIX = 'classnote-canvas-cache:';
const EVT = 'classnote-canvas-cache-changed';
const MIN_REFETCH_INTERVAL_MS = 60 * 1000; // 60s throttle
const STALE_TTL_MS = 30 * 60 * 1000; // 30min — anything older is "stale"

interface CacheRecord<T> {
    data: T;
    /** ISO 8601 — 寫入 cache 的時間（= 上次成功 fetch 時間） */
    fetched_at: string;
    ok: boolean;
    error?: string;
}

function key(k: string): string {
    return PREFIX + k;
}

function dispatchChange(k: string) {
    window.dispatchEvent(
        new CustomEvent(EVT, { detail: { key: k } }),
    );
}

/* ════════════════════ sync helpers ════════════════════ */

export function loadCanvasCache<T>(k: string): CacheRecord<T> | null {
    try {
        const raw = localStorage.getItem(key(k));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CacheRecord<T>;
        return parsed;
    } catch {
        return null;
    }
}

export function saveCanvasCache<T>(k: string, data: T): void {
    try {
        const rec: CacheRecord<T> = {
            data,
            fetched_at: new Date().toISOString(),
            ok: true,
        };
        localStorage.setItem(key(k), JSON.stringify(rec));
        dispatchChange(k);
    } catch (err) {
        console.warn('[canvasCacheService] save failed:', err);
    }
}

export function saveCanvasCacheError(k: string, message: string): void {
    try {
        // Preserve prior data; just mark fetch failed
        const prev = loadCanvasCache(k);
        const rec: CacheRecord<unknown> = {
            data: prev?.data ?? null,
            fetched_at: prev?.fetched_at ?? new Date().toISOString(),
            ok: false,
            error: message,
        };
        localStorage.setItem(key(k), JSON.stringify(rec));
        dispatchChange(k);
    } catch {
        /* swallow */
    }
}

export function clearCanvasCache(k: string): void {
    try {
        localStorage.removeItem(key(k));
        dispatchChange(k);
    } catch {
        /* swallow */
    }
}

export function isCacheStale(rec: CacheRecord<unknown> | null, ttlMs = STALE_TTL_MS): boolean {
    if (!rec) return true;
    const age = Date.now() - new Date(rec.fetched_at).getTime();
    return age > ttlMs;
}

export function subscribeCanvasCache(
    k: string,
    cb: () => void,
): () => void {
    const onChange = (e: Event) => {
        const detail = (e as CustomEvent<{ key: string }>).detail;
        if (!detail || detail.key === k) cb();
    };
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
}

/* ════════════════════ throttle ════════════════════ */

const lastFetchAt: Map<string, number> = new Map();

function withinThrottle(k: string): boolean {
    const last = lastFetchAt.get(k) ?? 0;
    return Date.now() - last < MIN_REFETCH_INTERVAL_MS;
}

function markFetched(k: string) {
    lastFetchAt.set(k, Date.now());
}

/* ════════════════════ React hook ════════════════════ */

export interface CanvasFeedState<T> {
    /** 上次成功 fetch 拿到的資料；尚未拿過為 null。 */
    data: T | null;
    /** ISO 8601 of last successful fetch；無資料時 null。 */
    fetchedAt: string | null;
    /** 目前是否在 fetch 中（背景 revalidate）。 */
    isFetching: boolean;
    /** 上次 fetch 是否失敗（即使有 cached data，網路斷掉的話也標記 true）。 */
    error: string | null;
    /** 手動觸發再次 fetch（無視 throttle）。 */
    refresh: () => Promise<void>;
}

/**
 * SWR-style hook：cache 立刻給、背景拉新的。
 *
 *   - mount 時讀 cache 同步 hydrate state
 *   - 跑一次 fetcher（除非 60s throttle 內剛跑過）
 *   - fetcher 完成寫 cache + 廣播
 *   - 跨元件同步：訂閱 EVT，cache 一變所有 subscriber 都 reload
 *
 * 提供 disabled flag 讓沒設 URL 的 case 直接 short-circuit。
 */
export function useCanvasFeed<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
    opts: { disabled?: boolean } = {},
): CanvasFeedState<T> {
    const { disabled = false } = opts;
    const [state, setState] = useState<{
        data: T | null;
        fetchedAt: string | null;
        isFetching: boolean;
        error: string | null;
    }>(() => {
        const cur = loadCanvasCache<T>(cacheKey);
        return {
            data: cur?.data ?? null,
            fetchedAt: cur?.fetched_at ?? null,
            isFetching: false,
            error: cur?.ok === false ? (cur.error ?? null) : null,
        };
    });

    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const runFetch = async (force: boolean) => {
        if (!force && withinThrottle(cacheKey)) return;
        markFetched(cacheKey);
        setState((s) => ({ ...s, isFetching: true, error: null }));
        try {
            const data = await fetcherRef.current();
            saveCanvasCache(cacheKey, data);
            setState({
                data,
                fetchedAt: new Date().toISOString(),
                isFetching: false,
                error: null,
            });
        } catch (err) {
            const message = (err as Error)?.message || String(err);
            saveCanvasCacheError(cacheKey, message);
            setState((s) => ({
                ...s,
                isFetching: false,
                error: message,
            }));
            console.warn('[useCanvasFeed]', cacheKey, 'fetch failed:', err);
        }
    };

    // Mount: SWR fetch (not forced — throttled)
    useEffect(() => {
        if (disabled) return;
        void runFetch(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cacheKey, disabled]);

    // Cross-component cache invalidation
    useEffect(() => {
        return subscribeCanvasCache(cacheKey, () => {
            const cur = loadCanvasCache<T>(cacheKey);
            setState((s) => ({
                ...s,
                data: cur?.data ?? s.data,
                fetchedAt: cur?.fetched_at ?? s.fetchedAt,
                error: cur?.ok === false ? (cur.error ?? null) : null,
            }));
        });
    }, [cacheKey]);

    return {
        ...state,
        refresh: () => runFetch(true),
    };
}
