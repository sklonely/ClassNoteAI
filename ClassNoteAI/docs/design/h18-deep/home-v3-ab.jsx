// ═══════════════════════════════════════════════════════════════════
// H7 · TODAY-FIRST DASHBOARD
// Desktop 3-col grid. Hero = 今日時間軸（含現在進行中）.
// Right rail = 提醒串（HW / 截止 / 老師說過 / 成績）.
// Bottom = 6 課程格（次要）.
// 目標：打開就知道「接下來 6 小時要幹嘛」.
// ═══════════════════════════════════════════════════════════════════
const HomeTodayFirst = () => {
  const now = { h: 17, m: 8 }; // 17:08
  const nowMin = now.h * 60 + now.m;

  return (
    <div style={h7Styles.root}>
      <V3Island/>

      {/* Top bar */}
      <div style={h7Styles.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={h7Styles.logo}>C</div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>ClassNote</div>
          <div style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>春季學期 · 第 9 週</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={h7Styles.searchbox}>
            <span style={{ color: '#888' }}>⌕</span>
            <span style={{ color: '#aaa' }}>搜尋講義、關鍵字、老師說過的話…</span>
            <span style={{ marginLeft: 'auto', color: '#bbb', fontSize: 11, padding: '1px 5px',
              background: '#f2f2f2', borderRadius: 4 }}>⌘K</span>
          </div>
          <button style={h7Styles.primary}>● 開始錄音</button>
        </div>
      </div>

      <div style={h7Styles.body}>
        {/* LEFT · Today timeline */}
        <div style={h7Styles.col}>
          <div style={h7Styles.colHead}>
            <div style={{ fontSize: 11, color: '#9a9a9a', letterSpacing: '0.12em', fontWeight: 600 }}>
              TODAY · 04/21 週一
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 4 }}>
              還有 1 堂課 · 19:00 開始
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              此刻 17:08 · 距離下一堂 1h 52m · 建議：複習昨天 ML L13 標記段落
            </div>
          </div>

          {/* Timeline */}
          <div style={{ position: 'relative', marginTop: 20, paddingLeft: 70 }}>
            {/* hours rail */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 58,
              borderRight: '1px dashed #e5e2db' }}>
              {['09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'].map(h => (
                <div key={h} style={{ height: 38, fontSize: 10, color: '#aaa',
                  fontFamily: 'JetBrains Mono, monospace', textAlign: 'right', paddingRight: 10 }}>
                  {h}:00
                </div>
              ))}
            </div>

            {/* now line */}
            <div style={{ position: 'absolute', left: 58, right: 0,
              top: (nowMin - 9*60) / 60 * 38, height: 0,
              borderTop: '2px solid #ff4b4b', zIndex: 3 }}>
              <span style={{ position: 'absolute', left: -50, top: -9, fontSize: 10,
                color: '#ff4b4b', fontWeight: 700, fontFamily: 'JetBrains Mono',
                background: '#fff', padding: '1px 4px' }}>NOW</span>
            </div>

            {/* blocks */}
            {V3_TODAY.map((b, i) => {
              const c = v3GetCourse(b.course);
              const [h, m] = b.t.split(':').map(Number);
              const top = (h*60 + m - 9*60) / 60 * 38;
              const height = b.dur / 60 * 38 - 4;
              const isNext = b.status === 'next';
              return (
                <div key={i} style={{
                  position: 'absolute', left: 0, right: 10, top, height,
                  background: isNext ? c.color : c.accent,
                  color: isNext ? '#fff' : '#222',
                  borderRadius: 8, padding: '8px 12px', fontSize: 13,
                  boxShadow: isNext ? `0 6px 20px ${c.color}60` : 'none',
                  border: b.status === 'done' ? '1px dashed #d5d1c7' : 'none',
                  opacity: b.status === 'done' ? 0.6 : 1,
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{b.title}</span>
                    {isNext && <span style={{ fontSize: 10, padding: '1px 6px',
                      background: 'rgba(255,255,255,0.2)', borderRadius: 3 }}>NEXT · 1h 52m</span>}
                    {b.status === 'done' && b.hasNotes &&
                      <span style={{ fontSize: 10, color: '#1f7a4f' }}>✓ 已有筆記</span>}
                    {b.status === 'done' && !b.hasNotes &&
                      <span style={{ fontSize: 10, color: '#c04a24' }}>！ 無筆記</span>}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.85 }}>
                    {b.t}–{String(h+1).padStart(2,'0')}:{String(m+b.dur-60).padStart(2,'0')} · {b.room}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MIDDLE · Reminders / Inbox */}
        <div style={{ ...h7Styles.col, background: '#faf8f3', borderLeft: '1px solid #ece8dd',
          borderRight: '1px solid #ece8dd' }}>
          <div style={h7Styles.colHead}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: '#9a9a9a', letterSpacing: '0.12em', fontWeight: 600 }}>
                INBOX · 14
              </div>
              <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 10 }}>
                <span style={{ color: '#111', fontWeight: 600 }}>全部</span>
                <span>作業 3</span>
                <span>老師說過 3</span>
                <span>公告 3</span>
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 4 }}>
              這週要注意的事
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
            {V3_REMINDERS.map(r => {
              const c = v3GetCourse(r.course);
              const urgent = r.urgency === 'high';
              return (
                <div key={r.id} style={{
                  display: 'grid', gridTemplateColumns: '56px 22px 1fr auto',
                  alignItems: 'center', gap: 10,
                  padding: '10px 4px', borderBottom: '1px solid #ece8dd',
                  cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 4, height: 4, borderRadius: 2, background: c.color }}/>
                    <span style={{ fontSize: 10, color: c.color, fontWeight: 700, letterSpacing: '0.03em' }}>
                      {c.short}
                    </span>
                  </div>
                  <div style={{ fontSize: 15, textAlign: 'center' }}>{r.icon}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#111', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                      {r.detail || c.title + ' · ' + c.instructor}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: urgent ? '#c04a24' : '#999',
                    fontWeight: urgent ? 700 : 500, whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums' }}>
                    {r.when}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT · Courses + AI */}
        <div style={h7Styles.col}>
          <div style={h7Styles.colHead}>
            <div style={{ fontSize: 11, color: '#9a9a9a', letterSpacing: '0.12em', fontWeight: 600 }}>
              COURSES · 6
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 4 }}>
              我的課
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {V3_COURSES.map(c => (
              <div key={c.id} style={{
                borderRadius: 10, padding: '10px 12px',
                background: '#fff', border: '1px solid #ece8dd',
                display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer',
                position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                  background: c.color }}/>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>{c.title}</span>
                  {c.unreviewed > 0 && (
                    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 999,
                      background: '#fff3e6', color: '#c04a24', fontWeight: 600 }}>
                      {c.unreviewed}
                    </span>
                  )}
                </div>
                <div style={{ paddingLeft: 6, fontSize: 10, color: '#888' }}>
                  {c.instructor} · {c.lectures} lec · {v3Fmt(c.mins)}
                </div>
                <div style={{ paddingLeft: 6, height: 3, background: '#f0ece3', borderRadius: 2 }}>
                  <div style={{ width: `${c.progress * 100}%`, height: '100%',
                    background: c.color, borderRadius: 2 }}/>
                </div>
                <div style={{ paddingLeft: 6, fontSize: 10,
                  color: c.nextLec.daysAway === 0 ? '#c04a24' : '#888' }}>
                  下次 · {c.nextLec.when}
                </div>
              </div>
            ))}
          </div>

          {/* Ask AI dock */}
          <div style={{ marginTop: 16, padding: 12, borderRadius: 10,
            background: 'linear-gradient(135deg, #1a1a1a, #2e2e2e)', color: '#fff' }}>
            <div style={{ fontSize: 10, color: '#888', letterSpacing: '0.12em', fontWeight: 600, marginBottom: 4 }}>
              ASK CLASSNOTE
            </div>
            <div style={{ fontSize: 13, color: '#fff', marginBottom: 8 }}>
              "期末會考什麼？" · "找老師提到 Q/K/V 的那段"
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center',
              padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.08)' }}>
              <span style={{ color: '#888' }}>?</span>
              <span style={{ color: '#888', fontSize: 12 }}>問 AI…</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#888' }}>⌘/</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const h7Styles = {
  root: { width: '100%', height: '100%', background: '#fff', color: '#111',
    fontFamily: '"Inter", "Noto Sans TC", sans-serif', overflow: 'hidden',
    display: 'flex', flexDirection: 'column', position: 'relative' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px', borderBottom: '1px solid #ece8dd', height: 48, boxSizing: 'border-box' },
  logo: { width: 26, height: 26, borderRadius: 7, background: '#111', color: '#fff',
    display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700 },
  searchbox: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
    background: '#f6f4ee', borderRadius: 8, width: 360, fontSize: 12 },
  primary: { padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none',
    borderRadius: 8, background: '#ff4b4b', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' },
  body: { flex: 1, display: 'grid', gridTemplateColumns: '1.15fr 1.2fr 0.95fr', overflow: 'hidden' },
  col: { padding: '20px 24px', overflow: 'auto', boxSizing: 'border-box' },
  colHead: {},
};

