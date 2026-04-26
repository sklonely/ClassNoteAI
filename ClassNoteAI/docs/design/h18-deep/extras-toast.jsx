// ClassNoteAI · Toast 通知系統 (H18 視覺語言擴充)
// 對應真實 src/services/toastService.ts + src/components/ToastContainer.tsx
//
// 設計策略：
//   · 位置：右下角，AI fab (right:20 bottom:20 size:44) 之上 → bottom: 80
//   · 形狀：320px 寬卡片 + 左 3px 色條（type 區分），不撒底色
//   · 4 type: success ✓ / error ✕ / warning ⚠ / info ⓘ
//   · 自動消失：info/success 4s, error/warning 7s, durationMs:0 = 黏住
//   · Hover 暫停 timer，鬆開續算（殘餘時間 max 800ms）
//   · 最多同時 5 個，超過擠掉最舊
//   · 進場動畫：translateX(20→0) + opacity(0→1) iOS spring
//   · detail 子標 max 2 行 truncate，避免擋到 AI fab

(function () {
  // ─── Manager (pub/sub) ─────────────────────────────────────
  let toasts = [];
  const listeners = new Set();
  const timers = new Map();
  let nextId = 1;
  let isPaused = false;

  const notify = () => {
    const snap = toasts.slice();
    listeners.forEach((cb) => cb(snap));
  };

  const setTimer = (id, ms) => {
    if (timers.has(id)) clearTimeout(timers.get(id));
    if (ms <= 0) return;
    timers.set(
      id,
      setTimeout(() => dismiss(id), ms),
    );
  };

  const dismiss = (id) => {
    if (timers.has(id)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  };

  const show = (opts) => {
    const type = opts.type || 'info';
    // 統一所有 type 預設 5 秒；durationMs:0 = sticky (黏住，需手動 ✕)
    const defaultDur = 5000;
    const durationMs = opts.durationMs == null ? defaultDur : opts.durationMs;
    const id = nextId++;
    const now = Date.now();
    const toast = {
      id,
      type,
      message: opts.message,
      detail: opts.detail || null,
      durationMs,
      at: now,
      expiresAt: durationMs > 0 ? now + durationMs : null,
    };
    toasts = [...toasts, toast];
    // 限制最多 5 個 — 超過擠掉最舊（連同 timer）
    while (toasts.length > 5) {
      const dropped = toasts.shift();
      if (timers.has(dropped.id)) {
        clearTimeout(timers.get(dropped.id));
        timers.delete(dropped.id);
      }
    }
    notify();
    if (durationMs > 0 && !isPaused) {
      setTimer(id, durationMs);
    }
    return id;
  };

  // Hover 整個 container 時暫停所有 timer
  const pauseAll = () => {
    isPaused = true;
    for (const id of Array.from(timers.keys())) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  };

  const resumeAll = () => {
    isPaused = false;
    const now = Date.now();
    for (const t of toasts) {
      if (t.expiresAt == null) continue;
      const remaining = Math.max(800, t.expiresAt - now);
      setTimer(t.id, remaining);
    }
  };

  const subscribe = (cb) => {
    listeners.add(cb);
    cb(toasts.slice());
    return () => {
      listeners.delete(cb);
    };
  };

  // 暴露給 window — 任何元件都能呼叫 window.h18Toast({...})
  window.h18ToastManager = { show, dismiss, pauseAll, resumeAll, subscribe };
  window.h18Toast = show;
})();

// ─── 兩種 Toast 視覺風格 — H18 視覺 vocabulary ────────────────
//   · card        — 預設，T.surface 卡片 + 左 3px 色條 + Inter 字 + icon
//   · typewriter  — 復古打字機 mono 風 + [HH:MM:SS] 時戳 + JetBrains Mono
//
// type 色（兩風格共用，dark mode 用設計既有的 lightened 課程色，避免太刺眼）
const tToastTypeColor = (type, T) => {
  const dark = T.mode === 'dark';
  if (type === 'success') return dark ? '#5bd49a' : '#1f7a4f';
  if (type === 'error')   return dark ? '#ff8b6b' : '#9e3a24';
  if (type === 'warning') return T.hot;
  return T.textMid;
};

// ─── 共用：底部倒數 progress bar ─────────────────────────────
// 從滿格 (scaleX 1) 線性收縮到空 (scaleX 0)，動畫時長 = toast 實際 duration
// transformOrigin: 'left' → 視覺上是「右邊被吃掉」的時間倒數感
// hover 時 animationPlayState 變 paused，CSS 自然記住當前位置
//
// sticky toast (durationMs:0) 也渲染 bar，但用 opacity 0.35 + 不動畫，
// 表示「無時限」— 兩種 toast 視覺結構一致，避免「有 bar / 沒 bar」
// 的兩種樣式感。
const ToastCountdownBar = ({ duration, color, paused, T }) => {
  const sticky = !duration || duration <= 0;
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height: 2,
      background: T.borderSoft, overflow: 'hidden',
    }}>
      <div style={{
        width: '100%', height: '100%',
        background: color,
        opacity: sticky ? 0.35 : 0.85,
        transformOrigin: 'left',
        animation: sticky ? 'none' : `h18ToastBar ${duration}ms linear forwards`,
        animationPlayState: paused ? 'paused' : 'running',
      }}/>
    </div>
  );
};

