// H18 Deep · Layout variants + tweaks

// 統一 layout shell (rail | main content)
//
// 之前拆三個 H18LayoutA/B/C 等價元件 (只差 variant prop)，造成切換
// tweaks.layout 時 React 視為不同 component type → 整棵樹 unmount +
// remount → ProfilePage 也被重建，內部 tab state (例如「介面與顯示」)
// 重置回預設 'overview'。
//
// 改成單一元件用 variant 當 prop，切換只觸發 prop change，不會 remount。
const H18Layout = ({ theme: T, selected, onSelect, dense, activeNav, onNav,
  onOpenSettings, onOpenSetupWizard, tweaks, applyTweaks }) => (
  <div style={{ flex: 1, display: 'grid',
    gridTemplateColumns: '62px 1fr',
    overflow: 'hidden', background: T.border, gap: 1 }}>
    <H18Rail theme={T} activeNav={activeNav} onNav={onNav} onOpenSettings={onOpenSettings}/>
    <H18MainContent theme={T} selected={selected} onSelect={onSelect}
      dense={dense} variant={tweaks?.layout || 'A'}
      activeNav={activeNav} onNav={onNav}
      onOpenSetupWizard={onOpenSetupWizard}
      tweaks={tweaks} applyTweaks={applyTweaks}/>
  </div>
);

// Dispatcher — picks home/course/ai/profile based on activeNav
const H18MainContent = ({ theme: T, selected, onSelect, dense, variant, activeNav, onNav, onOpenSetupWizard, tweaks, applyTweaks }) => {
  if (activeNav.startsWith('course:')) {
    const courseId = activeNav.slice(7);
    return <CourseDetailPage theme={T} courseId={courseId}
      onBack={() => onNav('home')}
      onStartRecording={() => onNav('recording:' + courseId)}
      onOpenReview={(n) => onNav('review:' + courseId + ':' + n)}
      onOpenReminder={(rid) => { onSelect({ course: courseId, reminder: rid }); onNav('home'); }}/>;
  }
  if (activeNav.startsWith('recording:')) {
    const courseId = activeNav.slice(10);
    const c = window.v3GetCourse ? window.v3GetCourse(courseId) : null;
    const lectureN = c?.nextLec?.n || 14;
    return <RecordingPage theme={T} courseId={courseId}
      onBack={() => onNav('course:' + courseId)}
      onFinish={() => onNav('review:' + courseId + ':' + lectureN)}/>;
  }
  if (activeNav.startsWith('review:')) {
    const [, cid, ln] = activeNav.split(':');
    return <ReviewPage theme={T} courseId={cid} lectureN={parseInt(ln, 10)}
      onBack={() => onNav('course:' + cid)}
      onJumpLecture={(n) => onNav('review:' + cid + ':' + n)}/>;
  }
  if (activeNav === 'ai') {
    return <AIPage theme={T} onBack={() => onNav('home')}/>;
  }
  if (activeNav === 'notes') {
    return <NotesEditorPage theme={T} onBack={() => onNav('home')}/>;
  }
  if (activeNav === 'profile') {
    return <ProfilePage theme={T} onBack={() => onNav('home')}
      onOpenSetupWizard={onOpenSetupWizard}
      tweaks={tweaks} applyTweaks={applyTweaks}/>;
  }
  // home — render A/B/C home layout
  return <HomeLayout theme={T} selected={selected} onSelect={onSelect}
    dense={dense} variant={variant} onNav={onNav}/>;
};

