/**
 * H18 TaskIndicator · Phase 7 Sprint 2 S2.5
 *
 * 28×28 trigger button placed in TopBar; click to open a 320px dropdown
 * panel listing every active background task.
 *
 * Dual-source registry — see ClassNoteAI/docs/design/h18-deep/H18-TASKINDICATOR-MERGE.md:
 *   - taskTrackerService (Phase 7) — summarize / index / export
 *   - offlineQueueService (legacy) — AUTH_REGISTER / PURGE_ITEM / TASK_CREATE
 *
 * Both feeds adapt into a UnifiedTask shape. SUMMARIZE_LECTURE and
 * INDEX_LECTURE on the queue side are filtered out (per MERGE §6.1) — the
 * tracker side owns their UI to avoid double rows after V15 restart-replay.
 *
 * UnifiedTask id format: `<source>:<rawId>` so cancel/retry can dispatch
 * back to the right service.
 *
 * Ordering: running → queued → failed → done. Active count badge counts
 * only running + queued. Failed rows show retry button (tracker only —
 * queue auto-retries via backoff). Cancel only on running tracker tasks.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    offlineQueueService,
    type PendingAction,
} from '../services/offlineQueueService';
import {
    taskTrackerService,
    type TaskTrackerEntry,
} from '../services/taskTrackerService';
import s from './TaskIndicator.module.css';

// ─── UnifiedTask + adapters (per MERGE doc §2) ───────────────────────────

type UnifiedStatus = 'queued' | 'running' | 'done' | 'failed';
type UnifiedSource = 'tracker' | 'offline-queue';

interface UnifiedTask {
    /** `'tracker:<id>'` or `'queue:<id>'`. Strip prefix before dispatch. */
    id: string;
    source: UnifiedSource;
    kind: string;
    label: string;
    /** 0..1 inclusive. Queue side fills synthetic values when no progress data. */
    progress: number;
    status: UnifiedStatus;
    cancelable: boolean;
    retriable: boolean;
    startedAt: number;
    error?: string;
    lectureId?: string;
}

const OFFLINE_QUEUE_LABELS: Record<string, string> = {
    AUTH_REGISTER: '用戶註冊',
    PURGE_ITEM: '永久刪除',
    TASK_CREATE: '任務建立',
    // SUMMARIZE_LECTURE / INDEX_LECTURE are filtered out before adapt
    // (see merged() useMemo). Listed here only for completeness if some
    // other code path reaches in.
    SUMMARIZE_LECTURE: '生成摘要（重啟續跑）',
    INDEX_LECTURE: '建立索引（重啟續跑）',
};

function adaptTracker(e: TaskTrackerEntry): UnifiedTask | null {
    // tracker `cancelled` is terminal too — but we don't surface it as a
    // UnifiedStatus row (treat like done so it falls off the list quietly).
    let status: UnifiedStatus;
    if (e.status === 'cancelled') {
        status = 'done';
    } else {
        // queued | running | done | failed map 1:1
        status = e.status;
    }
    return {
        id: `tracker:${e.id}`,
        source: 'tracker',
        kind: e.kind,
        label: e.label,
        progress: e.progress,
        status,
        cancelable: status === 'queued' || status === 'running',
        retriable: status === 'failed',
        startedAt: e.startedAt,
        error: e.error,
        lectureId: e.lectureId,
    };
}

function adaptQueue(item: PendingAction): UnifiedTask | null {
    // V15 dedupe — those two action types are queue's "restart-replay"
    // bookkeeping. The tracker owns the actual row.
    if (
        item.actionType === ('SUMMARIZE_LECTURE' as PendingAction['actionType']) ||
        item.actionType === ('INDEX_LECTURE' as PendingAction['actionType'])
    ) {
        return null;
    }

    const status: UnifiedStatus =
        item.status === 'pending'
            ? 'queued'
            : item.status === 'processing'
              ? 'running'
              : item.status === 'failed'
                ? 'failed'
                : /* completed */ 'done';

    const progress =
        item.status === 'completed'
            ? 1
            : item.status === 'processing'
              ? 0.5
              : 0;

    return {
        id: `queue:${item.id}`,
        source: 'offline-queue',
        kind: item.actionType,
        label: OFFLINE_QUEUE_LABELS[item.actionType] ?? item.actionType,
        progress,
        status,
        cancelable: false, // queue is non-cancellable per MERGE §1
        retriable: false, // queue auto-retries via exponential backoff
        startedAt: Date.now(), // schema doesn't carry createdAt; safe fallback
        error: undefined,
    };
}

