// ClassNoteAI · Login Screen (H18 視覺語言擴充)
// 對應 src/components/LoginScreen.tsx — local-first auth：單一 username 欄位、
// 不存在自動 register、無密碼、資料留本機。
//
// 視覺策略：跟 SetupWizard 共用相同 chrome（logo + 主題切換），但卡片更窄
// (440px) 表達「進入前最後一道門」的輕量感。

const LoginApp = ({ initialTheme = 'light', onLogin }) => {
  const [theme, setTheme] = React.useState(initialTheme);
  const [username, setUsername] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ⌘\ 切換主題（與整個 H18 統一）
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setTheme(t => t === 'light' ? 'dark' : 'light');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const T = window.H18_THEMES[theme];

  const submit = async () => {
    const u = username.trim();
    if (!u) return;
    setLoading(true);
    setError(null);
    // Mock：模擬 800ms 延遲後成功
    await new Promise(r => setTimeout(r, 800));
    setLoading(false);
    if (u === 'error') {
      setError('無法建立帳號，請改用其他名稱');
      return;
    }
    onLogin?.(u);
  };

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: T.bg, fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      color: T.text, position: 'relative', overflow: 'hidden',
    }}>

      {/* 隱約的對角線背景紋理 — 跟 SetupWizard 同款 */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(${T.mode === 'dark' ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.018)'} 1px, transparent 1px),
                          linear-gradient(90deg, ${T.mode === 'dark' ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.018)'} 1px, transparent 1px)`,
        backgroundSize: '44px 44px',
      }}/>

      {/* 頂部：traffic lights + logo + 主題切換 */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12, zIndex: 2,
      }}>
        {window.H18WindowControls && (
          <>
            <H18WindowControls theme={T}
              onClose={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'close' } }))}
              onMinimize={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'min' } }))}
              onMaximize={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'max' } }))}/>
            <div style={{ width: 1, height: 14, background: T.border, margin: '0 2px' }}/>
          </>
        )}
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: T.invert, color: T.invertInk,
          display: 'grid', placeItems: 'center',
          fontSize: 13, fontWeight: 800, letterSpacing: '-0.02em',
        }}>C</div>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text,
          letterSpacing: '-0.01em' }}>ClassNote</span>
        <div style={{ flex: 1 }}/>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          title="切換主題 (⌘\)"
          style={{
            padding: '5px 11px', fontSize: 11, fontWeight: 600,
            background: 'transparent', color: T.textMid,
            border: `1px solid ${T.border}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
          {theme === 'light' ? '☾' : '☀'}
          <span>{theme === 'light' ? '深色' : '亮色'}</span>
        </button>
      </div>

      {/* 中央卡片 + 底下說明 — 整體垂直居中 */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 18, width: 440, maxWidth: 'calc(100% - 48px)',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          width: '100%',
          background: T.surface, borderRadius: 14,
          border: `1px solid ${T.border}`,
          boxShadow: T.mode === 'dark'
            ? '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
            : '0 30px 80px rgba(0,0,0,0.12)',
          padding: '32px 36px 28px',
        }}>
          {/* Hero — 不放大圖示，用 mono 標籤 + 大標題的 H18 排版 */}
          <div style={{ fontSize: 10, letterSpacing: '0.18em',
            color: T.textDim, fontWeight: 800,
            fontFamily: 'JetBrains Mono' }}>
            CLASSNOTE · LOCAL-FIRST
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.022em',
            color: T.text, marginTop: 8, lineHeight: 1.2 }}>
            歡迎回來
          </div>
          <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
            lineHeight: 1.6 }}>
            輸入用戶名繼續。沒有帳號的話會自動建立。
          </div>

          {/* Username input */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em',
              color: T.textDim, fontWeight: 800,
              fontFamily: 'JetBrains Mono', marginBottom: 8 }}>
              USER NAME
            </div>
            <div style={{
              display: 'flex', alignItems: 'center',
              padding: '12px 14px',
              background: T.surface2, color: T.text,
              border: `1.5px solid ${error ? T.hot : T.border}`,
              borderRadius: 8,
              transition: 'border-color 160ms',
            }}>
              <span style={{ fontSize: 14, color: T.textDim, marginRight: 10,
                fontFamily: 'JetBrains Mono' }}>@</span>
              <input ref={inputRef}
                value={username}
                onChange={e => { setUsername(e.target.value); if (error) setError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                disabled={loading}
                placeholder="hank"
                spellCheck={false}
                style={{
                  flex: 1, border: 'none', outline: 'none',
                  background: 'transparent', color: T.text,
                  fontSize: 15, fontFamily: 'JetBrains Mono',
                  letterSpacing: '-0.005em',
                }}/>
              {username && (
                <span style={{ fontSize: 10, color: T.textFaint,
                  fontFamily: 'JetBrains Mono',
                  padding: '2px 7px', border: `1px solid ${T.border}`,
                  borderRadius: 3, letterSpacing: '0.08em' }}>↵</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 6,
              lineHeight: 1.5 }}>
              用戶名只用來識別本機資料夾，輸入新名稱會自動建立新帳號。
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              marginTop: 14, padding: '10px 12px',
              background: T.hotBg, color: T.hot,
              border: `1px solid ${T.mode === 'dark' ? 'rgba(255,171,122,0.25)' : '#f4cdb8'}`,
              borderRadius: 7,
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, lineHeight: 1.5,
            }}>
              <span>⚠</span>
              {error}
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={submit}
            disabled={loading || !username.trim()}
            style={{
              marginTop: 18, width: '100%',
              padding: '12px 16px', fontSize: 13, fontWeight: 700,
              background: loading || !username.trim() ? T.surface2 : T.invert,
              color: loading || !username.trim() ? T.textDim : T.invertInk,
              border: `1px solid ${loading || !username.trim() ? T.border : T.invert}`,
              borderRadius: 8,
              cursor: loading || !username.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background 160ms, color 160ms',
            }}>
            {loading ? (
              <>
                <span style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: `2px solid ${T.textDim}`, borderTopColor: 'transparent',
                  animation: 'loginSpin 700ms linear infinite',
                  display: 'inline-block',
                }}/>
                處理中…
              </>
            ) : (
              <>開始 →</>
            )}
          </button>
          <style>{`@keyframes loginSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

          {/* Divider 區塊 — 顯示本機優先的承諾 */}
          <div style={{
            marginTop: 22, paddingTop: 16,
            borderTop: `1px dashed ${T.borderSoft}`,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {[
              { k: '本機優先', v: '所有資料留你的電腦，無雲端強制同步' },
              { k: '無密碼',   v: '用戶名即身份；不會被傳到任何伺服器' },
              { k: '可清除',   v: '在「資料管理」→「資料資料夾」可整包刪除' },
            ].map(item => (
              <div key={item.k} style={{
                display: 'flex', alignItems: 'baseline', gap: 10,
                fontSize: 11, lineHeight: 1.5,
              }}>
                <span style={{
                  fontSize: 9, letterSpacing: '0.14em', fontWeight: 800,
                  color: T.textDim, fontFamily: 'JetBrains Mono',
                  minWidth: 56, flexShrink: 0,
                }}>{item.k}</span>
                <span style={{ color: T.textMid }}>{item.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 卡片下方版本資訊 */}
        <div style={{
          fontSize: 10, color: T.textFaint, fontFamily: 'JetBrains Mono',
          letterSpacing: '0.08em',
        }}>
          v0.6.5-alpha · macOS / Windows / Linux
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { LoginApp });
