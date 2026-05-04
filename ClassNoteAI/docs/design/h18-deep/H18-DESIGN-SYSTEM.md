# H18 Design System

**版本**：v0.7.0（Phase 7 Sprint 0 落地）
**範圍**：ClassNote AI H18 介面所有 visual 規範 + token 系統。

> **不在範圍**：voice & tone（文案語氣 / 標點用法）— 另寫 `H18-WRITING-GUIDE.md`。

---

## 1 · 品牌定位

ClassNote 是給學生 / 學術工作者用的本機錄音 + AI 整理工具。視覺定位：

- **暖色為主、避免冷色純白純黑**：避開 SaaS 通用的「乾淨白底 + 灰文字」風，改走暖米紙感（淡米黃 #f5f2ea）+ 燙印紅褐
- **Notebook / 紙感**：邊框、間距、字體都向「深度閱讀的 marker / 重點」靠近，不向「dashboard」靠
- **Mono 字當資訊密度錨點**：時間戳 / kbd hint / model name 用 JetBrains Mono — 讓「這是技術細節」一目了然
- **Serif 留給數字英雄**：POverview 大數字（學習小時數）用 Fraunces，凸顯「這是學習成果」的儀式感

---

## 2 · 品牌色

### 2.1 主色：H18 Accent

```
Light: #d24a1a   ← burnt orange，主動作 CTA / 錄音 dot
Dark:  #ffab7a   ← peach，深色模式對應
```

**使用情境（白名單）**：
- 主要 CTA button（primary）
- Active state（選中的 row、active tab、active rail item）
- Recording dot（紅膠囊 + 錄音中 island）
- Focus ring（鍵盤 navigation focus 邊框）
- Course chip 用的 hash palette「最後選擇」之一
- 重要 link（hover state）

**禁止情境（黑名單）**：
- 大面積 fill background（會喧賓奪主）
- 純文字段落內顏色（保持 `--h18-text` 黑灰）
- 所有 disabled state（用 `--h18-text-faint`）

### 2.2 變體系統

```
--h18-accent       主品牌色（CTA / dot）
--h18-hot          次熱色（warning / urgent due-date / 紅按鈕）
--h18-hot-bg       hot 配的背景（半透明）
--h18-urgent       課堂作業逾期顯示
--h18-dot          錄音紅 dot（有 pulse）
```

`hot` vs `accent` 區分：
- `accent` = **動作邀請**（按我）
- `hot` = **狀態警示**（這條過期了）

### 2.3 Course palette（hash-based）

`courseColor.ts` 維護的 8 色，給課程 chip / 行事曆 event block 用：

```
#c44a24  warm red       (ML)
#9a4f1d  amber          (English)
#5a7a3e  sage           (Bio)
#3a6f8c  dusty blue     (Stats)
#7a3f6e  plum           (History)
#b56a18  burnt orange   (Algorithms)
#4a6f4a  moss           (Linear Algebra)
#94572a  bronze         (Physics)
```

**規則**：
- 課程 chip 用此色 + hash 決定，**不能讓使用者自由挑**（避免使用者選奇怪螢光綠）
- Course chip 是漸層 `linear-gradient(135deg, color, color+dd)`（dd = ~87% alpha）
- 只用於 chip / event block / 章節 marker 等 ≤ 60×60px 區域

### 2.4 中性色（surface / text）

#### Light mode

```
背景      bg          #f5f2ea  ← 主背景，米紙感
        surface     #ffffff  ← 卡片、modal
        surface2    #faf8f3  ← 次層卡片、hover
        rail        #efece4  ← 左側 rail
        topbar      #ffffff

邊框      border      #e8e3d6  ← 主分隔
        border-soft #efeae0  ← 細分隔
        divider     #ece7dc  ← row 分隔線

文字      text        #15140f  ← primary，近黑但暖
        text-mid    #5a564b  ← secondary
        text-dim    #908977  ← tertiary（hint）
        text-faint  #b9b2a0  ← disabled

互動      sel-bg      #fff6db  ← 選中背景（淡黃）
        sel-border  #e5a04a  ← 選中邊（琥珀）
        today-bg    #fff6db  ← 行事曆當日
        row-hover   #faf6ea  ← row hover
```

