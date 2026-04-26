// V4 · Hybrid directions — timeline backbone + course cards + preview pattern
// Reuses V3_COURSES / V3_REMINDERS / V3_TODAY / V3_WEEK / V3Island from home-v3-data.jsx

// ────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────
const v4Hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const v4Days  = ['一', '二', '三', '四', '五', '六', '日'];
const V4_WEEK = {
  '一': [{ t: 10, dur: 1.5, c: 'stat', done: true }, { t: 14, dur: 1.5, c: 'alg', done: true }, { t: 19, dur: 1.5, c: 'ml', next: true }],
  '二': [{ t: 9,  dur: 2,   c: 'lin' },  { t: 13, dur: 1.5, c: 'ds' }],
  '三': [{ t: 16, dur: 1.5, c: 'cmp' }],
  '四': [{ t: 14, dur: 1.5, c: 'alg' }],
  '五': [{ t: 10, dur: 1.5, c: 'stat' }],
  '六': [], '日': [],
};

// Course card (reused across variants) — Spotify-ish
const V4CourseCard = ({ c, compact, onSelect, selected }) => {
  const rems = V3_REMINDERS.filter(r => r.course === c.id);
  return (
    <div onClick={onSelect} style={{
      background: '#fff', borderRadius: 12, overflow: 'hidden',
      border: selected ? `2px solid ${c.color}` : '1px solid #ece8dd',
      cursor: 'pointer', display: 'flex', flexDirection: 'column',
      boxShadow: selected ? `0 8px 24px ${c.color}33` : '0 1px 2px rgba(0,0,0,0.02)',
      transition: 'all 120ms' }}>
      <div style={{ height: compact ? 54 : 70,
        background: `linear-gradient(135deg, ${c.color}, ${c.color}cc)`,
        padding: '10px 12px', color: '#fff', position: 'relative',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.14em', opacity: 0.8, fontWeight: 700 }}>
          {c.short}
        </div>
        <div style={{ fontSize: compact ? 14 : 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {c.title}
        </div>
        {rems.length > 0 && (
          <div style={{ position: 'absolute', top: 8, right: 8, minWidth: 18, height: 18,
            padding: '0 5px', borderRadius: 9, background: '#ff4b4b', color: '#fff',
            fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center' }}>
            {rems.length}
          </div>
        )}
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
        <div style={{ fontSize: 10, color: '#888' }}>
          {c.instructor} · {c.lectures} lec · {v3Fmt(c.mins)}
        </div>
        <div style={{ fontSize: 10, color: c.nextLec.daysAway === 0 ? '#c04a24' : '#555',
          fontWeight: 600 }}>
          ↗ {c.nextLec.when} · L{c.nextLec.n}
        </div>
        {!compact && rems.slice(0, 2).map(r => (
          <div key={r.id} style={{ fontSize: 10, color: '#333', display: 'flex', gap: 5,
            whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span>{r.icon}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{r.title}</span>
          </div>
        ))}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, height: 3, background: '#eee', borderRadius: 2 }}>
            <div style={{ width: `${c.progress * 100}%`, height: '100%', background: c.color,
              borderRadius: 2 }}/>
          </div>
          <span style={{ fontSize: 9, color: '#888' }}>{Math.round(c.progress * 100)}%</span>
        </div>
      </div>
    </div>
  );
};

// Preview pane (the HW3 style the user liked)
const V4Preview = ({ course = 'ml' }) => {
  const c = v3GetCourse(course);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee',
        display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 10, color: c.color, fontWeight: 700, letterSpacing: '0.04em',
          padding: '2px 8px', background: c.accent, borderRadius: 4 }}>{c.title}</span>
        <span style={{ fontSize: 11, color: '#888' }}>📝 作業 · 高優先</span>
        <div style={{ marginLeft: 'auto', color: '#bbb', fontSize: 13 }}>⤺ ⤻ ⋯</div>
      </div>
      <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>HW3 · Transformer 實作</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 3 }}>
          截止 週日 23:59 · 3 天後 · {c.instructor} · NTU COOL
        </div>
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#faf8f3',
          fontSize: 12, color: '#444', lineHeight: 1.6 }}>
          實作一個簡化版的 Transformer encoder，包含 multi-head attention 與 positional
          encoding。Jupyter 檔案繳交，需附訓練 loss 曲線。
        </div>
        <div style={{ marginTop: 14, fontSize: 10, color: '#aaa', letterSpacing: '0.1em',
          fontWeight: 700 }}>相關筆記 · 3</div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { t: 'L13 · Attention 機制',      m: '昨天 · 52m' },
            { t: 'L12 · Self-Attention 推導', m: '3 天前 · 50m' },
            { t: 'L11 · 為什麼需要 attention', m: '1 週前 · 48m' },
          ].map((n, i) => (
            <div key={i} style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #eee',
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ color: c.color }}>📖</span>
              <span style={{ flex: 1 }}>{n.t}</span>
              <span style={{ color: '#aaa', fontSize: 11 }}>{n.m}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8,
          background: '#1a1a1a', color: '#fff' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#888', fontWeight: 700 }}>
            ✦ AI 摘要 · 從 L11–13 整理
          </div>
          <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>
            你需要的 concepts 都在 L13 · 38:14 之後。老師有提到 scaling factor 的細節，
            可能會考。準備好 Q/K/V 的矩陣形狀。
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
          <button style={v4Btn(true)}>開始做</button>
          <button style={v4Btn()}>延後 1 天</button>
          <button style={v4Btn()}>標記完成</button>
        </div>
      </div>
      <div style={{ padding: '8px 14px', borderTop: '1px solid #eee',
        fontSize: 10, color: '#aaa', letterSpacing: '0.06em',
        display: 'flex', gap: 14, fontFamily: 'JetBrains Mono' }}>
        <span><b style={{ color: '#111' }}>J/K</b> 上下</span>
        <span><b style={{ color: '#111' }}>E</b> 完成</span>
        <span><b style={{ color: '#111' }}>H</b> 延後</span>
        <span><b style={{ color: '#111' }}>⌘/</b> 問 AI</span>
      </div>
    </div>
  );
};
const v4Btn = (primary) => ({
  padding: '6px 12px', fontSize: 12, fontWeight: primary ? 600 : 500,
  border: primary ? 'none' : '1px solid #ddd', borderRadius: 6,
  background: primary ? '#111' : '#fff', color: primary ? '#fff' : '#333',
  cursor: 'pointer', fontFamily: 'inherit',
});

