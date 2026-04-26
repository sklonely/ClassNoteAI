/**
 * H18 ProfilePanes · v0.7.0 Phase 6.7
 *
 * 8 個 sub-pane 元件 + 共用 primitives (PHeader / PHead / PRow /
 * PSelect / PToggle / PBtn / PInput / PSeg)。
 *
 * 對應 docs/design/h18-deep/h18-nav-pages.jsx L1247-3170。
 *
 * 規則：UI 1:1 prototype 視覺；wiring 大部分留白（顯示成 controlled
 * local state stubs，不寫到 storageService）。等下個 wiring audit
 * CP 統一接。例外：
 *  - PAppearance theme toggle → real (toggleTheme + applyTheme)
 *  - POverview logout → real (authService.logout via context)
 *  - PData 回收桶列表 → 顯示真資料 (storageService.listTrashed*)
 */

import { useEffect, useState, type ReactNode } from 'react';
import { storageService } from '../../services/storageService';
import type { Course } from '../../types';
import s from './ProfilePage.module.css';

/* ────────── primitives ───────── */

export function PHeader({ title, hint }: { title: string; hint?: ReactNode }) {
    return (
        <div className={s.pageHeader}>
            <h1 className={s.pageTitle}>{title}</h1>
            {hint && <p className={s.pageHint}>{hint}</p>}
        </div>
    );
}

export function PHead({ children, first }: { children: ReactNode; first?: boolean }) {
    return <div className={`${s.pHead} ${first ? s.pHeadFirst : ''}`}>{children}</div>;
}

export function PRow({
    label,
    hint,
    right,
    children,
}: {
    label: string;
    hint?: ReactNode;
    right?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className={s.row}>
            <div className={s.rowMain}>
                <div className={s.rowLabel}>{label}</div>
                {hint && <div className={s.rowHint}>{hint}</div>}
                {children}
            </div>
            {right && <div className={s.rowRight}>{right}</div>}
        </div>
    );
}

export function PSelect({
    value,
    options,
    onChange,
}: {
    value: string;
    options: string[];
    onChange?: (v: string) => void;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={s.select}
        >
            {options.map((o) => (
                <option key={o} value={o}>
                    {o}
                </option>
            ))}
        </select>
    );
}

export function PToggle({
    on,
    onChange,
}: {
    on: boolean;
    onChange?: (v: boolean) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onChange?.(!on)}
            className={`${s.toggle} ${on ? s.toggleOn : ''}`}
            aria-pressed={on}
            aria-label="切換"
        >
            <span className={s.toggleKnob} />
        </button>
    );
}

export function PBtn({
    children,
    primary,
    danger,
    onClick,
    disabled,
}: {
    children: ReactNode;
    primary?: boolean;
    danger?: boolean;
    onClick?: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`${s.btn} ${primary ? s.btnPrimary : ''} ${danger ? s.btnDanger : ''}`}
        >
            {children}
        </button>
    );
}

export function PInput({
    value,
    onChange,
    placeholder,
    monospace,
    wide,
}: {
    value: string;
    onChange?: (v: string) => void;
    placeholder?: string;
    monospace?: boolean;
    wide?: boolean;
}) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            className={`${s.input} ${monospace ? s.inputMono : ''} ${wide ? s.inputWide : ''}`}
        />
    );
}

