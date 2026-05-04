// Home · 6 style directions — shared data, radically different visual languages
// All use the same Course model: { title, lecture_count, total_duration,
// keywords[], last_lecture, next_scheduled }

const COURSES = [
  { id: 'ml',  title: '機器學習',        instructor: '李宏毅',    lectures: 14, mins: 682,
    keywords: ['self-attention', 'Transformer', 'CNN', 'gradient descent', 'Q/K/V'],
    last:    { n: 13, title: 'Attention 機制',    date: '昨天', dur: 52 },
    next:    { n: 14, title: 'Multi-Head 與應用', when: '今晚 19:00', daysAway: 0 },
    progress: 0.78, unreviewed: 2, color: '#2a3f8f' },
  { id: 'alg', title: '演算法',          instructor: '陳縕儂',    lectures:  9, mins: 412,
    keywords: ['dynamic programming', 'greedy', 'graph', 'NP-hard'],
    last:    { n:  9, title: 'Graph Algorithms', date: '3 天前', dur: 48 },
    next:    { n: 10, title: 'NP-completeness',  when: '週四 14:00', daysAway: 2 },
    progress: 0.56, unreviewed: 0, color: '#1f5f3a' },
  { id: 'ds',  title: '作業系統',        instructor: '洪士灝',    lectures: 11, mins: 528,
    keywords: ['process', 'mutex', 'paging', 'deadlock'],
    last:    { n: 11, title: 'Virtual Memory',   date: '5 天前', dur: 50 },
    next:    { n: 12, title: 'File System',      when: '下週一', daysAway: 5 },
    progress: 0.64, unreviewed: 1, color: '#7a3a2a' },
  { id: 'lin', title: '線性代數',        instructor: '蘇柏青',    lectures:  8, mins: 356,
    keywords: ['eigenvalue', 'SVD', 'rank', 'null space'],
    last:    { n:  8, title: 'Eigendecomposition', date: '1 週前', dur: 46 },
    next:    { n:  9, title: 'SVD',               when: '下週二', daysAway: 6 },
    progress: 0.48, unreviewed: 3, color: '#6a4a7a' },
  { id: 'stat', title: '機率論',         instructor: '黃怡菁',    lectures: 12, mins: 582,
    keywords: ['Bayes', 'MLE', 'Gaussian', 'CLT'],
    last:    { n: 12, title: 'Central Limit Theorem', date: '2 天前', dur: 49 },
    next:    { n: 13, title: 'Hypothesis Testing',     when: '週五 10:00', daysAway: 3 },
    progress: 0.71, unreviewed: 1, color: '#2a5a6a' },
  { id: 'cmp', title: '編譯器',          instructor: '廖世偉',    lectures:  6, mins: 288,
    keywords: ['lexer', 'parser', 'AST', 'LLVM'],
    last:    { n:  6, title: 'Parser Combinators', date: '4 天前', dur: 48 },
    next:    { n:  7, title: 'Semantic Analysis',   when: '週三 16:00', daysAway: 1 },
    progress: 0.33, unreviewed: 2, color: '#3a3a3a' },
];

const fmtMins = m => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
const fmtHrs  = m => (m/60).toFixed(1);