// ─── Style A · card (預設) ───────────────────────────────────
const H18ToastCard = ({ toast, theme: T, paused }) => {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ⓘ' };
  const color = tToastTypeColor(toast.type, T);
  const icon = ICONS[toast.type] || ICONS.info;
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div style={{
      width: 320,
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      boxShadow: T.shadow,
      display: 'flex', gap: 0, overflow: 'hidden',
      transform: visible ? 'translateX(0)' : 'translateX(20px)',
      opacity: visible ? 1 : 0,
      transition: `transform 280ms ${ease}, opacity 240ms ${ease}`,
      fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      pointerEvents: 'auto',
      position: 'relative',  // for absolute countdown bar
    }}>
      <div style={{ width: 3, background: color, flexShrink: 0 }}/>
      <div style={{ flex: 1, minWidth: 0, padding: '12px 12px 12px 14px',
        display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{
          fontSize: 14, color, fontWeight: 700, lineHeight: 1.2,
          marginTop: 1, flexShrink: 0, width: 14, textAlign: 'center',
          fontFamily: 'JetBrains Mono, monospace',
        }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, color: T.text, fontWeight: 600,
            lineHeight: 1.45, letterSpacing: '-0.005em',
          }}>{toast.message}</div>
          {toast.detail && (
            <div style={{
              fontSize: 11, color: T.textDim, marginTop: 3, lineHeight: 1.5,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{toast.detail}</div>
          )}
        </div>
        <button onClick={() => window.h18ToastManager.dismiss(toast.id)}
          title="關閉" style={{
            background: 'transparent', border: 'none',
            color: T.textFaint, cursor: 'pointer', fontSize: 11,
            padding: 2, margin: '-2px -4px -2px 0', lineHeight: 1,
            flexShrink: 0, fontFamily: 'inherit', transition: `color 120ms`,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = T.textMid; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = T.textFaint; }}
        >✕</button>
      </div>
      <ToastCountdownBar duration={toast.durationMs} color={color}
        paused={paused} T={T}/>
    </div>
  );
};

// ─── Style B · typewriter (復古打字機 / 終端機風) ────────────
// 設計重點：
//   · 全 JetBrains Mono — 寬度比 sans 寬 ~10%，所以 width 加大到 360
//   · [HH:MM:SS] 時戳當資訊，模仿 log entry 而非通知卡
//   · 不用左色條 — type 色用在 icon 跟 timestamp 上
//   · 暗角 inset shadow 像舊終端機面板
//   · borderRadius 4 比 card 更方
//   · 背景用 T.surface2 帶一點復古感
const H18ToastTypewriter = ({ toast, theme: T, paused }) => {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const ICONS = { success: '✓', error: '✕', warning: '⚠', info: '$' };
  const color = tToastTypeColor(toast.type, T);
  const icon = ICONS[toast.type] || ICONS.info;
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  // 從 toast.at (epoch ms) 算出 HH:MM:SS
  const ts = new Date(toast.at);
  const pad = (n) => String(n).padStart(2, '0');
  const tsStr = `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;

  return (
    <div style={{
      width: 360,
      background: T.surface2,
      border: `1px solid ${T.border}`,
      borderRadius: 4,
      boxShadow: T.mode === 'dark'
        ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 14px rgba(0,0,0,0.5)'
        : 'inset 0 1px 0 rgba(255,255,255,0.6), 0 3px 10px rgba(0,0,0,0.08)',
      transform: visible ? 'translateX(0)' : 'translateX(20px)',
      opacity: visible ? 1 : 0,
      transition: `transform 280ms ${ease}, opacity 240ms ${ease}`,
      fontFamily: 'JetBrains Mono, "Noto Sans Mono", Menlo, monospace',
      pointerEvents: 'auto',
      padding: '10px 14px',
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      position: 'relative',  // for absolute countdown bar
      overflow: 'hidden',
    }}>
      {/* Type icon prompt — like terminal prompt */}
      <span style={{
        fontSize: 13, color, fontWeight: 700, lineHeight: 1.45,
        flexShrink: 0, width: 14, textAlign: 'center',
      }}>{icon}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top line: [timestamp] message */}
        <div style={{
          fontSize: 12, lineHeight: 1.45,
          letterSpacing: '0.01em',
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{ color: T.textDim, marginRight: 8 }}>
            [{tsStr}]
          </span>
          <span style={{ color: T.text, fontWeight: 600 }}>
            {toast.message}
          </span>
        </div>
        {toast.detail && (
          <div style={{
            fontSize: 11, color: T.textDim, marginTop: 3,
            lineHeight: 1.55,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
            // 縮排對齊 message (跳過時戳寬度)
            paddingLeft: 0,
          }}>
            <span style={{ color: T.textFaint, marginRight: 8 }}>↳</span>
            {toast.detail}
          </div>
        )}
      </div>

      {/* Dismiss */}
      <button onClick={() => window.h18ToastManager.dismiss(toast.id)}
        title="關閉" style={{
          background: 'transparent', border: 'none',
          color: T.textFaint, cursor: 'pointer', fontSize: 11,
          padding: 2, margin: '-2px -4px -2px 0', lineHeight: 1,
          flexShrink: 0, fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = T.textMid; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = T.textFaint; }}
      >✕</button>
      <ToastCountdownBar duration={toast.durationMs} color={color}
        paused={paused} T={T}/>
    </div>
  );
};

// ─── Container — 依 toastStyle prop 派發到對應風格 ──────────
const H18ToastContainer = ({ theme: T, toastStyle = 'card' }) => {
  const [toasts, setToasts] = React.useState([]);
  const [hovered, setHovered] = React.useState(false);

  React.useEffect(() => {
    return window.h18ToastManager.subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  const ToastView = toastStyle === 'typewriter' ? H18ToastTypewriter : H18ToastCard;

  return (
    <div
      onMouseEnter={() => { setHovered(true); window.h18ToastManager.pauseAll(); }}
      onMouseLeave={() => { setHovered(false); window.h18ToastManager.resumeAll(); }}
      style={{
        position: 'fixed', right: 20, bottom: 80,
        zIndex: 200,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}>
      {/* 共用 keyframes — 給每個 ToastCountdownBar 用 */}
      <style>{`@keyframes h18ToastBar {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }`}</style>
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} theme={T} paused={hovered}/>
      ))}
    </div>
  );
};

Object.assign(window, { H18ToastCard, H18ToastTypewriter, H18ToastContainer });
