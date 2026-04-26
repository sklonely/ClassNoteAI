// H18 Deep · Inbox & Preview (themed)

// Inbox row ────────────────────────────────────────────────────────
const H18InboxRow = ({ r, theme: T, selected, onClick, dense }) => {
  const c = v3GetCourse(r.course);
  const urgent = r.urgency === 'high';
  const courseText = h18CourseText(c, T);
  const sourceMap = {
    hw:    { src: 'NTU COOL', kind: '作業' },
    say:   { src: `L${c.nextLec.n - 1}`, kind: '老師說' },
    ann:   { src: '助教公告',  kind: '公告' },
    grade: { src: 'NTU COOL', kind: '成績' },
    quiz:  { src: '課堂',      kind: '小考' },
    todo:  { src: 'AI 建議',   kind: '待辦' },
    due:   { src: '行事曆',    kind: '到期' },
  };
  const src = sourceMap[r.type] || { src: '', kind: r.type };
  return (
    <div onClick={onClick} style={{
      display: 'grid',
      gridTemplateColumns: dense ? '46px 14px 1fr 70px 54px' : '54px 16px 1fr 78px 58px',
      gap: 8, alignItems: 'center',
      padding: dense ? '5px 14px' : '7px 16px',
      background: selected ? T.selBg : 'transparent',
      borderLeft: `3px solid ${selected ? T.selBorder : 'transparent'}`,
      cursor: 'pointer',
      color: T.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <span style={{ width: 5, height: 5, borderRadius: 3, background: c.color,
          flexShrink: 0 }}/>
        <span style={{ fontSize: 9, color: courseText, fontWeight: 800,
          letterSpacing: '0.03em', fontFamily: 'JetBrains Mono',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {c.short}
        </span>
      </div>
      <span style={{ fontSize: 12, textAlign: 'center', opacity: urgent ? 1 : 0.8 }}>
        {r.icon}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: '0 1 auto', maxWidth: '100%' }}>
            {r.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, color: T.textDim, minWidth: 0 }}>
          <span style={{ fontFamily: 'JetBrains Mono',
            padding: '0 4px', background: T.chipBg, borderRadius: 2,
            color: T.textMid, fontSize: 9, letterSpacing: '0.04em' }}>
            {src.kind}
          </span>
          {r.detail && (
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden',
              textOverflow: 'ellipsis' }}>
              {r.detail}
            </span>
          )}
        </div>
      </div>
      <span style={{ fontSize: 10, color: T.textFaint, fontFamily: 'JetBrains Mono',
        textAlign: 'right' }}>
        {src.src}
      </span>
      <span style={{ fontSize: 10, color: urgent ? T.urgent : T.textDim,
        fontWeight: urgent ? 700 : 500, textAlign: 'right',
        fontFamily: 'JetBrains Mono' }}>
        {r.when}
      </span>
    </div>
  );
};

