// ClassNoteAI · autoAlignmentService UI banner (H18 視覺語言擴充)
// 對應 src/services/autoAlignmentService.ts (alignment suggestion)
//
// 觸發時機：錄音 / review 時，AI 偵測老師翻投影片，跳一個建議 banner
// 「AI 偵測到老師翻到 p.15」+ 接受 / 略過 + 8 秒自動消失
//
// API: window.h18AlignmentBanner.show({ fromPage, toPage, lectureContext })

(function () {
  let current = null;
  let timer = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((cb) => cb(current));

  const dismiss = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    current = null;
    notify();
  };

  const show = (opts) => {
    if (timer) clearTimeout(timer);
    current = {
      id: Math.random(),
      fromPage: opts.fromPage || 1,
      toPage: opts.toPage || 2,
      lectureContext: opts.lectureContext || 'ML · L13',
      auto: false, // user can mark this as accepted
    };
    notify();
    // 8 秒自動消失
    timer = setTimeout(() => dismiss(), 8000);
  };

  const subscribe = (cb) => {
    listeners.add(cb);
    cb(current);
    return () => listeners.delete(cb);
  };

  window.h18AlignmentBannerManager = { show, dismiss, subscribe };
  window.h18AlignmentBanner = { show, dismiss };
})();

const H18AlignmentBanner = ({ theme: T }) => {
  const [b, setB] = React.useState(null);
  const [accepted, setAccepted] = React.useState(false);

  React.useEffect(() => {
    return window.h18AlignmentBannerManager.subscribe((v) => {
      setB(v);
      setAccepted(false);
    });
  }, []);

  if (!b) return null;
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  const accept = () => {
    setAccepted(true);
    window.h18Toast?.({
      type: 'success',
      message: `已對齊到 p.${b.toPage}`,
      detail: '後續字幕段會自動關聯到這頁投影片',
    });
    setTimeout(() => window.h18AlignmentBannerManager.dismiss(), 600);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 60, // top bar 之下
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 100,
      animation: `h18AbDrop 280ms ${ease}`,
      pointerEvents: 'auto',
    }}>
      <style>{`
        @keyframes h18AbDrop {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes h18AbBar {
          from { transform: scaleX(1); } to { transform: scaleX(0); }
        }
      `}</style>

      <div style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        padding: '6px 6px 6px 16px',
        boxShadow: T.mode === 'dark'
          ? '0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.06) inset'
          : '0 8px 24px rgba(0,0,0,0.14)',
        display: 'flex', alignItems: 'center', gap: 12,
        fontFamily: '"Inter", "Noto Sans TC", sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* AI accent icon */}
        <span style={{
          fontSize: 13, color: T.accent, fontWeight: 800,
          fontFamily: 'JetBrains Mono', flexShrink: 0,
        }}>✦</span>

        {/* Message */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8,
          flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>
            AI 偵測到老師翻到投影片
          </span>
          <span style={{
            fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700,
            padding: '2px 8px', borderRadius: 4,
            background: T.chipBg, color: T.textMid,
            letterSpacing: '0.04em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            p.{b.fromPage} → p.{b.toPage}
          </span>
        </div>

        <span style={{ flex: 1 }}/>

        {accepted ? (
          <span style={{ fontSize: 11, color: '#22c55e',
            fontWeight: 700, padding: '0 8px',
            fontFamily: 'JetBrains Mono', letterSpacing: '0.06em',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <svg width="12" height="12" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="9" fill="#22c55e"/>
              <path d="M5.5 10.5 L8.5 13.5 L14.5 7.5"
                stroke="#fff" strokeWidth="2.5" fill="none"
                strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            已接受
          </span>
        ) : (
          <>
            <button onClick={() => window.h18AlignmentBannerManager.dismiss()}
              style={{
                padding: '5px 10px', fontSize: 11, fontWeight: 600,
                background: 'transparent', color: T.textMid,
                border: `1px solid ${T.border}`, borderRadius: 999,
                cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
              }}>略過</button>
            <button onClick={accept}
              style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 700,
                background: T.invert, color: T.invertInk,
                border: 'none', borderRadius: 999,
                cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>跳到 p.{b.toPage}</button>
          </>
        )}

        {/* Countdown bar — 8 秒倒數 */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 2, background: T.borderSoft, overflow: 'hidden',
          borderRadius: '0 0 999px 999px',
        }}>
          <div style={{
            width: '100%', height: '100%',
            background: T.accent, opacity: 0.7,
            transformOrigin: 'left',
            animation: `h18AbBar 8000ms linear forwards`,
          }}/>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { H18AlignmentBanner });
