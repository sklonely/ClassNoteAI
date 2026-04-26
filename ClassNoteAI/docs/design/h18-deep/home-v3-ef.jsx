// ═══════════════════════════════════════════════════════════════════
// H11 · COMMAND CENTER  (Arc / Raycast-style)
// 全畫面 = 一個命令輸入框 + 下面動態區塊（AI suggestions, 下一步, 未讀提醒）
// 鍵盤優先。空狀態是「問 ClassNote 任何事」
// 課程格縮在底部狀態列，點擊才展開
// ═══════════════════════════════════════════════════════════════════
const HomeCommandCenter = () => (
  <div style={h11S.root}>
    <V3Island/>

    {/* Ambient aurora */}
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '10%', top: '-20%', width: 600, height: 600,
        background: 'radial-gradient(circle, #6a8cff33, transparent 65%)', filter: 'blur(30px)' }}/>
      <div style={{ position: 'absolute', right: '-10%', bottom: '10%', width: 500, height: 500,
        background: 'radial-gradient(circle, #ff8a6a33, transparent 65%)', filter: 'blur(30px)' }}/>
    </div>

    <div style={{ position: 'relative', zIndex: 1, padding: '20px 32px',
      display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>

      {/* Top — small */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#888' }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: '#111', color: '#fff',
          display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>C</div>
        <span style={{ fontWeight: 600, color: '#111' }}>ClassNote</span>
        <span>·</span>
        <span>週一 04/21 · 17:08</span>
        <span style={{ marginLeft: 'auto' }}>1 堂課今晚 · 9 則提醒</span>
      </div>

      {/* HERO */}
      <div style={{ marginTop: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase',
          fontWeight: 600 }}>晚安，子瑜</div>
        <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 8,
          color: '#111' }}>
          你想做什麼？
        </div>

        {/* Command box */}
        <div style={{ maxWidth: 720, margin: '28px auto 0',
          padding: '16px 20px', borderRadius: 16,
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 20px 60px rgba(30,40,80,0.1)',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20, color: '#aaa' }}>⌕</span>
          <span style={{ fontSize: 18, color: '#999', flex: 1, textAlign: 'left' }}>
            問任何事、找任何筆記、或直接開始錄音…
          </span>
          <span style={{ padding: '4px 8px', fontSize: 11, color: '#888',
            background: '#f2f0eb', borderRadius: 5, fontFamily: 'JetBrains Mono' }}>⌘K</span>
        </div>

        {/* Quick actions */}
        <div style={{ maxWidth: 720, margin: '14px auto 0',
          display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { i: '●', t: '開始錄音', k: 'R', primary: true },
            { i: '📝', t: '今天到期 (2)', k: '1' },
            { i: '💬', t: '期末會考什麼？', k: '2' },
            { i: '↶',  t: '複習 ML L13', k: '3' },
            { i: '＋', t: '新增課程', k: 'N' },
          ].map((a, i) => (
            <span key={i} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12,
              background: a.primary ? '#111' : 'rgba(255,255,255,0.8)',
              color: a.primary ? '#fff' : '#333', fontWeight: a.primary ? 600 : 500,
              border: a.primary ? 'none' : '1px solid rgba(0,0,0,0.06)',
              display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <span>{a.i}</span>{a.t}
              <span style={{ fontSize: 10, opacity: 0.6, fontFamily: 'JetBrains Mono' }}>{a.k}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Dynamic suggestion region */}
      <div style={{ maxWidth: 820, width: '100%', margin: '28px auto 0',
        display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
        {/* Next up */}
        <div style={{ padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(24px)', border: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, color: '#888' }}>
            下一堂 · 1h 52m
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 4 }}>
            機器學習 · L14 Multi-Head
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
            李宏毅 · 電二 103 · 19:00
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
            <button style={h11S.btn(true)}>● 開始錄音</button>
            <button style={h11S.btn()}>複習 L13</button>
            <button style={h11S.btn()}>HW3 · 3 天</button>
          </div>
        </div>
        {/* Urgent */}
        <div style={{ padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(24px)', border: '1px solid rgba(0,0,0,0.06)',
          borderLeft: '3px solid #ff4b4b' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, color: '#c04a24' }}>
            今天到期 · 2
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {V3_REMINDERS.filter(r => r.urgency === 'high').map(r => {
              const c = v3GetCourse(r.course);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: c.color }}/>
                  <span style={{ fontSize: 10, color: c.color, fontWeight: 700 }}>{c.short}</span>
                  <span style={{ fontWeight: 500, flex: 1 }}>{r.title}</span>
                  <span style={{ fontSize: 11, color: '#c04a24', fontWeight: 600 }}>{r.when}</span>
                </div>
              );
            })}
            {V3_REMINDERS.filter(r => r.type === 'say').slice(0, 2).map(r => {
              const c = v3GetCourse(r.course);
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, opacity: 0.75 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: c.color }}/>
                  <span style={{ fontSize: 10, color: c.color, fontWeight: 700 }}>{c.short}</span>
                  <span style={{ fontWeight: 500, flex: 1,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                  <span style={{ fontSize: 11, color: '#888' }}>{r.when}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom dock: course chips */}
      <div style={{ marginTop: 'auto', display: 'flex', gap: 6, justifyContent: 'center',
        paddingBottom: 4 }}>
        {V3_COURSES.map(c => (
          <div key={c.id} style={{
            padding: '8px 12px', borderRadius: 10,
            background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(16px)',
            border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer',
            minWidth: 140, position: 'relative' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7,
              background: `linear-gradient(135deg, ${c.color}, ${c.color}cc)`,
              color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>
              {c.short}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.title}
              </div>
              <div style={{ fontSize: 10, color: '#888' }}>
                {c.nextLec.daysAway === 0 ? '今晚' : c.nextLec.when.split(' ')[0]}
              </div>
            </div>
            {c.unreviewed > 0 && (
              <div style={{ position: 'absolute', top: -4, right: -4, fontSize: 9,
                padding: '1px 5px', borderRadius: 999, background: '#ff4b4b', color: '#fff',
                fontWeight: 700 }}>{c.unreviewed}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  </div>
);

const h11S = {
  root: { width: '100%', height: '100%', position: 'relative',
    background: 'linear-gradient(180deg, #f6f1e6, #eee8da)', color: '#111',
    fontFamily: '"Inter", "Noto Sans TC", sans-serif', overflow: 'hidden' },
  btn: (primary) => ({ padding: '7px 12px', fontSize: 12, fontWeight: primary ? 600 : 500,
    border: primary ? 'none' : '1px solid rgba(0,0,0,0.1)', borderRadius: 8,
    background: primary ? '#111' : 'rgba(255,255,255,0.5)', color: primary ? '#fff' : '#111',
    cursor: 'pointer', fontFamily: 'inherit' }),
};

// ═══════════════════════════════════════════════════════════════════
// H12 · WEEK CALENDAR GRID  (Google Calendar-like, 資訊密度最高)
// 上：整週行事曆（7 列 x 時段），課程直接畫在格子上
// 下：每個課程一列，橫向顯示 lecture timeline / reminders 掛在對應週數
// 目標：學期+週+今天 一張圖看完
// ═══════════════════════════════════════════════════════════════════
const HomeWeekGrid = () => {
  const weekCourses = {
    '一': [{ t: 10, dur: 1.5, c: 'stat' }, { t: 14, dur: 1.5, c: 'alg' }, { t: 19, dur: 1.5, c: 'ml', next: true }],
    '二': [{ t: 9,  dur: 2,   c: 'lin' },  { t: 13, dur: 1.5, c: 'ds' }],
    '三': [{ t: 16, dur: 1.5, c: 'cmp' }],
    '四': [{ t: 14, dur: 1.5, c: 'alg' }],
    '五': [{ t: 10, dur: 1.5, c: 'stat' }],
    '六': [],
    '日': [],
  };
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  const days  = ['一', '二', '三', '四', '五', '六', '日'];
  const today = '一';

  // reminders positioned by week
  const weeksRail = Array.from({ length: 16 }, (_, i) => i + 1);
  const nowWeek = 9;

  return (
    <div style={h12S.root}>
      <V3Island/>

      {/* Top bar */}
      <div style={h12S.top}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: '#111', color: '#fff',
            display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>C</div>
          <span style={{ fontSize: 14, fontWeight: 700 }}>ClassNote</span>
          <span style={{ fontSize: 12, color: '#888' }}>· 春季第 9 週 · 04/21–04/27</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button style={h12S.chip()}>◀</button>
          <button style={h12S.chip('active')}>本週</button>
          <button style={h12S.chip()}>▶</button>
          <span style={{ width: 16 }}/>
          <button style={h12S.chip('active')}>週</button>
          <button style={h12S.chip()}>月</button>
          <button style={h12S.chip()}>學期</button>
          <span style={{ width: 16 }}/>
          <button style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none',
            borderRadius: 999, background: '#ff4b4b', color: '#fff', cursor: 'pointer',
            fontFamily: 'inherit' }}>● 錄音</button>
        </div>
      </div>

      {/* Week grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)',
        flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* time rail header */}
        <div style={{ borderRight: '1px solid #eee', borderBottom: '1px solid #eee' }}/>
        {days.map(d => (
          <div key={d} style={{
            padding: '8px 10px', borderRight: '1px solid #eee', borderBottom: '1px solid #eee',
            background: d === today ? '#fff8e1' : '#fff',
            fontSize: 11, color: '#888', fontWeight: 600, letterSpacing: '0.05em' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span>週{d}</span>
              <span style={{ fontSize: 18, color: d === today ? '#c04a24' : '#111', fontWeight: 700 }}>
                {21 + days.indexOf(d)}
              </span>
              {d === today && (
                <span style={{ fontSize: 10, padding: '1px 6px', background: '#ff4b4b',
                  color: '#fff', borderRadius: 999, marginLeft: 'auto' }}>今天</span>
              )}
            </div>
          </div>
        ))}

        {/* scrollable cells */}
        <div style={{ gridColumn: '1 / -1', display: 'grid',
          gridTemplateColumns: 'subgrid', overflow: 'auto', position: 'relative' }}>
          {/* time labels */}
          <div style={{ borderRight: '1px solid #eee', position: 'relative' }}>
            {hours.map(h => (
              <div key={h} style={{ height: 38, fontSize: 10, color: '#aaa',
                textAlign: 'right', paddingRight: 8, paddingTop: 2,
                fontFamily: 'JetBrains Mono', borderBottom: '1px dashed #f2f2f2' }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* day columns */}
          {days.map((d, di) => {
            const events = weekCourses[d] || [];
            return (
              <div key={d} style={{ borderRight: '1px solid #eee', position: 'relative',
                background: d === today ? 'rgba(255,248,225,0.3)' : 'transparent' }}>
                {/* hour lines */}
                {hours.map((h, i) => (
                  <div key={i} style={{ height: 38, borderBottom: '1px dashed #f2f2f2' }}/>
                ))}
                {/* now line on today */}
                {d === today && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: (17.13 - 9) * 38,
                    height: 0, borderTop: '2px solid #ff4b4b', zIndex: 3 }}>
                    <span style={{ position: 'absolute', left: 4, top: -7, width: 8, height: 8,
                      borderRadius: 5, background: '#ff4b4b' }}/>
                  </div>
                )}
                {/* events */}
                {events.map((e, ei) => {
                  const c = v3GetCourse(e.c);
                  return (
                    <div key={ei} style={{
                      position: 'absolute', left: 4, right: 4,
                      top: (e.t - 9) * 38, height: e.dur * 38 - 3,
                      background: e.next ? c.color : c.accent,
                      color: e.next ? '#fff' : '#111',
                      borderRadius: 6, padding: '6px 8px', fontSize: 11,
                      borderLeft: `3px solid ${c.color}`,
                      display: 'flex', flexDirection: 'column', gap: 2,
                      boxShadow: e.next ? `0 4px 14px ${c.color}60` : 'none',
                      cursor: 'pointer' }}>
                      <div style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{c.title}</div>
                      <div style={{ fontSize: 10, opacity: 0.8 }}>
                        L{c.nextLec.n} · {c.room}
                      </div>
                      {e.next && (
                        <div style={{ fontSize: 9, background: 'rgba(255,255,255,0.2)',
                          padding: '1px 5px', borderRadius: 3, alignSelf: 'flex-start',
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

      {/* Semester rail */}
      <div style={{ borderTop: '1px solid #eee', padding: '8px 16px',
        background: '#faf8f3', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.12em', color: '#888', fontWeight: 700 }}>
            學期進度 · 16 週
          </span>
          <span style={{ fontSize: 11, color: '#c04a24', fontWeight: 600 }}>
            ● 第 9 週 · 9 則提醒 · 2 堂期中考
          </span>
        </div>
        {V3_COURSES.map(c => {
          const rems = V3_REMINDERS.filter(r => r.course === c.id);
          return (
            <div key={c.id} style={{ display: 'grid',
              gridTemplateColumns: '110px 1fr 64px', gap: 10, alignItems: 'center',
              fontSize: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }}/>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                <span style={{ color: '#888', fontSize: 10 }}>L{c.lectures}</span>
              </div>
              {/* week rail */}
              <div style={{ position: 'relative', height: 18,
                background: '#efece4', borderRadius: 3 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${(nowWeek / 16) * 100}%`, background: c.color, opacity: 0.22,
                  borderRadius: 3 }}/>
                {/* lecture dots */}
                {Array.from({ length: c.lectures }).map((_, i) => (
                  <div key={i} style={{ position: 'absolute',
                    left: `${((i + 1) / 16) * 100}%`, top: 6, width: 6, height: 6,
                    marginLeft: -3, borderRadius: 3, background: c.color, opacity: 0.7 }}/>
                ))}
                {/* reminder dots */}
                {rems.map((r, i) => {
                  const w = nowWeek + (r.when.includes('天後') ? 0.5 : 0) + i * 0.15;
                  const iconColor = r.urgency === 'high' ? '#ff4b4b' : '#f5a462';
                  return (
                    <div key={r.id} style={{ position: 'absolute',
                      left: `${(w / 16) * 100}%`, top: 1, fontSize: 11,
                      transform: 'translateX(-50%)', color: iconColor }}>
                      {r.icon}
                    </div>
                  );
                })}
                {/* now marker */}
                <div style={{ position: 'absolute', left: `${(nowWeek / 16) * 100}%`,
                  top: -3, bottom: -3, width: 2, background: '#ff4b4b' }}/>
              </div>
              <div style={{ fontSize: 10, color: '#888', textAlign: 'right' }}>
                {Math.round(c.progress * 100)}% · {rems.length}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const h12S = {
  root: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#fff', fontFamily: '"Inter", "Noto Sans TC", sans-serif',
    color: '#111', overflow: 'hidden', position: 'relative' },
  top: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px', borderBottom: '1px solid #eee' },
  chip: (state) => ({ padding: '5px 10px', fontSize: 11, fontWeight: 500,
    border: '1px solid #ddd', borderRadius: 6, background: state === 'active' ? '#111' : '#fff',
    color: state === 'active' ? '#fff' : '#333', cursor: 'pointer', fontFamily: 'inherit' }),
};

Object.assign(window, { HomeCommandCenter, HomeWeekGrid });
