// ClassNoteAI · Lecture Workbench (RecordingPage v2)
// 3 layouts: A (Classic split) / B (Focus subtitles) / C (Video lab)
// Core: drag-drop import · bilingual subs · material viewer · follow modes

// ─── Mock lecture content ────────────────────────────────────────
const RV2_SUBS = [
  { t: 0,   zh: '好，今天我們繼續講 attention 機制。',
            en: "Okay, today we'll continue on attention mechanism.",
            page: 1 },
  { t: 8,   zh: '上次講到 self-attention 的 query、key、value。',
            en: 'Last time we talked about query, key and value in self-attention.',
            page: 1 },
  { t: 18,  zh: '今天重點是 multi-head，為什麼要多顆頭？',
            en: 'Today\'s focus is multi-head — why multiple heads?',
            page: 2, topic: true },
  { t: 30,  zh: '因為一顆 head 只能關注一種 pattern。',
            en: 'Because one head can only focus on one pattern.',
            page: 2 },
  { t: 42,  zh: '多頭可以平行關注語法、語意、位置等不同資訊。',
            en: 'Multiple heads can attend in parallel to syntax, semantics, and position.',
            page: 3 },
  { t: 58,  zh: '這邊 scaling factor 是 √d_k，非常重要。',
            en: 'Here the scaling factor is √d_k — this is very important.',
            page: 4, keyword: 'scaling factor', exam: true },
  { t: 72,  zh: '每年期中考都會考 scaling factor 的推導。',
            en: 'The derivation of scaling factor is on the midterm every year.',
            page: 4, exam: true },
  { t: 88,  zh: '如果沒有 √d_k，softmax 會 saturate。',
            en: 'Without √d_k, softmax will saturate.',
            page: 5 },
  { t: 104, zh: '梯度就會非常小，訓練幾乎不動。',
            en: 'The gradient becomes tiny and training almost stalls.',
            page: 5 },
  { t: 122, zh: '現在我們看 multi-head 的公式。',
            en: "Now let's look at the multi-head formula.",
            page: 6, topic: true },
  { t: 136, zh: 'concat 之後再 linear projection。',
            en: 'Concat and then apply a linear projection.',
            page: 6 },
  { t: 150, zh: '作業三就是要你實作這一塊。',
            en: 'Homework 3 asks you to implement this part.',
            page: 7, keyword: 'HW3' },
];

const RV2_SLIDES = [
  { n: 1, title: '課程回顧', kind: 'cover' },
  { n: 2, title: 'Why Multi-Head?', kind: 'bullets',
    bullets: ['Single head → single pattern', 'Need to attend to different views', 'Syntax / semantics / position'] },
  { n: 3, title: 'Parallel Attention', kind: 'diagram' },
  { n: 4, title: 'Scaling Factor √d_k', kind: 'formula', formula: 'Attention(Q,K,V) = softmax(QKᵀ/√d_k)V', note: '每年必考' },
  { n: 5, title: 'Softmax Saturation', kind: 'chart' },
  { n: 6, title: 'Multi-Head Formula', kind: 'formula', formula: 'MultiHead(Q,K,V) = Concat(head₁, ..., head_h)Wᴼ' },
  { n: 7, title: 'HW3 · 實作指引', kind: 'bullets',
    bullets: ['8 heads, d_k = 64', '比較 single vs multi', '交期 週日 23:59'] },
  { n: 8, title: '下週預告', kind: 'cover' },
];

// ─── Drag-drop import dropzone ───────────────────────────────────
const RV2Dropzone = ({ theme: T, onDrop, visible }) => {
  if (!visible) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: T.mode === 'dark' ? 'rgba(10,10,10,0.92)' : 'rgba(250,248,242,0.94)',
      backdropFilter: 'blur(10px)',
      display: 'grid', placeItems: 'center',
      border: `3px dashed ${T.accent}`,
      pointerEvents: 'none',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 12, opacity: 0.7 }}>⤓</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text,
          letterSpacing: '-0.01em' }}>放開以匯入</div>
        <div style={{ fontSize: 13, color: T.textMid, marginTop: 8,
          fontFamily: 'JetBrains Mono' }}>
          .pdf · .pptx · .key · .mp4 · .mov · .m4a
        </div>
      </div>
    </div>
  );
};

