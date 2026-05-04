// 主題管理工具
//
// v0.7.0：擴充 'system' 模式 + watchSystemTheme listener。
// 'system' 在 applyTheme() 內 resolve 到當前系統 prefers-color-scheme，
// 寫入 :root 的 .dark class（CSS Modules + CSS Variables 透過此 class
// 切換 light/dark token 組）。

export type ThemeMode = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';

/**
 * 套用主題到 <html> 的 .dark class。
 * 'system' 會 resolve 到當前 prefers-color-scheme。
 * 回傳實際生效的 theme，方便 caller (例 useTheme hook) 不必 race
 * useEffect 取得最新 effective state。
 */
export const applyTheme = (mode: ThemeMode): EffectiveTheme => {
  const effective: EffectiveTheme =
    mode === 'system' ? getSystemTheme() : mode;
  const root = document.documentElement;
  if (effective === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  return effective;
};

export const getSystemTheme = (): EffectiveTheme => {
  if (
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
};

/**
 * 訂閱系統 prefers-color-scheme 變化。
 * 用於 'system' 模式：當使用者在 OS 切主題時自動跟。
 *
 * 兼容 Safari < 14 / 舊版 Edge — 它們的 MediaQueryList 沒有
 * addEventListener，要 fallback 到 deprecated addListener。
 *
 * @returns unsubscribe function；matchMedia 不可用時回 noop
 */
export const watchSystemTheme = (
  callback: (theme: EffectiveTheme) => void,
): (() => void) => {
  if (!window.matchMedia) return () => {};

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => {
    callback(e.matches ? 'dark' : 'light');
  };

  // 現代瀏覽器（含 Tauri 內建 webview）
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }

  // Legacy fallback (Safari < 14, Edge legacy)
  if (typeof mq.addListener === 'function') {
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }

  return () => {};
};