#### Dark mode

```
背景      bg          #16151a  ← 暖近黑、帶一點紫，不純黑
        surface     #1e1d24
        surface2    #252430
        rail        #1a1920
        topbar      #1a1920

文字      text        #f0ede4  ← 暖白，不純白
        text-mid    #b4afa0
        text-dim    #7d786a
        text-faint  #4f4b42

(其他 token 對應，見 tokens.css)
```

---

## 3 · 字體 Stack

### 3.1 三條 family

```css
--h18-font-sans:  'Inter', 'Noto Sans TC', system-ui, sans-serif;
--h18-font-mono:  'JetBrains Mono', 'Noto Sans Mono', Menlo, monospace;
--h18-font-serif: 'Fraunces', 'Noto Serif TC', Georgia, serif;
```

### 3.2 用法表

| 字體 | 用在哪 | 範例 |
|---|---|---|
| **sans** (預設) | 所有 body / UI / button / row text | TopBar 「ClassNote」、 Lecture title、 Modal 內所有 form |
| **mono** | 技術/識別資料 | 時間戳 `00:14:32`、kbd hint `⌘K`、model name `parakeet-int8`、course id（隱藏 debug） |
| **serif** | 純 hero number 數字儀式感 | POverview「2.4 小時」大字、AI Page header |

### 3.3 字級 scale (Type scale)

```css
--h18-text-xs:    9px;    /* eyebrow / kbd hint / row meta hint */
--h18-text-sm:   11px;    /* meta / row sub-text / hint */
--h18-text-base: 12px;    /* body row（多數 row 內容） */
--h18-text-md:   13px;    /* heading row / 強調 row */
--h18-text-lg:   16px;    /* page title / hero 副標 */
--h18-text-xl:   24px;    /* hero 標題 */
--h18-text-2xl:  40px;    /* big-hero 數字（POverview） */
```

**規則**：
- 用 token，不寫 hardcoded `font-size: 11px`
- xs / sm 用 mono 變字寬窄、強化「meta」感
- base / md 用 sans
- xl / 2xl 用 serif（hero 才用，一般 page title 用 sans + 16-18px）

### 3.4 Line height

```css
--h18-leading-tight:  1.3;   /* heading / hero / 短文字 */
--h18-leading-base:   1.55;  /* body / paragraph */
--h18-leading-loose:  1.75;  /* long form (review summary) */
```

---

## 4 · Spacing / Radius / Shadow / Z-index / Duration

### 4.1 Spacing scale (4px base)

```css
--h18-space-1:   4px;
--h18-space-2:   6px;
--h18-space-3:   8px;
--h18-space-4:  10px;
--h18-space-5:  12px;
--h18-space-6:  14px;
--h18-space-8:  16px;
--h18-space-12: 20px;
--h18-space-16: 24px;
--h18-space-24: 32px;
```

**規則**：
- Inline gap（icon + text、chip 間）：`space-2` ~ `space-3` (6-8px)
- Row 內 padding：`space-3` ~ `space-4` (8-10px)
- Card / section padding：`space-5` ~ `space-6` (12-14px)
- Page-level padding：`space-8` ~ `space-12` (16-20px)
- Section block 之間：`space-12` ~ `space-16`

### 4.2 Border radius

```css
--h18-radius-sm:    4px;   /* tag / chip / kbd hint */
--h18-radius-md:    6px;   /* button / input / row card (default) */
--h18-radius-lg:    8px;   /* modal / panel / large card */
--h18-radius-xl:   12px;   /* hero card / big-hero block */
--h18-radius-full: 999px;  /* pill / round dot */
```

