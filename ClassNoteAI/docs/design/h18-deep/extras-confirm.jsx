// ClassNoteAI · ConfirmDialog (H18 視覺語言擴充)
// 對應 src/components/ConfirmDialog.tsx + confirmService.ts
//
// 設計策略：
//   · Manager 暴露在 window.h18Confirm({...}) → 回 Promise<boolean>
//   · 模態：backdrop blur + 420px 卡片置中
//   · 兩種 kind: 'normal' (預設) / 'danger' (紅色 OK 按鈕)
//   · ESC 取消，Enter 確認
//   · 整套 H18 chrome：rounded 12, T.shadow, 用 T tokens 兼容明暗主題

(function () {
  let current = null;
  const listeners = new Set();

  const notify = () => {
    listeners.forEach((cb) => cb(current));
  };

  const show = (opts) =>
    new Promise((resolve) => {
      current = {
        title: opts.title || '確認操作',
        message: opts.message || '',
        okLabel: opts.okLabel || '確認',
        cancelLabel: opts.cancelLabel || '取消',
        kind: opts.kind || 'normal', // 'normal' | 'danger'
        // 內部 callback
        _resolve: (val) => {
          current = null;
          notify();
          resolve(val);
        },
      };
      notify();
    });

  const subscribe = (cb) => {
    listeners.add(cb);
    cb(current);
    return () => {
      listeners.delete(cb);
    };
  };

  window.h18ConfirmManager = { show, subscribe };
  window.h18Confirm = show;
})();

// ─── ConfirmDialog component ────────────────────────────────
const H18ConfirmDialog = ({ theme: T }) => {
  const [confirm, setConfirm] = React.useState(null);

  React.useEffect(() => {
    return window.h18ConfirmManager.subscribe(setConfirm);
  }, []);

  // 鍵盤：ESC 取消、Enter 確認
  React.useEffect(() => {
    if (!confirm) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        confirm._resolve(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirm._resolve(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  if (!confirm) return null;

  const danger = confirm.kind === 'danger';
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div
      onClick={() => confirm._resolve(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: T.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(20,18,14,0.35)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        animation: `h18CfmFade 200ms ${ease}`,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100% - 48px)',
          background: T.surface,
          color: T.text,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          boxShadow:
            T.mode === 'dark'
              ? '0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)'
              : '0 30px 80px rgba(0,0,0,0.22)',
          padding: 24,
          fontFamily: '"Inter", "Noto Sans TC", sans-serif',
          animation: `h18CfmIn 240ms ${ease}`,
        }}
      >
        <style>{`
          @keyframes h18CfmFade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes h18CfmIn {
            from { opacity: 0; transform: scale(0.96) translateY(6px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          {danger && (
            <span
              style={{
                fontSize: 16,
                color: T.hot,
                fontFamily: 'JetBrains Mono',
                lineHeight: 1,
                marginTop: 1,
              }}
            >
              ⚠
            </span>
          )}
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: '-0.012em',
              color: T.text,
              flex: 1,
            }}
          >
            {confirm.title}
          </div>
        </div>

        {/* Message */}
        {confirm.message && (
          <div
            style={{
              fontSize: 13,
              color: T.textMid,
              marginTop: 10,
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}
          >
            {confirm.message}
          </div>
        )}

        {/* Buttons */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 22,
          }}
        >
          <button
            onClick={() => confirm._resolve(false)}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              background: 'transparent',
              color: T.textMid,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
              minWidth: 72,
            }}
          >
            {confirm.cancelLabel}
          </button>
          <button
            onClick={() => confirm._resolve(true)}
            autoFocus
            style={{
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 700,
              background: danger ? '#e8412e' : T.invert,
              color: danger ? '#fff' : T.invertInk,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
              minWidth: 72,
            }}
          >
            {confirm.okLabel}
          </button>
        </div>

        {/* 鍵盤提示 (右下小字) */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: `1px dashed ${T.borderSoft}`,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 14,
            fontSize: 10,
            color: T.textFaint,
            fontFamily: 'JetBrains Mono',
            letterSpacing: '0.06em',
          }}
        >
          <span>
            <b style={{ color: T.textDim }}>ESC</b> 取消
          </span>
          <span>
            <b style={{ color: T.textDim }}>↵</b> 確認
          </span>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { H18ConfirmDialog });
