/**
 * tokens.ts / tokens.css 同步性測試 · v0.7.0 alpha
 *
 * 防呆：tokens.ts (TS 端引用) 跟 tokens.css (CSS 端定義) 必須包含
 * 完全一致的 keys。任何一邊加了新 token，另一邊忘了加，這個測試
 * 會 fail。
 *
 * 不測：
 *   - 實際 CSS 計算值（jsdom 沒 layout，computedStyle 拿不到 CSS var）
 *   - 視覺對比 / WCAG 等視覺品質
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOKENS, TOKEN_KEYS } from '../tokens';

const tokensCssPath = resolve(__dirname, '..', 'tokens.css');

function extractCssVars(cssContent: string, selector: string): Set<string> {
  // 抓 selector { ... --h18-foo: ...; ... } 內所有 --h18-* var name
  const blockRegex = new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`);
  const match = cssContent.match(blockRegex);
  if (!match) return new Set();
  const varRegex = /--h18-([a-zA-Z0-9-]+)\s*:/g;
  const keys = new Set<string>();
  let m;
  while ((m = varRegex.exec(match[1])) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

describe('TOKENS · tokens.ts shape', () => {
  it('exports the expected core color tokens', () => {
    // 從 prototype H18_THEMES 抄來的關鍵 tokens — 任何元件都會引用
    const required = [
      'bg', 'surface', 'surface2', 'rail', 'topbar',
      'border', 'borderSoft', 'divider',
      'text', 'textMid', 'textDim', 'textFaint', 'mono',
      'accent', 'hot', 'hotBg', 'urgent', 'dot',
      'invert', 'invertInk',
      'selBg', 'selBorder', 'todayBg', 'todayText',
      'rowHover', 'gridLine', 'gridLineSoft', 'chipBg',
      'scrim', 'shadow',
    ];
    for (const key of required) {
      expect(TOKENS, `TOKENS missing key: ${key}`).toHaveProperty(key);
    }
  });

  it('every TOKENS value is a CSS var() reference', () => {
    for (const [key, value] of Object.entries(TOKENS)) {
      expect(value, `TOKENS.${key} should be a var() reference`)
        .toMatch(/^var\(--h18-[a-zA-Z0-9-]+\)$/);
    }
  });

  it('TOKEN_KEYS lists all token names matching TOKENS object', () => {
    expect(new Set(TOKEN_KEYS)).toEqual(new Set(Object.keys(TOKENS)));
  });
});

describe('tokens.css ↔ tokens.ts sync', () => {
  const css = readFileSync(tokensCssPath, 'utf8');
  const lightVars = extractCssVars(css, ':root');
  const darkVars = extractCssVars(css, ':root.dark');

  it('every TOKENS key has a matching --h18-* var in :root (light)', () => {
    for (const key of TOKEN_KEYS) {
      // TOKENS.bg = 'var(--h18-bg)' → kebab-case: bg
      // TOKENS.borderSoft = 'var(--h18-border-soft)' → kebab-case: border-soft
      const cssKey = key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      expect(lightVars, `:root missing --h18-${cssKey} for TOKENS.${key}`)
        .toContain(cssKey);
    }
  });

  it('every TOKENS key has a matching --h18-* var in :root.dark', () => {
    for (const key of TOKEN_KEYS) {
      const cssKey = key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      expect(darkVars, `:root.dark missing --h18-${cssKey} for TOKENS.${key}`)
        .toContain(cssKey);
    }
  });

  it('no orphan --h18-* var in :root that is not in TOKENS', () => {
    const tokenKeys = new Set(
      TOKEN_KEYS.map((k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())),
    );
    for (const cssKey of lightVars) {
      expect(tokenKeys, `:root has orphan --h18-${cssKey} not in TOKENS`)
        .toContain(cssKey);
    }
  });
});
