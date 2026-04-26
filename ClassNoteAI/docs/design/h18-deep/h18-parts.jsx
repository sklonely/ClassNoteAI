// H18 Deep · Themed building blocks
// All parts read from a theme object. No hard-coded colors except through props/theme.

// Window controls — macOS-style traffic lights ───────────────────
// 紅 = 關閉，黃 = 最小化，綠 = 最大化。Hover 時露出小圖示。
// 顏色沿用設計既有 vocabulary（紅 #e8412e 同錄音鈕、黃 #f6b24e 同浮動視窗
// max 鈕、綠 #22c55e 同 setup wizard success），不另引入 macOS 原生色。
//
// 在真實 Tauri 實作上，三個 callback 應分別呼叫：
//   onClose    → appWindow.close()       （macOS 上通常 hide 不 quit）
//   onMinimize → appWindow.minimize()
//   onMaximize → appWindow.toggleMaximize()
// 並把外層 div 加上 data-tauri-drag-region 讓使用者可拖移視窗。
const H18WindowControls = ({ theme: T, onClose, onMinimize, onMaximize }) => {
  const [hover, setHover] = React.useState(false);

  const Btn = ({ color, ink, label, onClick, glyph }) => (
    <button onClick={onClick} title={label} aria-label={label} style={{
      width: 12, height: 12, borderRadius: 6, padding: 0,
      background: color, border: 'none', cursor: 'pointer',
      display: 'grid', placeItems: 'center', flexShrink: 0,
      boxShadow: T.mode === 'dark'
        ? 'inset 0 0 0 0.5px rgba(0,0,0,0.4)'
        : 'inset 0 0 0 0.5px rgba(0,0,0,0.18)',
      transition: 'transform 80ms',
    }}>
      {hover && (
        <svg width="8" height="8" viewBox="0 0 8 8"
          style={{ display: 'block', pointerEvents: 'none' }}
          stroke={ink} strokeWidth="1.2" strokeLinecap="round"
          strokeLinejoin="round" fill="none">
          {glyph}
        </svg>
      )}
    </button>
  );

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0, paddingRight: 4 }}>
      <Btn color="#e8412e" ink="#5a1607" label="關閉視窗"
        onClick={onClose} glyph={<><path d="M2 2 L6 6"/><path d="M6 2 L2 6"/></>}/>
      <Btn color="#f6b24e" ink="#7a4f0c" label="最小化"
        onClick={onMinimize} glyph={<path d="M1.5 4 L6.5 4"/>}/>
      <Btn color="#22c55e" ink="#0c4a1a" label="最大化"
        onClick={onMaximize} glyph={<path d="M2 2 L6 2 L6 6 L2 6 Z"/>}/>
    </div>
  );
};

// Top bar ─────────────────────────────────────────────────────────
const H18TopBar = ({ theme: T, inboxCount = 14, dense, onOpenSearch,
  onWinClose, onWinMin, onWinMax }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: dense ? '8px 14px' : '10px 16px', borderBottom: `1px solid ${T.border}`,
    height: dense ? 40 : 46, boxSizing: 'border-box',
    background: T.topbar, flexShrink: 0,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <H18WindowControls theme={T}
        onClose={onWinClose} onMinimize={onWinMin} onMaximize={onWinMax}/>
      <div style={{ width: 1, height: 14, background: T.border, margin: '0 2px' }}/>
      <div style={{ width: 26, height: 26, borderRadius: 7, background: T.invert,
        color: T.invertInk, display: 'grid', placeItems: 'center',
        fontSize: 13, fontWeight: 800, letterSpacing: '-0.02em' }}>C</div>
      <span style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>
        ClassNote
      </span>
      <span style={{ fontSize: 11, color: T.textDim }}>Inbox · {inboxCount} 項</span>
      <div style={{ width: 1, height: 14, background: T.border, margin: '0 4px' }}/>
      <span style={{ fontSize: 11, color: T.textMid, fontFamily: 'JetBrains Mono' }}>
        2026·04·21 · 週一 17:08
      </span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* Search — subtle bar, the only place search lives */}
      <button onClick={onOpenSearch} title="搜尋 (⌘K)" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px 4px 8px', height: 28, minWidth: 220,
        borderRadius: 7, border: `1px solid ${T.border}`,
        background: T.surface2, color: T.textDim, cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 12,
      }}>
        <span style={{ fontSize: 13, opacity: 0.7 }}>⌕</span>
        <span style={{ flex: 1, textAlign: 'left' }}>搜尋筆記、課程、語音片段…</span>
        <span style={{ fontSize: 10, padding: '1px 5px',
          border: `1px solid ${T.border}`, borderRadius: 3,
          fontFamily: 'JetBrains Mono', color: T.textFaint }}>⌘K</span>
      </button>
      <button style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700,
        border: 'none', borderRadius: 999, background: '#e8412e', color: '#fff',
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: '#fff' }}/>
        錄音
      </button>
      {/* TaskIndicator — offline queue + 網路狀態 */}
      {window.H18TaskIndicator && <H18TaskIndicator theme={T}/>}
    </div>
  </div>
);

