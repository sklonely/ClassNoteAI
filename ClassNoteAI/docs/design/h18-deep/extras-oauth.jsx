// ClassNoteAI · OAuth flow + UnofficialChannelWarning (H18 視覺語言擴充)
//
// 兩個元件相關所以放同檔：
//   1. UnofficialChannelWarning · 第一次點 ChatGPT OAuth 的警告 modal
//      對應 src/components/UnofficialChannelWarning.tsx
//   2. OAuth 登入流程 modal · 點登入後的 「已開啟瀏覽器」狀態 + 等待 +
//      成功/失敗 結果

// ─── 1. UnofficialChannelWarning ─────────────────────────────
(function () {
  let current = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((cb) => cb(current));

  const show = (opts) =>
    new Promise((resolve) => {
      current = {
        provider: opts.provider || 'ChatGPT',
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
    return () => listeners.delete(cb);
  };

  window.h18OauthWarningManager = { show, subscribe };
  window.h18OauthWarning = { show };
})();

const H18UnofficialChannelWarning = ({ theme: T }) => {
  const [w, setW] = React.useState(null);
  const [acknowledged, setAcknowledged] = React.useState(false);

  React.useEffect(() => {
    return window.h18OauthWarningManager.subscribe((v) => {
      setW(v);
      setAcknowledged(false);
    });
  }, []);

  if (!w) return null;
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div onClick={() => w._resolve(false)} style={{
      position: 'fixed', inset: 0, zIndex: 9100,
      background: T.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(20,18,14,0.35)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'grid', placeItems: 'center',
      animation: `h18OwIn 200ms ${ease}`,
    }}>
      <style>{`
        @keyframes h18OwIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes h18OwCard {
          from { opacity: 0; transform: scale(0.96) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 480, maxWidth: 'calc(100% - 48px)',
        background: T.surface, color: T.text,
        border: `1px solid ${T.border}`, borderRadius: 12,
        boxShadow: T.mode === 'dark'
          ? '0 30px 80px rgba(0,0,0,0.6)' : '0 30px 80px rgba(0,0,0,0.22)',
        padding: 24,
        fontFamily: '"Inter", "Noto Sans TC", sans-serif',
        animation: `h18OwCard 240ms ${ease}`,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: T.hotBg, color: T.hot,
            display: 'grid', placeItems: 'center',
            fontSize: 16, fontWeight: 800,
            fontFamily: 'JetBrains Mono', flexShrink: 0,
          }}>⚠</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.18em',
              color: T.hot, fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
              UNOFFICIAL CHANNEL
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text,
              marginTop: 4, letterSpacing: '-0.012em' }}>
              使用非官方管道登入 {w.provider}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ marginTop: 16, fontSize: 12, color: T.textMid,
          lineHeight: 1.75 }}>
          <p style={{ margin: '0 0 10px' }}>
            這個登入流程<b style={{ color: T.text }}>不是 OpenAI 官方 SDK</b>，
            而是透過 Codex CLI 的 OAuth flow 取得 token，之後直接呼叫
            ChatGPT 訂閱的內部 API。
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, color: T.textMid }}>
            <li>OpenAI 隨時可能調整或終止這個 endpoint，造成功能失效</li>
            <li>Token 加密存在本機 SQLite，不會上傳到任何伺服器</li>
            <li>如果你有官方 API key，建議改用「OpenAI API」provider 比較穩定</li>
          </ul>
        </div>

        {/* Acknowledgment checkbox */}
        <label style={{
          marginTop: 18, padding: '12px 14px',
          display: 'flex', alignItems: 'flex-start', gap: 12,
          borderRadius: 8, background: T.surface2,
          border: `1px solid ${T.borderSoft}`,
          cursor: 'pointer',
        }}>
          <input type="checkbox" checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{ marginTop: 3, width: 14, height: 14,
              accentColor: T.accent, cursor: 'pointer' }}/>
          <span style={{ fontSize: 12, color: T.text, lineHeight: 1.55 }}>
            我了解這是非官方管道，並接受 OpenAI 隨時可能終止此流程的風險。
          </span>
        </label>

        {/* Buttons */}
        <div style={{ marginTop: 18, display: 'flex', gap: 8,
          justifyContent: 'flex-end' }}>
          <button onClick={() => w._resolve(false)} style={{
            padding: '8px 16px', fontSize: 12, fontWeight: 600,
            background: 'transparent', color: T.textMid,
            border: `1px solid ${T.border}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>取消</button>
          <button onClick={() => w._resolve(true)}
            disabled={!acknowledged}
            style={{
              padding: '8px 16px', fontSize: 12, fontWeight: 700,
              background: acknowledged ? T.invert : T.surface2,
              color: acknowledged ? T.invertInk : T.textDim,
              border: `1px solid ${acknowledged ? T.invert : T.border}`,
              borderRadius: 6,
              cursor: acknowledged ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}>繼續登入</button>
        </div>
      </div>
    </div>
  );
};

// ─── 2. OAuth Flow Modal ─────────────────────────────────────
(function () {
  let current = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((cb) => cb(current));

  const show = (opts) =>
    new Promise((resolve) => {
      current = {
        provider: opts.provider || 'ChatGPT',
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
    return () => listeners.delete(cb);
  };

  window.h18OauthFlowManager = { show, subscribe };
  window.h18OauthFlow = { show };
})();

const H18OauthFlowModal = ({ theme: T }) => {
  const [flow, setFlow] = React.useState(null);
  // step: 'browser' | 'success' | 'error'
  const [step, setStep] = React.useState('browser');
  const [errorMsg, setErrorMsg] = React.useState(null);

  React.useEffect(() => {
    return window.h18OauthFlowManager.subscribe((v) => {
      setFlow(v);
      setStep('browser');
      setErrorMsg(null);
    });
  }, []);

  // 自動演示：browser step 2.5 秒後 → success
  React.useEffect(() => {
    if (!flow || step !== 'browser') return;
    const t = setTimeout(() => setStep('success'), 2500);
    return () => clearTimeout(t);
  }, [flow, step]);

  if (!flow) return null;
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9200,
      background: T.mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(20,18,14,0.45)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      display: 'grid', placeItems: 'center',
      animation: `h18OfBg 200ms ${ease}`,
    }}>
      <style>{`
        @keyframes h18OfBg { from { opacity: 0 } to { opacity: 1 } }
        @keyframes h18OfCard {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes h18OfSpin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
        @keyframes h18OfPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
      `}</style>

      <div style={{
        width: 460, maxWidth: 'calc(100% - 48px)',
        background: T.surface, color: T.text,
        border: `1px solid ${T.border}`, borderRadius: 14,
        boxShadow: T.mode === 'dark'
          ? '0 30px 80px rgba(0,0,0,0.6)' : '0 30px 80px rgba(0,0,0,0.24)',
        overflow: 'hidden',
        fontFamily: '"Inter", "Noto Sans TC", sans-serif',
        animation: `h18OfCard 280ms ${ease}`,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${T.borderSoft}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 10, letterSpacing: '0.18em',
            color: T.textDim, fontWeight: 800,
            fontFamily: 'JetBrains Mono' }}>
            OAUTH · {flow.provider.toUpperCase()}
          </span>
          <div style={{ flex: 1 }}/>
          <button onClick={() => flow._resolve({ success: false, cancelled: true })}
            style={{
              background: 'transparent', border: `1px solid ${T.border}`,
              color: T.textMid, width: 26, height: 26, borderRadius: 5,
              fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
            }}>✕</button>
        </div>

        {/* Body — varies by step */}
        <div style={{ padding: '32px 28px', textAlign: 'center' }}>
          {step === 'browser' && (
            <>
              {/* Mock browser window */}
              <div style={{
                width: 220, height: 130, margin: '0 auto',
                background: T.surface2,
                border: `1px solid ${T.border}`, borderRadius: 8,
                position: 'relative', overflow: 'hidden',
              }}>
                {/* Browser chrome */}
                <div style={{ height: 16, background: T.border,
                  display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
                  <span style={{ width: 5, height: 5, borderRadius: 3, background: '#e8412e' }}/>
                  <span style={{ width: 5, height: 5, borderRadius: 3, background: '#f6b24e' }}/>
                  <span style={{ width: 5, height: 5, borderRadius: 3, background: '#22c55e' }}/>
                  <div style={{ flex: 1, height: 8, background: T.surface,
                    borderRadius: 2, marginLeft: 4 }}/>
                </div>
                {/* Mock signin form */}
                <div style={{ padding: 16, textAlign: 'left' }}>
                  <div style={{ height: 8, width: '60%', background: T.text,
                    opacity: 0.7, borderRadius: 2, marginBottom: 8 }}/>
                  <div style={{ height: 5, width: '90%', background: T.textDim,
                    opacity: 0.4, borderRadius: 2, marginBottom: 4 }}/>
                  <div style={{ height: 5, width: '85%', background: T.textDim,
                    opacity: 0.4, borderRadius: 2, marginBottom: 12 }}/>
                  <div style={{ height: 16, background: '#10a37f',
                    borderRadius: 3, animation: 'h18OfPulse 1.4s ease infinite' }}/>
                </div>
              </div>

              <div style={{ marginTop: 20, fontSize: 14, fontWeight: 700,
                color: T.text, letterSpacing: '-0.01em' }}>
                已開啟瀏覽器登入
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: T.textMid,
                lineHeight: 1.6 }}>
                請在瀏覽器中完成登入，這裡會自動偵測並繼續。
              </div>

              {/* Spinner */}
              <div style={{ marginTop: 20, display: 'flex',
                alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: `2px solid ${T.border}`,
                  borderTopColor: T.accent, borderRightColor: T.accent,
                  animation: 'h18OfSpin 900ms linear infinite',
                }}/>
                <span style={{ fontSize: 11, color: T.textDim,
                  fontFamily: 'JetBrains Mono', letterSpacing: '0.06em' }}>
                  WAITING FOR CALLBACK
                </span>
              </div>

              {/* Dev shortcut buttons */}
              <div style={{ marginTop: 24, display: 'flex',
                justifyContent: 'center', gap: 8 }}>
                <button onClick={() => setStep('success')} style={{
                  padding: '5px 11px', fontSize: 10, fontWeight: 600,
                  background: 'transparent', color: T.textFaint,
                  border: `1px dashed ${T.border}`, borderRadius: 4,
                  cursor: 'pointer', fontFamily: 'JetBrains Mono',
                  letterSpacing: '0.04em',
                }}>SIMULATE SUCCESS</button>
                <button onClick={() => {
                  setErrorMsg('User cancelled the OAuth flow in browser');
                  setStep('error');
                }} style={{
                  padding: '5px 11px', fontSize: 10, fontWeight: 600,
                  background: 'transparent', color: T.textFaint,
                  border: `1px dashed ${T.border}`, borderRadius: 4,
                  cursor: 'pointer', fontFamily: 'JetBrains Mono',
                  letterSpacing: '0.04em',
                }}>SIMULATE ERROR</button>
              </div>
            </>
          )}

          {step === 'success' && (
            <>
              <div style={{
                width: 56, height: 56, borderRadius: 28,
                background: T.surface2,
                border: `2px solid ${T.mode === 'dark' ? 'rgba(34,197,94,0.4)' : '#22c55e'}`,
                display: 'grid', placeItems: 'center', margin: '0 auto',
                animation: `h18OfCard 360ms ${ease}`,
              }}>
                <svg width="28" height="28" viewBox="0 0 20 20">
                  <path d="M5 10.5 L8.5 14 L15 6.5"
                    stroke="#22c55e" strokeWidth="2.5" fill="none"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ marginTop: 18, fontSize: 16, fontWeight: 800,
                color: T.text, letterSpacing: '-0.01em' }}>
                登入成功
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: T.textMid,
                lineHeight: 1.6 }}>
                Token 已加密存在本機。
                {flow.provider} 現在可以為 ClassNote 提供 AI 服務了。
              </div>
              <div style={{
                marginTop: 14, padding: '6px 12px', display: 'inline-block',
                background: T.chipBg, color: T.textMid,
                borderRadius: 4, fontSize: 10,
                fontFamily: 'JetBrains Mono', letterSpacing: '0.08em',
              }}>
                hank@example.com · ChatGPT Plus
              </div>
              <div style={{ marginTop: 24 }}>
                <button onClick={() => flow._resolve({ success: true,
                  account: 'hank@example.com', plan: 'ChatGPT Plus' })}
                  style={{
                    padding: '10px 22px', fontSize: 12, fontWeight: 700,
                    background: T.invert, color: T.invertInk,
                    border: 'none', borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>完成</button>
              </div>
            </>
          )}

          {step === 'error' && (
            <>
              <div style={{
                width: 56, height: 56, borderRadius: 28,
                background: T.hotBg,
                display: 'grid', placeItems: 'center', margin: '0 auto',
              }}>
                <svg width="28" height="28" viewBox="0 0 20 20">
                  <path d="M6 6 L14 14 M14 6 L6 14"
                    stroke={T.hot} strokeWidth="2.5"
                    strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ marginTop: 18, fontSize: 16, fontWeight: 800,
                color: T.text, letterSpacing: '-0.01em' }}>
                登入失敗
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: T.textMid,
                lineHeight: 1.6 }}>
                無法完成 OAuth 流程。可重試或改用其他 provider。
              </div>
              {errorMsg && (
                <div style={{
                  marginTop: 14, padding: 10,
                  background: T.surface2,
                  border: `1px solid ${T.borderSoft}`,
                  borderRadius: 6, fontSize: 11,
                  fontFamily: 'JetBrains Mono', color: T.textMid,
                  textAlign: 'left',
                }}>
                  {errorMsg}
                </div>
              )}
              <div style={{ marginTop: 24, display: 'flex', gap: 8,
                justifyContent: 'center' }}>
                <button onClick={() => flow._resolve({ success: false, error: errorMsg })}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 600,
                    background: 'transparent', color: T.textMid,
                    border: `1px solid ${T.border}`, borderRadius: 6,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>取消</button>
                <button onClick={() => { setErrorMsg(null); setStep('browser'); }}
                  style={{
                    padding: '8px 18px', fontSize: 12, fontWeight: 700,
                    background: T.invert, color: T.invertInk,
                    border: 'none', borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>重試</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { H18UnofficialChannelWarning, H18OauthFlowModal });
