# CP-4 · Phase 4 Conditional UI 完成

**狀態**：等你 visual review。
**規則**：你昨晚明確指示「按 plan 推進，不要中間停，下次 review 是 Phase 5 結束」，所以 CP-4 + CP-5 兩份 walkthrough 一起寫，但 dev / app 沒有實際看過（CDP 在我這個 session 0 PowerShell 裡 WebView2 不開）。
**驗證**：vitest 526/526、tsc clean、vite build clean、token 值對 prototype JSX file-level review。**沒有 CDP 視覺截圖** — 早上你開 dev 自己看比較準。

**分支**：`feat/h18-design-snapshot`（worktree at `d:/ClassNoteAI-design/`）

## 新增 commits（從 CP-3 起）

```
6aec9f2 feat(h18-cp4): RecoveryPromptModal 換 H18 (warm scrim + accent header)
660d82a feat(h18-cp4): ErrorBoundary fallback 換 H18
0558d84 feat(h18-cp4): VideoPiP token-pass
aa37f2f feat(h18-cp4): UnofficialChannelWarning 換 H18
8b7110d feat(h18-cp4): AlignmentBanner 新元件 + NotesView 切換
```

5 個 commits，全部對應 V0.7.0-PLAN.md L283-294 的 Phase 4 變更清單。

## 啟動方式

```bash
cd d:/ClassNoteAI-design/ClassNoteAI
"C:\Users\asd19\scoop\apps\nodejs\24.10.0\node.exe" scripts/dev-ephemeral.mjs
```

或者，如果你昨晚的 PATH 修法（重建 nodejs/current junction）保住了：

```bash
cd d:/ClassNoteAI-design/ClassNoteAI
npm run dev:ephemeral
```

## 你應該會看到的（請逐項打 ✓ / ✗）

### 1 · RecoveryPromptModal（要觸發很麻煩 — 需要錄音中砍 app）
觸發方式：開錄音、用 task manager 砍 classnoteai.exe、再啟動。

- [ ] backdrop 是暖色半透明（不再純黑/60）+ 6px blur
- [ ] card 是 H18 surface + 14px radius + token shadow
- [ ] header：36×36 hot-bg 紅橘 chip + AlertTriangle icon
- [ ] 「CRASH RECOVERY」mono caps eyebrow + 標題 18px weight 800
- [ ] bulk 按鈕（>1 sessions 時）：全部還原是 invert chip primary、全部丟棄是 outlined
- [ ] 每 session row：標題 + mono meta（時長/日期/MB/字幕段數）+ 丟棄/還原 buttons
- [ ] 字幕段數 emerald-400 變成 var(--h18-accent) 橘色強調

### 2 · ErrorBoundary fallback（觸發要刻意 throw，正常看不到）
可以在 console 跑 `throw new Error('test')` 在 React tree 裡的元件。

- [ ] 全螢幕 var(--h18-bg) 暖色 backdrop
- [ ] 64×64 hot-bg 圓 + AlertTriangle，不再是純紅 red-500
- [ ] 「UNHANDLED EXCEPTION」mono caps + 標題 24px
- [ ] error message → mono code block (surface2 + token border)，最多 5 行 stack
- [ ] 重試 = invert chip / 刷新頁面 = outlined token

### 3 · VideoPiP（lecture 同時有 video + PDF 才看得到）
- [ ] border 用 token，dark mode 還是 rgba(white,0.12)
- [ ] drag handle：黑色漸層 + h18-text-faint mono「DRAG」caps；hover 變白

### 4 · UnofficialChannelWarning（第一次 ChatGPT OAuth 才會跳）
觸發：Settings → 雲端 AI 助理 → ChatGPT subscription → 登入

- [ ] 4px blur warm scrim backdrop
- [ ] card 是 H18 surface + 12px radius
- [ ] header：32×32 hot-bg 三角 icon
- [ ] 「UNOFFICIAL CHANNEL」mono eyebrow
- [ ] 取消 = outlined / 繼續登入 = invert chip primary

### 5 · AlignmentBanner（recording 模式 + AI 偵測到翻頁時跳）
觸發：recording mode + auto-follow off + AI 偵測 page change

- [ ] top center pill (60px from top)，不再 bottom 浮動
- [ ] var(--h18-surface) + 999 radius + token shadow
- [ ] accent ✦ icon + 「AI 偵測到老師翻到投影片」+ chip「p.X → p.Y」
- [ ] 略過 = outlined pill / 跳到 p.Y = invert chip
- [ ] 底部 8s 倒數 bar，h18-accent at 0.7 opacity
- [ ] 接受後 600ms 顯示「已接受 (NN%)」綠色 ✓ 才消失

## Phase 5 從 CP-5 看（下面那份）

CP-5.md 寫了 Phase 5 全部主頁面 (CourseListView / CourseDetailView /
NotesView / AIChatPanel) 的 walkthrough 和 commits。

## 我刻意還沒做的

1. **Phase 4 OAuth Flow Modal**（extras-oauth.jsx 後半段，OAuth 進行中的瀏覽器 mock + success / error step）— prototype 有但實際 app 沒這個 component，因為 OAuth 流程是直接開 system browser 然後等 callback，沒有 in-app 進行中 UI。所以不需要做。

2. **VideoPiP 視覺進階**（hover header auto-fade、resize handle、live badge、mock video gradient）— prototype 比現有實作豐富很多，但 plan 標「校對」級，所以只動色 token。

3. **AIChatPanel 內部 messages / markdown / RAG status / index progress / sessions list / input bar** — 這次只動了 shell + header + sessions row，內部 message bubbles / 「使用 RAG」switch / index progress bar / streaming state 還是 Tailwind blue/purple/green。Phase 5 後續 patch。

## 你 review 完之後

**A. 通過** → CP-5 也通過的話，可以拉 alpha.5/alpha.6 tag。

**B. 哪裡要改** → 在這個檔下面 markdown 寫，或在 CP-5 寫，我看了就改。

**驗證限制重申**：CDP 沒起來、我這次沒看過視覺。如果 review 時發現某個 token 對應錯（例如 hot 應該是 accent、或者 chip-bg 在 dark mode 太淺），就直接告訴我，我改。

我這邊已停在 commit `2952ff2`，dev session 全清掉了，PATH junction 修好等你 SSH 回來自己跑。