// ═══════════════════════════════════════════════════════════════════
// H1 · SWISS / MAGAZINE
// Big Inter/Söhne-feel type, 12-col grid, strong numbers, rules, asymmetric.
// Dense but navigable. The whole page reads like an issue of Page Magazine.
// ═══════════════════════════════════════════════════════════════════
const HomeSwiss = () => {
  const total = COURSES.reduce((a, c) => a + c.lectures, 0);
  const totalMins = COURSES.reduce((a, c) => a + c.mins, 0);
  const mostRecent = [...COURSES].sort((a, b) => {
    const order = { '昨天': 0, '2 天前': 2, '3 天前': 3, '4 天前': 4, '5 天前': 5, '1 週前': 7 };
    return (order[a.last.date] ?? 99) - (order[b.last.date] ?? 99);
  })[0];

  return (
    <div style={{ width: '100%', height: '100%', background: '#f4f3ee', color: '#0a0a0a',
      fontFamily: '"Inter", ui-sans-serif, system-ui', overflow: 'auto' }}>
      {/* Top masthead rule */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '14px 44px 10px',
        borderBottom: '1.5px solid #0a0a0a', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <div style={{ fontFamily: '"Inter Tight", Inter', fontWeight: 900, fontSize: 22, letterSpacing: '-0.02em' }}>
            ClassNote<span style={{ color: '#c94a3b' }}>/</span>
          </div>
          <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#666' }}>
            Vol. IV · No. 17 · {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <span style={{ borderBottom: '2px solid #0a0a0a', paddingBottom: 2 }}>Courses</span>
          <span style={{ color: '#888' }}>Library</span>
          <span style={{ color: '#888' }}>Assistant</span>
          <span style={{ color: '#888' }}>Settings</span>
        </div>
      </div>

      {/* Masthead: "index" headline + stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 36, padding: '26px 44px 20px',
        borderBottom: '1px solid #0a0a0a' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c94a3b', fontWeight: 600 }}>
            Index, Spring Term
          </div>
          <div style={{ fontFamily: '"Inter Tight", Inter', fontSize: 96, fontWeight: 900, lineHeight: 0.9,
            letterSpacing: '-0.045em', marginTop: 4 }}>
            Six courses,<br/>
            <span style={{ color: '#c94a3b' }}>{total}</span> lectures,<br/>
            <span style={{ fontStyle: 'italic', fontWeight: 300 }}>{fmtHrs(totalMins)} hrs.</span>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid #0a0a0a', paddingLeft: 20, display: 'flex',
          flexDirection: 'column', justifyContent: 'space-between', paddingTop: 4, paddingBottom: 4 }}>
          <BigStat label="This week" value="4.2" unit="hrs" delta="+18%"/>
          <BigStat label="Unreviewed" value="9" unit="notes" delta="—"/>
          <BigStat label="Streak" value="14" unit="days" delta="best" positive/>
          <div style={{ fontSize: 10, color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 6 }}>
            All figures · Term-to-date
          </div>
        </div>
      </div>

      {/* Lead story: featured (next class) */}
      <div style={{ padding: '20px 44px', borderBottom: '1px solid #0a0a0a',
        display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 28, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#666' }}>Up next, tonight</div>
          <div style={{ fontFamily: '"Inter Tight"', fontWeight: 800, fontSize: 42, lineHeight: 1.02,
            letterSpacing: '-0.03em', marginTop: 4 }}>
            {COURSES[0].next.title}.
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 13, color: '#444' }}>
            <span><b>{COURSES[0].title}</b> · {COURSES[0].instructor}</span>
            <span>·</span>
            <span>{COURSES[0].next.when}</span>
            <span>·</span>
            <span>Lecture No. {COURSES[0].next.n}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button style={swissBtn(true)}>▸ Start recording</button>
            <button style={swissBtn(false)}>Open syllabus</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#666' }}>Last lecture</div>
          <div style={{ fontFamily: '"Inter Tight"', fontWeight: 700, fontSize: 24, lineHeight: 1.1,
            letterSpacing: '-0.02em', marginTop: 4 }}>{mostRecent.last.title}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 6, lineHeight: 1.6 }}>
            「…所以這個公式的關鍵就是除以 √d_k，避免 softmax 飽和…」<br/>
            <span style={{ color: '#999' }}>— {mostRecent.title}, {mostRecent.instructor}</span>
          </div>
          <div style={{ fontSize: 11, color: '#c94a3b', marginTop: 10, letterSpacing: '0.05em' }}>
            Resume review →
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#666' }}>Keywords, this term</div>
          <div style={{ marginTop: 8, lineHeight: 1.7 }}>
            {['self-attention', 'Transformer', 'dynamic programming', 'eigenvalue', 'Bayes', 'mutex',
              'Q/K/V', 'SVD', 'deadlock', 'CLT', 'AST', 'MLE'].map((k, i) => (
              <span key={i} style={{ fontSize: i % 3 === 0 ? 18 : i % 3 === 1 ? 14 : 11,
                marginRight: 10, color: i % 4 === 0 ? '#c94a3b' : '#0a0a0a',
                fontWeight: i % 3 === 0 ? 600 : 400 }}>{k}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Course index — 6-col grid with big numerals */}
      <div style={{ padding: '14px 44px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c94a3b', fontWeight: 700 }}>
            § Courses index
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            <span style={{ borderBottom: '1.5px solid #0a0a0a' }}>Recent</span>
            <span style={{ color: '#888' }}>A–Z</span>
            <span style={{ color: '#888' }}>Density</span>
            <span style={{ color: '#888' }}>Grid</span>
            <span style={{ color: '#888', borderLeft: '1px solid #ccc', paddingLeft: 14 }}>+ New course</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
          border: '1px solid #0a0a0a', borderRight: 'none', borderBottom: 'none' }}>
          {COURSES.map((c, i) => (
            <div key={c.id} style={{
              borderRight: '1px solid #0a0a0a', borderBottom: '1px solid #0a0a0a',
              padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10,
              background: '#f4f3ee', minHeight: 190,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: '"Inter Tight"', fontSize: 56, fontWeight: 900,
                  lineHeight: 0.9, letterSpacing: '-0.04em', color: '#0a0a0a' }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 10, textAlign: 'right', color: '#666',
                  letterSpacing: '0.1em', textTransform: 'uppercase', paddingTop: 4 }}>
                  {c.unreviewed > 0 ? <span style={{ color: '#c94a3b', fontWeight: 700 }}>{c.unreviewed} unreviewed</span>
                    : <span style={{ color: '#1f5f3a' }}>All reviewed</span>}
                </div>
              </div>

              <div style={{ fontFamily: '"Inter Tight"', fontWeight: 800, fontSize: 26,
                lineHeight: 1.05, letterSpacing: '-0.02em' }}>
                {c.title}.
              </div>

              {/* data strip */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10,
                borderTop: '1px solid #0a0a0a', paddingTop: 10, marginTop: 'auto' }}>
                <Datum n={c.lectures} label="lec."/>
                <Datum n={fmtHrs(c.mins)} label="hrs"/>
                <Datum n={`${Math.round(c.progress * 100)}%`} label="prog."/>
              </div>

              {/* micro-bar */}
              <div style={{ height: 3, background: '#e5e2d9', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${c.progress * 100}%`, background: '#0a0a0a' }}/>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#444' }}>
                <span>{c.instructor}</span>
                <span style={{ color: c.next.daysAway === 0 ? '#c94a3b' : '#666', fontWeight: c.next.daysAway === 0 ? 600 : 400 }}>
                  {c.next.when}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* footer rules */}
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between',
          fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888' }}>
          <span>Typeset in Inter & Inter Tight · Set to {total} lectures</span>
          <span>Press <kbd style={swissKbd}>N</kbd> for new · <kbd style={swissKbd}>R</kbd> to record · <kbd style={swissKbd}>/</kbd> to search</span>
          <span>End of index ▪</span>
        </div>
      </div>
    </div>
  );
};

const swissBtn = (primary) => ({
  padding: '9px 16px', fontSize: 13, fontWeight: 600,
  background: primary ? '#0a0a0a' : 'transparent',
  color: primary ? '#f4f3ee' : '#0a0a0a',
  border: primary ? '1.5px solid #0a0a0a' : '1.5px solid #0a0a0a',
  cursor: 'pointer', letterSpacing: '0.02em', fontFamily: 'inherit',
});
const swissKbd = {
  fontFamily: 'ui-monospace, monospace', fontSize: 10, padding: '1px 5px',
  border: '1px solid #999', borderRadius: 2, background: '#fff',
};

const BigStat = ({ label, value, unit, delta, positive }) => (
  <div>
    <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#666' }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontFamily: '"Inter Tight"', fontWeight: 800, fontSize: 32, letterSpacing: '-0.03em' }}>{value}</span>
      <span style={{ fontSize: 11, color: '#666' }}>{unit}</span>
      {delta && <span style={{ fontSize: 10, marginLeft: 'auto',
        color: positive ? '#1f5f3a' : '#888' }}>{delta}</span>}
    </div>
  </div>
);

const Datum = ({ n, label }) => (
  <div>
    <div style={{ fontFamily: '"Inter Tight"', fontWeight: 700, fontSize: 18, lineHeight: 1, letterSpacing: '-0.02em' }}>
      {n}
    </div>
    <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888', marginTop: 2 }}>{label}</div>
  </div>
);

Object.assign(window, { HomeSwiss, COURSES, fmtMins, fmtHrs });
