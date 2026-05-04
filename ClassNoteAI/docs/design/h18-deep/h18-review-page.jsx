// ClassNoteAI · ReviewPage (post-class review) + shared bilink system
// Features: bilink hover tooltips, markdown notes, exam list, chapter TOC

// ─── Knowledge graph: concept → past note entry ──────────────────
// Used by BOTH the recording page and the review page.
const RV_CONCEPTS = {
  'scaling factor': {
    summary: '√d_k，Transformer 論文中為避免 softmax saturate 而加入的縮放。',
    source: 'L13 · Self-Attention 推導',
    noteId: 'L13',
    time: '38:14',
  },
  'softmax saturate': {
    summary: '當 logits 過大，softmax 會近似 one-hot，梯度消失。',
    source: 'L10 · 激活函數',
    noteId: 'L10',
    time: '22:40',
  },
  'self-attention': {
    summary: '每個 token 透過 Q·Kᵀ 跟所有其他 token 算相似度後加權 V。',
    source: 'L13 · Self-Attention 推導',
    noteId: 'L13',
    time: '14:02',
  },
  'query': {
    summary: '在 self-attention 裡，query 決定「我想關注誰」。',
    source: 'L13 · 18:30',
    noteId: 'L13', time: '18:30',
  },
  'key': {
    summary: 'key 是被關注的 token 的「標籤」，和 query 做點積決定權重。',
    source: 'L13 · 20:10',
    noteId: 'L13', time: '20:10',
  },
  'HW3': {
    summary: '實作 multi-head attention，週日 23:59 截止。',
    source: '作業 · HW3',
    noteId: 'HW3',
    time: null,
  },
  'multi-head': {
    summary: '多顆獨立的 attention head 平行運作，最後 concat。',
    source: '本堂 · L14',
    noteId: 'L14', time: '02:18',
  },
  'softmax': {
    summary: '把實數向量轉成機率分佈的函數，所有元素和為 1。',
    source: 'L03 · 機率與線性代數回顧',
    noteId: 'L03', time: '30:00',
  },
};

// ─── Bilink: renders text with [[concept]] or known keyword as a linked span ─
const RVBilink = ({ text, theme: T, ct, onJumpNote, inline = false, baseSize = 14 }) => {
  const [hover, setHover] = React.useState(null); // { key, x, y }

  // Find all concept hits in text (case-insensitive longest-first)
  const keys = Object.keys(RV_CONCEPTS).sort((a, b) => b.length - a.length);
  const segments = [];
  let remaining = text;
  let guard = 0;
  while (remaining && guard++ < 200) {
    let hit = null;
    for (const k of keys) {
      const idx = remaining.toLowerCase().indexOf(k.toLowerCase());
      if (idx !== -1 && (hit === null || idx < hit.idx)) {
        hit = { key: k, idx, len: k.length };
      }
    }
    if (!hit) { segments.push({ kind: 'text', v: remaining }); break; }
    if (hit.idx > 0) segments.push({ kind: 'text', v: remaining.slice(0, hit.idx) });
    segments.push({ kind: 'link', v: remaining.slice(hit.idx, hit.idx + hit.len), key: hit.key });
    remaining = remaining.slice(hit.idx + hit.len);
  }

  return (
    <span style={{ position: 'relative' }}>
      {segments.map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.v}</span>;
        const c = RV_CONCEPTS[s.key];
        return (
          <span key={i}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover({ key: s.key, x: r.left + r.width / 2, y: r.top - 8 });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => { e.stopPropagation(); onJumpNote?.(c); }}
            style={{
              display: 'inline', cursor: 'pointer',
              color: ct, fontWeight: 600,
              textDecoration: 'underline',
              textDecorationStyle: 'dotted',
              textDecorationColor: T.mode === 'dark' ? 'rgba(215,165,80,0.5)' : 'rgba(180,120,60,0.6)',
              textUnderlineOffset: 3,
            }}>{s.v}</span>
        );
      })}
      {hover && (() => {
        const c = RV_CONCEPTS[hover.key];
        return ReactDOM.createPortal(
          <div style={{
            position: 'fixed', left: hover.x, top: hover.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 1000, pointerEvents: 'none',
            maxWidth: 320, padding: '10px 12px',
            background: T.mode === 'dark' ? '#1c1c18' : '#1a1916',
            color: '#f4f2ec',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
            fontSize: 12, lineHeight: 1.55,
            fontFamily: 'Inter, "Noto Sans TC", sans-serif',
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.14em',
              color: '#c7a77a', fontWeight: 800, fontFamily: 'JetBrains Mono',
              marginBottom: 4 }}>
              ✦ {hover.key}
            </div>
            <div>{c.summary}</div>
            <div style={{ fontSize: 10, marginTop: 6, opacity: 0.6,
              fontFamily: 'JetBrains Mono' }}>
              ↳ {c.source}{c.time ? ` · ${c.time}` : ''} · 點擊前往
            </div>
          </div>,
          document.body
        );
      })()}
    </span>
  );
};

