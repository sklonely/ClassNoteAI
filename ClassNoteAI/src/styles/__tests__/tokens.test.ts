/**
 * tokens.ts / tokens.css 同步性測試 · v0.7.0 (Sprint 0 / S0.11)
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
import {
  TOKENS,
  TOKEN_KEYS,
  FONTS,
  EASE,
  SPACE,
  RADIUS,
  TEXT,
  LEADING,
  SHADOW,
  Z,
  DURATION,
  SIZE,
  ICON,
} from '../tokens';

const tokensCssPath = resolve(__dirname, '..', 'tokens.css');
const cssContent = readFileSync(tokensCssPath, 'utf8');

/** 抓 tokens.css 內所有 --h18-* var name (不分 selector) */
function extractAllCssVarNames(css: string): Set<string> {
  const re = /--h18-([a-zA-Z0-9-]+)\s*:/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.add(m[1]);
  }
  return out;
}

/** 抓某個 selector { ... } block 內所有 --h18-* var name */
function extractCssVarsForSelector(css: string, selector: string): Set<string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const out = new Set<string>();
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRegex.exec(css)) !== null) {
    const inner = blockMatch[1];
    const varRegex = /--h18-([a-zA-Z0-9-]+)\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = varRegex.exec(inner)) !== null) {
      out.add(m[1]);
    }
  }
  return out;
}

/** 從 'var(--h18-foo)' 字串挖出 'foo' */
function varNameFromRef(ref: string): string | null {
  const m = ref.match(/^var\(--h18-([a-zA-Z0-9-]+)\)$/);
  return m ? m[1] : null;
}

const ALL_CSS_VARS = extractAllCssVarNames(cssContent);
const LIGHT_VARS = extractCssVarsForSelector(cssContent, ':root');
const DARK_VARS = extractCssVarsForSelector(cssContent, ':root.dark');

// =============================================================
// 1. CSS ↔ TS 一致性 (broad)
// =============================================================

describe('tokens.css ↔ tokens.ts: every TS var() reference exists in tokens.css', () => {
  /** 所有 TS export group 的 ref 統一收集起來檢查 */
  const groups: Record<string, Record<string, string | number>> = {
    TOKENS: TOKENS as unknown as Record<string, string>,
    FONTS: FONTS as unknown as Record<string, string>,
    EASE: EASE as unknown as Record<string, string>,
    SPACE: SPACE as unknown as Record<string, string>,
    RADIUS: RADIUS as unknown as Record<string, string>,
    TEXT: TEXT as unknown as Record<string, string>,
    SHADOW: SHADOW as unknown as Record<string, string>,
    Z: Z as unknown as Record<string, string>,
    DURATION: DURATION as unknown as Record<string, string>,
    SIZE: SIZE as unknown as Record<string, string>,
    ICON: ICON as unknown as Record<string, string>,
  };

  for (const [groupName, group] of Object.entries(groups)) {
    it(`group ${groupName}: every var() ref points to an existing --h18-* in tokens.css`, () => {
      for (const [key, value] of Object.entries(group)) {
        if (typeof value !== 'string') continue;
        const varName = varNameFromRef(value);
        expect(varName, `${groupName}.${key} = ${value} not in var(--h18-foo) shape`).not.toBeNull();
        if (varName === null) continue;
        expect(
          ALL_CSS_VARS,
          `${groupName}.${key} → --h18-${varName} not defined in tokens.css`,
        ).toContain(varName);
      }
    });
  }

  it('LEADING uses raw numbers (no var() refs) — for inline-style line-height', () => {
    for (const [key, v] of Object.entries(LEADING)) {
      expect(typeof v, `LEADING.${key} should be a number`).toBe('number');
    }
  });
});

// =============================================================
// 2. 無 typo: 每個 var() ref 形狀正確
// =============================================================

describe('tokens.ts: every var() ref is well-formed', () => {
  const groupsToCheck: Record<string, Record<string, string | number>> = {
    TOKENS: TOKENS as unknown as Record<string, string>,
    FONTS: FONTS as unknown as Record<string, string>,
    EASE: EASE as unknown as Record<string, string>,
    SPACE: SPACE as unknown as Record<string, string>,
    RADIUS: RADIUS as unknown as Record<string, string>,
    TEXT: TEXT as unknown as Record<string, string>,
    SHADOW: SHADOW as unknown as Record<string, string>,
    Z: Z as unknown as Record<string, string>,
    DURATION: DURATION as unknown as Record<string, string>,
    SIZE: SIZE as unknown as Record<string, string>,
    ICON: ICON as unknown as Record<string, string>,
  };

  for (const [groupName, group] of Object.entries(groupsToCheck)) {
    it(`${groupName}: every value matches /^var\\(--h18-[a-zA-Z0-9-]+\\)$/`, () => {
      for (const [key, value] of Object.entries(group)) {
        if (typeof value !== 'string') continue;
        expect(value, `${groupName}.${key}`).toMatch(/^var\(--h18-[a-zA-Z0-9-]+\)$/);
      }
    });
  }
});

// =============================================================
// 3. 既有 TOKENS (color) 對 :root + :root.dark 雙主題對應
// =============================================================

