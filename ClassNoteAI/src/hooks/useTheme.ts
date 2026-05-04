/**
 * useTheme · React hook for theme management (v0.7.0)
 *
 * 取代散在各元件的 prop drilling theme pattern。
 *
 * 自動：
 *   1. mount 時 applyTheme 到 <html>
 *   2. themeMode 變動時重套
 *   3. mode='system' 時訂閱系統主題變化，跟 OS 切
 *   4. mode 切換時清舊 listener，建新 listener
 *   5. unmount 時移除 listener
 *
 * 不負責持久化 — caller (例 App.tsx 從 storageService 讀 AppSettings)
 * 自己決定 initialMode + 把 setThemeMode 的回呼存回去。
 *
 * 用法:
 *   const { themeMode, effectiveTheme, setThemeMode } = useTheme(initialMode);
 */

import { useEffect, useState } from 'react';
import {
  applyTheme,
  getSystemTheme,
  watchSystemTheme,
  type ThemeMode,
  type EffectiveTheme,
} from '../utils/theme';

export interface UseThemeResult {
  themeMode: ThemeMode;
  effectiveTheme: EffectiveTheme;
  setThemeMode: (mode: ThemeMode) => void;
}

export function useTheme(initialMode: ThemeMode = 'light'): UseThemeResult {
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialMode);
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() =>
    getSystemTheme(),
  );

  // mode 變動時 apply（也涵蓋 mount 第一次）
  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  // 訂閱系統主題變化 — 只在 mode='system' 時 reactive
  useEffect(() => {
    if (themeMode !== 'system') return;
    return watchSystemTheme((next) => {
      setSystemTheme(next);
      // 直接 apply event payload，不要走 applyTheme('system') 二次
      // resolve — 部分瀏覽器 matchMedia.matches 在 event 觸發當下尚未
      // 更新（測試環境也常 mock 不更）；event 的 matches 才是真值。
      applyTheme(next);
    });
  }, [themeMode]);

  // 切回 system mode 時，要重新對齊當前系統 pref（可能上次離開後系統變過）
  useEffect(() => {
    if (themeMode === 'system') {
      setSystemTheme(getSystemTheme());
    }
  }, [themeMode]);

  const effectiveTheme: EffectiveTheme =
    themeMode === 'system' ? systemTheme : themeMode;

  return { themeMode, effectiveTheme, setThemeMode };
}