// ─── Markdown-lite renderer for notes (headings / bold / bullets / code) ─
const RVMarkdown = ({ src, theme: T, ct, onJumpNote }) => {
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^#\s/.test(line)) {
      out.push(<div key={i} style={{ fontSize: 20, fontWeight: 800,
        letterSpacing: '-0.02em', marginTop: 18, marginBottom: 8,
        color: T.text }}>{line.replace(/^#\s/, '')}</div>);
      i++;
    } else if (/^##\s/.test(line)) {
      out.push(<div key={i} style={{ fontSize: 15, fontWeight: 700,
        marginTop: 16, marginBottom: 6, color: T.text,
        letterSpacing: '-0.01em' }}>{line.replace(/^##\s/, '')}</div>);
      i++;
    } else if (/^-\s/.test(line)) {
      const bullets = [];
      while (i < lines.length && /^-\s/.test(lines[i])) {
        bullets.push(lines[i].replace(/^-\s/, ''));
        i++;
      }
      out.push(<ul key={'u'+i} style={{ paddingLeft: 20, margin: '6px 0',
        fontSize: 13, lineHeight: 1.75, color: T.textMid }}>
        {bullets.map((b, bi) => <li key={bi}>
          <RVBilink text={b} theme={T} ct={ct} onJumpNote={onJumpNote}/>
        </li>)}
      </ul>);
    } else if (line.trim() === '') {
      out.push(<div key={i} style={{ height: 6 }}/>); i++;
    } else if (/^```/.test(line)) {
      const block = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { block.push(lines[i]); i++; }
      i++;
      out.push(<pre key={'c'+i} style={{ background: T.mode === 'dark' ? '#0d0d0a' : '#f4f0e5',
        padding: '10px 12px', borderRadius: 6, fontSize: 11,
        fontFamily: 'JetBrains Mono', color: T.text, overflow: 'auto',
        margin: '8px 0', lineHeight: 1.6 }}>{block.join('\n')}</pre>);
    } else {
      out.push(<div key={i} style={{ fontSize: 13, lineHeight: 1.75,
        color: T.textMid, margin: '4px 0' }}>
        <RVBilink text={line} theme={T} ct={ct} onJumpNote={onJumpNote}/>
      </div>);
      i++;
    }
  }
  return <div>{out}</div>;
};

// ─── H18 AudioPlayer · 底部 52px 固定 bar ─────────────────────
// 對應 src/components/AudioPlayer.tsx 的 player UI，以 H18 視覺重做。
// 真實實作會透過 audioUrl + onSeek 跟 SubtitleDisplay 同步當前段落
// (currentTime prop 傳下去自動高亮)。prototype 用 setInterval 模擬。
const SPEED_OPTIONS = [1, 1.5, 2, 0.5];
const fmtTimeM = (s) => {
  const sec = Math.max(0, Math.floor(s));
  const m = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const H18AudioPlayer = ({ T, ct, lectureTitle, isPlaying, setIsPlaying,
  currentTime, setCurrentTime, duration, volume, setVolume,
  muted, setMuted, speed, setSpeed, onClose }) => {
  const progressRef = React.useRef(null);
  const [scrubHover, setScrubHover] = React.useState(false);

  // tick — 1s interval, advances currentTime by speed seconds
  React.useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setCurrentTime((t) => {
        const next = t + speed;
        if (next >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, speed, duration, setCurrentTime, setIsPlaying]);

  const handleSeek = (e) => {
    if (!progressRef.current) return;
    const r = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setCurrentTime(pct * duration);
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(speed);
    setSpeed(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]);
  };

  const progressPct = (currentTime / duration) * 100;

  // SVG icons (inline)
  const IconSkip = ({ dir, sec }) => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <path
        d={dir === 'back'
          ? 'M11 5 L4 10 L11 15 Z M13 5 L13 15'
          : 'M9 5 L16 10 L9 15 Z M7 5 L7 15'}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.5"
        strokeLinejoin="round"/>
    </svg>
  );
  const IconPlay = () => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
      <path d="M5 4 L16 10 L5 16 Z" strokeLinejoin="round"/>
    </svg>
  );
  const IconPause = () => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
      <rect x="5" y="4" width="4" height="12" rx="1"/>
      <rect x="11" y="4" width="4" height="12" rx="1"/>
    </svg>
  );
  const IconVol = ({ muted }) => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <path d="M3 8 L7 8 L11 4 L11 16 L7 12 L3 12 Z"
        fill="currentColor" stroke="currentColor" strokeLinejoin="round"/>
      {!muted && (
        <>
          <path d="M13.5 7 Q15 10 13.5 13" stroke="currentColor"
            strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          <path d="M15.5 5 Q18 10 15.5 15" stroke="currentColor"
            strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        </>
      )}
      {muted && (
        <line x1="13" y1="6" x2="18" y2="14"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      )}
    </svg>
  );

  return (
    <div style={{
      flexShrink: 0,
      borderTop: `1px solid ${T.border}`,
      background: T.surface,
      padding: '10px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      fontFamily: '"Inter", "Noto Sans TC", sans-serif',
    }}>
      {/* Lecture context (small label) */}
      <div style={{ minWidth: 0, flexShrink: 0, maxWidth: 180 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.16em',
          color: T.textDim, fontWeight: 800,
          fontFamily: 'JetBrains Mono' }}>
          ▶ NOW PLAYING
        </div>
        <div style={{ fontSize: 11, color: T.text, fontWeight: 600,
          marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden',
          textOverflow: 'ellipsis' }}>
          {lectureTitle}
        </div>
      </div>

      {/* Skip back */}
      <button onClick={() => setCurrentTime((t) => Math.max(0, t - 10))}
        title="倒退 10 秒" style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'transparent', color: T.textMid,
          border: `1px solid ${T.border}`, cursor: 'pointer',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          fontFamily: 'inherit',
        }}>
        <IconSkip dir="back"/>
      </button>

      {/* Play / Pause (primary, T.invert) */}
      <button onClick={() => setIsPlaying((p) => !p)}
        title={isPlaying ? '暫停' : '播放'} style={{
          width: 36, height: 36, borderRadius: 18,
          background: T.invert, color: T.invertInk,
          border: 'none', cursor: 'pointer',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          fontFamily: 'inherit',
        }}>
        {isPlaying ? <IconPause/> : <IconPlay/>}
      </button>

      {/* Skip forward */}
      <button onClick={() => setCurrentTime((t) => Math.min(duration, t + 10))}
        title="前進 10 秒" style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'transparent', color: T.textMid,
          border: `1px solid ${T.border}`, cursor: 'pointer',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          fontFamily: 'inherit',
        }}>
        <IconSkip dir="forward"/>
      </button>

      {/* Current time */}
      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono',
        color: T.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        minWidth: 42, textAlign: 'right' }}>
        {fmtTimeM(currentTime)}
      </span>

      {/* Progress bar (clickable scrubber) */}
      <div ref={progressRef}
        onClick={handleSeek}
        onMouseEnter={() => setScrubHover(true)}
        onMouseLeave={() => setScrubHover(false)}
        style={{
          flex: 1, height: 16, position: 'relative',
          cursor: 'pointer', display: 'flex', alignItems: 'center',
        }}>
        <div style={{
          width: '100%', height: scrubHover ? 4 : 3,
          background: T.borderSoft, borderRadius: 2, position: 'relative',
          transition: 'height 120ms',
        }}>
          <div style={{
            position: 'absolute', inset: 0, width: `${progressPct}%`,
            background: T.accent, borderRadius: 2,
          }}/>
          {/* Scrubber dot */}
          <div style={{
            position: 'absolute', left: `${progressPct}%`,
            top: '50%', transform: 'translate(-50%, -50%)',
            width: scrubHover ? 12 : 0, height: scrubHover ? 12 : 0,
            borderRadius: 6, background: T.accent,
            border: `2px solid ${T.surface}`,
            transition: 'width 120ms, height 120ms',
            pointerEvents: 'none',
          }}/>
        </div>
      </div>

      {/* Total time */}
      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono',
        color: T.textDim, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
        minWidth: 42 }}>
        {fmtTimeM(duration)}
      </span>

      {/* Speed cycle */}
      <button onClick={cycleSpeed} title="播放速度 (點擊切換)"
        style={{
          padding: '4px 10px', fontSize: 11, fontWeight: 700,
          fontFamily: 'JetBrains Mono', letterSpacing: '0.04em',
          background: 'transparent',
          color: speed === 1 ? T.textMid : T.accent,
          border: `1px solid ${speed === 1 ? T.border : T.accent}`,
          borderRadius: 5, cursor: 'pointer', flexShrink: 0,
          minWidth: 40, textAlign: 'center',
        }}>
        {speed}×
      </button>

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6,
        flexShrink: 0 }}>
        <button onClick={() => setMuted((m) => !m)}
          title={muted ? '取消靜音' : '靜音'}
          style={{
            width: 24, height: 24, borderRadius: 4,
            background: 'transparent',
            color: muted ? T.hot : T.textMid,
            border: 'none', cursor: 'pointer',
            display: 'grid', placeItems: 'center',
            fontFamily: 'inherit',
          }}>
          <IconVol muted={muted}/>
        </button>
        <input type="range" min="0" max="100"
          value={muted ? 0 : volume}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            if (Number(e.target.value) > 0) setMuted(false);
          }}
          style={{
            width: 70, height: 3,
            accentColor: T.accent,
            cursor: 'pointer',
          }}/>
      </div>

      {/* Close player */}
      <button onClick={onClose} title="關閉播放器"
        style={{
          width: 24, height: 24, borderRadius: 4,
          background: 'transparent', color: T.textFaint,
          border: 'none', cursor: 'pointer', fontSize: 12,
          fontFamily: 'inherit', flexShrink: 0,
        }}>✕</button>
    </div>
  );
};

// ─── Review page (for past lectures) ─────────────────────────────
const ReviewPage = ({ theme: T, courseId = 'ml', lectureN = 13, onBack, onJumpLecture }) => {
  const c = v3GetCourse(courseId);
  const ct = h18CourseText(c, T);
  const [pane, setPane] = React.useState('transcript'); // transcript | notes | exam
  const [lang, setLang] = React.useState('both'); // both | zh | en
  const [grouping, setGrouping] = React.useState('para'); // sent | para

  // Audio player state
  const [audioOpen, setAudioOpen] = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(380); // 06:20 mock
  const audioDuration = 52 * 60 + 18; // 52:18 mock total
  const [volume, setVolume] = React.useState(80);
  const [muted, setMuted] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);

  // Past-lecture subtitle mock (L13) — denser, with topic boundaries
  const subs = [
    { t: 0,    zh: '今天我們開始講 self-attention 的推導過程。',
               en: "Today we're starting with the derivation of self-attention.", topic: true, topicTitle: '開場 · 今日目標' },
    { t: 30,   zh: '上週講過 word embedding，今天要把 embedding 之間的關係抓出來。',
               en: 'Last week we covered word embeddings; today we capture the relations between them.' },
    { t: 62,   zh: '先快速複習為什麼 RNN 不夠用。',
               en: "Let's quickly revisit why RNNs aren't enough." },
    { t: 120,  zh: '所以我們要定義三個矩陣：query、key、value。',
               en: 'So we define three matrices: query, key, and value.', topic: true, topicTitle: 'Q/K/V 的定義' },
    { t: 156,  zh: 'Query 代表「我想找什麼」，key 是「我有什麼」，value 是實際內容。',
               en: 'Query is "what I want", key is "what I have", value is the actual content.' },
    { t: 210,  zh: '這三個矩陣都是可學的參數 W_Q、W_K、W_V。',
               en: 'All three are learnable parameters: W_Q, W_K, W_V.' },
    { t: 240,  zh: '那為什麼需要 scaling factor？這點很重要，我第一次在這裡提。',
               en: 'Why do we need a scaling factor? This is important — mentioning it for the first time here.', topic: true, topicTitle: 'Scaling Factor 的動機' },
    { t: 340,  zh: '如果 d_k 很大，Q·Kᵀ 的數值會變得很大。',
               en: 'When d_k is large, Q·Kᵀ values grow very large.' },
    { t: 420,  zh: '數值一大，softmax 會 saturate，造成梯度消失。',
               en: 'Once values are large, softmax saturates and gradients vanish.', exam: true },
    { t: 540,  zh: '所以我們除以 √d_k 來穩定訓練。',
               en: 'We divide by √d_k to stabilize training.' },
    { t: 620,  zh: '這個數字不是隨便選的，可以從變異數推出來。',
               en: "This number isn't arbitrary — it can be derived from variance." },
    { t: 720,  zh: '這題考試每年都會考，記好是 √d_k 不是 d_k。',
               en: "This appears every year on the exam — remember it's √d_k, not d_k.", exam: true },
    { t: 830,  zh: '好，那我們來看完整的 attention 公式。',
               en: 'OK, now let\'s look at the full attention formula.', topic: true, topicTitle: '完整公式推導' },
    { t: 900,  zh: 'Attention(Q,K,V) = softmax(Q·Kᵀ / √d_k) · V。',
               en: 'Attention(Q,K,V) = softmax(Q·Kᵀ / √d_k) · V.' },
    { t: 1020, zh: '我們來手算一個小例子，d_k = 4。',
               en: "Let's work through a small example with d_k = 4." },
    { t: 1180, zh: '這個形式就是 scaled dot-product attention。',
               en: 'This form is called scaled dot-product attention.' },
    { t: 1260, zh: '時間差不多，下週會接 multi-head attention。',
               en: "We're almost out of time; next week: multi-head attention.", topic: true, topicTitle: '下次預告' },
    { t: 1310, zh: '作業 HW3 會用到今天的推導，請務必記牢 √d_k 這個細節。',
               en: "HW3 will use today's derivation — make sure you remember the √d_k detail." },
  ];

  // Group subs into paragraphs by topic boundaries
  const paragraphs = React.useMemo(() => {
    const groups = [];
    let current = null;
    for (const s of subs) {
      if (s.topic || !current) {
        current = { start: s, items: [s] };
        groups.push(current);
      } else {
        current.items.push(s);
      }
    }
    return groups;
  }, []);

  // AI-generated notes (editable, markdown)
  const defaultNotes = `# L13 · Self-Attention 推導

老師整堂在講 self-attention 的基本公式與為什麼要有 scaling factor。

## 核心概念

- query, key, value 是三個線性投影
- softmax(Q·Kᵀ / √d_k) · V
- 為什麼要除以 √d_k？避免 softmax saturate

## 考點（老師強調每年考）

- scaling factor 的推導
- 為什麼不能直接 softmax(QKᵀ)

## 下次預告

下週會接 multi-head，會連到 HW3。

\`\`\`
Attention(Q,K,V) = softmax(QKᵀ / √d_k) · V
\`\`\``;
  const [notes, setNotes] = React.useState(defaultNotes);
  const [editingNotes, setEditingNotes] = React.useState(false);

  const jumpNote = (concept) => {
    if (!concept) return;
    // For demo: if concept points to a different lecture, navigate; else just toast-like scroll
    const match = concept.noteId?.match(/L(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n !== lectureN) onJumpLecture?.(n);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden' }}>

      {/* Hero — dimmer, softer than recording page */}
      <div style={{
        padding: '18px 28px 20px', borderBottom: `1px solid ${T.border}`,
        background: T.surface, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <H18Breadcrumb theme={T} course={c} lectureN={lectureN}
            lectureTitle="Self-Attention 推導" kind="review"
            onBack={onBack}
            extraPills={<span style={{ fontSize: 10, color: T.textFaint,
              fontFamily: 'JetBrains Mono',
              letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
              昨天 · 52 分鐘 · ★ 2 考點
            </span>}/>
          <div style={{ flex: 1 }}/>
          <button onClick={() => setAudioOpen((o) => {
              // 第一次打開時順便播放
              if (!o) setIsPlaying(true);
              return !o;
            })}
            title={audioOpen ? '關閉播放器' : '展開底部播放器'}
            style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600,
              background: audioOpen ? T.invert : 'transparent',
              color: audioOpen ? T.invertInk : T.textMid,
              border: `1px solid ${audioOpen ? T.invert : T.border}`,
              borderRadius: 6,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
            {audioOpen
              ? <>{isPlaying ? '⏸' : '▶'} 回放中 · {fmtTimeM(currentTime)}</>
              : <>▶ 回放錄音</>}
          </button>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
          marginTop: 14, color: T.text }}>Self-Attention 推導</div>
        <div style={{ fontSize: 12, color: T.textMid, marginTop: 4 }}>
          李宏毅 · 電二 103 · 04/22 週二 19:00–19:52
        </div>
      </div>

      {/* 3-column body: TOC | center content | side (notes/exam) */}
      <div style={{ flex: 1, display: 'grid',
        gridTemplateColumns: '220px 1fr 420px',
        background: T.border, gap: 1, overflow: 'hidden' }}>

        {/* TOC / chapters */}
        <div style={{ background: T.surface2, overflow: 'auto', padding: '14px 16px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.16em', color: T.textDim,
            fontWeight: 800, fontFamily: 'JetBrains Mono', marginBottom: 10 }}>
            章節 · 4
          </div>
          {[
            { t: '00:00', title: '開場 · 複習', tag: null },
            { t: '01:30', title: 'Q·K·V 定義', tag: null },
            { t: '04:00', title: 'Scaling factor', tag: '考點' },
            { t: '21:00', title: '下週預告', tag: null },
          ].map((ch, i) => (
            <div key={i} style={{ padding: '8px 10px', borderRadius: 5,
              cursor: 'pointer', background: i === 2 ? h18Accent(c, T) : 'transparent',
              marginBottom: 2 }}>
              <div style={{ fontSize: 9, color: T.textDim,
                fontFamily: 'JetBrains Mono', letterSpacing: '0.06em' }}>{ch.t}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text,
                marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                {ch.title}
                {ch.tag && <span style={{ fontSize: 8, padding: '1px 5px',
                  background: T.hot, color: '#fff', borderRadius: 2,
                  fontWeight: 800, fontFamily: 'JetBrains Mono',
                  letterSpacing: '0.06em' }}>{ch.tag}</span>}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 20, fontSize: 10, letterSpacing: '0.16em',
            color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono',
            marginBottom: 10 }}>
            概念圖 · 7
          </div>
          {Object.keys(RV_CONCEPTS).slice(0, 7).map(k => {
            const c2 = RV_CONCEPTS[k];
            return (
              <div key={k} onClick={() => jumpNote(c2)} style={{
                padding: '6px 10px', borderRadius: 5,
                cursor: 'pointer', fontSize: 11,
                color: c2.noteId?.match(/L(\d+)/)?.[1] === String(lectureN) ? T.text : T.textMid,
                fontFamily: 'Inter' }}>
                <span style={{ color: ct, marginRight: 6 }}>◇</span>
                {k}
              </div>
            );
          })}
        </div>

        {/* Transcript (center) */}
        <div style={{ background: T.surface, overflow: 'auto', padding: '20px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
            position: 'sticky', top: -20, background: T.surface, zIndex: 2,
            paddingBottom: 10, borderBottom: `1px solid ${T.borderSoft}`,
            marginLeft: -28, marginRight: -28, paddingLeft: 28, paddingRight: 28,
            paddingTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, letterSpacing: '0.16em', color: T.textDim,
              fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
              完整逐字稿 · {paragraphs.length} 段 · {subs.length} 句
            </span>
            <div style={{ flex: 1 }}/>

            {/* Language toggle */}
            <div style={{ display: 'flex', gap: 0, border: `1px solid ${T.border}`,
              borderRadius: 6, overflow: 'hidden' }}>
              {[
                { k: 'both', label: '雙語' },
                { k: 'zh',   label: '中' },
                { k: 'en',   label: 'EN' },
              ].map(o => (
                <button key={o.k} onClick={() => setLang(o.k)} style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  background: lang === o.k ? T.invert : 'transparent',
                  color: lang === o.k ? T.invertInk : T.textMid,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>{o.label}</button>
              ))}
            </div>

            {/* Grouping toggle */}
            <div style={{ display: 'flex', gap: 0, border: `1px solid ${T.border}`,
              borderRadius: 6, overflow: 'hidden' }}>
              {[
                { k: 'para', label: '段落', title: '按主題分段（易讀）' },
                { k: 'sent', label: '逐句', title: '每句帶時間戳（精準）' },
              ].map(o => (
                <button key={o.k} onClick={() => setGrouping(o.k)} title={o.title} style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  background: grouping === o.k ? T.invert : 'transparent',
                  color: grouping === o.k ? T.invertInk : T.textMid,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>{o.label}</button>
              ))}
            </div>
          </div>

          {grouping === 'sent' && subs.map((s, i) => (
            <div key={i} style={{ marginBottom: 18, padding: '6px 0',
              borderLeft: `3px solid ${s.exam ? T.hot : s.topic ? ct : 'transparent'}`,
              paddingLeft: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono',
                  color: T.textFaint }}>{rv2Fmt(s.t)}</span>
                {s.topic && <span style={{ fontSize: 9, padding: '1px 6px',
                  background: ct, color: T.invertInk, borderRadius: 3,
                  fontWeight: 800, fontFamily: 'JetBrains Mono' }}>主題</span>}
                {s.exam && <span style={{ fontSize: 9, padding: '1px 6px',
                  background: T.hot, color: '#fff', borderRadius: 3,
                  fontWeight: 800, fontFamily: 'JetBrains Mono' }}>考點</span>}
              </div>
              {(lang === 'both' || lang === 'zh') && (
                <div style={{ fontSize: 15, lineHeight: 1.6, color: T.text,
                  letterSpacing: '-0.005em' }}>
                  <RVBilink text={s.zh} theme={T} ct={ct} onJumpNote={jumpNote}/>
                </div>
              )}
              {(lang === 'both' || lang === 'en') && (
                <div style={{ fontSize: lang === 'en' ? 15 : 12,
                  lineHeight: lang === 'en' ? 1.6 : 1.55,
                  color: lang === 'en' ? T.text : T.textDim,
                  marginTop: lang === 'both' ? 4 : 0,
                  fontStyle: lang === 'en' ? 'normal' : 'italic',
                  letterSpacing: lang === 'en' ? '-0.005em' : 0 }}>
                  <RVBilink text={s.en} theme={T} ct={ct} onJumpNote={jumpNote}/>
                </div>
              )}
            </div>
          ))}

          {grouping === 'para' && paragraphs.map((g, gi) => {
            const hasExam = g.items.some(s => s.exam);
            return (
              <div key={gi} style={{ marginBottom: 28,
                borderLeft: `3px solid ${hasExam ? T.hot : ct}`,
                paddingLeft: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10,
                  marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono',
                    color: ct, fontWeight: 800 }}>
                    {rv2Fmt(g.start.t)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text,
                    letterSpacing: '-0.01em' }}>
                    {g.start.topicTitle || '段落'}
                  </span>
                  {hasExam && <span style={{ fontSize: 9, padding: '1px 6px',
                    background: T.hot, color: '#fff', borderRadius: 3,
                    fontWeight: 800, fontFamily: 'JetBrains Mono' }}>考點</span>}
                  <div style={{ flex: 1 }}/>
                  <span style={{ fontSize: 10, color: T.textFaint,
                    fontFamily: 'JetBrains Mono' }}>
                    {g.items.length} 句
                  </span>
                </div>
                {(lang === 'both' || lang === 'zh') && (
                  <div style={{ fontSize: 15, lineHeight: 1.75, color: T.text,
                    letterSpacing: '-0.005em', textWrap: 'pretty' }}>
                    {g.items.map((s, si) => (
                      <span key={si} style={{
                        background: s.exam ? (T.mode === 'dark' ? '#3a1412' : '#fff1ef') : 'transparent',
                        padding: s.exam ? '1px 3px' : 0,
                        borderRadius: s.exam ? 3 : 0,
                      }}>
                        <RVBilink text={s.zh} theme={T} ct={ct} onJumpNote={jumpNote}/>
                        {si < g.items.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </div>
                )}
                {(lang === 'both' || lang === 'en') && (
                  <div style={{ fontSize: lang === 'en' ? 15 : 12,
                    lineHeight: lang === 'en' ? 1.75 : 1.65,
                    color: lang === 'en' ? T.text : T.textDim,
                    marginTop: lang === 'both' ? 8 : 0,
                    fontStyle: lang === 'en' ? 'normal' : 'italic',
                    letterSpacing: lang === 'en' ? '-0.005em' : 0,
                    textWrap: 'pretty' }}>
                    {g.items.map((s, si) => (
                      <span key={si}>
                        <RVBilink text={s.en} theme={T} ct={ct} onJumpNote={jumpNote}/>
                        {si < g.items.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Side pane: notes / exam tabs */}
        <div style={{ background: T.surface2, display: 'flex', flexDirection: 'column',
          overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            {[
              { k: 'notes', label: '筆記' },
              { k: 'exam', label: '考點 · 3' },
              { k: 'transcript', label: 'AI 摘要' },
            ].map(o => (
              <button key={o.k} onClick={() => setPane(o.k)} style={{
                flex: 1, padding: '10px 8px', fontSize: 11, fontWeight: 700,
                background: 'transparent',
                color: pane === o.k ? T.text : T.textDim,
                border: 'none',
                borderBottom: pane === o.k ? `2px solid ${ct}` : '2px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{o.label}</button>
            ))}
          </div>

          {pane === 'notes' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 18,
              display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 9, letterSpacing: '0.16em', color: T.textDim,
                  fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
                  我的筆記 · Markdown
                </span>
                <div style={{ flex: 1 }}/>
                <button onClick={() => setEditingNotes(!editingNotes)} style={{
                  padding: '4px 8px', fontSize: 10, fontWeight: 600,
                  border: `1px solid ${T.border}`, background: 'transparent',
                  color: T.textMid, borderRadius: 4, cursor: 'pointer' }}>
                  {editingNotes ? '✓ 完成' : '✎ 編輯'}
                </button>
              </div>
              {editingNotes ? (
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  style={{
                    flex: 1, minHeight: 300, resize: 'none',
                    padding: 12, fontSize: 12, lineHeight: 1.6,
                    fontFamily: 'JetBrains Mono',
                    background: T.mode === 'dark' ? '#0d0d0a' : '#fffdf6',
                    color: T.text,
                    border: `1px solid ${T.border}`, borderRadius: 6,
                  }}/>
              ) : (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <RVMarkdown src={notes} theme={T} ct={ct} onJumpNote={jumpNote}/>
                </div>
              )}
            </div>
          )}

          {pane === 'exam' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.16em', color: T.textDim,
                fontWeight: 800, fontFamily: 'JetBrains Mono', marginBottom: 10 }}>
                老師標為考點的段落
              </div>
              {subs.filter(s => s.exam).map((s, i) => (
                <div key={i} style={{ padding: 12, borderRadius: 6,
                  border: `1px solid ${T.border}`, background: T.surface,
                  marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: T.hot, fontWeight: 800,
                    fontFamily: 'JetBrains Mono', letterSpacing: '0.08em',
                    marginBottom: 4 }}>
                    ★ 考點 · {rv2Fmt(s.t)}
                  </div>
                  <div style={{ fontSize: 13, color: T.text, lineHeight: 1.55 }}>
                    <RVBilink text={s.zh} theme={T} ct={ct} onJumpNote={jumpNote}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pane === 'transcript' && (
            <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.16em', color: T.textDim,
                fontWeight: 800, fontFamily: 'JetBrains Mono', marginBottom: 10 }}>
                AI 自動摘要
              </div>
              <div style={{ padding: 14, borderRadius: 6,
                background: T.mode === 'dark' ? '#1c1c18' : '#faf6ea',
                border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: T.text }}>
                  這堂課主要講 <RVBilink text="self-attention" theme={T} ct={ct} onJumpNote={jumpNote}/> 的推導，
                  重點是為什麼需要 <RVBilink text="scaling factor" theme={T} ct={ct} onJumpNote={jumpNote}/>。
                  老師強調這題每年考，無縮放時 <RVBilink text="softmax saturate" theme={T} ct={ct} onJumpNote={jumpNote}/> 造成梯度消失。
                  下堂會接 <RVBilink text="multi-head" theme={T} ct={ct} onJumpNote={jumpNote}/> 與 <RVBilink text="HW3" theme={T} ct={ct} onJumpNote={jumpNote}/>。
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── 底部固定 AudioPlayer (audioOpen 才出現) ─────── */}
      {audioOpen && (
        <H18AudioPlayer T={T} ct={ct}
          lectureTitle={`${c.short} · L${lectureN} · Self-Attention 推導`}
          isPlaying={isPlaying} setIsPlaying={setIsPlaying}
          currentTime={currentTime} setCurrentTime={setCurrentTime}
          duration={audioDuration}
          volume={volume} setVolume={setVolume}
          muted={muted} setMuted={setMuted}
          speed={speed} setSpeed={setSpeed}
          onClose={() => { setAudioOpen(false); setIsPlaying(false); }}/>
      )}
    </div>
  );
};

// ─── Import dialog (called from RecordingPage 匯入教材 button) ──
const ImportDialog = ({ theme: T, open, onClose, onImport }) => {
  if (!open) return null;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 200,
      background: T.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
      display: 'grid', placeItems: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxHeight: '80vh', background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 12,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>⤓</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: T.text,
            letterSpacing: '-0.01em' }}>匯入教材</span>
          <div style={{ flex: 1 }}/>
          <button onClick={onClose} style={{
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textMid, width: 24, height: 24, borderRadius: 5,
            fontSize: 11, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, overflow: 'auto', flex: 1 }}>
          <div style={{
            border: `2px dashed ${T.border}`, borderRadius: 10,
            padding: '40px 20px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, opacity: 0.5 }}>⤓</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text,
              marginTop: 10 }}>拖曳檔案到此，或</div>
            <button onClick={onImport} style={{
              marginTop: 12, padding: '8px 16px', fontSize: 12, fontWeight: 700,
              background: T.invert, color: T.invertInk, border: 'none',
              borderRadius: 6, cursor: 'pointer' }}>選擇檔案</button>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 14,
              fontFamily: 'JetBrains Mono' }}>
              .pdf · .pptx · .keynote · .mp4 · .mov · .m4a · 最大 500MB
            </div>
          </div>
          <div style={{ marginTop: 20, fontSize: 11, color: T.textDim, lineHeight: 1.7 }}>
            <div>• 匯入後會自動 OCR，字幕出現時會對應到 PPT 頁碼</div>
            <div>• 影片檔自動提取音訊、做時間軸對齊</div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ReviewPage, ImportDialog, RVBilink, RVMarkdown, RV_CONCEPTS });
