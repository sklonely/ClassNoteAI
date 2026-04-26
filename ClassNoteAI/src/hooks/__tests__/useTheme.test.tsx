/**
 * useTheme hook tests · v0.7.0 alpha
 *
 * 提供元件不需 prop drilling 即可讀寫主題。Hook 內自動：
 *   - applyTheme on mount + on themeMode change
 *   - watch system theme changes when themeMode === 'system'
 *   - 算 effectiveTheme（解 'system' 到 light/dark）
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../useTheme';

let originalMatchMedia: typeof window.matchMedia;
let registeredHandler: ((e: { matches: boolean }) => void) | null;
let removeListenerSpy: MockInstance;

function mockMatchMedia(systemDark: boolean) {
  registeredHandler = null;
  removeListenerSpy = vi.fn();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: systemDark && query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: (event: string, handler: (e: { matches: boolean }) => void) => {
        if (event === 'change') registeredHandler = handler;
      },
      removeEventListener: removeListenerSpy,
      addListener: () => { },
      removeListener: () => { },
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  originalMatchMedia = window.matchMedia;
  mockMatchMedia(false);
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  });
  vi.restoreAllMocks();
});

describe('useTheme', () => {
  it('defaults to light mode when no initialMode given', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeMode).toBe('light');
    expect(result.current.effectiveTheme).toBe('light');
  });

  it('respects initialMode prop', () => {
    const { result } = renderHook(() => useTheme('dark'));
    expect(result.current.themeMode).toBe('dark');
    expect(result.current.effectiveTheme).toBe('dark');
  });

  it('applies dark class to <html> on mount when mode=dark', () => {
    renderHook(() => useTheme('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setThemeMode updates state and re-applies', () => {
    const { result } = renderHook(() => useTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      result.current.setThemeMode('dark');
    });

    expect(result.current.themeMode).toBe('dark');
    expect(result.current.effectiveTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('mode=system resolves effectiveTheme to current system pref (dark)', () => {
    mockMatchMedia(true); // 系統偏好 dark
    const { result } = renderHook(() => useTheme('system'));
    expect(result.current.themeMode).toBe('system');
    expect(result.current.effectiveTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('mode=system resolves effectiveTheme to light when system prefers light', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme('system'));
    expect(result.current.effectiveTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('reacts to system theme change when mode=system', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme('system'));
    expect(result.current.effectiveTheme).toBe('light');

    // 模擬系統切到 dark
    act(() => {
      registeredHandler?.({ matches: true });
    });

    expect(result.current.effectiveTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does NOT react to system theme change when mode=light (manual override)', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme('light'));
    expect(result.current.effectiveTheme).toBe('light');

    // 系統切到 dark — light mode 應該維持不變
    act(() => {
      registeredHandler?.({ matches: true });
    });

    expect(result.current.effectiveTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('cleans up system listener on unmount', () => {
    const { unmount } = renderHook(() => useTheme('system'));
    unmount();
    expect(removeListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('switching from system → dark unregisters system listener', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme('system'));

    act(() => {
      result.current.setThemeMode('dark');
    });

    // useEffect cleanup 應該觸發 removeEventListener
    // (實際瀏覽器：listener 移除後系統 change 不會再 trigger callback；
    //  jsdom 我們直接驗證 cleanup 確實發生)
    expect(removeListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
    expect(result.current.effectiveTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('switching back to system mode picks up current system preference', () => {
    mockMatchMedia(true); // 系統 dark
    const { result } = renderHook(() => useTheme('light'));
    expect(result.current.effectiveTheme).toBe('light');

    act(() => {
      result.current.setThemeMode('system');
    });

    // 切到 system 後，應該變 dark (跟系統)
    expect(result.current.effectiveTheme).toBe('dark');
  });
});
