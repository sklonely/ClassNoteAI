// V4 · 6 hybrid directions — calendar backbone + course cards + preview pattern

// ═══════════════════════════════════════════════════════════════════
// H13 · CALENDAR + COURSE CARDS BELOW
// 上半：本週行事曆（主角） · 下半：6 張課程卡（Spotify 風）+ 一個 AI/提醒欄
// 最直覺：時間 → 課程 → 動作
// ═══════════════════════════════════════════════════════════════════
const HomeCalCards = () => (
  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#fafaf7', fontFamily: '"Inter", "Noto Sans TC", sans-serif',
    color: '#111', overflow: 'hidden', position: 'relative' }}>
    <V3Island/>
    <V4TopBar label="春季第 9 週 · 04/21–04/27"/>
    <div style={{ flex: 1, display: 'grid', gridTemplateRows: '1.15fr 1fr', gap: 14,
      padding: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>本週行事曆</div>
          <div style={{ fontSize: 11, color: '#888' }}>7 堂課 · 下一堂 1h 52m 後</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button style={{ ...v4Btn(), fontSize: 11 }}>◀</button>
            <button style={{ ...v4Btn(true), fontSize: 11 }}>本週</button>
            <button style={{ ...v4Btn(), fontSize: 11 }}>▶</button>
            <button style={{ ...v4Btn(), fontSize: 11 }}>月</button>
          </div>
        </div>
        <V4Calendar compact/>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: 14, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>我的課程</div>
            <div style={{ fontSize: 11, color: '#888' }}>6 個 · 依下次上課排序</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
            overflow: 'auto' }}>
            {V3_COURSES.map(c => <V4CourseCard key={c.id} c={c} selected={c.id === 'ml'}/>)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>提醒 · {V3_REMINDERS.length}</div>
          <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {V3_REMINDERS.slice(0, 8).map(r => {
              const c = v3GetCourse(r.course);
              const urgent = r.urgency === 'high';
              return (
                <div key={r.id} style={{ padding: '7px 9px', background: '#fff',
                  borderRadius: 7, border: '1px solid #ece8dd',
                  borderLeft: `3px solid ${urgent ? '#ff4b4b' : c.color}`,
                  display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 6,
                  alignItems: 'center', fontSize: 11, cursor: 'pointer' }}>
                  <span>{r.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                    <div style={{ fontSize: 9, color: '#888' }}>{c.short} · {r.detail}</div>
                  </div>
                  <span style={{ fontSize: 9, color: urgent ? '#c04a24' : '#888',
                    fontWeight: urgent ? 700 : 500 }}>{r.when}</span>
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
// H14 · HUB  (day timeline + selected-course preview + all-courses rail)
// 左：今日時間軸 · 中：選取的課程/作業詳情（就是截圖那個卡）· 右：6 張課程卡直排
// ═══════════════════════════════════════════════════════════════════
const HomeHub = () => {
  const now = 17 * 60 + 8;
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: '#fafaf7', fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      color: '#111', overflow: 'hidden', position: 'relative' }}>
      <V3Island/>
      <V4TopBar label="04/21 週一 · 17:08"/>
      <div style={{ flex: 1, display: 'grid',
        gridTemplateColumns: '0.95fr 1.15fr 0.9fr', gap: 1,
        background: '#ece8dd', overflow: 'hidden' }}>
        {/* Day timeline */}
        <div style={{ background: '#fff', overflow: 'auto', padding: '16px 18px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#888', fontWeight: 700 }}>
            TODAY
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>
            週一 · 還有 1 堂
          </div>
          <div style={{ fontSize: 11, color: '#666' }}>3 堂課 · 下一堂 19:00 · 1h 52m 後</div>
          <div style={{ position: 'relative', marginTop: 14, paddingLeft: 50 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 40,
              borderRight: '1px dashed #e5e2db' }}>
              {['09','10','11','12','13','14','15','16','17','18','19','20'].map(h => (
                <div key={h} style={{ height: 40, fontSize: 10, color: '#aaa',
                  fontFamily: 'JetBrains Mono', textAlign: 'right', paddingRight: 8 }}>{h}</div>
              ))}
            </div>
            <div style={{ position: 'absolute', left: 40, right: 0,
              top: (now - 9*60) / 60 * 40, height: 0,
              borderTop: '2px solid #ff4b4b', zIndex: 3 }}>
              <span style={{ position: 'absolute', left: -42, top: -8, fontSize: 9,
                color: '#ff4b4b', fontWeight: 700, fontFamily: 'JetBrains Mono',
                background: '#fff', padding: '1px 4px' }}>NOW</span>
            </div>
            {V3_TODAY.map((b, i) => {
              const c = v3GetCourse(b.course);
              const [h, m] = b.t.split(':').map(Number);
              const top = (h*60 + m - 9*60) / 60 * 40;
              const height = b.dur / 60 * 40 - 4;
              const isNext = b.status === 'next';
              return (
                <div key={i} style={{
                  position: 'absolute', left: 0, right: 6, top, height,
                  background: isNext ? c.color : c.accent, color: isNext ? '#fff' : '#222',
                  borderRadius: 7, padding: '6px 10px', fontSize: 12,
                  borderLeft: `3px solid ${c.color}`,
                  opacity: b.status === 'done' ? 0.6 : 1,
                  boxShadow: isNext ? `0 6px 18px ${c.color}60` : 'none',
                  display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{b.title}</div>
                  <div style={{ fontSize: 10, opacity: 0.85 }}>{b.t} · {b.room}</div>
                  {isNext && <div style={{ fontSize: 9, padding: '1px 5px',
                    background: 'rgba(255,255,255,0.22)', borderRadius: 3,
                    alignSelf: 'flex-start', marginTop: 'auto' }}>NEXT · 1h 52m</div>}
                  {b.status === 'done' && b.hasNotes &&
                    <div style={{ fontSize: 10, color: '#1f7a4f', marginTop: 'auto' }}>✓ 已有筆記</div>}
                </div>
              );
            })}
          </div>
        </div>
        {/* Preview pane (HW3 card) */}
        <div style={{ background: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <V4Preview course="ml"/>
        </div>
        {/* Course rail */}
        <div style={{ background: '#fafaf7', overflow: 'auto', padding: '16px 14px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#888', fontWeight: 700 }}>
            COURSES · 6
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2,
            marginBottom: 10 }}>我的課程</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {V3_COURSES.map(c => <V4CourseCard key={c.id} c={c} compact selected={c.id === 'ml'}/>)}
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// H15 · CARD + PREVIEW BELOW (master-detail)
// 上：6 張大課程卡橫排 · 中：選取課程的週行事曆（只顯示該課）
// 下：該課程的提醒 inbox（HW3 preview 右側）
// ═══════════════════════════════════════════════════════════════════
const HomeCardFocus = () => {
  const sel = 'ml';
  const c = v3GetCourse(sel);
  const rems = V3_REMINDERS.filter(r => r.course === sel);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: '#fafaf7', fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      color: '#111', overflow: 'hidden', position: 'relative' }}>
      <V3Island/>
      <V4TopBar label="春季 · 週一 04/21"/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 14, gap: 12,
        overflow: 'hidden' }}>
        {/* 6 course cards in a row */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>我的課程</div>
            <div style={{ fontSize: 11, color: '#888' }}>點擊查看 · 目前：機器學習</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
            {V3_COURSES.map(co => <V4CourseCard key={co.id} c={co} compact selected={co.id === sel}/>)}
          </div>
        </div>

        {/* Bottom split: focused course weekly timeline + its inbox */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 12,
          overflow: 'hidden', minHeight: 0 }}>
          {/* Focused course detail */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #ece8dd',
            padding: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            borderTop: `3px solid ${c.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9,
                background: `linear-gradient(135deg, ${c.color}, ${c.color}bb)`,
                color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                {c.short}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{c.title}</div>
                <div style={{ fontSize: 11, color: '#888' }}>
                  {c.instructor} · {c.lectures} lec · {v3Fmt(c.mins)} · 進度 {Math.round(c.progress*100)}%
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button style={v4Btn(true)}>● 錄今晚 L14</button>
                <button style={v4Btn()}>完整 syllabus</button>
              </div>
            </div>

            {/* lecture timeline for THIS course */}
            <div style={{ marginTop: 14, fontSize: 10, color: '#888', letterSpacing: '0.1em',
              fontWeight: 700 }}>LECTURES · {c.lectures} 場</div>
            <div style={{ marginTop: 6, position: 'relative', padding: '4px 4px 8px' }}>
              <div style={{ height: 4, background: '#efece4', borderRadius: 2, position: 'relative' }}>
                <div style={{ width: `${c.progress * 100}%`, height: '100%',
                  background: c.color, borderRadius: 2 }}/>
              </div>
              <div style={{ position: 'relative', height: 28, marginTop: 4 }}>
                {Array.from({ length: c.lectures }).map((_, i) => {
                  const isNext = i === c.nextLec.n - 1;
                  const done = i < c.nextLec.n - 1;
                  return (
                    <div key={i} style={{ position: 'absolute',
                      left: `${(i / (c.lectures - 1)) * 100}%`, transform: 'translateX(-50%)',
                      width: 22, height: 22, borderRadius: 11,
                      background: isNext ? c.color : done ? c.accent : '#fff',
                      border: `1.5px solid ${done || isNext ? c.color : '#ddd'}`,
                      display: 'grid', placeItems: 'center',
                      fontSize: 10, color: isNext ? '#fff' : done ? c.color : '#aaa',
                      fontWeight: 700, cursor: 'pointer',
                      boxShadow: isNext ? `0 0 0 4px ${c.color}33` : 'none' }}>
                      {i + 1}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* next lecture big callout */}
            <div style={{ marginTop: 10, padding: 12, borderRadius: 8,
              background: c.accent, border: `1px dashed ${c.color}66`,
              display: 'flex', alignItems: 'center', gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: c.color, fontWeight: 700, letterSpacing: '0.1em' }}>
                  下一堂 · 1h 52m 後
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>
                  L{c.nextLec.n} · {c.nextLec.title}
                </div>
                <div style={{ fontSize: 11, color: '#666' }}>
                  {c.nextLec.when} · {c.room}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>
                ← 昨天 L{c.lastLec.n} · {c.lastLec.title} · {c.lastLec.dur}m
              </div>
            </div>

            {/* keywords */}
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {c.keywords.map(k => (
                <span key={k} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 999,
                  background: '#f6f4ee', color: '#555' }}>#{k}</span>
              ))}
            </div>
          </div>

          {/* inbox for this course (HW3-card style) */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #ece8dd',
            overflow: 'hidden' }}>
            <V4Preview course={sel}/>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { HomeCalCards, HomeHub, HomeCardFocus });
