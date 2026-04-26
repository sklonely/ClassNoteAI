// H18 · Notes Editor page — doc / canvas / split
// Adapts its own T from the app theme, adding a few accent channels
// (blue/green/violet/amber) that the editor diagrams rely on.

const neAccents = (T) => T.mode === 'dark'
  ? { blue: '#7aa8ff', green: '#8bd49a', violet: '#b898ff', amber: '#ffcd77',
      stickyBg: '#f5dc80', stickyEdge: '#d4ba5e', stickyInk: '#3a3420' }
  : { blue: '#3967d4', green: '#2f8a5a', violet: '#7749c8', amber: '#b07a10',
      stickyBg: '#fff0a8', stickyEdge: '#d4b84e', stickyInk: '#463a0e' };

// ── Math renderer ────────────────────────────────────────────────
const neRenderMath = (src) => {
  if (typeof src !== 'string') return src;
  const nodes = []; let i = 0, key = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const cmd = src.slice(i + 1, j);
      const map = { cdot: '·', times: '×', div: '÷', sum: '∑', int: '∫',
        sqrt: '√', alpha: 'α', beta: 'β', theta: 'θ', lambda: 'λ',
        sigma: 'σ', pi: 'π', infty: '∞', partial: '∂', nabla: '∇',
        leq: '≤', geq: '≥', neq: '≠', approx: '≈', rightarrow: '→',
        top: '⊤', mathrm: '', text: '' };
      nodes.push(<span key={key++}>{map[cmd] ?? ''}</span>);
      i = j;
    } else if (ch === '^' || ch === '_') {
      const sup = ch === '^';
      let tok; let j = i + 1;
      if (src[j] === '{') { const end = src.indexOf('}', j);
        tok = src.slice(j + 1, end); i = end + 1;
      } else { tok = src[j]; i = j + 1; }
      nodes.push(sup
        ? <sup key={key++} style={{ fontSize: '0.75em' }}>{neRenderMath(tok)}</sup>
        : <sub key={key++} style={{ fontSize: '0.75em' }}>{neRenderMath(tok)}</sub>);
    } else { nodes.push(<span key={key++}>{ch}</span>); i++; }
  }
  return nodes;
};

const NEInlineMath = ({ theme: T, children }) => (
  <span style={{ fontFamily: "'Cambria Math','STIX Two Math',Georgia,serif",
    fontStyle: 'italic', fontSize: '1.02em', padding: '0 3px', color: T.text }}>
    {neRenderMath(children)}
  </span>
);

// ── SyncPill ─────────────────────────────────────────────────────
const NESyncPill = ({ state, theme: T, acc }) => {
  const cfg = {
    synced:  { label: 'iPad 已同步', color: acc.green,     dot: true,  anim: false },
    syncing: { label: 'iPad 同步中', color: acc.blue,      dot: true,  anim: true  },
    offline: { label: 'iPad 離線',   color: T.textFaint,   dot: false, anim: false },
    drawing: { label: 'iPad 繪製中', color: acc.violet,    dot: true,  anim: true  },
  }[state] || { label: '離線', color: T.textFaint };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      background: T.surface2, border: `1px solid ${T.border}`,
      fontSize: 11, color: cfg.color, fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
      {cfg.dot && <span style={{ width: 7, height: 7, borderRadius: 4,
        background: cfg.color,
        animation: cfg.anim ? 'pulse 1.4s infinite' : 'none' }}/>}
      {cfg.label}
    </div>
  );
};

