// H18 Deep · Rail navigation pages (search / course detail / AI / add course / profile)

// Reusable modal shell ─────────────────────────────────────────────
const NavModal = ({ theme: T, onClose, width = 560, children, align = 'top' }) => (
  <div onClick={onClose} style={{
    position: 'absolute', inset: 0, zIndex: 500,
    background: T.mode === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(20,18,14,0.3)',
    backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
    display: 'grid',
    placeItems: align === 'top' ? 'start center' : 'center',
    paddingTop: align === 'top' ? 80 : 0,
  }}>
    <div onClick={e => e.stopPropagation()} style={{
      background: T.surface, color: T.text,
      border: `1px solid ${T.border}`, borderRadius: 12,
      boxShadow: T.shadow, width,
      fontFamily: 'Inter, "Noto Sans TC", sans-serif',
      overflow: 'hidden', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    }}>{children}</div>
  </div>
);

// 1. Command Palette ─────────────────────────────────────────────────
// Keyboard-first: ↑↓ navigate, Enter executes, Esc closes.
// Scopes results: recent (empty state) → fuzzy across courses / lectures /
// concepts / reminders / actions. Results grouped, flat index for nav.
const SearchOverlay = ({ theme: T, onClose, onNav, onStartRecording }) => {
  const [q, setQ] = React.useState('');
  const [sel, setSel] = React.useState(0);
  const listRef = React.useRef(null);

  // Build full index once ─────────────────────────────────────────
  const allItems = React.useMemo(() => {
    const items = [];

    // Courses
    V3_COURSES.forEach(c => items.push({
      kind: 'COURSE', group: '課程', color: c.color,
      label: c.title, sub: `${c.short} · ${c.instructor} · ${c.lectures} 堂`,
      keywords: `${c.title} ${c.short} ${c.instructor}`.toLowerCase(),
      exec: () => onNav(`course:${c.id}`),
    }));

    // Lectures (recent) — fake a few per course from nextLec
    const lectures = [
      { c: 'ml',  n: 13, title: 'Attention 機制 · Q/K/V',    when: '昨天 · 52m' },
      { c: 'ml',  n: 12, title: 'Self-Attention 推導',        when: '3 天前 · 50m' },
      { c: 'ml',  n: 11, title: '為什麼需要 attention',        when: '5 天前 · 48m' },
      { c: 'alg', n: 9,  title: 'Graph Algorithms',           when: '2 天前 · 55m' },
      { c: 'alg', n: 8,  title: 'Shortest Path',              when: '4 天前 · 50m' },
      { c: 'ds',  n: 11, title: 'Virtual Memory',             when: '5 天前 · 50m' },
      { c: 'ds',  n: 10, title: 'Deadlock',                   when: '1 週前 · 48m' },
      { c: 'lin', n: 12, title: 'Eigenvalues',                when: '昨天 · 50m' },
    ];
    lectures.forEach(l => {
      const c = v3GetCourse(l.c);
      if (!c) return;
      items.push({
        kind: 'NOTE', group: '筆記', color: c.color,
        label: `L${l.n} · ${l.title}`, sub: `${c.short} · ${l.when}`,
        keywords: `${l.title} L${l.n} ${c.short} ${c.title}`.toLowerCase(),
        exec: () => onNav(`review:${l.c}:${l.n}`),
      });
    });

    // Concepts (cross-lecture keywords)
    const concepts = [
      { k: 'Attention',            c: ['ml'],       count: 4 },
      { k: 'Transformer',          c: ['ml'],       count: 3 },
      { k: 'Gradient Descent',     c: ['ml'],       count: 5 },
      { k: 'Dijkstra',             c: ['alg'],      count: 2 },
      { k: 'Virtual Memory',       c: ['ds'],       count: 2 },
      { k: 'Eigenvalue',           c: ['lin', 'ml'], count: 3 },
      { k: 'Chain Rule',           c: ['ml'],        count: 6 },
    ];
    concepts.forEach(cc => {
      const shorts = cc.c.map(id => v3GetCourse(id)).filter(Boolean).map(c => c.short);
      if (!shorts.length) return;
      items.push({
        kind: 'CONCEPT', group: '概念', color: T.textMid,
        label: cc.k,
        sub: `${shorts.join(' · ')} · 出現 ${cc.count} 次`,
        keywords: cc.k.toLowerCase(),
        exec: () => onNav(`course:${cc.c[0]}`),
      });
    });

    // Reminders
    V3_REMINDERS.forEach(r => {
      const c = v3GetCourse(r.course);
      if (!c) return;
      items.push({
        kind: r.type === 'hw' ? 'HW' : r.type === 'exam' ? 'EXAM' : r.type.toUpperCase(),
        group: '作業 / 考試', color: c.color,
        label: r.title, sub: `${c.short} · ${r.when}`,
        keywords: `${r.title} ${c.short} ${c.title}`.toLowerCase(),
        exec: () => onNav(`course:${r.course}`),
      });
    });

    // Actions
    items.push({
      kind: 'ACTION', group: '動作', color: '#e8412e',
      label: '開始錄音', sub: '立即錄音當前課程',
      shortcut: '⌘R', keywords: '錄音 record start',
      exec: () => { onClose(); onStartRecording && onStartRecording(); },
    });
    items.push({
      kind: 'ACTION', group: '動作', color: T.textMid,
      label: '新增課程', sub: '從 PDF 大綱或空白開始',
      shortcut: '⌘N', keywords: '新增 課程 add course new',
      exec: () => onNav('add'),
    });
    items.push({
      kind: 'ACTION', group: '動作', color: T.textMid,
      label: '回到首頁', sub: '今日 / 這週 / 本學期',
      shortcut: '⌘H', keywords: 'home 首頁',
      exec: () => onNav('home'),
    });
    items.push({
      kind: 'ACTION', group: '動作', color: T.textMid,
      label: '開啟 AI 助教', sub: '全畫面對話',
      shortcut: '⌘J', keywords: 'ai 助教 assistant',
      exec: () => onNav('ai'),
    });
    items.push({
      kind: 'ACTION', group: '動作', color: T.textMid,
      label: '設定', sub: '介面 · 音訊 · 雲端 AI · 資料',
      shortcut: '⌘,', keywords: '設定 settings',
      exec: () => onNav('profile'),
    });

    return items;
  }, [T, onNav, onClose, onStartRecording]);

  // Filter ─────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    if (!q.trim()) {
      // Empty state: prioritize recent lectures + top actions
      return allItems.filter(it => it.kind === 'NOTE' || it.kind === 'ACTION').slice(0, 10);
    }
    const lq = q.toLowerCase();
    return allItems
      .map(it => {
        const i = it.keywords.indexOf(lq);
        if (i < 0) return null;
        // Lower score = better. Earlier match wins, exact label match wins more.
        const labelHit = it.label.toLowerCase().indexOf(lq);
        return { ...it, _score: (labelHit >= 0 ? 0 : 100) + i };
      })
      .filter(Boolean)
      .sort((a, b) => a._score - b._score)
      .slice(0, 20);
  }, [q, allItems]);

  // Group for display
  const grouped = React.useMemo(() => {
    const byGroup = {};
    filtered.forEach((it, flatIdx) => {
      (byGroup[it.group] = byGroup[it.group] || []).push({ ...it, flatIdx });
    });
    // Preserve group order by first-appearance
    const order = [];
    filtered.forEach(it => { if (!order.includes(it.group)) order.push(it.group); });
    return order.map(g => ({ group: g, items: byGroup[g] }));
  }, [filtered]);

  // Reset selection on query change
  React.useEffect(() => { setSel(0); }, [q]);

  // Scroll selected into view
  React.useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${sel}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  // Keyboard
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel(s => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[sel];
      if (it) it.exec();
    }
  };

  return (
    <NavModal theme={T} onClose={onClose} width={600}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 18, color: T.textDim }}>⌕</span>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="搜尋課程、筆記、概念、動作..."
          style={{ flex: 1, border: 'none', outline: 'none',
            background: 'transparent', color: T.text,
            fontSize: 16, fontFamily: 'inherit' }}/>
        <span style={{ fontSize: 10, color: T.textFaint,
          fontFamily: 'JetBrains Mono',
          padding: '2px 7px', border: `1px solid ${T.border}`,
          borderRadius: 4, letterSpacing: '0.1em' }}>ESC</span>
      </div>

      <div ref={listRef} style={{ overflow: 'auto', flex: 1, padding: '4px 0',
        minHeight: 240, maxHeight: 420 }}>
        {filtered.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center',
            color: T.textFaint, fontSize: 13 }}>
            找不到「{q}」的結果
            <div style={{ fontSize: 11, marginTop: 6 }}>
              試試「attention」、「期中考」或「錄音」
            </div>
          </div>
        )}
        {grouped.map((g, i) => (
          <div key={g.group}>
            <div style={{ padding: '10px 18px 4px', fontSize: 9,
              letterSpacing: '0.16em', color: T.textDim, fontWeight: 800,
              fontFamily: 'JetBrains Mono' }}>{g.group}</div>
            {g.items.map((it) => {
              const selected = it.flatIdx === sel;
              return (
                <div key={it.flatIdx} data-idx={it.flatIdx}
                  onMouseEnter={() => setSel(it.flatIdx)}
                  onClick={() => it.exec()}
                  style={{
                    margin: '0 6px', padding: '8px 12px',
                    display: 'grid',
                    gridTemplateColumns: '54px 1fr auto', gap: 12,
                    alignItems: 'center', cursor: 'pointer',
                    background: selected ? T.selBg : 'transparent',
                    borderRadius: 6,
                  }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                    color: it.color, fontFamily: 'JetBrains Mono',
                    padding: '2px 6px', background: selected ? T.surface : T.chipBg,
                    borderRadius: 3, textAlign: 'center' }}>{it.kind}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: T.text, fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      textOverflow: 'ellipsis' }}>{it.label}</div>
                    <div style={{ fontSize: 11, color: T.textDim, marginTop: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      textOverflow: 'ellipsis' }}>{it.sub}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {it.shortcut && (
                      <span style={{ fontSize: 10, color: T.textFaint,
                        fontFamily: 'JetBrains Mono',
                        padding: '1px 6px', border: `1px solid ${T.border}`,
                        borderRadius: 3 }}>{it.shortcut}</span>
                    )}
                    {selected && (
                      <span style={{ fontSize: 11, color: T.textMid,
                        fontFamily: 'JetBrains Mono' }}>↵</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ padding: '8px 18px', borderTop: `1px solid ${T.border}`,
        fontSize: 10, color: T.textFaint, display: 'flex', gap: 14,
        fontFamily: 'JetBrains Mono', background: T.surface2 }}>
        <span><b style={{ color: T.textMid }}>↑↓</b> 選擇</span>
        <span><b style={{ color: T.textMid }}>↵</b> 開啟</span>
        <span><b style={{ color: T.textMid }}>ESC</b> 關閉</span>
        <span style={{ marginLeft: 'auto' }}>{filtered.length} / {allItems.length} 結果</span>
      </div>
    </NavModal>
  );
};

// 2. Course detail page (full replace for main content) ────────────
const CourseDetailPage = ({ theme: T, courseId, onBack, onOpenReminder, onStartRecording, onOpenReview }) => {
  const c = v3GetCourse(courseId);
  const ct = h18CourseText(c, T);
  const rems = V3_REMINDERS.filter(r => r.course === courseId);

  // Build a 20-lecture syllabus: last N done, next = current, rest = future
  const TOTAL_LECTURES = 20;
  const nextN = c.nextLec.n;
  const syllabusTitles = {
    ml:  ['課程介紹', 'Linear Regression', 'Logistic Regression', 'Gradient Descent',
          'Neural Networks', 'Backpropagation', 'CNN 基礎', 'CNN 應用',
          'RNN + LSTM', 'Word Embedding', 'Seq2Seq 基礎', '為什麼需要 attention',
          'Self-Attention 推導', 'Attention 機制', 'Multi-Head 與應用', 'Transformer 變體',
          'BERT / GPT', 'Fine-tuning 技巧', 'RLHF', '期末回顧'],
    alg: ['Divide & Conquer', 'Sorting', 'Heaps', 'BST', 'Hashing', 'Graph Basics',
          'BFS / DFS', 'Shortest Path', 'Graph Algorithms', 'NP-completeness',
          'Approximation', 'Linear Programming', 'Network Flow', 'String Matching',
          'Computational Geometry', 'Randomized', 'Online', 'Parallel',
          'Quantum 簡介', '期末回顧'],
  };
  const titles = syllabusTitles[courseId] || Array.from({ length: TOTAL_LECTURES },
    (_, i) => `Lecture ${i + 1}`);
  const lectures = Array.from({ length: TOTAL_LECTURES }, (_, i) => {
    const n = i + 1;
    const title = titles[i] || `Lecture ${n}`;
    if (n < nextN) {
      const daysAgo = (nextN - n);
      return { n, title, status: 'done',
        date: daysAgo === 1 ? '昨天' : daysAgo < 7 ? `${daysAgo} 天前` : `${Math.floor(daysAgo/7)} 週前`,
        dur: 45 + (n * 7) % 12, reviewed: n < nextN - 3,
        keyCount: n === nextN - 1 ? 2 : n === nextN - 2 ? 1 : 0 };
    }
    if (n === nextN) {
      return { n, title, status: 'next', when: c.nextLec.when, dur: null };
    }
    const weeks = Math.ceil((n - nextN) / 2);
    return { n, title, status: 'future',
      when: `第 ${Math.ceil(n / 2) + 1} 週` };
  });

  // Grading scheme per course
  const gradingByCourse = {
    ml:   [{ k: '期中考',     p: 25, got: 87 }, { k: '期末考',     p: 35 },
           { k: 'HW × 4',     p: 32, got: 90 }, { k: '課堂參與',   p: 8, got: 95 }],
    alg:  [{ k: '期中考',     p: 30, got: 87 }, { k: '期末考',     p: 30 },
           { k: 'HW × 5',     p: 30, got: 92 }, { k: '隨堂小考',   p: 10, got: 80 }],
    ds:   [{ k: '期中考',     p: 25, got: 85 }, { k: '期末考',     p: 30 },
           { k: 'Lab × 6',    p: 35 },          { k: '隨堂 quiz',  p: 10, got: 78 }],
    lin:  [{ k: '期中考',     p: 35 },          { k: '期末考',     p: 40 },
           { k: 'HW × 6',     p: 20, got: 88 }, { k: '出席',       p: 5 }],
    stat: [{ k: '期中考',     p: 30, got: 82 }, { k: '期末考',     p: 35 },
           { k: 'Quiz × 6',   p: 25, got: 90 }, { k: 'Project',    p: 10 }],
    cmp:  [{ k: 'Lab × 4',    p: 60 },          { k: '期末專題',   p: 30 },
           { k: '出席',       p: 10, got: 100 }],
  };
  const grading = gradingByCourse[courseId] || gradingByCourse.ml;
  const gradingColors = ['#3451b2', '#1f7a4f', '#9e3a24', '#6a3da0', '#1d6477'];

  return (
    <div style={{ flex: 1, display: 'grid',
      gridTemplateColumns: '1fr 380px',
      background: T.border, gap: 1, overflow: 'hidden' }}>
      <div style={{ background: T.surface, overflow: 'auto',
        display: 'flex', flexDirection: 'column' }}>
        {/* Hero */}
        <div style={{
          background: `linear-gradient(135deg, ${c.color}, ${c.color}dd)`,
          color: '#fff', padding: '20px 32px 28px', position: 'relative',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <H18Breadcrumb theme={T} course={c} kind="other"
            onBack={onBack} backLabel="返回首頁" backTone="dark"
            extraPills={<span style={{ fontSize: 10, letterSpacing: '0.14em', opacity: 0.85,
              fontWeight: 700, fontFamily: 'JetBrains Mono', color: '#fff',
              whiteSpace: 'nowrap', flexShrink: 0 }}>
              {c.instructor} · {c.credits} 學分
            </span>}/>
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em',
            lineHeight: 1.05 }}>{c.title}</div>
          <div style={{ display: 'flex', gap: 24, marginTop: 16, fontSize: 12,
            opacity: 0.92, flexWrap: 'wrap' }}>
            <div style={{ whiteSpace: 'nowrap' }}><b style={{ fontSize: 18, fontFamily: 'JetBrains Mono' }}>{nextN - 1}</b>
              <span style={{ opacity: 0.7 }}> / {TOTAL_LECTURES}</span> lectures</div>
            <div style={{ whiteSpace: 'nowrap' }}><b style={{ fontSize: 18, fontFamily: 'JetBrains Mono' }}>{v3Fmt(c.mins)}</b> 已錄</div>
            <div style={{ whiteSpace: 'nowrap' }}><b style={{ fontSize: 18, fontFamily: 'JetBrains Mono' }}>{Math.round(c.progress * 100)}%</b> 進度</div>
            <div style={{ whiteSpace: 'nowrap' }}><b style={{ fontSize: 18, fontFamily: 'JetBrains Mono' }}>{c.grade}</b> 目前</div>
          </div>
        </div>
        {/* Next lecture big card */}
        <div style={{ padding: '20px 32px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, letterSpacing: '0.16em', color: T.textDim,
            fontWeight: 800, fontFamily: 'JetBrains Mono' }}>下一堂</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center',
            gap: 16, padding: '14px 16px', borderRadius: 10,
            background: h18Accent(c, T), border: `1px solid ${T.borderSoft}` }}>
            <div style={{ width: 52, height: 52, borderRadius: 10,
              background: c.color, color: '#fff', display: 'grid',
              placeItems: 'center', fontSize: 18, fontWeight: 800,
              fontFamily: 'JetBrains Mono' }}>L{c.nextLec.n}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text,
                letterSpacing: '-0.01em' }}>{c.nextLec.title}</div>
              <div style={{ fontSize: 12, color: T.textMid, marginTop: 2 }}>
                {c.nextLec.when} · {c.room}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: ct,
                fontFamily: 'JetBrains Mono' }}>1h 52m</div>
              <div style={{ fontSize: 10, color: T.textDim }}>後開始</div>
            </div>
            <button onClick={onStartRecording} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: 700,
              background: T.invert, color: T.invertInk, border: 'none',
              borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>準備錄音 →</button>
          </div>
        </div>
        {/* Full lectures list (all 20) */}
        <div style={{ padding: '20px 32px', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', color: T.textDim,
              fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
              完整課綱 · {TOTAL_LECTURES} lectures
            </div>
            <div style={{ fontSize: 11, color: T.textFaint }}>
              {nextN - 1} 已錄 · 1 下一堂 · {TOTAL_LECTURES - nextN} 未開始
            </div>
          </div>

          {/* Group: done */}
          <div style={{ marginTop: 12, fontSize: 10, letterSpacing: '0.14em',
            color: T.textDim, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>
            ● 已完成 · {nextN - 1}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {lectures.filter(l => l.status === 'done').reverse().map(l => (
              <div key={l.n} onClick={() => onOpenReview?.(l.n)} style={{
                padding: '8px 12px', borderRadius: 7,
                border: `1px solid ${T.borderSoft}`,
                display: 'grid', gridTemplateColumns: '42px 1fr auto auto auto',
                gap: 12, alignItems: 'center', cursor: 'pointer', background: T.surface,
              }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: ct,
                  fontFamily: 'JetBrains Mono' }}>L{l.n}</div>
                <div style={{ fontSize: 13, color: T.text, fontWeight: 500,
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis' }}>{l.title}</div>
                {l.keyCount > 0 ? (
                  <span style={{ fontSize: 9, padding: '1px 6px',
                    background: T.hotBg, color: T.hot, borderRadius: 3,
                    fontWeight: 700, fontFamily: 'JetBrains Mono' }}>
                    ★ {l.keyCount} key
                  </span>
                ) : <span/>}
                <span style={{ fontSize: 10, color: l.reviewed ? T.textDim : T.accent,
                  fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
                  {l.reviewed ? '已複習' : 'NEW'}
                </span>
                <span style={{ fontSize: 10, color: T.textFaint,
                  fontFamily: 'JetBrains Mono' }}>{l.date} · {l.dur}m</span>
              </div>
            ))}
          </div>

          {/* Group: next */}
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.14em',
            color: ct, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>
            ◐ 下一堂
          </div>
          <div style={{ marginTop: 6 }}>
            {lectures.filter(l => l.status === 'next').map(l => (
              <div key={l.n} style={{
                padding: '10px 14px', borderRadius: 8,
                border: `2px solid ${c.color}`,
                background: h18Accent(c, T),
                display: 'grid', gridTemplateColumns: '42px 1fr auto',
                gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#fff',
                  background: c.color, padding: '3px 7px', borderRadius: 4,
                  fontFamily: 'JetBrains Mono', textAlign: 'center' }}>L{l.n}</div>
                <div style={{ fontSize: 13, color: T.text, fontWeight: 700 }}>
                  {l.title}
                </div>
                <span style={{ fontSize: 11, color: ct, fontWeight: 700,
                  fontFamily: 'JetBrains Mono' }}>{l.when}</span>
              </div>
            ))}
          </div>

          {/* Group: future */}
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.14em',
            color: T.textDim, fontFamily: 'JetBrains Mono', fontWeight: 700 }}>
            ○ 未開始 · {TOTAL_LECTURES - nextN}
          </div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {lectures.filter(l => l.status === 'future').map(l => (
              <div key={l.n} style={{
                padding: '7px 12px', borderRadius: 7,
                border: `1px dashed ${T.borderSoft}`,
                display: 'grid', gridTemplateColumns: '42px 1fr auto',
                gap: 12, alignItems: 'center', opacity: 0.65 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textDim,
                  fontFamily: 'JetBrains Mono' }}>L{l.n}</div>
                <div style={{ fontSize: 12, color: T.textMid,
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis' }}>{l.title}</div>
                <span style={{ fontSize: 10, color: T.textFaint,
                  fontFamily: 'JetBrains Mono' }}>{l.when}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Right side: course-scoped inbox + grading + keywords + people */}
      <div style={{ background: T.surface, padding: '20px 0',
        overflow: 'auto' }}>
        {/* Grading scheme */}
        <div style={{ padding: '0 20px', fontSize: 10, letterSpacing: '0.16em',
          color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
          評分組成
        </div>
        <div style={{ margin: '10px 20px', padding: 12, borderRadius: 8,
          background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
          {/* Stacked proportion bar */}
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden',
            marginBottom: 10, background: T.border }}>
            {grading.map((g, i) => (
              <div key={i} style={{ width: `${g.p}%`,
                background: gradingColors[i % gradingColors.length] }}/>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {grading.map((g, i) => (
              <div key={i} style={{ display: 'grid',
                gridTemplateColumns: '10px 1fr auto auto', gap: 8,
                alignItems: 'center', fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2,
                  background: gradingColors[i % gradingColors.length] }}/>
                <span style={{ color: T.text, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.k}</span>
                <span style={{ color: T.textDim, fontFamily: 'JetBrains Mono',
                  fontSize: 11, whiteSpace: 'nowrap' }}>
                  {g.got != null ? `${g.got}分` : '未考'}
                </span>
                <span style={{ fontSize: 12, color: T.text, fontWeight: 700,
                  fontFamily: 'JetBrains Mono', whiteSpace: 'nowrap' }}>{g.p}%</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, paddingTop: 8,
            borderTop: `1px dashed ${T.border}`,
            display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 11, color: T.textDim }}>加權平均</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: ct,
              fontFamily: 'JetBrains Mono', marginLeft: 'auto' }}>{c.grade}</span>
            <span style={{ fontSize: 10, color: T.textFaint,
              fontFamily: 'JetBrains Mono' }}>
              (依已完成項目 / {grading.filter(g => g.got != null)
                .reduce((s, g) => s + g.p, 0)}%)
            </span>
          </div>
        </div>

        {/* Course-scoped inbox */}
        <div style={{ padding: '16px 20px 4px', fontSize: 10, letterSpacing: '0.16em',
          color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
          這堂課的提醒 · {rems.length}
        </div>
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rems.map(r => (
            <H18InboxRow key={r.id} r={r} theme={T}
              selected={false} dense
              onClick={() => onOpenReminder?.(r.id)}/>
          ))}
        </div>

        {/* Keywords */}
        <div style={{ padding: '20px 20px 0', fontSize: 10, letterSpacing: '0.16em',
          color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
          關鍵字 · 常出現
        </div>
        <div style={{ padding: '8px 20px', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {c.keywords.map(k => (
            <span key={k} style={{ fontSize: 11, padding: '3px 9px',
              borderRadius: 999, background: h18Accent(c, T), color: ct,
              fontWeight: 600 }}>{k}</span>
          ))}
        </div>

        {/* People */}
        <div style={{ padding: '16px 20px 0', fontSize: 10, letterSpacing: '0.16em',
          color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
          助教 / 老師
        </div>
        <div style={{ padding: '8px 20px', display: 'flex', flexDirection: 'column',
          gap: 8 }}>
          {[
            { n: c.instructor, r: '教授', email: 'prof@ntu.edu.tw' },
            { n: '張助教', r: 'TA', email: 'ta1@ntu.edu.tw' },
          ].map(p => (
            <div key={p.n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 16,
                background: T.chipBg, color: T.textMid, display: 'grid',
                placeItems: 'center', fontSize: 11, fontWeight: 700 }}>
                {p.n[0]}
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{p.n}</div>
                <div style={{ fontSize: 10, color: T.textDim,
                  fontFamily: 'JetBrains Mono' }}>{p.r} · {p.email}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// 3. AI assistant (chat) ───────────────────────────────────────────
const AIPage = ({ theme: T, onBack }) => {
  const [msgs, setMsgs] = React.useState(() => {
    try { const r = localStorage.getItem('h18-ai-history-v1');
      if (r) return JSON.parse(r); } catch (_) {}
    return [];
  });
  const [q, setQ] = React.useState('');

  // Refresh from storage whenever this page re-mounts or window regains focus
  React.useEffect(() => {
    const reload = () => {
      try { const r = localStorage.getItem('h18-ai-history-v1');
        if (r) setMsgs(JSON.parse(r)); } catch (_) {}
    };
    window.addEventListener('focus', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  const send = () => {
    if (!q.trim()) return;
    const next = [...msgs,
      { role: 'user', text: q.trim() },
      { role: 'ai', text: '根據 L13 · 38:14，老師提到 scaling factor = √d_k，是避免 softmax saturate 的關鍵。',
        cites: [{ l: 'L13 · 38:14' }] }];
    setMsgs(next);
    try { localStorage.setItem('h18-ai-history-v1', JSON.stringify(next)); } catch (_) {}
    setQ('');
  };

  return (
  <div style={{ flex: 1, display: 'grid',
    gridTemplateColumns: '260px 1fr', background: T.border, gap: 1,
    overflow: 'hidden' }}>
    <div style={{ background: T.surface, padding: 14, overflow: 'auto',
      display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button onClick={onBack} style={{
        padding: '4px 10px', fontSize: 11, alignSelf: 'flex-start',
        background: 'transparent', color: T.textMid,
        border: `1px solid ${T.border}`, borderRadius: 5,
        cursor: 'pointer', fontFamily: 'inherit' }}>← 返回</button>
      <div style={{ fontSize: 10, letterSpacing: '0.16em', color: T.textDim,
        fontWeight: 800, fontFamily: 'JetBrains Mono',
        margin: '14px 0 6px' }}>最近對話</div>
      {[
        { t: '目前這串', s: msgs.length ? (msgs.find(m => m.role === 'user')?.text || '新對話') : '新對話', d: '進行中', active: true },
        { t: 'HW3 要怎麼做？', s: '關於 Transformer...', d: '昨天' },
        { t: '幫我整理 ML L11-13', s: '重點是 attention...', d: '2 天前' },
        { t: 'SVD 在 PCA 的作用', s: '在降維時，SVD...', d: '3 天前' },
        { t: 'NP-complete 的例子', s: 'SAT, TSP...', d: '5 天前' },
      ].map((c, i) => (
        <div key={i} style={{
          padding: '10px 12px', borderRadius: 8,
          background: c.active ? T.selBg : 'transparent',
          borderLeft: c.active ? `3px solid ${T.selBorder}` : '3px solid transparent',
          cursor: 'pointer' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{c.t}</div>
          <div style={{ fontSize: 10, color: T.textDim, marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' }}>{c.s}</div>
          <div style={{ fontSize: 9, color: T.textFaint, marginTop: 2,
            fontFamily: 'JetBrains Mono' }}>{c.d}</div>
        </div>
      ))}
      <button onClick={() => {
        const fresh = [{ role: 'ai', hint: true, text: '新對話開始。有什麼想問的？' }];
        setMsgs(fresh);
        try { localStorage.setItem('h18-ai-history-v1', JSON.stringify(fresh)); } catch (_) {}
      }} style={{ marginTop: 'auto', padding: '8px 12px', fontSize: 12,
        background: 'transparent', color: T.textMid,
        border: `1px dashed ${T.border}`, borderRadius: 7,
        cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>+ 新對話</button>
    </div>
    <div style={{ background: T.surface, display: 'flex', flexDirection: 'column',
      overflow: 'hidden' }}>
      <div style={{ padding: '12px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14 }}>✦</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>AI 助教</div>
          <div style={{ fontSize: 10, color: T.textDim,
            fontFamily: 'JetBrains Mono' }}>
            已讀取 ML L11-14 · {msgs.filter(m => m.role === 'user').length} 個提問
          </div>
        </div>
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 10, color: T.textFaint,
          fontFamily: 'JetBrains Mono',
          padding: '2px 8px', border: `1px solid ${T.border}`, borderRadius: 4 }}>
          覆蓋 3 份筆記
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 14 }}>
        {msgs.length === 0 && (
          <div style={{ alignSelf: 'center', textAlign: 'center',
            color: T.textDim, fontSize: 13, marginTop: 40, lineHeight: 1.7 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
            還沒開始對話。<br/>從下方輸入框開始，或在任何頁面按 ⌘J 問 AI。
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.hint) {
            return (
              <div key={i} style={{ alignSelf: 'stretch',
                padding: '12px 14px', borderRadius: 10,
                background: T.surface2, border: `1px dashed ${T.borderSoft}`,
                fontSize: 12, color: T.textMid, lineHeight: 1.6 }}>
                {m.text}
              </div>
            );
          }
          if (m.role === 'user') {
            return (
              <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '75%',
                padding: '10px 14px', borderRadius: 14,
                background: T.invert, color: T.invertInk,
                fontSize: 13, lineHeight: 1.5 }}>{m.text}</div>
            );
          }
          return (
            <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '85%',
              padding: '12px 16px', borderRadius: 14,
              background: T.surface2, color: T.text, fontSize: 13,
              lineHeight: 1.6, border: `1px solid ${T.borderSoft}` }}>
              {m.text}
              {m.cites && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {m.cites.map((cc, j) => (
                    <span key={j} style={{ fontSize: 10, color: T.accent,
                      padding: '2px 8px', border: `1px solid ${T.accent}55`,
                      borderRadius: 999, cursor: 'pointer',
                      fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
                      → {cc.l}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '12px 24px', borderTop: `1px solid ${T.border}`,
        display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', borderRadius: 8,
          background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
          <input value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder="問 AI 任何關於 ML L11–14 的問題..."
            style={{ flex: 1, border: 'none', background: 'transparent',
              color: T.text, outline: 'none', fontSize: 13,
              fontFamily: 'inherit' }}/>
          <span style={{ fontSize: 10, color: T.textFaint,
            fontFamily: 'JetBrains Mono' }}>⌘↵</span>
        </div>
        <button onClick={send} style={{ padding: '0 16px', background: T.invert,
          color: T.invertInk, border: 'none', borderRadius: 8,
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit' }}>送出</button>
      </div>
    </div>
  </div>
  );
};

// 4. Add course dialog ─────────────────────────────────────────────
const AddCourseDialog = ({ theme: T, onClose }) => {
  const [src, setSrc] = React.useState('text'); // text | file | url
  const [kws, setKws] = React.useState(['TCP', 'routing', 'socket']);

  const srcOpts = [
    { k: 'text', label: '貼文字',   hint: '貼大綱 / 老師的說明' },
    { k: 'file', label: '上傳檔案', hint: 'PDF · DOCX · 圖片' },
    { k: 'url',  label: '從網址',   hint: 'AI 幫你抓課程頁' },
  ];

  return (
    <NavModal theme={T} onClose={onClose} width={560}>
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text,
          letterSpacing: '-0.01em' }}>新增課程</div>
        <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>
          先選個起點 — AI 會從這裡推論課程名稱、大綱與關鍵字
        </div>

        {/* Source tabs */}
        <div style={{ marginTop: 18, display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {srcOpts.map(o => (
            <button key={o.k} onClick={() => setSrc(o.k)} style={{
              padding: '10px 12px', textAlign: 'left',
              background: src === o.k ? T.invert : T.surface2,
              color: src === o.k ? T.invertInk : T.text,
              border: `1px solid ${src === o.k ? T.invert : T.borderSoft}`,
              borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{o.label}</div>
              <div style={{ fontSize: 10, marginTop: 2,
                color: src === o.k ? T.invertInk : T.textDim, opacity: 0.75 }}>
                {o.hint}
              </div>
            </button>
          ))}
        </div>

        {/* Source body */}
        <div style={{ marginTop: 14 }}>
          {src === 'text' && (
            <textarea placeholder={`把課綱貼在這裡。例：\n\n計算機網路 · 陳老師 · 週三 10:00 · 資訊館 204\n單元：TCP / UDP / routing / socket / security ...`}
              rows={7}
              style={{ width: '100%', padding: '10px 12px', fontSize: 12,
                background: T.surface2, color: T.text,
                border: `1px solid ${T.borderSoft}`, borderRadius: 7,
                outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit', lineHeight: 1.55 }}/>
          )}
          {src === 'file' && (
            <div style={{ padding: '28px 20px', border: `1.5px dashed ${T.border}`,
              borderRadius: 8, textAlign: 'center', background: T.surface2 }}>
              <div style={{ fontSize: 28, color: T.textDim, lineHeight: 1 }}>⎘</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginTop: 8 }}>
                拖放檔案到這 · 或點擊選檔
              </div>
              <div style={{ fontSize: 10, color: T.textDim, marginTop: 4,
                fontFamily: 'JetBrains Mono' }}>
                PDF · DOCX · PPTX · PNG / JPG · 最多 20 MB
              </div>
              <button style={{ marginTop: 10, padding: '6px 14px', fontSize: 12,
                background: T.invert, color: T.invertInk, border: 'none',
                borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: 700 }}>選擇檔案</button>
            </div>
          )}
          {src === 'url' && (
            <div>
              <input placeholder="https://www.csie.ntu.edu.tw/~.../syllabus.html"
                style={{ width: '100%', padding: '10px 12px', fontSize: 13,
                  background: T.surface2, color: T.text,
                  border: `1px solid ${T.borderSoft}`, borderRadius: 7,
                  outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'JetBrains Mono' }}/>
              <div style={{ marginTop: 6, fontSize: 10, color: T.textDim,
                lineHeight: 1.55 }}>
                AI 會抓頁面內容、解析大綱、抽出關鍵字。支援 NTU COOL、系上課程頁、
                Notion 公開頁與大多數 syllabus 頁。
              </div>
            </div>
          )}
        </div>

        {/* Course name + keywords (always shown — AI fills these after processing) */}
        <div style={{ marginTop: 18, paddingTop: 16,
          borderTop: `1px dashed ${T.borderSoft}` }}>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 800,
            color: T.textDim, fontFamily: 'JetBrains Mono', marginBottom: 10 }}>
            AI 解析後可再調整
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text,
              marginBottom: 6 }}>課程名稱</div>
            <input placeholder="例：計算機網路"
              style={{ width: '100%', padding: '10px 12px', fontSize: 13,
                background: T.surface2, color: T.text,
                border: `1px solid ${T.borderSoft}`, borderRadius: 7,
                outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit' }}/>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text,
              marginBottom: 6 }}>關鍵字 · 幫 AI 聚焦</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap',
              padding: '8px 10px', minHeight: 40,
              background: T.surface2, border: `1px solid ${T.borderSoft}`,
              borderRadius: 7 }}>
              {kws.map(k => (
                <span key={k} style={{ fontSize: 11, padding: '3px 9px',
                  borderRadius: 999, background: T.chipBg, color: T.text,
                  fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {k}
                  <span onClick={() => setKws(kws.filter(x => x !== k))}
                    style={{ color: T.textDim, cursor: 'pointer' }}>✕</span>
                </span>
              ))}
              <input placeholder="+ 加關鍵字"
                style={{ flex: 1, minWidth: 100, border: 'none',
                  background: 'transparent', outline: 'none',
                  color: T.text, fontSize: 12, fontFamily: 'inherit' }}/>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 8,
          justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', fontSize: 12,
            background: 'transparent', color: T.textMid,
            border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'pointer',
            fontFamily: 'inherit' }}>取消</button>
          <button style={{ padding: '8px 16px', fontSize: 12, fontWeight: 700,
            background: T.invert, color: T.invertInk, border: 'none',
            borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
            ✦ 交給 AI 建立
          </button>
        </div>
      </div>
    </NavModal>
  );
};

// 5. Profile / 設定頁（深化） ─────────────────────────────────────
const PROFILE_SECTIONS = [
  { id: 'overview',    label: '總覽',         hint: '學習成就' },
  { id: 'transcribe',  label: '本地轉錄',     hint: 'Parakeet · GPU' },
  { id: 'translate',   label: '翻譯',         hint: 'ONNX · Google' },
  { id: 'cloud',       label: '雲端 AI 助理', hint: '摘要 · Q&A · OCR' },
  { id: 'appearance',  label: '介面與顯示',   hint: 'AI · 版面' },
  { id: 'audio',       label: '音訊與字幕',   hint: '麥克風 · 字幕' },
  { id: 'data',        label: '資料管理',     hint: '匯入匯出 · 回收桶' },
  { id: 'about',       label: '關於與更新',   hint: '版本 · 診斷' },
];

// Re-usable row
const PRow = ({ T, label, hint, right, children }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16,
    padding: '14px 0', borderBottom: `1px solid ${T.borderSoft}` }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: T.textDim, marginTop: 3,
        lineHeight: 1.55 }}>{hint}</div>}
      {children}
    </div>
    {right && <div style={{ flexShrink: 0 }}>{right}</div>}
  </div>
);

// Re-usable section header
const PHead = ({ T, children }) => (
  <div style={{ fontSize: 10, letterSpacing: '0.16em',
    color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono',
    marginTop: 24, marginBottom: 2 }}>{children}</div>
);

// Small form controls
const PSelect = ({ T, value, options }) => (
  <select defaultValue={value} style={{
    padding: '6px 10px', fontSize: 12, color: T.text,
    background: T.surface2, border: `1px solid ${T.border}`,
    borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer',
    outline: 'none', minWidth: 120 }}>
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);
const PToggle = ({ T, on }) => {
  const [v, setV] = React.useState(on);
  return (
    <div onClick={() => setV(!v)} style={{
      width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
      background: v ? T.accent : T.border, position: 'relative',
      transition: 'background 160ms', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: v ? 18 : 2,
        width: 16, height: 16, borderRadius: 8, background: '#fff',
        transition: 'left 160ms',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}/>
    </div>
  );
};
const PBtn = ({ T, children, primary, danger, onClick }) => (
  <button onClick={onClick} style={{
    padding: '6px 12px', fontSize: 11, fontWeight: 600,
    background: primary ? T.invert : 'transparent',
    color: danger ? T.hot : (primary ? T.invertInk : T.text),
    border: `1px solid ${danger ? T.hot : (primary ? T.invert : T.border)}`,
    borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap' }}>{children}</button>
);
const PInput = ({ T, placeholder, value, monospace, wide }) => (
  <input placeholder={placeholder} defaultValue={value} style={{
    padding: '6px 10px', fontSize: 12, color: T.text,
    background: T.surface2, border: `1px solid ${T.border}`,
    borderRadius: 6, outline: 'none',
    fontFamily: monospace ? 'JetBrains Mono' : 'inherit',
    width: wide ? 260 : 160 }}/>
);

const ProfilePage = ({ theme: T, onBack, onOpenSetupWizard, tweaks, applyTweaks }) => {
  const [tab, setTab] = React.useState('overview');

  return (
  <div style={{ flex: 1, display: 'flex', background: T.surface,
    overflow: 'hidden' }}>
    {/* Sidebar */}
    <div style={{ width: 230, flexShrink: 0, background: T.surface2,
      borderRight: `1px solid ${T.border}`, padding: '20px 14px 20px 18px',
      display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <button onClick={onBack} style={{
        padding: '4px 10px', fontSize: 11, alignSelf: 'flex-start',
        background: 'transparent', color: T.textMid,
        border: `1px solid ${T.border}`, borderRadius: 5,
        cursor: 'pointer', fontFamily: 'inherit', marginBottom: 18 }}>← 返回</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 18,
          background: '#c48a2c', color: '#fff', display: 'grid',
          placeItems: 'center', fontSize: 14, fontWeight: 800 }}>H</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Hank 黃</div>
          <div style={{ fontSize: 10, color: T.textDim,
            fontFamily: 'JetBrains Mono',
            whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' }}>hank@ntu.edu.tw</div>
        </div>
      </div>
      <div style={{ marginTop: 18, fontSize: 10, letterSpacing: '0.16em',
        color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono',
        marginBottom: 6 }}>個人</div>
      {PROFILE_SECTIONS.slice(0, 1).map(s => (
        <div key={s.id} onClick={() => setTab(s.id)} style={{
          padding: '7px 10px', fontSize: 12, borderRadius: 6,
          color: tab === s.id ? T.text : T.textMid,
          background: tab === s.id ? T.selBg : 'transparent',
          borderLeft: `3px solid ${tab === s.id ? T.selBorder : 'transparent'}`,
          paddingLeft: 10, cursor: 'pointer',
          fontWeight: tab === s.id ? 700 : 500 }}>
          {s.label}
          <div style={{ fontSize: 10, color: T.textDim, fontWeight: 400,
            marginTop: 1 }}>{s.hint}</div>
        </div>
      ))}
      <div style={{ marginTop: 14, fontSize: 10, letterSpacing: '0.16em',
        color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono',
        marginBottom: 6 }}>設定</div>
      {PROFILE_SECTIONS.slice(1).map(s => (
        <div key={s.id} onClick={() => setTab(s.id)} style={{
          padding: '7px 10px', fontSize: 12, borderRadius: 6,
          color: tab === s.id ? T.text : T.textMid,
          background: tab === s.id ? T.selBg : 'transparent',
          borderLeft: `3px solid ${tab === s.id ? T.selBorder : 'transparent'}`,
          paddingLeft: 10, cursor: 'pointer', marginBottom: 2,
          fontWeight: tab === s.id ? 700 : 500 }}>
          {s.label}
          <div style={{ fontSize: 10, color: T.textDim, fontWeight: 400,
            marginTop: 1 }}>{s.hint}</div>
        </div>
      ))}
    </div>

    {/* Content */}
    <div style={{ flex: 1, overflow: 'auto', padding: '28px 44px 60px' }}>
      {tab === 'overview'   && <POverview T={T}/>}
      {tab === 'transcribe' && <PTranscribe T={T}/>}
      {tab === 'translate'  && <PTranslate T={T}/>}
      {tab === 'cloud'      && <PCloud T={T}/>}
      {tab === 'appearance' && <PAppearance T={T} tweaks={tweaks} applyTweaks={applyTweaks}/>}
      {tab === 'audio'      && <PAudio T={T}/>}
      {tab === 'data'       && <PData T={T}/>}
      {tab === 'about'      && <PAbout T={T} onOpenSetupWizard={onOpenSetupWizard}/>}
    </div>
  </div>
  );
};

// ── Individual panes ──────────────────────────────────────────────
const PHeader = ({ T, title, hint }) => (
  <div style={{ marginBottom: 20 }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: T.text,
      letterSpacing: '-0.02em' }}>{title}</div>
    {hint && <div style={{ fontSize: 12, color: T.textDim, marginTop: 4,
      lineHeight: 1.5 }}>{hint}</div>}
  </div>
);

// ─── 登出按鈕 (放在 POverview hero 人頭像右側) ─────────────────
// 對應 AuthContext.tsx 的 logout()。實裝時呼叫 authService.logout()
// 後 App.tsx 偵測 !user 自動跳到 LoginScreen。prototype 用 Confirm
// + Toast 模擬。
const H18LogoutButton = ({ T }) => {
  const handleLogout = async () => {
    const ok = await window.h18Confirm?.({
      title: '確定要登出？',
      message: '登出後需重新輸入用戶名才能繼續使用。本機資料不會被刪除，下次登入相同名稱即可繼續。',
      okLabel: '登出',
      cancelLabel: '取消',
    });
    if (ok) {
      window.h18Toast?.({
        type: 'info',
        message: '已登出 (prototype)',
        detail: '實裝時會呼叫 authService.logout() 並回到 LoginScreen',
      });
    }
  };

  const [hover, setHover] = React.useState(false);

  return (
    <button
      onClick={handleLogout}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="登出"
      style={{
        width: 28, height: 28, borderRadius: 6,
        background: hover ? T.surface2 : 'transparent',
        color: hover ? T.hot : T.textDim,
        border: `1px solid ${hover ? T.hot + '55' : T.border}`,
        cursor: 'pointer',
        display: 'grid', placeItems: 'center',
        fontFamily: 'inherit',
        flexShrink: 0,
        transition: 'background 140ms, color 140ms, border-color 140ms',
      }}
    >
      {/* Logout icon — 門框 + 向外箭頭 */}
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none"
        style={{ display: 'block' }}>
        <path d="M9 4 L4 4 L4 16 L9 16"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M13 7 L16 10 L13 13"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="16" y1="10" x2="8" y2="10"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round"/>
      </svg>
    </button>
  );
};

// ─── 共享 mock data — 三個 POverview 變體共用 ──────────────────
const POV_STATS = {
  startDate: '2026-02-01',
  totalHours: 47.3,
  lectures: 60,
  concepts: 142,
  courses: 6,
  aiChats: 23,
  nextMilestone: 100,
};
const POV_COURSE_DEPTH = [
  { id: 'ml',   name: '機器學習',  short: 'ML',   color: '#3451b2',
    hours: 14.4, lecturesDone: 11, lecturesTotal: 20, concepts: 38 },
  { id: 'os',   name: '作業系統',  short: 'OS',   color: '#9e3a24',
    hours: 9.1,  lecturesDone: 11, lecturesTotal: 24, concepts: 19 },
  { id: 'alg',  name: '演算法',    short: 'ALG',  color: '#1f7a4f',
    hours: 8.2,  lecturesDone: 9,  lecturesTotal: 15, concepts: 21 },
  { id: 'stat', name: '機率論',    short: 'STAT', color: '#1d6477',
    hours: 7.6,  lecturesDone: 12, lecturesTotal: 16, concepts: 24 },
  { id: 'lin',  name: '線性代數',  short: 'LA',   color: '#6a3da0',
    hours: 5.3,  lecturesDone: 8,  lecturesTotal: 16, concepts: 16 },
  { id: 'cmp',  name: '編譯器',    short: 'CMP',  color: '#3a3a3a',
    hours: 2.7,  lecturesDone: 6,  lecturesTotal: 18, concepts: 11 },
];
const POV_CONCEPTS = [
  { k: 'scaling factor',   n: 12, course: 'ml' },
  { k: 'self-attention',   n: 9,  course: 'ml' },
  { k: 'softmax',          n: 7,  course: 'ml' },
  { k: 'eigenvalue',       n: 6,  course: 'lin' },
  { k: 'gradient descent', n: 6,  course: 'ml' },
  { k: 'paging',           n: 5,  course: 'os' },
  { k: 'Bayes',            n: 5,  course: 'stat' },
  { k: 'DP',               n: 4,  course: 'alg' },
  { k: 'mutex',            n: 4,  course: 'os' },
  { k: 'CLT',              n: 3,  course: 'stat' },
];
const POV_MILESTONES = [
  { d: '2026-02-04', t: '第一堂錄音',     m: 'ML · L1 · 課程介紹',           done: true },
  { d: '2026-02-28', t: '錄完第 10 堂',  m: '累積 7.8 小時',                done: true },
  { d: '2026-03-15', t: '達成 25 小時',  m: '橫跨 4 門課',                  done: true },
  { d: '2026-04-10', t: '達成 50 個概念', m: '由 RVBilink 累積追蹤',         done: true },
  { d: null,         t: '達成 100 小時', m: '還差 52.7 小時 · 預計 6 月初', done: false },
];

// ─── POverview Router · 切換 A/B/C 變體 ───────────────────────────
const POverview = ({ T }) => {
  const [variant, setVariant] = React.useState(() => {
    try {
      const saved = localStorage.getItem('h18-pov-variant');
      if (saved === 'A' || saved === 'B' || saved === 'C') return saved;
    } catch (_) {}
    return 'A';
  });

  const switchTo = (v) => {
    setVariant(v);
    try { localStorage.setItem('h18-pov-variant', v); } catch (_) {}
  };

  const VARIANTS = [
    { k: 'A', label: '累積', sub: '資訊密集 · 數據儀表' },
    { k: 'B', label: '編輯', sub: 'Fraunces · 雜誌排版' },
    { k: 'C', label: '書信', sub: '書信體 · 散文回顧' },
    { k: 'D', label: '精煉', sub: '極簡留白 · Apple/Stripe' },
  ];

  return (
    <div>
      {/* 切換 pill — 只有變體挑選階段顯示，未來定案後移除 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: 4, borderRadius: 10,
        background: T.surface2, border: `1px dashed ${T.borderSoft}`,
        marginBottom: 28, fontSize: 11,
      }}>
        <span style={{ padding: '0 10px', color: T.textDim,
          fontFamily: 'JetBrains Mono', letterSpacing: '0.14em',
          fontWeight: 800, fontSize: 10 }}>
          DESIGN VARIANT
        </span>
        {VARIANTS.map(v => {
          const active = v.k === variant;
          return (
            <button key={v.k} onClick={() => switchTo(v.k)} style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600,
              background: active ? T.invert : 'transparent',
              color: active ? T.invertInk : T.textMid,
              border: 'none', borderRadius: 6,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'baseline', gap: 6,
            }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 800,
                fontSize: 10, opacity: 0.7 }}>{v.k}</span>
              <span>{v.label}</span>
              <span style={{ fontSize: 9, opacity: 0.5 }}>· {v.sub}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }}/>
        <span style={{ padding: '0 8px', fontSize: 9, color: T.textFaint,
          fontFamily: 'JetBrains Mono' }}>
          選定後會清掉其他兩個
        </span>
      </div>

      {variant === 'A' && <POverviewA T={T}/>}
      {variant === 'B' && <POverviewB T={T}/>}
      {variant === 'C' && <POverviewC T={T}/>}
      {variant === 'D' && <POverviewD T={T}/>}
    </div>
  );
};

// ─── POverview A · 累積感（資訊密集 / 現有版本）─────────────────
const POverviewA = ({ T }) => {
  const STATS = POV_STATS;
  const COURSE_DEPTH = POV_COURSE_DEPTH;
  const CONCEPTS = POV_CONCEPTS;
  const MILESTONES = POV_MILESTONES;
  const milestoneRemaining = STATS.nextMilestone - STATS.totalHours;
  const deepest = COURSE_DEPTH[0];
  const maxHours = COURSE_DEPTH[0].hours;
  const maxConceptN = CONCEPTS[0].n;

  return (
    <div>
      {/* ─── HERO 區：累積時數大數字 ───────────────────── */}
      <div style={{ padding: '32px 0 28px',
        borderBottom: `1px solid ${T.borderSoft}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 24 }}>
          <div style={{ width: 36, height: 36, borderRadius: 18,
            background: '#c48a2c', color: '#fff', display: 'grid',
            placeItems: 'center', fontSize: 14, fontWeight: 800 }}>H</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
              Hank 黃
            </div>
            <div style={{ fontSize: 10, color: T.textDim,
              fontFamily: 'JetBrains Mono', letterSpacing: '0.06em' }}>
              從 {STATS.startDate} 開始使用 · {Math.round((Date.now() - new Date(STATS.startDate).getTime()) / (1000 * 60 * 60 * 24))} 天
            </div>
          </div>
          <div style={{ flex: 1 }}/>
          <H18LogoutButton T={T}/>
        </div>

        {/* Hero number */}
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{ fontSize: 12, letterSpacing: '0.24em',
            color: T.textDim, fontWeight: 700,
            fontFamily: 'JetBrains Mono', marginBottom: 8 }}>
            你已經累積了
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'baseline',
            gap: 12, color: T.text }}>
            <span style={{ fontSize: 88, fontWeight: 800,
              fontFamily: 'JetBrains Mono', letterSpacing: '-0.04em',
              color: T.accent, lineHeight: 1 }}>
              {STATS.totalHours.toFixed(1)}
            </span>
            <span style={{ fontSize: 22, fontWeight: 600,
              color: T.textMid, letterSpacing: '-0.01em' }}>
              小時的學習
            </span>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: T.textMid,
            display: 'inline-flex', gap: 18, flexWrap: 'wrap',
            justifyContent: 'center' }}>
            {[
              { v: STATS.lectures, l: 'lectures' },
              { v: STATS.concepts, l: 'concepts' },
              { v: STATS.courses,  l: 'courses' },
              { v: STATS.aiChats,  l: 'AI 對話' },
            ].map(s => (
              <span key={s.l} style={{ display: 'inline-flex',
                alignItems: 'baseline', gap: 5 }}>
                <b style={{ fontSize: 16, fontWeight: 800, color: T.text,
                  fontFamily: 'JetBrains Mono',
                  letterSpacing: '-0.02em' }}>{s.v}</b>
                <span style={{ fontSize: 11, color: T.textDim }}>{s.l}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ─── 三個並排 achievement panels ──────────────── */}
      <div style={{ marginTop: 24, display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>

        {/* Panel 1: 最深入的課程 */}
        <div style={{ padding: 16, borderRadius: 10,
          background: T.surface2, border: `1px solid ${T.borderSoft}`,
          position: 'relative', overflow: 'hidden' }}>
          {/* 課程色條 */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0,
            width: 4, background: deepest.color }}/>
          <div style={{ paddingLeft: 8 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.16em',
              color: T.textDim, fontWeight: 800,
              fontFamily: 'JetBrains Mono' }}>
              ✦ 最深入投入
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.text,
              letterSpacing: '-0.02em', marginTop: 8, lineHeight: 1.2 }}>
              {deepest.name}
            </div>
            <div style={{ fontSize: 10, color: T.textDim,
              fontFamily: 'JetBrains Mono', marginTop: 2,
              letterSpacing: '0.04em' }}>
              {deepest.short}
            </div>
            <div style={{ marginTop: 14, display: 'flex',
              flexDirection: 'column', gap: 8 }}>
              {[
                { l: '錄音時數',     v: `${deepest.hours.toFixed(1)}h` },
                { l: '已錄 lectures', v: `${deepest.lecturesDone} / ${deepest.lecturesTotal}` },
                { l: '學到概念',     v: `${deepest.concepts} 個` },
              ].map(r => (
                <div key={r.l} style={{ display: 'flex',
                  justifyContent: 'space-between', alignItems: 'baseline',
                  fontSize: 11 }}>
                  <span style={{ color: T.textDim }}>{r.l}</span>
                  <span style={{ color: T.text, fontWeight: 700,
                    fontFamily: 'JetBrains Mono',
                    letterSpacing: '-0.01em' }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Panel 2: 概念地圖 */}
        <div style={{ padding: 16, borderRadius: 10,
          background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
          <div style={{ fontSize: 9, letterSpacing: '0.16em',
            color: T.textDim, fontWeight: 800,
            fontFamily: 'JetBrains Mono' }}>
            ✦ 你學到的概念
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text,
            letterSpacing: '-0.02em', marginTop: 8 }}>
            {STATS.concepts} concepts
          </div>
          <div style={{ fontSize: 10, color: T.textDim,
            fontFamily: 'JetBrains Mono', marginTop: 2 }}>
            橫跨 {STATS.courses} 門課
          </div>
          <div style={{ marginTop: 14, display: 'flex',
            flexDirection: 'column', gap: 4 }}>
            {CONCEPTS.slice(0, 6).map(c => {
              const w = (c.n / maxConceptN) * 100;
              const cd = COURSE_DEPTH.find(x => x.id === c.course);
              return (
                <div key={c.k} style={{ position: 'relative',
                  padding: '4px 8px', borderRadius: 4,
                  background: `linear-gradient(90deg, ${cd.color}22 ${w}%, transparent ${w}%)`,
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'baseline', fontSize: 11 }}>
                  <span style={{ color: T.text, fontWeight: 600,
                    letterSpacing: '-0.005em' }}>{c.k}</span>
                  <span style={{ color: T.textDim,
                    fontFamily: 'JetBrains Mono', fontSize: 10,
                    fontWeight: 700 }}>{c.n}×</span>
                </div>
              );
            })}
            <div style={{ marginTop: 4, fontSize: 10, color: T.textFaint,
              textAlign: 'right', fontFamily: 'JetBrains Mono' }}>
              + 還有 {STATS.concepts - 6} 個 →
            </div>
          </div>
        </div>

        {/* Panel 3: 學習旅程 */}
        <div style={{ padding: 16, borderRadius: 10,
          background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
          <div style={{ fontSize: 9, letterSpacing: '0.16em',
            color: T.textDim, fontWeight: 800,
            fontFamily: 'JetBrains Mono' }}>
            ✦ 學習旅程
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text,
            letterSpacing: '-0.02em', marginTop: 8 }}>
            {MILESTONES.filter(m => m.done).length} 個里程碑
          </div>
          <div style={{ fontSize: 10, color: T.textDim,
            fontFamily: 'JetBrains Mono', marginTop: 2 }}>
            下一個：100 小時
          </div>
          <div style={{ marginTop: 14, position: 'relative' }}>
            {/* 垂直連線 */}
            <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4,
              width: 1, background: T.borderSoft }}/>
            {MILESTONES.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10,
                paddingBottom: 10, position: 'relative' }}>
                <span style={{ width: 11, height: 11, borderRadius: 6,
                  flexShrink: 0, marginTop: 1,
                  background: m.done ? T.accent : 'transparent',
                  border: m.done ? 'none' : `1.5px dashed ${T.border}`,
                  position: 'relative', zIndex: 1 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600,
                    color: m.done ? T.text : T.textMid,
                    letterSpacing: '-0.005em' }}>{m.t}</div>
                  <div style={{ fontSize: 10, color: T.textDim,
                    marginTop: 1, fontFamily: m.d ? 'JetBrains Mono' : 'inherit' }}>
                    {m.d || m.m}
                    {m.d && <span style={{ marginLeft: 6, color: T.textFaint,
                      fontFamily: 'inherit' }}>{m.m}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── 各課程進度條 ──────────────────────────────── */}
      <PHead T={T}>各課程深度</PHead>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column',
        gap: 6 }}>
        {COURSE_DEPTH.map(c => {
          const w = (c.hours / maxHours) * 100;
          const lectureRatio = c.lecturesDone / c.lecturesTotal;
          return (
            <div key={c.id} style={{ padding: '10px 12px', borderRadius: 8,
              background: T.surface2, border: `1px solid ${T.borderSoft}`,
              display: 'grid',
              gridTemplateColumns: '60px 1fr 80px 80px 90px',
              gap: 14, alignItems: 'center', cursor: 'pointer' }}>
              <span style={{ fontSize: 10, fontWeight: 800,
                color: c.color, fontFamily: 'JetBrains Mono',
                letterSpacing: '0.06em',
                padding: '3px 8px', borderRadius: 4,
                background: T.mode === 'dark' ? `${c.color}22` : `${c.color}15`,
                textAlign: 'center' }}>{c.short}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                  {c.name}
                </div>
                <div style={{ marginTop: 5, height: 4, borderRadius: 2,
                  background: T.border, position: 'relative',
                  overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0,
                    width: `${w}%`,
                    background: c.color }}/>
                </div>
              </div>
              <span style={{ fontSize: 12, color: T.text, fontWeight: 700,
                fontFamily: 'JetBrains Mono', letterSpacing: '-0.02em' }}>
                {c.hours.toFixed(1)}h
              </span>
              <span style={{ fontSize: 11, color: T.textDim,
                fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                {c.lecturesDone}/{c.lecturesTotal} lec
              </span>
              <span style={{ fontSize: 11, color: T.textDim,
                fontFamily: 'JetBrains Mono', textAlign: 'right' }}>
                {c.concepts} concepts
              </span>
            </div>
          );
        })}
      </div>

      {/* ─── 下個目標（小尾，給予前進感而非壓力）─────── */}
      <div style={{ marginTop: 24, padding: '14px 16px', borderRadius: 10,
        background: T.surface2,
        border: `1px dashed ${T.borderSoft}`,
        display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 22, color: T.accent, lineHeight: 1 }}>◐</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
            下個里程碑：累積 {STATS.nextMilestone} 小時的學習
          </div>
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>
            還差 {milestoneRemaining.toFixed(1)} 小時 · 按你目前的節奏約 6 月初達成
          </div>
        </div>
        <div style={{ minWidth: 120, height: 6, borderRadius: 3,
          background: T.border, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0,
            width: `${(STATS.totalHours / STATS.nextMilestone) * 100}%`,
            background: T.accent }}/>
        </div>
        <span style={{ fontSize: 11, color: T.textMid, fontWeight: 700,
          fontFamily: 'JetBrains Mono', minWidth: 40, textAlign: 'right' }}>
          {Math.round((STATS.totalHours / STATS.nextMilestone) * 100)}%
        </span>
      </div>
    </div>
  );
};

// ─── POverview B · 編輯刊物 (Fraunces serif · asymmetric · 邊註) ───
// 像翻開一本季刊或學術年報的開卷頁。重點：
//   · 大 serif 標題 (Fraunces) + 數字內嵌在散文裡
//   · 2/3 + 1/3 不對稱排版，右欄是邊註 marginalia
//   · 開頭有 drop cap
//   · 章節間用 horizontal rule 做斷
//   · 配色極簡（只有文字色 + 一個 accent）
const POverviewB = ({ T }) => {
  const SERIF = '"Fraunces", "Noto Serif TC", Georgia, serif';
  const MONO  = 'JetBrains Mono';

  const Rule = () => (
    <div style={{ margin: '36px auto', width: 80, height: 1,
      background: T.borderSoft, position: 'relative' }}>
      <span style={{ position: 'absolute', left: '50%',
        top: '50%', transform: 'translate(-50%, -50%)',
        background: T.surface, padding: '0 10px',
        color: T.textFaint, fontSize: 10,
        fontFamily: MONO, letterSpacing: '0.2em' }}>§</span>
    </div>
  );

  const SmallCaps = ({ children, mt = 0 }) => (
    <div style={{ fontSize: 10, letterSpacing: '0.22em',
      color: T.textDim, fontWeight: 700, fontFamily: MONO,
      textTransform: 'uppercase', marginTop: mt, marginBottom: 8 }}>
      {children}
    </div>
  );

  return (
    <div style={{ fontFamily: SERIF, color: T.text, maxWidth: 920,
      margin: '0 auto', padding: '8px 0 40px' }}>

      {/* Masthead */}
      <div style={{ display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${T.border}`,
        paddingBottom: 12, marginBottom: 28 }}>
        <span style={{ fontSize: 11, fontFamily: MONO,
          color: T.textDim, letterSpacing: '0.22em', fontWeight: 700,
          textTransform: 'uppercase' }}>
          ClassNote · Spring 2026
        </span>
        <span style={{ fontSize: 11, fontFamily: MONO,
          color: T.textFaint, letterSpacing: '0.16em', fontWeight: 600 }}>
          Personal Review · No. 03
        </span>
      </div>

      {/* Hero serif headline */}
      <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
        <div style={{ fontSize: 14, fontStyle: 'italic',
          color: T.textMid, marginBottom: 14, fontFamily: SERIF }}>
          你已經累積了
        </div>
        <div style={{ fontSize: 80, fontWeight: 600,
          letterSpacing: '-0.04em', lineHeight: 1, fontFamily: SERIF,
          color: T.text }}>
          47<span style={{ color: T.accent }}>.</span>3
        </div>
        <div style={{ fontSize: 17, marginTop: 10, color: T.textMid,
          fontStyle: 'italic', fontFamily: SERIF,
          letterSpacing: '0.02em' }}>
          小時的學習 · hours of learning
        </div>
      </div>

      {/* Asymmetric body — 2/3 main + 1/3 marginalia */}
      <div style={{ display: 'grid',
        gridTemplateColumns: '1fr 240px', gap: 36,
        marginTop: 32 }}>

        {/* Main column */}
        <div>
          <p style={{ fontSize: 16, lineHeight: 1.85,
            color: T.text, margin: 0, textIndent: 0,
            fontFamily: SERIF }}>
            <span style={{ float: 'left', fontSize: 56, lineHeight: 0.85,
              padding: '4px 8px 0 0', fontWeight: 700,
              fontFamily: SERIF, color: T.text }}>從</span>
            2026 年 2 月開始使用 ClassNote 至此，已經 84 天了。
            這段期間裡，你跨越了 <b>6</b> 門課程、錄了 <b>60</b> 堂
            lectures，並在其中累積出 <b style={{ color: T.accent }}>142</b> 個
            關鍵概念。投入最多的是「機器學習」這門課
            ── 共 <b>14</b> 小時 <b>22</b> 分鐘，
            11 堂 lectures 已錄，學到 38 個概念。
          </p>

          <Rule/>

          <SmallCaps>最常出現的概念</SmallCaps>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {POV_CONCEPTS.slice(0, 6).map((c, i) => {
              const cd = POV_COURSE_DEPTH.find(x => x.id === c.course);
              return (
                <div key={c.k} style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr 60px 60px',
                  gap: 14, alignItems: 'baseline',
                  padding: '4px 0',
                  borderBottom: `1px dotted ${T.borderSoft}` }}>
                  <span style={{ fontSize: 12, fontFamily: MONO,
                    color: T.textFaint, fontWeight: 600,
                    textAlign: 'right' }}>
                    {String(i + 1).padStart(2, ' ')}
                  </span>
                  <span style={{ fontSize: 16, fontFamily: SERIF,
                    color: T.text, fontStyle: 'italic',
                    fontWeight: 500 }}>{c.k}</span>
                  <span style={{ fontSize: 11, fontFamily: MONO,
                    color: cd.color, letterSpacing: '0.06em',
                    fontWeight: 700, textAlign: 'right' }}>
                    {cd.short}
                  </span>
                  <span style={{ fontSize: 13, fontFamily: SERIF,
                    color: T.textMid, textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums' }}>
                    {c.n} 次
                  </span>
                </div>
              );
            })}
          </div>

          <Rule/>

          <SmallCaps>各課程的深度</SmallCaps>
          {POV_COURSE_DEPTH.map(c => (
            <div key={c.id} style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr 110px',
              gap: 16, alignItems: 'baseline',
              padding: '8px 0',
              borderBottom: `1px dotted ${T.borderSoft}` }}>
              <span style={{ fontSize: 16, fontFamily: SERIF,
                color: T.text, fontWeight: 500 }}>{c.name}</span>
              <div style={{ height: 2, background: T.borderSoft,
                position: 'relative', alignSelf: 'center' }}>
                <div style={{ position: 'absolute', inset: 0,
                  width: `${(c.hours / POV_COURSE_DEPTH[0].hours) * 100}%`,
                  background: c.color }}/>
              </div>
              <span style={{ fontSize: 14, fontFamily: SERIF,
                color: T.textMid, textAlign: 'right',
                fontVariantNumeric: 'tabular-nums' }}>
                {c.hours.toFixed(1)}<span style={{ color: T.textFaint,
                  fontSize: 11, marginLeft: 3 }}>h</span>
              </span>
            </div>
          ))}

          <Rule/>

          <SmallCaps>學習旅程</SmallCaps>
          {POV_MILESTONES.map((m, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr',
              gap: 18, alignItems: 'baseline',
              padding: '7px 0',
              borderBottom: i < POV_MILESTONES.length - 1
                ? `1px dotted ${T.borderSoft}` : 'none' }}>
              <span style={{ fontSize: 12, fontFamily: MONO,
                color: m.done ? T.textMid : T.textFaint,
                letterSpacing: '0.08em',
                fontVariantNumeric: 'tabular-nums' }}>
                {m.d ? m.d.replace(/-/g, '·') : '— · — — · — —'}
              </span>
              <div>
                <div style={{ fontSize: 15, fontFamily: SERIF,
                  color: m.done ? T.text : T.textMid,
                  fontWeight: m.done ? 500 : 500,
                  fontStyle: m.done ? 'normal' : 'italic' }}>
                  {m.t}
                </div>
                <div style={{ fontSize: 12, fontFamily: SERIF,
                  color: T.textDim, fontStyle: 'italic',
                  marginTop: 2 }}>{m.m}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Marginalia column — 短評 + 上下文 */}
        <div style={{ borderLeft: `1px solid ${T.borderSoft}`,
          paddingLeft: 24, fontSize: 12, color: T.textMid,
          fontFamily: SERIF, lineHeight: 1.75 }}>

          <div style={{ marginBottom: 24 }}>
            <SmallCaps>邊註 · scaling factor</SmallCaps>
            <p style={{ margin: 0, fontStyle: 'italic' }}>
              這個詞在這份回顧裡出現了 12 次，主要在 ML L13 之後反覆
              出現，是 Transformer 注意力機制裡用來避免 softmax 飽和
              的關鍵縮放因子（√d_k）。
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <SmallCaps>分布</SmallCaps>
            <p style={{ margin: 0 }}>
              {POV_STATS.concepts} 個概念中，<b>54%</b> 來自
              機器學習與線性代數兩門基礎課，
              其餘均勻散布在系統與演算法。
            </p>
          </div>

          <div style={{ marginBottom: 24 }}>
            <SmallCaps>節奏</SmallCaps>
            <p style={{ margin: 0 }}>
              平均每週 <b>3.9 小時</b> · 每堂 lecture
              約 <b>47 分鐘</b>。距離下個 100 小時里程碑
              還剩 <b style={{ color: T.accent }}>52.7</b> 小時，
              依目前節奏約 6 月初達成。
            </p>
          </div>

          <div>
            <SmallCaps>環境</SmallCaps>
            <p style={{ margin: 0, fontFamily: MONO, fontSize: 11,
              lineHeight: 1.7, fontStyle: 'normal' }}>
              Parakeet INT8 · loaded<br/>
              TranslateGemma 4B · sidecar OK<br/>
              GitHub Models · default
            </p>
          </div>
        </div>
      </div>

      {/* Colophon */}
      <div style={{ marginTop: 48, paddingTop: 16,
        borderTop: `1px solid ${T.border}`,
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline',
        fontSize: 10, color: T.textFaint, fontFamily: MONO,
        letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        <span>Generated for Hank · 2026·04·25</span>
        <span>ClassNote · v0.6.5</span>
      </div>
    </div>
  );
};

// ─── POverview C · 書信體（散文回顧）─────────────────────────────
// 單欄、窄一點 (560px)，全 serif 散文，第一人稱反思感。
// 像每月寫給自己的學習回顧信。
const POverviewC = ({ T }) => {
  const SERIF = '"Fraunces", "Noto Serif TC", Georgia, serif';
  const MONO  = 'JetBrains Mono';
  const num = (v, suffix = '') => (
    <span style={{ fontFamily: SERIF, fontWeight: 600,
      fontVariantNumeric: 'tabular-nums', color: T.text }}>
      {v}{suffix}
    </span>
  );

  return (
    <div style={{ fontFamily: SERIF, color: T.text,
      maxWidth: 600, margin: '0 auto', padding: '24px 0 60px',
      lineHeight: 1.85, fontSize: 16 }}>

      {/* Letterhead */}
      <div style={{ textAlign: 'right', fontSize: 11,
        color: T.textDim, fontFamily: MONO, letterSpacing: '0.12em',
        marginBottom: 32 }}>
        ClassNote · 04 · 25 · 2026<br/>
        <span style={{ color: T.textFaint }}>—— 寫給 Hank</span>
      </div>

      {/* Salutation */}
      <p style={{ fontStyle: 'italic', fontSize: 17, color: T.text,
        margin: '0 0 28px', fontWeight: 500 }}>
        親愛的 Hank，
      </p>

      {/* Body paragraphs */}
      <p style={{ margin: '0 0 22px' }}>
        你這學期到目前為止，已經累積了 {num(47.3, ' 小時')}的學習。
        從 2 月 1 日開始，到今天剛好是第 {num(84)} 天。
      </p>

      <p style={{ margin: '0 0 22px' }}>
        這段時間裡，你錄了 {num(60)} 堂 lectures，學到 {num(142)} 個
        關鍵概念，跨越 {num(6)} 門課。投入最多的是
        <span style={{ fontStyle: 'italic', fontWeight: 600 }}> 機器學習</span>
         ── {num(14.4, '小時')}、{num(11)} 堂 lectures、
        {num(38)} 個概念；其次是
        <span style={{ fontStyle: 'italic', fontWeight: 600 }}> 作業系統</span>
        ，{num(9.1, '小時')}。
      </p>

      <p style={{ margin: '0 0 22px' }}>
        在這些課裡，你最常碰到的詞是
        <span style={{ fontStyle: 'italic', fontWeight: 600,
          color: T.accent }}> scaling factor</span>，出現了 {num(12)} 次；
        其次是 <span style={{ fontStyle: 'italic' }}>self-attention</span>
        （{num(9)} 次）、<span style={{ fontStyle: 'italic' }}>softmax</span>
        （{num(7)} 次）。這三個都圍繞著注意力機制，看來你這學期確實
        在這塊鑽得比較深。
      </p>

      {/* Ornamental separator */}
      <div style={{ textAlign: 'center', margin: '36px 0',
        color: T.textFaint, fontSize: 14, letterSpacing: '0.6em',
        fontFamily: SERIF }}>
        ❦ &nbsp; ❦ &nbsp; ❦
      </div>

      {/* Milestones — list-like but typeset */}
      <div style={{ marginBottom: 28 }}>
        <p style={{ margin: '0 0 14px',
          fontSize: 13, letterSpacing: '0.18em',
          fontFamily: MONO, color: T.textDim, fontWeight: 700,
          textTransform: 'uppercase' }}>
          一些已抵達的點
        </p>
        {POV_MILESTONES.filter(m => m.done).map(m => (
          <div key={m.t} style={{
            display: 'grid', gridTemplateColumns: '110px 1fr',
            gap: 18, padding: '4px 0',
            fontSize: 14, lineHeight: 1.7 }}>
            <span style={{ fontFamily: MONO, fontSize: 12,
              color: T.textMid, letterSpacing: '0.06em',
              fontVariantNumeric: 'tabular-nums' }}>
              {m.d.replace(/-/g, '·')}
            </span>
            <span style={{ fontFamily: SERIF, color: T.text }}>
              {m.t}
              <span style={{ fontStyle: 'italic', color: T.textDim,
                marginLeft: 6, fontSize: 13 }}>
                — {m.m}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Continuing paragraph */}
      <p style={{ margin: '0 0 22px' }}>
        下一個目標是累積 {num(100, ' 小時')}的學習。還差 {num(52.7, ' 小時')}，
        按你目前每週 {num(3.9, ' 小時')}的節奏，約 6 月初可以達成。
        我會繼續記錄你的累積。
      </p>

      <div style={{ textAlign: 'center', margin: '36px 0',
        color: T.textFaint, fontSize: 14, letterSpacing: '0.6em',
        fontFamily: SERIF }}>
        ❦ &nbsp; ❦ &nbsp; ❦
      </div>

      {/* Sign-off */}
      <p style={{ margin: '0 0 8px', fontStyle: 'italic',
        color: T.textMid, fontSize: 14 }}>
        今天就先寫到這。
      </p>
      <p style={{ margin: 0, textAlign: 'right',
        fontStyle: 'italic', color: T.textMid,
        fontSize: 14 }}>
        ── ClassNote
      </p>
    </div>
  );
};

// ─── POverview D · 精煉（Apple / Stripe / Linear 等級的克制）──────
// 設計動作：
//   · 拿掉所有卡片框、所有背景填色 — 純文字 + 留白
//   · 字重對比做層次 (200 thin vs 800 extrabold)
//   · accent 色整頁只用 1 次（hero 小數點 + 進度條）
//   · 課程深度從色條卡 → 純 typography 表格 (像 Unix top 的克制)
//   · 概念用 monospace 對齊欄
//   · 章節間靠 60-80px 留白分節，不靠線
//   · 一張頁面，一個聲音
const POverviewD = ({ T }) => {
  const SANS = '"Inter", "Noto Sans TC", system-ui, sans-serif';
  const MONO = 'JetBrains Mono';
  const STATS = POV_STATS;
  const COURSES = POV_COURSE_DEPTH;
  const CONCEPTS = POV_CONCEPTS;
  const MILESTONES = POV_MILESTONES;
  const days = Math.round((Date.now() - new Date(STATS.startDate).getTime()) / 86400000);
  const milestonePct = STATS.totalHours / STATS.nextMilestone;
  const milestoneRemaining = STATS.nextMilestone - STATS.totalHours;
  const maxConceptN = CONCEPTS[0].n;
  const maxHours = COURSES[0].hours;
  const deepest = COURSES[0];

  // Tabular figures for all numbers — 對齊感
  const numStyle = {
    fontFamily: SANS, fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
  };

  // 細小的章節標記 — 取代 PHead，更克制
  const Marker = ({ n, label }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16,
      marginBottom: 28 }}>
      <span style={{ fontSize: 11, fontFamily: MONO, color: T.textFaint,
        fontWeight: 500, letterSpacing: '0.16em',
        fontVariantNumeric: 'tabular-nums' }}>
        {String(n).padStart(2, '0')}
      </span>
      <span style={{ fontSize: 12, color: T.textMid, fontWeight: 500,
        letterSpacing: '0.06em', fontFamily: SANS }}>
        {label}
      </span>
    </div>
  );

  return (
    <div style={{ fontFamily: SANS, color: T.text,
      maxWidth: 760, margin: '0 auto', padding: '40px 20px 80px' }}>

      {/* ─── Hero · 安靜版 ─────────────────────────────── */}
      <div style={{ paddingBottom: 80 }}>
        <div style={{ fontSize: 11, fontFamily: MONO,
          color: T.textFaint, letterSpacing: '0.18em',
          fontWeight: 500, marginBottom: 32 }}>
          HANK · SINCE 2026·02·01 · {days} DAYS
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span style={{ fontSize: 96, fontWeight: 200,
            letterSpacing: '-0.05em', lineHeight: 0.95,
            ...numStyle, color: T.text }}>
            47<span style={{ color: T.accent, fontWeight: 200 }}>.</span>3
          </span>
          <span style={{ fontSize: 18, fontWeight: 500,
            color: T.textMid, marginLeft: 4 }}>
            小時
          </span>
        </div>

        <div style={{ marginTop: 24, display: 'flex',
          gap: 36, fontSize: 13, color: T.textMid,
          fontWeight: 400, flexWrap: 'wrap' }}>
          <span><span style={{ ...numStyle, color: T.text,
            fontWeight: 600 }}>{STATS.lectures}</span> lectures</span>
          <span><span style={{ ...numStyle, color: T.text,
            fontWeight: 600 }}>{STATS.concepts}</span> concepts</span>
          <span><span style={{ ...numStyle, color: T.text,
            fontWeight: 600 }}>{STATS.courses}</span> courses</span>
          <span><span style={{ ...numStyle, color: T.text,
            fontWeight: 600 }}>{STATS.aiChats}</span> AI 對話</span>
        </div>
      </div>

      {/* ─── 01 · 最深入 — 純 typography，無卡片 ─────── */}
      <div style={{ paddingBottom: 64 }}>
        <Marker n={1} label="最深入投入"/>
        <div style={{ fontSize: 36, fontWeight: 800,
          letterSpacing: '-0.025em', lineHeight: 1.05, color: T.text,
          marginBottom: 8 }}>
          {deepest.name}
        </div>
        <div style={{ fontSize: 13, color: T.textMid,
          display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <span style={numStyle}>{deepest.hours.toFixed(1)} 小時</span>
          <span style={{ color: T.textFaint }}>·</span>
          <span style={numStyle}>{deepest.lecturesDone}/{deepest.lecturesTotal} lectures</span>
          <span style={{ color: T.textFaint }}>·</span>
          <span style={numStyle}>{deepest.concepts} 個概念</span>
        </div>
      </div>

      {/* ─── 02 · 概念 — Unix-top-style monospace 表格 ─── */}
      <div style={{ paddingBottom: 64 }}>
        <Marker n={2} label="最常碰到的概念"/>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {CONCEPTS.slice(0, 8).map(c => {
            const w = (c.n / maxConceptN) * 100;
            const cd = COURSES.find(x => x.id === c.course);
            return (
              <div key={c.k} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 220px 40px',
                gap: 16, alignItems: 'center',
                padding: '11px 0',
                fontSize: 14, fontFamily: SANS,
              }}>
                <span style={{ color: T.text, fontWeight: 500,
                  letterSpacing: '-0.005em' }}>
                  {c.k}
                </span>
                <span style={{ ...numStyle, color: T.textMid,
                  fontSize: 12, textAlign: 'right',
                  fontFamily: MONO, fontWeight: 500 }}>
                  {c.n}×
                </span>
                {/* 細線視覺，不撒色 */}
                <div style={{ height: 1, background: T.borderSoft,
                  position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0,
                    height: 1, width: `${w}%`, background: T.text }}/>
                </div>
                <span style={{ fontSize: 10, fontFamily: MONO,
                  color: T.textFaint, fontWeight: 600,
                  letterSpacing: '0.06em', textAlign: 'right' }}>
                  {cd.short}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: T.textFaint }}>
          + 還有 {STATS.concepts - 8} 個概念
        </div>
      </div>

      {/* ─── 03 · 各課程 — 最克制的表格 ───────────────── */}
      <div style={{ paddingBottom: 64 }}>
        <Marker n={3} label="各課程的累積"/>
        <div>
          {COURSES.map(c => {
            const w = (c.hours / maxHours) * 100;
            return (
              <div key={c.id} style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 80px 90px 80px',
                gap: 24, alignItems: 'center',
                padding: '14px 0',
                borderBottom: `1px solid ${T.borderSoft}`,
                fontSize: 14,
              }}>
                <div>
                  <div style={{ color: T.text, fontWeight: 500,
                    letterSpacing: '-0.005em' }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: T.textFaint,
                    fontFamily: MONO, letterSpacing: '0.08em',
                    marginTop: 2 }}>{c.short}</div>
                </div>
                {/* 微細的橫條 */}
                <div style={{ height: 2, background: T.borderSoft,
                  position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: 0,
                    width: `${w}%`, background: c.color, opacity: 0.85 }}/>
                </div>
                <span style={{ ...numStyle, color: T.text,
                  fontWeight: 600, textAlign: 'right' }}>
                  {c.hours.toFixed(1)}<span style={{ fontSize: 11,
                    color: T.textFaint, marginLeft: 2 }}>h</span>
                </span>
                <span style={{ ...numStyle, color: T.textMid,
                  fontSize: 12, textAlign: 'right' }}>
                  {c.lecturesDone}/{c.lecturesTotal} lec
                </span>
                <span style={{ ...numStyle, color: T.textMid,
                  fontSize: 12, textAlign: 'right' }}>
                  {c.concepts} concepts
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── 04 · 旅程 — 純 typography 時間軸 ─────────── */}
      <div style={{ paddingBottom: 64 }}>
        <Marker n={4} label="學習旅程"/>
        <div>
          {MILESTONES.map((m, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '120px 1fr',
              gap: 24, alignItems: 'baseline',
              padding: '12px 0',
              borderBottom: i < MILESTONES.length - 1
                ? `1px solid ${T.borderSoft}` : 'none',
            }}>
              <span style={{ fontSize: 11, fontFamily: MONO,
                color: m.done ? T.textMid : T.textFaint,
                letterSpacing: '0.1em', fontWeight: 500,
                fontVariantNumeric: 'tabular-nums' }}>
                {m.d ? m.d.replace(/-/g, '·') : '—————————'}
              </span>
              <div>
                <div style={{ fontSize: 15,
                  color: m.done ? T.text : T.textMid,
                  fontWeight: m.done ? 500 : 500,
                  letterSpacing: '-0.005em' }}>
                  {m.t}
                </div>
                <div style={{ fontSize: 12, color: T.textDim,
                  marginTop: 3 }}>{m.m}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── 05 · 下一段 — 整頁唯一第二次用 accent 色 ─── */}
      <div>
        <Marker n={5} label="下一段路"/>
        <div style={{ display: 'flex', alignItems: 'baseline',
          gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 32, fontWeight: 200,
            letterSpacing: '-0.03em', ...numStyle,
            color: T.text }}>
            {STATS.nextMilestone}
          </span>
          <span style={{ fontSize: 14, color: T.textMid }}>小時</span>
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 13, color: T.textDim }}>
            還差 <span style={{ ...numStyle, color: T.text,
              fontWeight: 600 }}>{milestoneRemaining.toFixed(1)}</span> 小時
          </span>
        </div>
        {/* 細進度線 */}
        <div style={{ height: 1, background: T.borderSoft,
          position: 'relative', marginBottom: 10 }}>
          <div style={{ position: 'absolute', left: 0, top: -1,
            width: `${milestonePct * 100}%`, height: 3,
            background: T.accent }}/>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: T.textFaint,
          fontFamily: MONO, letterSpacing: '0.08em' }}>
          <span>{Math.round(milestonePct * 100)}%</span>
          <span>EST. EARLY JUNE</span>
        </div>
      </div>
    </div>
  );
};

const PTranscribe = ({ T }) => (
  <div>
    <PHeader T={T} title="本地轉錄模型"
      hint="Parakeet (NVIDIA Nemotron-Speech-Streaming-EN-0.6B) 在本機上跑 — 離線、不上雲、不用付 API 費用。透過 parakeet-rs crate in-process 執行，無需獨立 sidecar。"/>

    <PHead T={T}>模型</PHead>
    <PRow T={T} label="目前使用" hint="點選即切換；未下載的會提示先下載"
      right={<PSelect T={T} value="Parakeet · INT8 (推薦, 已載入)" options={[
        'Parakeet · INT8 (推薦, 已載入)',
        'Parakeet · FP32 (進階)',
      ]}/>}/>
    <PRow T={T} label="模型管理" hint="已下載 1 / 2 · 佔用 852 MB">
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          { name: 'parakeet-int8', size: '852 MB', wer: 'WER 8.01%',
            status: '已載入', loaded: true,
            hint: '8-bit 量化 · 推薦：精度差距在誤差內，下載快 3×' },
          { name: 'parakeet-fp32', size: '2.5 GB', wer: 'WER 8.03%',
            status: '未下載',
            hint: '原版浮點 · 對精度有極致要求 / 想做 A/B 比較的進階使用者' },
        ].map(m => (
          <div key={m.name} style={{
            padding: '10px 12px', borderRadius: 6,
            border: `1px solid ${m.loaded ? T.accent : T.borderSoft}`,
            background: m.loaded ? T.chipBg : T.surface2,
            display: 'grid', gridTemplateColumns: '140px 80px 80px 1fr auto',
            gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600,
              color: T.text, fontFamily: 'JetBrains Mono' }}>{m.name}</div>
            <div style={{ fontSize: 10, color: T.textDim,
              fontFamily: 'JetBrains Mono' }}>{m.size}</div>
            <div style={{ fontSize: 10, color: T.textDim,
              fontFamily: 'JetBrains Mono' }}>{m.wer}</div>
            <div style={{ fontSize: 10, color: T.textMid, lineHeight: 1.4 }}>
              {m.hint}
            </div>
            {m.status === '未下載' && <PBtn T={T}>下載</PBtn>}
            {m.loaded && <PBtn T={T}>已載入</PBtn>}
          </div>
        ))}
      </div>
    </PRow>

    <PHead T={T}>GPU / 效能</PHead>
    <PRow T={T} label="後端偏好" hint="Auto 會在偵測到的後端中選最佳。目前偵測到 CUDA 12.3 · RTX 4070"
      right={<PSelect T={T} value="Auto" options={['Auto', 'CUDA', 'Metal', 'Vulkan', 'CPU']}/>}/>
    <PRow T={T} label="GPU 偵測結果"
      hint={<span style={{ fontFamily: 'JetBrains Mono', color: T.accent }}>
        ✓ CUDA 12.3 可用 · 12 GB VRAM<br/>
        ✗ Metal 不可用 (Windows)<br/>
        ✓ Vulkan 1.3 可用 (fallback)<br/>
        ✓ CPU 16 執行緒
      </span>}
      right={<PBtn T={T}>重新偵測</PBtn>}/>
    <PRow T={T} label="匯入轉錄速度預設"
      hint="Fast = 用較小變體跑批次匯入（約 5–10 分鐘 / 小時影片）。Standard = 主設定的模型（較慢但最高精度）"
      right={<PSelect T={T} value="Fast" options={['Fast', 'Standard']}/>}/>

    <PHead T={T}>進階</PHead>
    <PRow T={T} label="遠端除錯 port (CDP)"
      hint="讓外部 agent 透過 Chrome DevTools Protocol 控制 webview。改動需重啟"
      right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <PInput T={T} value="9223" monospace/>
        <PToggle T={T} on={false}/>
      </div>}/>
    <PRow T={T} label="Log 等級"
      right={<PSelect T={T} value="info" options={['error', 'warn', 'info', 'debug', 'trace']}/>}/>
  </div>
);

const PTranslate = ({ T }) => (
  <div>
    <PHeader T={T} title="翻譯服務"
      hint="控制字幕、摘要、Q&A 的翻譯方向與引擎。TranslateGemma (本地 LLM) 為主、Google 為備、CT2 為 dev fallback。"/>

    <PHead T={T}>引擎</PHead>
    <PRow T={T} label="翻譯後端" hint="切換生效後新字幕會用新引擎；舊字幕需重新精修才會更新"
      right={<div style={{ display: 'flex', gap: 4,
        padding: 3, borderRadius: 7, background: T.surface2,
        border: `1px solid ${T.border}` }}>
        {[
          { k: 'gemma',  label: 'TranslateGemma', primary: true },
          { k: 'google', label: 'Google Cloud' },
          { k: 'local',  label: '本地 CT2' },
        ].map((o, i) => (
          <button key={o.k} style={{
            padding: '5px 11px', fontSize: 11, fontWeight: 600,
            background: o.primary ? T.invert : 'transparent',
            color: o.primary ? T.invertInk : T.textMid,
            border: 'none', borderRadius: 5,
            cursor: 'pointer', fontFamily: 'inherit' }}>{o.label}</button>
        ))}
      </div>}/>

    <PHead T={T}>TranslateGemma (主引擎)</PHead>
    <PRow T={T} label="模型"
      hint="TranslateGemma 4B Q4_K_M · 4-bit 量化 · 繁中品質明顯優於 M2M100，CS 技術詞無誤譯（stack → 堆疊）"
      right={<span style={{ fontSize: 11, color: T.accent, fontWeight: 700,
        fontFamily: 'JetBrains Mono', padding: '3px 8px',
        background: T.chipBg, borderRadius: 4 }}>
        ✓ 已下載 · 2.40 GB
      </span>}/>
    <PRow T={T} label="llama-server sidecar"
      hint="Gemma 透過 llama-server 跑在本機 HTTP port，由 ClassNote 自動 spawn / 監控"
      right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700,
          fontFamily: 'JetBrains Mono', padding: '3px 8px',
          background: T.surface2, border: `1px solid ${T.border}`,
          borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: '#22c55e' }}/>
          已連線
        </span>
        <PBtn T={T}>重新啟動</PBtn>
      </div>}/>
    <PRow T={T} label="endpoint"
      hint="預設 127.0.0.1:8080。除非自己改 llama-server port 否則不用動"
      right={<PInput T={T} value="http://127.0.0.1:8080" monospace wide/>}/>
    <PRow T={T} label="GPU 需求"
      hint="Gemma 4B 需要 ≥ 4 GB VRAM。若無 GPU 會 fallback 到 Google / CT2"
      right={<span style={{ fontSize: 10, color: T.textDim,
        fontFamily: 'JetBrains Mono', padding: '2px 6px',
        background: T.chipBg, borderRadius: 3 }}>
        CUDA · 12 GB · OK
      </span>}/>

    <PHead T={T}>Google Cloud (備用)</PHead>
    <PRow T={T} label="API key"
      hint="從 Google Cloud Console → Translation API → 憑證。沒填的話 Gemma 失敗時會直接報錯"
      right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <PInput T={T} placeholder="AIza...." value="AIzaSyC•••••••••••••GF2w" monospace wide/>
        <PBtn T={T}>測試</PBtn>
      </div>}/>

    <PHead T={T}>本地 CT2 (legacy fallback)</PHead>
    <PRow T={T} label="M2M-100 · 418M"
      hint="dev build 沒包 nmt-local feature flag 時無法啟用。CS 技術詞品質弱於 Gemma，僅供無 GPU 環境臨時使用"
      right={<span style={{ fontSize: 10, color: T.textFaint,
        fontFamily: 'JetBrains Mono' }}>
        未啟用
      </span>}/>

    <PHead T={T}>語言</PHead>
    <PRow T={T} label="來源語言"
      hint="影響轉錄與字幕的主要語言。設成「自動偵測」讓 Whisper / Parakeet 在每堂課自己判斷"
      right={<PSelect T={T} value="自動偵測" options={[
        '自動偵測', '英文', '中文（繁）', '中文（簡）', '日文', '韓文', '法文', '德文',
      ]}/>}/>
    <PRow T={T} label="目標語言"
      hint="字幕、摘要、Q&A 會翻譯到這個語言"
      right={<PSelect T={T} value="中文（繁）" options={[
        '中文（繁）', '中文（簡）', '英文', '日文', '韓文',
      ]}/>}/>
    <PRow T={T} label="雙語字幕"
      hint="同時顯示來源與目標語言"
      right={<PToggle T={T} on={true}/>}/>
  </div>
);

const PCloud = ({ T }) => (
  <div>
    <PHeader T={T} title="雲端 AI 助理"
      hint="摘要、Q&A、關鍵字擷取、PDF OCR、字幕精修使用的雲端 LLM。挑一個 default provider；字幕精修可單獨指定其他 provider。"/>

    <PHead T={T}>Default Provider</PHead>
    <div style={{ fontSize: 11, color: T.textDim, marginTop: 4, marginBottom: 10,
      lineHeight: 1.55 }}>
      所有任務都走這個 provider，除非在下方「字幕精修」單獨指定。每個 provider
      的 token / OAuth token 加密存在本機 SQLite，不會上傳到雲端。
    </div>
    <div style={{ display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
      {[
        { id: 'github-models', name: 'GitHub Models', auth: 'PAT (models:read)',
          desc: 'Copilot Pro / Business / Enterprise 訂閱包含額度',
          sub: 'GPT-4.1 / Claude Sonnet 4.5 / Llama 4',
          status: '已連線 · hank_edu', active: true },
        { id: 'chatgpt-oauth', name: 'ChatGPT 訂閱', auth: '瀏覽器 OAuth',
          desc: 'ChatGPT Plus / Pro 帳號 (Codex 流程)',
          sub: 'GPT-5 / o4-mini',
          status: '已連線 · 3 hrs ago' },
        { id: 'anthropic', name: 'Anthropic API', auth: 'API key',
          desc: 'Claude Sonnet 4.7 · 自備 key',
          sub: '最強概念連結與 RAG',
          status: '未設定' },
        { id: 'openai', name: 'OpenAI API', auth: 'API key',
          desc: 'GPT-5 / GPT-4o · 自備 key',
          sub: '官方原生 API',
          status: '未設定' },
        { id: 'gemini', name: 'Google Gemini', auth: 'API key',
          desc: 'Gemini 2.5 Pro · 自備 key',
          sub: '大 context · 最便宜',
          status: '未設定' },
      ].map(p => (
        <div key={p.id} style={{
          padding: 12, borderRadius: 8, minWidth: 0,
          border: `1px solid ${p.active ? T.accent : T.borderSoft}`,
          background: p.active ? T.chipBg : T.surface2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap' }}>{p.name}</div>
            {p.active && <span style={{ fontSize: 8, padding: '2px 6px',
              background: T.accent, color: '#fff', borderRadius: 3,
              fontWeight: 800, fontFamily: 'JetBrains Mono',
              letterSpacing: '0.08em' }}>DEFAULT</span>}
          </div>
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 6,
            lineHeight: 1.55 }}>{p.desc}</div>
          <div style={{ marginTop: 6, display: 'flex',
            justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 9, color: T.textDim,
              fontFamily: 'JetBrains Mono',
              letterSpacing: '0.06em' }}>{p.sub}</span>
            <span style={{ fontSize: 9, color: T.textFaint,
              fontFamily: 'JetBrains Mono' }}>{p.auth}</span>
          </div>
          <div style={{ marginTop: 10, display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', gap: 10,
            flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10,
              color: p.status.startsWith('已連線') ? T.accent : T.textFaint,
              fontFamily: 'JetBrains Mono', fontWeight: 700 }}>
              {p.status}
            </span>
            <PBtn T={T} primary={!p.status.startsWith('已連線')}>
              {p.status === '未設定' ? (p.auth.includes('OAuth') ? '登入' : '設定') : (p.active ? '測試' : '設為 default')}
            </PBtn>
          </div>
        </div>
      ))}
    </div>

    <PHead T={T}>PDF OCR</PHead>
    <PRow T={T} label="OCR 模式"
      hint="auto = 優先用雲端 LLM vision，沒設定 fallback PDF 文字層 / remote = 只用雲端 / off = 跳過 OCR 只用 PDF 文字層"
      right={<PSelect T={T} value="auto (推薦)" options={['auto (推薦)', 'remote', 'off']}/>}/>

    <PHead T={T}>字幕精修</PHead>
    <PRow T={T} label="精修強度"
      hint="輕 = 補標點 / 糾正術語（每段 ~3k tokens）。深 = 全段重寫順暢度（每段 ~12k tokens）。70 分鐘課差距約 50k vs 200k tokens。"
      right={<PSelect T={T} value="輕 (預設)" options={['關閉', '輕 (預設)', '深']}/>}/>
    <PRow T={T} label="精修 Provider 覆寫"
      hint="字幕精修可單獨指定 provider，避免吃掉 default 的訂閱額度。auto = 用 default provider。"
      right={<PSelect T={T} value="auto" options={[
        'auto', 'github-models', 'chatgpt-oauth', 'anthropic', 'openai',
        'gemini', 'groq', 'mistral', 'openrouter', '自備 key (user-key)',
      ]}/>}/>

    <PHead T={T}>用量 (本機 24h retention)</PHead>
    <div style={{ marginTop: 4, marginBottom: 10, fontSize: 11, color: T.textDim,
      lineHeight: 1.55 }}>
      Provider API 大多沒提供即時剩餘額度查詢，這裡是 ClassNote 在本機累積的
      呼叫紀錄；ChatGPT OAuth / GitHub Models 的訂閱額度請去原網站查。
    </div>
    <div style={{ display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
      {[
        { l: 'Total 呼叫', v: '312', s: '今日' },
        { l: 'Input',   v: '1.24M', s: 'tokens' },
        { l: 'Output',  v: '184K',  s: 'tokens' },
        { l: '估價',    v: '~$0.42', s: 'USD · 估算' },
      ].map(s => (
        <div key={s.l} style={{ padding: 10, borderRadius: 8,
          background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
          <div style={{ fontSize: 9, letterSpacing: '0.14em',
            color: T.textDim, fontWeight: 700,
            fontFamily: 'JetBrains Mono' }}>{s.l}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text,
            fontFamily: 'JetBrains Mono', marginTop: 3,
            letterSpacing: '-0.02em' }}>{s.v}</div>
          <div style={{ fontSize: 9, color: T.textDim, marginTop: 1,
            fontFamily: 'JetBrains Mono' }}>{s.s}</div>
        </div>
      ))}
    </div>
    <div style={{ marginTop: 10 }}>
      <SwHead_PCloudInline T={T}/>
      {[
        { task: '摘要 (summarize)',         calls: 87,  inK: 642, outK: 32 },
        { task: 'AI 助教對話 (chat / chatStream)', calls: 134, inK: 412, outK: 89 },
        { task: '關鍵字 (keywords)',         calls: 42,  inK: 84,  outK: 12 },
        { task: 'RAG 檢索翻譯 (translate)',   calls: 28,  inK: 56,  outK: 21 },
        { task: '字幕精修 (fineRefine)',      calls: 14,  inK: 38,  outK: 26 },
        { task: '課程大綱 (syllabus)',        calls: 7,   inK: 12,  outK: 4 },
      ].map(r => (
        <div key={r.task} style={{
          display: 'grid', gridTemplateColumns: '1fr 60px 80px 80px',
          gap: 10, padding: '7px 12px', alignItems: 'center',
          borderBottom: `1px solid ${T.borderSoft}`,
          fontSize: 11 }}>
          <span style={{ color: T.text }}>{r.task}</span>
          <span style={{ color: T.textDim, fontFamily: 'JetBrains Mono',
            textAlign: 'right' }}>{r.calls} 次</span>
          <span style={{ color: T.textDim, fontFamily: 'JetBrains Mono',
            textAlign: 'right' }}>in {r.inK}K</span>
          <span style={{ color: T.textDim, fontFamily: 'JetBrains Mono',
            textAlign: 'right' }}>out {r.outK}K</span>
        </div>
      ))}
    </div>
  </div>
);

// PCloud 子標題：「按任務細分」
const SwHead_PCloudInline = ({ T }) => (
  <div style={{ fontSize: 9, letterSpacing: '0.16em',
    color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono',
    marginTop: 8, marginBottom: 6 }}>
    按任務細分
  </div>
);

// 通用的 segmented control — 替 boolean / enum 設定用
const PSeg = ({ T, value, options, onChange }) => (
  <div style={{ display: 'flex', gap: 4,
    padding: 3, borderRadius: 7, background: T.surface2,
    border: `1px solid ${T.border}` }}>
    {options.map(o => {
      const active = o.value === value;
      return (
        <button key={o.value} onClick={() => onChange?.(o.value)} style={{
          padding: '5px 11px', fontSize: 11, fontWeight: 600,
          background: active ? T.invert : 'transparent',
          color: active ? T.invertInk : T.textMid,
          border: 'none', borderRadius: 5,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>{o.label}</button>
      );
    })}
  </div>
);

// ─── 主頁佈局 SVG 預覽 ──────────────────────────────────────
// 抽象呈現各 layout 的「上方 top bar / 左側 rail / 中間主區 / 右側副區」
// 結構，幫使用者直觀理解 A/B/C 差異。viewBox 320×200 (16:10 像真實 app)。
const LayoutPreviewSVG = ({ T, variant }) => {
  const COURSE_COLORS = ['#3451b2', '#1f7a4f', '#9e3a24', '#6a3da0', '#1d6477'];
  const surface = T.surface;
  const surface2 = T.surface2;
  const border = T.borderSoft;
  const text = T.text;
  const dim = T.textDim;
  const accent = T.accent;
  const isDark = T.mode === 'dark';

  // 共用：top bar (14px) + 左 rail (14px wide) + 課程色塊
  const Chrome = () => (
    <>
      {/* Top bar */}
      <rect x="0" y="0" width="320" height="14" fill={T.topbar}/>
      <line x1="0" y1="14" x2="320" y2="14" stroke={border} strokeWidth="0.5"/>
      <circle cx="6"  cy="7" r="1.6" fill="#e8412e"/>
      <circle cx="11" cy="7" r="1.6" fill="#f6b24e"/>
      <circle cx="16" cy="7" r="1.6" fill="#22c55e"/>
      {/* Recording island (top center) */}
      <rect x="142" y="3" width="36" height="8" rx="4" fill={isDark ? '#1a1a1a' : '#0a0a0a'}/>
      <circle cx="148" cy="7" r="1.4" fill="#ff4b4b"/>

      {/* Left rail */}
      <rect x="0" y="14" width="14" height="186" fill={T.rail}/>
      <line x1="14" y1="14" x2="14" y2="200" stroke={border} strokeWidth="0.5"/>
      {/* Home/notes icons (top of rail) */}
      <rect x="3" y="20" width="8" height="6" rx="1.5" fill={T.invert} opacity="0.85"/>
      <rect x="3" y="29" width="8" height="6" rx="1.5" fill="none" stroke={dim} strokeWidth="0.5"/>
      {/* Course color blocks */}
      {COURSE_COLORS.map((c, i) => (
        <rect key={i} x="3" y={42 + i * 11} width="8" height="8" rx="1.5" fill={c}/>
      ))}
      {/* + add */}
      <rect x="3" y="100" width="8" height="8" rx="1.5" fill="none"
        stroke={T.textFaint} strokeWidth="0.5" strokeDasharray="1.5 1"/>
      {/* AI + profile */}
      <rect x="3" y="172" width="8" height="6" rx="1.5" fill="none" stroke={dim} strokeWidth="0.5"/>
      <circle cx="7" cy="186" r="3.5" fill="#c48a2c"/>
    </>
  );

  // 工具：抽象的 inbox row (一行 = 一個 reminder)
  const InboxRow = ({ x, y, w, courseIdx, density = 1 }) => (
    <g>
      <circle cx={x + 2} cy={y + 3} r="1.3" fill={COURSE_COLORS[courseIdx % 5]}/>
      <line x1={x + 7} y1={y + 3} x2={x + w - 8} y2={y + 3}
        stroke={dim} strokeWidth="2.4" strokeLinecap="round" opacity={0.18 * density}/>
      <line x1={x + 7} y1={y + 3} x2={x + 7 + (w - 25) * 0.6} y2={y + 3}
        stroke={text} strokeWidth="2.4" strokeLinecap="round" opacity={0.55}/>
    </g>
  );

  // 工具：日曆 grid (7 columns) — daysCount 控制要畫多細
  const Calendar = ({ x, y, w, h, big, todayCol = 0 }) => {
    const cols = 7;
    const colW = w / cols;
    const headerH = big ? 12 : 8;
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={surface} stroke={border}
          strokeWidth="0.5" rx="2"/>
        {/* Header strip */}
        <rect x={x} y={y} width={w} height={headerH} fill={surface2}/>
        {/* Today highlight */}
        <rect x={x + colW * todayCol} y={y} width={colW} height={h}
          fill={accent} opacity="0.06"/>
        {/* Column dividers */}
        {Array.from({ length: cols - 1 }, (_, i) => (
          <line key={i} x1={x + colW * (i + 1)} y1={y}
            x2={x + colW * (i + 1)} y2={y + h}
            stroke={border} strokeWidth="0.4"/>
        ))}
        <line x1={x} y1={y + headerH} x2={x + w} y2={y + headerH}
          stroke={border} strokeWidth="0.4"/>
        {/* Some event blocks */}
        {[
          { col: 0, top: 0.18, h: 0.18, c: 0 },
          { col: 1, top: 0.32, h: 0.14, c: 4 },
          { col: 2, top: 0.5,  h: 0.2,  c: 1 },
          { col: 3, top: 0.25, h: 0.16, c: 3 },
          { col: 4, top: 0.6,  h: 0.18, c: 2 },
          ...(big ? [
            { col: 0, top: 0.55, h: 0.14, c: 4 },
            { col: 5, top: 0.4,  h: 0.18, c: 0 },
            { col: 6, top: 0.5,  h: 0.16, c: 1 },
            { col: 5, top: 0.7,  h: 0.12, c: 3 },
          ] : []),
        ].map((e, i) => (
          <rect key={i}
            x={x + colW * e.col + 1.5}
            y={y + headerH + (h - headerH) * e.top}
            width={colW - 3}
            height={(h - headerH) * e.h}
            fill={COURSE_COLORS[e.c]} opacity="0.72" rx="1"/>
        ))}
        {/* Now line on today */}
        <line
          x1={x + colW * todayCol} y1={y + headerH + (h - headerH) * 0.45}
          x2={x + colW * (todayCol + 1)} y2={y + headerH + (h - headerH) * 0.45}
          stroke={accent} strokeWidth="0.8"/>
        <circle
          cx={x + colW * todayCol + 1}
          cy={y + headerH + (h - headerH) * 0.45}
          r="1.2" fill={accent}/>
      </g>
    );
  };

  // 工具：preview 區 (HW 詳情卡)
  const Preview = ({ x, y, w, h }) => (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={surface} stroke={border}
        strokeWidth="0.5" rx="2"/>
      {/* Course pill */}
      <rect x={x + 4} y={y + 4} width="22" height="5" fill={accent} opacity="0.18" rx="1"/>
      {/* Title 2 lines */}
      <line x1={x + 4} y1={y + 16} x2={x + w - 6} y2={y + 16}
        stroke={text} strokeWidth="2.5" strokeLinecap="round" opacity="0.85"/>
      <line x1={x + 4} y1={y + 22} x2={x + w - 18} y2={y + 22}
        stroke={text} strokeWidth="2.5" strokeLinecap="round" opacity="0.85"/>
      {/* Mono subtitle */}
      <line x1={x + 4} y1={y + 30} x2={x + w - 14} y2={y + 30}
        stroke={dim} strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
      {/* Hot bar */}
      <rect x={x + 4} y={y + 36} width={w - 8} height="5" fill={T.hotBg} rx="1"/>
      {/* Body block */}
      <rect x={x + 4} y={y + 46} width={w - 8} height={Math.max(20, h * 0.22)}
        fill={surface2} rx="1.5"/>
      {/* Related notes */}
      {Array.from({ length: 3 }, (_, i) => (
        <rect key={i}
          x={x + 4}
          y={y + 46 + Math.max(20, h * 0.22) + 4 + i * 7}
          width={w - 8} height="5"
          fill="none" stroke={border} strokeWidth="0.4" rx="1"/>
      ))}
      {/* AI dark summary */}
      <rect x={x + 4} y={y + h - 32} width={w - 8} height="20"
        fill={T.invert} rx="1.5"/>
      {/* Action buttons */}
      <rect x={x + 4} y={y + h - 8} width="18" height="5" fill={T.invert} rx="1"/>
      <rect x={x + 24} y={y + h - 8} width="18" height="5" fill="none"
        stroke={border} strokeWidth="0.4" rx="1"/>
    </g>
  );

  // 工具：inbox panel
  const InboxPanel = ({ x, y, w, h, rows = 8, dense }) => {
    const headerH = 10;
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={surface} stroke={border}
          strokeWidth="0.5" rx="2"/>
        <rect x={x} y={y} width={w} height={headerH} fill={surface2}/>
        {/* Filter pills */}
        {[16, 14, 14, 12].map((pw, i) => (
          <rect key={i}
            x={x + 4 + (i === 0 ? 0 : (16 + 14 + 14 + 12 + i * 3 - pw - [0, 16, 30, 44][i] + 16))}
            y={y + 3} width={pw} height="4" rx="2"
            fill={i === 0 ? T.invert : 'none'}
            stroke={i === 0 ? 'none' : border} strokeWidth="0.4"/>
        ))}
        {/* Section header */}
        <text x={x + 4} y={y + headerH + 8} fontSize="3.5"
          fill={dim} fontFamily="JetBrains Mono"
          letterSpacing="0.12em">TODAY</text>
        {Array.from({ length: rows }, (_, i) => (
          <InboxRow key={i}
            x={x + 4}
            y={y + headerH + 12 + i * (dense ? 9 : 11)}
            w={w - 8}
            courseIdx={i}/>
        ))}
      </g>
    );
  };

  return (
    <svg viewBox="0 0 320 200" width="100%"
      style={{ display: 'block', borderRadius: 6 }}
      preserveAspectRatio="xMidYMid meet">
      {/* Background frame */}
      <rect x="0" y="0" width="320" height="200" fill={T.bg}/>
      <Chrome/>

      {/* Variant content */}
      {variant === 'A' && (
        <g>
          {/* Center: small calendar top + inbox bottom */}
          <Calendar x={20} y={20} w={206} h={56} todayCol={0}/>
          <InboxPanel x={20} y={82} w={206} h={114} rows={9} dense/>
          {/* Right: preview */}
          <Preview x={232} y={20} w={82} h={176}/>
        </g>
      )}

      {variant === 'B' && (
        <g>
          {/* Center: inbox fills */}
          <InboxPanel x={20} y={20} w={206} h={176} rows={13}/>
          {/* Right: today calendar (top) + preview (bottom) */}
          <Calendar x={232} y={20} w={82} h={68} todayCol={0}/>
          <Preview x={232} y={94} w={82} h={102}/>
        </g>
      )}

      {variant === 'C' && (
        <g>
          {/* Center: big calendar */}
          <Calendar x={20} y={20} w={206} h={176} big todayCol={0}/>
          {/* Right: inbox */}
          <InboxPanel x={232} y={20} w={82} h={176} rows={11} dense/>
        </g>
      )}
    </svg>
  );
};

const LAYOUT_OPTS = [
  { v: 'A', t: '預設模式',    d: '小週曆 + Inbox 主視，右側課程預覽' },
  { v: 'B', t: 'Inbox 為主', d: 'Inbox 滿版主視，右側今日 + 預覽' },
  { v: 'C', t: '行事曆為主',  d: '大週曆主視，右側 Inbox' },
];

const PAppearance = ({ T, tweaks = {}, applyTweaks }) => {
  const set = (patch) => applyTweaks?.({ ...tweaks, ...patch });
  const layout = tweaks.layout || 'A';
  const curOpt = LAYOUT_OPTS.find(o => o.v === layout) || LAYOUT_OPTS[0];

  return (
    <div>
      <PHeader T={T} title="介面與顯示"
        hint="主頁佈局、主題、AI 助教與錄音版面的呈現方式。"/>

      {/* ─── 主頁佈局 — SVG 預覽 + 下方 3 鍵橫排 ─────────── */}
      <PHead T={T}>主頁佈局</PHead>
      <div style={{ fontSize: 11, color: T.textDim, marginTop: 4,
        marginBottom: 12, lineHeight: 1.55 }}>
        切換首頁的三欄排版方式。下方預覽會即時更新，按下也會立刻套用，
        回到首頁就能看到。
      </div>

      {/* SVG 預覽框 */}
      <div style={{
        borderRadius: 10, overflow: 'hidden',
        border: `1px solid ${T.borderSoft}`,
        background: T.surface2,
        padding: 16, marginBottom: 12,
      }}>
        <div key={layout} style={{
          animation: 'h18LayoutFade 320ms cubic-bezier(0.32, 0.72, 0, 1)',
          maxWidth: 480, margin: '0 auto',
        }}>
          <LayoutPreviewSVG T={T} variant={layout}/>
        </div>
        {/* 當前選項描述 */}
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em',
            color: T.textDim, fontWeight: 800,
            fontFamily: 'JetBrains Mono' }}>
            預覽 · LAYOUT {layout}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text,
            marginTop: 4, letterSpacing: '-0.01em' }}>
            {curOpt.t}
          </div>
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>
            {curOpt.d}
          </div>
        </div>
        <style>{`@keyframes h18LayoutFade {
          from { opacity: 0; transform: scale(0.985); }
          to { opacity: 1; transform: scale(1); }
        }`}</style>
      </div>

      {/* 3 個按鈕在同一橫排 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {LAYOUT_OPTS.map(opt => {
          const active = layout === opt.v;
          return (
            <button key={opt.v} onClick={() => set({ layout: opt.v })}
              style={{
                flex: 1,
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? T.chipBg : T.surface,
                cursor: 'pointer', fontFamily: 'inherit', color: T.text,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 4,
                transition: 'all 160ms',
              }}>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '0.14em',
                fontFamily: 'JetBrains Mono',
                color: active ? T.accent : T.textDim,
              }}>{opt.v}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                {opt.t}
              </span>
            </button>
          );
        })}
      </div>

      {/* ─── 主題 / 密度 / 字體 — 對應 tweaks ──────────── */}
      <PHead T={T}>主題與排版</PHead>
      <PRow T={T} label="主題"
        hint={tweaks.theme === 'system'
          ? '目前跟隨系統 (' + (T.mode === 'dark' ? '深色' : '亮色') + ')'
          : '⌘\\ 快速切換亮 / 深'}
        right={<PSeg T={T} value={tweaks.theme || 'light'}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'light',  label: '☀ 亮色' },
            { value: 'dark',   label: '☾ 深色' },
            { value: 'system', label: '⌬ 跟隨系統' },
          ]}/>}/>
      <PRow T={T} label="密度"
        hint="舒適 = 更大間距；緊密 = 一屏裝更多"
        right={<PSeg T={T} value={tweaks.dense ? 'dense' : 'comfy'}
          onChange={(v) => set({ dense: v === 'dense' })}
          options={[
            { value: 'comfy', label: '舒適' },
            { value: 'dense', label: '緊密' },
          ]}/>}/>
      <PRow T={T} label="字體大小"
        hint="影響全應用基準字級。prototype 中部分元件用絕對 px 不會視覺變化"
        right={<PSeg T={T} value={tweaks.fontSize || 'normal'}
          onChange={(v) => set({ fontSize: v })}
          options={[
            { value: 'small',  label: '小' },
            { value: 'normal', label: '標準' },
            { value: 'large',  label: '大' },
          ]}/>}/>

      {/* ─── 通知 Toast 風格 ───────────────────────────── */}
      <PHead T={T}>通知 Toast</PHead>
      <PRow T={T} label="Toast 風格"
        hint="card = 一般通知卡 + 左色條；typewriter = 復古打字機 + [HH:MM:SS] 時戳，全 mono 字"
        right={<PSeg T={T} value={tweaks.toastStyle || 'card'}
          onChange={(v) => set({ toastStyle: v })}
          options={[
            { value: 'card',       label: '卡片' },
            { value: 'typewriter', label: '打字機' },
          ]}/>}/>
    </div>
  );
};

const PAudio = ({ T }) => (
  <div>
    <PHeader T={T} title="音訊與字幕"/>

    <PHead T={T}>麥克風</PHead>
    <PRow T={T} label="輸入裝置"
      hint="偵測到 3 台 · 若課堂用教室的接收器要手動選"
      right={<div style={{ display: 'flex', gap: 8 }}>
        <PSelect T={T} value="MacBook 內建麥克風" options={[
          'MacBook 內建麥克風',
          'AirPods Pro',
          'Yeti Nano (USB)',
        ]}/>
        <PBtn T={T}>重新掃描</PBtn>
      </div>}/>
    <PRow T={T} label="權限"
      right={<span style={{ fontSize: 11, color: T.accent,
        fontFamily: 'JetBrains Mono', fontWeight: 700,
        padding: '3px 8px', border: `1px solid ${T.accent}55`,
        borderRadius: 4 }}>✓ 已授權</span>}/>
    <PRow T={T} label="採樣率"
      hint="Whisper 內部是 16 kHz；16 / 24 / 48 kHz 都會自動轉換"
      right={<PSelect T={T} value="48 kHz" options={['16 kHz', '24 kHz', '44.1 kHz', '48 kHz']}/>}/>
    <PRow T={T} label="自動偵測靜音"
      hint="連續 30 秒靜音自動暫停錄音"
      right={<PToggle T={T} on={true}/>}/>

    <PHead T={T}>字幕樣式</PHead>
    <PRow T={T} label="字體大小"
      right={<PSelect T={T} value="中 · 20px" options={['小 · 16px', '中 · 20px', '大 · 26px', '超大 · 32px']}/>}/>
    <PRow T={T} label="顯示模式"
      right={<PSelect T={T} value="中英雙語" options={['中英雙語', '僅中文', '僅英文']}/>}/>
    <PRow T={T} label="位置"
      right={<PSelect T={T} value="底部置中" options={['底部置中', '頂部置中', '底部靠左', '自訂…']}/>}/>
    <PRow T={T} label="字色 / 背景透明度"
      right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ width: 22, height: 22, borderRadius: 4,
          background: '#fff', border: `1px solid ${T.border}` }}/>
        <span style={{ fontSize: 10, color: T.textDim,
          fontFamily: 'JetBrains Mono' }}>字 #FFFFFF · 底 60%</span>
        <PBtn T={T}>調整</PBtn>
      </div>}/>
  </div>
);

const PData = ({ T }) => (
  <div>
    <PHeader T={T} title="資料管理"
      hint="所有資料都在本機。匯出是一份完整 JSON（含設定），可備份到雲端硬碟或帶到別台電腦。"/>

    <PHead T={T}>匯出</PHead>
    <PRow T={T} label="匯出完整資料"
      hint="含課程、錄音、字幕、筆記、設定 · 預計 428 MB"
      right={<PBtn T={T} primary>匯出 JSON</PBtn>}/>
    <PRow T={T} label="只匯出筆記"
      hint="Markdown + 附圖，適合帶到 Notion"
      right={<PBtn T={T}>匯出 .zip</PBtn>}/>
    <PRow T={T} label="自動備份"
      hint="每週日凌晨 3:00 匯出到 iCloud Drive"
      right={<PToggle T={T} on={true}/>}/>

    <PHead T={T}>匯入</PHead>
    <PRow T={T} label="從 JSON 還原"
      hint="會覆蓋目前的資料。建議先匯出現有再匯入"
      right={<PBtn T={T}>選擇檔案</PBtn>}/>

    <PHead T={T}>儲存位置</PHead>
    <PRow T={T} label="資料資料夾"
      hint="所有 SQLite / 音訊 / 筆記都放在這裡"
      right={<div style={{ display: 'flex', gap: 8 }}>
        <PInput T={T} value="~/Library/ClassNote" monospace wide/>
        <PBtn T={T}>更改</PBtn>
      </div>}/>
    <PRow T={T} label="儲存用量"
      hint="音訊 3.2 GB · 筆記 48 MB · 模型 4.7 GB · 總計 8.0 GB"
      right={<PBtn T={T}>顯示於 Finder</PBtn>}/>

    <PHead T={T}>回收桶</PHead>
    <PRow T={T} label="已刪除項目"
      hint="12 個 · 1.4 GB · 30 天後自動永久刪除"
      right={<div style={{ display: 'flex', gap: 8 }}>
        <PBtn T={T}>開啟回收桶</PBtn>
        <PBtn T={T} danger>立即清空</PBtn>
      </div>}/>
  </div>
);

const PAbout = ({ T, onOpenSetupWizard }) => (
  <div>
    <PHeader T={T} title="關於與更新"/>

    <div style={{ padding: 20, borderRadius: 10,
      background: T.surface2, border: `1px solid ${T.borderSoft}`,
      display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ width: 60, height: 60, borderRadius: 14,
        background: T.invert, color: T.invertInk, display: 'grid',
        placeItems: 'center', fontSize: 28, fontWeight: 800 }}>C</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text,
          letterSpacing: '-0.01em' }}>ClassNote · H18 Deep</div>
        <div style={{ fontSize: 11, color: T.textDim,
          fontFamily: 'JetBrains Mono', marginTop: 3 }}>
          v0.18.3 · build 2026.04.21 · Electron 32.1.0
        </div>
        <div style={{ fontSize: 10, color: T.textFaint,
          fontFamily: 'JetBrains Mono', marginTop: 2 }}>
          macOS 15.4 · Apple M3 Pro
        </div>
      </div>
      <PBtn T={T} primary>檢查更新</PBtn>
    </div>

    <PHead T={T}>更新</PHead>
    <PRow T={T} label="更新通道"
      hint="Beta 每週更新，可能遇到 bug 但早享新功能"
      right={<PSelect T={T} value="stable" options={['stable', 'beta', 'alpha']}/>}/>
    <PRow T={T} label="自動下載更新"
      right={<PToggle T={T} on={true}/>}/>
    <PRow T={T} label="自動安裝 (重啟時)"
      right={<PToggle T={T} on={false}/>}/>

    <PHead T={T}>診斷</PHead>
    <PRow T={T} label="Log"
      hint="最近 1000 行 · 會自動遮罩 API key / token"
      right={<div style={{ display: 'flex', gap: 8 }}>
        <PBtn T={T}>預覽</PBtn>
        <PBtn T={T}>複製</PBtn>
        <PBtn T={T}>開啟資料夾</PBtn>
      </div>}/>
    <PRow T={T} label="診斷 ZIP"
      hint="包含 log、系統資訊、模型清單（不含音訊 / 筆記）"
      right={<PBtn T={T}>匯出 ZIP</PBtn>}/>
    <PRow T={T} label="DevTools"
      right={<PBtn T={T}>開啟</PBtn>}/>
    <PRow T={T} label="Setup Wizard"
      hint="重新跑一次初次設定（不會清除資料）"
      right={<PBtn T={T} onClick={onOpenSetupWizard}>重置</PBtn>}/>

    <PHead T={T}>開發者預覽</PHead>
    <div style={{ fontSize: 11, color: T.textDim, marginTop: 4,
      marginBottom: 4, lineHeight: 1.55 }}>
      ⚐ 僅供設計檢視 — 觸發那些「平時看不到」的 conditional UI（Toast、
      Recovery、Migration 等），用來實際感受最終效果。實裝到主程式時這
      整段會移除。Toast 風格在「介面與顯示 → Toast 風格」切換。
    </div>
    <PRow T={T} label="Toast · 連發 5 個 (mixed types)"
      hint="觸發 success / info / warning / error 各種 type 的混合堆疊。Hover 暫停 timer，max 5 個自動擠掉舊的。"
      right={<PBtn T={T} primary onClick={() => {
        const samples = [
          { type: 'success', message: '儲存成功',
            detail: 'ML · L13 · Self-Attention 推導 · 52 分鐘' },
          { type: 'info',    message: 'AI 摘要已生成',
            detail: '從 14 段字幕擷取 3 個關鍵概念' },
          { type: 'warning', message: '字幕精修部分失敗',
            detail: 'GitHub Models 達免費額度上限，已 fallback 粗翻版本' },
          { type: 'error',   message: '錄音裝置斷線',
            detail: 'AirPods Pro 已中斷連線，錄音自動暫停' },
          { type: 'info',    message: '備份完成',
            detail: '匯出至 ~/Library/ClassNote/backups/ · 428 MB' },
        ];
        samples.forEach((s, i) =>
          setTimeout(() => window.h18Toast?.(s), i * 240));
      }}>觸發</PBtn>}/>

    {/* ─── 4 個 conditional toast — 對應真實 service ────── */}
    <PRow T={T} label="MigrationNotices · sticky 警告"
      hint="DB schema 升級後第一次啟動時跳的 sticky toast (durationMs:0)，需手動 ✕"
      right={<PBtn T={T} onClick={() => window.h18Toast?.({
        type: 'warning',
        durationMs: 0,
        message: '資料庫遷移通知',
        detail: '已從 v0.6.0 升級到 v0.6.5。embedding model 變更，64 個 RAG 索引已自動重建。',
      })}>觸發</PBtn>}/>
    <PRow T={T} label="RecordingDeviceMonitor · 麥克風斷線"
      hint="錄音中麥克風被拔走/斷連，需要使用者重連"
      right={<PBtn T={T} onClick={() => window.h18Toast?.({
        type: 'error',
        message: '錄音裝置斷線',
        detail: 'AirPods Pro 已中斷連線。錄音已自動暫停，請重新連接後手動繼續。',
      })}>觸發</PBtn>}/>
    <PRow T={T} label="BatteryMonitor · 低電量"
      hint="錄音中電量低於 20%，提醒接電源避免錄音中斷"
      right={<PBtn T={T} onClick={() => window.h18Toast?.({
        type: 'warning',
        message: '電量過低',
        detail: '電量剩 15%，建議連接電源避免錄音中斷。',
      })}>觸發</PBtn>}/>
    <PRow T={T} label="App update · 新版可下載"
      hint="updateService 偵測到新版"
      right={<PBtn T={T} onClick={() => window.h18Toast?.({
        type: 'info',
        durationMs: 0,
        message: '有新版本可更新',
        detail: 'ClassNote v0.6.6 已發布，包含 GPU 加速與 Whisper 模型優化。重啟後自動安裝。',
      })}>觸發</PBtn>}/>

    {/* ─── ConfirmDialog ────────────────────────────────── */}
    <PRow T={T} label="ConfirmDialog · 一般"
      hint="清除字幕等中性確認 — Enter 確認、ESC 取消"
      right={<PBtn T={T} onClick={async () => {
        const ok = await window.h18Confirm?.({
          title: '清除所有字幕記錄？',
          message: '此操作僅清除目前顯示的字幕，不會刪除資料庫紀錄。\n字幕仍會保留在原本的 lecture，重新打開該堂可再看到。',
          okLabel: '清除',
          cancelLabel: '取消',
        });
        window.h18Toast?.({
          type: ok ? 'success' : 'info',
          message: ok ? '已清除字幕記錄' : '取消清除',
        });
      }}>觸發</PBtn>}/>
    <PRow T={T} label="ConfirmDialog · 危險（紅色按鈕）"
      hint="永久刪除 / reset 等不可逆操作"
      right={<PBtn T={T} danger onClick={async () => {
        const ok = await window.h18Confirm?.({
          title: '永久刪除「機器學習」？',
          message: '此操作無法復原。所有 11 堂 lecture 錄音、字幕、筆記與 AI 對話都會永久刪除，且不會進入回收桶。',
          okLabel: '永久刪除',
          cancelLabel: '取消',
          kind: 'danger',
        });
        window.h18Toast?.({
          type: ok ? 'error' : 'info',
          message: ok ? '已永久刪除「機器學習」' : '取消刪除',
        });
      }}>觸發</PBtn>}/>

    {/* ─── TaskIndicator (右上角小膠囊) ────────────────────── */}
    <PRow T={T} label="TaskIndicator · 加 1 個 processing 任務"
      hint="模擬 offline queue 累積一個任務 — 看右上角 indicator + badge + 點擊展開"
      right={<PBtn T={T} onClick={() => {
        const id = window.h18Tasks?.add({
          type: 'sync',
          label: '同步課程到雲端',
          detail: 'ML · L13 · 12 segments',
          status: 'processing',
          progress: 35,
        });
        // Simulate progress
        let p = 35;
        const t = setInterval(() => {
          p += 5;
          if (p >= 100) {
            window.h18Tasks?.update(id, { status: 'done', progress: 100 });
            clearInterval(t);
            setTimeout(() => window.h18Tasks?.remove(id), 1500);
          } else {
            window.h18Tasks?.update(id, { progress: p });
          }
        }, 240);
      }}>觸發</PBtn>}/>
    <PRow T={T} label="TaskIndicator · 加 4 個混合狀態"
      hint="一次塞 4 個不同 status 任務（pending / processing / failed / done）"
      right={<PBtn T={T} onClick={() => {
        window.h18Tasks?.add({ label: '上傳音訊 ML · L14', detail: '52 MB · waiting',
          status: 'pending' });
        window.h18Tasks?.add({ label: 'AI 摘要生成中', detail: 'GitHub Models · GPT-4.1',
          status: 'processing', progress: 62 });
        window.h18Tasks?.add({ label: 'OCR 失敗 · L11 投影片',
          detail: 'API rate limit, retry 2/3', status: 'failed' });
        window.h18Tasks?.add({ label: '建立 RAG 索引 ALG L9',
          detail: '64 chunks embedded', status: 'done' });
      }}>觸發</PBtn>}/>
    <PRow T={T} label="TaskIndicator · 切換離線/上線"
      hint="模擬網路斷線 — indicator 變紅色 wifi-off 圖示"
      right={<PBtn T={T} onClick={() => {
        // Toggle by reading current via subscribe trick
        window.h18TasksManager?.subscribe?.(({ isOnline }) => {
          window.h18Tasks?.setOnline(!isOnline);
        })();
      }}>切換</PBtn>}/>

    {/* ─── 6 個 conditional UI overlays ─────────────────── */}
    <PRow T={T} label="RecoveryPromptModal · 崩潰恢復"
      hint="啟動時偵測到上次崩潰時還在錄音的 .pcm 檔，跳全螢幕 modal 個別處理"
      right={<PBtn T={T} onClick={() => window.h18Recovery?.show([
        { id: 's1', courseShort: 'ML', lectureTitle: 'L13 · Self-Attention 推導',
          durationSec: 1843, sizeMb: 17.6, date: '2026·04·25 · 19:02' },
        { id: 's2', courseShort: 'ALG', lectureTitle: 'L9 · Graph Algorithms',
          durationSec: 425, sizeMb: 4.1, date: '2026·04·24 · 14:08' },
      ])}>觸發</PBtn>}/>
    <PRow T={T} label="ErrorBoundary fallback"
      hint="React 元件 throw 時的全螢幕 fallback。prototype 用 overlay + 重新載入按鈕"
      right={<PBtn T={T} onClick={() => window.h18ErrorFallback?.show({
        error: 'TypeError: Cannot read properties of undefined (reading \'segments\')',
        stack: `at SubtitleDisplay.tsx:64:23
at renderWithHooks (react-dom.development.js:14985:18)
at updateFunctionComponent (react-dom.development.js:17356:20)
at beginWork (react-dom.development.js:19094:16)
at HTMLUnknownElement.callCallback (react-dom.development.js:3945:14)`,
      })}>觸發</PBtn>}/>
    <PRow T={T} label="UnofficialChannelWarning"
      hint="第一次點 ChatGPT OAuth 時的警告 modal — 含 acknowledgment checkbox"
      right={<PBtn T={T} onClick={async () => {
        const ack = await window.h18OauthWarning?.show({ provider: 'ChatGPT' });
        window.h18Toast?.({
          type: ack ? 'info' : 'info',
          message: ack ? '已接受風險，下一步進入 OAuth flow' : '已取消',
        });
      }}>觸發</PBtn>}/>
    <PRow T={T} label="OAuth 登入流程"
      hint="3 階段狀態機：開啟瀏覽器 (2.5s) → 成功 / 可手動切失敗"
      right={<PBtn T={T} onClick={async () => {
        const result = await window.h18OauthFlow?.show({ provider: 'ChatGPT' });
        window.h18Toast?.({
          type: result?.success ? 'success' : 'info',
          message: result?.success
            ? `已連線：${result.account}` : '登入未完成',
        });
      }}>觸發</PBtn>}/>
    <PRow T={T} label="VideoPiP · 浮動影片視窗"
      hint="可拖曳、可從右下角縮放、hover 才顯示 chrome"
      right={<PBtn T={T} onClick={() => window.h18VideoPiP?.toggle()}>切換</PBtn>}/>
    <PRow T={T} label="autoAlignment · 投影片對齊建議 banner"
      hint="頂部 pill 從上方滑落，8 秒倒數自動消失，可主動接受/略過"
      right={<PBtn T={T} onClick={() => window.h18AlignmentBanner?.show({
        fromPage: 12, toPage: 15, lectureContext: 'ML · L13',
      })}>觸發</PBtn>}/>

    <PHead T={T}>法律</PHead>
    <PRow T={T} label="隱私政策" right={<PBtn T={T}>查看</PBtn>}/>
    <PRow T={T} label="開源授權" right={<PBtn T={T}>查看</PBtn>}/>
    <PRow T={T} label="回報問題"
      hint="GitHub Issues · 會附上匿名診斷資訊"
      right={<PBtn T={T} primary>回報…</PBtn>}/>
  </div>
);

Object.assign(window, { SearchOverlay, CourseDetailPage, AIPage,
  AddCourseDialog, ProfilePage });