export function PSeg<T extends string>({
    value,
    options,
    onChange,
}: {
    value: T;
    options: { value: T; label: string }[];
    onChange?: (v: T) => void;
}) {
    return (
        <div className={s.seg}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange?.(o.value)}
                    className={`${s.segBtn} ${o.value === value ? s.segBtnActive : ''}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * POverview — 學習總覽 + 登出
 * ════════════════════════════════════════════════════════════════ */

export function POverview({
    username,
    initial,
    onLogout,
}: {
    username: string;
    initial: string;
    onLogout: () => void;
}) {
    const [stats, setStats] = useState<{
        courses: number;
        lectures: number;
        totalMin: number;
    }>({ courses: 0, lectures: 0, totalMin: 0 });

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            storageService.listCourses().catch(() => [] as Course[]),
            storageService.listLectures().catch(() => []),
        ]).then(([courses, lectures]) => {
            if (cancelled) return;
            const totalMin = Math.floor(
                lectures.reduce((acc, l) => acc + (l.duration || 0), 0) / 60,
            );
            setStats({
                courses: courses.length,
                lectures: lectures.length,
                totalMin,
            });
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div>
            <PHeader title="總覽" hint="這個帳號的學習軌跡。" />

            <div className={s.heroCard}>
                <div className={s.heroAvatar}>{initial}</div>
                <div className={s.heroBody}>
                    <h2 className={s.heroName}>{username}</h2>
                    <p className={s.heroSub}>本機帳號 · 資料未上雲</p>
                </div>
                <button
                    type="button"
                    onClick={onLogout}
                    className={s.logoutBtn}
                    title="登出"
                    aria-label="登出"
                >
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <path
                            d="M9 4 L4 4 L4 16 L9 16"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d="M13 7 L16 10 L13 13"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <line
                            x1="16"
                            y1="10"
                            x2="8"
                            y2="10"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                </button>
            </div>

            <div className={s.bigHero}>
                <div className={s.bigHeroEyebrow}>你已經累積了</div>
                <div className={s.bigHeroNumber}>
                    {(stats.totalMin / 60).toFixed(1)}
                </div>
                <div className={s.bigHeroUnit}>
                    <span>
                        小時的學習{' '}
                        <span className={s.bigHeroUnitVal}>{stats.lectures}</span> lectures
                    </span>
                    <span>
                        <span className={s.bigHeroUnitVal}>{stats.courses}</span> courses
                    </span>
                    <span>
                        <span className={s.bigHeroUnitVal}>—</span> concepts
                        <span style={{ color: 'var(--h18-text-faint)', marginLeft: 4 }}>
                            (留白)
                        </span>
                    </span>
                </div>
            </div>

            <PHead first>連結</PHead>
            <PRow
                label="加入 Discord 社群"
                hint="ClassNoteAI 使用者交流、回報問題、提案功能"
                right={<PBtn>前往</PBtn>}
            />
            <PRow
                label="GitHub"
                hint="原始碼、issue、release notes"
                right={<PBtn>前往</PBtn>}
            />
        </div>
    );
}


/* ════════════════════════════════════════════════════════════════
 * PTranscribe — 本地轉錄
 * ════════════════════════════════════════════════════════════════ */

export function PTranscribe() {
    return (
        <div>
            <PHeader
                title="本地轉錄模型"
                hint="Parakeet 在本機跑 — 離線、不上雲、不付 API 費用。透過 parakeet-rs in-process 執行，無 sidecar。"
            />

            <PHead first>模型</PHead>
            <PRow
                label="目前使用"
                hint="點選即切換；未下載的會提示先下載"
                right={
                    <PSelect
                        value="Parakeet · INT8 (推薦, 已載入)"
                        options={[
                            'Parakeet · INT8 (推薦, 已載入)',
                            'Parakeet · FP32 (進階)',
                        ]}
                    />
                }
            />
            <PRow label="模型管理" hint="已下載 1 / 2 · 佔用 852 MB">
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <ModelCard
                        name="parakeet-int8"
                        size="852 MB"
                        wer="WER 8.01%"
                        hint="8-bit 量化 · 推薦：精度差距在誤差內，下載快 3×"
                        loaded
                    />
                    <ModelCard
                        name="parakeet-fp32"
                        size="2.5 GB"
                        wer="WER 8.03%"
                        hint="原版浮點 · 對精度有極致要求 / A/B 比較的進階使用者"
                        actionLabel="下載"
                    />
                </div>
            </PRow>

            <PHead>GPU / 效能</PHead>
            <PRow
                label="後端偏好"
                hint="Auto 會在偵測到的後端中選最佳。"
                right={
                    <PSelect
                        value="Auto"
                        options={['Auto', 'CUDA', 'Metal', 'Vulkan', 'CPU']}
                    />
                }
            />
            <PRow
                label="GPU 偵測結果"
                hint={
                    <span style={{ fontFamily: 'var(--h18-font-mono)', color: 'var(--h18-accent)' }}>
                        後端偵測由 buildFeaturesService 報告。實機才看得到具體 backend / VRAM。
                    </span>
                }
                right={<PBtn>重新偵測</PBtn>}
            />

            <PHead>進階</PHead>
            <PRow
                label="Log 等級"
                right={
                    <PSelect
                        value="info"
                        options={['error', 'warn', 'info', 'debug', 'trace']}
                    />
                }
            />
        </div>
    );
}

function ModelCard({
    name,
    size,
    wer,
    hint,
    loaded,
    actionLabel,
}: {
    name: string;
    size: string;
    wer: string;
    hint: string;
    loaded?: boolean;
    actionLabel?: string;
}) {
    return (
        <div
            style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: `1px solid ${loaded ? 'var(--h18-accent)' : 'var(--h18-border-soft)'}`,
                background: loaded ? 'var(--h18-chip-bg)' : 'var(--h18-surface2)',
                display: 'grid',
                gridTemplateColumns: '140px 80px 80px 1fr auto',
                gap: 10,
                alignItems: 'center',
            }}
        >
            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--h18-font-mono)' }}>
                {name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--h18-text-dim)', fontFamily: 'var(--h18-font-mono)' }}>
                {size}
            </div>
            <div style={{ fontSize: 10, color: 'var(--h18-text-dim)', fontFamily: 'var(--h18-font-mono)' }}>
                {wer}
            </div>
            <div style={{ fontSize: 10, color: 'var(--h18-text-mid)', lineHeight: 1.4 }}>
                {hint}
            </div>
            <PBtn>{loaded ? '已載入' : actionLabel || '下載'}</PBtn>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PTranslate — 翻譯
 * ════════════════════════════════════════════════════════════════ */

export function PTranslate() {
    const [engine, setEngine] = useState<'gemma' | 'google' | 'local'>('gemma');
    return (
        <div>
            <PHeader
                title="翻譯服務"
                hint="控制字幕、摘要、Q&A 的翻譯方向與引擎。TranslateGemma (本地 LLM) 為主、Google 為備、CT2 為 dev fallback。"
            />

            <PHead first>引擎</PHead>
            <PRow
                label="翻譯後端"
                hint="切換生效後新字幕會用新引擎；舊字幕需重新精修才會更新"
                right={
                    <PSeg
                        value={engine}
                        onChange={setEngine}
                        options={[
                            { value: 'gemma', label: 'TranslateGemma' },
                            { value: 'google', label: 'Google Cloud' },
                            { value: 'local', label: '本地 CT2' },
                        ]}
                    />
                }
            />

            <PHead>TranslateGemma (主引擎)</PHead>
            <PRow
                label="模型"
                hint="TranslateGemma 4B Q4_K_M · 4-bit 量化 · 繁中品質明顯優於 M2M100"
                right={<span className={s.statusOK}>✓ 已下載 · 2.40 GB</span>}
            />
            <PRow
                label="llama-server sidecar"
                hint="Gemma 透過 llama-server 跑在本機 HTTP port，由 ClassNote 自動 spawn / 監控"
                right={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className={s.statusGreen}>
                            <span className={s.statusGreenDot} />
                            已連線
                        </span>
                        <PBtn>重新啟動</PBtn>
                    </div>
                }
            />
            <PRow
                label="endpoint"
                hint="預設 127.0.0.1:8080。除非自己改 llama-server port 否則不用動"
                right={<PInput value="http://127.0.0.1:8080" monospace wide />}
            />

            <PHead>Google Cloud (備用)</PHead>
            <PRow
                label="API key"
                hint="Translation API 憑證。沒填的話 Gemma 失敗時會直接報錯"
                right={
                    <div style={{ display: 'flex', gap: 8 }}>
                        <PInput placeholder="AIza...." value="" monospace wide />
                        <PBtn>測試</PBtn>
                    </div>
                }
            />

            <PHead>語言</PHead>
            <PRow
                label="來源語言"
                hint="影響轉錄與字幕的主要語言"
                right={
                    <PSelect
                        value="自動偵測"
                        options={[
                            '自動偵測',
                            '英文',
                            '中文（繁）',
                            '中文（簡）',
                            '日文',
                            '韓文',
                        ]}
                    />
                }
            />
            <PRow
                label="目標語言"
                hint="字幕、摘要、Q&A 翻譯到這個語言"
                right={
                    <PSelect
                        value="中文（繁）"
                        options={['中文（繁）', '中文（簡）', '英文', '日文', '韓文']}
                    />
                }
            />
            <PRow
                label="雙語字幕"
                hint="同時顯示來源與目標語言"
                right={<PToggle on />}
            />
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PCloud — 雲端 AI 助理
 * ════════════════════════════════════════════════════════════════ */

interface ProviderInfo {
    id: string;
    name: string;
    auth: string;
    desc: string;
    sub: string;
    status: string;
    active?: boolean;
}

const PROVIDERS: ProviderInfo[] = [
    {
        id: 'github-models',
        name: 'GitHub Models',
        auth: 'PAT (models:read)',
        desc: 'Copilot Pro / Business / Enterprise 訂閱包含額度',
        sub: 'GPT-4.1 / Claude / Llama',
        status: '未設定',
    },
    {
        id: 'chatgpt-oauth',
        name: 'ChatGPT 訂閱',
        auth: '瀏覽器 OAuth',
        desc: 'ChatGPT Plus / Pro 帳號 (Codex 流程)',
        sub: 'GPT-5 / o4-mini',
        status: '未設定',
    },
    {
        id: 'anthropic',
        name: 'Anthropic API',
        auth: 'API key',
        desc: 'Claude Sonnet 4.7 · 自備 key',
        sub: '最強概念連結',
        status: '未設定',
    },
    {
        id: 'openai',
        name: 'OpenAI API',
        auth: 'API key',
        desc: 'GPT-5 / GPT-4o · 自備 key',
        sub: '官方原生 API',
        status: '未設定',
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        auth: 'API key',
        desc: 'Gemini 2.5 Pro · 自備 key',
        sub: '大 context · 便宜',
        status: '未設定',
    },
];

export function PCloud() {
    return (
        <div>
            <PHeader
                title="雲端 AI 助理"
                hint="摘要、Q&A、關鍵字、PDF OCR、字幕精修使用的雲端 LLM。挑一個 default provider；字幕精修可單獨指定其他 provider。"
            />

            <PHead first>Default Provider</PHead>
            <div className={s.providerGrid}>
                {PROVIDERS.map((p) => (
                    <ProviderCard key={p.id} p={p} />
                ))}
            </div>

            <PHead>PDF OCR</PHead>
            <PRow
                label="OCR 模式"
                hint="auto = 優先用雲端 LLM vision，沒設定 fallback PDF 文字層 / remote = 只用雲端 / off = 跳過 OCR"
                right={
                    <PSelect
                        value="auto (推薦)"
                        options={['auto (推薦)', 'remote', 'off']}
                    />
                }
            />

            <PHead>字幕精修</PHead>
            <PRow
                label="精修強度"
                hint="輕 = 補標點 / 糾正術語。深 = 全段重寫順暢度。"
                right={<PSelect value="輕 (預設)" options={['關閉', '輕 (預設)', '深']} />}
            />
            <PRow
                label="精修 Provider 覆寫"
                hint="字幕精修可單獨指定 provider，避免吃掉 default 的訂閱額度"
                right={
                    <PSelect
                        value="auto"
                        options={[
                            'auto',
                            'github-models',
                            'chatgpt-oauth',
                            'anthropic',
                            'openai',
                            'gemini',
                        ]}
                    />
                }
            />

            <PHead>用量 (本機 24h retention)</PHead>
            <p style={{ fontSize: 11, color: 'var(--h18-text-dim)', lineHeight: 1.55 }}>
                Provider API 大多沒提供即時剩餘額度查詢，這裡是 ClassNote 在本機累積的呼叫紀錄。
            </p>
            <div className={s.usageGrid}>
                <UsageStat label="Total 呼叫" value="—" sub="今日 (留白)" />
                <UsageStat label="Input" value="—" sub="tokens" />
                <UsageStat label="Output" value="—" sub="tokens" />
                <UsageStat label="估價" value="—" sub="USD · 估算" />
            </div>
        </div>
    );
}

function ProviderCard({ p }: { p: ProviderInfo }) {
    return (
        <div className={`${s.providerCard} ${p.active ? s.providerCardActive : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className={s.providerName}>{p.name}</div>
                {p.active && <span className={s.providerDefaultPill}>DEFAULT</span>}
            </div>
            <div className={s.providerDesc}>{p.desc}</div>
            <div className={s.providerMeta}>
                <span>{p.sub}</span>
                <span>{p.auth}</span>
            </div>
            <div className={s.providerStatusRow}>
                <span
                    className={
                        p.status.startsWith('已連線')
                            ? s.providerStatusGood
                            : s.providerStatusOff
                    }
                >
                    {p.status}
                </span>
                <PBtn primary={!p.status.startsWith('已連線')}>
                    {p.status === '未設定'
                        ? p.auth.includes('OAuth')
                            ? '登入'
                            : '設定'
                        : p.active
                          ? '測試'
                          : '設為 default'}
                </PBtn>
            </div>
        </div>
    );
}

function UsageStat({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className={s.usageCard}>
            <div className={s.usageLabel}>{label}</div>
            <div className={s.usageValue}>{value}</div>
            <div className={s.usageSub}>{sub}</div>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PAppearance — 介面與顯示
 * ════════════════════════════════════════════════════════════════ */

export function PAppearance({
    effectiveTheme,
    onToggleTheme,
}: {
    effectiveTheme: 'light' | 'dark';
    onToggleTheme: () => void;
    applyTheme: (t: 'light' | 'dark') => void;
}) {
    return (
        <div>
            <PHeader
                title="介面與顯示"
                hint="主頁佈局、字級、密度、滾動條樣式，以及 AI 助教在哪呈現。"
            />

            <PHead first>主題</PHead>
            <PRow
                label="主題模式"
                hint={`目前：${effectiveTheme === 'dark' ? '暗色' : '明亮'}。⌘\\ 也可即時切換。`}
                right={
                    <PSeg
                        value={effectiveTheme}
                        onChange={(v) => {
                            if (v !== effectiveTheme) onToggleTheme();
                        }}
                        options={[
                            { value: 'light', label: '明亮' },
                            { value: 'dark', label: '暗色' },
                        ]}
                    />
                }
            />
            <PRow
                label="跟隨系統"
                hint="開啟後依系統偏好自動切換 (留白：尚未接 OS 設定變更事件)"
                right={<PToggle on={false} />}
            />

            <PHead>主頁佈局</PHead>
            <PRow
                label="HomeLayout 變體"
                hint="A = 上 Calendar / 下 Inbox / 右 Preview。B/C 變體預計 v0.7.x 後加。"
                right={
                    <PSelect value="A (預設)" options={['A (預設)', 'B (留白)', 'C (留白)']} />
                }
            />

            <PHead>字級 / 密度</PHead>
            <PRow
                label="基準字級"
                right={<PSelect value="標準" options={['緊湊', '標準', '大']} />}
            />
            <PRow
                label="緊湊模式"
                hint="開啟後 TopBar 跟列表 padding 縮一階，適合 13 吋螢幕"
                right={<PToggle on={false} />}
            />
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PAudio — 音訊與字幕
 * ════════════════════════════════════════════════════════════════ */

export function PAudio() {
    return (
        <div>
            <PHeader
                title="音訊與字幕"
                hint="麥克風選擇、聲道、字幕字級與雙語顯示。"
            />

            <PHead first>麥克風</PHead>
            <PRow
                label="輸入裝置"
                hint="留白：實機從 audioDeviceService.list() 拉真實裝置列表"
                right={<PSelect value="預設裝置" options={['預設裝置']} />}
            />
            <PRow
                label="聲道"
                right={<PSelect value="單聲道" options={['單聲道', '雙聲道']} />}
            />
            <PRow
                label="自動切換偵測"
                hint="移除耳機 / 關靜音時提示再次選裝置"
                right={<PToggle on />}
            />

            <PHead>字幕外觀</PHead>
            <PRow
                label="字幕字級"
                right={
                    <PSelect value="標準" options={['小', '標準', '大', '超大']} />
                }
            />
            <PRow
                label="雙語字幕"
                hint="同時顯示來源 + 翻譯"
                right={<PToggle on />}
            />
            <PRow
                label="逐字模式"
                hint="細粒度時間戳，閱讀比較費力但定位精準"
                right={<PToggle on={false} />}
            />
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PData — 匯入匯出 + 回收桶
 * ════════════════════════════════════════════════════════════════ */

interface TrashedCourse {
    id: string;
    title: string;
    deleted_at?: string;
}

export function PData() {
    const [trashed, setTrashed] = useState<TrashedCourse[]>([]);

    useEffect(() => {
        let cancelled = false;
        // listTrashedCourses might not exist as a method; use raw invoke
        import('@tauri-apps/api/core')
            .then(async ({ invoke }) => {
                try {
                    const lst = await invoke<TrashedCourse[]>('list_trashed_courses', {
                        userId: '',
                    });
                    if (!cancelled) setTrashed(lst || []);
                } catch (err) {
                    console.warn('[PData] list_trashed_courses failed:', err);
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const handleRestore = async (id: string) => {
        try {
            await storageService.restoreCourse(id);
            setTrashed((cur) => cur.filter((c) => c.id !== id));
            window.dispatchEvent(new CustomEvent('classnote-courses-changed'));
        } catch (err) {
            console.warn('[PData] restoreCourse failed:', err);
        }
    };

    return (
        <div>
            <PHeader
                title="資料管理"
                hint="本機資料的匯入、匯出、備份；已刪除課程在這裡找得回來。"
            />

            <PHead first>匯入 / 匯出</PHead>
            <PRow
                label="匯出整體 backup"
                hint="把所有 course / lecture / note 打包成一個 .zip"
                right={<PBtn>匯出</PBtn>}
            />
            <PRow
                label="匯入 backup"
                hint="從 .zip 還原。會 merge 現有資料，重複 id 跳過"
                right={<PBtn>選擇檔案</PBtn>}
            />

            <PHead>回收桶</PHead>
            <PRow
                label={`已刪除課程 · ${trashed.length}`}
                hint="刪除後的課程暫存於此，30 天後自動清空"
            >
                {trashed.length === 0 ? (
                    <div
                        style={{
                            marginTop: 8,
                            padding: 16,
                            borderRadius: 8,
                            background: 'var(--h18-surface2)',
                            border: '1px dashed var(--h18-border-soft)',
                            color: 'var(--h18-text-dim)',
                            fontSize: 12,
                            textAlign: 'center',
                        }}
                    >
                        回收桶空空。
                    </div>
                ) : (
                    <div className={s.trashList}>
                        {trashed.map((c) => (
                            <div key={c.id} className={s.trashRow}>
                                <span className={s.trashTitle}>{c.title}</span>
                                <span className={s.trashMeta}>{c.deleted_at?.slice(0, 10) || '—'}</span>
                                <PBtn onClick={() => handleRestore(c.id)}>還原</PBtn>
                            </div>
                        ))}
                    </div>
                )}
            </PRow>

            <PHead>危險區</PHead>
            <PRow
                label="清空全部本機資料"
                hint="刪除所有 course / lecture / note / 字幕 / RAG index / 設定。不可逆。"
                right={
                    <PBtn danger>清空…</PBtn>
                }
            />
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PAbout — 關於與更新
 * ════════════════════════════════════════════════════════════════ */

export function PAbout() {
    const [version, setVersion] = useState<string>('—');

    useEffect(() => {
        import('@tauri-apps/api/app')
            .then(({ getVersion }) => getVersion())
            .then((v) => setVersion(v))
            .catch(() => {});
    }, []);

    return (
        <div>
            <PHeader
                title="關於與更新"
                hint="當前版本、開發者選項、setup wizard 重置入口。"
            />

            <PHead first>版本</PHead>
            <PRow
                label="ClassNoteAI"
                hint="從 tauri app.getVersion() 拿"
                right={<span className={s.statusOK}>v{version}</span>}
            />
            <PRow
                label="檢查更新"
                hint="每次啟動會自動靜默檢查；這裡可手動觸發"
                right={<PBtn>立即檢查</PBtn>}
            />

            <PHead>診斷</PHead>
            <PRow
                label="重新執行 Setup Wizard"
                hint="重新走一次首次啟動的環境檢查與模型下載流程 (留白：實裝接 setupService.reset)"
                right={<PBtn>啟動</PBtn>}
            />
            <PRow
                label="開啟資料夾"
                hint="跳到 ClassNote 的 app data 目錄 (audio / pdf / index)"
                right={<PBtn>開啟</PBtn>}
            />

            <PHead>連結</PHead>
            <PRow label="GitHub" hint="原始碼、issues" right={<PBtn>前往</PBtn>} />
            <PRow
                label="使用者指南"
                hint="基本操作 / FAQ / 鍵盤快捷鍵"
                right={<PBtn>前往</PBtn>}
            />
        </div>
    );
}
