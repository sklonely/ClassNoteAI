# H18 Modal Conventions

**版本**：v0.1.0（Phase 7 Sprint 0 落地）
**範圍**：H18 介面所有「浮動疊層」元素的行為與視覺規範 — Modal / Popover / Dropdown / Context Menu / Toast。

> **目的**：Sprint 3 多個 sub-agent 同時寫 dialog / picker / context menu，沒共同規範會炸 Z-index、Esc 行為各寫各的、focus trap 各搞一份。這份 doc 是權威來源。
>
> **依賴**：本文所有 z-index / 寬度 / duration / easing token 來自 `H18-DESIGN-SYSTEM.md` §4.4 + §4.5 + §5。**不允許 deviation**。如需新值 → 先回去改 DESIGN-SYSTEM + tokens.css，再回來改本文。

---

## 1 · 三種疊層的區分

H18 把「浮動在主流程上的元素」拆成三種，先決定類型再決定 z-index。

| 類型 | 用途 | Z-index token | 範例 |
|---|---|---|---|
| **Modal** | 阻斷主流程，需明確選擇 / 關閉 | `--h18-z-modal` (210) | `LectureEditDialog`、`AddCourseDialog`、`ConfirmDialog`（特例：用 `--h18-z-confirm` 310） |
| **Popover** | 附在 trigger 旁，點外即關，可在 modal 內部開啟 | `--h18-z-popover` (220) | `H18DayPicker`（在 LectureEditDialog 內）、`H18ContextMenu`、Sub-menu |
| **Dropdown** | trigger anchor，無 backdrop，純 menu 列表 | `--h18-z-dropdown` (100) | `ImportMenu`、`SortMenu`、`TaskIndicator panel` |

### 怎麼選？
- **要不要擋住整個畫面 / 強迫使用者回應？** → Modal
- **要不要在 modal 內彈出（例如 day picker 在 dialog 裡）？** → Popover（z-popover 220 比 z-modal 210 高）
- **只是個 menu 從 button 旁邊掉下來，無 backdrop？** → Dropdown

---

## 2 · Z-index stacking rule

完整 stack（取自 DESIGN-SYSTEM §4.4，**不可改**）：

```
--h18-z-base:      1     /* default flow */
--h18-z-rail:     10     /* 左側 rail */
--h18-z-topbar:   20     /* TopBar */
--h18-z-banner:   30     /* recovery hint / alignment banner */
--h18-z-fab:      40     /* DraggableAIFab */
--h18-z-dropdown:100     /* dropdown menu / select / tooltip */
--h18-z-overlay: 200     /* modal scrim 半透明 */
--h18-z-modal:   210     /* modal card */
--h18-z-popover: 220     /* popover (含 modal 內 day picker) */
--h18-z-toast:   300     /* 永遠浮 UI 最上層 */
--h18-z-confirm: 310     /* ConfirmDialog 比 toast 還高 */
```

### 規則
- **不可 hardcode `z-index: 9999`** — 全用 token
- Modal scrim 用 `--h18-z-overlay` (200)，modal card 用 `--h18-z-modal` (210)
- Popover 在 modal 內也是 `--h18-z-popover` (220) — 比 modal card 高才浮得上去
- Toast 永遠 `--h18-z-toast` (300) — 即使 modal 開著也要看得到
- ConfirmDialog 用 `--h18-z-confirm` (310) — 比 toast 高，因為需要明確互動
- Sub-menu（hover 出二層 menu）：跟 parent menu 同 `--h18-z-popover`，靠 DOM 順序疊在上面（不另開 z-index 數值）

### 為什麼這樣排？
- Popover > Modal：DayPicker 開在 LectureEditDialog 內必須浮在 dialog 上面
- Toast > Modal：使用者填表時，背景的 sync 失敗 toast 一定要看得到
- Confirm > Toast：confirm 是 hard interrupt，連 toast 都不能蓋

---

## 3 · Esc 行為

**核心原則：最頂層的東西先關。**

| 當下狀態 | 按 Esc | 結果 |
|---|---|---|
| Modal 開、無 popover | Esc | 關 modal |
| Modal 開、popover 開（如 DayPicker） | Esc | **只關 popover**，modal 仍開 |
| ConfirmDialog 開 | Esc | 等同 cancel（不執行動作） |
| Toast 顯示 | Esc | 不影響 toast（toast 自動 timeout） |
| Dropdown / ContextMenu 開 | Esc | 關 menu |
| Sub-menu 開（parent menu 也開） | Esc | 先關 sub-menu，再按一次關 parent |

