# H18 TaskIndicator · Dual-Source Merge Spec

> Phase 7 Sprint 0 task **S0.15** — schema 規範 (PHASE-7-PLAN §9.8 N4)
> 對齊：§9.4 W18 (toast)、§9.3 R-1 (logout reset)、§8.1 V15 (TaskTracker 持久化)、§2 Sprint 2 (TaskIndicator 改造)
> 狀態：規範文件，無實作。Sprint 2 sub-agent 寫 `TaskIndicator.tsx` 時必讀。

---

## 0 · 為什麼有這份 doc

H18 TopBar 的 TaskIndicator (`ClassNoteAI/src/components/TaskIndicator.tsx`) 在 Phase 7 之後會同時餵兩個 data source：

1. **既有** `offlineQueueService` — Tauri-native 推 sync queue（`AUTH_REGISTER` / `PURGE_ITEM` / `TASK_CREATE` 等，sessionStorage + Rust `pending_actions` 表持久化）。
2. **新加** `taskTrackerService` — Phase 7 Sprint 2 引入的純前端 in-memory background task tracker（`summarize` / `index` / `export`）。

兩者**都會**在同一個 28×28 indicator + dropdown 中顯示。沒寫死合併邏輯會撞牆：

- ID space 撞（兩邊都用 `crypto.randomUUID()` 出來的 string）。
- 數量加總邏輯不一致（active 是 `pending|processing|failed` 還是 `running|queued`？）。
- 取消按鈕的對應錯亂（誰負責 cancel offlineQueue task？答：**沒人** — queue 不可逆）。
- W18 toast 兩邊都跳會吵雙重音。

這份 doc 把這些釘死。**Sprint 2 寫 TaskIndicator 時必須完全照本文照辦**；任何偏離請改本文先。

---

## 1 · 兩個 source 對照表

| 屬性 | `offlineQueueService` (既有) | `taskTrackerService` (Phase 7 新) |
|---|---|---|
| 持久化 | sessionStorage (FE) + Rust DB `pending_actions` 表 | sessionStorage（per session, 重整網頁救回） + 重啟後從 `pending_actions` 重跑（V15 重用） |
| 任務類型 (kind) | `AUTH_REGISTER` / `PURGE_ITEM` / `TASK_CREATE` / `SUMMARIZE_LECTURE` / `INDEX_LECTURE` (V15 新增) | `'summarize'` / `'index'` / `'export'` |
| 進度 | 0–100 整數（少數 kind 有，多數沒）；以 `status` 為主 | 0–1 float (`progress`) |
| Status 集合 | `'pending' \| 'processing' \| 'failed' \| 'completed'` | `'queued' \| 'running' \| 'done' \| 'failed'` |
| 跨重啟 | 重啟自動 retry（init 時 reset 卡住的 `processing` → `pending`） | 重啟後從 `pending_actions` 重跑 (V15) |
| Cancel | **不允許**（已寫 queue 不可逆，processor 跑到完為止） | **允許**（每個 task 一個 `AbortController`，W8） |
| 失敗重試 | exponential backoff 自動 (`retryCount` 0→3，pow(2)*1000ms) | 顯示 retry button，使用者觸發；不自動 |
| Concurrency cap | Rust 端決定（FE 不管） | TaskTracker queue priority；同時最多 2 個 LLM 調用（§5 風險表） |
| Memory ceiling | Rust 端決定（FE 不管） | max 100 個 entries (cleanup oldest done) |
| Owner pane | App-wide / system (login / sync / delete) | per-lecture LLM background work |

> 註：`SUMMARIZE_LECTURE` / `INDEX_LECTURE` (V15) 是 **offlineQueue 的 actionType** — 用來在 app close / 重啟時把未完的 LLM 任務排隊重跑。它**不是** taskTracker 的直接資料；taskTracker 在啟動時讀 `pending_actions` 表把這些 actionType 翻成 `kind: 'summarize' | 'index'` task 重起。也就是說：**同一筆工作可能在兩個 source 各出現一次**（offlineQueue 那筆是「重啟後待重起」，taskTracker 那筆是「正在重跑」）— §6 講怎麼去重。

---

## 2 · 統一顯示模型 `UnifiedTask`