預設用 `md` (6px) — 多數 button / input / 一般 card。

### 4.3 Shadow scale

```css
--h18-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
--h18-shadow-md: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.04);
--h18-shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.08), 0 24px 60px rgba(0, 0, 0, 0.12);
```

dark mode 對應：

```css
--h18-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
--h18-shadow-md: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 28px rgba(0, 0, 0, 0.5);
--h18-shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.5), 0 30px 80px rgba(0, 0, 0, 0.7);
```

**規則**：
- Row hover / active：用 `--h18-row-hover` 背景，**不用 shadow**
- 浮動元素 (dropdown / popover)：`shadow-md`
- Modal / Dialog scrim 上的 card：`shadow-lg`
- Toast：`shadow-md`
- AI fab：`shadow-md`

### 4.4 Z-index scale（解 Modal stacking 問題）

```css
--h18-z-base:      1;    /* default flow */
--h18-z-rail:     10;    /* 左側 rail */
--h18-z-topbar:   20;    /* TopBar */
--h18-z-banner:   30;    /* recovery hint / alignment banner */
--h18-z-fab:      40;    /* DraggableAIFab */
--h18-z-dropdown:100;    /* context menu / select / tooltip */
--h18-z-overlay: 200;    /* modal scrim 半透明 */
--h18-z-modal:   210;    /* modal card */
--h18-z-popover: 220;    /* day picker popover on top of modal */
--h18-z-toast:   300;    /* always on top of UI */
--h18-z-confirm: 310;    /* confirmService dialog 最頂 */
```

**規則**：
- DayPicker 開在 LectureEditDialog 內 → DayPicker 用 `z-popover`(220)，比 `z-modal`(210) 高
- Toast 比 modal / confirm 都高（重要訊息一定看得到）
- ConfirmDialog 比 toast 還高（需要使用者明確互動）
- Dropdown menu 在一般 page 內用 `z-dropdown`(100)，但在 modal 內也是這個 — modal 自己 z-modal 已經高
- 不可用 hardcoded `z-index: 9999`，全用 token

### 4.5 Animation duration + easing

```css
--h18-duration-fast: 120ms;   /* hover hint / icon spin */
--h18-duration-base: 200ms;   /* dropdown open / modal scrim */
--h18-duration-slow: 320ms;   /* page transition / streaming summary fade */

--h18-ease-spring: cubic-bezier(0.32, 0.72, 0, 1);  /* iOS-style spring */
--h18-ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* gentle ease-out */
--h18-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);    /* material standard */
```

**規則**：
- Hover / focus：用 `fast` + `ease-out`
- Dropdown / modal open：用 `base` + `ease-spring`
- Page mount：用 `slow` + `ease-out`
- Streaming summary 灰→黑 transition：用 `slow` + linear

---

## 5 · Component 尺寸標準

```css
/* Layout */
--h18-rail-width:    62px;
--h18-topbar-height: 44px;

/* Form / interactive */
--h18-button-height: 32px;
--h18-input-height:  32px;
--h18-row-height:    40px;     /* list row default */
--h18-row-height-tall: 56px;   /* lecture row / inbox row 帶副資訊 */

/* Modal sizes */
--h18-modal-w-sm: 480px;       /* LectureEditDialog / ProviderSetupModal */
--h18-modal-w-md: 720px;       /* AddCourseDialog / CanvasPairingWizard */
--h18-modal-w-lg: 960px;       /* （reserved，目前沒用） */

/* Side panels */
--h18-toc-width: 220px;
--h18-tab-width: 420px;        /* ReviewPage 右側 tabs */
--h18-preview-width: 380px;    /* HomeLayout A 右側 preview */
```

**規則**：
- 不要寫 `width: 32px` 給 button — 用 `height: var(--h18-button-height)` + content-driven width
- Modal 必須用 token 寬度，不能 `width: 500px` 隨手寫

---

## 6 · Iconography

### 6.1 兩套並存（不要再加第三套）

