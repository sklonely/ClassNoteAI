// ClassNoteAI · Setup Wizard (H18 視覺語言擴充)
// 不在原始 Claude Design handoff 內 — 屬於我們自己延伸的部分
// 重用 h18-theme / h18-parts 的設計 tokens 與排版規則

// ─── Wizard 步驟模型 ─────────────────────────────────────────────
const SW_STEPS = [
  { id: 'welcome',    label: '歡迎',     hint: '介紹' },
  { id: 'language',   label: '語言',     hint: '來源 / 目標' },
  { id: 'ai',         label: 'AI 助理',  hint: 'Provider · 可選' },
  { id: 'consent',    label: '同意',     hint: '錄音提醒' },
  { id: 'gpu',        label: '硬體',     hint: 'GPU 偵測' },
  { id: 'review',     label: '元件',     hint: '檢查清單' },
  { id: 'installing', label: '安裝',     hint: '下載中' },
  { id: 'complete',   label: '完成',     hint: '可以開始' },
];

// ─── 樣式積木（仿 ProfilePage 的 PHead/PRow/PBtn 等）─────────────
const SwHead = ({ T, children, top = 0 }) => (
  <div style={{ fontSize: 10, letterSpacing: '0.16em',
    color: T.textDim, fontWeight: 800, fontFamily: 'JetBrains Mono',
    marginTop: top, marginBottom: 6 }}>{children}</div>
);

const SwRow = ({ T, label, hint, right, children, danger }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16,
    padding: '14px 0',
    borderBottom: `1px solid ${T.borderSoft}` }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600,
        color: danger ? T.hot : T.text }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: T.textDim, marginTop: 3,
        lineHeight: 1.55 }}>{hint}</div>}
      {children}
    </div>
    {right && <div style={{ flexShrink: 0 }}>{right}</div>}
  </div>
);

const SwSelect = ({ T, value, options, onChange }) => (
  <select value={value} onChange={(e) => onChange?.(e.target.value)}
    style={{
      padding: '6px 10px', fontSize: 12, color: T.text,
      background: T.surface2, border: `1px solid ${T.border}`,
      borderRadius: 6, fontFamily: 'inherit', cursor: 'pointer',
      outline: 'none', minWidth: 200,
    }}>
    {options.map(o =>
      typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>
    )}
  </select>
);

const SwBtn = ({ T, children, primary, danger, ghost, onClick, disabled, fullWidth }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: '8px 16px', fontSize: 12, fontWeight: 700,
    background: primary ? T.invert : (ghost ? 'transparent' : T.surface2),
    color: danger ? T.hot : (primary ? T.invertInk : T.text),
    border: `1px solid ${danger ? T.hot : (primary ? T.invert : T.border)}`,
    borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap',
    width: fullWidth ? '100%' : 'auto',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center',
  }}>{children}</button>
);

