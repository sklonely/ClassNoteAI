// Shared data for v3 home directions.
// Same 6 courses, but with reminder streams: hw / ann / grade / say / due / todo
// Every item has: course, type, when (relative), title, detail, meta, urgent?

const V3_COURSES = [
  { id: 'ml',  title: '機器學習',  short: 'ML',  instructor: '李宏毅',   color: '#3451b2', accent: '#e8ecff',
    lectures: 14, mins: 682, progress: 0.78, unreviewed: 2,
    room: '電二 103', nextLec: { n: 14, title: 'Multi-Head 與應用', when: '今晚 19:00', daysAway: 0, inMin: 112 },
    lastLec: { n: 13, title: 'Attention 機制', date: '昨天', dur: 52 },
    grade: 'A-', credits: 3, keywords: ['Transformer', 'Q/K/V', 'softmax'] },
  { id: 'alg', title: '演算法',    short: 'ALG', instructor: '陳縕儂',   color: '#1f7a4f', accent: '#e3f5ec',
    lectures:  9, mins: 412, progress: 0.56, unreviewed: 0,
    room: '資訊館 211', nextLec: { n: 10, title: 'NP-completeness', when: '週四 14:00', daysAway: 2, inMin: 2*1440 },
    lastLec: { n:  9, title: 'Graph Algorithms', date: '3 天前', dur: 48 },
    grade: 'B+', credits: 3, keywords: ['DP', 'greedy', 'graph'] },
  { id: 'ds',  title: '作業系統',  short: 'OS',  instructor: '洪士灝',   color: '#9e3a24', accent: '#fbe8e1',
    lectures: 11, mins: 528, progress: 0.64, unreviewed: 1,
    room: '電二 215', nextLec: { n: 12, title: 'File System', when: '下週一 10:00', daysAway: 5, inMin: 5*1440 },
    lastLec: { n: 11, title: 'Virtual Memory', date: '5 天前', dur: 50 },
    grade: 'A', credits: 3, keywords: ['mutex', 'paging', 'deadlock'] },
  { id: 'lin', title: '線性代數',  short: 'LA',  instructor: '蘇柏青',   color: '#6a3da0', accent: '#efe6f8',
    lectures:  8, mins: 356, progress: 0.48, unreviewed: 3,
    room: '新數 101', nextLec: { n:  9, title: 'SVD', when: '下週二 09:00', daysAway: 6, inMin: 6*1440 },
    lastLec: { n:  8, title: 'Eigendecomposition', date: '1 週前', dur: 46 },
    grade: 'B', credits: 3, keywords: ['eigenvalue', 'SVD', 'rank'] },
  { id: 'stat', title: '機率論',   short: 'STAT', instructor: '黃怡菁',  color: '#1d6477', accent: '#def0f4',
    lectures: 12, mins: 582, progress: 0.71, unreviewed: 1,
    room: '新數 203', nextLec: { n: 13, title: 'Hypothesis Testing', when: '週五 10:00', daysAway: 3, inMin: 3*1440 },
    lastLec: { n: 12, title: 'CLT', date: '2 天前', dur: 49 },
    grade: 'A-', credits: 3, keywords: ['Bayes', 'MLE', 'CLT'] },
  { id: 'cmp', title: '編譯器',    short: 'CMP', instructor: '廖世偉',   color: '#3a3a3a', accent: '#eaeaea',
    lectures:  6, mins: 288, progress: 0.33, unreviewed: 2,
    room: '資訊館 114', nextLec: { n:  7, title: 'Semantic Analysis', when: '明天 16:00', daysAway: 1, inMin: 1200 },
    lastLec: { n:  6, title: 'Parser Combinators', date: '4 天前', dur: 48 },
    grade: 'B+', credits: 3, keywords: ['lexer', 'AST', 'LLVM'] },
];