// ─── Small SVG icons (kept inline to avoid new deps) ─────────────────────

function CloudIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
                d="M5.5 13.5 Q3.2 13.5 3.2 11 Q3.2 8.8 5.4 8.8 Q5.6 6 8.5 5.8 Q11.2 4.8 12.7 7.2 Q15.8 7 16.2 10 Q16.2 13.5 14 13.5 Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function WifiOffIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
                d="M4 7.5 Q10 2.5 16 7.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
            <path
                d="M6 10.5 Q10 7.5 14 10.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
            <path
                d="M8 13.5 Q10 12 12 13.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
            <circle cx="10" cy="16" r="1.2" fill="currentColor" />
            <line
                x1="3"
                y1="3"
                x2="17"
                y2="17"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
            />
        </svg>
    );
}

function SpinnerIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            className={s.spinner}
            aria-hidden
        >
            <circle
                cx="10"
                cy="10"
                r="6.5"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.25"
            />
            <path
                d="M10 3.5 A6.5 6.5 0 0 1 16.5 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

// ─── component ───────────────────────────────────────────────────────────

export default function TaskIndicator() {
    const [queueItems, setQueueItems] = useState<PendingAction[]>([]);
    const [trackerItems, setTrackerItems] = useState<TaskTrackerEntry[]>([]);
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== 'undefined' ? navigator.onLine : true,
    );
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    // ─── online/offline tracking ─────────────────────────────────────
    useEffect(() => {
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);

    // ─── offlineQueue subscribe ─────────────────────────────────────
    // Service's subscribe gives us a count, not the list. We re-fetch
    // listActions() inside the callback — same pattern as v0.7.0.
    useEffect(() => {
        let cancelled = false;
        const reload = async () => {
            try {
                const all = await offlineQueueService.listActions();
                if (!cancelled) {
                    setQueueItems(all.filter((a) => a.status !== 'completed'));
                }
            } catch {
                // listActions can fail in jsdom (no Tauri runtime). Treat
                // as empty rather than crashing the indicator.
                if (!cancelled) setQueueItems([]);
            }
        };
        reload();
        const unsub = offlineQueueService.subscribe(() => {
            reload();
        });
        return () => {
            cancelled = true;
            unsub();
        };
    }, []);

    // ─── taskTrackerService subscribe ───────────────────────────────
    // Service fires immediate snapshot on subscribe. We keep ALL entries
    // (not just getActive) so failed rows survive in the dropdown until
    // the user dismisses or retries them.
    useEffect(() => {
        return taskTrackerService.subscribe((tasks) => {
            setTrackerItems(tasks);
        });
    }, []);

    // ─── click-outside to close dropdown ────────────────────────────
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (
                wrapRef.current &&
                !wrapRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    // ─── merged + sorted UnifiedTask list ───────────────────────────
    const merged = useMemo<UnifiedTask[]>(() => {
        const tracker = trackerItems
            .map(adaptTracker)
            .filter((x): x is UnifiedTask => x !== null);
        const queue = queueItems
            .map(adaptQueue)
            .filter((x): x is UnifiedTask => x !== null);
        const STATUS_ORDER: Record<UnifiedStatus, number> = {
            running: 0,
            queued: 1,
            failed: 2,
            done: 3,
        };
        return [...tracker, ...queue].sort((a, b) => {
            const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
            if (so !== 0) return so;
            // failed/done — newest first; running/queued — oldest first
            if (a.status === 'failed' || a.status === 'done') {
                return b.startedAt - a.startedAt;
            }
            return a.startedAt - b.startedAt;
        });
    }, [trackerItems, queueItems]);

    const activeCount = useMemo(
        () =>
            merged.filter(
                (t) => t.status === 'running' || t.status === 'queued',
            ).length,
        [merged],
    );

    const visible = useMemo(
        // hide done tasks from the dropdown — service auto-removes after 5s,
        // but in the meantime we don't need to show stale ✓ rows.
        () => merged.filter((t) => t.status !== 'done'),
        [merged],
    );

    const offline = !isOnline;
    const hasActivity = activeCount > 0;
    const title = offline
        ? '網路斷線'
        : hasActivity
          ? `${activeCount} 個任務進行中`
          : '無進行中任務';

    const triggerClass = [
        s.trigger,
        hasActivity && s.triggerActive,
        open && s.triggerOpen,
        offline && !hasActivity && s.triggerOffline,
    ]
        .filter(Boolean)
        .join(' ');

    // ─── handlers ───────────────────────────────────────────────────
    const handleCancel = (task: UnifiedTask) => {
        if (!task.cancelable) return;
        const colon = task.id.indexOf(':');
        const source = task.id.slice(0, colon);
        const rawId = task.id.slice(colon + 1);
        if (source === 'tracker') {
            taskTrackerService.cancel(rawId);
        }
        // queue source not cancellable — UI never shows the button anyway.
    };

    const handleRetry = (task: UnifiedTask) => {
        if (!task.retriable) return;
        const colon = task.id.indexOf(':');
        const source = task.id.slice(0, colon);
        const rawId = task.id.slice(colon + 1);
        if (source === 'tracker') {
            // Best-effort cancel old failed entry then re-queue with the
            // same kind/label/lectureId. Service's cancel() is a no-op for
            // terminal entries which is fine.
            taskTrackerService.cancel(rawId);
            taskTrackerService.start({
                kind: task.kind as TaskTrackerEntry['kind'],
                label: task.label,
                lectureId: task.lectureId,
            });
        }
    };

    return (
        <div className={s.wrap} ref={wrapRef}>
            <button
                type="button"
                className={triggerClass}
                title={title}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={`${activeCount} 個任務${open ? '收合' : '展開'}`}
                data-testid="task-indicator"
            >
                {hasActivity ? (
                    <SpinnerIcon />
                ) : offline ? (
                    <WifiOffIcon />
                ) : (
                    <CloudIcon />
                )}
                {hasActivity && (
                    <span
                        className={s.badge}
                        data-testid="task-count-badge"
                    >
                        {activeCount}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className={s.dropdown}
                    data-testid="task-dropdown"
                    role="listbox"
                    aria-label="背景任務列表"
                >
                    <div className={s.header}>
                        <span className={s.headerTitle}>
                            TASKS · {activeCount}
                        </span>
                        <span className={s.headerSpacer} />
                        <span
                            className={`${s.connPill} ${offline ? s.offline : ''}`}
                        >
                            <span className={s.connDot} />
                            {offline ? 'OFFLINE' : 'ONLINE'}
                        </span>
                    </div>

                    <div className={s.list}>
                        {visible.length === 0 ? (
                            <div className={s.empty}>
                                {offline
                                    ? '網路斷線，新動作會排隊等待恢復連線'
                                    : '✓ 全部任務已完成'}
                            </div>
                        ) : (
                            visible.map((task) => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    onCancel={handleCancel}
                                    onRetry={handleRetry}
                                />
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── TaskRow ─────────────────────────────────────────────────────────────

interface TaskRowProps {
    task: UnifiedTask;
    onCancel: (task: UnifiedTask) => void;
    onRetry: (task: UnifiedTask) => void;
}

function TaskRow({ task, onCancel, onRetry }: TaskRowProps) {
    const rawId = task.id.slice(task.id.indexOf(':') + 1);
    const rowClass = [s.row, s[`status-${task.status}`]]
        .filter(Boolean)
        .join(' ');
    return (
        <div
            className={rowClass}
            role="option"
            aria-selected="false"
            data-testid={`task-row-${rawId}`}
        >
            <div className={s.rowMain}>
                <div className={s.rowLabel}>{task.label}</div>
                {task.status === 'running' && (
                    <progress
                        className={s.progress}
                        value={task.progress}
                        max={1}
                        aria-label={`${task.label} 進度`}
                    />
                )}
                {task.status === 'failed' && task.error && (
                    <div className={s.errorMsg}>{task.error}</div>
                )}
            </div>
            <div className={s.rowActions}>
                {task.cancelable && task.status === 'running' && (
                    <button
                        type="button"
                        className={s.actionBtn}
                        onClick={() => onCancel(task)}
                        aria-label={`取消 ${task.label}`}
                        data-testid={`task-cancel-${rawId}`}
                    >
                        ✕
                    </button>
                )}
                {task.retriable && (
                    <button
                        type="button"
                        className={s.actionBtn}
                        onClick={() => onRetry(task)}
                        aria-label={`重試 ${task.label}`}
                        data-testid={`task-retry-${rawId}`}
                    >
                        重試
                    </button>
                )}
            </div>
        </div>
    );
}