// Week calendar block (reused / tightened from H12)
const V4Calendar = ({ compact }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '44px repeat(7, 1fr)',
    flex: 1, overflow: 'hidden', minHeight: 0, border: '1px solid #eee', borderRadius: 8,
    background: '#fff' }}>
    <div style={{ borderRight: '1px solid #eee', borderBottom: '1px solid #eee',
      background: '#fafaf7' }}/>
    {v4Days.map(d => (
      <div key={d} style={{ padding: '6px 8px', borderRight: '1px solid #eee',
        borderBottom: '1px solid #eee', background: d === '一' ? '#fff8e1' : '#fafaf7',
        fontSize: 10, fontWeight: 600, color: '#888' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span>週{d}</span>
          <span style={{ fontSize: 14, color: d === '一' ? '#c04a24' : '#111', fontWeight: 700 }}>
            {21 + v4Days.indexOf(d)}
          </span>
          {d === '一' && (
            <span style={{ fontSize: 9, padding: '0 5px', background: '#ff4b4b', color: '#fff',
              borderRadius: 999, marginLeft: 'auto' }}>今天</span>
          )}
        </div>
      </div>
    ))}
    <div style={{ gridColumn: '1 / -1', display: 'grid',
      gridTemplateColumns: 'subgrid', overflow: 'auto', position: 'relative' }}>
      <div style={{ borderRight: '1px solid #eee' }}>
        {v4Hours.map(h => (
          <div key={h} style={{ height: compact ? 28 : 34, fontSize: 9, color: '#aaa',
            textAlign: 'right', paddingRight: 6, paddingTop: 2,
            fontFamily: 'JetBrains Mono', borderBottom: '1px dashed #f2f2f2' }}>
            {h}
          </div>
        ))}
      </div>
      {v4Days.map(d => {
        const evs = V4_WEEK[d] || [];
        const isToday = d === '一';
        const rowH = compact ? 28 : 34;
        return (
          <div key={d} style={{ borderRight: '1px solid #eee', position: 'relative',
            background: isToday ? 'rgba(255,248,225,0.3)' : 'transparent' }}>
            {v4Hours.map(h => <div key={h} style={{ height: rowH, borderBottom: '1px dashed #f2f2f2' }}/>)}
            {isToday && (
              <div style={{ position: 'absolute', left: 0, right: 0, top: (17.13 - 9) * rowH,
                height: 0, borderTop: '2px solid #ff4b4b', zIndex: 3 }}>
                <span style={{ position: 'absolute', left: 2, top: -4, width: 6, height: 6,
                  borderRadius: 3, background: '#ff4b4b' }}/>
              </div>
            )}
            {evs.map((e, i) => {
              const c = v3GetCourse(e.c);
              return (
                <div key={i} style={{
                  position: 'absolute', left: 3, right: 3,
                  top: (e.t - 9) * rowH, height: e.dur * rowH - 2,
                  background: e.next ? c.color : c.accent,
                  color: e.next ? '#fff' : '#222',
                  opacity: e.done ? 0.55 : 1,
                  borderRadius: 4, padding: '3px 6px', fontSize: 10,
                  borderLeft: `3px solid ${c.color}`,
                  display: 'flex', flexDirection: 'column', gap: 1,
                  boxShadow: e.next ? `0 4px 12px ${c.color}60` : 'none',
                  cursor: 'pointer' }}>
                  <div style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{c.title}</div>
                  <div style={{ fontSize: 9, opacity: 0.8 }}>L{c.nextLec.n} · {c.room}</div>
                  {e.next && (
                    <div style={{ fontSize: 8, background: 'rgba(255,255,255,0.2)',
                      padding: '0 4px', borderRadius: 2, alignSelf: 'flex-start',
                      marginTop: 'auto' }}>NEXT · 1h 52m</div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  </div>
);

const V4TopBar = ({ label }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px', borderBottom: '1px solid #eee', height: 44, boxSizing: 'border-box',
    background: '#fff', flexShrink: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: '#111', color: '#fff',
        display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>C</div>
      <span style={{ fontSize: 13, fontWeight: 700 }}>ClassNote</span>
      <span style={{ fontSize: 11, color: '#888' }}>· {label}</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: '#aaa' }}>⌕ ⌘K</span>
      <button style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none',
        borderRadius: 999, background: '#ff4b4b', color: '#fff', cursor: 'pointer',
        fontFamily: 'inherit' }}>● 錄音</button>
    </div>
  </div>
);

Object.assign(window, { V4CourseCard, V4Preview, V4Calendar, V4TopBar, V4_WEEK, v4Hours, v4Days, v4Btn });
