/**
 * H18 TaskIndicator · v0.7.0
 *
 * 28×28 icon button placed in the TopBar，旁邊配 WindowControls。
 * 三種視覺狀態：
 *   - idle    · ☁ cloud icon (text-dim) — 沒任何 pending
 *   - active  · spinner + 數字 badge — 有 pending tasks
 *   - offline · 斜線 wifi icon (hot 紅) — navigator.onLine === false
 *
 * Click 展開 320px dropdown：
 *   header · TASKS · N + ONLINE/OFFLINE pill
 *   list   · status glyph + label + retry/status meta
 *   empty  · 「全部任務已完成」或「網路斷線，新動作會排隊」
 *
 * 訂閱 offlineQueueService — list pending/processing/failed actions。
 * v0.4.x 的 sync labels 已移除 (SYNC_PUSH 等 processor 不存在)。
 */

import { useEffect, useRef, useState } from 'react';
import { offlineQueueService, type PendingAction } from '../services/offlineQueueService';
import s from './TaskIndicator.module.css';

const ACTION_LABEL: Record<string, string> = {
  AUTH_REGISTER: '用戶註冊',
  PURGE_ITEM: '永久刪除',
  TASK_CREATE: '任務建立',
};

const STATUS_GLYPH: Record<PendingAction['status'], string> = {
  pending: '○',
  processing: '◐',
  failed: '✕',
  completed: '✓',
};

const STATUS_LABEL: Record<PendingAction['status'], string> = {
  pending: '待處理',
  processing: '處理中',
  failed: '失敗',
  completed: '完成',
};

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
      <path d="M4 7.5 Q10 2.5 16 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 10.5 Q10 7.5 14 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 13.5 Q10 12 12 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10" cy="16" r="1.2" fill="currentColor" />
      <line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className={s.spinner} aria-hidden>
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M10 3.5 A6.5 6.5 0 0 1 16.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function TaskIndicator() {
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const load = async () => {
      await offlineQueueService.init();
      const all = await offlineQueueService.listActions();
      setActions(all.filter((a) => a.status !== 'completed'));
    };
    load();
    return offlineQueueService.subscribe(() => {
      load();
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const offline = !isOnline;
  const hasActivity = actions.length > 0;
  const title = offline
    ? '網路斷線'
    : hasActivity
      ? `${actions.length} 個任務進行中`
      : '無進行中任務';

  const triggerClass = [
    s.trigger,
    hasActivity && s.triggerActive,
    open && s.triggerOpen,
    offline && !hasActivity && s.triggerOffline,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={s.wrap} ref={wrapRef}>
      <button
        type="button"
        className={triggerClass}
        title={title}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {hasActivity ? <SpinnerIcon /> : offline ? <WifiOffIcon /> : <CloudIcon />}
        {hasActivity && (
          <span className={s.badge} data-testid="task-count-badge">
            {actions.length}
          </span>
        )}
      </button>

      {open && (
        <div className={s.dropdown} data-testid="task-dropdown" role="dialog">
          <div className={s.header}>
            <span className={s.headerTitle}>TASKS · {actions.length}</span>
            <span className={s.headerSpacer} />
            <span className={`${s.connPill} ${offline ? s.offline : ''}`}>
              <span className={s.connDot} />
              {offline ? 'OFFLINE' : 'ONLINE'}
            </span>
          </div>

          <div className={s.list}>
            {actions.length === 0 ? (
              <div className={s.empty}>
                {offline ? '網路斷線，新動作會排隊等待恢復連線' : '✓ 全部任務已完成'}
              </div>
            ) : (
              actions.map((a) => (
                <div key={a.id} className={s.row}>
                  <span className={`${s.statusGlyph} ${s[a.status] ?? ''}`}>
                    {STATUS_GLYPH[a.status]}
                  </span>
                  <div className={s.rowMain}>
                    <div className={s.rowLabel}>{ACTION_LABEL[a.actionType] ?? a.actionType}</div>
                    {a.retryCount > 0 && (
                      <div className={s.rowMeta}>
                        <span>重試 {a.retryCount}/3</span>
                      </div>
                    )}
                  </div>
                  <span className={`${s.rowStatusBadge} ${a.status === 'failed' ? s.failed : ''}`}>
                    {STATUS_LABEL[a.status]}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