// ── Top bar (inside page; no "back to home", uses in-app rail) ───
const NETopBar = ({ theme: T, mode, setMode, syncState, acc, onBack, embedded }) => (
  // gap: 16 — 因為左側用 flex:1 吃掉所有 space-between 的剩餘空間，中段
  // (mode 切換) 與右段 (sync pill / 匯出 / 分享) 之間沒有 gap 會貼在一起。
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 16,
    padding: embedded ? '8px 14px' : '10px 18px', borderBottom: `1px solid ${T.border}`,
    height: embedded ? 42 : 48, background: T.topbar, flexShrink: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
      {window.H18Breadcrumb && window.v3GetCourse ? (
        <H18Breadcrumb theme={T} course={window.v3GetCourse('ml')}
          lectureN={13} lectureTitle="Attention 機制 · Q/K/V"
          kind="notes"
          onBack={!embedded ? onBack : undefined}
          extraPills={<span style={{ fontSize: 10, color: T.textFaint,
            fontFamily: 'JetBrains Mono', flexShrink: 0 }}>04/20 · 14:10–15:02</span>}/>
      ) : (
        <>
          {!embedded && <>
            <button onClick={onBack} style={{
              padding: '4px 10px', fontSize: 11, background: 'transparent',
              color: T.textMid, border: `1px solid ${T.border}`, borderRadius: 5,
              cursor: 'pointer', fontFamily: 'inherit' }}>← 返回</button>
            <div style={{ width: 1, height: 16, background: T.border }}/>
          </>}
          <span style={{ fontSize: 11, color: T.textDim, fontFamily: 'JetBrains Mono' }}>
            機器學習 · L13
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text,
            letterSpacing: '-0.01em' }}>Attention 機制 · Q/K/V</span>
          <span style={{ fontSize: 10, color: T.textFaint,
            fontFamily: 'JetBrains Mono' }}>04/20 · 14:10–15:02</span>
        </>
      )}
    </div>

    <div style={{ display: 'flex', alignItems: 'center',
      gap: 4, padding: 3, borderRadius: 8, background: T.surface2,
      border: `1px solid ${T.border}` }}>
      {[
        { id: 'doc',    label: '文檔', glyph: '¶' },
        { id: 'canvas', label: '畫板', glyph: '✎' },
        { id: 'split',  label: '分割', glyph: '‖' },
      ].map(m => (
        <button key={m.id} onClick={() => setMode(m.id)} style={{
          padding: '5px 12px', fontSize: 12, fontWeight: 600,
          background: mode === m.id ? T.invert : 'transparent',
          color: mode === m.id ? T.invertInk : T.textMid,
          border: 'none', borderRadius: 5, cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{m.glyph}</span>
          {m.label}
        </button>
      ))}
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <NESyncPill state={syncState} theme={T} acc={acc}/>
      <button style={{ padding: '5px 11px', fontSize: 11, fontWeight: 600,
        background: T.chipBg, color: T.textMid,
        border: `1px solid ${T.border}`, borderRadius: 6,
        cursor: 'pointer', fontFamily: 'inherit' }}>匯出 ↓</button>
      <button style={{ padding: '5px 11px', fontSize: 11, fontWeight: 600,
        background: T.accent, color: T.invertInk,
        border: 'none', borderRadius: 6,
        cursor: 'pointer', fontFamily: 'inherit' }}>分享</button>
    </div>
  </div>
);

// ── Page sidebar ─────────────────────────────────────────────────
const NE_PAGES = [
  { id: 'p1', n: 1, title: 'Scaled dot-product attention', ink: true,  text: true,  updated: '14:12' },
  { id: 'p2', n: 2, title: 'Self vs Cross-attention',      ink: false, text: true,  updated: '14:28' },
  { id: 'p3', n: 3, title: 'Multi-head 的動機',             ink: true,  text: true,  updated: '14:41' },
  { id: 'p4', n: 4, title: 'Positional encoding',          ink: false, text: true,  updated: '14:55' },
  { id: 'p5', n: 5, title: 'iPad 匯入 · Softmax 推導',      ink: true,  text: false, updated: '15:01' },
];

const NESidebar = ({ theme: T, acc, activePage, setActivePage }) => (
  <div style={{ width: 240, background: T.rail, borderRight: `1px solid ${T.border}`,
    display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div style={{ padding: '14px 14px 10px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.16em',
        color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
        頁面 · {NE_PAGES.length}
      </div>
      <button style={{ fontSize: 12, color: T.textMid,
        background: 'transparent', border: `1px solid ${T.border}`,
        borderRadius: 5, padding: '2px 8px', cursor: 'pointer',
        fontFamily: 'inherit' }}>+ 新頁</button>
    </div>
    <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
      {NE_PAGES.map(p => (
        <div key={p.id} onClick={() => setActivePage(p.id)}
          style={{ padding: '9px 10px', marginBottom: 2, borderRadius: 7,
            cursor: 'pointer',
            background: activePage === p.id ? T.selBg : 'transparent',
            borderLeft: `3px solid ${activePage === p.id ? T.selBorder : 'transparent'}`,
            paddingLeft: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: T.textFaint,
              fontFamily: 'JetBrains Mono', minWidth: 16 }}>
              {String(p.n).padStart(2, '0')}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.text,
              flex: 1, lineHeight: 1.35 }}>{p.title}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            marginTop: 4, paddingLeft: 24 }}>
            {p.text && <span style={{ fontSize: 9, padding: '1px 5px',
              background: T.chipBg, color: T.textMid, borderRadius: 3,
              fontWeight: 700, letterSpacing: '0.05em' }}>TEXT</span>}
            {p.ink && <span style={{ fontSize: 9, padding: '1px 5px',
              background: T.mode === 'dark' ? 'rgba(184,152,255,0.15)' : 'rgba(119,73,200,0.12)',
              color: acc.violet, borderRadius: 3,
              fontWeight: 700, letterSpacing: '0.05em' }}>INK</span>}
            <span style={{ marginLeft: 'auto', fontSize: 9,
              color: T.textFaint, fontFamily: 'JetBrains Mono' }}>{p.updated}</span>
          </div>
        </div>
      ))}
    </div>
    <div style={{ borderTop: `1px solid ${T.border}`, padding: '12px 14px',
      background: T.surface }}>
      <div style={{ fontSize: 10, letterSpacing: '0.14em',
        color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono',
        marginBottom: 8 }}>同步裝置</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6,
          background: T.surface2, border: `1px solid ${T.border}`,
          display: 'grid', placeItems: 'center', fontSize: 13,
          color: T.textMid }}>⊞</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.text,
            whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' }}>Hank 的 iPad Pro</div>
          <div style={{ fontSize: 9, color: acc.green,
            fontFamily: 'JetBrains Mono' }}>● 連線中 · Apple Pencil</div>
        </div>
      </div>
    </div>
  </div>
);

