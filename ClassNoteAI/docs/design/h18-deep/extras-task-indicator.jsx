// ClassNoteAI · TaskIndicator (H18 視覺語言擴充)
// 對應 src/components/TaskIndicator.tsx + offlineQueueService.ts
//
// 設計策略：
//   · 28×28 icon button，放在 H18TopBar 右側、錄音按鈕右邊
//   · 三種 visual state:
//       idle  · ☁ cloud icon (T.textDim) — 沒任何 pending
//       active · ⟳ spinner + 數字 badge — 有 pending tasks
//       offline · 斜線 wifi icon (T.hot) — 網路斷線
//   · 點擊展開 dropdown panel，列出所有 pending tasks
//   · Manager API: window.h18Tasks.{add, update, remove, clearAll, setOnline}

(function () {
  let tasks = [];
  let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const listeners = new Set();
  let nextId = 1;

  const notify = () => {
    const snap = { tasks: tasks.slice(), isOnline };
    listeners.forEach((cb) => cb(snap));
  };

  const add = (task) => {
    const id = nextId++;
    tasks = [...tasks, {
      id,
      type: task.type || 'sync',
      label: task.label || task.message || 'Task',
      detail: task.detail || null,
      status: task.status || 'pending', // 'pending' | 'processing' | 'failed' | 'done'
      progress: task.progress, // 0-100 optional
      createdAt: Date.now(),
    }];
    notify();
    return id;
  };

  const update = (id, patch) => {
    tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
    notify();
  };

  const remove = (id) => {
    tasks = tasks.filter((t) => t.id !== id);
    notify();
  };

  const clearAll = () => {
    tasks = [];
    notify();
  };

  const setOnline = (next) => {
    isOnline = !!next;
    notify();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { isOnline = true; notify(); });
    window.addEventListener('offline', () => { isOnline = false; notify(); });
  }

  const subscribe = (cb) => {
    listeners.add(cb);
    cb({ tasks: tasks.slice(), isOnline });
    return () => listeners.delete(cb);
  };

  window.h18TasksManager = { add, update, remove, clearAll, setOnline, subscribe };
  window.h18Tasks = { add, update, remove, clearAll, setOnline };
})();

// ─── Icons (inline SVG) ─────────────────────────────────────
const TaskIcons = {
  cloud: (color) => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <path d="M5.5 13.5 Q3.2 13.5 3.2 11 Q3.2 8.8 5.4 8.8 Q5.6 6 8.5 5.8 Q11.2 4.8 12.7 7.2 Q15.8 7 16.2 10 Q16.2 13.5 14 13.5 Z"
        stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  ),
  wifiOff: (color) => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <path d="M4 7.5 Q10 2.5 16 7.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M6 10.5 Q10 7.5 14 10.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M8 13.5 Q10 12 12 13.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="10" cy="16" r="1.2" fill={color}/>
      <line x1="3" y1="3" x2="17" y2="17" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  spinner: (color) => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none"
      style={{ animation: 'h18TiSpin 900ms linear infinite' }}>
      <circle cx="10" cy="10" r="6.5" stroke={color} strokeWidth="1.5" opacity="0.25"/>
      <path d="M10 3.5 A6.5 6.5 0 0 1 16.5 10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
};

// ─── 單個任務行 ────────────────────────────────────────────
const TaskRow = ({ task, theme: T, onRemove }) => {
  const statusColor = {
    pending:    T.textDim,
    processing: T.accent,
    done:       '#22c55e',
    failed:     '#e8412e',
  }[task.status] || T.textDim;

  const statusGlyph = {
    pending:    '○',
    processing: '◐',
    done:       '✓',
    failed:     '✕',
  }[task.status] || '○';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '14px 1fr auto',
      gap: 10,
      alignItems: 'center',
      padding: '8px 12px',
      borderBottom: `1px solid ${T.borderSoft}`,
      fontSize: 12,
    }}>
      <span style={{
        color: statusColor,
        fontWeight: 700,
        fontFamily: 'JetBrains Mono',
        textAlign: 'center',
        animation: task.status === 'processing' ? 'h18TiPulse 1.4s ease-in-out infinite' : 'none',
      }}>{statusGlyph}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: T.text, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {task.label}
        </div>
        {task.detail && (
          <div style={{ fontSize: 10, color: T.textDim, marginTop: 2,
            fontFamily: 'JetBrains Mono',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {task.detail}
          </div>
        )}
        {task.status === 'processing' && task.progress != null && (
          <div style={{ marginTop: 4, height: 2, background: T.border,
            borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: 2, width: `${task.progress}%`,
              background: T.accent, transition: 'width 200ms' }}/>
          </div>
        )}
      </div>
      <button onClick={() => onRemove(task.id)} title="移除"
        style={{
          background: 'transparent', border: 'none',
          color: T.textFaint, cursor: 'pointer', fontSize: 11,
          padding: 2, fontFamily: 'inherit', flexShrink: 0,
        }}>✕</button>
    </div>
  );
};