// Home layout (factored out of A/B/C) ─────────────────────────────
const HomeLayout = ({ theme: T, selected, onSelect, dense, variant, onNav }) => {
  if (variant === 'B') {
    return (
      <div style={{ display: 'grid',
        gridTemplateColumns: '1fr 420px',
        gap: 1, background: T.border, overflow: 'hidden' }}>
        <H18Inbox theme={T} dense={dense} selectedId={selected.reminder}
          onSelect={r => onSelect({ ...selected, reminder: r })}/>
        <div style={{ display: 'flex', flexDirection: 'column',
          background: T.surface, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: `1px solid ${T.border}`,
            height: 260, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: T.text }}>今日</div>
              <div style={{ fontSize: 10, color: T.textDim,
                fontFamily: 'JetBrains Mono' }}>週一 04/21</div>
            </div>
            <H18Calendar theme={T} compact onlyToday onNav={onNav}/>
          </div>
          <H18Preview theme={T} course={selected.course}/>
        </div>
      </div>
    );
  }
  if (variant === 'C') {
    return (
      <div style={{ display: 'grid',
        gridTemplateColumns: '1fr 440px',
        gap: 1, background: T.border, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column',
          background: T.surface, overflow: 'hidden', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text,
              letterSpacing: '-0.02em' }}>本週行事曆</div>
            <div style={{ fontSize: 11, color: T.textDim,
              fontFamily: 'JetBrains Mono' }}>04/21 → 04/27 · 7 堂課 · 下一堂 19:00</div>
          </div>
          <H18Calendar theme={T} onNav={onNav}/>
        </div>
        <H18Inbox theme={T} dense={dense} selectedId={selected.reminder}
          onSelect={r => onSelect({ ...selected, reminder: r })}/>
      </div>
    );
  }
  // variant A
  return (
    <div style={{ display: 'grid',
      gridTemplateColumns: '1fr 380px',
      gap: 1, background: T.border, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column',
        background: T.surface, overflow: 'hidden' }}>
        <div style={{ padding: 14, borderBottom: `1px solid ${T.border}`,
          background: T.surface, display: 'flex', flexDirection: 'column',
          height: 280, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.text,
              letterSpacing: '-0.01em' }}>本週行事曆</div>
            <div style={{ fontSize: 10, color: T.textDim,
              fontFamily: 'JetBrains Mono' }}>04/21 → 04/27</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {['◀','本週','▶'].map((l,i)=>(
                <button key={i} style={{
                  padding: '3px 10px', fontSize: 10, fontWeight: 600,
                  border: `1px solid ${i===1 ? T.invert : T.border}`, borderRadius: 4,
                  background: i===1 ? T.invert : 'transparent',
                  color: i===1 ? T.invertInk : T.textMid,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>{l}</button>
              ))}
            </div>
          </div>
          <H18Calendar theme={T} compact onNav={onNav}/>
        </div>
        <H18Inbox theme={T} dense={dense} selectedId={selected.reminder}
          onSelect={r => onSelect({ ...selected, reminder: r })}/>
      </div>
      <H18Preview theme={T} course={selected.course}/>
    </div>
  );
};

// Settings modal (renamed from TweaksPanel — but same name kept for export) ─────
const TweaksPanel = ({ open, onClose, tweaks, setTweaks, theme: T }) => {
  if (!open) return null;
  const Row = ({ label, hint, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.text,
          letterSpacing: '0.04em' }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: T.textDim }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
  const Seg = ({ active, onClick, children, wide }) => (
    <button onClick={onClick} style={{
      padding: wide ? '8px 14px' : '6px 12px', fontSize: 12, fontWeight: 600,
      border: `1px solid ${active ? T.invert : T.border}`,
      borderRadius: 6,
      background: active ? T.invert : 'transparent',
      color: active ? T.invertInk : T.textMid,
      cursor: 'pointer', fontFamily: 'inherit',
      minWidth: wide ? 110 : 'auto', textAlign: 'left',
    }}>{children}</button>
  );
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: T.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(20,18,14,0.35)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'grid', placeItems: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, color: T.text,
        border: `1px solid ${T.border}`, borderRadius: 14,
        boxShadow: T.shadow, width: 460,
        padding: 24, fontFamily: 'Inter, "Noto Sans TC", sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>設定</div>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
              外觀、佈局、密度
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textMid, cursor: 'pointer', fontSize: 12,
            width: 28, height: 28, borderRadius: 6 }}>✕</button>
        </div>

        <Row label="主題" hint="⌘\ 快速切換">
          <Seg wide active={tweaks.theme === 'light'} onClick={() => setTweaks({ ...tweaks, theme: 'light' })}>
            ☀  亮色
          </Seg>
          <Seg wide active={tweaks.theme === 'dark'}  onClick={() => setTweaks({ ...tweaks, theme: 'dark'  })}>
            ☾  深色
          </Seg>
        </Row>

        <Row label="佈局">
          <Seg wide active={tweaks.layout === 'A'} onClick={() => setTweaks({ ...tweaks, layout: 'A' })}>
            A · 原版
          </Seg>
          <Seg wide active={tweaks.layout === 'B'} onClick={() => setTweaks({ ...tweaks, layout: 'B' })}>
            B · Inbox 為主
          </Seg>
          <Seg wide active={tweaks.layout === 'C'} onClick={() => setTweaks({ ...tweaks, layout: 'C' })}>
            C · 行事曆大
          </Seg>
        </Row>

        <Row label="密度">
          <Seg wide active={!tweaks.dense} onClick={() => setTweaks({ ...tweaks, dense: false })}>
            舒適
          </Seg>
          <Seg wide active={tweaks.dense} onClick={() => setTweaks({ ...tweaks, dense: true })}>
            緊密
          </Seg>
        </Row>

        <div style={{ marginTop: 4, paddingTop: 14,
          borderTop: `1px solid ${T.borderSoft}`,
          fontSize: 10, color: T.textDim, lineHeight: 1.7,
          fontFamily: 'JetBrains Mono' }}>
          <div>⌘J  呼出 AI</div>
          <div>J / K  在 Inbox 上下移動</div>
          <div>⌘\  切換主題</div>
        </div>
      </div>
    </div>
  );
};