### 實作建議

每個 Modal / Popover / Menu 自己掛 `keydown` listener：

```tsx
useEffect(() => {
  if (!open) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();   // 防止傳到 parent 再關一層
    onClose();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [open, onClose]);
```

**關鍵**：`e.stopPropagation()` **只在自己是頂層的時候才 stop**。實作上是 — 越晚 mount 的 listener 越晚 attach，事件 capture 順序自然由頂層先收，所以正確處理頂層即可，parent 不會再收到。

---

## 4 · Focus trap

### Modal 開啟時
- **Initial focus**：第一個 form input（沒 input 就第一個 button，例如 ConfirmDialog 的 cancel）
- **Tab 循環**：Tab / Shift+Tab 在 modal 內循環，不外洩到背景頁面
- **關閉時**：focus 回到觸發 modal 的 trigger element（避免 focus 跳到 `<body>`）

### 推薦寫共用 hook

Sprint 3 做 modal 真實作時提供：

```ts
useFocusTrap(containerRef, { initial?: 'first-input' | 'first-button' | HTMLElement });
```

本 doc 只規範介面，不寫實作。

### Popover / Dropdown
- **不需要 trap**（點外即關，鍵盤離開等於關閉）
- 但開啟時 focus 應落在第一個 menuitem（ContextMenu / sub-menu 用方向鍵 navigate）

---

## 5 · Backdrop / Scrim

### Modal scrim
- 背景：`background: var(--h18-scrim)`
- Light mode opacity：`0.4`
- Dark mode opacity：`0.6`
- Z-index：`var(--h18-z-overlay)` (200)
- **點 scrim 即關 modal** — **唯一例外是 `ConfirmDialog`**：必須明確按 cancel / confirm，避免使用者誤點消失。
- Scrim fade 動畫跟 card 同步（見 §7）

### Popover / Dropdown
- **不需要 scrim**
- 點外即關（透過 `mousedown` listener 偵測 target 不在 popover 內就 close）

### Toast
- 不需要 scrim
- 不阻斷互動

---

## 6 · ARIA

### Modal
```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title-id"
  aria-describedby="modal-desc-id"  // optional
>
  <h2 id="modal-title-id">...</h2>
</div>
```

### Popover
- 視內容用 `role="dialog"`（DayPicker、複雜 form-like popover）或 `role="menu"`（純列表 menu）
- 有 form 內容（DayPicker）→ `role="dialog"`
- 純選單（ContextMenu、ImportMenu）→ `role="menu"`

### ContextMenu / Sub-menu
```tsx
<ul role="menu">
  <li role="menuitem" tabIndex={0}>...</li>
  <li role="menuitem" tabIndex={0} aria-haspopup="menu">  {/* 有 sub-menu */}
    ...
  </li>
</ul>
```

### Toast
```tsx
<div role="status" aria-live="polite">...</div>
```
（不要用 `role="alert"` — 那是 ConfirmDialog 等級的中斷）

### 共通要求
- 第一個可 focus 元素 `aria-label` 對應功能
- 關閉 button 一律 `aria-label="關閉"`（或 trigger 對應動詞）
- 圖示 button 必須有 `aria-label`，不可只有 icon

---

## 7 · Animation

| 階段 | duration | easing |
|---|---|---|
| 開啟 | `var(--h18-duration-base)` (200ms) | `var(--h18-ease-spring)` |
| 關閉 | `var(--h18-duration-fast)` (120ms) | `var(--h18-ease-out)` |

### 規則
- Scrim fade in / out 跟 card 開關同步（同樣 duration + easing）
- Popover / Dropdown：開用 base + spring，關用 fast + ease-out（同 modal）
- Toast：滑入 base + spring，timeout 後 fade out fast + ease-out
- **不可寫 `transition: all 0.3s ease`** — 全用 token

### 範例

```css
.modalCard {
  transition:
    opacity var(--h18-duration-base) var(--h18-ease-spring),
    transform var(--h18-duration-base) var(--h18-ease-spring);
}

.modalCard[data-state='closed'] {
  transition:
    opacity var(--h18-duration-fast) var(--h18-ease-out),
    transform var(--h18-duration-fast) var(--h18-ease-out);
}
```

---

## 8 · Component 對應表