// ─── Timer helpers ───────────────────────────────────────────────
const rv2Fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// ─── Shared subtitle stream ──────────────────────────────────────
const RV2SubtitleStream = ({ theme: T, subs, currentT, onSeek, ct, mode = 'full', listening = true, onJumpNote }) => {
  const activeIdx = subs.findIndex((s, i) => s.t <= currentT && (subs[i+1]?.t ?? Infinity) > currentT);
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current && activeIdx >= 0) {
      const active = scrollRef.current.querySelector(`[data-sub="${activeIdx}"]`);
      if (active) {
        const r = active.getBoundingClientRect();
        const cr = scrollRef.current.getBoundingClientRect();
        scrollRef.current.scrollTop += r.top - cr.top - cr.height / 2 + r.height / 2;
      }
    }
  }, [activeIdx]);

  return (
    <div ref={scrollRef} style={{
      flex: 1, overflow: 'auto', padding: mode === 'focus' ? '80px 80px 200px' : '20px 24px 100px',
      display: 'flex', flexDirection: 'column',
      gap: mode === 'focus' ? 22 : 14, scrollBehavior: 'smooth',
    }}>
      {subs.map((s, i) => {
        const isActive = i === activeIdx;
        const isPast = i < activeIdx;
        const fs = mode === 'focus' ? (isActive ? 28 : 20) : (isActive ? 16 : 14);
        return (
          <div key={i} data-sub={i} onClick={() => onSeek(s.t)} style={{
            cursor: 'pointer', padding: mode === 'focus' ? '6px 0' : '6px 10px',
            borderLeft: isActive ? `3px solid ${ct}` : '3px solid transparent',
            borderRadius: mode === 'focus' ? 0 : 4,
            opacity: isPast ? 0.4 : 1,
            transition: 'opacity 260ms, border-left-color 160ms',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono',
                color: T.textFaint, letterSpacing: '0.04em' }}>{rv2Fmt(s.t)}</span>
              {s.topic && <span style={{ fontSize: 9, padding: '1px 6px',
                background: ct, color: T.invertInk, borderRadius: 3,
                fontWeight: 800, fontFamily: 'JetBrains Mono',
                letterSpacing: '0.06em' }}>主題</span>}
              {s.exam && <span style={{ fontSize: 9, padding: '1px 6px',
                background: T.hot, color: '#fff', borderRadius: 3,
                fontWeight: 800, fontFamily: 'JetBrains Mono',
                letterSpacing: '0.06em' }}>考點</span>}
              {s.page && <span style={{ fontSize: 9, color: T.textDim,
                fontFamily: 'JetBrains Mono' }}>→ p.{s.page}</span>}
            </div>
            <div style={{ fontSize: fs, lineHeight: 1.45,
              fontWeight: isActive ? 600 : 400, color: T.text,
              letterSpacing: '-0.005em' }}>
              <RVBilink text={s.zh} theme={T} ct={ct} onJumpNote={onJumpNote}/>
            </div>
            <div style={{ fontSize: fs * 0.72, lineHeight: 1.5,
              color: T.textDim, marginTop: 4, fontStyle: 'italic',
              fontFamily: 'Inter' }}>
              <RVBilink text={s.en} theme={T} ct={ct} onJumpNote={onJumpNote}/>
            </div>
          </div>
        );
      })}
      {listening && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
          color: T.textDim }}>
          <span style={{ display: 'inline-flex', gap: 3 }}>
            {[0,1,2].map(i => (
              <span key={i} style={{ width: 4, height: 4, borderRadius: 2,
                background: T.textMid,
                animation: `rv2bounce 1s ${i * 0.15}s infinite` }}/>
            ))}
          </span>
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono',
            letterSpacing: '0.08em' }}>聆聽中…</span>
          <style>{`@keyframes rv2bounce { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }`}</style>
        </div>
      )}
    </div>
  );
};

// ─── Material viewer (PPT slide mock) ───────────────────────────
const RV2Slide = ({ slide, theme: T, ct, small }) => {
  const basePad = small ? 14 : 40;
  return (
    <div style={{
      background: T.mode === 'dark' ? '#141410' : '#fff',
      border: `1px solid ${T.border}`, borderRadius: 8,
      padding: basePad, height: '100%', overflow: 'auto',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, "Noto Sans TC", sans-serif',
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: 10, right: 14,
        fontSize: 10, color: T.textFaint, fontFamily: 'JetBrains Mono' }}>
        {slide.n} / {RV2_SLIDES.length}
      </div>
      <div style={{ fontSize: 10, letterSpacing: '0.18em', color: ct,
        fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
        ML · L14
      </div>
      <div style={{ fontSize: small ? 18 : 32, fontWeight: 800,
        letterSpacing: '-0.02em', marginTop: 6, color: T.text,
        lineHeight: 1.15 }}>{slide.title}</div>

      {slide.kind === 'bullets' && (
        <ul style={{ marginTop: small ? 10 : 24, paddingLeft: 20,
          fontSize: small ? 12 : 16, lineHeight: 1.7, color: T.textMid }}>
          {slide.bullets.map((b, i) => <li key={i} style={{ marginBottom: 6 }}>{b}</li>)}
        </ul>
      )}
      {slide.kind === 'formula' && (
        <div style={{ marginTop: small ? 10 : 30, padding: small ? '14px 10px' : '30px 20px',
          background: T.mode === 'dark' ? '#0d0d0a' : '#f6f2e8',
          borderRadius: 6, textAlign: 'center',
          fontFamily: 'JetBrains Mono', fontSize: small ? 12 : 22,
          color: T.text, letterSpacing: '-0.01em' }}>
          {slide.formula}
          {slide.note && (
            <div style={{ fontSize: small ? 9 : 12, color: T.hot, marginTop: small ? 6 : 14,
              letterSpacing: '0.18em', fontWeight: 800 }}>
              ★ {slide.note}
            </div>
          )}
        </div>
      )}
      {slide.kind === 'diagram' && (
        <div style={{ flex: 1, marginTop: small ? 10 : 24,
          display: 'grid', placeItems: 'center',
          background: T.mode === 'dark' ? '#0d0d0a' : '#f6f2e8',
          borderRadius: 6, padding: small ? 12 : 30 }}>
          <svg viewBox="0 0 300 140" style={{ width: '100%', maxWidth: small ? 180 : 300 }}>
            {[0,1,2,3,4,5,6,7].map(i => (
              <rect key={i} x={10 + i*35} y={50} width={26} height={40}
                fill={i % 2 ? ct : (T.mode === 'dark' ? '#2a2a24' : '#d9d4c2')}
                rx={3}/>
            ))}
            <text x="150" y="25" textAnchor="middle" fontSize="10"
              fill={T.mode === 'dark' ? '#ccc' : '#555'}
              fontFamily="JetBrains Mono">8 heads</text>
            <line x1="10" y1="110" x2="290" y2="110"
              stroke={T.mode === 'dark' ? '#555' : '#aaa'} strokeWidth="1"/>
            <text x="150" y="128" textAnchor="middle" fontSize="10"
              fill={T.mode === 'dark' ? '#ccc' : '#555'}
              fontFamily="JetBrains Mono">Concat → Linear</text>
          </svg>
        </div>
      )}
      {slide.kind === 'chart' && (
        <div style={{ flex: 1, marginTop: small ? 10 : 24,
          display: 'grid', placeItems: 'center',
          background: T.mode === 'dark' ? '#0d0d0a' : '#f6f2e8', borderRadius: 6 }}>
          <svg viewBox="0 0 200 100" style={{ width: '80%' }}>
            <path d={`M 10 90 ${Array.from({length:40}, (_,i) => {
              const x = 10 + i * 4.5; const y = 90 - 80 / (1 + Math.exp(-(i-20)*0.5));
              return `L ${x} ${y}`;
            }).join(' ')}`} fill="none" stroke={ct} strokeWidth="2"/>
            <text x="100" y="98" textAnchor="middle" fontSize="8"
              fill={T.mode === 'dark' ? '#888' : '#888'} fontFamily="JetBrains Mono">softmax saturates →</text>
          </svg>
        </div>
      )}
      {slide.kind === 'cover' && (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center',
          fontSize: small ? 10 : 14, color: T.textDim,
          fontFamily: 'JetBrains Mono' }}>· · ·</div>
      )}
    </div>
  );
};

