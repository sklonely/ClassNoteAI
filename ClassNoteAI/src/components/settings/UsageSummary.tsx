import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Trash2 } from 'lucide-react';
import { usageTracker, type UsageEvent } from '../../services/llm';

type Window = 'session' | 'today' | 'all';

const WINDOW_LABELS: Record<Window, string> = {
  session: '本次 session',
  today: '最近 24 小時',
  all: '全部（24h retention）',
};

const TASK_LABELS: Record<UsageEvent['task'], string> = {
  summarize: '重點摘要',
  syllabus: '課程大綱',
  keywords: '關鍵字',
  chat: 'AI 助教對話',
  chatStream: 'AI 助教對話（串流）',
  translate: 'RAG 檢索翻譯',
  fineRefine: '字幕精修',
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * A live aggregate of LLM token usage. Subscribes to `usageTracker`
 * so it ticks up as calls happen. Intended as the in-app "how much
 * am I spending" surface — we can't see server-side quotas for
 * ChatGPT OAuth (OpenAI doesn't expose one) and GitHub Models doesn't
 * have a real-time remaining counter either, so client-side
 * cumulative counting is the best we can offer.
 */
export default function UsageSummary() {
  const [tick, setTick] = useState(0);
  const [windowChoice, setWindowChoice] = useState<Window>('today');
  const [sessionStart] = useState<number>(() => Date.now());

  useEffect(() => {
    return usageTracker.subscribe(() => setTick((t) => t + 1));
  }, []);

  // `tick` is in the dep array only implicitly — each subscribe
  // notification forces a re-render, which recomputes totals fresh.
  void tick;

  const since =
    windowChoice === 'session'
      ? sessionStart
      : windowChoice === 'today'
        ? Date.now() - 24 * 60 * 60 * 1000
        : 0;

  const events = usageTracker.since(since);
  const totals = usageTracker.totals(since);

  const totalIn = events.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOut = events.reduce((sum, e) => sum + e.outputTokens, 0);
  const totalCalls = events.length;

  // Breakdown per task for quick "where is my quota going" scanning.
  const byTask = new Map<UsageEvent['task'], { inputTokens: number; outputTokens: number; calls: number }>();
  for (const e of events) {
    const cur = byTask.get(e.task) || { inputTokens: 0, outputTokens: 0, calls: 0 };
    cur.inputTokens += e.inputTokens;
    cur.outputTokens += e.outputTokens;
    cur.calls += 1;
    byTask.set(e.task, cur);
  }

  const handleReset = () => {
    if (confirm('確定要清除所有用量紀錄嗎？這只影響顯示，並不會影響實際訂閱額度。')) {
      usageTracker.clear();
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Token 用量</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={windowChoice}
            onChange={(e) => setWindowChoice(e.target.value as Window)}
            className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800"
          >
            {(Object.keys(WINDOW_LABELS) as Window[]).map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABELS[w]}
              </option>
            ))}
          </select>
          <button
            onClick={() => setTick((t) => t + 1)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleReset}
            className="p-1 text-gray-400 hover:text-red-500 rounded"
            title="清除用量紀錄"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {totalCalls === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          還沒有任何 LLM 呼叫紀錄。
          {windowChoice !== 'all' && '（切換到「全部」可能還是空的，重啟 app 後紀錄會保留在 localStorage）'}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">總輸入</div>
              <div className="text-lg font-mono font-medium text-gray-900 dark:text-gray-100">
                {formatNumber(totalIn)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">總輸出</div>
              <div className="text-lg font-mono font-medium text-gray-900 dark:text-gray-100">
                {formatNumber(totalOut)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">呼叫次數</div>
              <div className="text-lg font-mono font-medium text-gray-900 dark:text-gray-100">
                {totalCalls}
              </div>
            </div>
          </div>

          {totals.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">依模型</div>
              <div className="space-y-1">
                {totals.map((t) => (
                  <div
                    key={`${t.providerId}|${t.model}`}
                    className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400"
                  >
                    <span className="truncate">
                      <span className="text-gray-400">{t.providerId}</span>
                      <span className="mx-1">·</span>
                      <span>{t.model}</span>
                    </span>
                    <span className="font-mono whitespace-nowrap tabular-nums">
                      in {formatNumber(t.inputTokens)} · out {formatNumber(t.outputTokens)} · {t.calls} calls
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {byTask.size > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">依功能</div>
              <div className="space-y-1">
                {Array.from(byTask.entries())
                  .sort(
                    (a, b) =>
                      b[1].inputTokens +
                      b[1].outputTokens -
                      (a[1].inputTokens + a[1].outputTokens),
                  )
                  .map(([task, t]) => (
                    <div
                      key={task}
                      className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400"
                    >
                      <span>{TASK_LABELS[task] ?? task}</span>
                      <span className="font-mono whitespace-nowrap tabular-nums">
                        in {formatNumber(t.inputTokens)} · out {formatNumber(t.outputTokens)} · {t.calls} calls
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-400 leading-relaxed pt-1 border-t border-gray-200 dark:border-gray-700">
            ※ 數字僅為用戶端累計，非服務端即時額度。ChatGPT 訂閱的真實剩餘次數／GitHub Models 的 quota 都由服務商自己管理，
            此處只能反映「這個應用呼叫了多少」。
          </p>
        </div>
      )}
    </div>
  );
}