```ts
// src/types/taskIndicator.ts (Sprint 2 新建)

export type UnifiedTaskStatus = 'queued' | 'running' | 'done' | 'failed';
export type UnifiedTaskSource = 'offline-queue' | 'tracker';

export interface UnifiedTask {
  /** Namespaced ID; format: `'queue:<rawId>'` 或 `'tracker:<rawId>'`. 必 strip prefix 才是原 service ID. */
  id: string;
  source: UnifiedTaskSource;
  /** raw kind from source — `'AUTH_REGISTER'` / `'summarize'` 等. UI 不直接顯示，要 map 成 label. */
  kind: string;
  /** i18n-friendly 中文 label, e.g. `'生成摘要'` / `'用戶註冊'`. */
  label: string;
  /** 0–1 float. queue 端沒進度時 fill 0 (queued) / 0.5 (processing) / 1 (done) 假值. */
  progress: number;
  status: UnifiedTaskStatus;
  /** queue: false（queue 不可逆）; tracker: true. */
  cancelable: boolean;
  /** queue: false（自動 backoff 重試，不需要 user action）; tracker failed: true. */
  retriable: boolean;
  /** ms epoch. */
  startedAt: number;
  /** failed 時填. */
  error?: string;
  /** 選用 — 給 ReviewPage 訂閱 filter 用 (taskTracker only). */
  lectureId?: string;
}

export function adaptOfflineQueueItem(item: PendingAction): UnifiedTask;
export function adaptTaskTrackerEntry(entry: TaskTrackerEntry): UnifiedTask;
```

### Adapter 規則

#### 2.1 `adaptOfflineQueueItem(item: PendingAction): UnifiedTask`

```
id        = `queue:${item.id}`
source    = 'offline-queue'
kind      = item.actionType
label     = OFFLINE_QUEUE_LABELS[item.actionType] ?? item.actionType
progress  = item.status === 'completed' ? 1
          : item.status === 'processing' ? 0.5
          : item.status === 'failed' ? 0     // 顯示在 failed 區，不算 progress
          : 0                                // pending
status    = item.status === 'pending'    ? 'queued'
          : item.status === 'processing' ? 'running'
          : item.status === 'failed'     ? 'failed'
          : /* 'completed' */              'done'
cancelable = false
retriable  = false  // backoff 自動跑，不需要 user retry button
startedAt  = item.createdAt ?? Date.now()  // 既有 schema 沒 createdAt 的話 fallback
error      = item.lastError ?? undefined
lectureId  = undefined  // queue 不關心 lecture context
```

`OFFLINE_QUEUE_LABELS` map（已存於 `TaskIndicator.tsx` v0.7.0 ACTION_LABEL）擴充 V15：

```ts
const OFFLINE_QUEUE_LABELS: Record<ActionType, string> = {
  AUTH_REGISTER:      '用戶註冊',
  PURGE_ITEM:         '永久刪除',
  TASK_CREATE:        '任務建立',
  SUMMARIZE_LECTURE:  '生成摘要（重啟續跑）',  // V15
  INDEX_LECTURE:      '建立索引（重啟續跑）',  // V15
};
```

#### 2.2 `adaptTaskTrackerEntry(entry: TaskTrackerEntry): UnifiedTask`

```
id        = `tracker:${entry.id}`
source    = 'tracker'
kind      = entry.kind                      // 'summarize' | 'index' | 'export'
label     = entry.label                     // tracker 自帶（caller 起 task 時填中文）
progress  = entry.progress                  // 0–1 float, pass-through
status    = entry.status                    // 1:1 對齊（tracker shape 已經是 4 狀態）
cancelable = entry.status === 'queued' || entry.status === 'running'
retriable  = entry.status === 'failed'
startedAt  = entry.startedAt
error      = entry.error
lectureId  = entry.lectureId
```

---

## 3 · ID 命名空間與 dispatch

**強制 prefix**：

- offlineQueue 來的 → `queue:` + rawId
- tracker 來的 → `tracker:` + rawId

UI render 時 strip prefix（不曝光給使用者）；做動作（cancel / retry）時 dispatch 到對應 service：

```ts
function handleCancel(task: UnifiedTask) {
  if (!task.cancelable) return;  // queue 永遠 false，UI 也不應該顯示 button
  const colonIdx = task.id.indexOf(':');
  const source = task.id.slice(0, colonIdx);
  const rawId = task.id.slice(colonIdx + 1);
  if (source === 'tracker') {
    taskTrackerService.cancel(rawId);
  }
  // source === 'queue' 不允許 cancel — UI 根本不會給 button，這分支不該到
}

function handleRetry(task: UnifiedTask) {
  if (!task.retriable) return;
  const rawId = task.id.slice(task.id.indexOf(':') + 1);
  if (task.source === 'tracker') {
    // 砍掉舊 failed entry + 用同 kind/label/lectureId 起新 task
    taskTrackerService.retry(rawId);
  }
  // queue 端沒有 manual retry — 自動 backoff
}
```

