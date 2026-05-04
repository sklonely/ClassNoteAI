// H2 · Minimal Editor — Linear / Things / Things-3 feel
// Very quiet. Fast to scan. Emphasis on a single next action.
// Monochrome + one accent. Tight type scale. Keyboard-first.

const HomeEditor = () => {
  const total = COURSES.reduce((a, c) => a + c.lectures, 0);
  const unreviewed = COURSES.reduce((a, c) => a + c.unreviewed, 0);
  const next = COURSES[0];

  return (
    <div style={{ width: '100%', height: '100%', background: '#fafafa', color: '#111',
      fontFamily: '"Inter", ui-sans-serif, system-ui', display: 'grid',
      gridTemplateColumns: '220px 1fr', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ borderRight: '1px solid #ececec', padding: '18px 14px', display: 'flex',
        flexDirection: 'column', gap: 2, background: '#f5f5f5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 16px' }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: '#111',
            display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>C</div>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>ClassNote</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#999' }}>⌘K</span>
        </div>

        <EditorNav icon="◉" label="Record"  hint="⌘R" primary/>
        <EditorNav icon="＋" label="Quick add" hint="⌘N"/>
        <div style={{ height: 14 }}/>
        <EditorNav icon="⌂" label="Today"    count={3} active/>
        <EditorNav icon="◐" label="Upcoming" count={2}/>
        <EditorNav icon="⬚" label="Library"  count={14}/>
        <EditorNav icon="✦" label="Assistant"/>

        <div style={{ marginTop: 22, fontSize: 10, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#999', padding: '0 8px 6px' }}>
          Courses
        </div>
        {COURSES.map(c => (
          <EditorNav key={c.id} icon={<span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }}/>}
            label={c.title} count={c.unreviewed || null} dim={c.unreviewed === 0}/>
        ))}
      </div>

      {/* Main */}
      <div style={{ overflow: 'auto' }}>
        {/* Top bar */}
        <div style={{ padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid #ececec' }}>
          <div style={{ fontSize: 10, color: '#999' }}>Today · 04/21</div>
          <div style={{ flex: 1 }}/>
          <div style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>🔍 search</span>
            <span style={{ color: '#ccc' }}>·</span>
            <span>filter</span>
            <span style={{ color: '#ccc' }}>·</span>
            <span>sort</span>
          </div>
        </div>

        <div style={{ padding: '28px 28px 40px', maxWidth: 820 }}>
          {/* Next-up — the one thing that matters */}
          <div style={{ fontSize: 11, color: '#999', letterSpacing: '0.05em',
            textTransform: 'uppercase', fontWeight: 500, marginBottom: 8 }}>Up next</div>
          <div style={{ border: '1px solid #ececec', borderRadius: 10, background: '#fff',
            padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 14,
            alignItems: 'center', boxShadow: '0 1px 0 rgba(0,0,0,0.02)' }}>
            <div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 3 }}>
                {next.title} · L{next.next.n} · {next.next.when}
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em' }}>
                {next.next.title}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={editorBtn(false)}>Syllabus</button>
              <button style={editorBtn(true)}>● Record</button>
            </div>
          </div>

          {/* Unreviewed queue */}
          <div style={{ marginTop: 30, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Unreviewed</span>
              <span style={{ fontSize: 13, color: '#999', marginLeft: 8 }}>{unreviewed}</span>
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>AI summary ready</div>
          </div>

          <div style={{ marginTop: 10, border: '1px solid #ececec', borderRadius: 10,
            background: '#fff', overflow: 'hidden' }}>
            {COURSES.filter(c => c.unreviewed > 0).flatMap(c =>
              Array.from({ length: c.unreviewed }).map((_, i) => ({
                course: c, i,
                title: i === 0 ? c.last.title : `${c.last.title} · part ${i + 1}`,
                mins: c.last.dur,
              }))
            ).slice(0, 6).map((row, idx, arr) => (
              <div key={idx} style={{
                display: 'grid', gridTemplateColumns: '20px 1fr auto auto auto', gap: 14,
                padding: '12px 16px', alignItems: 'center',
                borderBottom: idx < arr.length - 1 ? '1px solid #f0f0f0' : 'none',
                cursor: 'pointer',
              }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: row.course.color }}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.005em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                    {row.course.title} · {row.course.last.date}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: '#999' }}>{row.mins}m</span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3,
                  background: '#fff7e6', color: '#a8620f', border: '1px solid #fde4b3' }}>summary</span>
                <span style={{ fontSize: 14, color: '#ccc' }}>→</span>
              </div>
            ))}
          </div>

          {/* Course list (compact) */}
          <div style={{ marginTop: 32, display: 'flex', alignItems: 'baseline',
            justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 600 }}>All courses</span>
              <span style={{ fontSize: 13, color: '#999', marginLeft: 8 }}>{COURSES.length}</span>
            </div>
            <span style={{ fontSize: 12, color: '#666', cursor: 'pointer' }}>+ New course</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {COURSES.map((c, i) => (
              <div key={c.id} style={{
                display: 'grid', gridTemplateColumns: '16px 1fr auto auto 80px 44px auto',
                gap: 14, padding: '11px 4px', alignItems: 'center',
                borderBottom: '1px solid #f0f0f0', cursor: 'pointer', fontSize: 13,
              }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: c.color }}/>
                <span style={{ fontWeight: 500, letterSpacing: '-0.005em' }}>{c.title}</span>
                <span style={{ fontSize: 12, color: '#999' }}>{c.instructor}</span>
                <span style={{ fontSize: 12, color: '#999' }}>{c.lectures} lec</span>
                <span style={{ fontSize: 12, color: '#999', textAlign: 'right' }}>{fmtHrs(c.mins)} h</span>
                {/* tiny inline progress */}
                <div style={{ width: 44, height: 4, background: '#eee', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${c.progress * 100}%`, background: '#111' }}/>
                </div>
                <span style={{ fontSize: 12, color: c.next.daysAway <= 1 ? '#c94a3b' : '#999' }}>
                  {c.next.when}
                </span>
              </div>
            ))}
          </div>

          {/* quiet footer */}
          <div style={{ marginTop: 24, fontSize: 11, color: '#bbb',
            display: 'flex', gap: 14 }}>
            <span>⌘K command palette</span>
            <span>⌘R start recording</span>
            <span>⌘N new course</span>
            <span>/ search</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const EditorNav = ({ icon, label, hint, count, active, primary, dim }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6,
    background: active ? '#e7e7e7' : 'transparent',
    fontSize: 13, color: dim ? '#999' : '#222',
    cursor: 'pointer', fontWeight: active || primary ? 500 : 400,
  }}>
    <span style={{ width: 16, display: 'grid', placeItems: 'center', fontSize: 12,
      color: primary ? '#c94a3b' : '#666' }}>{icon}</span>
    <span style={{ flex: 1 }}>{label}</span>
    {count != null && <span style={{ fontSize: 11, color: '#999' }}>{count}</span>}
    {hint && <span style={{ fontSize: 10, color: '#bbb', fontFamily: 'ui-monospace' }}>{hint}</span>}
  </div>
);

const editorBtn = (primary) => ({
  padding: '7px 12px', fontSize: 12, fontWeight: 500,
  background: primary ? '#111' : '#fff',
  color: primary ? '#fff' : '#222',
  border: primary ? '1px solid #111' : '1px solid #ddd',
  borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
});

// ═══════════════════════════════════════════════════════════════════
// H3 · ACADEMIC / TUFTE
// Serif, generous margins, sidenotes, footnotes, small caps, rules.
// The app reads like a course journal you might actually bind.
// ═══════════════════════════════════════════════════════════════════
const HomeTufte = () => {
  const cream = '#fffff8';
  const rule  = '#d7d0c0';
  const ink   = '#1c1815';

  return (
    <div style={{ width: '100%', height: '100%', background: cream, color: ink,
      fontFamily: '"EB Garamond", "Iowan Old Style", Georgia, serif', overflow: 'auto' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 40px 56px' }}>
        {/* Title page */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#8b7f6a' }}>
            ClassNote · A personal course journal
          </div>
          <div style={{ fontSize: 46, fontStyle: 'italic', fontWeight: 400, letterSpacing: '-0.01em',
            marginTop: 8, lineHeight: 1.1 }}>
            My Courses, <span style={{ fontVariant: 'small-caps', fontStyle: 'normal' }}>Spring 2026</span>
          </div>
          <div style={{ fontSize: 13, color: '#6b604a', fontStyle: 'italic', marginTop: 6 }}>
            Six subjects · Sixty lectures · Forty-two hours of recorded instruction
          </div>
          <div style={{ width: 120, height: 1, background: rule, margin: '18px auto 0' }}/>
        </div>

        {/* 2-col grid with sidenotes */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 36, marginTop: 28 }}>
          {/* Main column */}
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
              color: '#8b7f6a', marginBottom: 4 }}>§ I. Summary</div>
            <div style={{ fontSize: 16, lineHeight: 1.75 }}>
              This term I am enrolled in <b style={{ fontVariant: 'small-caps' }}>six courses</b>,
              spanning machine learning, algorithms, operating systems, linear algebra,
              probability, and compilers. Each recorded lecture is transcribed on-device
              using Whisper<Sup n="1"/>, enriched with AI-generated summaries, and cross-linked
              to the course syllabus.
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.75, marginTop: 14 }}>
              Of the 60 lectures completed, <b>9 remain unreviewed</b>.<Sup n="2"/> The most pressing
              item is tonight's lecture on <em>Multi-Head Attention</em>, a continuation of
              yesterday's treatment of the Transformer architecture.
            </div>

            {/* Recent entries */}
            <div style={{ marginTop: 32, fontSize: 11, letterSpacing: '0.2em',
              textTransform: 'uppercase', color: '#8b7f6a', marginBottom: 10 }}>§ II. Recent entries</div>
            <div style={{ borderTop: '1px solid ' + ink, borderBottom: '1px solid ' + ink }}>
              {COURSES.slice(0, 5).map((c, i) => (
                <div key={c.id} style={{
                  display: 'grid', gridTemplateColumns: '38px 1fr 80px 60px', gap: 12,
                  padding: '12px 0', alignItems: 'baseline',
                  borderTop: i > 0 ? '1px solid ' + rule : 'none',
                }}>
                  <span style={{ fontVariant: 'small-caps', fontSize: 13, color: '#8b7f6a' }}>
                    {String(c.last.n).padStart(2, '0')}.
                  </span>
                  <div>
                    <span style={{ fontStyle: 'italic', fontSize: 17 }}>{c.last.title}</span>
                    <span style={{ color: '#8b7f6a', fontSize: 13 }}> · {c.title}, {c.instructor}</span>
                  </div>
                  <span style={{ fontSize: 12, color: '#6b604a', textAlign: 'right' }}>{c.last.date}</span>
                  <span style={{ fontSize: 12, color: '#6b604a', textAlign: 'right', fontVariant: 'tabular-nums' }}>
                    {c.last.dur} min.
                  </span>
                </div>
              ))}
            </div>

            {/* Next class */}
            <div style={{ marginTop: 32, padding: '16px 18px', border: '1px solid ' + ink,
              background: '#faf6ea', position: 'relative' }}>
              <div style={{ position: 'absolute', top: -10, left: 16, background: cream,
                padding: '0 8px', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
                color: '#8b7f6a' }}>Tonight · 19:00</div>
              <div style={{ fontSize: 22, fontStyle: 'italic' }}>
                {COURSES[0].next.title}
              </div>
              <div style={{ fontSize: 13, color: '#6b604a', marginTop: 3 }}>
                Lecture No. {COURSES[0].next.n}, {COURSES[0].title} · {COURSES[0].instructor}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button style={tufteBtn(true)}>▸ Begin recording</button>
                <button style={tufteBtn(false)}>Review L13 first</button>
              </div>
            </div>

            {/* Course table */}
            <div style={{ marginTop: 32, fontSize: 11, letterSpacing: '0.2em',
              textTransform: 'uppercase', color: '#8b7f6a', marginBottom: 10 }}>§ III. Courses, listed in full</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderTop: '1.5px solid ' + ink, borderBottom: '0.5px solid ' + ink }}>
                  {['Title', 'Instructor', 'Lectures', 'Hours', 'Progress', 'Next meeting'].map((h, i) => (
                    <th key={i} style={{ textAlign: i >= 2 && i <= 4 ? 'right' : 'left',
                      fontWeight: 400, fontStyle: 'italic', padding: '8px 6px', color: '#6b604a' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COURSES.map((c, i) => (
                  <tr key={c.id} style={{ borderBottom: i === COURSES.length - 1
                    ? '1.5px solid ' + ink : '1px solid ' + rule }}>
                    <td style={{ padding: '9px 6px' }}>
                      <span style={{ fontStyle: 'italic' }}>{c.title}</span>
                    </td>
                    <td style={{ padding: '9px 6px', color: '#6b604a' }}>{c.instructor}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'right', fontVariant: 'tabular-nums' }}>{c.lectures}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'right', fontVariant: 'tabular-nums' }}>{fmtHrs(c.mins)}</td>
                    <td style={{ padding: '9px 6px', textAlign: 'right' }}>
                      <SparkBar value={c.progress} ink={ink}/>
                    </td>
                    <td style={{ padding: '9px 6px', color: '#6b604a', fontStyle: 'italic' }}>{c.next.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footnotes */}
            <div style={{ marginTop: 40, borderTop: '1px solid ' + ink, paddingTop: 12, fontSize: 12, color: '#6b604a', lineHeight: 1.7 }}>
              <p><Sup n="1"/><em>Whisper base.en</em>, run locally via Metal acceleration. No audio leaves the device.</p>
              <p><Sup n="2"/>An unreviewed lecture is one whose AI-generated summary has not yet been opened.</p>
            </div>
          </div>

          {/* Sidenotes column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 11,
            color: '#6b604a', lineHeight: 1.55, fontStyle: 'italic' }}>
            <div style={{ borderLeft: '1px solid ' + rule, paddingLeft: 10 }}>
              <div style={{ fontStyle: 'normal', fontVariant: 'small-caps', color: ink, marginBottom: 3 }}>This week</div>
              4.2 hours recorded. Up 18% from the previous week. Longest session: 62 minutes.
            </div>
            <div style={{ borderLeft: '1px solid ' + rule, paddingLeft: 10 }}>
              <div style={{ fontStyle: 'normal', fontVariant: 'small-caps', color: ink, marginBottom: 3 }}>Streak</div>
              Fourteen consecutive days. A personal record.
            </div>
            <div style={{ borderLeft: '1px solid ' + rule, paddingLeft: 10 }}>
              <div style={{ fontStyle: 'normal', fontVariant: 'small-caps', color: ink, marginBottom: 3 }}>Cross-course motif</div>
              <em>Gradient descent</em> appears in ML (L3), probability (L8), and compilers
              (as "parameter tuning", L4). A note worth compiling.
            </div>
            <div style={{ borderLeft: '1px solid ' + rule, paddingLeft: 10 }}>
              <div style={{ fontStyle: 'normal', fontVariant: 'small-caps', color: ink, marginBottom: 3 }}>Assistant</div>
              The AI has prepared answers to 2 questions you flagged during L13. See <em>§IV</em>.
            </div>
            <div style={{ borderLeft: '1px solid ' + rule, paddingLeft: 10 }}>
              <div style={{ fontStyle: 'normal', fontVariant: 'small-caps', color: ink, marginBottom: 3 }}>Keyboard</div>
              <span style={{ fontFamily: 'ui-monospace', fontStyle: 'normal' }}>R</span> record ·{' '}
              <span style={{ fontFamily: 'ui-monospace', fontStyle: 'normal' }}>N</span> new course ·{' '}
              <span style={{ fontFamily: 'ui-monospace', fontStyle: 'normal' }}>/</span> search
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Sup = ({ n }) => (
  <sup style={{ fontSize: '0.65em', color: '#c94a3b', fontWeight: 700,
    marginLeft: 1, fontFamily: 'ui-monospace, monospace' }}>{n}</sup>
);

const tufteBtn = (primary) => ({
  padding: '6px 14px', fontSize: 14, fontStyle: 'italic',
  background: primary ? '#1c1815' : 'transparent',
  color: primary ? '#fffff8' : '#1c1815',
  border: '1px solid #1c1815', cursor: 'pointer', fontFamily: 'inherit',
  borderRadius: 0,
});

const SparkBar = ({ value, ink = '#111' }) => (
  <div style={{ display: 'inline-flex', gap: 1, alignItems: 'flex-end' }}>
    {Array.from({ length: 14 }).map((_, i) => {
      const on = i / 14 < value;
      return <span key={i} style={{ width: 3, height: 10, background: on ? ink : '#e8e1cf' }}/>;
    })}
    <span style={{ marginLeft: 6, fontSize: 11, color: '#6b604a', fontVariant: 'tabular-nums' }}>
      {Math.round(value * 100)}%
    </span>
  </div>
);

Object.assign(window, { HomeEditor, HomeTufte });