// ─── Slide strip (thumbnails with follow indicator) ──────────────
const RV2SlideStrip = ({ slides, currentPage, ct, theme: T, followMode, onClick, orientation = 'vertical' }) => (
  <div style={{
    display: 'flex',
    flexDirection: orientation === 'vertical' ? 'column' : 'row',
    gap: 6, padding: 8, overflow: 'auto',
    height: orientation === 'vertical' ? '100%' : 'auto',
  }}>
    {slides.map(s => {
      const active = s.n === currentPage;
      return (
        <div key={s.n} onClick={() => onClick?.(s.n)} style={{
          flexShrink: 0, cursor: 'pointer',
          width: orientation === 'vertical' ? '100%' : 100,
          aspectRatio: '16 / 10',
          border: active ? `2px solid ${ct}` : `1px solid ${T.border}`,
          borderRadius: 4, padding: 5, position: 'relative',
          background: T.surface,
          fontFamily: 'Inter, "Noto Sans TC", sans-serif',
          boxShadow: active && followMode ? `0 0 0 3px ${T.mode === 'dark' ? 'rgba(215,165,80,0.25)' : 'rgba(215,140,70,0.18)'}` : 'none',
          transition: 'box-shadow 200ms',
        }}>
          <div style={{ fontSize: 7, color: T.textFaint,
            fontFamily: 'JetBrains Mono', position: 'absolute', top: 2, right: 4 }}>
            p.{s.n}
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.text,
            lineHeight: 1.2, marginTop: 6,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden' }}>{s.title}</div>
          {active && followMode && (
            <div style={{ position: 'absolute', bottom: -1, left: -1, right: -1,
              height: 2, background: ct }}/>
          )}
        </div>
      );
    })}
  </div>
);

