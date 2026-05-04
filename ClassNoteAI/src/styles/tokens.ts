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
  out:    'var(--h18-ease-out)',    // gentle ease-out
  inOut:  'var(--h18-ease-in-out)', // material standard
} as const;

/**
 * Spacing scale — 4px base，命名對照 tokens.css
 * Inline gap (icon + text) 用 s2-s3，row padding 用 s3-s4。
 */
export const SPACE = {
  s1:  'var(--h18-space-1)',
  s2:  'var(--h18-space-2)',
  s3:  'var(--h18-space-3)',
  s4:  'var(--h18-space-4)',
  s5:  'var(--h18-space-5)',
  s6:  'var(--h18-space-6)',
  s8:  'var(--h18-space-8)',
  s12: 'var(--h18-space-12)',
  s16: 'var(--h18-space-16)',
  s24: 'var(--h18-space-24)',
} as const;

/** Border radius scale — 預設 md (6px) */
export const RADIUS = {
  sm:   'var(--h18-radius-sm)',
  md:   'var(--h18-radius-md)',
  lg:   'var(--h18-radius-lg)',
  xl:   'var(--h18-radius-xl)',
  full: 'var(--h18-radius-full)',
} as const;

/** Type scale — font-size only */
export const TEXT = {
  xs:    'var(--h18-text-xs)',
  sm:    'var(--h18-text-sm)',
  base:  'var(--h18-text-base)',
  md:    'var(--h18-text-md)',
  lg:    'var(--h18-text-lg)',
  xl:    'var(--h18-text-xl)',
  '2xl': 'var(--h18-text-2xl)',
} as const;

/**
 * Line-height — 直接 number，給 inline style 用。
 * 不對應 var() 因為 line-height 用 number 比 var() 直觀。
 */
export const LEADING = {
  tight: 1.3,
  base:  1.55,
  loose: 1.75,
} as const;

/** Shadow scale — 兩主題各自定義，運行時 var() 自動 swap */
export const SHADOW = {
  sm: 'var(--h18-shadow-sm)',
  md: 'var(--h18-shadow-md)',
  lg: 'var(--h18-shadow-lg)',
} as const;

/** Z-index scale — 解 modal stacking */
export const Z = {
  base:     'var(--h18-z-base)',
  rail:     'var(--h18-z-rail)',
  topbar:   'var(--h18-z-topbar)',
  banner:   'var(--h18-z-banner)',
  fab:      'var(--h18-z-fab)',
  dropdown: 'var(--h18-z-dropdown)',
  overlay:  'var(--h18-z-overlay)',
  modal:    'var(--h18-z-modal)',
  popover:  'var(--h18-z-popover)',
  toast:    'var(--h18-z-toast)',
  confirm:  'var(--h18-z-confirm)',
} as const;

/** Animation duration tokens */
export const DURATION = {
  fast: 'var(--h18-duration-fast)',
  base: 'var(--h18-duration-base)',
  slow: 'var(--h18-duration-slow)',
} as const;

/** Component dimensions — layout / form / modal / side panel */
export const SIZE = {
  railWidth:     'var(--h18-rail-width)',
  topbarHeight:  'var(--h18-topbar-height)',
  buttonHeight:  'var(--h18-button-height)',
  inputHeight:   'var(--h18-input-height)',
  rowHeight:     'var(--h18-row-height)',
  rowHeightTall: 'var(--h18-row-height-tall)',
  modalWSm:      'var(--h18-modal-w-sm)',
  modalWMd:      'var(--h18-modal-w-md)',
  modalWLg:      'var(--h18-modal-w-lg)',
  tocWidth:      'var(--h18-toc-width)',
  tabWidth:      'var(--h18-tab-width)',
  previewWidth:  'var(--h18-preview-width)',
} as const;

/** Icon size scale */
export const ICON = {
  xs: 'var(--h18-icon-xs)',
  sm: 'var(--h18-icon-sm)',
  md: 'var(--h18-icon-md)',
  lg: 'var(--h18-icon-lg)',
  xl: 'var(--h18-icon-xl)',
} as const;
