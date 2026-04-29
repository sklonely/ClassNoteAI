/**
 * useAppSettings · v0.7.0 H18 wiring audit
 *
 * 共用 hook：load + update AppSettings via storageService。給 ProfilePanes
 * 各個 sub-pane 讀寫設定（取代 local state stub）。
 *
 * 寫入時：
 *  1. 持久化到 storageService.saveAppSettings
 *  2. dispatch `classnote-settings-changed` event 讓其它監聽者刷新
 *
 * 讀取時：listen `classnote-settings-changed` 重 load。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { storageService } from '../../services/storageService';
import type { AppSettings } from '../../types';

export function useAppSettings() {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);

    // cp75.9 — keep a sync mirror of the latest settings in a ref so
    // `update()` can build its merge baseline from the LATEST value, not
    // a stale closure snapshot. The state-based version had a race:
    //
    //   1. user fills Calendar URL → update({integrations:{canvas:{calendar_rss:URL}}})
    //      → save A → dispatch settings-changed → reload starts (async)
    //   2. user toggles a layout → update({appearance:{layout:'B'}})
    //      → callback closure still has the PRE-A `settings` because the
    //        reload in (1) hasn't resolved → save B with NO calendar URL
    //   3. URL silently disappears.
    //
    // Persisting through a ref is the cheapest fix that doesn't require
    // restructuring callers — they all do `update({ ...integrations,
    // canvas: { ...canvas, calendar_rss: v } })` which assumes the
    // captured `integrations` is fresh, but the merge inside `update`
    // now uses the ref'd latest as the floor.
    const settingsRef = useRef<AppSettings | null>(null);
    settingsRef.current = settings;

    const reload = useCallback(async () => {
        try {
            const s = await storageService.getAppSettings();
            setSettings(s);
            settingsRef.current = s;
        } catch (err) {
            console.warn('[useAppSettings] load failed:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        reload();
        const onChange = () => reload();
        window.addEventListener('classnote-settings-changed', onChange);
        return () =>
            window.removeEventListener('classnote-settings-changed', onChange);
    }, [reload]);

    const update = useCallback(async (patch: Partial<AppSettings>) => {
        // cp75.9: use ref'd latest, not the closure-captured `settings`.
        // No deps array → callback identity is stable so subscribers
        // don't re-render needlessly.
        const baseline = settingsRef.current;
        if (!baseline) return;
        const next = { ...baseline, ...patch } as AppSettings;
        setSettings(next);
        settingsRef.current = next;
        try {
            await storageService.saveAppSettings(next);
            window.dispatchEvent(new CustomEvent('classnote-settings-changed'));
        } catch (err) {
            console.warn('[useAppSettings] save failed:', err);
        }
    }, []);

    return { settings, loading, update, reload };
}
