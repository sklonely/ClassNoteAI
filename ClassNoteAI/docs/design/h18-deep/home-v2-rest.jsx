// H4 · Terminal / CLI — monospace, green phosphor on near-black,
// command prompt, ASCII rules, pretty-printed tables. Power user mode.

const HomeTerminal = () => {
  const bg = '#0d1117';
  const fg = '#d4d4d0';
  const dim = '#7a7a75';
  const green = '#7ec07a';
  const amber = '#e3b341';
  const red = '#e06c75';
  const blue = '#79b8ff';

  const pad = (s, n, right) => {
    s = String(s);
    if (s.length >= n) return s.slice(0, n);
    return right ? s + ' '.repeat(n - s.length) : ' '.repeat(n - s.length) + s;
  };

  return (
    <div style={{ width: '100%', height: '100%', background: bg, color: fg,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 13,
      padding: '18px 24px', overflow: 'auto', lineHeight: 1.55 }}>
      {/* shell header */}
      <div style={{ color: dim, fontSize: 11, display: 'flex', gap: 18, marginBottom: 10 }}>
        <span>classnote v2.0.0</span>
        <span>user@mbp</span>
        <span>whisper: base.en · metal</span>
        <span style={{ marginLeft: 'auto', color: green }}>● online</span>
      </div>

      {/* prompt */}
      <div>
        <span style={{ color: green }}>➜</span>{' '}
        <span style={{ color: blue }}>~/classnote</span>{' '}
        <span style={{ color: amber }}>(spring-26)</span>{' '}
        <span style={{ color: fg }}>classnote list --all</span>
      </div>

      {/* Big ASCII header */}
      <pre style={{ color: green, margin: '12px 0 6px', fontSize: 12, lineHeight: 1.2 }}>{
`┌──────────────────────────────────────────────────────────────────────┐
│  CLASSNOTE · course index                         spring 2026  04/21 │
└──────────────────────────────────────────────────────────────────────┘`}</pre>

      {/* Quick stats as KV */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2,
        fontSize: 12, margin: '10px 0 16px', padding: '8px 12px',
        background: '#161b22', border: '1px solid #21262d', borderRadius: 4 }}>
        <KV k="courses" v="6" color={blue}/>
        <KV k="lectures" v="60" color={blue}/>
        <KV k="hours"    v="42.5" color={blue}/>
        <KV k="unreviewed" v="9" color={amber}/>
        <KV k="streak"     v="14d" color={green}/>
        <KV k="this-week"  v="4.2h" color={green}/>
        <KV k="next-class" v="tonight 19:00" color={red}/>
        <KV k="disk"       v="2.3 GB" color={dim}/>
      </div>

      {/* Column header */}
      <pre style={{ color: dim, margin: '0 0 4px', fontSize: 12 }}>{
`  #  TITLE               INSTRUCTOR   LEC    HRS    PROG   UNREV   NEXT`}</pre>
      <pre style={{ color: dim, margin: '0 0 6px', fontSize: 12 }}>{
`  ── ─────────────────── ──────────── ─────  ─────  ─────  ─────   ─────────────`}</pre>

      {/* Rows */}
      <div>
        {COURSES.map((c, i) => {
          const prog = Math.round(c.progress * 20);
          const bar  = '█'.repeat(prog) + '░'.repeat(20 - prog);
          return (
            <div key={c.id} style={{ display: 'flex', gap: 0, fontSize: 12,
              padding: '2px 0', color: fg, whiteSpace: 'pre' }}>
              <span style={{ color: dim }}>  {String(i + 1).padStart(2, '0')} </span>
              <span style={{ color: fg, fontWeight: 600 }}>{pad(c.title, 20, true)}</span>
              <span style={{ color: dim }}>{pad(c.instructor, 12, true)} </span>
              <span style={{ color: blue }}>{pad(c.lectures, 4)} </span>
              <span style={{ color: blue }}>{pad(fmtHrs(c.mins), 6)} </span>
              <span style={{ color: green, fontSize: 10, letterSpacing: -1 }}>
                {bar.slice(0, 10)} <span style={{ color: fg }}>{pad(Math.round(c.progress*100) + '%', 4)}</span>
              </span>
              <span style={{ color: c.unreviewed ? amber : dim, marginLeft: 6 }}>
                {pad(c.unreviewed || '—', 5)}
              </span>
              <span style={{ color: c.next.daysAway === 0 ? red : dim, marginLeft: 4 }}>
                {c.next.when}
              </span>
            </div>
          );
        })}
      </div>

      {/* Next command suggestion */}
      <div style={{ marginTop: 22 }}>
        <div style={{ color: dim, fontSize: 11, marginBottom: 4 }}># up next</div>
        <div style={{ padding: '10px 12px', background: '#161b22',
          border: '1px solid #21262d', borderLeft: `3px solid ${red}`, borderRadius: 3 }}>
          <div style={{ color: red, fontSize: 11 }}># tonight 19:00 — machine learning</div>
          <div style={{ color: fg, fontSize: 14, fontWeight: 600, margin: '2px 0' }}>
            L14 · Multi-Head Attention
          </div>
          <div style={{ color: dim, fontSize: 11, marginTop: 4 }}>
            $ classnote record ml --lecture 14
          </div>
        </div>
      </div>

      {/* Tail commands */}
      <div style={{ marginTop: 14, color: dim, fontSize: 11 }}>
        ➜ <span style={{ color: green }}>classnote</span>{' '}
        <span style={{ color: fg }}>recent --limit 5</span>
      </div>
      <pre style={{ color: fg, margin: '6px 0 0', fontSize: 12 }}>{
`  2h   ${pad(COURSES[0].last.title, 24, true)} ml   ${COURSES[0].last.dur}m  [summary]  [review]
  3d   ${pad(COURSES[1].last.title, 24, true)} alg  ${COURSES[1].last.dur}m  [summary]  [review]
  4d   ${pad(COURSES[5].last.title, 24, true)} cmp  ${COURSES[5].last.dur}m  [summary]  [review]
  5d   ${pad(COURSES[2].last.title, 24, true)} os   ${COURSES[2].last.dur}m  [summary]  [review]
  7d   ${pad(COURSES[3].last.title, 24, true)} lin  ${COURSES[3].last.dur}m  [summary]  [review]`}</pre>

      {/* Prompt cursor */}
      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: green }}>➜</span>
        <span style={{ color: blue }}>~/classnote</span>
        <span style={{ color: fg }}>_</span>
        <span style={{ width: 8, height: 16, background: green,
          animation: 'termBlink 1.1s step-end infinite' }}/>
      </div>
      <div style={{ marginTop: 8, color: dim, fontSize: 11, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><b style={{ color: fg }}>r</b> record</span>
        <span><b style={{ color: fg }}>o</b>pen &lt;id&gt;</span>
        <span><b style={{ color: fg }}>n</b>ew</span>
        <span><b style={{ color: fg }}>a</b>sk</span>
        <span><b style={{ color: fg }}>q</b>uit</span>
        <span style={{ color: '#555' }}>· ctrl+k cmd palette</span>
      </div>

      <style>{`@keyframes termBlink{50%{opacity:0}}`}</style>
    </div>
  );
};

