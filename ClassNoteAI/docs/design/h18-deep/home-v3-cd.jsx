// ═══════════════════════════════════════════════════════════════════
// H9 · SPLIT INBOX (Superhuman / Things-style)
// Left: 單欄課程 sidebar · Center: 依時間/緊急度排序的動態串流（Inbox）
// Right: 選取項目的 preview（實際 UI 會是卡片詳情）
// 目標：把 app 當成「課程 Inbox」用，批次處理。
// ═══════════════════════════════════════════════════════════════════
const HomeSplitInbox = () => {
  const groups = [
    { label: '今天到期', items: V3_REMINDERS.filter(r => r.urgency === 'high' || r.when === '今天') },
    { label: '本週',     items: V3_REMINDERS.filter(r => !(r.urgency === 'high' || r.when === '今天') && !r.when.includes('週')).slice(0, 5) },
    { label: '老師說過', items: V3_REMINDERS.filter(r => r.type === 'say') },
    { label: '已完成',   items: [
      { id: 'rx1', course: 'stat', type: 'grade', icon: '🎯', title: 'Quiz 4 · 9/10', when: '昨天' },
      { id: 'rx2', course: 'alg',  type: 'hw',    icon: '✓',  title: 'HW3 已繳交',     when: '3 天前' },
    ]},
  ];

  return (
    <div style={h9S.root}>
      <V3Island/>

      {/* Sidebar */}
      <div style={h9S.side}>
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '1px solid #eee' }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: '#111', color: '#fff',
            display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>C</div>
          <span style={{ fontSize: 13, fontWeight: 700 }}>ClassNote</span>
        </div>

        <div style={{ padding: 10 }}>
          <div style={h9S.sideItem('active')}>
            <span>⌂</span><span style={{ flex: 1 }}>Inbox</span><span style={{ fontSize: 11, color: '#888' }}>14</span>
          </div>
          <div style={h9S.sideItem()}><span>◎</span><span>Today</span><span style={{ fontSize: 11, color: '#888' }}>3</span></div>
          <div style={h9S.sideItem()}><span>⚑</span><span>作業</span><span style={{ fontSize: 11, color: '#c04a24' }}>4</span></div>
          <div style={h9S.sideItem()}><span>💬</span><span>老師說過</span><span style={{ fontSize: 11, color: '#888' }}>3</span></div>
          <div style={h9S.sideItem()}><span>✓</span><span>已完成</span></div>
          <div style={h9S.sideItem()}><span>📅</span><span>行事曆</span></div>
        </div>

        <div style={{ padding: '4px 14px', fontSize: 10, color: '#aaa', letterSpacing: '0.12em',
          fontWeight: 700, marginTop: 6 }}>課程</div>
        <div style={{ padding: '2px 10px', overflow: 'auto' }}>
          {V3_COURSES.map(c => (
            <div key={c.id} style={h9S.sideItem()}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }}/>
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.title}
              </span>
              {c.unreviewed > 0 && (
                <span style={{ fontSize: 11, color: '#888' }}>{c.unreviewed}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Inbox */}
      <div style={h9S.inbox}>
        <div style={h9S.inboxHead}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Inbox</div>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', fontSize: 12, color: '#666' }}>
            {['全部', '作業', '公告', '老師說過', '成績'].map((t, i) => (
              <span key={i} style={{ padding: '4px 10px', borderRadius: 999,
                background: i === 0 ? '#111' : 'transparent', color: i === 0 ? '#fff' : '#666',
                fontWeight: i === 0 ? 600 : 500, cursor: 'pointer' }}>{t}</span>
            ))}
          </div>
          <button style={{ marginLeft: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600,
            border: 'none', borderRadius: 999, background: '#ff4b4b', color: '#fff',
            cursor: 'pointer', fontFamily: 'inherit' }}>● 錄音</button>
        </div>

        <div style={{ overflow: 'auto', flex: 1 }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', fontWeight: 700,
                color: '#aaa', padding: '16px 20px 6px', textTransform: 'uppercase' }}>
                {g.label} · {g.items.length}
              </div>
              {g.items.map(r => {
                const c = v3GetCourse(r.course);
                const urgent = r.urgency === 'high';
                const selected = r.id === 'r01';
                return (
                  <div key={r.id} style={{
                    display: 'grid', gridTemplateColumns: '90px 24px 1fr auto', gap: 10,
                    alignItems: 'center',
                    padding: '10px 20px',
                    background: selected ? '#fff8e1' : 'transparent',
                    borderLeft: selected ? '3px solid #f5a462' : '3px solid transparent',
                    cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: c.color }}/>
                      <span style={{ fontSize: 10, color: c.color, fontWeight: 700 }}>{c.short}</span>
                    </div>
                    <div style={{ fontSize: 14, textAlign: 'center' }}>{r.icon}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#111',
                        whiteSpace: 'nowrap' }}>{r.title}</span>
                      <span style={{ fontSize: 12, color: '#888',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        · {r.detail}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: urgent ? '#c04a24' : '#999',
                      fontWeight: urgent ? 700 : 500, whiteSpace: 'nowrap' }}>
                      {r.when}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Preview pane */}
      <div style={h9S.preview}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #eee',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: '#3451b2', fontWeight: 700, letterSpacing: '0.05em',
            padding: '2px 8px', background: '#e8ecff', borderRadius: 4 }}>機器學習</span>
          <span style={{ fontSize: 12, color: '#888' }}>📝 作業 · 高優先</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, color: '#aaa', fontSize: 12 }}>
            <span>⤺</span><span>⤻</span><span>⋯</span>
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            HW3 · Transformer 實作
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            截止 週日 23:59 · 3 天後 · 李宏毅 · NTU COOL
          </div>

          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: '#faf8f3',
            fontSize: 12, color: '#444', lineHeight: 1.6 }}>
            實作一個簡化版的 Transformer encoder，包含 multi-head attention 與 positional
            encoding。Jupyter 檔案繳交，需附訓練 loss 曲線。
          </div>

          <div style={{ marginTop: 16, fontSize: 10, color: '#aaa', letterSpacing: '0.1em',
            fontWeight: 700 }}>相關筆記 · 3</div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { t: 'L13 · Attention 機制',       m: '昨天 · 52 min'  },
              { t: 'L12 · Self-Attention 推導',  m: '3 天前 · 50 min' },
              { t: 'L11 · 為什麼需要 attention', m: '1 週前 · 48 min' },
            ].map((n, i) => (
              <div key={i} style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid #eee',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: '#3451b2' }}>📖</span>
                <span style={{ flex: 1 }}>{n.t}</span>
                <span style={{ color: '#aaa', fontSize: 11 }}>{n.m}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, padding: 12, borderRadius: 8,
            background: 'linear-gradient(135deg, #1a1a1a, #333)', color: '#fff' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#888', fontWeight: 700 }}>
              AI 摘要 · 從 L11–13 整理
            </div>
            <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
              你需要的 concepts 都在 L13 · 38:14 之後。老師有提到 scaling factor 的細節，
              可能會考。準備好 Q/K/V 的矩陣形狀。
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 6 }}>
            <button style={{ ...h9S.btn, background: '#111', color: '#fff' }}>開始做</button>
            <button style={h9S.btn}>延後 1 天</button>
            <button style={h9S.btn}>標記完成</button>
          </div>
        </div>

        <div style={{ marginTop: 'auto', padding: '10px 14px', borderTop: '1px solid #eee',
          fontSize: 10, color: '#aaa', letterSpacing: '0.08em',
          display: 'flex', gap: 14, fontFamily: 'JetBrains Mono, monospace' }}>
          <span><b style={{ color: '#111' }}>J/K</b> 上下</span>
          <span><b style={{ color: '#111' }}>E</b> 完成</span>
          <span><b style={{ color: '#111' }}>H</b> 延後</span>
          <span><b style={{ color: '#111' }}>⌘/</b> 問 AI</span>
        </div>
      </div>
    </div>
  );
};