// ─── Transport bar (shared across layouts) ───────────────────────
const RV2Transport = ({ theme: T, ct, state, setState, elapsed, onAddMark, onAskAI, onStop, followMode, setFollowMode }) => (
  <div style={{ padding: '12px 20px', borderTop: `1px solid ${T.border}`,
    display: 'flex', gap: 10, alignItems: 'center', background: T.surface2,
    flexShrink: 0 }}>
    {/* Record indicator + time */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: 5,
        background: state === 'live' ? '#ff3b30' : T.textDim,
        boxShadow: state === 'live' ? '0 0 0 4px rgba(255,59,48,0.2)' : 'none',
        animation: state === 'live' ? 'rv2rec 1.4s infinite' : 'none' }}/>
      <style>{`@keyframes rv2rec { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
      <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'JetBrains Mono',
        color: T.text, letterSpacing: '-0.02em' }}>{rv2Fmt(elapsed)}</span>
    </div>

    {/* Play / pause */}
    <button onClick={() => setState(state === 'live' ? 'paused' : 'live')}
      style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700, borderRadius: 6,
        background: state === 'live' ? T.invert : '#ff3b30',
        color: state === 'live' ? T.invertInk : '#fff',
        border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
      {state === 'live' ? '暫停' : '繼續錄'}
    </button>

    {/* Follow toggle (material/sub sync) */}
    <button onClick={() => setFollowMode(!followMode)} style={{
      padding: '8px 12px', fontSize: 11, fontWeight: 600,
      border: `1px solid ${followMode ? ct : T.border}`,
      color: followMode ? ct : T.textMid,
      background: followMode ? (T.mode === 'dark' ? 'rgba(215,165,80,0.12)' : '#fff6e2') : 'transparent',
      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3,
        background: followMode ? ct : T.textFaint }}/>
      跟隨模式
    </button>

    <button onClick={onAddMark} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600,
      background: 'transparent', color: T.text, border: `1px solid ${T.border}`,
      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>⚑ 標記考點</button>
    <button onClick={onAskAI} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600,
      background: 'transparent', color: T.text, border: `1px solid ${T.border}`,
      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>✦ 問 AI</button>

    <div style={{ flex: 1 }}/>

    <button onClick={onStop} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 700,
      background: '#e8412e', color: '#fff', border: 'none',
      borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
      結束 · 儲存
    </button>
  </div>
);

// ─── Layout A: Classic split (material left / subs right) ────────
const RV2LayoutA = ({ theme: T, ct, subs, currentT, onSeek, currentPage, followMode, onPageClick, onJumpNote }) => (
  <div style={{ flex: 1, display: 'grid',
    gridTemplateColumns: '86px 1fr 460px',
    overflow: 'hidden', background: T.border, gap: 1 }}>
    {/* Slide strip */}
    <div style={{ background: T.surface2, overflow: 'hidden' }}>
      <RV2SlideStrip slides={RV2_SLIDES} currentPage={currentPage} ct={ct}
        theme={T} followMode={followMode} onClick={onPageClick}/>
    </div>
    {/* Main slide viewer */}
    <div style={{ background: T.surface, padding: 20, overflow: 'hidden',
      display: 'flex', flexDirection: 'column' }}>
      <RV2Slide slide={RV2_SLIDES.find(s => s.n === currentPage) || RV2_SLIDES[0]}
        theme={T} ct={ct}/>
    </div>
    {/* Subtitles column (notes moved to floating window — ⌘⇧N) */}
    <div style={{ background: T.surface, display: 'flex', flexDirection: 'column',
      overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.18em', color: T.textDim,
          fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
          雙語字幕
        </span>
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 9, color: T.textFaint, fontFamily: 'JetBrains Mono' }}>
          筆記 ⌘⇧N
        </span>
      </div>
      <RV2SubtitleStream theme={T} subs={subs} currentT={currentT}
        onSeek={onSeek} ct={ct} mode="full" onJumpNote={onJumpNote}/>
    </div>
  </div>
);

// ─── Notes pane: markdown editor/preview with insert timestamp ──
const RV2NotesPane = ({ theme: T, ct, notes, setNotes, onJumpNote, currentT }) => {
  const [editing, setEditing] = React.useState(true);
  const insertTimestamp = () => setNotes(n => n + `\n\n[${rv2Fmt(currentT)}] `);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', display: 'flex',
        alignItems: 'center', gap: 6, borderBottom: `1px solid ${T.borderSoft}`, flexShrink: 0 }}>
        <span style={{ fontSize: 9, letterSpacing: '0.16em', color: T.textDim,
          fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
          {editing ? '編輯中' : '預覽'}
        </span>
        <div style={{ flex: 1 }}/>
        <button onClick={insertTimestamp} title="插入當前時間" style={{
          padding: '3px 8px', fontSize: 10, fontWeight: 600,
          border: `1px solid ${T.border}`, background: 'transparent',
          color: T.textMid, borderRadius: 4, cursor: 'pointer',
          fontFamily: 'JetBrains Mono' }}>+ {rv2Fmt(currentT)}</button>
        <button onClick={() => setEditing(e => !e)} style={{
          padding: '3px 8px', fontSize: 10, fontWeight: 600,
          border: `1px solid ${T.border}`, background: 'transparent',
          color: T.textMid, borderRadius: 4, cursor: 'pointer' }}>
          {editing ? '預覽' : '✎ 編輯'}
        </button>
      </div>
      {editing ? (
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="# 用 Markdown 記下重點…使用 # 標題、- 次要點、**粗體** …"
          style={{
            flex: 1, resize: 'none', padding: '14px 18px',
            fontSize: 13, lineHeight: 1.65,
            fontFamily: 'JetBrains Mono',
            background: T.mode === 'dark' ? '#0d0d0a' : '#fffdf6',
            color: T.text, border: 'none', outline: 'none',
          }}/>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
          <RVMarkdown src={notes} theme={T} ct={ct} onJumpNote={onJumpNote}/>
        </div>
      )}
    </div>
  );
};

// ─── Layout B: Focus subtitles (minimal, material as thumbs) ────
const RV2LayoutB = ({ theme: T, ct, subs, currentT, onSeek, currentPage, followMode, onPageClick, onJumpNote }) => (
  <div style={{ flex: 1, display: 'grid',
    gridTemplateColumns: '1fr 160px',
    overflow: 'hidden', background: T.border, gap: 1 }}>
    <div style={{ background: T.surface, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative' }}>
      <RV2SubtitleStream theme={T} subs={subs} currentT={currentT}
        onSeek={onSeek} ct={ct} mode="focus" onJumpNote={onJumpNote}/>
      {/* Subtle overlay fade top/bottom */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 60,
        background: `linear-gradient(${T.surface}, transparent)`, pointerEvents: 'none' }}/>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100,
        background: `linear-gradient(transparent, ${T.surface})`, pointerEvents: 'none' }}/>
    </div>
    <div style={{ background: T.surface2, display: 'flex', flexDirection: 'column',
      overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`,
        fontSize: 9, letterSpacing: '0.16em', color: T.textDim,
        fontWeight: 800, fontFamily: 'JetBrains Mono', flexShrink: 0 }}>
        教材 · 8
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RV2SlideStrip slides={RV2_SLIDES} currentPage={currentPage} ct={ct}
          theme={T} followMode={followMode} onClick={onPageClick}/>
      </div>
    </div>
  </div>
);