// Root app ─────────────────────────────────────────────────────────
const H18DeepApp = () => {
  const [tweaks, setTweaks] = React.useState(/*EDITMODE-BEGIN*/{
    "theme": "light",        // 'light' | 'dark' | 'system'
    "layout": "A",           // 'A' (預設) | 'B' (Inbox 為主) | 'C' (行事曆為主)
    "dense": false,
    "fontSize": "normal",    // 'small' | 'normal' | 'large'
    "toastStyle": "card",    // 'card' | 'typewriter'
  }/*EDITMODE-END*/);
  // 偵測系統主題 (for tweaks.theme === 'system')
  const [systemDark, setSystemDark] = React.useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else if (mq.removeListener) mq.removeListener(handler);
    };
  }, []);
  const [selected, setSelected] = React.useState({ course: 'ml', reminder: 'r01' });
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const [activeNav, setActiveNav] = React.useState('home');   // home | search | course:xxx | ai | add | profile
  const [overlayNav, setOverlayNav] = React.useState(null);   // search | add (overlays over home)
  const [aiDockOpen, setAiDockOpen] = React.useState(false);
  // 從 Profile → 關於與更新 → 「Setup Wizard 重置」可重新進入設置精靈。
  // Wizard 是全螢幕 takeover，繼承當前主題。
  const [setupWizardOpen, setSetupWizardOpen] = React.useState(false);

  const handleNav = (target) => {
    if (target === 'search' || target === 'add') {
      setOverlayNav(target);
    } else {
      setActiveNav(target);
      setOverlayNav(null);
    }
  };

  // Host edit-mode protocol
  React.useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Push edits to host so they persist
  const applyTweaks = (next) => {
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: next }, '*');
  };

  // 計算實際生效的 theme — 'system' 模式下跟系統，否則照 tweaks.theme
  const effectiveTheme = tweaks.theme === 'system'
    ? (systemDark ? 'dark' : 'light')
    : (tweaks.theme || 'light');

  // Keyboard
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        // ⌘\\ 永遠手動切 light/dark（如果在 system 就跳到實際反向）
        applyTweaks({ ...tweaks, theme: effectiveTheme === 'light' ? 'dark' : 'light' });
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOverlayNav('search');
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === '/')) {
        e.preventDefault();
        setAiDockOpen(v => !v);
      }
      if (e.key === 'Escape') {
        if (aiDockOpen) setAiDockOpen(false);
        else if (overlayNav) setOverlayNav(null);
        else if (tweaksOpen) setTweaksOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const T = H18_THEMES[effectiveTheme] || H18_THEMES.light;

  return (
    <>
      {/* Global scrollbar styles — thin + nearly invisible until hover */}
      <style>{`
        *::-webkit-scrollbar { width: 8px; height: 8px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb {
          background: ${T.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'};
          border-radius: 999px; border: 2px solid transparent; background-clip: padding-box;
          transition: background 160ms;
        }
        *:hover::-webkit-scrollbar-thumb {
          background: ${T.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'};
          background-clip: padding-box;
        }
        *::-webkit-scrollbar-thumb:hover {
          background: ${T.mode === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)'};
          background-clip: padding-box;
        }
        *::-webkit-scrollbar-corner { background: transparent; }
        * { scrollbar-width: thin; scrollbar-color: ${T.mode === 'dark' ? 'rgba(255,255,255,0.1) transparent' : 'rgba(0,0,0,0.1) transparent'}; }
        button { white-space: nowrap; flex-shrink: 0; }
      `}</style>
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: T.bg, fontFamily: '"Inter", "Noto Sans TC", sans-serif',
        color: T.text, overflow: 'hidden', position: 'relative',
      }}>
        {!activeNav.startsWith('recording:') && <V3Island/>}
        <H18TopBar theme={T} dense={tweaks.dense}
          onOpenSearch={() => setOverlayNav('search')}
          onWinClose={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'close' } }))}
          onWinMin={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'min' } }))}
          onWinMax={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'max' } }))}/>
        <H18Layout theme={T} selected={selected} onSelect={setSelected}
          dense={tweaks.dense} activeNav={activeNav} onNav={handleNav}
          onOpenSettings={() => setTweaksOpen(true)}
          onOpenSetupWizard={() => setSetupWizardOpen(true)}
          tweaks={tweaks} applyTweaks={applyTweaks}/>
        {overlayNav === 'search' && (
          <SearchOverlay theme={T} onClose={() => setOverlayNav(null)}
            onNav={(target) => { setOverlayNav(null); handleNav(target); }}
            onStartRecording={() => handleNav(`recording:${selected.course || 'ml'}`)}/>
        )}
        {overlayNav === 'add' && (
          <AddCourseDialog theme={T} onClose={() => setOverlayNav(null)}/>
        )}
        <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)}
          tweaks={tweaks} setTweaks={applyTweaks} theme={T}/>
        <AIDock theme={T} open={aiDockOpen} onClose={() => setAiDockOpen(false)}
          onExpand={() => { setAiDockOpen(false); handleNav('ai'); }}
          contextHint={activeNav.startsWith('course:') ? activeNav.slice(7) : null}/>
        {/* Setup Wizard 全螢幕 overlay — 從 Profile 重置入口進入 */}
        {setupWizardOpen && window.SetupWizardApp && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10000 }}>
            <SetupWizardApp
              initialTheme={tweaks.theme}
              onExit={() => setSetupWizardOpen(false)}/>
          </div>
        )}
        {/* Toast 通知系統 — 右下角，AI fab 之上 */}
        {window.H18ToastContainer && <H18ToastContainer theme={T} toastStyle={tweaks.toastStyle || 'card'}/>}
        {/* ConfirmDialog — 全螢幕模態 */}
        {window.H18ConfirmDialog && <H18ConfirmDialog theme={T}/>}
        {/* 6 個 conditional UI overlays（PAbout 開發者預覽觸發） */}
        {window.H18AlignmentBanner && <H18AlignmentBanner theme={T}/>}
        {window.H18VideoPiP && <H18VideoPiP theme={T}/>}
        {window.H18UnofficialChannelWarning && <H18UnofficialChannelWarning theme={T}/>}
        {window.H18OauthFlowModal && <H18OauthFlowModal theme={T}/>}
        {window.H18RecoveryPrompt && <H18RecoveryPrompt theme={T}/>}
        {window.H18ErrorFallback && <H18ErrorFallback theme={T}/>}
        {!aiDockOpen && activeNav !== 'ai' && (
          <button onClick={() => setAiDockOpen(true)}
            title="問 AI (⌘J)" style={{
              position: 'absolute', right: 20,
              bottom: activeNav.startsWith('recording:') ? 112 : 20,
              zIndex: 30,
              width: 44, height: 44, borderRadius: 22, cursor: 'pointer',
              background: T.invert, color: T.invertInk, border: 'none',
              fontSize: 18, fontWeight: 800, fontFamily: 'JetBrains Mono',
              boxShadow: T.mode === 'dark' ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 20px rgba(0,0,0,0.18)',
            }}>✦</button>
        )}
      </div>
    </>
  );
};

Object.assign(window, { H18Layout, TweaksPanel, H18DeepApp });