> 用 `indexOf(':')` 而不是 `split(':', 2)` 因為 rawId 雖然是 UUID 沒有 colon，但保險起見不要 split 掉中間的 colon。

---

## 4 · Active count 邏輯

TopBar 的 indicator badge 顯示**「running + queued」總數**（不含 failed、不含 done）：

```ts
const active = [
  ...offlineQueue.getActive().map(adaptOfflineQueueItem),
  ...taskTrackerService.getActive().map(adaptTaskTrackerEntry),
].filter(t => t.status === 'running' || t.status === 'queued').length;
```

> **`getActive()` 定義**：
> - `offlineQueueService.getActive()` 回傳 `status in ('pending', 'processing', 'failed')` 的 actions（既有 `notifyListeners` 邏輯一致）。
> - `taskTrackerService.getActive()` 回傳 `status !== 'done'`（含 failed，因為要顯 retry）。
> - **adapter 之後再 filter**，避免兩邊定義漂移。
>
> **failed 計入 dropdown，但不計入 badge 數字**。badge 只給 running/queued 看，failed 透過 dropdown 紅色 row + retry 處理。如果有 failed 沒 running/queued，icon 從 idle 雲變黃 ! icon (見 §10)。

### 4.1 Idle / hide 條件

兩個 source `getActive()` 都回 `[]` ⇒ `active = 0`，**indicator 不消失**（既有 v0.7.0 idle 是 ☁ cloud icon），但 dropdown 顯示 empty state「✓ 全部任務已完成」。離線時改顯 wifi-off 圖。

---

## 5 · Sort order in dropdown

list 內的 row 按以下順序：

1. **running** — `status === 'running'`，子序：`startedAt` 升冪（先開的先到頂）
2. **queued** — `status === 'queued'`，子序：`startedAt` 升冪
3. **failed** — `status === 'failed'`，子序：`startedAt` 降冪（最新失敗的先看到）；retriable=true 的 row 顯紅 + retry button
4. **done** — `status === 'done'`，子序：完成時間降冪；done 5 秒後自動從 list 移除（§6）

```ts
const STATUS_ORDER = { running: 0, queued: 1, failed: 2, done: 3 };

const sorted = [...merged].sort((a, b) => {
  const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (so !== 0) return so;
  if (a.status === 'failed' || a.status === 'done') {
    return b.startedAt - a.startedAt;  // 新→舊
  }
  return a.startedAt - b.startedAt;     // 舊→新
});
```

---

## 6 · Done 後行為（去重 + 5s 淡出 + W18 toast）

### 6.1 自動移除

| Source | 移除策略 |
|---|---|
| offlineQueueService | service 自己負責：completed action 立即從 `pending_actions` 表 remove (`remove_pending_action`)。FE list 不會再看到。 |
| taskTrackerService | service 自己負責：done 後 5 秒從 `getActive()` 結果移除（內部標記 + setTimeout）。Component 內可以用 fadeout 動畫。 |

> 兩邊都 done 同一筆工作（V15 場景：app 關掉 → queue 排了 SUMMARIZE_LECTURE → 重啟 → tracker 從 queue 拉出來重跑 → tracker 跑完 → tracker 通知 queue mark completed）的去重：**queue 不曝光 SUMMARIZE_LECTURE / INDEX_LECTURE 給 UI**（在 adapter 端 filter 掉這兩個 actionType；它們純粹是 queue 「上次沒做完，這次重跑」的內部記號）。所以同一筆工作只會以 tracker 身份出現。

```ts
// adaptOfflineQueueItem 補一條前置守衛：
if (item.actionType === 'SUMMARIZE_LECTURE' || item.actionType === 'INDEX_LECTURE') {
  return null;  // 由 taskTracker 接手顯示
}
// caller (component) 用 .filter(Boolean as any) 去掉 null
```

### 6.2 W18 sticky toast — 只由 tracker 觸發

> §9.4 W18：「TaskTracker task done 跳一條 sticky toast『✦ ML L4 摘要已完成』」

- **只 tracker 端 emit toast**（透過 `toastService` 或 H18 自己的 toast hook）。
- offlineQueue done 不 emit toast（它原本就沒有；既有 v0.7.0 沒 toast）。
- 規定原因：避免 V15 重啟續跑場景下 queue + tracker 雙重觸發。

W18 toast 規格（給 tracker side 看）：