// Reminder stream — things the app should surface on the home screen.
// type: hw (作業) · ann (公告) · grade (成績) · say (老師說過) · due · quiz · todo
const V3_REMINDERS = [
  // ML
  { id: 'r01', course: 'ml',  type: 'hw',    title: 'HW3 · Transformer 實作',      detail: '截止 週日 23:59',       when: '3 天後', urgency: 'high',   icon: '📝' },
  { id: 'r02', course: 'ml',  type: 'say',   title: '老師提到：期末會考 Q/K/V 細節', detail: 'L13 · 38:14',         when: '昨天',    urgency: 'mid',    icon: '💬' },
  { id: 'r03', course: 'ml',  type: 'ann',   title: '下週改為 Kahoot 隨堂測驗',      detail: '助教 · NTU COOL',     when: '2h 前',   urgency: 'mid',    icon: '📣' },
  { id: 'r04', course: 'ml',  type: 'todo',  title: '複習 L13 · 未標記段落 2 處',    detail: 'AI 建議',             when: '今天',    urgency: 'low',    icon: '✦' },
  // ALG
  { id: 'r05', course: 'alg', type: 'grade', title: 'Midterm · 87 / 100',         detail: '班平均 72',           when: '早上',    urgency: 'mid',    icon: '🎯' },
  { id: 'r06', course: 'alg', type: 'hw',    title: 'HW4 · DP 練習',              detail: '截止 下週三',          when: '8 天後',  urgency: 'low',    icon: '📝' },
  // OS
  { id: 'r07', course: 'ds',  type: 'quiz',  title: '隨堂小考：paging',            detail: '下週一課堂上',         when: '5 天後',  urgency: 'mid',    icon: '✎' },
  { id: 'r08', course: 'ds',  type: 'say',   title: '老師點名：可能會考 TLB',       detail: 'L11 · 21:04',         when: '5 天前',  urgency: 'mid',    icon: '💬' },
  // LIN
  { id: 'r09', course: 'lin', type: 'hw',    title: 'HW2 · SVD 計算',             detail: '截止 今天 23:59',      when: '今天',    urgency: 'high',   icon: '📝' },
  { id: 'r10', course: 'lin', type: 'ann',   title: '下週停課一次',                detail: '老師出差',             when: '早上',    urgency: 'low',    icon: '📣' },
  // STAT
  { id: 'r11', course: 'stat', type: 'grade', title: 'Quiz 4 · 9 / 10',          detail: '',                    when: '昨天',    urgency: 'low',    icon: '🎯' },
  { id: 'r12', course: 'stat', type: 'say',  title: '老師推薦：Ross 第 6 章',      detail: 'L12 · 42:31',         when: '2 天前',  urgency: 'low',    icon: '💬' },
  // CMP
  { id: 'r13', course: 'cmp', type: 'hw',    title: 'Lab 2 · 寫一個 lexer',       detail: '截止 週六',           when: '4 天後',  urgency: 'mid',    icon: '📝' },
  { id: 'r14', course: 'cmp', type: 'ann',   title: 'TA 辦公時間改週二',           detail: '助教公告',            when: '1 天前',  urgency: 'low',    icon: '📣' },
];

// Today's time-blocked schedule (for timeline-style directions)
const V3_TODAY = [
  { t: '10:00', dur: 90, course: 'stat', title: '機率論 · L13', room: '新數 203', status: 'done',   hasNotes: true },
  { t: '14:00', dur: 90, course: 'alg',  title: '演算法 · 習題課', room: '資訊館 211', status: 'done', hasNotes: false },
  { t: '19:00', dur: 90, course: 'ml',   title: '機器學習 · L14', room: '電二 103', status: 'next',   hasNotes: false },
];

const V3_WEEK = [
  { day: '一', date: '04/21', items: [{ t: '10', c: 'stat' }, { t: '14', c: 'alg' }, { t: '19', c: 'ml' }] },
  { day: '二', date: '04/22', items: [{ t: '09', c: 'lin' }, { t: '13', c: 'ds' }] },
  { day: '三', date: '04/23', items: [{ t: '16', c: 'cmp' }] },
  { day: '四', date: '04/24', items: [{ t: '14', c: 'alg' }] },
  { day: '五', date: '04/25', items: [{ t: '10', c: 'stat' }] },
  { day: '六', date: '04/26', items: [] },
  { day: '日', date: '04/27', items: [] },
];

// Course "live" status model:
// idle · recording · transcribing · summarizing · ready
const V3_LIVE = { course: 'ml', state: 'recording', elapsed: '08:42', level: 0.6 };

const v3Fmt = m => m >= 60 ? `${Math.floor(m/60)}h${m%60 ? ' ' + (m%60) + 'm' : ''}` : `${m}m`;
const v3GetCourse = id => V3_COURSES.find(c => c.id === id);