// ─── Layout C: Video lab (video + subtitle timeline) ────────────
const RV2LayoutC = ({ theme: T, ct, subs, currentT, onSeek, state, onJumpNote }) => {
  const TOTAL_T = subs[subs.length - 1].t + 30;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', background: T.bg }}>
      {/* Video area */}
      <div style={{ flex: 1, display: 'grid',
        gridTemplateColumns: '1fr 360px',
        gap: 1, background: T.border, overflow: 'hidden' }}>
        <div style={{ background: '#000', display: 'grid', placeItems: 'center',
          position: 'relative' }}>
          <div style={{ position: 'absolute', top: 12, left: 16,
            padding: '4px 10px', background: 'rgba(0,0,0,0.6)',
            color: '#fff', borderRadius: 4, fontSize: 10,
            fontFamily: 'JetBrains Mono', letterSpacing: '0.08em' }}>
            {state === 'live' ? '● REC · LIVE' : 'PAUSED'} · {rv2Fmt(currentT)}
          </div>
          {/* Mock video content */}
          <div style={{ color: '#fff', textAlign: 'center',
            fontFamily: 'JetBrains Mono' }}>
            <div style={{ fontSize: 48, opacity: 0.4 }}>▶</div>
            <div style={{ fontSize: 11, opacity: 0.4, marginTop: 8,
              letterSpacing: '0.14em' }}>1920 × 1080 · 30fps</div>
          </div>
          {/* Active subtitle overlay on video */}
          {(() => {
            const idx = subs.findIndex((s, i) => s.t <= currentT && (subs[i+1]?.t ?? Infinity) > currentT);
            if (idx < 0) return null;
            const s = subs[idx];
            return (
              <div style={{ position: 'absolute', bottom: 20, left: '8%', right: '8%',
                padding: '10px 18px', background: 'rgba(0,0,0,0.72)',
                borderRadius: 6, color: '#fff', textAlign: 'center',
                fontSize: 15, lineHeight: 1.4, fontWeight: 500 }}>
                {s.zh}
                <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4,
                  fontStyle: 'italic' }}>{s.en}</div>
              </div>
            );
          })()}
        </div>
        {/* Subs side panel */}
        <div style={{ background: T.surface, display: 'flex', flexDirection: 'column',
          overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}`,
            fontSize: 10, letterSpacing: '0.16em', color: T.textDim,
            fontWeight: 800, fontFamily: 'JetBrains Mono', flexShrink: 0 }}>
            字幕 · 點選跳轉
          </div>
          <RV2SubtitleStream theme={T} subs={subs} currentT={currentT}
            onSeek={onSeek} ct={ct} mode="full" listening={false} onJumpNote={onJumpNote}/>
        </div>
      </div>
      {/* Timeline scrubber */}
      <div style={{ padding: '10px 20px', background: T.surface2,
        borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.14em', color: T.textDim,
          fontFamily: 'JetBrains Mono', fontWeight: 700, marginBottom: 6 }}>
          時間軸 · {rv2Fmt(currentT)} / {rv2Fmt(TOTAL_T)}
        </div>
        <div style={{ position: 'relative', height: 32, background: T.border,
          borderRadius: 4, overflow: 'hidden', cursor: 'pointer' }}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(Math.round((e.clientX - r.left) / r.width * TOTAL_T));
          }}>
          {/* Progress */}
          <div style={{ position: 'absolute', inset: 0, width: `${currentT / TOTAL_T * 100}%`,
            background: T.mode === 'dark' ? 'rgba(215,165,80,0.18)' : '#f2e6cc' }}/>
          {/* Sub markers */}
          {subs.map((s, i) => (
            <div key={i} style={{ position: 'absolute', top: 4, bottom: 4,
              left: `${s.t / TOTAL_T * 100}%`, width: 2,
              background: s.exam ? T.hot : s.topic ? ct : T.textFaint,
              opacity: 0.7 }}/>
          ))}
          {/* Playhead */}
          <div style={{ position: 'absolute', top: 0, bottom: 0,
            left: `${currentT / TOTAL_T * 100}%`, width: 2,
            background: ct, boxShadow: `0 0 0 4px ${T.mode === 'dark' ? 'rgba(215,165,80,0.25)' : 'rgba(215,140,70,0.18)'}` }}/>
        </div>
      </div>
    </div>
  );
};

// ─── Main RecordingPage (wraps everything) ──────────────────────
const RecordingPage = ({ theme: T, courseId = 'ml', onBack, onFinish }) => {
  const c = v3GetCourse(courseId);
  const ct = h18CourseText(c, T);
  const [state, setState] = React.useState('live');
  const [elapsed, setElapsed] = React.useState(58);
  const [layout, setLayout] = React.useState('A');
  const [followMode, setFollowMode] = React.useState(true);
  const [dragOver, setDragOver] = React.useState(false);
  const [hasMaterial, setHasMaterial] = React.useState(true);
  const [importOpen, setImportOpen] = React.useState(false);
  const [notes, setNotes] = React.useState(`# ${c.nextLec.title} · ${c.short} L${c.nextLec.n} · 現場筆記

## 今天重點

- 
`);

  // Tick
  React.useEffect(() => {
    if (state !== 'live') return;
    const id = setInterval(() => setElapsed(e => Math.min(e + 1, RV2_SUBS[RV2_SUBS.length-1].t + 20)), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Floating notes panel (⌘⇧N to toggle)
  const [notesOpen, setNotesOpen] = React.useState(false);
  // Finishing overlay — processing animation before jumping to Review
  const [finishing, setFinishing] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        e.preventDefault();
        setNotesOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Derived current page (from follow mode) — otherwise manually controlled
  const activeSubIdx = RV2_SUBS.findIndex((s, i) =>
    s.t <= elapsed && (RV2_SUBS[i+1]?.t ?? Infinity) > elapsed);
  const autoPage = RV2_SUBS[Math.max(0, activeSubIdx)]?.page || 1;
  const [manualPage, setManualPage] = React.useState(null);
  const currentPage = followMode ? autoPage : (manualPage ?? autoPage);

  // Drag-drop handlers on root
  const rootRef = React.useRef(null);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let dragCount = 0;
    const onDragEnter = (e) => { e.preventDefault(); dragCount++; setDragOver(true); };
    const onDragLeave = (e) => { dragCount--; if (dragCount === 0) setDragOver(false); };
    const onDragOver = (e) => { e.preventDefault(); };
    const onDrop = (e) => { e.preventDefault(); dragCount = 0; setDragOver(false); setHasMaterial(true); };
    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragenter', onDragEnter);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  const onSeek = (t) => { setElapsed(t); setState('paused'); };
  const onPageClick = (n) => { setFollowMode(false); setManualPage(n); };
  const onJumpNote = (concept) => {
    // For demo: flash a toast-ish effect by cycling layout or console log
    // In real app, would navigate to the related lecture's review page
    console.log('[bilink] jump to', concept);
  };

  return (
    <div ref={rootRef} style={{ flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative' }}>

      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        background: T.surface, flexShrink: 0 }}>
        <H18Breadcrumb theme={T} course={c} lectureN={c.nextLec.n}
          lectureTitle={c.nextLec.title} kind="recording"
          onBack={onBack} liveTag={state === 'live' ? 'LIVE' : null}/>

        {/* Layout switcher */}
        <div style={{ display: 'flex', gap: 0, border: `1px solid ${T.border}`,
          borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {[
            { k: 'A', label: '雙欄' },
            { k: 'B', label: '字幕專注' },
            { k: 'C', label: '影片' },
          ].map(o => (
            <button key={o.k} onClick={() => setLayout(o.k)} style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600,
              background: layout === o.k ? T.invert : 'transparent',
              color: layout === o.k ? T.invertInk : T.textMid,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>{o.label}</button>
          ))}
        </div>

        {/* Notes toggle (floating window) */}
        <button onClick={() => setNotesOpen(o => !o)} title="開啟 / 關閉筆記浮動視窗 (⌘⇧N)" style={{
          padding: '6px 12px', fontSize: 11, fontWeight: 600,
          background: notesOpen ? T.invert : 'transparent',
          color: notesOpen ? T.invertInk : T.textMid,
          border: `1px solid ${T.border}`, borderRadius: 6,
          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>✎</span> 筆記
          <span style={{ fontSize: 9, opacity: 0.7, fontFamily: 'JetBrains Mono',
            marginLeft: 2 }}>⌘⇧N</span>
        </button>

        {/* Import button */}
        <button onClick={() => setImportOpen(true)} style={{
          padding: '6px 12px', fontSize: 11, fontWeight: 600,
          background: 'transparent', color: T.textMid,
          border: `1px dashed ${T.border}`, borderRadius: 6,
          cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          ⤓ 匯入教材
        </button>
      </div>

      {/* Body */}
      {layout === 'A' && <RV2LayoutA theme={T} ct={ct} subs={RV2_SUBS}
        currentT={elapsed} onSeek={onSeek} currentPage={currentPage}
        followMode={followMode} onPageClick={onPageClick}
        onJumpNote={onJumpNote}/>}
      {layout === 'B' && <RV2LayoutB theme={T} ct={ct} subs={RV2_SUBS}
        currentT={elapsed} onSeek={onSeek} currentPage={currentPage}
        followMode={followMode} onPageClick={onPageClick}
        onJumpNote={onJumpNote}/>}
      {layout === 'C' && <RV2LayoutC theme={T} ct={ct} subs={RV2_SUBS}
        currentT={elapsed} onSeek={onSeek} state={state}
        onJumpNote={onJumpNote}/>}

      <RV2Transport theme={T} ct={ct} state={state} setState={setState}
        elapsed={elapsed} followMode={followMode} setFollowMode={setFollowMode}
        onStop={() => setFinishing(true)}/>

      <RV2Dropzone theme={T} visible={dragOver}/>
      <ImportDialog theme={T} open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={() => setImportOpen(false)}/>

      {/* Floating notes window — uses the same Notes Editor surface */}
      <RV2FloatingNotes theme={T} ct={ct} open={notesOpen}
        onClose={() => setNotesOpen(false)}
        courseShort={c.short} lectureN={c.nextLec.n}
        currentT={elapsed}/>

      {/* Finishing overlay — processing → auto-jump to Review */}
      <RV2FinishingOverlay theme={T} ct={ct} open={finishing}
        course={c} elapsed={elapsed}
        onDone={() => { setFinishing(false); onFinish && onFinish(); }}/>
    </div>
  );
};

Object.assign(window, { RecordingPage });

// ─── Floating notes window — draggable, embeds Notes Editor UI ──────
const RV2FloatingNotes = ({ theme: T, ct, open, onClose, courseShort, lectureN, currentT }) => {
  const [pos, setPos] = React.useState({ x: null, y: null });  // null = initial
  const [size, setSize] = React.useState({ w: 780, h: 560 });
  const [maxed, setMaxed] = React.useState(false);
  const dragRef = React.useRef(null);

  // Mount animation — delay un-mount for fade
  const [mounted, setMounted] = React.useState(open);
  React.useEffect(() => {
    if (open) setMounted(true);
    else { const t = setTimeout(() => setMounted(false), 180); return () => clearTimeout(t); }
  }, [open]);
  if (!mounted) return null;

  // Initial position — bottom-right
  const W = maxed ? window.innerWidth - 40 : size.w;
  const H = maxed ? window.innerHeight - 100 : size.h;
  const x = maxed ? 20 : (pos.x ?? (window.innerWidth - W - 28));
  const y = maxed ? 70 : (pos.y ?? (window.innerHeight - H - 120));

  // Drag
  const onHeaderDown = (e) => {
    if (maxed) return;
    const startX = e.clientX, startY = e.clientY;
    const startPos = { x, y };
    const onMove = (me) => {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - W, startPos.x + (me.clientX - startX))),
        y: Math.max(0, Math.min(window.innerHeight - H, startPos.y + (me.clientY - startY))),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return ReactDOM.createPortal(
    <>
      <style>{`
        @keyframes rv2noteIn { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes rv2noteOut { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(12px) scale(0.98); } }
      `}</style>
      <div ref={dragRef} style={{
        position: 'fixed', left: x, top: y, width: W, height: H,
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
        boxShadow: T.mode === 'dark'
          ? '0 20px 60px rgba(0,0,0,0.6), 0 2px 10px rgba(0,0,0,0.4)'
          : '0 20px 60px rgba(0,0,0,0.22), 0 2px 10px rgba(0,0,0,0.08)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        zIndex: 9000,
        animation: open ? 'rv2noteIn 200ms cubic-bezier(0.2, 0, 0, 1) forwards' : 'rv2noteOut 180ms ease-in forwards',
        fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      }}>
        {/* Window chrome */}
        <div onMouseDown={onHeaderDown} onDoubleClick={() => setMaxed(m => !m)}
          style={{
            padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
            borderBottom: `1px solid ${T.borderSoft}`,
            background: T.surface2, cursor: maxed ? 'default' : 'move',
            flexShrink: 0, userSelect: 'none',
          }}>
          {/* traffic lights style close only */}
          <button onClick={onClose} title="關閉 (⌘⇧N)" style={{
            width: 12, height: 12, borderRadius: '50%',
            background: '#e8412e', border: 'none', cursor: 'pointer', padding: 0,
          }}/>
          <button onClick={() => setMaxed(m => !m)} title={maxed ? '縮回' : '最大化'} style={{
            width: 12, height: 12, borderRadius: '50%',
            background: '#f6b24e', border: 'none', cursor: 'pointer', padding: 0,
          }}/>
          <div style={{ width: 12 }}/>

          <span style={{ fontSize: 10, letterSpacing: '0.18em', color: T.textDim,
            fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
            筆記 · {courseShort} · L{lectureN}
          </span>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 10, color: T.textFaint, fontFamily: 'JetBrains Mono' }}>
            拖曳移動 · 雙擊最大化
          </span>
        </div>

        {/* Notes Editor embedded — fills the window */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {window.NotesEditorPage
            ? <NotesEditorPage theme={T} embedded={true} contextLabel={`${courseShort} · L${lectureN}`} currentT={currentT}/>
            : <div style={{ padding: 24, color: T.textDim, fontSize: 13 }}>
                載入筆記編輯器中…
              </div>}
        </div>
      </div>
    </>,
    document.body
  );
};

Object.assign(window, { RV2FloatingNotes });

// ─── Finishing overlay — processing steps → auto-jump to Review ──────
const RV2_FINISH_STEPS = [
  { key: 'save',    label: '儲存錄音檔',        detail: '52 分鐘 · 48.2 MB',     dur: 500 },
  { key: 'trans',   label: '整理完整逐字稿',      detail: '中英雙語對齊 · 182 段',   dur: 900 },
  { key: 'summary', label: 'AI 摘要與重點擷取',   detail: '3 個核心概念 · 6 個問題',  dur: 900 },
  { key: 'link',    label: '連結跨課程概念',      detail: 'L11–L13 相關片段 · 8 處', dur: 700 },
  { key: 'ready',   label: 'Review 準備好了',     detail: '正在帶你過去…',           dur: 600 },
];

const RV2FinishingOverlay = ({ theme: T, ct, open, course, elapsed, onDone }) => {
  const [stepIdx, setStepIdx] = React.useState(0);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (!open) { setStepIdx(0); setProgress(0); return; }
    let cancelled = false;
    let cumulative = 0;
    const totalDur = RV2_FINISH_STEPS.reduce((a, s) => a + s.dur, 0);

    const runStep = async (i) => {
      if (cancelled) return;
      setStepIdx(i);
      const stepStart = cumulative;
      const stepEnd = cumulative + RV2_FINISH_STEPS[i].dur;
      const ticks = 12;
      for (let k = 0; k <= ticks; k++) {
        if (cancelled) return;
        await new Promise(r => setTimeout(r, RV2_FINISH_STEPS[i].dur / ticks));
        const p = (stepStart + (stepEnd - stepStart) * (k / ticks)) / totalDur;
        setProgress(p);
      }
      cumulative = stepEnd;
      if (i < RV2_FINISH_STEPS.length - 1) runStep(i + 1);
      else { await new Promise(r => setTimeout(r, 300)); if (!cancelled) onDone && onDone(); }
    };
    runStep(0);
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;

  return ReactDOM.createPortal(
    <>
      <style>{`
        @keyframes rv2fOverlayIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes rv2fCardIn { from { opacity: 0; transform: translateY(18px) scale(0.97); }
                                to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes rv2fSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes rv2fStepIn { from { opacity: 0; transform: translateX(-6px); }
                                to { opacity: 1; transform: translateX(0); } }
        @keyframes rv2fPulse { 0%, 100% { opacity: 0.35 } 50% { opacity: 1 } }
        @keyframes rv2fBarShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: T.mode === 'dark'
          ? 'rgba(8, 8, 6, 0.88)'
          : 'rgba(20, 18, 14, 0.78)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'rv2fOverlayIn 280ms ease-out forwards',
        fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      }}>
        {/* Subtle grid backdrop */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `linear-gradient(${T.mode === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.08)'} 1px, transparent 1px),
                             linear-gradient(90deg, ${T.mode === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.08)'} 1px, transparent 1px)`,
          backgroundSize: '44px 44px',
        }}/>

        <div style={{
          width: 520, maxWidth: '92vw',
          background: T.surface, borderRadius: 14,
          border: `1px solid ${T.border}`,
          boxShadow: T.mode === 'dark'
            ? '0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)'
            : '0 30px 80px rgba(0,0,0,0.28)',
          overflow: 'hidden',
          animation: 'rv2fCardIn 360ms cubic-bezier(0.2, 0, 0, 1) 80ms both',
        }}>
          {/* Header */}
          <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${T.borderSoft}`,
            display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Spinner */}
            <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: `2px solid ${T.border}`,
              }}/>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: `2px solid transparent`,
                borderTopColor: ct, borderRightColor: ct,
                animation: 'rv2fSpin 900ms linear infinite',
              }}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.2em', color: T.textDim,
                fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
                錄音結束 · 正在處理
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text,
                marginTop: 3, letterSpacing: '-0.01em',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {course.title} · L{course.nextLec.n} · {course.nextLec.title}
              </div>
            </div>
            <div style={{ fontSize: 11, color: T.textFaint, fontFamily: 'JetBrains Mono',
              padding: '3px 8px', background: T.surface2, borderRadius: 4,
              border: `1px solid ${T.border}`, flexShrink: 0 }}>
              {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, background: T.border, position: 'relative' }}>
            <div style={{
              position: 'absolute', inset: 0, right: `${100 - progress * 100}%`,
              background: `linear-gradient(90deg, ${ct}, ${ct}dd)`,
              transition: 'right 120ms linear',
            }}/>
            <div style={{
              position: 'absolute', inset: 0,
              background: `linear-gradient(90deg, transparent, ${ct}44, transparent)`,
              backgroundSize: '200% 100%',
              animation: 'rv2fBarShimmer 1.6s linear infinite',
              opacity: 0.6,
            }}/>
          </div>

          {/* Steps */}
          <div style={{ padding: '14px 22px 20px' }}>
            {RV2_FINISH_STEPS.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              const pending = i > stepIdx;
              return (
                <div key={s.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0',
                  borderBottom: i < RV2_FINISH_STEPS.length - 1 ? `1px solid ${T.borderSoft}` : 'none',
                  opacity: pending ? 0.4 : 1,
                  transition: 'opacity 200ms',
                  animation: active ? 'rv2fStepIn 260ms ease-out' : 'none',
                }}>
                  {/* Status icon */}
                  <div style={{ width: 20, height: 20, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {done && (
                      <svg width="20" height="20" viewBox="0 0 20 20">
                        <circle cx="10" cy="10" r="9" fill={ct}/>
                        <path d="M6 10.5 L9 13.5 L14.5 7.5" stroke="#fff" strokeWidth="2"
                          fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {active && (
                      <div style={{
                        width: 14, height: 14, borderRadius: '50%',
                        border: `2px solid ${ct}`, borderTopColor: 'transparent',
                        animation: 'rv2fSpin 700ms linear infinite',
                      }}/>
                    )}
                    {pending && (
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: T.border,
                      }}/>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: active ? 700 : 600,
                      color: pending ? T.textDim : T.text,
                      letterSpacing: '-0.005em' }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 11, color: T.textDim, marginTop: 2,
                      fontFamily: s.key === 'save' || s.key === 'trans' ? 'JetBrains Mono' : 'inherit',
                      animation: active ? 'rv2fPulse 1.4s ease-in-out infinite' : 'none' }}>
                      {s.detail}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer hint */}
          <div style={{ padding: '10px 22px', background: T.surface2,
            borderTop: `1px solid ${T.borderSoft}`,
            fontSize: 10, color: T.textFaint, fontFamily: 'JetBrains Mono',
            letterSpacing: '0.08em', textAlign: 'center' }}>
            稍後會自動帶你到 Review 頁面
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

Object.assign(window, { RV2FinishingOverlay });