// ── Mini buttons ─────────────────────────────────────────────────
const neMiniBtn = (T) => ({
  padding: '4px 8px', fontSize: 10, color: T.textMid,
  background: 'transparent', border: `1px solid ${T.border}`,
  borderRadius: 4, cursor: 'pointer', fontFamily: 'JetBrains Mono',
  letterSpacing: '0.04em', whiteSpace: 'nowrap',
});

// ── Equation block ───────────────────────────────────────────────
const NEEquation = ({ theme: T }) => {
  const mb = neMiniBtn(T);
  return (
    <div style={{ margin: '20px 0', padding: '18px 24px', borderRadius: 10,
      background: T.surface2, border: `1px solid ${T.borderSoft}`,
      display: 'flex', alignItems: 'center', gap: 16 }}>
      <span style={{ fontSize: 10, letterSpacing: '0.14em',
        color: T.textDim, fontWeight: 700, fontFamily: 'JetBrains Mono',
        writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>(3.2)</span>
      <div style={{ flex: 1, textAlign: 'center', fontSize: 22,
        color: T.text, padding: '6px 0',
        fontFamily: "'Cambria Math','STIX Two Math',Georgia,serif",
        fontStyle: 'italic' }}>
        MultiHead(Q, K, V) = Concat(head<sub style={{ fontSize: '0.7em' }}>1</sub>,
        &nbsp;…,&nbsp; head<sub style={{ fontSize: '0.7em' }}>h</sub>) W<sup style={{ fontSize: '0.7em' }}>O</sup>
        <div style={{ fontSize: 16, color: T.textMid, marginTop: 10 }}>
          head<sub style={{ fontSize: '0.7em' }}>i</sub> = Attention(Q W<sub style={{ fontSize: '0.7em' }}>i</sub><sup style={{ fontSize: '0.7em' }}>Q</sup>,
          &nbsp;K W<sub style={{ fontSize: '0.7em' }}>i</sub><sup style={{ fontSize: '0.7em' }}>K</sup>,
          &nbsp;V W<sub style={{ fontSize: '0.7em' }}>i</sub><sup style={{ fontSize: '0.7em' }}>V</sup>)
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button style={mb}>✎ 編輯 LaTeX</button>
        <button style={mb}>↗ 抽出</button>
      </div>
    </div>
  );
};

// ── Handwriting import block ─────────────────────────────────────
const NEHandwriting = ({ theme: T, acc }) => {
  const mb = neMiniBtn(T);
  return (
    <div style={{ margin: '20px 0', padding: 14, borderRadius: 10,
      background: T.mode === 'dark' ? 'rgba(184,152,255,0.06)' : 'rgba(119,73,200,0.05)',
      border: `1px solid ${T.mode === 'dark' ? 'rgba(184,152,255,0.25)' : 'rgba(119,73,200,0.2)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, padding: '2px 7px',
            background: T.mode === 'dark' ? 'rgba(184,152,255,0.18)' : 'rgba(119,73,200,0.14)',
            color: acc.violet, borderRadius: 3,
            fontWeight: 800, fontFamily: 'JetBrains Mono',
            letterSpacing: '0.08em' }}>INK</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
            匯入自 iPad · Softmax 溫度推導</span>
          <span style={{ fontSize: 10, color: T.textFaint,
            fontFamily: 'JetBrains Mono' }}>14:55 · Apple Pencil</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={mb}>✦ OCR → LaTeX</button>
          <button style={mb}>↗ 獨立畫板</button>
        </div>
      </div>
      <NEInkSample theme={T} acc={acc}/>
    </div>
  );
};

const NEInkSample = ({ theme: T, acc }) => (
  <svg viewBox="0 0 680 180" style={{ width: '100%', height: 180,
    background: T.surface, borderRadius: 6,
    border: `1px solid ${T.borderSoft}` }}>
    <g stroke={acc.violet} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 40,52 C 30,44 24,56 32,64 C 40,72 54,70 56,80 C 58,92 40,96 32,90"/>
      <path d="M 72,76 C 64,62 88,58 88,74 C 88,90 66,90 70,76"/>
      <path d="M 108,90 C 108,60 108,48 116,44 M 102,70 L 118,68"/>
      <path d="M 136,50 L 136,88 M 128,62 L 146,60"/>
      <path d="M 158,88 L 160,66 C 162,60 172,60 174,68 L 174,88 M 174,72 C 176,62 188,62 190,72 L 188,88"/>
      <path d="M 210,74 C 200,66 198,84 210,86 C 222,88 222,70 210,68 M 222,66 L 220,88"/>
      <path d="M 240,64 L 260,90 M 258,66 L 240,90"/>
      <path d="M 292,42 C 282,58 282,84 292,100"/>
      <path d="M 306,60 L 322,86 M 320,60 L 304,88"/>
      <path d="M 332,78 L 332,90 M 332,72 L 332,72"/>
      <path d="M 348,42 C 358,58 358,84 348,100"/>
      <path d="M 382,66 L 410,66 M 382,78 L 410,78"/>
      <path d="M 440,70 L 590,70"/>
      <path d="M 462,44 C 452,38 448,56 458,58 C 468,58 472,56 470,52 M 476,48 L 484,36 L 496,48"/>
      <path d="M 452,102 L 472,96 L 452,96 L 472,90 L 452,90 L 472,84 L 452,84"/>
      <path d="M 484,90 L 500,86 L 500,98"/>
      <path d="M 520,86 C 514,82 508,92 516,96 C 526,98 528,86 518,84"/>
      <path d="M 540,84 L 548,92 L 540,96"/>
      <path d="M 564,78 L 576,94 M 574,78 L 560,96"/>
    </g>
    <g stroke={acc.amber} strokeWidth="1.5" fill="none">
      <path d="M 180 140 Q 240 120 300 75" strokeDasharray="3 4"/>
      <path d="M 295 72 L 306 73 L 301 82" fill={acc.amber}/>
    </g>
    <text x="60" y="158" fill={acc.amber} fontSize="13"
      fontFamily="'Caveat','Noto Sans TC',sans-serif" fontStyle="italic">
      溫度 T 控制 sharpness</text>
  </svg>
);

// ── Doc pane ─────────────────────────────────────────────────────
const NEDocPane = ({ theme: T, acc, fullWidth }) => (
  <div style={{ flex: 1, overflow: 'auto', background: T.surface,
    padding: fullWidth ? '40px 72px 100px' : '32px 40px 80px' }}>
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.14em',
        color: T.textDim, fontWeight: 700, fontFamily: 'JetBrains Mono' }}>
        ML · L13 · 03 / 05
      </div>
      <h1 style={{ margin: '6px 0 6px', fontSize: 28, fontWeight: 800,
        color: T.text, letterSpacing: '-0.022em', lineHeight: 1.2 }}>
        Multi-head 的動機
      </h1>
      <div style={{ fontSize: 12, color: T.textDim, marginBottom: 22 }}>
        老師現場推導 · 同步自麥克風轉錄 · 已匯入 iPad 手寫（2 張）
      </div>

      <div style={{ padding: 14, borderRadius: 8, background: T.surface2,
        border: `1px solid ${T.borderSoft}`, borderLeft: `3px solid ${acc.blue}`,
        marginBottom: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em',
          color: acc.blue, fontWeight: 800, fontFamily: 'JetBrains Mono',
          marginBottom: 6 }}>✦ AI 摘要 · 本頁重點</div>
        <div style={{ fontSize: 13, color: T.text, lineHeight: 1.7 }}>
          單頭 attention 只能捕捉一種 pattern。Multi-head 讓模型在
          <span style={{ background: T.mode === 'dark' ? 'rgba(255,205,120,0.15)' : 'rgba(176,122,16,0.1)',
            padding: '1px 4px', borderRadius: 3 }}>不同 subspace 並行 attend</span>，
          提高表達力卻不增加總參數量（每頭維度降為 d/h）。
        </div>
      </div>

      <p style={{ fontSize: 14, color: T.text, lineHeight: 1.85,
        marginBottom: 18, textWrap: 'pretty' }}>
        在單頭 attention 裡，query 向 key 算相似度後對 value 做加權。這樣的問題是：
        一個 token 只能同時關注<em style={{ color: acc.amber }}>一種</em>語意關係。譬如英文句子
        「The animal didn't cross the street because it was too tired」，
        <code style={{ background: T.surface2, padding: '1px 6px', borderRadius: 3,
          fontFamily: 'JetBrains Mono', fontSize: 12,
          border: `1px solid ${T.borderSoft}` }}>it</code>
        需要同時 attend 到
        <code style={{ background: T.surface2, padding: '1px 6px', borderRadius: 3,
          fontFamily: 'JetBrains Mono', fontSize: 12,
          border: `1px solid ${T.borderSoft}` }}>animal</code>（指涉）和
        <code style={{ background: T.surface2, padding: '1px 6px', borderRadius: 3,
          fontFamily: 'JetBrains Mono', fontSize: 12,
          border: `1px solid ${T.borderSoft}` }}>tired</code>（敘述）。
      </p>

      <NEEquation theme={T}/>
      <NEHandwriting theme={T} acc={acc}/>

      <div style={{ fontSize: 13, fontWeight: 700, color: T.text,
        margin: '24px 0 8px', letterSpacing: '-0.01em' }}>要點整理</div>
      <ul style={{ fontSize: 14, color: T.textMid, lineHeight: 1.85,
        paddingLeft: 22, margin: 0 }}>
        <li>參數量：<NEInlineMath theme={T}>{'h \\cdot 3 \\cdot (d/h) \\cdot d = 3 d^2'}</NEInlineMath>，與單頭一致</li>
        <li>每頭獨立學會關注某一種 pattern（語法 / 指涉 / 位置 …）</li>
        <li>輸出再透過 <NEInlineMath theme={T}>{'W^O'}</NEInlineMath> concat 後回到原始維度 <NEInlineMath theme={T}>d</NEInlineMath></li>
      </ul>

      <div style={{ marginTop: 24, padding: '10px 14px', borderRadius: 8,
        background: T.surface2, border: `1px solid ${T.borderSoft}`,
        display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: T.hot, fontSize: 14 }}>▸</span>
        <span style={{ fontSize: 10, letterSpacing: '0.14em',
          color: T.textDim, fontWeight: 700, fontFamily: 'JetBrains Mono' }}>錄音 · 26:14</span>
        <span style={{ fontSize: 13, color: T.text, flex: 1 }}>
          「你可以想成 <em style={{ color: acc.amber }}>每個頭</em>都是一個獨立的小 attention…」
        </span>
        <button style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700,
          background: T.invert, color: T.invertInk, border: 'none',
          borderRadius: 4, cursor: 'pointer',
          fontFamily: 'JetBrains Mono', letterSpacing: '0.06em' }}>▸ 聽</button>
      </div>
    </div>
  </div>
);

// ── Canvas pane ──────────────────────────────────────────────────
const NECanvasPane = ({ theme: T, acc, fullWidth }) => {
  const [tool, setTool] = React.useState('pen');
  const mb = neMiniBtn(T);
  const fab = { width: 36, height: 36, borderRadius: 10, fontSize: 14,
    background: T.surface, color: T.text,
    border: `1px solid ${T.border}`, cursor: 'pointer',
    boxShadow: T.shadow, display: 'grid', placeItems: 'center',
    fontFamily: 'inherit' };
  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex',
      flexDirection: 'column', background: T.surface2, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 14, left: '50%',
        transform: 'translateX(-50%)', zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 4, padding: 4,
        borderRadius: 10, background: T.surface, color: T.text,
        border: `1px solid ${T.border}`,
        boxShadow: T.shadow }}>
        {[
          { id: 'select', g: '↖', t: '選取' },
          { id: 'pen',    g: '✎', t: '筆' },
          { id: 'marker', g: '▐', t: '螢光筆' },
          { id: 'erase',  g: '⌫', t: '橡皮擦' },
          { id: 'shape',  g: '◯', t: '圖形' },
          { id: 'text',   g: 'T', t: '文字' },
          { id: 'math',   g: '∑', t: '公式' },
          { id: 'image',  g: '⚘', t: '圖片' },
        ].map(it => (
          <button key={it.id} onClick={() => setTool(it.id)} title={it.t}
            style={{ width: 30, height: 30, borderRadius: 7, fontSize: 13,
              background: tool === it.id ? T.invert : 'transparent',
              color: tool === it.id ? T.invertInk : T.textMid,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              display: 'grid', placeItems: 'center' }}>{it.g}</button>
        ))}
        <div style={{ width: 1, height: 20, background: T.border, margin: '0 4px' }}/>
        {[T.text, acc.amber, '#ffcd77', acc.green, acc.blue, acc.violet].map((c, i) => (
          <div key={i} style={{ width: 20, height: 20, borderRadius: 10,
            background: c, cursor: 'pointer',
            boxShadow: i === 4 ? `0 0 0 2px ${T.surface}, 0 0 0 3.5px ${c}` : 'none' }}/>
        ))}
        <div style={{ width: 1, height: 20, background: T.border, margin: '0 4px' }}/>
        {[1.5, 2.5, 4, 6].map(w => (
          <div key={w} style={{ width: 22, height: 20, borderRadius: 5,
            cursor: 'pointer', display: 'grid', placeItems: 'center',
            background: w === 2.5 ? T.chipBg : 'transparent' }}>
            <div style={{ width: 14, height: w, background: T.text,
              borderRadius: 999 }}/>
          </div>
        ))}
      </div>

      <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 10,
        display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button style={fab}>✦</button>
        <button style={fab} title="iPad 即時鏡像">⊞</button>
        <button style={fab} title="OCR → LaTeX">∑</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ width: fullWidth ? 2000 : 1600, height: 1200,
          position: 'relative',
          backgroundImage: `radial-gradient(${T.textFaint} 0.9px, transparent 1px)`,
          backgroundSize: '24px 24px', backgroundPosition: '12px 12px',
          margin: 'auto' }}>
          <NECanvasContent theme={T} acc={acc}/>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '8px 16px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        background: T.surface, borderTop: `1px solid ${T.border}`,
        fontSize: 10, color: T.textDim, fontFamily: 'JetBrains Mono',
        letterSpacing: '0.04em' }}>
        <div>1600 × 1200 · 圖層 3 · 筆劃 127</div>
        <div style={{ display: 'flex', gap: 14 }}>
          <span>Apple Pencil · 壓感 ✓</span>
          <span style={{ color: acc.green }}>● iPad 即時鏡像</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button style={mb}>−</button><span>78%</span>
          <button style={mb}>+</button><button style={mb}>全屏</button>
        </div>
      </div>
    </div>
  );
};

const NECanvasContent = ({ theme: T, acc }) => (
  <svg viewBox="0 0 1800 1400" style={{ width: '100%', height: '100%',
    position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    <defs>
      <marker id="ne-arr" viewBox="0 0 10 10" refX="8" refY="5"
        markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill={T.text}/>
      </marker>
    </defs>
    <g transform="translate(220, 140)">
      <text fontSize="24" fontWeight="800" fill={T.text}
        letterSpacing="-0.5">Attention 的幾何直觀</text>
      <text y="30" fontSize="13" fill={T.textDim}
        fontFamily="JetBrains Mono">— 從 dot-product 到 softmax</text>
    </g>
    <g stroke={acc.blue} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="180" y="260" width="170" height="80" rx="6"/>
      <rect x="440" y="260" width="170" height="80" rx="6"/>
      <rect x="700" y="260" width="170" height="80" rx="6"/>
    </g>
    <text x="265" y="308" fontSize="28" fontWeight="700" fill={acc.blue}
      textAnchor="middle" fontFamily="'Cambria Math',serif" fontStyle="italic">Q</text>
    <text x="265" y="330" fontSize="11" fill={T.textDim} textAnchor="middle"
      fontFamily="JetBrains Mono">query</text>
    <text x="525" y="308" fontSize="28" fontWeight="700" fill={acc.green}
      textAnchor="middle" fontFamily="'Cambria Math',serif" fontStyle="italic">K</text>
    <text x="525" y="330" fontSize="11" fill={T.textDim} textAnchor="middle"
      fontFamily="JetBrains Mono">key</text>
    <text x="785" y="308" fontSize="28" fontWeight="700" fill={acc.violet}
      textAnchor="middle" fontFamily="'Cambria Math',serif" fontStyle="italic">V</text>
    <text x="785" y="330" fontSize="11" fill={T.textDim} textAnchor="middle"
      fontFamily="JetBrains Mono">value</text>

    <g stroke={T.textMid} strokeWidth="1.6" fill="none" markerEnd="url(#ne-arr)">
      <path d="M 350 300 C 390 300, 390 390, 410 420"/>
      <path d="M 610 300 C 570 300, 570 390, 550 420"/>
    </g>
    <g stroke={acc.amber} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="390" y="420" width="200" height="72" rx="6"/>
    </g>
    <text x="490" y="466" fontSize="16" fontWeight="600" fill={acc.amber}
      textAnchor="middle" fontFamily="'Cambria Math',serif" fontStyle="italic">
      Q K<tspan fontSize="10" dy="-5">⊤</tspan><tspan dy="5"> / √d</tspan></text>

    <g stroke={T.textMid} strokeWidth="1.6" fill="none" markerEnd="url(#ne-arr)">
      <path d="M 490 492 L 490 560"/>
    </g>
    <text x="505" y="530" fontSize="12" fill={acc.amber}
      fontFamily="'Caveat',serif" fontStyle="italic">softmax</text>

    <g stroke={T.hot} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="390" y="560" width="200" height="64" rx="6"/>
    </g>
    <text x="490" y="600" fontSize="15" fill={T.hot} textAnchor="middle"
      fontFamily="'Cambria Math',serif" fontStyle="italic">
      α = softmax(QK<tspan fontSize="9" dy="-5">⊤</tspan><tspan dy="5">/√d)</tspan></text>

    <g stroke={T.textMid} strokeWidth="1.6" fill="none" markerEnd="url(#ne-arr)">
      <path d="M 590 592 C 670 592, 720 470, 780 360"/>
      <path d="M 785 340 L 785 680"/>
    </g>
    <g stroke={T.hot} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="700" y="680" width="170" height="64" rx="6"/>
    </g>
    <text x="785" y="720" fontSize="16" fontWeight="700" fill={T.hot}
      textAnchor="middle" fontFamily="'Cambria Math',serif" fontStyle="italic">
      α V  →  output</text>

    {/* sticky note */}
    <g transform="translate(960, 280) rotate(3)">
      <rect width="240" height="160" fill={acc.stickyBg}
        stroke={acc.stickyEdge} strokeWidth="1"/>
      <text x="18" y="34" fontSize="13" fontWeight="700" fill={acc.stickyInk}
        fontFamily="'Caveat','Noto Sans TC',cursive">想像這是一個</text>
      <text x="18" y="58" fontSize="13" fontWeight="700" fill={acc.stickyInk}
        fontFamily="'Caveat','Noto Sans TC',cursive">soft 版本的 hash-lookup：</text>
      <text x="18" y="86" fontSize="12" fill={acc.stickyInk}
        fontFamily="'Caveat','Noto Sans TC',cursive">Q 是你要找什麼</text>
      <text x="18" y="106" fontSize="12" fill={acc.stickyInk}
        fontFamily="'Caveat','Noto Sans TC',cursive">K 是每個位置的標籤</text>
      <text x="18" y="126" fontSize="12" fill={acc.stickyInk}
        fontFamily="'Caveat','Noto Sans TC',cursive">V 是那個位置的內容</text>
      <text x="18" y="148" fontSize="10" fill={acc.stickyInk} fontStyle="italic"
        fontFamily="'Caveat',serif" opacity="0.7">— from iPad · 15:02</text>
    </g>

    {/* Ink derivation block */}
    <g transform="translate(220, 780)">
      <rect width="580" height="320" rx="8" fill="none"
        stroke={acc.violet} strokeWidth="1.5" strokeDasharray="5 4"/>
      <text x="16" y="-8" fontSize="10" fill={acc.violet}
        fontFamily="JetBrains Mono" letterSpacing="0.12em">
        ● INK · APPLE PENCIL · 14:41</text>
      <g stroke={acc.violet} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 40 70 C 30 60 22 80 36 90 C 54 96 62 82 54 72 C 48 62 34 62 32 80"/>
        <path d="M 88 52 L 68 108"/>
        <path d="M 104 70 C 94 60 86 80 100 90 C 118 96 126 82 118 72 C 112 62 98 62 96 80"/>
        <path d="M 138 72 L 162 104 M 162 72 L 138 104"/>
        <path d="M 200 78 L 240 78 M 200 92 L 240 92"/>
      </g>
      <text x="260" y="88" fontSize="13" fill={acc.violet}
        fontFamily="'Caveat','Noto Sans TC',cursive" fontStyle="italic">
        softmax · derivative (未寫完…)</text>
      <g transform="translate(40, 240)">
        <rect width="500" height="54" rx="6" fill={T.surface}
          stroke={T.borderSoft}/>
        <text x="14" y="22" fontSize="10" fill={T.textDim}
          fontFamily="JetBrains Mono" letterSpacing="0.12em">
          LATEX · 自動辨識</text>
        <text x="14" y="42" fontSize="12" fill={acc.green}
          fontFamily="JetBrains Mono">
          \frac{'{'}\partial s_i{'}'}{'{'}\partial x_j{'}'} = s_i(\delta_{'{'}ij{'}'} - s_j)
        </text>
      </g>
    </g>
  </svg>
);

// ── Floating iPad mirror ─────────────────────────────────────────
const NEIPadMirror = ({ theme: T, acc, onClose }) => (
  <div style={{ position: 'absolute', right: 16, bottom: 44, zIndex: 50,
    width: 260, borderRadius: 12, overflow: 'hidden',
    background: T.surface, border: `1px solid ${T.border}`,
    boxShadow: T.shadow }}>
    <div style={{ padding: '8px 12px', display: 'flex',
      alignItems: 'center', justifyContent: 'space-between',
      background: T.surface2, borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: acc.green,
          animation: 'pulse 1.4s infinite' }}/>
        <span style={{ fontSize: 11, color: T.text, fontWeight: 600 }}>iPad 即時鏡像</span>
      </div>
      <div onClick={onClose} style={{ cursor: 'pointer', color: T.textDim,
        fontSize: 16, lineHeight: 1 }}>×</div>
    </div>
    <svg viewBox="0 0 280 180" style={{ display: 'block',
      background: '#fafaf7', width: '100%', height: 180 }}>
      <g stroke="#2d2a24" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 28 56 C 22 48 14 64 24 74 C 38 82 50 72 48 62"/>
        <path d="M 62 72 C 54 56 82 54 80 74 C 78 90 58 88 62 72"/>
        <path d="M 102 86 C 102 56 102 44 110 40 M 94 66 L 112 64"/>
        <path d="M 132 50 L 132 86 M 124 62 L 142 60"/>
        <path d="M 164 68 L 184 94 M 184 68 L 164 94"/>
      </g>
      <g stroke="#b54b12" strokeWidth="1.8" fill="none">
        <path d="M 208 76 L 236 76 M 208 88 L 236 88"/>
      </g>
      <g stroke="#2d2a24" strokeWidth="1.8" fill="none">
        <path d="M 248 70 L 260 94"/>
      </g>
      <circle cx="258" cy="92" r="4" fill="#b54b12">
        <animate attributeName="r" values="3;6;3" dur="1s" repeatCount="indefinite"/>
      </circle>
    </svg>
    <div style={{ padding: '6px 12px', fontSize: 10,
      color: T.textDim, fontFamily: 'JetBrains Mono',
      letterSpacing: '0.06em', borderTop: `1px solid ${T.border}`,
      display: 'flex', justifyContent: 'space-between' }}>
      <span>● 壓感 · 傾角</span>
      <span>14ms</span>
    </div>
  </div>
);

// ── Page root ────────────────────────────────────────────────────
const NotesEditorPage = ({ theme: T, onBack, embedded, contextLabel, currentT }) => {
  const acc = neAccents(T);
  const [mode, setMode] = React.useState(embedded ? 'doc' : 'doc');
  const [activePage, setActivePage] = React.useState('p3');
  const [showPad, setShowPad] = React.useState(!embedded);
  const [sync, setSync] = React.useState('drawing');

  React.useEffect(() => {
    const cycle = ['drawing', 'syncing', 'synced', 'synced'];
    let i = 0;
    const id = setInterval(() => { setSync(cycle[i % cycle.length]); i++; }, 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
      background: T.bg, minWidth: 0, minHeight: 0, position: 'relative' }}
      data-screen-label="Notes Editor">
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
      <NETopBar theme={T} acc={acc} mode={mode} setMode={setMode}
        syncState={sync} onBack={onBack} embedded={embedded}/>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {!embedded && <NESidebar theme={T} acc={acc}
          activePage={activePage} setActivePage={setActivePage}/>}
        {mode === 'doc'    && <NEDocPane theme={T} acc={acc} fullWidth/>}
        {mode === 'canvas' && <NECanvasPane theme={T} acc={acc} fullWidth/>}
        {mode === 'split'  && (
          <>
            <NEDocPane theme={T} acc={acc} fullWidth={false}/>
            <div style={{ width: 1, background: T.border }}/>
            <NECanvasPane theme={T} acc={acc} fullWidth={false}/>
          </>
        )}
      </div>
      {showPad && <NEIPadMirror theme={T} acc={acc}
        onClose={() => setShowPad(false)}/>}
    </div>
  );
};

Object.assign(window, { NotesEditorPage });