const h9S = {
  root: { width: '100%', height: '100%', display: 'grid',
    gridTemplateColumns: '220px 1fr 400px', background: '#fff',
    fontFamily: '"Inter", "Noto Sans TC", sans-serif', color: '#111',
    overflow: 'hidden', position: 'relative' },
  side: { background: '#f7f5ef', borderRight: '1px solid #ece8dd', display: 'flex', flexDirection: 'column' },
  sideItem: (state) => ({ display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 10px', borderRadius: 6, fontSize: 13,
    color: state === 'active' ? '#111' : '#555',
    background: state === 'active' ? '#fff' : 'transparent',
    fontWeight: state === 'active' ? 600 : 500,
    boxShadow: state === 'active' ? '0 1px 0 rgba(0,0,0,0.03)' : 'none',
    cursor: 'pointer' }),
  inbox: { display: 'flex', flexDirection: 'column', overflow: 'hidden',
    borderRight: '1px solid #eee' },
  inboxHead: { padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12,
    borderBottom: '1px solid #eee' },
  preview: { display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'auto' },
  btn: { padding: '6px 12px', fontSize: 12, fontWeight: 500, border: '1px solid #ddd',
    borderRadius: 6, background: '#fff', color: '#333', cursor: 'pointer', fontFamily: 'inherit' },
};