// Icon rail (left) ─────────────────────────────────────────────────
const H18Rail = ({ theme: T, activeNav = 'home', onNav }) => {
  const Item = ({ id, glyph, title, selected, children }) => (
    <div onClick={() => onNav?.(id)} title={title} style={{
      position: 'relative', width: 40, height: 40, borderRadius: 10,
      display: 'grid', placeItems: 'center', cursor: 'pointer',
      color: selected ? T.invertInk : T.textMid,
      background: selected ? T.invert : 'transparent',
      border: `1px solid ${selected ? 'transparent' : T.borderSoft}`,
      fontSize: 15, transition: 'all 120ms',
    }}>{children ?? glyph}</div>
  );
  return (
    <div style={{ background: T.rail, display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '12px 0', gap: 8, overflow: 'auto',
      borderRight: `1px solid ${T.border}` }}>
      <Item id="home"   glyph="⌂" title="首頁"     selected={activeNav === 'home'}/>
      <Item id="notes"  glyph="▤" title="知識庫"   selected={activeNav === 'notes'}/>
      <div style={{ width: '60%', height: 1, background: T.border, margin: '4px 0' }}/>
      {V3_COURSES.map(c => {
        const isSel = activeNav === `course:${c.id}`;
        return (
          <div key={c.id} onClick={() => onNav?.(`course:${c.id}`)}
            title={c.title}
            style={{ position: 'relative', width: 40, height: 40, borderRadius: 10,
              background: `linear-gradient(135deg, ${c.color}, ${c.color}c8)`, color: '#fff',
              display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800,
              letterSpacing: '-0.01em', cursor: 'pointer',
              boxShadow: isSel ? `0 0 0 2.5px ${T.rail}, 0 0 0 4.5px ${c.color}` : 'none',
              transition: 'box-shadow 120ms' }}>
            {c.short.length > 3 ? c.short.slice(0, 3) : c.short}
            {c.unreviewed > 0 && (
              <div style={{ position: 'absolute', top: -3, right: -3, fontSize: 9,
                padding: '1px 5px', borderRadius: 999, background: T.dot, color: '#fff',
                fontWeight: 800, border: `1.5px solid ${T.rail}` }}>{c.unreviewed}</div>
            )}
          </div>
        );
      })}
      <div onClick={() => onNav?.('add')} title="新增課程" style={{
        width: 40, height: 40, borderRadius: 10,
        border: `1.5px dashed ${activeNav === 'add' ? T.accent : T.border}`,
        display: 'grid', placeItems: 'center',
        color: activeNav === 'add' ? T.accent : T.textFaint,
        fontSize: 20, cursor: 'pointer' }}>＋</div>
      <div style={{ flex: 1 }}/>
      <Item id="ai" glyph="✦" title="AI 助教" selected={activeNav === 'ai'}/>
      <div onClick={() => onNav?.('profile')} title="Hank · 個人頁" style={{
        width: 32, height: 32, borderRadius: 16, marginTop: 4,
        background: '#c48a2c', color: '#fff',
        display: 'grid', placeItems: 'center',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
        boxShadow: activeNav === 'profile'
          ? `0 0 0 2.5px ${T.rail}, 0 0 0 4.5px #c48a2c` : 'none' }}>H</div>
    </div>
  );
};