| 來源 | 用途 | 規則 |
|---|---|---|
| **lucide-react** (pkg) | 多數 UI icon — Home / BookText / Sparkles / Calendar / Mic 等 | size 預設 14-16px，stroke-width 1.5 |
| **手畫 SVG**（component 內 inline） | H18 prototype 來的特殊圖形：H18TopBar logo「C」、TaskIndicator cloud / wifi / spinner、WindowControls traffic lights | viewBox="0 0 20 20"，stroke 用 `currentColor` |

### 6.2 size scale

```css
--h18-icon-xs: 10px;   /* eyebrow icon (✉ ⌕) */
--h18-icon-sm: 12px;   /* row icon */
--h18-icon-md: 14px;   /* button icon (default) */
--h18-icon-lg: 16px;   /* nav icon (rail) */
--h18-icon-xl: 24px;   /* empty state icon / hero badge */
```

### 6.3 規則

- **千萬不要混三套**（已有 lucide + 手畫，不要再加 react-icons / heroicons）
- 新 surface 優先選 lucide；只在 lucide 沒有對應的時候畫 SVG
- 所有 SVG 用 `currentColor`（不 hardcode 顏色），讓 component 用 `color: var(--h18-accent)` 控制
- stroke 一律 `1.5`（Lucide default），fill 通常 `none`
- 不用 emoji 當 icon（無法跨平台一致；Win 跟 macOS 看起來不同）

### 6.4 特殊 icon convention

| 情境 | 慣用 |
|---|---|
| 新增 / 加 | `+` 純文字大字（H18Rail），或 lucide `<Plus />` |
| 編輯 | `✎` 純文字（hero），或 lucide `<Pencil />` |
| 刪除 | lucide `<Trash2 />` 或文字「刪除」 |
| 確認 / done | `✓` 純文字 |
| 失敗 / 錯誤 | `⚠` 純文字 |
| 錄音中 | 紅 dot circle（不用 mic icon）+ pulse |
| AI 助教 | `✦` 純文字 sparkle，或 lucide `<Sparkles />` |
| 標記考點 | `⚑` flag 純文字 |
| 字幕 | lucide `<FileText />` |

---

## 7 · 用法 cheat sheet（給 sub-agent 寫 module.css 時對照）

```css
/* ❌ 不要這樣寫 */
.row {
  padding: 14px;
  border-radius: 6px;
  font-size: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  background: #ffffff;
  color: #15140f;
  z-index: 100;
  transition: all 0.2s ease;
}

/* ✅ 應該這樣寫 */
.row {
  padding: var(--h18-space-6);
  border-radius: var(--h18-radius-md);
  font-size: var(--h18-text-base);
  box-shadow: var(--h18-shadow-sm);
  background: var(--h18-surface);
  color: var(--h18-text);
  z-index: var(--h18-z-dropdown);
  transition: all var(--h18-duration-base) var(--h18-ease-out);
}
```

---

## 8 · 例外條款

很少數情況可以 hardcode：
- 純粹幾何 SVG path（`d="M5 13.5 Q3.2..."` 內的座標）
- 算法產生的數值（`width: ${progress}%` template literal）
- 跟 token 系統明確不對應的 magic value（例如 8-bit shadow `dd` opacity、CSS hack）

但**不要 hardcode 顏色 / spacing / radius / z-index / font-size**。99% 的情況都有對應 token。

如果你發現需要新增 token，**寫進這份 doc + tokens.css 同步更新**，不要直接在 module.css 寫死數字。

---

## 9 · 參考

- 主 prototype 來源：`docs/design/h18-deep/h18-theme.jsx`（H18_THEMES object 是真理）
- TS 端引用：`src/styles/tokens.ts`
- CSS 端引用：`src/styles/tokens.css`
- 課程色 palette：`src/components/h18/courseColor.ts`

修改任何 token 時，**請務必同步**這 4 個檔案 + 這份 doc。