// Inbox pane ────────────────────────────────────────────────────────
const H18Inbox = ({ theme: T, selectedId, onSelect, dense, filters }) => {
  const groups = [
    { key: 'today',  label: '今天到期',   items: V3_REMINDERS.filter(r => r.urgency === 'high' || r.when === '今天') },
    { key: 'week',   label: '本週',       items: V3_REMINDERS.filter(r => !(r.urgency === 'high' || r.when === '今天')).slice(0, 6) },
    { key: 'said',   label: '老師說過',   items: V3_REMINDERS.filter(r => r.type === 'say') },
  ];
  const visible = g => !filters || filters[g.key] !== false;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: T.surface, overflow: 'hidden' }}>
      {/* filters */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 16px 8px',
        borderBottom: `1px solid ${T.border}` }}>
        {[
          { l: '全部 · 14', active: true },
          { l: '高優 · 2' },
          { l: '老師說 · 3' },
          { l: '作業 · 4' },
          { l: '成績 · 2' },
        ].map((f, i) => (
          <button key={i} style={{
            padding: '4px 10px', fontSize: 11, fontWeight: 600,
            border: `1px solid ${f.active ? T.invert : T.border}`,
            borderRadius: 999,
            background: f.active ? T.invert : 'transparent',
            color: f.active ? T.invertInk : T.textMid,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{f.l}</button>
        ))}
        <div style={{ flex: 1 }}/>
        <button style={{ padding: '4px 8px', fontSize: 11, color: T.textDim,
          border: 'none', background: 'transparent', cursor: 'pointer' }}>
          排序：優先度 ▾
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {groups.filter(visible).map(g => (
          <div key={g.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 16px 5px',
              fontSize: 10, letterSpacing: '0.14em', fontWeight: 800,
              color: T.textDim, textTransform: 'uppercase',
              fontFamily: 'JetBrains Mono' }}>
              <span>{g.label}</span>
              <span style={{ color: T.textFaint }}>{g.items.length}</span>
              <div style={{ flex: 1, height: 1, background: T.border }}/>
            </div>
            {g.items.map(r => (
              <H18InboxRow key={r.id} r={r} theme={T} dense={dense}
                selected={r.id === selectedId}
                onClick={() => onSelect?.(r.id)}/>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

// Preview pane ──────────────────────────────────────────────────────
const H18Preview = ({ theme: T, course = 'ml' }) => {
  const c = v3GetCourse(course);
  const ct = h18CourseText(c, T);
  const btn = (primary) => ({
    padding: '7px 14px', fontSize: 12, fontWeight: primary ? 700 : 600,
    border: primary ? 'none' : `1px solid ${T.border}`, borderRadius: 6,
    background: primary ? T.invert : 'transparent',
    color: primary ? T.invertInk : T.text,
    cursor: 'pointer', fontFamily: 'inherit',
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%',
      background: T.surface, borderLeft: `1px solid ${T.border}` }}>
      {/* Preview header */}
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 10, color: ct, fontWeight: 800,
          letterSpacing: '0.06em', padding: '3px 8px',
          background: h18Accent(c, T), borderRadius: 4,
          fontFamily: 'JetBrains Mono' }}>{c.title}</span>
        <span style={{ fontSize: 11, color: T.textDim }}>作業 · 高優先</span>
        <div style={{ marginLeft: 'auto', color: T.textFaint, fontSize: 13,
          display: 'flex', gap: 10 }}>⤺ ⤻ ⋯</div>
      </div>
      <div style={{ padding: 18, overflow: 'auto', flex: 1, color: T.text }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em',
          lineHeight: 1.25 }}>HW3 · Transformer 實作</div>
        <div style={{ fontSize: 11, color: T.textDim, marginTop: 4,
          fontFamily: 'JetBrains Mono' }}>
          截止 週日 23:59 · 3 天後 · {c.instructor} · NTU COOL
        </div>
        {/* Urgency bar */}
        <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 6,
          background: T.hotBg, color: T.hot,
          fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center',
          gap: 8, fontFamily: 'JetBrains Mono' }}>
          <span>●</span>
          <span>預估 2h 30m · 剩 72h · 建議今晚開工</span>
        </div>
        {/* Desc */}
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8,
          background: T.surface2, border: `1px solid ${T.borderSoft}`,
          fontSize: 12, color: T.textMid, lineHeight: 1.65 }}>
          實作一個簡化版的 Transformer encoder，包含 multi-head attention
          與 positional encoding。Jupyter 檔案繳交，需附訓練 loss 曲線。
        </div>
        {/* Related notes */}
        <div style={{ marginTop: 16, fontSize: 9, color: T.textDim,
          letterSpacing: '0.16em', fontWeight: 800,
          fontFamily: 'JetBrains Mono' }}>
          相關筆記 · 3
        </div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { n: 'L13', t: 'Attention 機制',        m: '昨天',   d: '52m', keys: 2 },
            { n: 'L12', t: 'Self-Attention 推導',   m: '3 天前', d: '50m', keys: 1 },
            { n: 'L11', t: '為什麼需要 attention',  m: '1 週前', d: '48m', keys: 0 },
          ].map((n, i) => (
            <div key={i} style={{ padding: '7px 10px', borderRadius: 7,
              border: `1px solid ${T.borderSoft}`,
              display: 'grid',
              gridTemplateColumns: '32px 1fr auto auto',
              alignItems: 'center', gap: 10, fontSize: 12, color: T.text,
              cursor: 'pointer' }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: ct,
                fontFamily: 'JetBrains Mono', letterSpacing: '0.04em' }}>{n.n}</span>
              <span>{n.t}</span>
              {n.keys > 0 && (
                <span style={{ fontSize: 9, padding: '1px 5px',
                  background: T.hotBg, color: T.hot, borderRadius: 3,
                  fontWeight: 700, letterSpacing: '0.04em',
                  fontFamily: 'JetBrains Mono' }}>★ {n.keys}</span>
              )}
              {!n.keys && <span/>}
              <span style={{ color: T.textFaint, fontSize: 10,
                fontFamily: 'JetBrains Mono' }}>{n.m} · {n.d}</span>
            </div>
          ))}
        </div>
        {/* AI summary */}
        <div style={{ marginTop: 16, padding: 14, borderRadius: 8,
          background: T.mode === 'light' ? '#14141a' : '#2a2d34',
          color: '#e8e6de', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', color: '#c7a77a',
            fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
            ✦ AI 摘要 · 從 L11–13 整理
          </div>
          <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.55 }}>
            你需要的 concepts 都在 <b style={{ color: '#ffc98a' }}>L13 · 38:14</b> 之後。
            老師有提到 scaling factor 的細節，可能會考。準備好 Q/K/V 的矩陣形狀。
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600,
              borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: '#fff', cursor: 'pointer',
              fontFamily: 'inherit' }}>跳到 L13 · 38:14</button>
            <button style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600,
              borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: '#fff', cursor: 'pointer',
              fontFamily: 'inherit' }}>問 AI 追問</button>
          </div>
        </div>
        {/* Actions */}
        <div style={{ marginTop: 16, display: 'flex', gap: 6 }}>
          <button style={btn(true)}>開始做</button>
          <button style={btn()}>延後 1 天</button>
          <button style={btn()}>標記完成</button>
        </div>
      </div>
      {/* Keyboard hints */}
      <div style={{ padding: '7px 16px', borderTop: `1px solid ${T.border}`,
        fontSize: 10, color: T.textFaint, letterSpacing: '0.04em',
        display: 'flex', gap: 14, fontFamily: 'JetBrains Mono',
        background: T.surface2 }}>
        <span><b style={{ color: T.textMid }}>J/K</b> 上下</span>
        <span><b style={{ color: T.textMid }}>E</b> 完成</span>
        <span><b style={{ color: T.textMid }}>H</b> 延後</span>
        <span><b style={{ color: T.textMid }}>⌘/</b> 問 AI</span>
        <span style={{ marginLeft: 'auto' }}>{T.mode === 'dark' ? '●' : '○'} {T.mode}</span>
      </div>
    </div>
  );
};

Object.assign(window, { H18Inbox, H18InboxRow, H18Preview });