```
icon:    ✦ (accent color #d24a1a)
title:   ‹label›  // tracker entry 的 label，如「ML L4 摘要」
message: 「已完成」 / 「索引已完成」 / 「匯出已完成」(by kind)
sticky:  true (使用者按 ✕ 才消失)
action:  [前往] → nav 到 review:cid:lid (有 lectureId 才顯示)
```

W17 (toast coalescing) 不影響本規範 — coalescing 是 stop pipeline 內部的事。

---

## 7 · Failure 處理

### 7.1 offlineQueue failure

- 4xx / 5xx → `retryCount++`，`status='pending'`，跑 exponential backoff（`pow(2, n) * 1000` ms）
- 達 maxRetries (3) → `status='failed'` 永久失敗
- TaskIndicator 在那段期間顯示「`label` · 重試中 (N/3)」**黃字**（不是紅）
- 達上限 → 紅字 + retriable=false（沒 button）
- 使用者自己 hard delete / 重啟 / 等下一次 sync window

### 7.2 tracker failure

- LLM 拒（HTTP 4xx / 429 / 5xx / abort 以外的 throw）→ tracker 標 `failed` + `error` 填字串
- TaskIndicator row 顯**紅字** + `[重試]` button
- 點按 → `taskTrackerService.retry(rawId)`：service 內部 cancel old entry (cleanup) + 用同 (kind, label, lectureId) start 新 task
- ReviewPage 在 summary tab 也獨立顯 retry button（不只 indicator）— 同個 dispatch path
- Abort（user cancel）走另一條：tracker 標 `done` 不是 `failed`，且不 emit W18 toast

---

## 8 · Memory ceiling

| Source | 上限策略 |
|---|---|
| offlineQueue | Rust 端決定（FE 不管）。`pending_actions` 表理論可無限長；目前 Rust 沒實作 cap，未來進 backlog。 |
| tracker | **max 100 個 entries**。超過時 cleanup oldest `done`（不動 running/queued/failed，避免砍掉使用者要重試的）。100 用完都還是 non-done → 拒新 start + console.warn（這是 logic bug 等級狀況，正常 use case 達不到）。 |

實作住 `taskTrackerService` 內部 `enforceCap()` private method，每次 `start` / `complete` / `fail` 結尾呼叫一次。

---

## 9 · Reset on logout (R-1)

對齊 §9.3 R-1：「logout 一併呼叫 `recordingSessionService.reset()` + `taskTrackerService.cancelAll()` 不只 keyStore」。

logout flow：

```ts
async function logout() {
  // ... 既有 keyStore 清空, AppSettings 清, ...
  recordingSessionService.reset();
  taskTrackerService.cancelAll();      // R-1: 全部 abort + 清空 active
  await offlineQueueService.flushPending();  // 既有；processor 跑完現有 queue
  // TaskIndicator subscribe 收到兩邊都空 → dropdown 顯 empty state；icon 回 idle 雲
}
```

> `taskTrackerService.cancelAll()` 內部：iterate active entries → 每個叫 `abortController.abort()` + 標 `done`（不是 failed，避免炸 W18 toast）+ 清 sessionStorage。
>
> `offlineQueueService.flushPending()`：v0.7.0 既有方法名是 `processQueue()`；S0.15 doc 引用 PLAN 用語 `flushPending()`，實際 Sprint 2 sub-agent 看到 service 已是 `processQueue()` 就直接用，不要改名。**規範意圖 = 走完現有 queue，不新建 task**。

logout 不清 `pending_actions` 表中的 V15 LLM task（SUMMARIZE_LECTURE / INDEX_LECTURE）— 那是 user_id-scoped 的工作，下次同 user 登入續跑。

---

## 10 · Icon visual state matrix

對齊 v0.7.0 既有三狀態 + 加上 failed 狀態：

| 條件 | Icon | Color token | Badge |
|---|---|---|---|
| `!online` && `!hasActivity` | `WifiOffIcon` (斜線) | `--color-hot` (紅) | 無 |
| `online` && `active === 0` && `failedOnly === 0` | `CloudIcon` (☁) | `--color-text-dim` | 無 |
| `online` && `active > 0` | `SpinnerIcon` (旋轉) | `--color-text-strong` | `active`（白底深字） |
| `online` && `active === 0` && `failedOnly > 0` | `CloudIcon` + 角落紅點 | `--color-text-dim` + `--color-hot` 點 | 無數字（避免與 active 混淆） |
| `!online` && `hasActivity` | `WifiOffIcon` | `--color-hot` | `active`（hot 底） |