const KV = ({ k, v, color }) => (
  <div style={{ display: 'flex', gap: 8 }}>
    <span style={{ color: '#7a7a75' }}>{k}:</span>
    <span style={{ color, fontWeight: 600 }}>{v}</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// H5 · BRUTALIST — thick 2-3px lines, pure B/W + one accent, chunky
// type, offset shadows (hard, not soft), exposed structure.
// ═══════════════════════════════════════════════════════════════════
const HomeBrutalist = () => {
  const ink = '#0a0a0a';
  const paper = '#f5f3ec';
  const accent = '#ff4b1f';

  const hardShadow = (x = 5, y = 5) => `${x}px ${y}px 0 ${ink}`;

  return (
    <div style={{ width: '100%', height: '100%', background: paper, color: ink,
      fontFamily: '"Space Grotesk", "Inter", ui-sans-serif', overflow: 'auto',
      padding: '20px 28px 40px', position: 'relative' }}>
      {/* Header: heavy bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14,
        border: `3px solid ${ink}`, padding: '10px 14px', background: paper, marginBottom: 18 }}>
        <div style={{ width: 36, height: 36, background: ink, color: paper,
          display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 900,
          border: `3px solid ${ink}`, margin: -3 }}>C</div>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em' }}>CLASSNOTE/</div>
        <div style={{ flex: 1 }}/>
        {['COURSES', 'LIB.', 'AI', 'SET.'].map((t, i) => (
          <button key={i} style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
            background: i === 0 ? accent : paper, color: ink,
            border: `2.5px solid ${ink}`, cursor: 'pointer',
            boxShadow: i === 0 ? hardShadow(3, 3) : 'none',
          }}>{t}</button>
        ))}
      </div>

      {/* HERO: Up next */}
      <div style={{ border: `3px solid ${ink}`, boxShadow: hardShadow(6, 6),
        background: accent, color: ink, padding: '22px 22px', marginBottom: 20, position: 'relative' }}>
        <div style={{ position: 'absolute', top: -3, right: -3,
          background: ink, color: paper, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
          TONIGHT · 19:00
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.15em',
          textTransform: 'uppercase', opacity: 0.75 }}>
          NEXT CLASS // {COURSES[0].title} · {COURSES[0].instructor}
        </div>
        <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.03em', marginTop: 4 }}>
          {COURSES[0].next.title}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button style={brutalBtn(ink, paper, hardShadow(3, 3))}>● RECORD</button>
          <button style={brutalBtn(paper, ink, hardShadow(3, 3))}>SYLLABUS</button>
          <button style={brutalBtn(paper, ink, 'none')}>L13 REVIEW</button>
        </div>
      </div>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0,
        border: `3px solid ${ink}`, marginBottom: 20 }}>
        {[
          { n: 60,    l: 'LECTURES' },
          { n: '42.5', l: 'HOURS', suffix: 'h' },
          { n: 9,     l: 'UNREVIEWED', red: true },
          { n: 14,    l: 'STREAK', suffix: 'd' },
        ].map((s, i) => (
          <div key={i} style={{
            borderRight: i < 3 ? `3px solid ${ink}` : 'none',
            padding: '14px 16px', background: s.red ? accent : paper,
          }}>
            <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 0.9,
              letterSpacing: '-0.03em', fontVariant: 'tabular-nums' }}>
              {s.n}<span style={{ fontSize: 20 }}>{s.suffix || ''}</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', marginTop: 4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Course grid — 3 cols of chunky cards */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: '0.12em' }}>/ ALL COURSES / 06 /</div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>[ + NEW ]</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {COURSES.map((c, i) => (
          <div key={c.id} style={{
            border: `3px solid ${ink}`, background: paper, padding: '12px 14px',
            boxShadow: hardShadow(4, 4), position: 'relative',
            display: 'flex', flexDirection: 'column', gap: 8, minHeight: 170,
          }}>
            {/* Corner number */}
            <div style={{ position: 'absolute', top: -3, left: -3, background: ink, color: paper,
              padding: '3px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em' }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            {c.unreviewed > 0 && (
              <div style={{ position: 'absolute', top: -3, right: -3, background: accent, color: ink,
                padding: '3px 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.05em',
                border: `3px solid ${ink}`, margin: -3 }}>
                {c.unreviewed} TODO
              </div>
            )}
            <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.02em',
              lineHeight: 1.05, marginTop: 14 }}>
              {c.title.toUpperCase()}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555' }}>
              {c.instructor} · {c.lectures} LEC · {fmtHrs(c.mins)}H
            </div>
            <div style={{ flex: 1 }}/>
            {/* chunky progress */}
            <div style={{ border: `2.5px solid ${ink}`, height: 12, position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${c.progress * 100}%`,
                background: ink }}/>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10,
              fontWeight: 800, letterSpacing: '0.1em', marginTop: -3 }}>
              <span>{Math.round(c.progress * 100)}%</span>
              <span style={{ color: c.next.daysAway === 0 ? accent : '#555' }}>
                NEXT · {c.next.when.replace('今晚 19:00', 'TONIGHT')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom band */}
      <div style={{ marginTop: 24, padding: '10px 14px', border: `3px solid ${ink}`,
        background: ink, color: paper, display: 'flex', gap: 20, fontSize: 11,
        fontWeight: 700, letterSpacing: '0.15em' }}>
        <span>[R] RECORD</span>
        <span>[N] NEW</span>
        <span>[/] SEARCH</span>
        <span>[⌘K] PALETTE</span>
        <span style={{ marginLeft: 'auto' }}>CLASSNOTE © 2026 · v2.0.0</span>
      </div>
    </div>
  );
};

const brutalBtn = (bg, fg, shadow) => ({
  padding: '10px 16px', fontSize: 13, fontWeight: 900, letterSpacing: '0.08em',
  background: bg, color: fg, border: `2.5px solid #0a0a0a`, cursor: 'pointer',
  boxShadow: shadow, fontFamily: 'inherit',
});

// ═══════════════════════════════════════════════════════════════════
// H6 · iOS 17 — translucent materials, soft depth, generous spacing,
// SF-like type. Feels like a WWDC-keynote app.
// ═══════════════════════════════════════════════════════════════════
const HomeIOS = () => {
  const bgGrad = 'linear-gradient(160deg, #ffe8d4 0%, #ffd6dc 35%, #dbe5ff 72%, #cfe6f0 100%)';

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden',
      fontFamily: '"SF Pro Text", "Inter", -apple-system, system-ui', color: '#111',
      background: bgGrad, position: 'relative' }}>
      {/* ambient blobs */}
      <div style={{ position: 'absolute', left: -120, top: 80, width: 400, height: 400,
        background: 'radial-gradient(circle, #ff9472 0%, transparent 65%)', filter: 'blur(20px)' }}/>
      <div style={{ position: 'absolute', right: -60, top: -60, width: 380, height: 380,
        background: 'radial-gradient(circle, #b8b0ff 0%, transparent 65%)', filter: 'blur(20px)' }}/>
      <div style={{ position: 'absolute', right: 180, bottom: -120, width: 420, height: 420,
        background: 'radial-gradient(circle, #7ec7ff 0%, transparent 65%)', filter: 'blur(25px)' }}/>

      <div style={{ position: 'relative', padding: '20px 28px 32px', overflow: 'auto', height: '100%',
        boxSizing: 'border-box' }}>
        {/* top nav — pill of glass */}
        <div style={iosGlass({ padding: '8px 10px 8px 16px', display: 'flex', alignItems: 'center',
          gap: 10, borderRadius: 999, marginBottom: 18 })}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>ClassNote</div>
          <div style={{ flex: 1 }}/>
          <div style={{ display: 'flex', gap: 4 }}>
            {['Today', 'Library', 'Assistant'].map((t, i) => (
              <span key={i} style={{ padding: '6px 12px', fontSize: 12, borderRadius: 999,
                background: i === 0 ? 'rgba(255,255,255,0.7)' : 'transparent',
                fontWeight: i === 0 ? 600 : 500, color: i === 0 ? '#111' : '#555',
                boxShadow: i === 0 ? 'inset 0 0 0 0.5px rgba(0,0,0,0.06)' : 'none' }}>{t}</span>
            ))}
          </div>
          <button style={{ padding: '6px 12px', fontSize: 12, borderRadius: 999,
            border: 'none', background: '#111', color: '#fff', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit' }}>● Record</button>
        </div>

        {/* Greeting */}
        <div style={{ marginBottom: 16, maxWidth: 760 }}>
          <div style={{ fontSize: 13, color: '#555', fontWeight: 500 }}>Good evening, 子瑜</div>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1,
            marginTop: 2 }}>
            You have one class tonight.
          </div>
        </div>

        {/* Hero: next class glass card */}
        <div style={iosGlass({ padding: 20, marginBottom: 22, display: 'grid',
          gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center' })}>
          <div>
            <div style={{ fontSize: 11, color: '#b34a2b', fontWeight: 600, letterSpacing: '0.05em',
              textTransform: 'uppercase', marginBottom: 3 }}>Up next · 19:00</div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {COURSES[0].next.title}
            </div>
            <div style={{ fontSize: 13, color: '#444', marginTop: 4 }}>
              {COURSES[0].title} · {COURSES[0].instructor} · Lecture {COURSES[0].next.n}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button style={iosBtn(true)}>Start recording</button>
              <button style={iosBtn(false)}>Review L13</button>
              <button style={iosBtn(false)}>Syllabus</button>
            </div>
          </div>
          {/* round progress widget */}
          <div style={{ textAlign: 'center' }}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="10"/>
              <circle cx="60" cy="60" r="50" fill="none" stroke="url(#iosG)" strokeWidth="10"
                strokeLinecap="round" strokeDasharray={`${0.78 * 2 * Math.PI * 50} ${2 * Math.PI * 50}`}
                transform="rotate(-90 60 60)"/>
              <defs>
                <linearGradient id="iosG" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#ff6a3d"/>
                  <stop offset="1" stopColor="#b847ff"/>
                </linearGradient>
              </defs>
              <text x="60" y="62" textAnchor="middle" fontSize="26" fontWeight="700"
                fill="#111" letterSpacing="-0.03em">78%</text>
              <text x="60" y="80" textAnchor="middle" fontSize="10" fill="#666">course complete</text>
            </svg>
          </div>
        </div>

        {/* Widgets row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 14, marginBottom: 22 }}>
          {/* unreviewed */}
          <div style={iosGlass({ padding: 16 })}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: '#555', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Unreviewed</div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  9 <span style={{ fontSize: 13, color: '#777', fontWeight: 500 }}>notes</span>
                </div>
              </div>
              <div style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.6)',
                fontSize: 10, fontWeight: 600, color: '#b34a2b' }}>AI ready</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {COURSES.filter(c => c.unreviewed).slice(0, 3).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                  fontSize: 12, color: '#222' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: c.color }}/>
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.last.title}
                  </span>
                  <span style={{ color: '#888', fontSize: 11 }}>{c.last.date}</span>
                </div>
              ))}
            </div>
          </div>

          {/* streak */}
          <div style={iosGlass({ padding: 16, background: 'linear-gradient(135deg, rgba(255,180,140,0.5), rgba(255,255,255,0.3))' })}>
            <div style={{ fontSize: 11, color: '#7a3a1c', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>Streak</div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginTop: 4 }}>
              14<span style={{ fontSize: 14, color: '#7a3a1c', marginLeft: 3 }}>days</span>
            </div>
            <div style={{ fontSize: 11, color: '#7a3a1c', marginTop: 4 }}>Personal best ✦</div>
            <div style={{ display: 'flex', gap: 3, marginTop: 10 }}>
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} style={{ flex: 1, height: 18 + (i % 4) * 3, borderRadius: 3,
                  background: `rgba(255,${120 - i * 3},${80 - i * 2},0.75)` }}/>
              ))}
            </div>
          </div>

          {/* this week */}
          <div style={iosGlass({ padding: 16 })}>
            <div style={{ fontSize: 11, color: '#555', letterSpacing: '0.05em', textTransform: 'uppercase' }}>This week</div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 2 }}>
              4.2<span style={{ fontSize: 13, color: '#777', fontWeight: 500, marginLeft: 3 }}>hrs</span>
            </div>
            <div style={{ fontSize: 11, color: '#1f5f3a', fontWeight: 600, marginTop: 2 }}>↑ 18% vs. last</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 10, alignItems: 'flex-end', height: 38 }}>
              {[20, 35, 15, 40, 28, 10, 42].map((h, i) => (
                <div key={i} style={{ flex: 1, height: h, borderRadius: 3,
                  background: i === 6 ? 'linear-gradient(180deg, #7ec7ff, #3e8fff)'
                    : 'rgba(255,255,255,0.5)',
                  boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.04)' }}/>
              ))}
            </div>
          </div>
        </div>

        {/* Courses */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Your courses</div>
          <div style={{ fontSize: 12, color: '#555' }}>6 active · + New course</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {COURSES.map(c => (
            <div key={c.id} style={iosGlass({ padding: 14 })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9,
                  background: `linear-gradient(135deg, ${c.color}, ${c.color}bb)`,
                  display: 'grid', placeItems: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                  {c.title[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#777', marginTop: 1 }}>
                    {c.instructor} · {c.lectures} lec
                  </div>
                </div>
                {c.unreviewed > 0 && (
                  <div style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999,
                    background: 'rgba(255,107,58,0.18)', color: '#b34a2b', fontWeight: 600 }}>
                    {c.unreviewed}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#444', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', minHeight: 32 }}>
                Next · {c.next.title}
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.5)', borderRadius: 2,
                marginTop: 10, overflow: 'hidden' }}>
                <div style={{ width: `${c.progress * 100}%`, height: '100%',
                  background: `linear-gradient(90deg, ${c.color}, ${c.color}aa)` }}/>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10,
                color: '#666', marginTop: 4 }}>
                <span>{Math.round(c.progress * 100)}%</span>
                <span style={{ color: c.next.daysAway === 0 ? '#b34a2b' : '#666' }}>{c.next.when}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const iosGlass = (extra = {}) => ({
  background: 'rgba(255,255,255,0.55)',
  backdropFilter: 'blur(30px) saturate(1.8)',
  WebkitBackdropFilter: 'blur(30px) saturate(1.8)',
  border: '0.5px solid rgba(255,255,255,0.8)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 32px rgba(30, 40, 80, 0.10)',
  borderRadius: 18,
  ...extra,
});

const iosBtn = (primary) => ({
  padding: '8px 14px', fontSize: 13, fontWeight: 600,
  background: primary ? '#111' : 'rgba(255,255,255,0.75)',
  color: primary ? '#fff' : '#111',
  border: 'none', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
  boxShadow: primary ? '0 2px 6px rgba(0,0,0,0.18)' : 'inset 0 0 0 0.5px rgba(0,0,0,0.08)',
});

Object.assign(window, { HomeTerminal, HomeBrutalist, HomeIOS });
