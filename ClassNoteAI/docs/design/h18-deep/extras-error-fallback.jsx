// ClassNoteAI · ErrorBoundary Fallback (H18 視覺語言擴充)
// 對應 src/components/ErrorBoundary.tsx
//
// 真實情況：React 元件 throw 時，ErrorBoundary 捕捉後 render fallback
// 取代整個 app。Prototype 用 overlay 模擬，可手動關閉。
//
// API: window.h18ErrorFallback.show({ error, stack }) → 顯示 overlay

(function () {
  let current = null;
  const listeners = new Set();

  const notify = () => listeners.forEach((cb) => cb(current));

  const show = (opts) => {
    current = {
      error: opts.error || 'Unknown error',
      stack: opts.stack || '',
      componentStack: opts.componentStack || '',
    };
    notify();
  };

  const dismiss = () => {
    current = null;
    notify();
  };

  const subscribe = (cb) => {
    listeners.add(cb);
    cb(current);
    return () => listeners.delete(cb);
  };

  window.h18ErrorFallbackManager = { show, dismiss, subscribe };
  window.h18ErrorFallback = { show, dismiss };
})();

const H18ErrorFallback = ({ theme: T }) => {
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    return window.h18ErrorFallbackManager.subscribe(setErr);
  }, []);

  if (!err) return null;

  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  const copyError = () => {
    const text = `${err.error}\n\n${err.stack}\n\n${err.componentStack}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      window.h18Toast?.({ type: 'success', message: '錯誤訊息已複製到剪貼簿' });
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9800,
      background: T.bg,
      display: 'grid', placeItems: 'center',
      padding: 40,
      animation: `h18ErrIn 320ms ${ease}`,
      fontFamily: '"Inter", "Noto Sans TC", sans-serif',
    }}>
      <style>{`@keyframes h18ErrIn {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }`}</style>

      <div style={{
        width: 540, maxWidth: '100%',
        textAlign: 'center',
      }}>
        {/* Big error glyph */}
        <div style={{
          width: 64, height: 64, borderRadius: 32,
          background: T.hotBg, color: T.hot,
          display: 'grid', placeItems: 'center',
          fontSize: 32, fontWeight: 800,
          fontFamily: 'JetBrains Mono',
          margin: '0 auto 20px',
          border: `1px solid ${T.mode === 'dark' ? 'rgba(255,171,122,0.25)' : '#f4cdb8'}`,
        }}>!</div>

        <div style={{ fontSize: 10, letterSpacing: '0.22em',
          color: T.hot, fontWeight: 800,
          fontFamily: 'JetBrains Mono' }}>
          UNHANDLED EXCEPTION
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: T.text,
          marginTop: 8, letterSpacing: '-0.02em' }}>
          出了點問題
        </div>
        <div style={{ fontSize: 13, color: T.textMid, marginTop: 10,
          lineHeight: 1.7, maxWidth: 420, margin: '10px auto 0' }}>
          ClassNote 遇到一個未預期的錯誤。可以試試重新載入；
          如果反覆發生，請複製錯誤訊息回報給開發者。
        </div>

        {/* Error code block */}
        <div style={{
          marginTop: 24,
          padding: '14px 18px',
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          textAlign: 'left',
          color: T.text,
          maxHeight: 160, overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.6,
        }}>
          <div style={{ color: T.hot, fontWeight: 700, marginBottom: 6 }}>
            {err.error}
          </div>
          {err.stack && (
            <div style={{ color: T.textDim }}>
              {err.stack.split('\n').slice(0, 5).join('\n')}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div style={{
          marginTop: 24,
          display: 'flex', gap: 8, justifyContent: 'center',
        }}>
          <button onClick={() => window.h18ErrorFallbackManager.dismiss()}
            style={{
              padding: '10px 18px', fontSize: 12, fontWeight: 700,
              background: T.invert, color: T.invertInk,
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>↻ 重新載入</button>
          <button onClick={copyError} style={{
            padding: '10px 14px', fontSize: 12, fontWeight: 600,
            background: 'transparent', color: T.textMid,
            border: `1px solid ${T.border}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>複製錯誤訊息</button>
          <button style={{
            padding: '10px 14px', fontSize: 12, fontWeight: 600,
            background: 'transparent', color: T.textMid,
            border: `1px solid ${T.border}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>回報問題 ↗</button>
        </div>

        {/* Build info footer */}
        <div style={{
          marginTop: 28, fontSize: 10, color: T.textFaint,
          fontFamily: 'JetBrains Mono', letterSpacing: '0.12em',
        }}>
          ClassNote v0.6.5-alpha · build 2026.04.26
        </div>

        {/* Dev dismiss (prototype only) */}
        <div style={{
          marginTop: 16, fontSize: 10, color: T.textFaint,
          fontFamily: 'JetBrains Mono',
        }}>
          (prototype: 點重新載入回到 app)
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { H18ErrorFallback });
