// ClassNoteAI · VideoPiP (H18 視覺語言擴充)
// 對應 src/components/VideoPiP.tsx
//
// 觸發時機：lecture 同時有 imported video + PDF 時，video 變成右下角浮動
// 小視窗（Zoom / Meet style PiP）。可拖曳，可縮放，可關閉。
//
// API: window.h18VideoPiP.toggle() / .show() / .hide()

(function () {
  let isOpen = false;
  const listeners = new Set();
  const notify = () => listeners.forEach((cb) => cb(isOpen));

  const show = () => { isOpen = true; notify(); };
  const hide = () => { isOpen = false; notify(); };
  const toggle = () => { isOpen = !isOpen; notify(); };

  const subscribe = (cb) => {
    listeners.add(cb);
    cb(isOpen);
    return () => listeners.delete(cb);
  };

  window.h18VideoPiPManager = { show, hide, toggle, subscribe };
  window.h18VideoPiP = { show, hide, toggle };
})();

const H18VideoPiP = ({ theme: T }) => {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ x: null, y: null });
  const [size, setSize] = React.useState({ w: 320, h: 180 });
  const [hover, setHover] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [t, setT2] = React.useState(0);

  React.useEffect(() => {
    return window.h18VideoPiPManager.subscribe(setOpen);
  }, []);

  // 進場 / 退場 mount delay
  React.useEffect(() => {
    if (open) setMounted(true);
    else { const timer = setTimeout(() => setMounted(false), 200); return () => clearTimeout(timer); }
  }, [open]);

  // 假裝有東西在播放
  React.useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setT2((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!mounted) return null;

  // 預設位置：右下，留 24px 邊距
  const W = size.w, H = size.h;
  const x = pos.x ?? (window.innerWidth - W - 24);
  const y = pos.y ?? (window.innerHeight - H - 110); // above AI fab

  // 拖曳邏輯
  const onHeaderDown = (e) => {
    const startX = e.clientX, startY = e.clientY;
    const startPos = { x, y };
    const onMove = (me) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - W, startPos.x + me.clientX - startX)),
        y: Math.max(0, Math.min(window.innerHeight - H, startPos.y + me.clientY - startY)),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // resize 邏輯（右下角）
  const onResizeDown = (e) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const start = { ...size };
    const onMove = (me) => {
      setSize({
        w: Math.max(220, Math.min(640, start.w + me.clientX - startX)),
        h: Math.max(124, Math.min(360, start.h + me.clientY - startY)),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const mm = Math.floor((180 + t) / 60);
  const ss = (180 + t) % 60;
  const tsStr = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'fixed', left: x, top: y, width: W, height: H,
        background: '#000',
        borderRadius: 8,
        border: T.mode === 'dark'
          ? '1px solid rgba(255,255,255,0.12)'
          : '1px solid rgba(0,0,0,0.18)',
        boxShadow: T.mode === 'dark'
          ? '0 18px 40px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.04)'
          : '0 18px 40px rgba(0,0,0,0.28)',
        zIndex: 1500,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        animation: open
          ? `h18PipIn 200ms ${ease}`
          : `h18PipOut 180ms ${ease} forwards`,
        fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      }}>
      <style>{`
        @keyframes h18PipIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes h18PipOut {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.9); }
        }
      `}</style>

      {/* Header (drag handle) — 只 hover 時顯示 */}
      <div onMouseDown={onHeaderDown} style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '6px 10px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
        display: 'flex', alignItems: 'center', gap: 8,
        opacity: hover ? 1 : 0,
        transition: 'opacity 160ms',
        cursor: 'move',
        userSelect: 'none',
        zIndex: 2,
      }}>
        <span style={{
          fontSize: 9, letterSpacing: '0.16em', fontWeight: 800,
          color: '#fff', fontFamily: 'JetBrains Mono',
          padding: '2px 6px', background: 'rgba(255,255,255,0.18)',
          borderRadius: 3,
        }}>● LIVE · ML L13</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)',
          fontFamily: 'JetBrains Mono' }}>{tsStr}</span>
        <div style={{ flex: 1 }}/>
        <button onClick={() => window.h18VideoPiPManager.hide()}
          title="關閉" style={{
            width: 20, height: 20, borderRadius: 4,
            background: 'rgba(0,0,0,0.5)', color: '#fff',
            border: 'none', cursor: 'pointer', fontSize: 10,
            fontFamily: 'inherit',
          }}>✕</button>
      </div>

      {/* Mock video content */}
      <div style={{
        flex: 1,
        background: 'radial-gradient(circle at 30% 40%, #2a3450 0%, #0a0e18 70%)',
        display: 'grid', placeItems: 'center',
        position: 'relative',
      }}>
        {/* Center play indicator */}
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
          <div style={{ fontSize: Math.max(24, H * 0.18),
            fontWeight: 200, lineHeight: 1 }}>▶</div>
          <div style={{ fontSize: 10, marginTop: 6,
            fontFamily: 'JetBrains Mono', letterSpacing: '0.14em' }}>
            1920 × 1080 · 30 FPS
          </div>
        </div>

        {/* 假裝有 motion 的小條 */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
          background: 'rgba(255,255,255,0.1)',
        }}>
          <div style={{
            height: '100%', width: `${((t * 1.5) % 100)}%`,
            background: '#10a37f',
            transition: 'width 1s linear',
          }}/>
        </div>
      </div>

      {/* Resize handle (右下角) */}
      <div onMouseDown={onResizeDown} style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 14, height: 14,
        cursor: 'nwse-resize',
        opacity: hover ? 0.6 : 0,
        transition: 'opacity 160ms',
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M2 12 L12 2 M5 13 L13 5 M9 13 L13 9"
            stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
        </svg>
      </div>
    </div>
  );
};

Object.assign(window, { H18VideoPiP });