// ─── 主 component ──────────────────────────────────────────
const H18TaskIndicator = ({ theme: T }) => {
  const [{ tasks, isOnline }, setState] = React.useState({ tasks: [], isOnline: true });
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    return window.h18TasksManager.subscribe(setState);
  }, []);

  // 點外面關閉 dropdown
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const offline = !isOnline;
  const hasActivity = tasks.length > 0;

  const iconColor = offline ? T.hot : (hasActivity ? T.accent : T.textDim);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <style>{`
        @keyframes h18TiSpin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        @keyframes h18TiPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
      `}</style>

      <button
        onClick={() => setOpen((o) => !o)}
        title={offline ? '網路斷線' : (hasActivity ? `${tasks.length} 個任務進行中` : '無進行中任務')}
        style={{
          position: 'relative',
          width: 28, height: 28, borderRadius: 6,
          background: open
            ? T.chipBg
            : (hasActivity ? T.surface2 : 'transparent'),
          color: iconColor,
          border: `1px solid ${open || hasActivity ? T.border : 'transparent'}`,
          cursor: 'pointer',
          display: 'grid', placeItems: 'center',
          fontFamily: 'inherit',
          transition: 'background 160ms, border-color 160ms',
          flexShrink: 0,
        }}>
        {hasActivity
          ? TaskIcons.spinner(iconColor)
          : (offline ? TaskIcons.wifiOff(iconColor) : TaskIcons.cloud(iconColor))}

        {hasActivity && (
          <span style={{
            position: 'absolute',
            top: -4, right: -4,
            minWidth: 14, height: 14, borderRadius: 7,
            padding: '0 3px',
            background: T.accent, color: '#fff',
            fontSize: 9, fontWeight: 800,
            fontFamily: 'JetBrains Mono',
            display: 'grid', placeItems: 'center',
            border: `1.5px solid ${T.topbar}`,
            letterSpacing: '-0.02em',
          }}>{tasks.length}</span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 36, right: 0,
          width: 320,
          background: T.surface,
          color: T.text,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          boxShadow: T.mode === 'dark'
            ? '0 16px 40px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.06) inset'
            : '0 16px 40px rgba(0,0,0,0.16)',
          zIndex: 1000,
          fontFamily: '"Inter", "Noto Sans TC", sans-serif',
          overflow: 'hidden',
          animation: `h18TiDropIn 200ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}>
          <style>{`@keyframes h18TiDropIn {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
          }`}</style>

          {/* Header */}
          <div style={{
            padding: '10px 14px',
            borderBottom: `1px solid ${T.border}`,
            background: T.surface2,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{
              fontSize: 10, letterSpacing: '0.16em',
              color: T.textDim, fontWeight: 800,
              fontFamily: 'JetBrains Mono',
            }}>
              TASKS · {tasks.length}
            </span>
            <span style={{ flex: 1 }}/>
            {/* 連線狀態小膠囊 */}
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 999,
              background: offline ? `${T.hot}22` : T.chipBg,
              color: offline ? T.hot : '#22c55e',
              fontFamily: 'JetBrains Mono',
              fontWeight: 700, letterSpacing: '0.06em',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: 3,
                background: offline ? T.hot : '#22c55e',
              }}/>
              {offline ? 'OFFLINE' : 'ONLINE'}
            </span>
          </div>

          {/* Task list */}
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            {tasks.length === 0 ? (
              <div style={{
                padding: '28px 16px',
                textAlign: 'center',
                color: T.textFaint,
                fontSize: 12,
                lineHeight: 1.7,
              }}>
                {offline
                  ? '網路斷線，新動作會排隊等待恢復連線'
                  : '✓ 全部任務已完成'}
              </div>
            ) : (
              tasks.map((t) => (
                <TaskRow key={t.id} task={t} theme={T}
                  onRemove={(id) => window.h18TasksManager.remove(id)}/>
              ))
            )}
          </div>

          {/* Footer */}
          {tasks.length > 0 && (
            <div style={{
              padding: '8px 14px',
              borderTop: `1px solid ${T.border}`,
              background: T.surface2,
              display: 'flex', justifyContent: 'flex-end',
            }}>
              <button onClick={() => window.h18TasksManager.clearAll()}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  background: 'transparent', color: T.textMid,
                  border: `1px solid ${T.border}`, borderRadius: 5,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>全部清除</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

Object.assign(window, { H18TaskIndicator });