// ═══════════════════════════════════════════════════════════════════
// H10 · KANBAN  (Trello/Linear-style 三欄)
// 今日 | 本週 | 已完成  — items 是作業、小考、錄音任務、複習提醒
// 每張卡片 = 一個動作 (action-oriented)
// 頂部是 6 個課程 chip (切換濾鏡)
// ═══════════════════════════════════════════════════════════════════
const HomeKanban = () => {
  const cols = [
    { id: 'today',   label: '今天', color: '#ff4b4b',
      items: [
        { icon: '📝', course: 'lin',  title: 'HW2 · SVD 計算', sub: '截止 23:59', tag: '作業' },
        { icon: '🎥', course: 'ml',   title: '今晚 L14 錄音',   sub: '19:00 · 電二 103', tag: '上課' },
        { icon: '✦',  course: 'ml',   title: '複習 L13 未標記段', sub: 'AI 建議', tag: '複習' },
      ] },
    { id: 'week',    label: '本週', color: '#f5a462',
      items: [
        { icon: '✎',  course: 'ds',   title: '隨堂小考 · paging', sub: '下週一 · L12', tag: '小考' },
        { icon: '📝', course: 'cmp',  title: 'Lab 2 · 寫一個 lexer', sub: '截止 週六', tag: '作業' },
        { icon: '🎥', course: 'cmp',  title: '明天 L7 錄音',       sub: '週三 16:00', tag: '上課' },
        { icon: '📝', course: 'ml',   title: 'HW3 · Transformer', sub: '截止 週日', tag: '作業' },
        { icon: '🎥', course: 'stat', title: '週五 L13 錄音',      sub: '10:00 · 新數 203', tag: '上課' },
      ] },
    { id: 'later',   label: '之後', color: '#888',
      items: [
        { icon: '📝', course: 'alg',  title: 'HW4 · DP 練習', sub: '截止 下週三', tag: '作業' },
        { icon: '🎥', course: 'ds',   title: '下週 L12 錄音',   sub: '下週一', tag: '上課' },
        { icon: '🎥', course: 'lin',  title: '下週 L9 · SVD',   sub: '下週二', tag: '上課' },
      ] },
    { id: 'done',    label: '已完成', color: '#1f7a4f',
      items: [
        { icon: '🎯', course: 'alg',  title: 'Midterm · 87/100', sub: '今早', tag: '成績', done: true },
        { icon: '🎯', course: 'stat', title: 'Quiz 4 · 9/10',   sub: '昨天', tag: '成績', done: true },
        { icon: '✓',  course: 'ml',   title: 'HW2 繳交',         sub: '上週', tag: '作業', done: true },
      ] },
  ];

  return (
    <div style={h10S.root}>
      <V3Island/>

      {/* Topbar */}
      <div style={h10S.top}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: '#111', color: '#fff',
            display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700 }}>C</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>ClassNote</div>
          <div style={{ fontSize: 11, color: '#999', padding: '3px 8px',
            background: '#f6f4ee', borderRadius: 4 }}>04/21 週一 · 春季第 9 週</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#aaa' }}>⌕ 搜尋 · ⌘K</span>
          <button style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none',
            borderRadius: 999, background: '#ff4b4b', color: '#fff', cursor: 'pointer',
            fontFamily: 'inherit' }}>● 錄音</button>
        </div>
      </div>

      {/* Course filter chips */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 20px', borderBottom: '1px solid #eee',
        alignItems: 'center', overflow: 'auto' }}>
        <span style={{ fontSize: 11, color: '#888', marginRight: 4, fontWeight: 600 }}>篩選：</span>
        <span style={h10S.chipActive}>全部 · 6</span>
        {V3_COURSES.map(c => (
          <span key={c.id} style={h10S.chip(c.color)}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: c.color,
              display: 'inline-block', marginRight: 5 }}/>
            {c.title}
            {c.unreviewed > 0 && (
              <span style={{ marginLeft: 5, fontSize: 10, color: '#c04a24' }}>{c.unreviewed}</span>
            )}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>
          依緊急度 / 時間 ▾
        </span>
      </div>

      {/* Kanban columns */}
      <div style={h10S.board}>
        {cols.map(col => (
          <div key={col.id} style={h10S.col}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 8px' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: col.color }}/>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>{col.label}</span>
              <span style={{ fontSize: 11, color: '#888' }}>· {col.items.length}</span>
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#bbb', cursor: 'pointer' }}>＋</span>
            </div>
            <div style={{ padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 6,
              overflow: 'auto', flex: 1 }}>
              {col.items.map((it, i) => {
                const c = v3GetCourse(it.course);
                return (
                  <div key={i} style={{
                    background: '#fff', borderRadius: 8,
                    border: '1px solid #ece8dd',
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    opacity: it.done ? 0.6 : 1,
                    position: 'relative',
                    cursor: 'grab' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                      background: c.color, borderRadius: '8px 0 0 8px' }}/>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: c.color, fontWeight: 700,
                        letterSpacing: '0.06em', padding: '1px 5px', background: c.accent,
                        borderRadius: 3 }}>{c.short}</span>
                      <span style={{ fontSize: 10, color: '#888' }}>· {it.tag}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 14 }}>{it.icon}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#111', fontWeight: 600, letterSpacing: '-0.01em',
                      textDecoration: it.done ? 'line-through' : 'none', lineHeight: 1.3 }}>
                      {it.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{it.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const h10S = {
  root: { width: '100%', height: '100%', background: '#fafaf7', color: '#111',
    fontFamily: '"Inter", "Noto Sans TC", sans-serif', overflow: 'hidden',
    display: 'flex', flexDirection: 'column', position: 'relative' },
  top: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', borderBottom: '1px solid #eee', background: '#fff' },
  chip: (color) => ({ padding: '5px 10px', borderRadius: 999, background: '#fff',
    border: '1px solid #ece8dd', fontSize: 11, fontWeight: 500, color: '#333',
    cursor: 'pointer', whiteSpace: 'nowrap' }),
  chipActive: { padding: '5px 10px', borderRadius: 999, background: '#111',
    border: '1px solid #111', fontSize: 11, fontWeight: 600, color: '#fff',
    cursor: 'pointer', whiteSpace: 'nowrap' },
  board: { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
    padding: 16, overflow: 'hidden' },
  col: { background: '#f1eee5', borderRadius: 12, display: 'flex', flexDirection: 'column',
    overflow: 'hidden', border: '1px solid #e8e3d6' },
};

Object.assign(window, { HomeSplitInbox, HomeKanban });
