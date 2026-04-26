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

import { useCallback, useEffect, useState } from 'react';
import { storageService } from '../../services/storageService';
import type { AppSettings } from '../../types';

export function useAppSettings() {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        try {
            const s = await storageService.getAppSettings();
            setSettings(s);
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

    const update = useCallback(
        async (patch: Partial<AppSettings>) => {
            if (!settings) return;
            const next = { ...settings, ...patch } as AppSettings;
            setSettings(next);
            try {
                await storageService.saveAppSettings(next);
                window.dispatchEvent(new CustomEvent('classnote-settings-changed'));
            } catch (err) {
                console.warn('[useAppSettings] save failed:', err);
            }
        },
        [settings],
    );

    return { settings, loading, update, reload };
}