// ─── 共用 chrome：頂部 + milestone 進度條 + 內容 + 底部 footer ──────
// onClose 為 optional：有提供才顯示右上 ✕。從 Profile 重置入口開啟時提供，
// standalone .html 入口可自行決定要不要傳。
const SwShell = ({ T, theme, setTheme, stepIdx, children, onBack, onSkip,
  onNext, onClose, nextDisabled, nextLabel = '繼續', nextPrimary = true,
  hideBack, hideSkip, hideNext, dense }) => {
  const cur = SW_STEPS[stepIdx];
  return (
    <div style={{ width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: T.bg, fontFamily: '"Inter", "Noto Sans TC", sans-serif',
      color: T.text, position: 'relative', overflow: 'hidden' }}>

      {/* 隱約的對角線背景紋理 — 跟 RV2FinishingOverlay 同款，呼應「設置中」的 vibe */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(${T.mode === 'dark' ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.018)'} 1px, transparent 1px),
                          linear-gradient(90deg, ${T.mode === 'dark' ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.018)'} 1px, transparent 1px)`,
        backgroundSize: '44px 44px',
      }}/>

      {/* 頂部：traffic lights + logo + 主題切換 + 結束精靈 ✕ */}
      {/* 紅 = 關閉視窗（Tauri appWindow.close），✕ = 結束精靈（onExit）— 語意不同 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0,
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12, zIndex: 2 }}>
        {window.H18WindowControls && (
          <>
            <H18WindowControls theme={T}
              onClose={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'close' } }))}
              onMinimize={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'min' } }))}
              onMaximize={() => window.dispatchEvent(new CustomEvent('h18-win', { detail: { action: 'max' } }))}/>
            <div style={{ width: 1, height: 14, background: T.border, margin: '0 2px' }}/>
          </>
        )}
        <div style={{ width: 26, height: 26, borderRadius: 7,
          background: T.invert, color: T.invertInk,
          display: 'grid', placeItems: 'center',
          fontSize: 13, fontWeight: 800, letterSpacing: '-0.02em' }}>C</div>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text,
          letterSpacing: '-0.01em' }}>ClassNote</span>
        <span style={{ fontSize: 10, color: T.textDim,
          fontFamily: 'JetBrains Mono', letterSpacing: '0.06em' }}>
          · 初次設置
        </span>
        <div style={{ flex: 1 }}/>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          title="切換主題 (⌘\)" style={{
            padding: '5px 11px', fontSize: 11, fontWeight: 600,
            background: 'transparent', color: T.textMid,
            border: `1px solid ${T.border}`, borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
          {theme === 'light' ? '☾' : '☀'}
          <span>{theme === 'light' ? '深色' : '亮色'}</span>
        </button>
        {onClose && (
          <button onClick={onClose} title="結束精靈" style={{
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.textMid, width: 28, height: 28, borderRadius: 6,
            fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
        )}
      </div>

      {/* 中央卡片 */}
      <div style={{ width: 720, maxWidth: 'calc(100% - 48px)',
        height: 'min(720px, calc(100% - 100px))',
        background: T.surface, borderRadius: 14,
        border: `1px solid ${T.border}`,
        boxShadow: T.mode === 'dark'
          ? '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
          : '0 30px 80px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', position: 'relative', zIndex: 1 }}>

        {/* Step header：編號 + 名稱 + milestone */}
        <div style={{ padding: '18px 28px 14px',
          borderBottom: `1px solid ${T.borderSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12,
            marginBottom: 12 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.18em',
              color: T.textDim, fontWeight: 800,
              fontFamily: 'JetBrains Mono' }}>
              STEP {String(stepIdx + 1).padStart(2, '0')} / {String(SW_STEPS.length).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text,
              letterSpacing: '-0.01em' }}>{cur.label}</span>
            <span style={{ fontSize: 11, color: T.textDim }}>· {cur.hint}</span>
          </div>

          {/* Milestone bar — 8 段水平條，每段對應一個 step */}
          <div style={{ display: 'flex', gap: 4 }}>
            {SW_STEPS.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx;
              return (
                <div key={s.id} title={s.label} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: active
                    ? T.accent
                    : done
                      ? T.text
                      : T.border,
                  transition: 'background 200ms',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  {active && (
                    <div style={{ position: 'absolute', inset: 0,
                      background: `linear-gradient(90deg, transparent, ${T.accent}88, transparent)`,
                      backgroundSize: '200% 100%',
                      animation: 'swShimmer 1.6s linear infinite' }}/>
                  )}
                </div>
              );
            })}
          </div>
          <style>{`@keyframes swShimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }`}</style>
        </div>

        {/* Step body — 可滾動 */}
        <div style={{ flex: 1, overflow: 'auto',
          padding: dense ? '20px 28px' : '28px 36px' }}>
          {children}
        </div>

        {/* Sticky footer */}
        {(!hideBack || !hideSkip || !hideNext) && (
          <div style={{ padding: '14px 28px',
            borderTop: `1px solid ${T.borderSoft}`,
            background: T.surface2,
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {!hideBack && onBack && (
              <SwBtn T={T} ghost onClick={onBack}>← 返回</SwBtn>
            )}
            <div style={{ flex: 1 }}/>
            {!hideSkip && onSkip && (
              <SwBtn T={T} ghost onClick={onSkip}>跳過此步驟</SwBtn>
            )}
            {!hideNext && onNext && (
              <SwBtn T={T} primary={nextPrimary} disabled={nextDisabled}
                onClick={onNext}>{nextLabel} →</SwBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Step 1: Welcome（4 個 stat-style feature card）──────────────
const SwWelcome = ({ T }) => {
  const FEATURES = [
    { l: '即時轉錄', v: 'Whisper', s: '本機跑、不上雲', icon: '◉' },
    { l: '雙語字幕', v: '英 → 中', s: '兩階段精修', icon: '⇄' },
    { l: 'AI 助教',  v: 'Q & A',   s: '跨堂概念連結', icon: '✦' },
    { l: '完全離線', v: '0 訂閱',  s: '所有資料留本機', icon: '⛁' },
  ];
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.022em',
        color: T.text, lineHeight: 1.15 }}>
        歡迎使用 ClassNote
      </div>
      <div style={{ fontSize: 13, color: T.textMid, marginTop: 8,
        lineHeight: 1.65, maxWidth: 560 }}>
        把英文授課變得好跟得上。這個設置精靈會幫你選好 AI 模型、語言對、
        雲端 AI 助理（可選）和錄音偏好 — 大約 5 分鐘可完成，之後也都能在
        「設定」修改。
      </div>

      <div style={{ marginTop: 24, display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {FEATURES.map(f => (
          <div key={f.l} style={{ padding: 14, borderRadius: 10,
            background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 16, color: T.accent }}>{f.icon}</span>
              <span style={{ fontSize: 10, letterSpacing: '0.14em',
                color: T.textDim, fontWeight: 700,
                fontFamily: 'JetBrains Mono' }}>{f.l}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text,
              fontFamily: 'JetBrains Mono', marginTop: 4,
              letterSpacing: '-0.02em' }}>{f.v}</div>
            <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
              {f.s}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 12, borderRadius: 8,
        background: T.surface2, border: `1px dashed ${T.borderSoft}`,
        fontSize: 11, color: T.textDim, lineHeight: 1.65,
        display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: T.accent, fontSize: 14 }}>ⓘ</span>
        <div>
          首次使用會下載一次性的 AI 模型（Whisper + 翻譯，總計約 1–3 GB）。
          後續都離線運作，不需要持續網路。
        </div>
      </div>
    </div>
  );
};

// ─── Step 2: Language ────────────────────────────────────────────
const SwLanguage = ({ T, sourceLang, setSourceLang, targetLang, setTargetLang }) => (
  <div>
    <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
      color: T.text }}>選擇語言</div>
    <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
      lineHeight: 1.65 }}>
      設定課堂的講者語言（來源）和你想看到的翻譯語言（目標）。
      之後可在「設定 → 翻譯」修改。
    </div>

    <SwHead T={T} top={24}>語言對</SwHead>
    <SwRow T={T}
      label="講者語言（來源）"
      hint="課堂上老師講的語言。`自動偵測` 讓 Whisper 在每堂課自己判斷。"
      right={<SwSelect T={T} value={sourceLang} onChange={setSourceLang}
        options={[
          { value: 'auto',  label: '自動偵測（推薦）' },
          { value: 'en',    label: 'English' },
          { value: 'ja',    label: '日本語' },
          { value: 'ko',    label: '한국어' },
          { value: 'fr',    label: 'Français' },
          { value: 'de',    label: 'Deutsch' },
          { value: 'es',    label: 'Español' },
          { value: 'zh-TW', label: '繁體中文' },
          { value: 'zh-CN', label: '簡體中文' },
        ]}/>}/>
    <SwRow T={T}
      label="目標語言"
      hint="字幕、摘要、Q&A 都會翻成這個語言。"
      right={<SwSelect T={T} value={targetLang} onChange={setTargetLang}
        options={[
          { value: 'zh-TW', label: '繁體中文' },
          { value: 'zh-CN', label: '簡體中文' },
          { value: 'en',    label: 'English' },
          { value: 'ja',    label: '日本語' },
        ]}/>}/>

    <div style={{ marginTop: 18, padding: 12, borderRadius: 8,
      background: T.surface2, border: `1px dashed ${T.borderSoft}`,
      fontSize: 11, color: T.textDim, lineHeight: 1.6,
      display: 'flex', gap: 10 }}>
      <span style={{ color: T.accent, fontSize: 14 }}>✦</span>
      <div>
        <b style={{ color: T.text }}>典型情境：</b>
        英文授課但想看中文字幕 → 來源「自動偵測」+ 目標「繁體中文」。
        中文授課需求英文摘要 → 來源「繁體中文」+ 目標「English」。
      </div>
    </div>
  </div>
);

// ─── Step 3: AI Provider 選擇（含 config 子頁）──────────────────
const SwAIProvider = ({ T, selectedProvider, setSelectedProvider, configMode, setConfigMode }) => {
  const PROVIDERS = [
    { id: 'github-models', name: 'GitHub Models',
      desc: 'Copilot Pro / Business / Enterprise 訂閱包含額度',
      sub: 'GPT-4.1 / Claude 4.5 / Llama 4', auth: 'PAT (scope: models:read)' },
    { id: 'chatgpt', name: 'ChatGPT 訂閱',
      desc: '用 ChatGPT Plus / Pro 帳號 OAuth 登入',
      sub: 'GPT-5 / o4-mini', auth: '瀏覽器 OAuth (非官方管道)' },
    { id: 'anthropic', name: 'Anthropic API',
      desc: 'Claude Sonnet 4.7 · 自備 API key',
      sub: 'Claude · 最強概念連結', auth: 'API key' },
    { id: 'gemini', name: 'Google Gemini',
      desc: 'Gemini 2.5 Pro · 自備 API key',
      sub: 'Gemini · 大 context', auth: 'API key' },
  ];
  const cur = PROVIDERS.find(p => p.id === selectedProvider);

  if (configMode && cur) {
    return (
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
          color: T.text }}>設定 {cur.name}</div>
        <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
          lineHeight: 1.65 }}>
          填入 token 或登入完成後，點底部「繼續」前進到下一步。設定隨時可在
          「設定 → 雲端 AI 助理」變更。
        </div>

        <SwHead T={T} top={24}>{cur.auth}</SwHead>
        {cur.id === 'chatgpt' ? (
          <SwRow T={T} label="OAuth 登入"
            hint="點擊後會打開瀏覽器，登入完成自動關閉。Token 加密存在本機。"
            right={<SwBtn T={T} primary>開啟瀏覽器登入</SwBtn>}/>
        ) : (
          <SwRow T={T} label={cur.id === 'github-models' ? 'Personal Access Token' : 'API Key'}
            hint={cur.id === 'github-models'
              ? '從 github.com/settings/tokens 建立 fine-grained token，scope 勾選 models:read'
              : '從該 provider 的 console 取得 key'}>
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <input placeholder={cur.id === 'github-models' ? 'github_pat_...' : 'sk-... / AIza... / ...'}
                style={{
                  flex: 1, padding: '8px 12px', fontSize: 12,
                  background: T.surface2, color: T.text,
                  border: `1px solid ${T.border}`, borderRadius: 6,
                  outline: 'none', fontFamily: 'JetBrains Mono',
                  boxSizing: 'border-box',
                }}/>
              <SwBtn T={T}>測試連線</SwBtn>
            </div>
          </SwRow>
        )}

        <SwRow T={T} label="連線狀態"
          right={<span style={{ fontSize: 11, color: T.textFaint,
            fontFamily: 'JetBrains Mono', fontWeight: 700,
            padding: '3px 8px', background: T.surface2,
            border: `1px solid ${T.border}`, borderRadius: 4 }}>
            未測試
          </span>}/>

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <SwBtn T={T} ghost onClick={() => { setConfigMode(false); }}>
            ← 改選別的
          </SwBtn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
        color: T.text }}>選擇 AI 助理</div>
      <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
        lineHeight: 1.65 }}>
        AI 助教問答、摘要、字幕精修、跨堂搜尋都需要雲端 LLM。
        你可以<b style={{ color: T.text }}>跳過</b>這步，之後再到「設定」配置 — 跳過的話
        Q&A / 精修 / 摘要功能會關閉，但本地轉錄與翻譯不受影響。
      </div>

      <div style={{ marginTop: 20, display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {PROVIDERS.map(p => {
          const active = p.id === selectedProvider;
          return (
            <button key={p.id} onClick={() => {
              setSelectedProvider(p.id); setConfigMode(true);
            }}
              style={{
                padding: 14, borderRadius: 10, textAlign: 'left',
                border: `1px solid ${active ? T.accent : T.borderSoft}`,
                background: active ? T.chipBg : T.surface2,
                cursor: 'pointer', fontFamily: 'inherit',
                color: T.text,
                transition: 'border-color 160ms, background 160ms',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text,
                  letterSpacing: '-0.01em' }}>{p.name}</span>
                {active && (
                  <span style={{ fontSize: 8, padding: '2px 6px',
                    background: T.accent, color: '#fff', borderRadius: 3,
                    fontWeight: 800, fontFamily: 'JetBrains Mono',
                    letterSpacing: '0.08em' }}>SELECTED</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: T.textMid, lineHeight: 1.5 }}>
                {p.desc}
              </div>
              <div style={{ marginTop: 8, display: 'flex',
                justifyContent: 'space-between', alignItems: 'baseline',
                gap: 8 }}>
                <span style={{ fontSize: 9, color: T.textDim,
                  fontFamily: 'JetBrains Mono',
                  letterSpacing: '0.06em' }}>{p.sub}</span>
                <span style={{ fontSize: 9, color: T.textFaint,
                  fontFamily: 'JetBrains Mono' }}>{p.auth}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─── Step 4: Recording Consent ──────────────────────────────────
const SwConsent = ({ T, checked, setChecked, error, setError }) => (
  <div>
    <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
      color: T.text }}>錄音與隱私提醒</div>
    <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
      lineHeight: 1.65 }}>
      ClassNote 會把錄音與筆記留在你的電腦上 — 但<b style={{ color: T.text }}>錄音行為本身</b>仍可能受到
      老師、同學、校規與所在地法律限制。
    </div>

    {/* 警告卡 — 仿 RV2 finishing overlay 的灰底 + hot 色 accent */}
    <div style={{ marginTop: 20, padding: 16, borderRadius: 10,
      background: T.hotBg,
      border: `1px solid ${T.mode === 'dark' ? 'rgba(255,171,122,0.25)' : '#f4cdb8'}` }}>
      <div style={{ fontSize: 10, letterSpacing: '0.16em',
        color: T.hot, fontWeight: 800, fontFamily: 'JetBrains Mono',
        marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>●</span>
        開始錄音前請自行確認
      </div>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: T.text,
        lineHeight: 1.85 }}>
        <li>已取得課堂錄音所需的同意（老師、學校）</li>
        <li>符合學校政策、課程規範與當地法律</li>
        <li>若內容包含第三人聲音，已評估隱私 / 個資風險</li>
      </ul>
      <div style={{ marginTop: 10, fontSize: 11, color: T.textMid,
        lineHeight: 1.6 }}>
        我們不會替你判斷合法與否，只把這個提醒保留下來，之後不再反覆打擾。
      </div>
    </div>

    {/* 同意 checkbox */}
    <label style={{ marginTop: 16, padding: '14px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
      borderRadius: 8, background: T.surface2,
      border: `1px solid ${error ? T.hot : T.borderSoft}`,
      cursor: 'pointer' }}>
      <input type="checkbox" checked={checked}
        onChange={e => { setChecked(e.target.checked); if (e.target.checked) setError(null); }}
        style={{ marginTop: 3, width: 16, height: 16,
          accentColor: T.accent, cursor: 'pointer' }}/>
      <span style={{ fontSize: 13, color: T.text, lineHeight: 1.55 }}>
        我了解 ClassNote 只提供本地工具；實際錄音是否合規，仍需由我自行確認並遵守相關規定。
      </span>
    </label>

    {error && (
      <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6,
        background: T.hotBg, color: T.hot, fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>⚠</span>{error}
      </div>
    )}
  </div>
);

// ─── Step 5: GPU Check ──────────────────────────────────────────
const SwGpuCheck = ({ T, gpuData }) => {
  const rows = gpuData ? [
    { ok: !!gpuData.cuda, label: 'CUDA (NVIDIA)',
      detail: gpuData.cuda ? `${gpuData.cuda.gpu_name} · driver ${gpuData.cuda.driver_version}` : '未偵測到 NVIDIA 驅動' },
    { ok: gpuData.vulkan, label: 'Vulkan',
      detail: gpuData.vulkan ? 'Vulkan loader 已存在' : '未偵測到 Vulkan runtime' },
    { ok: gpuData.metal, label: 'Metal',
      detail: gpuData.metal ? '原生支援' : '不適用此系統' },
    { ok: true, label: 'CPU fallback',
      detail: `${gpuData.cpuThreads || 16} 執行緒 · 永遠可用` },
  ] : [];

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
        color: T.text }}>硬體加速偵測</div>
      <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
        lineHeight: 1.65 }}>
        Whisper 與翻譯模型可以靠 GPU 加速。我們偵測到下列後端：
      </div>

      <SwHead T={T} top={20}>偵測結果</SwHead>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(r => (
          <div key={r.label} style={{
            padding: '10px 14px', borderRadius: 8,
            background: T.surface2,
            border: `1px solid ${r.ok ? (T.mode === 'dark' ? 'rgba(34,197,94,0.25)' : '#c7e8d0') : T.borderSoft}`,
            display: 'grid', gridTemplateColumns: '24px 140px 1fr auto',
            gap: 12, alignItems: 'center', fontSize: 12 }}>
            {r.ok ? (
              <svg width="20" height="20" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="9" fill="#22c55e"/>
                <path d="M6 10.5 L9 13.5 L14.5 7.5" stroke="#fff" strokeWidth="2"
                  fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <span style={{ width: 14, height: 14, borderRadius: 7,
                border: `1.5px solid ${T.borderSoft}`,
                margin: '0 3px' }}/>
            )}
            <span style={{ color: T.text, fontWeight: 600 }}>{r.label}</span>
            <span style={{ color: T.textDim, fontFamily: 'JetBrains Mono',
              fontSize: 11 }}>{r.detail}</span>
            {r.ok && (
              <span style={{ fontSize: 8, padding: '2px 6px',
                background: '#22c55e', color: '#fff', borderRadius: 3,
                fontWeight: 800, fontFamily: 'JetBrains Mono',
                letterSpacing: '0.08em' }}>OK</span>
            )}
          </div>
        ))}
      </div>

      {gpuData?.driverHint && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 8,
          background: T.hotBg,
          border: `1px solid ${T.mode === 'dark' ? 'rgba(255,171,122,0.25)' : '#f4cdb8'}`,
          display: 'flex', gap: 12 }}>
          <span style={{ color: T.hot, fontSize: 16 }}>⚠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.hot,
              marginBottom: 3 }}>{gpuData.driverHint.title}</div>
            <div style={{ fontSize: 12, color: T.text, lineHeight: 1.55 }}>
              {gpuData.driverHint.message}
            </div>
            <button style={{ marginTop: 6, padding: '4px 10px', fontSize: 11,
              fontWeight: 600, background: 'transparent', color: T.hot,
              border: `1px solid ${T.hot}`, borderRadius: 5,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {gpuData.driverHint.action_label} ↗
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 11, color: T.textDim,
        lineHeight: 1.6 }}>
        後端偏好之後可在 <b style={{ color: T.text }}>設定 → 本地轉錄 → GPU/效能</b> 變更。
        現在會用「Auto」自動選最佳後端。
      </div>
    </div>
  );
};

// ─── Step 6: Review (環境檢查清單) ──────────────────────────────
const SwReview = ({ T, requirements }) => {
  const missingRequired = requirements.filter(r => !r.installed && !r.optional);
  const missingOptional = requirements.filter(r => !r.installed && r.optional);
  const totalMb = requirements.filter(r => !r.installed).reduce((s, r) => s + r.sizeMb, 0);

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
        color: T.text }}>確認元件清單</div>
      <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
        lineHeight: 1.65 }}>
        以下是會下載 / 安裝的元件。系統工具已內建（無需動作），
        AI 模型按你選的語言對自動挑選。
      </div>

      <SwHead T={T} top={20}>元件清單</SwHead>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {requirements.map(r => (
          <div key={r.id} style={{
            padding: '10px 14px', borderRadius: 8,
            background: T.surface2,
            border: `1px solid ${r.installed
              ? (T.mode === 'dark' ? 'rgba(34,197,94,0.18)' : '#dceeb8')
              : T.borderSoft}`,
            display: 'grid',
            gridTemplateColumns: '20px 1fr 80px 80px',
            gap: 12, alignItems: 'center', fontSize: 12 }}>
            {r.installed ? (
              <svg width="18" height="18" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="9" fill="#22c55e"/>
                <path d="M6 10.5 L9 13.5 L14.5 7.5" stroke="#fff" strokeWidth="2"
                  fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <span style={{ width: 14, height: 14, borderRadius: 7,
                background: 'transparent',
                border: `1.5px dashed ${T.borderSoft}`,
                margin: '0 2px' }}/>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: T.text, fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontSize: 9, padding: '1px 5px',
                  background: T.chipBg, color: T.textMid, borderRadius: 3,
                  fontFamily: 'JetBrains Mono', fontWeight: 700,
                  letterSpacing: '0.06em' }}>{r.category}</span>
                {r.optional && (
                  <span style={{ fontSize: 9, padding: '1px 5px',
                    background: 'transparent',
                    border: `1px solid ${T.border}`,
                    color: T.textDim, borderRadius: 3,
                    fontFamily: 'JetBrains Mono', fontWeight: 700,
                    letterSpacing: '0.06em' }}>OPTIONAL</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
                {r.desc}
              </div>
            </div>
            <span style={{ color: T.textDim, fontFamily: 'JetBrains Mono',
              fontSize: 11, textAlign: 'right' }}>
              {r.sizeMb > 0 ? `${r.sizeMb} MB` : '—'}
            </span>
            <span style={{ color: r.installed ? '#22c55e' : T.textMid,
              fontFamily: 'JetBrains Mono', fontWeight: 700,
              fontSize: 11, textAlign: 'right' }}>
              {r.installed ? '✓ 已安裝' : '待下載'}
            </span>
          </div>
        ))}
      </div>

      {missingRequired.length > 0 && (
        <div style={{ marginTop: 18, padding: 14, borderRadius: 8,
          background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 10, letterSpacing: '0.16em',
              color: T.textDim, fontWeight: 800,
              fontFamily: 'JetBrains Mono' }}>下載總量</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: T.text,
              fontFamily: 'JetBrains Mono', marginLeft: 'auto',
              letterSpacing: '-0.02em' }}>{totalMb} MB</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: T.textDim,
            fontFamily: 'JetBrains Mono' }}>
            預計 {Math.round(totalMb / 60)} 分鐘（依網速估算）
          </div>
          {missingOptional.length > 0 && (
            <label style={{ marginTop: 12, display: 'flex',
              alignItems: 'center', gap: 8, fontSize: 12, color: T.text,
              cursor: 'pointer' }}>
              <input type="checkbox" style={{ accentColor: T.accent }}/>
              同時安裝 {missingOptional.length} 個可選項目
            </label>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Step 7: Installing — 直接 fork RV2FinishingOverlay 的卡片內容 ─
const SwInstalling = ({ T, tasks, currentIdx, progress }) => (
  <div>
    <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
      color: T.text }}>正在安裝...</div>
    <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
      lineHeight: 1.65 }}>
      請保持應用開啟。完成後會自動進入下一步。
    </div>

    {/* Header card with spinner */}
    <div style={{ marginTop: 20, padding: '16px 18px', borderRadius: 10,
      background: T.surface2, border: `1px solid ${T.borderSoft}`,
      display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ position: 'relative', width: 28, height: 28 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%',
          border: `2px solid ${T.border}` }}/>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%',
          border: '2px solid transparent',
          borderTopColor: T.accent, borderRightColor: T.accent,
          animation: 'swSpin 900ms linear infinite' }}/>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', color: T.textDim,
          fontWeight: 800, fontFamily: 'JetBrains Mono' }}>
          進度 {Math.round(progress * 100)}%
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text,
          marginTop: 3 }}>
          {tasks[currentIdx]?.name || '完成'}
        </div>
      </div>
      <span style={{ fontSize: 11, color: T.textFaint,
        fontFamily: 'JetBrains Mono',
        padding: '3px 8px', background: T.surface,
        border: `1px solid ${T.border}`, borderRadius: 4 }}>
        {currentIdx + 1} / {tasks.length}
      </span>
    </div>

    {/* Progress bar with shimmer */}
    <div style={{ marginTop: 12, height: 4, background: T.border,
      borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0,
        right: `${100 - progress * 100}%`,
        background: `linear-gradient(90deg, ${T.accent}, ${T.accent}dd)`,
        transition: 'right 200ms linear' }}/>
      <div style={{ position: 'absolute', inset: 0,
        background: `linear-gradient(90deg, transparent, ${T.accent}55, transparent)`,
        backgroundSize: '200% 100%',
        animation: 'swShimmer 1.6s linear infinite', opacity: 0.7 }}/>
    </div>
    <style>{`@keyframes swSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

    {/* Task list */}
    <div style={{ marginTop: 20 }}>
      {tasks.map((t, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const pending = i > currentIdx;
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0',
            borderBottom: i < tasks.length - 1 ? `1px solid ${T.borderSoft}` : 'none',
            opacity: pending ? 0.45 : 1 }}>
            <div style={{ width: 20, height: 20, flexShrink: 0,
              display: 'grid', placeItems: 'center' }}>
              {done && (
                <svg width="20" height="20" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="9" fill={T.accent}/>
                  <path d="M6 10.5 L9 13.5 L14.5 7.5" stroke="#fff" strokeWidth="2"
                    fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {active && (
                <div style={{ width: 14, height: 14, borderRadius: '50%',
                  border: `2px solid ${T.accent}`, borderTopColor: 'transparent',
                  animation: 'swSpin 700ms linear infinite' }}/>
              )}
              {pending && (
                <span style={{ width: 8, height: 8, borderRadius: '50%',
                  background: T.border }}/>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13,
                fontWeight: active ? 700 : 600,
                color: pending ? T.textDim : T.text }}>{t.name}</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 2,
                fontFamily: 'JetBrains Mono' }}>{t.detail}</div>
            </div>
            {active && (
              <span style={{ fontSize: 11, color: T.accent, fontWeight: 700,
                fontFamily: 'JetBrains Mono' }}>下載中…</span>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

// ─── Step 8: Complete ───────────────────────────────────────────
const SwComplete = ({ T }) => (
  <div style={{ display: 'flex', flexDirection: 'column',
    alignItems: 'center', textAlign: 'center', paddingTop: 16 }}>

    {/* Hero check */}
    <div style={{ width: 76, height: 76, borderRadius: 38,
      background: T.surface2,
      border: `2px solid ${T.mode === 'dark' ? 'rgba(34,197,94,0.4)' : '#22c55e'}`,
      display: 'grid', placeItems: 'center',
      animation: 'swPop 360ms cubic-bezier(0.2, 0, 0, 1.4)' }}>
      <svg width="40" height="40" viewBox="0 0 20 20">
        <path d="M5 10.5 L8.5 14 L15 6.5" stroke="#22c55e" strokeWidth="2.5"
          fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
    <style>{`@keyframes swPop {
      from { transform: scale(0.6); opacity: 0; }
      to   { transform: scale(1);   opacity: 1; }
    }`}</style>

    <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.022em',
      color: T.text, marginTop: 18 }}>設置完成</div>
    <div style={{ fontSize: 13, color: T.textMid, marginTop: 6,
      lineHeight: 1.65, maxWidth: 420 }}>
      所有必要元件已就位。打開後可以從首頁新增第一個課程，或匯入現有的 PDF / 影片。
    </div>

    <div style={{ marginTop: 24, width: '100%', maxWidth: 420,
      display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[
        { k: '本地轉錄', v: 'Whisper large-v3 · GPU 加速 (CUDA)' },
        { k: '翻譯',     v: 'TranslateGemma 4B · 本地' },
        { k: 'AI 助理',  v: 'GitHub Models · Copilot Pro' },
        { k: '錄音同意', v: '已確認' },
      ].map(item => (
        <div key={item.k} style={{ display: 'flex', alignItems: 'center',
          gap: 10, padding: '8px 12px', borderRadius: 6,
          background: T.surface2, border: `1px solid ${T.borderSoft}` }}>
          <svg width="14" height="14" viewBox="0 0 20 20">
            <path d="M5 10.5 L8.5 14 L15 6.5" stroke="#22c55e" strokeWidth="2.5"
              fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 11, letterSpacing: '0.12em',
            fontWeight: 700, color: T.textDim,
            fontFamily: 'JetBrains Mono', minWidth: 70 }}>{item.k}</span>
          <span style={{ fontSize: 12, color: T.text, flex: 1 }}>{item.v}</span>
        </div>
      ))}
    </div>
  </div>
);

// ─── Root SetupWizard App ───────────────────────────────────────
// onExit  — 點 ✕ 或 complete 步「進入 ClassNote」時呼叫。從 ProfilePage
//           「重置」按鈕進入時，由父層把 setupWizardOpen state 收起來；
//           standalone HTML 入口可傳一個 alert/log 即可。
// initialTheme — 開啟時繼承父層主題（預設 light）。
const SetupWizardApp = ({ onExit, initialTheme = 'light' }) => {
  const [theme, setTheme] = React.useState(initialTheme);
  const [stepIdx, setStepIdx] = React.useState(0);

  // Per-step state
  const [sourceLang, setSourceLang] = React.useState('auto');
  const [targetLang, setTargetLang] = React.useState('zh-TW');
  const [selectedProvider, setSelectedProvider] = React.useState(null);
  const [providerConfigMode, setProviderConfigMode] = React.useState(false);
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [consentError, setConsentError] = React.useState(null);

  // Mock GPU + Requirements data
  const gpuData = {
    cuda: { gpu_name: 'NVIDIA RTX 4070', driver_version: '551.86' },
    vulkan: true,
    metal: false,
    cpuThreads: 16,
    driverHint: null,
  };
  const requirements = [
    { id: 'ffmpeg',  name: 'FFmpeg',           desc: '影片 / 音訊解碼',
      category: 'SYS', sizeMb: 0, installed: true,  optional: false },
    { id: 'whisper', name: 'Whisper large-v3', desc: 'ASR 主模型',
      category: 'AI',  sizeMb: 2900, installed: false, optional: false },
    { id: 'gemma',   name: 'TranslateGemma 4B Q4_K_M', desc: '本地翻譯模型',
      category: 'AI',  sizeMb: 2400, installed: false, optional: false },
    { id: 'parakeet', name: 'Parakeet TDT 0.6B', desc: '輕量 ASR 備援',
      category: 'AI',  sizeMb: 480,  installed: false, optional: true },
  ];

  // Installing animation state
  const [installCurrentIdx, setInstallCurrentIdx] = React.useState(0);
  const [installProgress, setInstallProgress] = React.useState(0);
  const installTasks = [
    { id: 't1', name: '下載 Whisper large-v3', detail: '2.9 GB · 從 huggingface.co' },
    { id: 't2', name: '下載 TranslateGemma 4B', detail: '2.4 GB · 從 huggingface.co' },
    { id: 't3', name: '驗證模型檔案', detail: 'SHA-256 + 載入測試' },
    { id: 't4', name: '初始化資料庫', detail: 'SQLite · ~/Library/ClassNote' },
    { id: 't5', name: '完成設置', detail: '寫入 .complete flag' },
  ];

  // Auto-progress installing step on enter
  React.useEffect(() => {
    if (SW_STEPS[stepIdx].id !== 'installing') return;
    setInstallCurrentIdx(0);
    setInstallProgress(0);
    let i = 0, p = 0;
    const tick = setInterval(() => {
      p += 0.012;
      const stepBoundary = (i + 1) / installTasks.length;
      if (p >= stepBoundary) {
        i = Math.min(i + 1, installTasks.length - 1);
        setInstallCurrentIdx(i);
      }
      if (p >= 1) {
        clearInterval(tick);
        setInstallProgress(1);
        setTimeout(() => setStepIdx(s => s + 1), 600);
        return;
      }
      setInstallProgress(p);
    }, 80);
    return () => clearInterval(tick);
  }, [stepIdx]);

  // Theme toggle keyboard
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setTheme(t => t === 'light' ? 'dark' : 'light');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const T = window.H18_THEMES[theme];

  const cur = SW_STEPS[stepIdx].id;
  const next = () => setStepIdx(s => Math.min(s + 1, SW_STEPS.length - 1));
  const prev = () => setStepIdx(s => Math.max(s - 1, 0));
  const skip = () => {
    if (cur === 'ai') {
      setSelectedProvider(null);
      setProviderConfigMode(false);
    }
    next();
  };

  // Per-step config
  let body, opts = {};
  switch (cur) {
    case 'welcome':
      body = <SwWelcome T={T}/>;
      opts = { hideBack: true, hideSkip: true, nextLabel: '開始設置' };
      break;
    case 'language':
      body = <SwLanguage T={T} sourceLang={sourceLang} setSourceLang={setSourceLang}
        targetLang={targetLang} setTargetLang={setTargetLang}/>;
      opts = { hideSkip: true };
      break;
    case 'ai':
      body = <SwAIProvider T={T}
        selectedProvider={selectedProvider} setSelectedProvider={setSelectedProvider}
        configMode={providerConfigMode} setConfigMode={setProviderConfigMode}/>;
      opts = providerConfigMode
        ? { onBack: () => setProviderConfigMode(false) }
        : {};
      break;
    case 'consent':
      body = <SwConsent T={T} checked={consentChecked} setChecked={setConsentChecked}
        error={consentError} setError={setConsentError}/>;
      opts = {
        hideSkip: true,
        onNext: () => {
          if (!consentChecked) {
            setConsentError('請先勾選同意與理解，才能繼續。');
            return;
          }
          next();
        },
      };
      break;
    case 'gpu':
      body = <SwGpuCheck T={T} gpuData={gpuData}/>;
      opts = { hideSkip: true };
      break;
    case 'review':
      body = <SwReview T={T} requirements={requirements}/>;
      opts = { hideSkip: true, nextLabel: '開始安裝', nextPrimary: true };
      break;
    case 'installing':
      body = <SwInstalling T={T} tasks={installTasks}
        currentIdx={installCurrentIdx} progress={installProgress}/>;
      opts = { hideBack: true, hideSkip: true, hideNext: true };
      break;
    case 'complete':
      body = <SwComplete T={T}/>;
      opts = {
        hideBack: true, hideSkip: true, nextLabel: '進入 ClassNote',
        onNext: onExit || (() => alert('設置完成（dev mode）')),
      };
      break;
  }

  return (
    <SwShell T={T} theme={theme} setTheme={setTheme} stepIdx={stepIdx}
      onBack={prev} onSkip={skip} onNext={next}
      onClose={onExit}
      {...opts}>
      {body}
    </SwShell>
  );
};

Object.assign(window, { SetupWizardApp });
