// H18 Deep · Floating AI dock (summoned by ⌘J / ⌘/) + Recording page

// Shared AI conversation history (survives page navigation, persists to localStorage)
const H18_AI_STORE_KEY = 'h18-ai-history-v1';
const loadAIHistory = () => {
  try {
    const raw = localStorage.getItem(H18_AI_STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [
    { role: 'ai', text: '我已讀取你目前在看的內容。有什麼想問的？', hint: true },
  ];
};
const saveAIHistory = (msgs) => {
  try { localStorage.setItem(H18_AI_STORE_KEY, JSON.stringify(msgs)); } catch (_) {}
};

// Floating AI ─────────────────────────────────────────────────────
const AIDock = ({ theme: T, open, onClose, contextHint, onExpand }) => {
  const [msgs, setMsgs] = React.useState(loadAIHistory);
  const [q, setQ] = React.useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Persist on every change
  React.useEffect(() => { saveAIHistory(msgs); }, [msgs]);

  if (!open) return null;

  const send = () => {
    if (!q.trim()) return;
    const userMsg = { role: 'user', text: q.trim() };
    setMsgs(m => [...m, userMsg,
      { role: 'ai', thinking: true, text: '讀取相關筆記…' }]);
    setQ('');
    // Simulate streaming response after 900ms
    setTimeout(() => {
      setMsgs(m => {
        const next = [...m];
        next[next.length - 1] = {
          role: 'ai',
          text: '根據 L13 · 38:14，老師提到 scaling factor 是 √d_k，是為了避免 softmax saturate。這題幾乎每年都考。',
          cites: [{ l: 'L13 · 38:14' }, { l: 'L12 · 42:31' }],
        };
        return next;
      });
    }, 900);
  };

  const quickQs = [
    'HW3 怎麼開始？',
    '幫我整理這週重點',
    'L13 有什麼會考？',
    '幫我找老師提到 Q/K/V 的地方',
  ];

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'transparent',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      paddingBottom: 30, pointerEvents: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 620, maxWidth: 'calc(100% - 48px)',
        background: T.surface, color: T.text,
        border: `1px solid ${T.border}`, borderRadius: 14,
        boxShadow: `0 20px 50px ${T.mode === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(20,18,14,0.2)'}`,
        fontFamily: 'Inter, "Noto Sans TC", sans-serif',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        maxHeight: '70vh',
        animation: 'aidockIn 200ms ease-out',
      }}>
        <style>{`
          @keyframes aidockIn {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
        {/* Header */}
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 14, color: T.accent }}>✦</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>AI 助教</span>
          <span style={{ fontSize: 10, color: T.textDim,
            fontFamily: 'JetBrains Mono',
            padding: '2px 8px', background: T.chipBg, borderRadius: 4 }}>
            {contextHint || 'ML · HW3'}
          </span>
          <div style={{ flex: 1 }}/>
          {onExpand && (
            <button onClick={onExpand} title="在 AI 助教頁繼續 (全螢幕)"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', fontSize: 10, fontWeight: 600,
                background: 'transparent', color: T.textMid,
                border: `1px solid ${T.border}`, borderRadius: 4,
                cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 11 }}>⛶</span>
              <span>全螢幕</span>
            </button>
          )}
          <span style={{ fontSize: 10, color: T.textFaint,
            fontFamily: 'JetBrains Mono', whiteSpace: 'nowrap' }}>ESC 關閉</span>
          <button onClick={onClose} style={{
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textMid, cursor: 'pointer', fontSize: 11,
            width: 22, height: 22, borderRadius: 4, padding: 0 }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10 }}>
          {msgs.map((m, i) => {
            if (m.hint) {
              return (
                <div key={i} style={{ alignSelf: 'stretch',
                  padding: '10px 12px', borderRadius: 8,
                  background: T.surface2, border: `1px dashed ${T.borderSoft}`,
                  fontSize: 12, color: T.textMid, lineHeight: 1.55 }}>
                  {m.text}
                </div>
              );
            }
            if (m.role === 'user') {
              return (
                <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '80%',
                  padding: '8px 12px', borderRadius: 12,
                  background: T.invert, color: T.invertInk,
                  fontSize: 13, lineHeight: 1.5 }}>{m.text}</div>
              );
            }
            return (
              <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '90%',
                padding: '10px 14px', borderRadius: 12,
                background: T.surface2, color: T.text,
                border: `1px solid ${T.borderSoft}`,
                fontSize: 13, lineHeight: 1.55 }}>
                {m.thinking && (
                  <span style={{ display: 'inline-flex', gap: 3, marginRight: 6 }}>
                    {[0, 1, 2].map(j => <span key={j} style={{ width: 5, height: 5,
                      borderRadius: 3, background: T.textDim,
                      opacity: 0.3 + j * 0.25,
                      animation: `pulse 1.2s ${j * 0.2}s infinite ease-in-out` }}/>)}
                  </span>
                )}
                {m.text}
                {m.cites && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {m.cites.map((c, j) => (
                      <span key={j} style={{ fontSize: 10, color: T.accent,
                        padding: '2px 7px', border: `1px solid ${T.accent}55`,
                        borderRadius: 999, cursor: 'pointer',
                        fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
                        → {c.l}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {msgs.length <= 1 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
              {quickQs.map(q => (
                <button key={q} onClick={() => setQ(q)} style={{
                  padding: '5px 10px', fontSize: 11, fontWeight: 500,
                  border: `1px solid ${T.border}`, borderRadius: 999,
                  background: 'transparent', color: T.textMid, cursor: 'pointer',
                  fontFamily: 'inherit' }}>{q}</button>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${T.border}`,
          display: 'flex', gap: 8, flexShrink: 0, background: T.surface2 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 8,
            background: T.surface, border: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 12, color: T.textDim }}>?</span>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder="問任何問題，或貼上關鍵字..."
              style={{ flex: 1, border: 'none', background: 'transparent',
                color: T.text, outline: 'none', fontSize: 13,
                fontFamily: 'inherit' }}/>
            <span style={{ fontSize: 10, color: T.textFaint,
              fontFamily: 'JetBrains Mono' }}>↵</span>
          </div>
          <button onClick={send} style={{
            padding: '0 14px', background: T.invert, color: T.invertInk,
            border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit' }}>送出</button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { AIDock });