// ═══════════════════════════════════════════════════════════════════
// H8 · COURSE-FIRST GRID  (Spotify-home-like)
// 6 個大卡片 = 6 個課程。每張卡片上就能看到：下次課程、未處理提醒、上次摘要、進度。
// 資訊都在卡片裡；不用開另一頁。
// Hero = 下一堂課大卡片。
// ═══════════════════════════════════════════════════════════════════
const HomeCourseGrid = () => {
  const next = V3_COURSES[0];
  const rest = V3_COURSES.slice(1);
  const remByCourse = id => V3_REMINDERS.filter(r => r.course === id);

  return (
    <div style={h8Styles.root}>
      <V3Island/>

      {/* Sidebar */}
      <div style={h8Styles.sidebar}>
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={h7Styles.logo}>C</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>ClassNote</div>
        </div>
        <div style={{ padding: '0 10px' }}>
          {['⌂ 首頁', '✦ AI 助教', '⌕ 搜尋', '⌘ 行事曆', '◷ 最近', '★ 星號'].map((t, i) => (
            <div key={i} style={{ padding: '8px 10px', borderRadius: 7, fontSize: 13,
              color: i === 0 ? '#fff' : '#aaa',
              background: i === 0 ? '#1e1e1e' : 'transparent', fontWeight: i === 0 ? 600 : 500,
              cursor: 'pointer' }}>{t}</div>
          ))}
        </div>
        <div style={{ padding: '14px 16px 8px', fontSize: 10, color: '#555', letterSpacing: '0.12em',
          fontWeight: 700 }}>COURSES</div>
        <div style={{ padding: '0 10px', overflow: 'auto', flex: 1 }}>
          {V3_COURSES.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 7, fontSize: 12, color: '#ccc', cursor: 'pointer' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }}/>
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.title}
              </span>
              {c.unreviewed > 0 && (
                <span style={{ fontSize: 10, color: '#f5a462' }}>{c.unreviewed}</span>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid #222', fontSize: 11, color: '#777' }}>
          磁碟 2.3 GB · 串流中
        </div>
      </div>

      {/* Main */}
      <div style={h8Styles.main}>
        {/* Header greeting */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              週一 04/21 · 下午 17:08
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>
              午安，子瑜
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={h8Styles.btnGhost}>⌕ 搜尋</button>
            <button style={h8Styles.btnPrimary}>● 開始錄音</button>
          </div>
        </div>

        {/* HERO: next class */}
        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden',
          background: `linear-gradient(135deg, ${next.color}, ${next.color}aa 60%, #181818)`,
          padding: 28, marginBottom: 24, color: '#fff', minHeight: 180,
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.8, letterSpacing: '0.12em',
              textTransform: 'uppercase', fontWeight: 600 }}>下一堂 · 今晚 19:00 · 1h 52m 後</div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 4,
              lineHeight: 1.05 }}>
              {next.title} · L{next.nextLec.n}
            </div>
            <div style={{ fontSize: 16, opacity: 0.9, marginTop: 4 }}>
              {next.nextLec.title} · {next.instructor} · {next.room}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button style={{ ...h8Styles.btnPrimary, background: '#fff', color: '#111' }}>
                ● 開始錄音
              </button>
              <button style={{ ...h8Styles.btnGhost, background: 'rgba(255,255,255,0.15)',
                color: '#fff', border: 'none' }}>
                ← 複習 L{next.lastLec.n}：{next.lastLec.title}
              </button>
              <button style={{ ...h8Styles.btnGhost, background: 'transparent',
                color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>
                📝 HW3 截止 3 天
              </button>
            </div>
          </div>
          {/* 3 reminders for this course */}
          <div style={{ background: 'rgba(0,0,0,0.28)', borderRadius: 12, padding: '12px 14px',
            width: 260, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.65, letterSpacing: '0.12em', fontWeight: 600 }}>
              這堂課的提醒 · 4
            </div>
            {remByCourse('ml').map(r => (
              <div key={r.id} style={{ fontSize: 12, padding: '6px 0',
                borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: 8 }}>
                <span>{r.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.6 }}>{r.when}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row: Other courses */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>其他課程</div>
          <div style={{ fontSize: 12, color: '#888' }}>依下次上課排序</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {rest.map(c => {
            const rems = remByCourse(c.id);
            return (
              <div key={c.id} style={h8Styles.courseCard}>
                {/* Color header */}
                <div style={{ height: 74, background: `linear-gradient(135deg, ${c.color}, ${c.color}cc)`,
                  borderRadius: '12px 12px 0 0', padding: 12, color: '#fff',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  position: 'relative' }}>
                  <div style={{ fontSize: 10, opacity: 0.75, letterSpacing: '0.12em' }}>{c.short}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{c.title}</div>
                  {rems.length > 0 && (
                    <div style={{ position: 'absolute', top: 8, right: 8,
                      width: 20, height: 20, borderRadius: 10, background: '#ff4b4b',
                      display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700 }}>
                      {rems.length}
                    </div>
                  )}
                </div>
                {/* body */}
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 140 }}>
                  <div style={{ fontSize: 10, color: '#888' }}>
                    {c.instructor} · {c.lectures} lec · {v3Fmt(c.mins)}
                  </div>
                  <div style={{ fontSize: 10, color: c.nextLec.daysAway === 0 ? '#c04a24' : '#555',
                    fontWeight: 600 }}>
                    ↗ {c.nextLec.when} · L{c.nextLec.n} {c.nextLec.title}
                  </div>
                  <div style={{ fontSize: 10, color: '#888' }}>
                    ← {c.lastLec.date} · L{c.lastLec.n} {c.lastLec.title}
                  </div>
                  {rems.slice(0, 2).map(r => (
                    <div key={r.id} style={{ fontSize: 11, color: '#333',
                      background: '#f6f4ee', padding: '5px 7px', borderRadius: 5,
                      borderLeft: `2px solid ${c.color}`,
                      display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 11 }}>{r.icon}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden',
                          textOverflow: 'ellipsis', fontWeight: 500 }}>{r.title}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 3, background: '#eee', borderRadius: 2 }}>
                      <div style={{ width: `${c.progress * 100}%`, height: '100%',
                        background: c.color, borderRadius: 2 }}/>
                    </div>
                    <span style={{ fontSize: 10, color: '#888' }}>{Math.round(c.progress * 100)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const h8Styles = {
  root: { width: '100%', height: '100%', display: 'grid', gridTemplateColumns: '200px 1fr',
    background: '#fafaf7', fontFamily: '"Inter", "Noto Sans TC", sans-serif', overflow: 'hidden',
    color: '#111', position: 'relative' },
  sidebar: { background: '#121212', color: '#fff', display: 'flex', flexDirection: 'column' },
  main: { padding: '22px 30px 24px', overflow: 'auto' },
  btnPrimary: { padding: '8px 14px', fontSize: 12, fontWeight: 600, border: 'none',
    borderRadius: 999, background: '#111', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { padding: '8px 14px', fontSize: 12, fontWeight: 500, border: '1px solid #ddd',
    borderRadius: 999, background: '#fff', color: '#333', cursor: 'pointer', fontFamily: 'inherit' },
  courseCard: { background: '#fff', borderRadius: 12, overflow: 'hidden',
    border: '1px solid #ece8dd', cursor: 'pointer' },
};

Object.assign(window, { HomeTodayFirst, HomeCourseGrid });