describe('TOKENS (color tokens) 雙主題對應', () => {
  it('every TOKENS key has a matching --h18-* var in :root (light)', () => {
    for (const key of TOKEN_KEYS) {
      const cssKey = key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      expect(LIGHT_VARS, `:root missing --h18-${cssKey} for TOKENS.${key}`).toContain(cssKey);
    }
  });

  it('every TOKENS key has a matching --h18-* var in :root.dark', () => {
    for (const key of TOKEN_KEYS) {
      const cssKey = key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      expect(DARK_VARS, `:root.dark missing --h18-${cssKey} for TOKENS.${key}`).toContain(cssKey);
    }
  });

  it('exports the expected core color tokens (anti-typo guard)', () => {
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

  it('TOKEN_KEYS lists all token names matching TOKENS object', () => {
    expect(new Set(TOKEN_KEYS)).toEqual(new Set(Object.keys(TOKENS)));
  });
});

// =============================================================
// 4. SHADOW 雙主題對應 (sm/md/lg 在 light + dark 都要有)
// =============================================================

describe('SHADOW 雙主題對應', () => {
  it('每個 SHADOW key 在 :root 跟 :root.dark 都有對應 var', () => {
    for (const key of Object.keys(SHADOW)) {
      const cssKey = `shadow-${key}`;
      expect(LIGHT_VARS, `:root missing --h18-${cssKey}`).toContain(cssKey);
      expect(DARK_VARS, `:root.dark missing --h18-${cssKey}`).toContain(cssKey);
    }
  });
});

// =============================================================
// 5. Specific critical sampling (hardcoded sanity)
// =============================================================

describe('Critical token sampling (hardcoded sanity)', () => {
  it('SPACE.s4 = var(--h18-space-4)', () => {
    expect(SPACE.s4).toBe('var(--h18-space-4)');
  });

  it('SPACE.s24 = var(--h18-space-24)', () => {
    expect(SPACE.s24).toBe('var(--h18-space-24)');
  });

  it('RADIUS.full = var(--h18-radius-full)', () => {
    expect(RADIUS.full).toBe('var(--h18-radius-full)');
  });

  it('TEXT.base = var(--h18-text-base)', () => {
    expect(TEXT.base).toBe('var(--h18-text-base)');
  });

  it('TEXT["2xl"] = var(--h18-text-2xl)', () => {
    expect(TEXT['2xl']).toBe('var(--h18-text-2xl)');
  });

  it('SHADOW.md = var(--h18-shadow-md)', () => {
    expect(SHADOW.md).toBe('var(--h18-shadow-md)');
  });

  it('Z.modal = var(--h18-z-modal)', () => {
    expect(Z.modal).toBe('var(--h18-z-modal)');
  });

  it('Z.confirm > Z.toast (numerically; via parsing CSS values)', () => {
    // 從 css 文字直接抓數字驗證 — popover > modal > overlay > fab > banner > topbar > rail > base
    // 跟 spec H18-DESIGN-SYSTEM.md §4.4 對齊
    const pickZ = (name: string): number => {
      const re = new RegExp(`--h18-z-${name}\\s*:\\s*(\\d+)\\s*;`);
      const m = cssContent.match(re);
      if (!m) throw new Error(`--h18-z-${name} not found in tokens.css`);
      return parseInt(m[1], 10);
    };
    expect(pickZ('confirm')).toBeGreaterThan(pickZ('toast'));
    expect(pickZ('toast')).toBeGreaterThan(pickZ('popover'));
    expect(pickZ('popover')).toBeGreaterThan(pickZ('modal'));
    expect(pickZ('modal')).toBeGreaterThan(pickZ('overlay'));
    expect(pickZ('overlay')).toBeGreaterThan(pickZ('fab'));
    expect(pickZ('fab')).toBeGreaterThan(pickZ('banner'));
    expect(pickZ('banner')).toBeGreaterThan(pickZ('topbar'));
    expect(pickZ('topbar')).toBeGreaterThan(pickZ('rail'));
    expect(pickZ('rail')).toBeGreaterThan(pickZ('base'));
  });

  it('DURATION.base = var(--h18-duration-base)', () => {
    expect(DURATION.base).toBe('var(--h18-duration-base)');
  });

  it('EASE.spring still exists (preserved from v0.6)', () => {
    expect(EASE.spring).toBe('var(--h18-ease-spring)');
  });

  it('EASE.out + EASE.inOut newly added', () => {
    expect(EASE.out).toBe('var(--h18-ease-out)');
    expect(EASE.inOut).toBe('var(--h18-ease-in-out)');
  });

  it('SIZE.railWidth = var(--h18-rail-width)', () => {
    expect(SIZE.railWidth).toBe('var(--h18-rail-width)');
  });

  it('SIZE.modalWMd = var(--h18-modal-w-md)', () => {
    expect(SIZE.modalWMd).toBe('var(--h18-modal-w-md)');
  });

  it('ICON.md = var(--h18-icon-md)', () => {
    expect(ICON.md).toBe('var(--h18-icon-md)');
  });

  it('LEADING.base is the number 1.55 (not a var ref)', () => {
    expect(LEADING.base).toBe(1.55);
  });

  it('既有 --h18-shadow (no -sm/-md/-lg suffix) 仍然存在 (向後相容)', () => {
    // 大量 component .module.css 還在用 var(--h18-shadow)，不可刪
    expect(LIGHT_VARS).toContain('shadow');
    expect(DARK_VARS).toContain('shadow');
    expect(TOKENS.shadow).toBe('var(--h18-shadow)');
  });
});