// Dynamic Island — 縮在上方 top bar 裡，hover 才橫向展回原本樣子 + 往下掉一點
//
// 平時 (collapsed): top: 9，垂直置中於 46px 的 top bar 內
//   ● ML · L14   08:42
//
// Hover (expanded): top: 34，往下滑到 top bar 下緣（原本未改前的位置）
//   ● 機器學習 · L14  ||||| 08:42 | ⏸ ■
//
// 關鍵：height 鎖定不變、永遠膠囊；只動 width + top + 右側 slot；
// 視覺上是「pill 變長 + 往下落一點」，不擋 top bar 中央留空。
const V3Island = () => {
  const [t, setT] = React.useState(0);
  const [hover, setHover] = React.useState(false);
  React.useEffect(() => {
    const i = setInterval(() => setT(x => x + 1), 100);
    return () => clearInterval(i);
  }, []);
  const bars = Array.from({ length: 5 }, (_, i) =>
    0.3 + 0.7 * Math.abs(Math.sin(t * 0.2 + i * 0.8)));

  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const trans = (props, ms = 380) =>
    props.map(p => `${p} ${ms}ms ${ease}`).join(', ');

  // 展開才出現的元素 — max-width + margin-left + opacity 同步動畫
  const ExpandSlot = ({ children, mw, ml = 8 }) => (
    <div style={{
      display: 'flex', alignItems: 'center',
      maxWidth: hover ? mw : 0,
      marginLeft: hover ? ml : 0,
      opacity: hover ? 1 : 0,
      overflow: 'hidden',
      transition: trans(['max-width', 'margin-left', 'opacity']),
    }}>
      {children}
    </div>
  );

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        top: hover ? 34 : 9,          // 收起卡 top bar 內 → 展開往下掉到 top bar 下緣
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#0a0a0a',
        color: '#fff',
        borderRadius: 999,            // 永遠膠囊
        height: 28,                   // 永遠不變高
        padding: '0 14px 0 12px',
        display: 'flex',
        alignItems: 'center',
        zIndex: 50,
        boxShadow: hover
          ? '0 8px 24px rgba(0,0,0,0.38), 0 0 0 0.5px rgba(255,255,255,0.1) inset'
          : '0 3px 10px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(255,255,255,0.08) inset',
        fontSize: 12,
        fontFamily: 'Inter, "Noto Sans TC", sans-serif',
        cursor: 'default',
        whiteSpace: 'nowrap',
        transition: trans(['top', 'box-shadow']),
      }}>

      {/* 紅燈 */}
      <span style={{
        width: 7, height: 7, borderRadius: 4, background: '#ff4b4b',
        boxShadow: '0 0 6px #ff4b4b',
        animation: 'v3pulse 1.4s ease-in-out infinite',
        flexShrink: 0,
      }}/>

      {/* 課程標籤 — 收起縮寫，展開全名 */}
      <span style={{
        marginLeft: 8, fontWeight: 600,
        fontSize: hover ? 12 : 11,
        letterSpacing: hover ? '-0.01em' : '0.02em',
        color: '#fff',
        transition: trans(['font-size', 'letter-spacing']),
      }}>
        {hover ? '機器學習 · L14' : 'ML · L14'}
      </span>

      {/* 音量條 — hover 才展開 */}
      <ExpandSlot mw={28} ml={10}>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 14 }}>
          {bars.map((h, i) => (
            <div key={i} style={{
              width: 2.5, height: `${30 + h * 70}%`, background: '#6effa0',
              borderRadius: 1, transition: 'height 80ms linear',
            }}/>
          ))}
        </div>
      </ExpandSlot>

      {/* 計時 — 永遠顯示 */}
      <span style={{
        marginLeft: 8,
        fontVariantNumeric: 'tabular-nums',
        color: '#aaa', fontSize: 11, fontWeight: 500,
      }}>08:42</span>

      {/* 分隔線 + ⏸ ■ — hover 才展開 */}
      <ExpandSlot mw={64} ml={10}>
        <span style={{ width: 1, height: 14, background: '#333',
          marginRight: 10, flexShrink: 0 }}/>
        <span style={{ color: '#bbb', cursor: 'pointer', marginRight: 10,
          fontSize: 13 }}>⏸</span>
        <span style={{ color: '#ff4b4b', cursor: 'pointer',
          fontSize: 13 }}>■</span>
      </ExpandSlot>

      <style>{`@keyframes v3pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}`}</style>
    </div>
  );
};

Object.assign(window, { V3_COURSES, V3_REMINDERS, V3_TODAY, V3_WEEK, V3_LIVE,
  v3Fmt, v3GetCourse, V3Island });
