// V4 · 3 more hybrid directions (H16-H18)

// ═══════════════════════════════════════════════════════════════════
// H16 · CALENDAR SIDEBAR + CARD STACK
// 左：窄週曆 (永遠在旁) · 中：6 張課程卡網格 · 右：當日/提醒摘要
// ═══════════════════════════════════════════════════════════════════
const HomeCalSide = () => (
  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#fafaf7', fontFamily: '"Inter", "Noto Sans TC", sans-serif',
    color: '#111', overflow: 'hidden', position: 'relative' }}>
    <V3Island/>
    <V4TopBar label="04/21 週一"/>
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '320px 1fr 280px',
      gap: 1, background: '#ece8dd', overflow: 'hidden' }}>
      {/* Narrow weekly calendar */}
      <div style={{ background: '#fff', padding: 10, display: 'flex', flexDirection: 'column',
        overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>本週</div>
          <div style={{ fontSize: 10, color: '#888' }}>04/21 – 04/27</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
            <button style={{ ...v4Btn(), padding: '2px 7px', fontSize: 10 }}>◀</button>
            <button style={{ ...v4Btn(), padding: '2px 7px', fontSize: 10 }}>▶</button>
          </div>
        </div>
        <V4Calendar compact/>
      </div>

      {/* Course cards */}
      <div style={{ background: '#fafaf7', padding: '16px 20px', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>我的課程</div>
          <div style={{ fontSize: 11, color: '#888' }}>6 個 · 春季學期</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button style={{ ...v4Btn(true), fontSize: 11 }}>卡片</button>
            <button style={{ ...v4Btn(), fontSize: 11 }}>列表</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {V3_COURSES.map(c => <V4CourseCard key={c.id} c={c}/>)}
        </div>
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10,
          background: 'linear-gradient(135deg, #1a1a1a, #2e2e2e)', color: '#fff',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>✦</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', letterSpacing: '0.1em', fontWeight: 700 }}>
              ASK CLASSNOTE
            </div>
            <div style={{ fontSize: 13 }}>"期末會考什麼？" · "HW3 老師提過什麼？"</div>
          </div>
          <span style={{ fontSize: 10, padding: '3px 7px', background: 'rgba(255,255,255,0.08)',
            borderRadius: 5, fontFamily: 'JetBrains Mono' }}>⌘/</span>
        </div>
      </div>

      {/* Today + inbox */}
      <div style={{ background: '#fff', padding: 14, overflow: 'auto',
        display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', color: '#888', fontWeight: 700 }}>
            下一堂 · 1h 52m
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>
            ML L14 · Multi-Head
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>19:00 · 電二 103</div>
          <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
            <button style={v4Btn(true)}>● 錄音</button>
            <button style={v4Btn()}>複習 L13</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', color: '#888', fontWeight: 700 }}>
            INBOX · {V3_REMINDERS.length}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {V3_REMINDERS.slice(0, 7).map(r => {
              const c = v3GetCourse(r.course);
              return (
                <div key={r.id} style={{ display: 'grid',
                  gridTemplateColumns: '16px 1fr auto', gap: 6,
                  alignItems: 'center', padding: '6px 0',
                  borderBottom: '1px solid #f2efe8', fontSize: 11 }}>
                  <span>{r.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden',
                      textOverflow: 'ellipsis', fontWeight: 500 }}>{r.title}</div>
                    <div style={{ fontSize: 9, color: c.color, fontWeight: 700 }}>
                      {c.short} · {r.detail}
                    </div>
                  </div>
                  <span style={{ fontSize: 10,
                    color: r.urgency === 'high' ? '#c04a24' : '#888',
                    fontWeight: r.urgency === 'high' ? 700 : 500 }}>{r.when}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// H17 · DAY-FOCUS · calendar on left, big "up next" hero, cards at bottom
// 最聚焦於「今天要幹嘛」；行事曆在左、課程卡輔助在下
// ═══════════════════════════════════════════════════════════════════
const HomeDayFocus = () => {
  const next = V3_COURSES[0];
  const now = 17 * 60 + 8;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: '#fafaf7', fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      color: '#111', overflow: 'hidden', position: 'relative' }}>
      <V3Island/>
      <V4TopBar label="04/21 週一 · 17:08"/>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr',
        gap: 1, background: '#ece8dd', overflow: 'hidden' }}>
        {/* Day rail */}
        <div style={{ background: '#fff', padding: '14px 14px', overflow: 'auto' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', color: '#888', fontWeight: 700 }}>TODAY</div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em' }}>週一</div>
          <div style={{ fontSize: 11, color: '#666' }}>3 堂 · 2 完成 · 1 待上</div>
          <div style={{ position: 'relative', marginTop: 14, paddingLeft: 42 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 34,
              borderRight: '1px dashed #e5e2db' }}>
              {['09','10','11','12','13','14','15','16','17','18','19','20'].map(h => (
                <div key={h} style={{ height: 34, fontSize: 9, color: '#aaa',
                  fontFamily: 'JetBrains Mono', textAlign: 'right', paddingRight: 6 }}>{h}</div>
              ))}
            </div>
            <div style={{ position: 'absolute', left: 34, right: 0,
              top: (now - 9*60) / 60 * 34, borderTop: '2px solid #ff4b4b', zIndex: 3 }}>
              <span style={{ position: 'absolute', left: -34, top: -8, fontSize: 9,
                color: '#ff4b4b', fontWeight: 700, fontFamily: 'JetBrains Mono',
                background: '#fff', padding: '1px 3px' }}>NOW</span>
            </div>
            {V3_TODAY.map((b, i) => {
              const c = v3GetCourse(b.course);
              const [h, m] = b.t.split(':').map(Number);
              const top = (h*60 + m - 9*60) / 60 * 34;
              const height = b.dur / 60 * 34 - 3;
              const isNext = b.status === 'next';
              return (
                <div key={i} style={{
                  position: 'absolute', left: 0, right: 4, top, height,
                  background: isNext ? c.color : c.accent, color: isNext ? '#fff' : '#222',
                  borderRadius: 6, padding: '4px 8px', fontSize: 10,
                  borderLeft: `3px solid ${c.color}`,
                  opacity: b.status === 'done' ? 0.55 : 1 }}>
                  <div style={{ fontWeight: 700 }}>{b.title.split(' · ')[0]}</div>
                  <div style={{ fontSize: 9, opacity: 0.8 }}>{b.t}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main */}
        <div style={{ background: '#fafaf7', padding: '18px 24px', overflow: 'auto' }}>
          {/* Hero: next class — HUGE */}
          <div style={{ borderRadius: 14, overflow: 'hidden',
            background: `linear-gradient(135deg, ${next.color}, ${next.color}bb 60%, #111)`,
            color: '#fff', padding: 22, display: 'grid',
            gridTemplateColumns: '1fr 280px', gap: 16, minHeight: 170 }}>
            <div>
              <div style={{ fontSize: 11, opacity: 0.8, letterSpacing: '0.1em',
                textTransform: 'uppercase', fontWeight: 700 }}>下一堂 · 1h 52m</div>
              <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 4,
                lineHeight: 1.05 }}>{next.title} · L{next.nextLec.n}</div>
              <div style={{ fontSize: 14, opacity: 0.9, marginTop: 3 }}>
                {next.nextLec.title} · {next.instructor} · {next.room} · 19:00
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
                <button style={{ ...v4Btn(), background: '#fff', color: '#111', fontSize: 13,
                  padding: '8px 14px', fontWeight: 600 }}>● 開始錄音</button>
                <button style={{ ...v4Btn(), background: 'rgba(255,255,255,0.15)',
                  color: '#fff', border: 'none', fontSize: 13, padding: '8px 14px' }}>
                  ← 複習 L13
                </button>
                <button style={{ ...v4Btn(), background: 'transparent', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)', fontSize: 13, padding: '8px 14px' }}>
                  📝 HW3 · 3 天
                </button>
              </div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: '10px 12px',
              display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 9, opacity: 0.65, letterSpacing: '0.1em', fontWeight: 700 }}>
                這堂課提醒 · {V3_REMINDERS.filter(r=>r.course==='ml').length}
              </div>
              {V3_REMINDERS.filter(r=>r.course==='ml').map(r => (
                <div key={r.id} style={{ fontSize: 11, padding: '4px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: 6 }}>
                  <span>{r.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.title}
                    </div>
                    <div style={{ fontSize: 9, opacity: 0.6 }}>{r.when}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* cards row */}
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline',
            justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>其他課程</div>
            <div style={{ fontSize: 11, color: '#888' }}>依下次上課排序</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {V3_COURSES.slice(1).map(c => <V4CourseCard key={c.id} c={c} compact/>)}
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// H18 · INBOX + CALENDAR + CARDS (Superhuman-meets-calendar)
// 左側：課程 icons  · 中左：Inbox 串流 · 中右：當週行事曆（小）  · 右：preview pane
// 一次把 4 件事都塞進去：分類、時間、動作、詳情
// ═══════════════════════════════════════════════════════════════════
const HomeInboxCal = () => (
  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#fafaf7', fontFamily: '"Inter", "Noto Sans TC", sans-serif',
    color: '#111', overflow: 'hidden', position: 'relative' }}>
    <V3Island/>
    <V4TopBar label="Inbox · 14 項"/>
    <div style={{ flex: 1, display: 'grid',
      gridTemplateColumns: '60px 1fr 340px',
      gap: 1, background: '#ece8dd', overflow: 'hidden' }}>
      {/* Icon rail */}
      <div style={{ background: '#f7f5ef', display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '10px 0', gap: 8, overflow: 'auto' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#111',
          display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14 }}>⌂</div>
        <div style={{ width: 40, height: 40, borderRadius: 10,
          display: 'grid', placeItems: 'center', color: '#555', fontSize: 14 }}>⌕</div>
        <div style={{ width: '70%', height: 1, background: '#e5e2db', margin: '4px 0' }}/>
        {V3_COURSES.map(c => (
          <div key={c.id} style={{ position: 'relative', width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(135deg, ${c.color}, ${c.color}cc)`, color: '#fff',
            display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, cursor: 'pointer',
            boxShadow: c.id === 'ml' ? `0 0 0 2.5px #111` : 'none' }}>
            {c.short.slice(0, 3)}
            {c.unreviewed > 0 && (
              <div style={{ position: 'absolute', top: -2, right: -2, fontSize: 9,
                padding: '1px 5px', borderRadius: 999, background: '#ff4b4b', color: '#fff',
                fontWeight: 700 }}>{c.unreviewed}</div>
            )}
          </div>
        ))}
        <div style={{ width: 40, height: 40, borderRadius: 10, border: '1.5px dashed #ccc',
          display: 'grid', placeItems: 'center', color: '#aaa', fontSize: 18 }}>＋</div>
      </div>

      {/* Inbox + mini calendar stacked */}
      <div style={{ background: '#fff', display: 'flex', flexDirection: 'column',
        overflow: 'hidden' }}>
        {/* Mini calendar on top */}
        <div style={{ padding: 12, borderBottom: '1px solid #eee',
          display: 'flex', flexDirection: 'column', height: 260, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>本週行事曆</div>
            <div style={{ fontSize: 10, color: '#888' }}>04/21 – 04/27</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
              <button style={{ ...v4Btn(), padding: '2px 8px', fontSize: 10 }}>◀</button>
              <button style={{ ...v4Btn(true), padding: '2px 8px', fontSize: 10 }}>本週</button>
              <button style={{ ...v4Btn(), padding: '2px 8px', fontSize: 10 }}>▶</button>
            </div>
          </div>
          <V4Calendar compact/>
        </div>
        {/* Inbox */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {[
            { label: '今天到期', items: V3_REMINDERS.filter(r => r.urgency === 'high' || r.when === '今天') },
            { label: '本週', items: V3_REMINDERS.filter(r => !(r.urgency === 'high' || r.when === '今天')).slice(0, 6) },
            { label: '老師說過', items: V3_REMINDERS.filter(r => r.type === 'say') },
          ].map((g, gi) => (
            <div key={gi}>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, color: '#aaa',
                padding: '10px 16px 4px', textTransform: 'uppercase' }}>
                {g.label} · {g.items.length}
              </div>
              {g.items.map(r => {
                const c = v3GetCourse(r.course);
                const urgent = r.urgency === 'high';
                const selected = r.id === 'r01';
                return (
                  <div key={r.id} style={{
                    display: 'grid', gridTemplateColumns: '80px 20px 1fr auto', gap: 8,
                    alignItems: 'center', padding: '8px 16px',
                    background: selected ? '#fff8e1' : 'transparent',
                    borderLeft: selected ? '3px solid #f5a462' : '3px solid transparent',
                    cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 3, background: c.color }}/>
                      <span style={{ fontSize: 9, color: c.color, fontWeight: 700 }}>{c.short}</span>
                    </div>
                    <span style={{ fontSize: 13, textAlign: 'center' }}>{r.icon}</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600,
                        whiteSpace: 'nowrap' }}>{r.title}</span>
                      <span style={{ fontSize: 11, color: '#888',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        · {r.detail}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: urgent ? '#c04a24' : '#999',
                      fontWeight: urgent ? 700 : 500 }}>{r.when}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      <V4Preview course="ml"/>
    </div>
  </div>
);

Object.assign(window, { HomeCalSide, HomeDayFocus, HomeInboxCal });
