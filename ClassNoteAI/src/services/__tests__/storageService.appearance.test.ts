/**
 * storageService.normalizeAppSettings · v0.7.0 H18 appearance migration
 *
 * 確保舊使用者升級到 v0.7.0 後 (settings.appearance 不存在)，
 * getAppSettings 讀回時自動填 default appearance 物件，避免元件
 * 拿到 undefined 炸掉。
 *
 * 不直接測 Tauri invoke / SQLite，而是測純函數 normalizeAppSettings。
 */

import { describe, it, expect } from 'vitest';
import { normalizeAppSettingsForTest } from '../storageService';
import type { AppSettings } from '../../types';

const MINIMAL_LEGACY_SETTINGS: AppSettings = {
  server: { url: 'http://localhost', port: 8080, enabled: false },
  audio: { sample_rate: 16000, chunk_duration: 2 },
  subtitle: {
    font_size: 18, font_color: '#FFFFFF', background_opacity: 0.8,
    position: 'bottom', display_mode: 'both',
  },
  theme: 'light',
};

describe('normalizeAppSettings · appearance migration (v0.7.0)', () => {
  it('fills in default appearance when missing', () => {
    const result = normalizeAppSettingsForTest(MINIMAL_LEGACY_SETTINGS);
    expect(result.appearance).toBeDefined();
    expect(result.appearance).toEqual({
      themeMode: 'light',         // 從 legacy theme 'light' migrate
      density: 'comfortable',     // default 舒適
      fontSize: 'normal',         // default 標準
      layout: 'A',                // default 預設首頁佈局
      toastStyle: 'card',         // default 卡片風 toast
    });
  });

  it('migrates legacy theme=dark to appearance.themeMode=dark', () => {
    const result = normalizeAppSettingsForTest({
      ...MINIMAL_LEGACY_SETTINGS,
      theme: 'dark',
    });
    expect(result.appearance?.themeMode).toBe('dark');
  });

  it('preserves existing appearance fields, only fills missing', () => {
    const partial: AppSettings = {
      ...MINIMAL_LEGACY_SETTINGS,
      appearance: {
        themeMode: 'system',
        density: 'compact',
        // fontSize / layout / toastStyle 缺 — 應自動填 default
      } as AppSettings['appearance'],
    };
    const result = normalizeAppSettingsForTest(partial);
    expect(result.appearance).toEqual({
      themeMode: 'system',          // 保留
      density: 'compact',           // 保留
      fontSize: 'normal',           // 補 default
      layout: 'A',                  // 補 default
      toastStyle: 'card',           // 補 default
    });
  });

  it('does NOT overwrite existing appearance with legacy theme', () => {
    // 若 user 已經設過 appearance.themeMode，legacy theme 不該蓋過去
    const result = normalizeAppSettingsForTest({
      ...MINIMAL_LEGACY_SETTINGS,
      theme: 'light',
      appearance: {
        themeMode: 'dark',
        density: 'comfortable',
        fontSize: 'normal',
        layout: 'A',
        toastStyle: 'card',
      },
    });
    expect(result.appearance?.themeMode).toBe('dark');
  });

  it('does not strip non-appearance fields (regression guard)', () => {
    const settings: AppSettings = {
      ...MINIMAL_LEGACY_SETTINGS,
      translation: { provider: 'gemma', target_language: 'zh-TW' },
      ocr: { mode: 'auto' },
    };
    const result = normalizeAppSettingsForTest(settings);
    expect(result.translation).toEqual({ provider: 'gemma', target_language: 'zh-TW' });
    expect(result.ocr).toEqual({ mode: 'auto' });
    expect(result.appearance).toBeDefined();
  });
});
