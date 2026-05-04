// ClassNoteAI · RecoveryPromptModal (H18 視覺語言擴充)
// 對應 src/components/RecoveryPromptModal.tsx + recordingRecoveryService
//
// 觸發時機：app 啟動時 scan() 偵測到 status='recording' 的 DB row +
// 磁碟 .pcm 檔（崩潰時還在錄音的 session），跳全螢幕 modal，要求
// 使用者對每個 session 個別決定「恢復」或「丟棄」。
//
// API: window.h18Recovery.show([sessions]) — sessions 是陣列，
// 包含 { id, lectureTitle, courseShort, durationSec, sizeMb, date }

(function () {
  let current = null;
  const listeners = new Set();

  const notify = () => listeners.forEach((cb) => cb(current));

  const show = (sessions) => {
    current = { sessions: sessions.slice() };
    notify();
  };

  const dismiss = () => {
    current = null;
    notify();
  };

  const removeSession = (id) => {
    if (!current) return;
    current = { sessions: current.sessions.filter((s) => s.id !== id) };
    if (current.sessions.length === 0) current = null;
    notify();
  };

  const subscribe = (cb) => {
    listeners.add(cb);
    cb(current);
    return () => listeners.delete(cb);
  };

  window.h18RecoveryManager = { show, dismiss, removeSession, subscribe };
  window.h18Recovery = { show, dismiss };
})();

const H18RecoveryPrompt = ({ theme: T }) => {
  const [state, setState] = React.useState(null);
  const [resolving, setResolving] = React.useState(null); // { id, action }

  React.useEffect(() => {
    return window.h18RecoveryManager.subscribe(setState);
  }, []);

  if (!state || state.sessions.length === 0) return null;

  const handleAction = async (id, action) => {
    setResolving({ id, action });
    // 模擬 600ms 處理
    await new Promise((r) => setTimeout(r, 600));
    setResolving(null);
    window.h18RecoveryManager.removeSession(id);
    window.h18Toast?.({
      type: action === 'recover' ? 'success' : 'info',
      message: action === 'recover' ? '已恢復錄音' : '已丟棄錄音檔',
      detail: action === 'recover'
        ? '回到該堂 lecture 可看到完整音訊與字幕'
        : '.pcm 檔已從磁碟刪除',
    });
  };

  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9500,
      background: T.mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(20,18,14,0.45)',
      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      display: 'grid', placeItems: 'center',
      animation: `h18RcvBgIn 240ms ${ease}`,
    }}>
      <style>{`
        @keyframes h18RcvBgIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes h18RcvCardIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div style={{
        width: 600, maxWidth: 'calc(100% - 48px)',
        maxHeight: '85vh',
        background: T.surface, color: T.text,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        boxShadow: T.mode === 'dark'
          ? '0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)'
          : '0 30px 80px rgba(0,0,0,0.28)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: '"Inter", "Noto Sans TC", sans-serif',
        animation: `h18RcvCardIn 320ms ${ease} 80ms both`,
      }}>
        {/* Header */}
        <div style={{
          padding: '22px 26px 16px',
          borderBottom: `1px solid ${T.borderSoft}`,
          display: 'flex', alignItems: 'flex-start', gap: 14,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: T.hotBg, color: T.hot,
            display: 'grid', placeItems: 'center',
            fontSize: 18, fontWeight: 800,
            fontFamily: 'JetBrains Mono', flexShrink: 0,
          }}>!</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.18em',
              color: T.hot, fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
              CRASH RECOVERY
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text,
              marginTop: 4, letterSpacing: '-0.012em' }}>
              發現 {state.sessions.length} 個未完成的錄音
            </div>
            <div style={{ fontSize: 12, color: T.textMid, marginTop: 6,
              lineHeight: 1.6 }}>
              上次 ClassNote 異常結束時還在錄音中。請選擇對每個 session
              「恢復」（合併回原 lecture）或「丟棄」（永久刪除 .pcm 檔）。
            </div>
          </div>
        </div>

        {/* Sessions list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {state.sessions.map((s) => {
            const isResolving = resolving?.id === s.id;
            return (
              <div key={s.id} style={{
                padding: '14px 26px',
                borderBottom: `1px solid ${T.borderSoft}`,
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: isResolving ? 0.5 : 1,
                transition: 'opacity 200ms',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: T.surface2,
                  border: `1px solid ${T.border}`,
                  display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 800,
                  color: T.textMid, fontFamily: 'JetBrains Mono',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}>{s.courseShort}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text,
                    whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis' }}>
                    {s.lectureTitle}
                  </div>
                  <div style={{ fontSize: 11, color: T.textDim, marginTop: 3,
                    fontFamily: 'JetBrains Mono', letterSpacing: '0.04em' }}>
                    {s.date} · {Math.floor(s.durationSec / 60)} 分 {s.durationSec % 60} 秒 · {s.sizeMb.toFixed(1)} MB
                  </div>
                </div>
                <button onClick={() => handleAction(s.id, 'discard')}
                  disabled={isResolving}
                  style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 600,
                    background: 'transparent', color: T.textMid,
                    border: `1px solid ${T.border}`,
                    borderRadius: 5, cursor: isResolving ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', flexShrink: 0,
                  }}>
                  {isResolving && resolving.action === 'discard' ? '丟棄中…' : '丟棄'}
                </button>
                <button onClick={() => handleAction(s.id, 'recover')}
                  disabled={isResolving}
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 700,
                    background: T.invert, color: T.invertInk,
                    border: 'none', borderRadius: 5,
                    cursor: isResolving ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', flexShrink: 0,
                  }}>
                  {isResolving && resolving.action === 'recover' ? '恢復中…' : '恢復'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 26px',
          borderTop: `1px solid ${T.border}`,
          background: T.surface2,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 11, color: T.textDim, flex: 1,
            fontFamily: 'JetBrains Mono', letterSpacing: '0.04em' }}>
            ⚠ 必須處理完所有 session 才能繼續使用
          </span>
          <button onClick={() => {
            // 全部丟棄 — 仿真實實作的「discard all」
            state.sessions.forEach((s) =>
              window.h18RecoveryManager.removeSession(s.id));
            window.h18Toast?.({ type: 'info', message: `已丟棄全部 ${state.sessions.length} 個 session` });
          }} style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 600,
            background: 'transparent', color: T.hot,
            border: `1px solid ${T.hot}55`,
            borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            全部丟棄
          </button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { H18RecoveryPrompt });
