/**
 * TS-side token references · v0.7.0 alpha
 *
 * 對應 tokens.css 內的 --h18-* 變數，給 .tsx 內動態取值用：
 *
 *   import { TOKENS } from '@/styles/tokens';
 *   <div style={{ color: TOKENS.text, padding: 14 }}>
 *
 * 對於純 .module.css 寫法，直接用 var(--h18-text) 即可，不必 import。
 * 這個 file 的存在是為了：
 *   1. 在 .tsx 內 dynamic style 想 type-safe 引 token (避免 typo)
 *   2. 給測試 / utility 引用 token 名稱
 *
 * camelCase (JS) ↔ kebab-case (CSS) 透過簡單規則轉換：
 *   borderSoft → --h18-border-soft
 *   text → --h18-text
 */

export const TOKENS = {
  // Surfaces
  bg:         'var(--h18-bg)',
  surface:    'var(--h18-surface)',
  surface2:   'var(--h18-surface2)',
  rail:       'var(--h18-rail)',
  topbar:     'var(--h18-topbar)',

  // Borders / dividers
  border:     'var(--h18-border)',
  borderSoft: 'var(--h18-border-soft)',
  divider:    'var(--h18-divider)',

  // Text scale
  text:       'var(--h18-text)',
  textMid:    'var(--h18-text-mid)',
  textDim:    'var(--h18-text-dim)',
  textFaint:  'var(--h18-text-faint)',
  mono:       'var(--h18-mono)',

  // Brand / accent
  accent:     'var(--h18-accent)',
  hot:        'var(--h18-hot)',
  hotBg:      'var(--h18-hot-bg)',
  urgent:     'var(--h18-urgent)',
  dot:        'var(--h18-dot)',

  // Inverted
  invert:     'var(--h18-invert)',
  invertInk:  'var(--h18-invert-ink)',

  // Selection / today / hover
  selBg:      'var(--h18-sel-bg)',
  selBorder:  'var(--h18-sel-border)',
  todayBg:    'var(--h18-today-bg)',
  todayText:  'var(--h18-today-text)',
  rowHover:   'var(--h18-row-hover)',

  // Calendar grid
  gridLine:     'var(--h18-grid-line)',
  gridLineSoft: 'var(--h18-grid-line-soft)',

  // Misc
  chipBg:     'var(--h18-chip-bg)',
  scrim:      'var(--h18-scrim)',
  shadow:     'var(--h18-shadow)',
} as const;

export type TokenKey = keyof typeof TOKENS;

/** 完整 token name 列表 — 給測試用 */
export const TOKEN_KEYS: TokenKey[] = Object.keys(TOKENS) as TokenKey[];

/**
 * Font / animation tokens — 不在主 TOKENS 內因為它們不是 colour
 * 也不會 theme-switch (兩主題共用)。
 */
export const FONTS = {
  sans:  'var(--h18-font-sans)',
  mono:  'var(--h18-font-mono)',
  serif: 'var(--h18-font-serif)',
} as const;

export const EASE = {
  spring: 'var(--h18-ease-spring)', // iOS spring · 全 H18 動畫共用
} as const;