// Mini calendar — themed ──────────────────────────────────────────
const H18Calendar = ({ theme: T, compact, onlyToday, onNav }) => {
  const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const days  = ['一', '二', '三', '四', '五', '六', '日'];
  const dates = [21, 22, 23, 24, 25, 26, 27];
  const rowH = compact ? 22 : 30;
  return (
    <div style={{ display: 'grid',
      gridTemplateColumns: `36px repeat(${onlyToday ? 1 : 7}, 1fr)`,
      flex: 1, overflow: 'hidden', minHeight: 0,
      border: `1px solid ${T.border}`, borderRadius: 6,
      background: T.surface, fontFeatureSettings: '"tnum"' }}>
      <div style={{ borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`,
        background: T.surface2 }}/>
      {(onlyToday ? ['一'] : days).map((d, i) => {
        const isToday = d === '一';
        return (
          <div key={d} style={{ padding: '5px 7px',
            borderRight: `1px solid ${T.border}`,
            borderBottom: `1px solid ${T.border}`,
            background: isToday ? T.todayBg : T.surface2,
            fontSize: 9, fontWeight: 600, color: T.textDim,
            display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span>週{d}</span>
            <span style={{ fontSize: 13, color: isToday ? T.todayText : T.text,
              fontWeight: 700, fontFamily: 'JetBrains Mono' }}>
              {dates[days.indexOf(d)]}
            </span>
            {isToday && (
              <span style={{ fontSize: 8, padding: '1px 5px', background: T.dot, color: '#fff',
                borderRadius: 999, marginLeft: 'auto', fontWeight: 700, letterSpacing: '0.06em' }}>TODAY</span>
            )}
          </div>
        );
      })}
      <div style={{ gridColumn: '1 / -1', display: 'grid',
        gridTemplateColumns: 'subgrid', overflow: 'auto', position: 'relative' }}>
        <div style={{ borderRight: `1px solid ${T.border}`, background: T.surface }}>
          {hours.map(h => (
            <div key={h} style={{ height: rowH, fontSize: 9, color: T.textFaint,
              textAlign: 'right', paddingRight: 5, paddingTop: 2,
              fontFamily: 'JetBrains Mono',
              borderBottom: `1px dashed ${T.gridLineSoft}` }}>
              {h}
            </div>
          ))}
        </div>
        {(onlyToday ? ['一'] : days).map(d => {
          const evs = V4_WEEK[d] || [];
          const isToday = d === '一';
          return (
            <div key={d} style={{ borderRight: `1px solid ${T.border}`, position: 'relative',
              background: isToday ? T.todayBg : 'transparent' }}>
              {hours.map(h => <div key={h} style={{ height: rowH,
                borderBottom: `1px dashed ${T.gridLineSoft}` }}/>)}
              {isToday && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: (17.13 - 9) * rowH,
                  height: 0, borderTop: `2px solid ${T.accent}`, zIndex: 3 }}>
                  <span style={{ position: 'absolute', left: 2, top: -4, width: 6, height: 6,
                    borderRadius: 3, background: T.accent,
                    boxShadow: `0 0 0 3px ${T.accent}33` }}/>
                  <span style={{ position: 'absolute', right: 3, top: -11,
                    fontSize: 8, color: T.accent, fontFamily: 'JetBrains Mono',
                    fontWeight: 700, letterSpacing: '0.06em',
                    background: T.surface, padding: '0 3px' }}>17:08</span>
                </div>
              )}
              {evs.map((e, i) => {
                const c = v3GetCourse(e.c);
                const isNext = e.next;
                return (
                  <div key={i}
                    onClick={(ev) => { ev.stopPropagation(); onNav?.(`course:${e.c}`); }}
                    title={`${c.title} · L${c.nextLec.n}`}
                    style={{
                    position: 'absolute', left: 3, right: 3,
                    top: (e.t - 9) * rowH, height: e.dur * rowH - 2,
                    background: isNext ? c.color : h18Accent(c, T),
                    color: isNext ? '#fff' : h18CourseText(c, T),
                    opacity: e.done ? 0.45 : 1,
                    borderRadius: 4, padding: '3px 6px', fontSize: 9,
                    borderLeft: `3px solid ${c.color}`,
                    display: 'flex', flexDirection: 'column', gap: 1,
                    boxShadow: isNext ? `0 4px 12px ${c.color}70` : 'none',
                    cursor: 'pointer', overflow: 'hidden' }}>
                    <div style={{ fontWeight: 700, letterSpacing: '-0.01em',
                      textDecoration: e.done ? 'line-through' : 'none' }}>
                      {c.title}
                    </div>
                    <div style={{ fontSize: 8, opacity: 0.85 }}>L{c.nextLec.n} · {c.room}</div>
                    {isNext && (
                      <div style={{ fontSize: 7, background: 'rgba(255,255,255,0.22)',
                        padding: '0 4px', borderRadius: 2, alignSelf: 'flex-start',
                        marginTop: 'auto', fontFamily: 'JetBrains Mono',
                        letterSpacing: '0.06em', fontWeight: 700 }}>NEXT · 1h 52m</div>
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
};

Object.assign(window, { H18TopBar, H18Rail, H18Calendar, H18WindowControls });

// ─── Unified breadcrumb for Course / Recording / Review / Notes ──
// Shape:  [← back] [COURSE_PILL] › L## · Subject Title  (trailing: children)
// `kind`: 'course' | 'recording' | 'review' | 'notes' | 'other'
// When `kind === 'course'` the trailing arrow + lecture part is dropped
//   and the course title fills the row.
const H18Breadcrumb = ({ theme: T, course, lectureN, lectureTitle,
  kind = 'review', onBack, backLabel, backTone = 'light',
  extraPills = [], children, liveTag, compact }) => {

  const ct = window.h18CourseText ? window.h18CourseText(course, T) : course.color;
  const accentBg = window.h18Accent ? window.h18Accent(course, T) : `${course.color}22`;

  const kindLabel = {
    recording: '錄音中',
    review: '複習',
    notes: '筆記',
    course: null,
    other: null,
  }[kind];

  const backBtn = onBack && (
    <button onClick={onBack} style={{
      padding: compact ? '4px 10px' : '5px 12px',
      fontSize: 11, fontWeight: 600,
      background: backTone === 'dark' ? 'rgba(0,0,0,0.22)' : 'transparent',
      color: backTone === 'dark' ? '#fff' : T.textMid,
      border: backTone === 'dark'
        ? '1px solid rgba(255,255,255,0.22)'
        : `1px solid ${T.border}`,
      borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>← {backLabel || '返回'}</button>
  );

  // Course pill — color-coded, clickable if onBack
  const coursePill = (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px',
      background: backTone === 'dark' ? 'rgba(255,255,255,0.16)' : accentBg,
      borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 3,
        background: backTone === 'dark' ? '#fff' : course.color,
      }}/>
      <span style={{
        fontSize: 10, letterSpacing: '0.14em', fontWeight: 800,
        fontFamily: 'JetBrains Mono',
        color: backTone === 'dark' ? '#fff' : ct,
      }}>
        {course.short}
      </span>
    </div>
  );

  const sep = (
    <span style={{
      fontSize: 13, color: backTone === 'dark' ? 'rgba(255,255,255,0.45)' : T.textFaint,
      fontFamily: 'JetBrains Mono', flexShrink: 0, userSelect: 'none',
    }}>›</span>
  );

  const lecturePart = lectureN != null && (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8,
      minWidth: 0, flex: '1 1 auto' }}>
      <span style={{
        fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 700,
        color: backTone === 'dark' ? 'rgba(255,255,255,0.9)' : T.textMid,
        flexShrink: 0,
      }}>
        L{lectureN}
      </span>
      <span style={{
        fontSize: 10, color: backTone === 'dark' ? 'rgba(255,255,255,0.6)' : T.textFaint,
        flexShrink: 0,
      }}>·</span>
      <span style={{
        fontSize: compact ? 13 : 14, fontWeight: 700,
        color: backTone === 'dark' ? '#fff' : T.text,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        minWidth: 0,
      }}>
        {lectureTitle}
      </span>
    </div>
  );

  // Live tag (blinking red dot for recording)
  const live = liveTag && (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 7px',
      background: backTone === 'dark' ? 'rgba(232, 65, 46, 0.85)' : '#e8412e',
      color: '#fff', borderRadius: 3, fontSize: 9, fontWeight: 800,
      fontFamily: 'JetBrains Mono', letterSpacing: '0.12em', flexShrink: 0,
    }}>
      <style>{`@keyframes h18bcPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: '#fff',
        animation: 'h18bcPulse 1.4s ease-in-out infinite' }}/>
      {typeof liveTag === 'string' ? liveTag : 'LIVE'}
    </div>
  );

  const kindBadge = kindLabel && (
    <span style={{
      fontSize: 9, padding: '2px 7px',
      background: backTone === 'dark' ? 'rgba(255,255,255,0.18)' : T.surface2,
      color: backTone === 'dark' ? '#fff' : T.textDim,
      border: backTone === 'dark' ? '1px solid rgba(255,255,255,0.14)' : `1px solid ${T.border}`,
      borderRadius: 3, fontFamily: 'JetBrains Mono',
      fontWeight: 800, letterSpacing: '0.1em', flexShrink: 0,
    }}>{kindLabel}</span>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      flexWrap: 'nowrap', minWidth: 0,
    }}>
      {backBtn}
      {coursePill}
      {kind !== 'course' && <>
        {sep}
        {lecturePart}
      </>}
      {kind === 'course' && (
        <span style={{
          fontSize: compact ? 13 : 14, fontWeight: 700,
          color: backTone === 'dark' ? '#fff' : T.text,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          minWidth: 0, flex: '1 1 auto',
        }}>
          {course.title}
        </span>
      )}
      {live}
      {kindBadge}
      {extraPills}
      {children && <div style={{ display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0 }}>{children}</div>}
    </div>
  );
};

Object.assign(window, { H18Breadcrumb });