`failedOnly = merged.filter(t => t.status === 'failed').length`。

---

## 11 · Sub-agent 注意事項（給 Sprint 2 寫 TaskIndicator 的人看）

### 11.1 Imports

```ts
import { offlineQueueService, type PendingAction } from '../services/offlineQueueService';
import { taskTrackerService, type TaskTrackerEntry } from '../services/taskTrackerService';
import { adaptOfflineQueueItem, adaptTaskTrackerEntry, type UnifiedTask } from '../types/taskIndicator';
```

### 11.2 Subscribe 模式

```tsx
const [queueItems, setQueueItems] = useState<PendingAction[]>([]);
const [trackerItems, setTrackerItems] = useState<TaskTrackerEntry[]>([]);

useEffect(() => {
  return offlineQueueService.subscribe(async () => {
    setQueueItems(await offlineQueueService.listActions());
  });
}, []);

useEffect(() => {
  return taskTrackerService.subscribe(() => {
    setTrackerItems(taskTrackerService.getActive());
  });
}, []);
```

### 11.3 Merge in `useMemo`

避免每 render 都跑 sort：

```tsx
const merged = useMemo<UnifiedTask[]>(() => {
  const a = queueItems.map(adaptOfflineQueueItem).filter((x): x is UnifiedTask => x !== null);
  const b = trackerItems.map(adaptTaskTrackerEntry);
  const STATUS_ORDER = { running: 0, queued: 1, failed: 2, done: 3 };
  return [...a, ...b].sort((x, y) => {
    const so = STATUS_ORDER[x.status] - STATUS_ORDER[y.status];
    if (so !== 0) return so;
    if (x.status === 'failed' || x.status === 'done') return y.startedAt - x.startedAt;
    return x.startedAt - y.startedAt;
  });
}, [queueItems, trackerItems]);

const activeCount = useMemo(
  () => merged.filter(t => t.status === 'running' || t.status === 'queued').length,
  [merged],
);
```

### 11.4 Test hooks

- 觸發按鈕 `data-testid="task-indicator"`（既有 v0.7.0 沒設，Sprint 2 補）
- Dropdown `data-testid="task-dropdown"`（既有有）
- Badge `data-testid="task-count-badge"`（既有有）
- Failed row `data-testid="task-row-failed"`，retry button `data-testid="task-retry-${rawId}"`
- Cancel button `data-testid="task-cancel-${rawId}"`

### 11.5 Token usage

依 §9.8 Design System 萃取，**禁止 hardcode 顏色 / spacing / radius / font-size / z-index / duration**。所有值走 `tokens.css` / `tokens.ts`。新加的 row 樣式如 failed 紅、retry button hover 也走 token（`--color-hot` 等）。

### 11.6 i18n

label / status text 都走前文 §2.1 的 `OFFLINE_QUEUE_LABELS` map 跟 tracker 自帶 label（caller 起 task 時填中文）。**TaskIndicator component 不該有任何中文 hardcode 在 row body 內**（除了 empty state、connection pill 那種固定 UI 字）。

---

## 12 · 對齊確認

| PLAN ref | 內容 | 本 doc 章節 |
|---|---|---|
| §9.8 N4 | dual source schema 規範 | 整份（核心） |
| §2 Sprint 2 (TopBar TaskIndicator 改造) | subscribe taskTrackerService、active badge、cancel button、5s 淡出 | §3 / §4 / §6 |
| §2 Sprint 2 (taskTrackerService shape) | shape: id/kind/label/lectureId/progress/status/startedAt/error | §2.2 / `TaskTrackerEntry` import |
| §8.1 V15 | TaskTracker 持久化重用 pending_actions 表 | §1 / §6.1 去重邏輯 |
| §9.3 R-1 | logout 呼叫 cancelAll | §9 |
| §9.4 W17 | Toast coalescing | §6.2 註明不衝突 |
| §9.4 W18 | TaskTracker done sticky toast | §6.2（規定**只 tracker emit**）|
| §9.4 W8 | LLM AbortController 真接 | §1 cancel cell / §7.2 |
| §9.8 Design System | token-only | §11.5 |
| `extras-task-indicator.jsx` (prototype) | visual reference — H18 設計來源 | 未直接引用，視覺行為走 v0.7.0 既有 component 延伸 |

> **§13.4 / §14.1 在 PHASE-7-PLAN.md 中不存在**（doc 只到 §9）。原指示中提到的這兩節推測為早期 outline 殘留 — 改以實際存在的 §8.1 V15、§9.3 R-1、§9.4 W17/W18 對齊。