| Component | 類型 | Z-index token | 預設寬 | Esc 行為 | 點外關 |
|---|---|---|---|---|---|
| `LectureEditDialog` | Modal | `--h18-z-modal` (210) | `--h18-modal-w-sm` (480px) | close | yes |
| `AddCourseDialog` | Modal | `--h18-z-modal` (210) | `--h18-modal-w-md` (720px) | close | yes |
| `ProviderSetupModal` | Modal | `--h18-z-modal` (210) | `--h18-modal-w-sm` (480px) | close | yes |
| `CanvasPairingWizard` | Modal | `--h18-z-modal` (210) | `--h18-modal-w-md` (720px) | close | yes |
| `ConfirmDialog` | Modal | `--h18-z-confirm` (310) | `--h18-modal-w-sm` (480px) | cancel | **no** |
| `H18DayPicker`（在 modal 內） | Popover | `--h18-z-popover` (220) | content-fit | close popover only | yes |
| `H18ContextMenu` | Popover | `--h18-z-popover` (220) | content-fit | close | yes |
| Sub-menu (hover 出第二層) | Popover | `--h18-z-popover` (220, DOM 順序疊上) | content-fit | parent Esc 同關 | yes |
| `ImportMenu` | Dropdown | `--h18-z-dropdown` (100) | content-fit | close | yes |
| `SortMenu` | Dropdown | `--h18-z-dropdown` (100) | content-fit | close | yes |
| `TaskIndicator panel` | Dropdown | `--h18-z-dropdown` (100) | 320px | close | yes |
| Toast | Toast | `--h18-z-toast` (300) | depends（建議 ≤ 360px） | n/a | n/a |

### 寬度規則
- Modal 寬度**必須**從 `--h18-modal-w-sm` / `-md` / `-lg` 三選一（見 DESIGN-SYSTEM §5）
- 不可 hardcode `width: 500px`
- Popover / Dropdown 用 `width: max-content` 或內容驅動，但設 `min-width` / `max-width` 避免極端

---

## 9 · 違規檢查清單（給 code reviewer）

新增 / 改 modal / popover 的 PR 必須過：

- [ ] 沒 `z-index: <number>` — 全用 token (`var(--h18-z-modal)` 等)
- [ ] Modal 有 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
- [ ] Popover 有 `role="dialog"` 或 `role="menu"`（依內容）
- [ ] ContextMenu 用 `role="menu"` + items `role="menuitem"`
- [ ] Esc 真的可關 — 手動 verify（modal 內開 popover 時 Esc 只關 popover）
- [ ] 點 scrim 可關 modal（除 ConfirmDialog 外）
- [ ] Tab 不會跳出 modal — 手動 verify
- [ ] 開啟時 focus 落在第一個 input / button
- [ ] 關閉後 focus 回 trigger
- [ ] Modal 寬度從 `--h18-modal-w-sm/md/lg` 選 — 不 hardcode
- [ ] Animation 用 `--h18-duration-*` + `--h18-ease-*` token
- [ ] Toast 用 `role="status" aria-live="polite"`
- [ ] 圖示 button 有 `aria-label`

---

## 10 · 快速反例

```tsx
// ❌ 不要這樣
<div style={{ zIndex: 9999, position: 'fixed', width: 500 }}>
  <h2>Edit lecture</h2>
  <input />
</div>
```

```tsx
// ✅ 應該這樣
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="edit-lecture-title"
  className={styles.modalCard}  // CSS 用 token
>
  <h2 id="edit-lecture-title">Edit lecture</h2>
  <input ref={firstInputRef} />
</div>
```

```css
.modalCard {
  position: fixed;
  z-index: var(--h18-z-modal);
  width: var(--h18-modal-w-sm);
  background: var(--h18-surface);
  border-radius: var(--h18-radius-lg);
  box-shadow: var(--h18-shadow-lg);
  transition:
    opacity var(--h18-duration-base) var(--h18-ease-spring),
    transform var(--h18-duration-base) var(--h18-ease-spring);
}

.modalScrim {
  position: fixed;
  inset: 0;
  z-index: var(--h18-z-overlay);
  background: var(--h18-scrim);
  opacity: 0.4;
}

[data-theme='dark'] .modalScrim {
  opacity: 0.6;
}
```

---

## 11 · 參考

- Z-index / duration / easing token 來源：`H18-DESIGN-SYSTEM.md` §4.4 + §4.5
- Modal 寬度 token：`H18-DESIGN-SYSTEM.md` §5
- 實作參考：`src/components/ConfirmDialog.tsx`、`src/components/h18/AddCourseDialog.tsx`
- Token 定義：`src/styles/tokens.css` / `src/styles/tokens.ts`

修改本文時務必檢查與 `H18-DESIGN-SYSTEM.md` §4.4 / §5 一致 — 兩邊任何一邊改了 token 數值，另一邊必須同步。
