# CP-1 · Phase 1 chrome 完成

**狀態**：等你 visual review。
**分支**：`feat/h18-design-snapshot`（worktree at `d:/ClassNoteAI-design/`）
**Phase 1 commits**（從 main 起）：

```
10f5918 feat(h18-p1): TDD TopBar shell + 替換 MainWindow header
ceb7d9b feat(h18-p1): TDD WindowControls (macOS-style traffic lights)
e25434c feat(h18-p1): TDD TaskIndicator 重做
4a4f511 feat(h18-p1): TDD ConfirmDialog 重做
1229f61 feat(h18-p1): TDD ToastContainer 重做 — H18 視覺 + CSS Modules + 雙風格
```

**+ Phase 0**（基底設施）：tokens.css / theme.ts / appearance settings / fonts / 全域 CSS reset。

**測試**：526 passed (從 main 的 482 多了 44 個新行為測試)。tsc clean，vite build clean。

---

## 你需要做什麼

跑起來 → 在 light + dark mode 各做一輪以下檢查 → 在每一項打 ✓ 或 ✗（✗ 請描述哪裡怪）。

```
cd d:/ClassNoteAI-design/ClassNoteAI
npm run tauri dev
```

### 1 · TopBar 視覺
- [ ] light: 背景比下方內容區「略亮一點」(暖白 #ffffff)，下緣 1px 暖灰 border
- [ ] dark: 背景比下方略深 (#1a1920)，整體偏暖紫黑
- [ ] 高度 46px (不過分擠)
- [ ] 字級 / 間距感覺對 — 不像 Tailwind 殘留

### 2 · TaskIndicator (右上角 ☁ icon)
- [ ] idle 顯示 ☁ cloud icon (細描邊，textDim 灰)
- [ ] 點擊 → dropdown 從上方淡入，320px 寬，圓角 10px，shadow 自然
- [ ] dropdown header：`TASKS · 0` mono 字 + `ONLINE` 綠膠囊 (含小綠點)
- [ ] dropdown body 顯示「✓ 全部任務已完成」(idle 狀態)
- [ ] 點外面 → dropdown 關
- [ ] 拔網路線 (或 chrome devtools throttle offline) → icon 變斜線 wifi (橘紅)
- [ ] dark mode: shadow 變深、cloud icon 顏色微調但仍清晰可辨

### 3 · Toast (隨便在 console: `import { toastService } from './services/toastService'; toastService.success('儲存成功', 'ML · L13')`)
- [ ] 右下出現卡片，左 3px 綠色條 (success type)
- [ ] 底下倒數 bar 從滿到空 (預設 ~4s)
- [ ] hover 整個卡片 → 倒數 bar pause (動畫凍結)
- [ ] 鬆開 → 從 pause 處繼續 (應該不會跳回去)
- [ ] error / warning / info 換不同色條 (紅 / 黃 / 藍)
- [ ] 多個 toast 同時出 → 從上往下堆疊 (不會擠在一起)

### 4 · Confirm dialog (隨便在 console: `import { confirmService } from './services/confirmService'; confirmService.ask({ title: '清除字幕？', message: '此動作不會刪除資料庫紀錄。' })`)
- [ ] 全屏 backdrop blur 4px (背景內容看得到但模糊)
- [ ] 卡片 420px 寬、置中、圓角、shadow 大
- [ ] 「確定」按鈕黑底白字 (light) / 白底黑字 (dark)
- [ ] 按 Escape → 取消 (resolves false)
- [ ] 按 Enter → 確認 (resolves true)
- [ ] 點背景 → 取消
- [ ] 帶 `variant: 'danger'` 試一次 → 標題前面 ⚠ icon、確定鈕 #e8412e 紅色

### 5 · 既有功能不破
- [ ] Home / Settings / Profile nav 按鈕在 TopBar 中央，點得到、active 高亮對
- [ ] 右上 Profile / Theme toggle 按鈕在
- [ ] 切 light/dark 按鈕轉得動，所有上面的元件都跟著切

---

## 我刻意還沒做的事

1. **WindowControls (traffic lights) 還沒 mount 到 TopBar 上**
   - 元件本身 (12px 紅黃綠 + hover glyph) 已經寫好、9 個測試都過
   - 但 `tauri.conf.json` 還是 `decorations: 預設 true` (有系統 title bar)
   - 如果現在 mount，會兩條 title bar 疊一起很醜
   - 你 review 過 TopBar 視覺 OK 後，下一步同時：flip `decorations: false` + `<TopBar showWindowControls>` + 處理 macOS hide-vs-quit 行為

2. **左側 Rail (icon 導覽) 還沒做** — 那是 Phase 2 的事。Nav 按鈕暫時還在 TopBar 中央，醜醜的但可用。

3. **暗黑模式下 toast type 色用了「lightened 課程色」這個設定** — 我寫了 `#5bd49a` (success) / `#ff8b6b` (error)，但沒跟你的 prototype 直接核對過 hex。看到的時候請特別留意。

---

## 如果哪裡爆掉

- **revert 到 Phase 0**：`git reset --hard d73b31a` (Phase 0 的最後一個 commit)
- **revert 整條 branch**：`git checkout main && git branch -D feat/h18-design-snapshot && git worktree prune`（Codex 工作不會被影響，他在不同 branch）
- **僅 revert 某個元件**：對應 commit hash 在最上方表格，`git revert <hash>`

---

## 你 review 完之後

1. 在這個檔案 (CP-1.md) 直接 markdown checkbox 打 ✓ / ✗ + comment
2. 跟我說「CP-1 過了」或「以下要改：…」
3. 通過 → 進 Phase 2 (Rail + 主視窗 layout 重整)
4. 沒通過 → 我看你的 comment 修，再回來 CP-1 retry
