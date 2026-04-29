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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { authService } from '../../services/authService';
import { storageService } from '../../services/storageService';
import { confirmService } from '../../services/confirmService';
import { toastService } from '../../services/toastService';
import type { Course, Lecture } from '../../types';
import { useAppSettings } from './useAppSettings';
import LayoutPreviewSVG, { type Variant } from './LayoutPreviewSVG';
import {
    OpenAIIcon,
    GitHubIcon,
    GenericProviderIcon,
} from './providerIcons';
import { keyStore } from '../../services/llm/keyStore';
import { ChatGPTOAuthProvider } from '../../services/llm/providers/chatgpt-oauth';
import { fetchCalendarFeed } from '../../services/canvasFeedService';
import { saveCanvasCache } from '../../services/canvasCacheService';
import CanvasPairingWizard, { type PairingChanges } from './CanvasPairingWizard';
import { keymapService } from '../../services/keymapService';
import {
    DEFAULT_KEYMAP,
    type ActionId,
} from '../../services/__contracts__/keymapService.contract';
import { comboFromEvent } from '../../utils/kbd';
import s from './ProfilePage.module.css';

/* ────────── provider credential helpers ───────── */

const PROVIDER_FIELDS: Record<string, string> = {
    'github-models': 'pat',
    openai: 'apiKey',
    anthropic: 'apiKey',
    gemini: 'apiKey',
    azure: 'apiKey',
    'chatgpt-oauth': 'accessToken',
};

const PROVIDER_STATUS_EVT = 'classnote-provider-status-changed';

function dispatchProviderStatusChange() {
    window.dispatchEvent(new CustomEvent(PROVIDER_STATUS_EVT));
}

function isProviderConfigured(providerId: string): boolean {
    if (providerId === 'openai') {
        return (
            keyStore.has('openai', 'apiKey') ||
            keyStore.has('chatgpt-oauth', 'accessToken')
        );
    }
    const field = PROVIDER_FIELDS[providerId];
    return field ? keyStore.has(providerId, field) : false;
}

function getProviderModeLabel(providerId: string): string {
    if (providerId === 'openai') {
        if (keyStore.has('chatgpt-oauth', 'accessToken')) return '已連線 · 訂閱';
        if (keyStore.has('openai', 'apiKey')) return '已連線 · API key';
    }
    return isProviderConfigured(providerId) ? '已連線' : '未設定';
}

function useProviderStatus(providerId: string) {
    const [status, setStatus] = useState(() => getProviderModeLabel(providerId));
    useEffect(() => {
        const refresh = () => setStatus(getProviderModeLabel(providerId));
        refresh();
        window.addEventListener(PROVIDER_STATUS_EVT, refresh);
        return () => window.removeEventListener(PROVIDER_STATUS_EVT, refresh);
    }, [providerId]);
    return status;
}

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

            <PHead>連結</PHead>
            <PRow
                label="GitHub"
                hint="原始碼、issue、release notes"
                right={
                    <PBtn
                        onClick={async () => {
                            const { openUrl } = await import(
                                '@tauri-apps/plugin-opener'
                            );
                            await openUrl(
                                'https://github.com/sklonely/ClassNoteAI',
                            );
                        }}
                    >
                        前往
                    </PBtn>
                }
            />
            <PRow
                label="加入 Discord 社群"
                hint="尚未開放 — 邀請連結就緒後在 PAbout 「使用者指南」一併放出"
                right={<PBtn disabled>留白</PBtn>}
            />
        </div>
    );
}


/* ════════════════════════════════════════════════════════════════
 * PTranscribe — 本地轉錄
 * ════════════════════════════════════════════════════════════════ */

const ASR_BACKEND_LABEL: Record<NonNullable<NonNullable<AppSettingsExperimental>['asrBackend']>, string> = {
    auto: 'Auto',
    cuda: 'CUDA',
    metal: 'Metal',
    vulkan: 'Vulkan',
    cpu: 'CPU',
};

type AppSettingsExperimental = NonNullable<
    import('../../types').AppSettings['experimental']
>;

interface BuildFeaturesShape {
    nmt_local: boolean;
    gpu_cuda: boolean;
    gpu_metal: boolean;
    gpu_vulkan: boolean;
}

export function PTranscribe() {
    const { settings, update } = useAppSettings();
    const exp = settings?.experimental || {};
    const variant: 'int8' | 'fp32' = exp.parakeetVariant || 'int8';
    const backend = exp.asrBackend || 'auto';
    const logLevel = exp.logLevel || 'info';

    const [features, setFeatures] = useState<BuildFeaturesShape | null>(null);
    const [featuresErr, setFeaturesErr] = useState<string | null>(null);
    const [redetecting, setRedetecting] = useState(false);

    // cp75.10 — real download/switch wiring. The previous PTranscribe
    // had `loaded` hardcoded true for INT8 / undefined for FP32, and the
    //「下載」button was a cosmetic PBtn with no onClick — so the user
    // could not download FP32, could not switch to FP32, and had no
    // signal whether INT8 was actually present locally either.
    interface ParakeetStatusVariant {
        variant: 'int8' | 'fp32';
        present: boolean;
        loaded: boolean;
    }
    interface ParakeetStatusShape {
        variants?: ParakeetStatusVariant[];
        loaded_variant?: 'int8' | 'fp32' | null;
    }
    const [parakeetStatus, setParakeetStatus] =
        useState<ParakeetStatusShape | null>(null);
    const [parakeetDownloading, setParakeetDownloading] =
        useState<'int8' | 'fp32' | null>(null);
    const [parakeetProgress, setParakeetProgress] = useState<{
        variant: 'int8' | 'fp32';
        downloaded: number;
        total: number;
    } | null>(null);

    const refreshParakeetStatus = useCallback(async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const status = await invoke<ParakeetStatusShape>(
                'get_parakeet_status',
            );
            setParakeetStatus(status);
        } catch (err) {
            console.warn('[PTranscribe] get_parakeet_status failed:', err);
        }
    }, []);

    useEffect(() => {
        void refreshParakeetStatus();
    }, [refreshParakeetStatus]);

    const presentMap = useMemo(() => {
        const m: Record<'int8' | 'fp32', boolean> = { int8: false, fp32: false };
        for (const v of parakeetStatus?.variants ?? []) {
            m[v.variant] = !!v.present;
        }
        return m;
    }, [parakeetStatus]);

    const loadFeatures = async (force = false) => {
        try {
            setFeaturesErr(null);
            const mod = await import('../../services/buildFeaturesService');
            if (force) mod._resetBuildFeaturesCache();
            const f = (await mod.getBuildFeatures()) as BuildFeaturesShape;
            setFeatures(f);
        } catch (err) {
            setFeaturesErr(
                (err as Error)?.message || 'get_build_features 失敗',
            );
            setFeatures(null);
        }
    };

    useEffect(() => {
        void loadFeatures(false);
    }, []);

    const setVariant = async (next: 'int8' | 'fp32') => {
        // Don't let the user switch to a variant they haven't downloaded
        // yet — the runtime would just fall back to first_present and
        // ignore the setting silently. Tell them via toast and stay on
        // the current variant.
        if (!presentMap[next]) {
            void import('../../services/toastService').then(({ toastService }) =>
                toastService.warning(
                    `${next === 'fp32' ? 'FP32' : 'INT8'} 模型尚未下載`,
                    '請先按「下載」取得該變體後再切換。',
                ),
            );
            return;
        }
        if (variant === next) return;
        // cp75.12 — surface concrete switch feedback. Before this the
        // click silently flipped settings but the user got no signal
        // (presentMap could also be racey-empty during first render →
        // looked like "切換不了"). Now: persist + toast that the new
        // variant takes effect at the next session boot. Active recording
        // stays on the loaded engine (in-place hot-swap mid-session
        // would cut audio, which is worse).
        await update({ experimental: { ...exp, parakeetVariant: next } });
        void import('../../services/toastService').then(({ toastService }) =>
            toastService.success(
                `已切到 ${next === 'fp32' ? 'Parakeet FP32' : 'Parakeet INT8'}`,
                '下次開始錄音時會自動用此變體。目前錄音中的話請結束再開始。',
            ),
        );
    };

    const handleDownloadVariant = useCallback(
        async (target: 'int8' | 'fp32') => {
            if (parakeetDownloading) return;
            setParakeetDownloading(target);
            setParakeetProgress({ variant: target, downloaded: 0, total: 0 });
            const { invoke } = await import('@tauri-apps/api/core');
            const { listen } = await import('@tauri-apps/api/event');
            const { toastService } = await import(
                '../../services/toastService'
            );
            let unlisten: (() => void) | null = null;
            try {
                unlisten = await listen<{
                    variant: 'int8' | 'fp32';
                    file_index: number;
                    file_name: string;
                    file_size: number;
                    file_downloaded: number;
                    total_size: number;
                    completed: boolean;
                }>('parakeet-download-progress', (e) => {
                    if (e.payload.variant !== target) return;
                    setParakeetProgress({
                        variant: target,
                        downloaded: e.payload.file_downloaded,
                        total: e.payload.total_size,
                    });
                });
                await invoke<string>('parakeet_download_model', {
                    variant: target,
                });
                await refreshParakeetStatus();
                toastService.success(
                    '模型下載完成',
                    `${target === 'fp32' ? 'FP32' : 'INT8'} 已下載；可在卡片切換為使用中。`,
                );
            } catch (err) {
                toastService.error(
                    '模型下載失敗',
                    (err as Error)?.message || String(err),
                );
            } finally {
                if (unlisten) unlisten();
                setParakeetDownloading(null);
                setParakeetProgress(null);
            }
        },
        [parakeetDownloading, refreshParakeetStatus],
    );

    return (
        <div>
            <PHeader
                title="本地轉錄模型"
                hint="Parakeet 在本機跑 — 離線、不上雲、不付 API 費用。透過 parakeet-rs in-process 執行，無 sidecar。"
            />

            <PHead first>模型</PHead>
            <PRow
                label="模型管理"
                hint={(() => {
                    const downloaded = (['int8', 'fp32'] as const).filter(
                        (v) => presentMap[v],
                    ).length;
                    return `已下載 ${downloaded} / 2 · 點卡片切換；未下載的可按「下載」取得。`;
                })()}
            >
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <ModelCard
                        name="parakeet-int8"
                        size="852 MB"
                        wer="WER 8.01%"
                        hint="8-bit 量化 · 推薦：精度差距在誤差內，下載快 3×"
                        loaded={presentMap.int8}
                        active={variant === 'int8'}
                        downloading={parakeetDownloading === 'int8'}
                        progress={
                            parakeetProgress?.variant === 'int8'
                                ? parakeetProgress
                                : undefined
                        }
                        onSelect={() => setVariant('int8')}
                        onDownload={() => handleDownloadVariant('int8')}
                    />
                    <ModelCard
                        name="parakeet-fp32"
                        size="2.5 GB"
                        wer="WER 8.03%"
                        hint="原版浮點 · 對精度有極致要求 / A/B 比較的進階使用者"
                        loaded={presentMap.fp32}
                        actionLabel="下載"
                        active={variant === 'fp32'}
                        downloading={parakeetDownloading === 'fp32'}
                        progress={
                            parakeetProgress?.variant === 'fp32'
                                ? parakeetProgress
                                : undefined
                        }
                        onSelect={() => setVariant('fp32')}
                        onDownload={() => handleDownloadVariant('fp32')}
                    />
                </div>
            </PRow>

            <PHead>GPU / 效能</PHead>
            <PRow
                label="後端偏好"
                hint="Auto 會在偵測到的後端中選最佳。"
                right={
                    <PSelect
                        value={ASR_BACKEND_LABEL[backend]}
                        options={Object.values(ASR_BACKEND_LABEL)}
                        onChange={(label) => {
                            const entry = (
                                Object.entries(ASR_BACKEND_LABEL) as [
                                    keyof typeof ASR_BACKEND_LABEL,
                                    string,
                                ][]
                            ).find(([, l]) => l === label);
                            if (!entry) return;
                            update({
                                experimental: {
                                    ...exp,
                                    asrBackend: entry[0],
                                },
                            });
                        }}
                    />
                }
            />
            <PRow
                label="GPU 偵測結果"
                hint={renderFeaturesHint(features, featuresErr, redetecting)}
                right={
                    <PBtn
                        disabled={redetecting}
                        onClick={async () => {
                            setRedetecting(true);
                            await loadFeatures(true);
                            setRedetecting(false);
                        }}
                    >
                        {redetecting ? '偵測中…' : '重新偵測'}
                    </PBtn>
                }
            />

            <PHead>進階</PHead>
            <PRow
                label="Log 等級"
                hint="info 是預設；debug / trace 會在 console 出更多訊息（log.* 自身需另行串接 Rust tracing）"
                right={
                    <PSelect
                        value={logLevel}
                        options={['error', 'warn', 'info', 'debug', 'trace']}
                        onChange={(v) =>
                            update({
                                experimental: {
                                    ...exp,
                                    logLevel: v as
                                        | 'error'
                                        | 'warn'
                                        | 'info'
                                        | 'debug'
                                        | 'trace',
                                },
                            })
                        }
                    />
                }
            />
        </div>
    );
}

/**
 * Render the GPU detection PRow's left-side hint.
 *
 * Cases:
 *  - features 還沒載 → 「偵測中…」
 *  - get_build_features 報錯 → 紅字訊息
 *  - 沒任何 GPU feature 開 → 「CPU only · 這個 build 沒帶 GPU 後端」
 *  - 有 → 列出 ✓ CUDA / ✓ Metal / ✓ Vulkan + dev/release 提示
 *
 * Why dev build 看不到 CUDA：本地 `tauri:dev` 用
 *   `cargo run --no-default-features --features candle-embed,speaker-diarization`
 * 沒帶 `gpu-cuda`。要看到 CUDA 必須安裝 release 的 *_x64-cuda-setup.exe。
 */
function renderFeaturesHint(
    features: BuildFeaturesShape | null,
    err: string | null,
    redetecting: boolean,
): ReactNode {
    if (err) {
        return (
            <span style={{ color: 'var(--h18-hot)', fontSize: 11 }}>
                ⚠ {err}
            </span>
        );
    }
    if (!features) {
        return (
            <span style={{ color: 'var(--h18-text-dim)', fontSize: 11 }}>
                {redetecting ? '偵測中…' : '載入中…'}
            </span>
        );
    }
    const enabledGpus: string[] = [];
    if (features.gpu_cuda) enabledGpus.push('CUDA');
    if (features.gpu_metal) enabledGpus.push('Metal');
    if (features.gpu_vulkan) enabledGpus.push('Vulkan');

    if (enabledGpus.length === 0) {
        return (
            <span style={{ fontSize: 11, lineHeight: 1.55 }}>
                <span style={{ fontFamily: 'var(--h18-font-mono)', color: 'var(--h18-text-mid)' }}>
                    CPU only
                </span>{' '}
                — 這個 build 沒帶 GPU 後端。Dev 模式預設只 compile{' '}
                <span style={{ fontFamily: 'var(--h18-font-mono)' }}>
                    candle-embed,speaker-diarization
                </span>
                ；要 CUDA 請裝 release 的{' '}
                <span style={{ fontFamily: 'var(--h18-font-mono)' }}>x64-cuda-setup.exe</span>。
            </span>
        );
    }
    return (
        <span style={{ fontSize: 11, lineHeight: 1.55 }}>
            {enabledGpus.map((g, i) => (
                <span
                    key={g}
                    style={{
                        marginRight: 8,
                        color: 'var(--h18-accent)',
                        fontFamily: 'var(--h18-font-mono)',
                        fontWeight: 600,
                    }}
                >
                    ✓ {g}
                    {i < enabledGpus.length - 1 ? '' : ''}
                </span>
            ))}
            <span style={{ color: 'var(--h18-text-dim)' }}>
                · 本地翻譯 NMT{' '}
                {features.nmt_local ? (
                    <span style={{ color: 'var(--h18-accent)' }}>已啟用</span>
                ) : (
                    <span>未啟用</span>
                )}
            </span>
        </span>
    );
}

function ModelCard({
    name,
    size,
    wer,
    hint,
    loaded,
    actionLabel,
    active,
    downloading,
    progress,
    onSelect,
    onDownload,
}: {
    name: string;
    size: string;
    wer: string;
    hint: string;
    loaded?: boolean;
    actionLabel?: string;
    /** True when this is the user's currently selected variant. */
    active?: boolean;
    /** Currently downloading this card's variant. */
    downloading?: boolean;
    /** Live progress for this variant during download. */
    progress?: { downloaded: number; total: number };
    /** Click handler for switching to this variant. */
    onSelect?: () => void;
    /** Click handler for the「下載」action button. */
    onDownload?: () => void;
}) {
    // cp75.10 — card behaviour:
    //   - loaded + !active → click row OR button to switch
    //   - !loaded         → click button to download (row click is no-op)
    //   - downloading     → button shows progress / disabled
    //   - active          → 使用中 (no action)
    const cardInteractive = !!loaded && !!onSelect && !active;
    const showDownload = !loaded;
    const handleRowClick = () => {
        if (!cardInteractive) return;
        onSelect?.();
    };
    const handleBtnClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
        // Don't bubble — otherwise loaded cards' row click ALSO fires.
        e.stopPropagation();
        if (active) return;
        if (showDownload) {
            if (downloading) return;
            onDownload?.();
        } else if (loaded) {
            onSelect?.();
        }
    };
    const pctNum =
        progress && progress.total > 0
            ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
            : null;
    const btnLabel = active
        ? '使用中'
        : downloading
        ? pctNum !== null
            ? `下載中 ${pctNum}%`
            : '下載中…'
        : loaded
        ? '切換'
        : actionLabel || '下載';
    return (
        <div
            role={cardInteractive ? 'button' : undefined}
            tabIndex={cardInteractive ? 0 : undefined}
            onClick={handleRowClick}
            onKeyDown={(e) => {
                if (!cardInteractive) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleRowClick();
                }
            }}
            style={{
                padding: '10px 12px',
                borderRadius: 6,
                border: `1px solid ${active ? 'var(--h18-accent)' : 'var(--h18-border-soft)'}`,
                background: active ? 'var(--h18-chip-bg)' : 'var(--h18-surface2)',
                display: 'grid',
                gridTemplateColumns: '140px 80px 80px 1fr auto',
                gap: 10,
                alignItems: 'center',
                cursor: cardInteractive ? 'pointer' : 'default',
                opacity: !loaded && !downloading ? 0.85 : 1,
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
            <button
                type="button"
                onClick={handleBtnClick}
                disabled={active || (downloading && showDownload)}
                style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--h18-border-soft)',
                    background: active
                        ? 'var(--h18-surface)'
                        : 'var(--h18-surface)',
                    color: active
                        ? 'var(--h18-text-dim)'
                        : showDownload
                        ? 'var(--h18-accent)'
                        : 'var(--h18-text)',
                    cursor: active
                        ? 'default'
                        : downloading
                        ? 'wait'
                        : 'pointer',
                    fontFamily: 'var(--h18-font-mono)',
                }}
            >
                {btnLabel}
            </button>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PTranslate — 翻譯
 * ════════════════════════════════════════════════════════════════ */

type Engine = 'gemma' | 'google' | 'local';

const SRC_LANG_OPTIONS: { label: string; value: string }[] = [
    { label: '自動偵測', value: 'auto' },
    { label: '英文', value: 'en' },
    { label: '中文（繁）', value: 'zh-TW' },
    { label: '中文（簡）', value: 'zh-CN' },
    { label: '日文', value: 'ja' },
    { label: '韓文', value: 'ko' },
];

const TGT_LANG_OPTIONS: { label: string; value: string }[] = [
    { label: '中文（繁）', value: 'zh-TW' },
    { label: '中文（簡）', value: 'zh-CN' },
    { label: '英文', value: 'en' },
    { label: '日文', value: 'ja' },
    { label: '韓文', value: 'ko' },
];

function labelOf(opts: { label: string; value: string }[], value?: string): string {
    return opts.find((o) => o.value === value)?.label || opts[0].label;
}
function valueOf(opts: { label: string; value: string }[], label: string): string {
    return opts.find((o) => o.label === label)?.value || opts[0].value;
}

interface GemmaVariantStatus {
    variant: 'b4' | 'b12' | 'b27' | string; // server may extend
    label: string;
    filename: string;
    url: string;
    present: boolean;
    expected_size: number;
}

interface GemmaSidecarStatus {
    binary_path: string | null;
    /** Legacy 4B path (kept for backwards compat). */
    model_path: string;
    /** Legacy 4B presence (kept for backwards compat). */
    model_present: boolean;
    /** Legacy 4B size. */
    model_size_bytes: number;
    /** Legacy 4B url. */
    model_url: string;
    sidecar_running: boolean;
    /** cp75.10 — per-variant presence, drives multi-card UI. */
    variants?: GemmaVariantStatus[];
}

type SidecarBringUp =
    | 'already_running'
    | 'spawned'
    | 'timeout'
    | 'binary_not_found'
    | 'spawn_error';

const SIDECAR_BRING_UP_LABEL: Record<SidecarBringUp, string> = {
    already_running: 'sidecar 已在執行',
    spawned: 'sidecar 已啟動',
    timeout: '/health 在 30 秒內沒回應 — GPU 可能滿了',
    binary_not_found: '找不到 llama-server 二進位檔',
    spawn_error: 'spawn 失敗（權限 / 缺 DLL？）',
};

export function PTranslate() {
    const { settings, update } = useAppSettings();
    const t = settings?.translation;
    const sub = settings?.subtitle;

    const engine: Engine = (t?.provider as Engine) || 'gemma';
    const srcLabel = labelOf(SRC_LANG_OPTIONS, t?.source_language);
    const tgtLabel = labelOf(TGT_LANG_OPTIONS, t?.target_language);
    const bilingual = sub?.display_mode === 'both';

    // Gemma sidecar lifecycle (移植自 legacy SettingsTranslation —
    // 沒這個 UI 使用者就沒地方手動啟動 / 重啟 llama-server。
    // App.tsx 有 boot-time autostart 但不 cover「下載完成後立刻想用」
    // 或「sidecar crashed 想重啟」的場景)。
    const [gemmaStatus, setGemmaStatus] = useState<GemmaSidecarStatus | null>(
        null,
    );
    const [sidecarBusy, setSidecarBusy] = useState<'idle' | 'starting' | 'stopping'>(
        'idle',
    );
    const [sidecarMsg, setSidecarMsg] = useState<string | null>(null);

    // S3g — Gemma model download flow. Moved from legacy SettingsTranslation
    // so that PTranslate is the single source of truth for the model. The
    // long-running download integrates with taskTrackerService so the global
    // TopBar TaskIndicator (S2.5) renders the same progress without a second
    // bar inside this pane.
    const [downloading, setDownloading] = useState(false);
    // Tracker id is kept in a ref so the listen() callback can read the
    // current id without re-creating the closure each render.
    const downloadTaskIdRef = useRef<string | null>(null);

    const refreshGemmaStatus = async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const s = await invoke<GemmaSidecarStatus>('get_gemma_status');
            setGemmaStatus(s);
        } catch (err) {
            console.warn('[PTranslate] get_gemma_status failed:', err);
        }
    };

    useEffect(() => {
        void refreshGemmaStatus();
        // Poll every 5s while this pane is mounted so the indicator
        // reflects real state (sidecar can crash / be killed externally).
        const id = setInterval(refreshGemmaStatus, 5_000);
        return () => clearInterval(id);
    }, []);

    /**
     * Handle the 下載 button click.
     *
     * Flow:
     *   1. Open a tracker entry (kind: 'export' — closest to "long file
     *      operation"; the contract has no 'download' kind and 'summarize'
     *      / 'index' would surface a misleading W18 success toast).
     *   2. Subscribe to `gemma-download-progress` (rust emits 0-100 percent;
     *      we normalise to 0-1 for the tracker).
     *   3. await `download_gemma_model`. On success: complete + refresh
     *      status + success toast. On failure: fail + error toast.
     *   4. Always unlisten the progress channel and clear the busy flag
     *      in `finally` so a transient error doesn't strand the button
     *      in 「下載中…」.
     *
     * Concurrent clicks are no-ops — guarded by the `downloading` state.
     */
    // cp75.10 — accept a variant ('4b' | '12b' | '27b'). Defaults to '4b'
    // when not supplied so existing call sites still work.
    const handleDownload = async (variantArg?: '4b' | '12b' | '27b') => {
        if (downloading) return;
        const variant = variantArg ?? '4b';
        setDownloading(true);

        const { taskTrackerService } = await import(
            '../../services/taskTrackerService'
        );
        const { toastService } = await import('../../services/toastService');
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');

        const variantLabel = variant.toUpperCase();
        const taskId = taskTrackerService.start({
            kind: 'export',
            label: `下載 Gemma ${variantLabel} 模型`,
        });
        downloadTaskIdRef.current = taskId;

        let unlisten: (() => void) | null = null;
        try {
            unlisten = await listen<{
                downloaded: number;
                total: number;
                percent: number;
                speed_mbps: number;
                eta_seconds: number | null;
            }>('gemma-download-progress', (e) => {
                const pct = e.payload.total > 0
                    ? Math.max(0, Math.min(1, e.payload.percent / 100))
                    : 0;
                taskTrackerService.update(taskId, {
                    progress: pct,
                    status: 'running',
                });
            });

            await invoke<string>('download_gemma_model', { variant });

            taskTrackerService.complete(taskId);
            await refreshGemmaStatus();
            toastService.success(
                `Gemma ${variantLabel} 模型下載完成`,
                '可在 Provider=Gemma 時自動啟動 sidecar',
            );
        } catch (err) {
            const msg = (err as Error)?.message || String(err);
            taskTrackerService.fail(taskId, msg);
            toastService.error(`Gemma ${variantLabel} 下載失敗`, msg);
        } finally {
            if (unlisten) unlisten();
            downloadTaskIdRef.current = null;
            setDownloading(false);
        }
    };

    /** cp75.12 — resolve the sidecar model_path for the user's selected
     *  variant. Falls back to legacy gemmaStatus.model_path (4B) when
     *  the variants list isn't surfaced yet (older binary) or the
     *  selected one isn't downloaded. */
    const resolveSelectedGemmaModelPath = (): string | null => {
        const sel = t?.gemma_variant ?? '4b';
        const match = gemmaStatus?.variants?.find(
            (v) => v.variant.replace(/^b/, '') === sel && v.present,
        );
        if (match) {
            // model_path is the legacy 4B path's directory; swap filename.
            const dir = gemmaStatus?.model_path?.replace(/[^/\\]+$/, '');
            return dir ? `${dir}${match.filename}` : null;
        }
        return gemmaStatus?.model_present
            ? gemmaStatus.model_path
            : null;
    };

    const handleStartSidecar = async () => {
        const modelPath = resolveSelectedGemmaModelPath();
        if (!modelPath) return;
        setSidecarBusy('starting');
        setSidecarMsg(null);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<SidecarBringUp>('start_gemma_sidecar', {
                modelPath,
                port: null,
            });
            setSidecarMsg(SIDECAR_BRING_UP_LABEL[result] || result);
            await refreshGemmaStatus();
        } catch (err) {
            setSidecarMsg(
                (err as Error)?.message || String(err) || '啟動失敗',
            );
        } finally {
            setSidecarBusy('idle');
        }
    };

    /**
     * cp75.12 — real Gemma variant hot-swap. Persists the new variant
     * to settings.translation.gemma_variant AND, if the sidecar is
     * currently up, stops + restarts it with the new model path. UI
     * surfaces clear progress / success feedback so "切換不了" is no
     * longer the user's experience.
     */
    const handleSwitchGemmaVariant = async (
        variant: '4b' | '12b' | '27b',
        label: string,
        filename: string,
    ) => {
        // Already selected? No-op (button shows 使用中, can't get here
        // anyway via normal click but defensive).
        const current = t?.gemma_variant ?? '4b';
        if (current === variant) return;

        const variantPresent = gemmaStatus?.variants?.find(
            (v) => v.variant.replace(/^b/, '') === variant,
        )?.present;
        if (!variantPresent) {
            const { toastService } = await import(
                '../../services/toastService'
            );
            toastService.warning(
                `${label} 模型尚未下載`,
                '請先按該卡片的「下載」取得模型後再切換。',
            );
            return;
        }

        const wasRunning = !!gemmaStatus?.sidecar_running;
        const { invoke } = await import('@tauri-apps/api/core');
        const { toastService } = await import('../../services/toastService');

        try {
            // 1. Persist new selected variant.
            await update({
                translation: { ...(t || {}), gemma_variant: variant },
            });

            // 2. If sidecar is up, stop it (was bound to the old variant's
            //    model_path; cannot hot-swap models without a restart).
            if (wasRunning) {
                setSidecarBusy('stopping');
                try {
                    await invoke('stop_gemma_sidecar');
                } catch (err) {
                    console.warn(
                        '[PTranslate] stop_gemma_sidecar failed:',
                        err,
                    );
                }
            }

            // 3. Start with new path.
            const dir = gemmaStatus?.model_path?.replace(/[^/\\]+$/, '');
            const newPath = dir ? `${dir}${filename}` : null;
            if (!newPath) {
                toastService.error(
                    '無法解析模型路徑',
                    '重啟後手動按 sidecar 列「啟動」即可。',
                );
                setSidecarBusy('idle');
                return;
            }
            setSidecarBusy('starting');
            const result = await invoke<SidecarBringUp>(
                'start_gemma_sidecar',
                { modelPath: newPath, port: null },
            );
            setSidecarMsg(SIDECAR_BRING_UP_LABEL[result] || result);
            await refreshGemmaStatus();
            toastService.success(
                `已切到 ${label}`,
                wasRunning
                    ? 'sidecar 已用新模型重啟，現在生效。'
                    : '下次啟動 sidecar 會用此模型。',
            );
        } catch (err) {
            toastService.error(
                '切換變體失敗',
                (err as Error)?.message || String(err),
            );
        } finally {
            setSidecarBusy('idle');
        }
    };

    const handleStopSidecar = async () => {
        setSidecarBusy('stopping');
        setSidecarMsg(null);
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('stop_gemma_sidecar');
            setSidecarMsg('sidecar 已停止');
            await refreshGemmaStatus();
        } catch (err) {
            setSidecarMsg(
                (err as Error)?.message || String(err) || '停止失敗',
            );
        } finally {
            setSidecarBusy('idle');
        }
    };

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
                        onChange={(v) =>
                            update({
                                translation: { ...(t || {}), provider: v as Engine },
                            })
                        }
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
                label="模型管理"
                hint={(() => {
                    const total = gemmaStatus?.variants?.length ?? 1;
                    const have =
                        gemmaStatus?.variants?.filter((v) => v.present).length ??
                        (gemmaStatus?.model_present ? 1 : 0);
                    return `已下載 ${have} / ${total} · 4B 速度最快、27B 品質最佳；下方可分別下載並切換`;
                })()}
            >
                <div
                    style={{
                        marginTop: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                    }}
                >
                    {/* cp75.10 — render one card per variant. Falls back
                        to the legacy single-button card when the backend
                        doesn't return a `variants` array (older Tauri
                        binary). */}
                    {gemmaStatus?.variants && gemmaStatus.variants.length > 0 ? (
                        gemmaStatus.variants.map((v) => {
                            const variantKey = v.variant.replace(
                                /^b/,
                                '',
                            ) as '4b' | '12b' | '27b';
                            const sizeGb = (
                                v.expected_size / 1_000_000_000
                            ).toFixed(1);
                            // cp75.12 — active = THIS is the user's selected
                            // variant per settings. Sidecar running just
                            // means *some* variant is up, not necessarily
                            // this one — gemmaStatus.model_path tells us
                            // which file the sidecar was started with.
                            const selectedVariant =
                                t?.gemma_variant ?? '4b';
                            const isActive = selectedVariant === variantKey;
                            return (
                                <ModelCard
                                    key={v.variant}
                                    name={`translategemma-${v.label.toLowerCase()}`}
                                    size={`${sizeGb} GB`}
                                    wer={v.label}
                                    hint={
                                        v.label === '4B'
                                            ? '速度最快 · 適合一般筆電 / iGPU'
                                            : v.label === '12B'
                                            ? '中等品質 · 需 ≥10 GB VRAM'
                                            : '最佳品質 (SOTA) · 需 ≥24 GB VRAM'
                                    }
                                    loaded={v.present}
                                    actionLabel="下載"
                                    active={isActive}
                                    downloading={downloading}
                                    onSelect={() =>
                                        handleSwitchGemmaVariant(
                                            variantKey,
                                            v.label,
                                            v.filename,
                                        )
                                    }
                                    onDownload={() =>
                                        handleDownload(variantKey)
                                    }
                                />
                            );
                        })
                    ) : (
                        // Legacy fallback (older Tauri build w/o variants list)
                        <ModelCard
                            name="translategemma-4b"
                            size={`${(
                                (gemmaStatus?.model_size_bytes ?? 0) /
                                1_000_000_000
                            ).toFixed(2)} GB`}
                            wer="4B"
                            hint="速度最快 · 適合一般筆電 / iGPU"
                            loaded={!!gemmaStatus?.model_present}
                            actionLabel="下載"
                            active={!!gemmaStatus?.sidecar_running}
                            downloading={downloading}
                            onSelect={() => undefined}
                            onDownload={() => handleDownload('4b')}
                        />
                    )}
                </div>
            </PRow>
            <PRow
                label="llama-server sidecar"
                hint={
                    sidecarMsg ? (
                        <span
                            style={{
                                color: gemmaStatus?.sidecar_running
                                    ? 'var(--h18-accent)'
                                    : 'var(--h18-text-mid)',
                            }}
                        >
                            {sidecarMsg}
                        </span>
                    ) : gemmaStatus?.sidecar_running ? (
                        <span style={{ color: 'var(--h18-accent)' }}>
                            ● 執行中（埠 {(t?.gemma_endpoint || 'http://127.0.0.1:8080').match(/:(\d+)/)?.[1] || '8080'}）
                        </span>
                    ) : (
                        '未啟動 — 字幕翻譯會走 Google fallback，無 API key 時則保持英文。'
                    )
                }
                right={
                    gemmaStatus?.sidecar_running ? (
                        <PBtn
                            danger
                            onClick={handleStopSidecar}
                            disabled={sidecarBusy !== 'idle'}
                        >
                            {sidecarBusy === 'stopping' ? '停止中…' : '停止'}
                        </PBtn>
                    ) : (
                        <PBtn
                            primary
                            onClick={handleStartSidecar}
                            disabled={
                                !gemmaStatus?.model_present ||
                                sidecarBusy !== 'idle'
                            }
                        >
                            {sidecarBusy === 'starting' ? '啟動中…' : '啟動'}
                        </PBtn>
                    )
                }
            />
            <PRow
                label="endpoint"
                hint="預設 127.0.0.1:8080。除非自己改 llama-server port 否則不用動"
                right={
                    <PInput
                        value={t?.gemma_endpoint || 'http://127.0.0.1:8080'}
                        onChange={(v) =>
                            update({
                                translation: { ...(t || {}), gemma_endpoint: v },
                            })
                        }
                        monospace
                        wide
                    />
                }
            />

            <PHead>Google Cloud (備用)</PHead>
            <PRow
                label="API key"
                hint="Translation API 憑證。沒填的話 Gemma 失敗時會直接報錯"
                right={
                    <PInput
                        placeholder="AIza...."
                        value={t?.google_api_key || ''}
                        onChange={(v) =>
                            update({
                                translation: { ...(t || {}), google_api_key: v },
                            })
                        }
                        monospace
                        wide
                    />
                }
            />

            <PHead>語言</PHead>
            <PRow
                label="來源語言"
                hint="影響轉錄與字幕的主要語言"
                right={
                    <PSelect
                        value={srcLabel}
                        options={SRC_LANG_OPTIONS.map((o) => o.label)}
                        onChange={(label) =>
                            update({
                                translation: {
                                    ...(t || {}),
                                    source_language: valueOf(
                                        SRC_LANG_OPTIONS,
                                        label,
                                    ) as AppSettingsSourceLang,
                                },
                            })
                        }
                    />
                }
            />
            <PRow
                label="目標語言"
                hint="字幕、摘要、Q&A 翻譯到這個語言"
                right={
                    <PSelect
                        value={tgtLabel}
                        options={TGT_LANG_OPTIONS.map((o) => o.label)}
                        onChange={(label) =>
                            update({
                                translation: {
                                    ...(t || {}),
                                    target_language: valueOf(TGT_LANG_OPTIONS, label),
                                },
                            })
                        }
                    />
                }
            />
            <PRow
                label="雙語字幕"
                hint="同時顯示來源與目標語言"
                right={
                    <PToggle
                        on={bilingual}
                        onChange={(v) =>
                            update({
                                subtitle: {
                                    ...(sub || {
                                        font_size: 16,
                                        font_color: '#fff',
                                        background_opacity: 0.6,
                                        position: 'bottom',
                                        display_mode: 'en',
                                    }),
                                    display_mode: v ? 'both' : 'en',
                                },
                            })
                        }
                    />
                }
            />
        </div>
    );
}

type AppSettingsSourceLang = 'auto' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'zh-TW' | 'zh-CN';

/* ════════════════════════════════════════════════════════════════
 * PCloud — 雲端 AI 助理
 * ════════════════════════════════════════════════════════════════ */

interface ProviderInfo {
    id: string;
    name: string;
    auth: string;
    desc: string;
    sub: string;
    active?: boolean;
    icon: ReactNode;
    /** Brand tint for the icon slot. */
    iconColor: string;
    /** When true the action button opens a multi-mode setup modal rather than a single button. */
    multiMode?: boolean;
}

// v0.7.x: 暫時只留已實作 + 已驗過的 providers (GitHub Models / OpenAI)。
// Anthropic / Gemini / Azure 之前 UI 雖然在但 backend provider 沒實作，
// 留著只會誤導使用者；等真的接好再放回來。
const PROVIDERS: ProviderInfo[] = [
    {
        id: 'github-models',
        name: 'GitHub Models',
        auth: 'PAT (models:read)',
        desc: 'Copilot Pro / Business / Enterprise 訂閱包含額度',
        sub: 'GPT-4.1 / Claude / Llama',
        icon: <GitHubIcon size={26} />,
        iconColor: 'var(--h18-text)',
    },
    {
        id: 'openai',
        name: 'OpenAI',
        auth: 'API key 或 ChatGPT 訂閱',
        desc: 'GPT-5 / GPT-4o · 自備 key 或登入 ChatGPT Plus/Pro',
        sub: 'API · 訂閱 雙模式',
        icon: <OpenAIIcon size={26} />,
        iconColor: '#10a37f',
        multiMode: true,
    },
];

const OCR_LABEL: Record<'auto' | 'remote' | 'off', string> = {
    auto: 'auto (推薦)',
    remote: 'remote',
    off: 'off',
};

const REFINE_LABEL: Record<'off' | 'light' | 'deep', string> = {
    off: '關閉',
    light: '輕 (預設)',
    deep: '深',
};

const REFINE_PROVIDER_OPTIONS: NonNullable<
    NonNullable<import('../../types').AppSettings['experimental']>['refineProvider']
>[] = ['auto', 'github-models', 'chatgpt-oauth'];

export function PCloud() {
    const { settings, update } = useAppSettings();
    const ocrMode = settings?.ocr?.mode || 'auto';
    const exp = settings?.experimental || {};
    const refineIntensity = exp.refineIntensity || 'light';
    const refineProvider = exp.refineProvider || 'auto';

    const [setupId, setSetupId] = useState<string | null>(null);
    const setupProvider = setupId ? PROVIDERS.find((p) => p.id === setupId) ?? null : null;

    return (
        <div>
            <PHeader
                title="雲端 AI 助理"
                hint="摘要、Q&A、關鍵字、PDF OCR、字幕精修使用的雲端 LLM。挑一個 default provider；字幕精修可單獨指定其他 provider。"
            />

            <PHead first>Default Provider</PHead>
            <div className={s.providerGrid}>
                {PROVIDERS.map((p) => (
                    <ProviderCard key={p.id} p={p} onSetup={() => setSetupId(p.id)} />
                ))}
            </div>

            <PHead>PDF OCR</PHead>
            <PRow
                label="OCR 模式"
                hint="auto = 優先用雲端 LLM vision，沒設定 fallback PDF 文字層 / remote = 只用雲端 / off = 跳過 OCR"
                right={
                    <PSelect
                        value={OCR_LABEL[ocrMode]}
                        options={Object.values(OCR_LABEL)}
                        onChange={(label) => {
                            const entry = (
                                Object.entries(OCR_LABEL) as [
                                    'auto' | 'remote' | 'off',
                                    string,
                                ][]
                            ).find(([, l]) => l === label);
                            if (!entry) return;
                            update({
                                ocr: { mode: entry[0] },
                            });
                        }}
                    />
                }
            />

            <PHead>字幕精修</PHead>
            <PRow
                label="精修強度"
                hint="輕 = 補標點 / 糾正術語。深 = 全段重寫順暢度。"
                right={
                    <PSelect
                        value={REFINE_LABEL[refineIntensity]}
                        options={Object.values(REFINE_LABEL)}
                        onChange={(label) => {
                            const entry = (
                                Object.entries(REFINE_LABEL) as [
                                    'off' | 'light' | 'deep',
                                    string,
                                ][]
                            ).find(([, l]) => l === label);
                            if (!entry) return;
                            update({
                                experimental: {
                                    ...exp,
                                    refineIntensity: entry[0],
                                },
                            });
                        }}
                    />
                }
            />
            <PRow
                label="精修 Provider 覆寫"
                hint="字幕精修可單獨指定 provider，避免吃掉 default 的訂閱額度"
                right={
                    <PSelect
                        value={refineProvider}
                        options={REFINE_PROVIDER_OPTIONS as unknown as string[]}
                        onChange={(v) =>
                            update({
                                experimental: {
                                    ...exp,
                                    refineProvider: v as typeof refineProvider,
                                },
                            })
                        }
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

            {setupProvider && (
                <ProviderSetupModal
                    provider={setupProvider}
                    onClose={() => setSetupId(null)}
                />
            )}
        </div>
    );
}

function ProviderCard({ p, onSetup }: { p: ProviderInfo; onSetup: () => void }) {
    const status = useProviderStatus(p.id);
    const configured = status.startsWith('已連線');

    const actionLabel = !configured
        ? p.multiMode
            ? '設定…'
            : p.auth.includes('OAuth')
              ? '登入'
              : '設定'
        : '管理';

    return (
        <div className={`${s.providerCard} ${p.active ? s.providerCardActive : ''}`}>
            <div className={s.providerHead}>
                <div
                    className={s.providerIcon}
                    style={{ color: p.iconColor }}
                    aria-hidden
                >
                    {p.icon}
                </div>
                <div className={s.providerHeadText}>
                    <div className={s.providerName}>
                        {p.name}
                        {p.active && <span className={s.providerDefaultPill}>DEFAULT</span>}
                    </div>
                    <div className={s.providerSubInline}>{p.sub}</div>
                </div>
            </div>
            <div className={s.providerDesc}>{p.desc}</div>
            <div className={s.providerMeta}>
                <span>{p.auth}</span>
            </div>
            <div className={s.providerStatusRow}>
                <span
                    className={
                        configured
                            ? s.providerStatusGood
                            : s.providerStatusOff
                    }
                >
                    {status}
                </span>
                <PBtn primary={!configured} onClick={onSetup}>
                    {actionLabel}
                </PBtn>
            </div>
        </div>
    );
}

/* ────────── ProviderSetupModal ───────── */

function ProviderSetupModal({
    provider,
    onClose,
}: {
    provider: ProviderInfo;
    onClose: () => void;
}) {
    // Determine starting mode based on what's already configured
    const initialMode: 'choose' | 'apikey' | 'oauth' = (() => {
        if (!provider.multiMode) return 'apikey';
        if (keyStore.has('chatgpt-oauth', 'accessToken')) return 'oauth';
        if (keyStore.has(provider.id, 'apiKey')) return 'apikey';
        return 'choose';
    })();

    const [mode, setMode] = useState<'choose' | 'apikey' | 'oauth'>(initialMode);
    const [apiKey, setApiKey] = useState(() => {
        const field = PROVIDER_FIELDS[provider.id] || 'apiKey';
        return keyStore.get(provider.id, field) || '';
    });
    const [endpoint, setEndpoint] = useState(
        () => keyStore.get('azure', 'endpoint') || '',
    );
    const [oauthState, setOauthState] = useState<
        'idle' | 'pending' | 'error' | 'done'
    >(keyStore.has('chatgpt-oauth', 'accessToken') ? 'done' : 'idle');
    const [oauthError, setOauthError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const oauthProviderRef = useRef<ChatGPTOAuthProvider | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && oauthState !== 'pending') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, oauthState]);

    // Cancel any in-flight OAuth on unmount
    useEffect(() => {
        return () => {
            if (oauthState === 'pending') {
                void oauthProviderRef.current?.cancelSignIn();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isAzure = provider.id === 'azure';
    const apiKeyField = PROVIDER_FIELDS[provider.id] || 'apiKey';
    const apiKeyConfigured = keyStore.has(provider.id, apiKeyField);
    const oauthConfigured = keyStore.has('chatgpt-oauth', 'accessToken');

    const handleSaveApiKey = () => {
        setSaveError(null);
        try {
            const trimmed = apiKey.trim();
            if (!trimmed) {
                keyStore.clear(provider.id, apiKeyField);
            } else {
                keyStore.set(provider.id, apiKeyField, trimmed);
            }
            if (isAzure) {
                const ep = endpoint.trim();
                if (ep) keyStore.set('azure', 'endpoint', ep);
                else keyStore.clear('azure', 'endpoint');
            }
            dispatchProviderStatusChange();
            onClose();
        } catch (err) {
            console.error('[ProviderSetup] save apiKey failed:', err);
            setSaveError(
                (err as Error)?.message || '儲存失敗 — 詳見 console。',
            );
        }
    };

    const handleClearApiKey = () => {
        keyStore.clear(provider.id, apiKeyField);
        if (isAzure) keyStore.clear('azure', 'endpoint');
        setApiKey('');
        if (isAzure) setEndpoint('');
        dispatchProviderStatusChange();
    };

    const handleStartOAuth = async () => {
        setOauthState('pending');
        setOauthError(null);
        const oauthProvider = new ChatGPTOAuthProvider();
        oauthProviderRef.current = oauthProvider;
        try {
            await oauthProvider.signIn();
            setOauthState('done');
            dispatchProviderStatusChange();
        } catch (err) {
            console.error('[ProviderSetup] OAuth signIn failed:', err);
            setOauthState('error');
            setOauthError(
                (err as Error)?.message || '登入失敗或被取消。',
            );
        } finally {
            oauthProviderRef.current = null;
        }
    };

    const handleCancelOAuth = async () => {
        if (oauthProviderRef.current) {
            await oauthProviderRef.current.cancelSignIn();
        }
        setOauthState('idle');
        setOauthError('已取消登入。');
    };

    const handleSignOutOAuth = async () => {
        const provider = new ChatGPTOAuthProvider();
        await provider.signOut();
        setOauthState('idle');
        dispatchProviderStatusChange();
    };

    return (
        <div
            className={s.modalScrim}
            onClick={() => {
                if (oauthState !== 'pending') onClose();
            }}
            role="presentation"
        >
            <div
                className={s.modalCard}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`設定 ${provider.name}`}
            >
                <div className={s.modalHead}>
                    <div
                        className={s.providerIcon}
                        style={{ color: provider.iconColor, width: 36, height: 36 }}
                        aria-hidden
                    >
                        {provider.icon || <GenericProviderIcon size={26} />}
                    </div>
                    <div className={s.modalHeadText}>
                        <div className={s.modalTitle}>設定 {provider.name}</div>
                        <div className={s.modalSub}>{provider.desc}</div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={s.modalClose}
                        aria-label="關閉"
                        disabled={oauthState === 'pending'}
                    >
                        ✕
                    </button>
                </div>

                {provider.multiMode && mode === 'choose' && (
                    <div className={s.modalChoiceGrid}>
                        <button
                            type="button"
                            className={s.modalChoiceCard}
                            onClick={() => setMode('apikey')}
                        >
                            <div className={s.modalChoiceTitle}>
                                使用 API Key
                                {apiKeyConfigured && (
                                    <span className={s.modalChoiceBadge}>已設定</span>
                                )}
                            </div>
                            <div className={s.modalChoiceDesc}>
                                自備 OpenAI Platform key，按 token 計費。適合輕度使用、開發者帳號。
                            </div>
                            <div className={s.modalChoicePill}>API · 按用量</div>
                        </button>
                        <button
                            type="button"
                            className={s.modalChoiceCard}
                            onClick={() => setMode('oauth')}
                        >
                            <div className={s.modalChoiceTitle}>
                                ChatGPT 訂閱 (OAuth)
                                {oauthConfigured && (
                                    <span className={s.modalChoiceBadge}>已登入</span>
                                )}
                            </div>
                            <div className={s.modalChoiceDesc}>
                                用瀏覽器登入 ChatGPT Plus / Pro 帳號，走 Codex 流程，訂閱方案內額度共用。
                            </div>
                            <div className={s.modalChoicePill}>訂閱 · 包月</div>
                        </button>
                    </div>
                )}

                {mode === 'apikey' && (
                    <div className={s.modalForm}>
                        {isAzure && (
                            <label className={s.modalField}>
                                <span className={s.modalLabel}>Endpoint</span>
                                <PInput
                                    placeholder="https://your-resource.openai.azure.com"
                                    value={endpoint}
                                    onChange={setEndpoint}
                                    monospace
                                    wide
                                />
                            </label>
                        )}
                        <label className={s.modalField}>
                            <span className={s.modalLabel}>API Key</span>
                            <PInput
                                placeholder={
                                    provider.id === 'openai'
                                        ? 'sk-...'
                                        : provider.id === 'anthropic'
                                          ? 'sk-ant-...'
                                          : provider.id === 'gemini'
                                            ? 'AIza...'
                                            : provider.id === 'github-models'
                                              ? 'ghp_...'
                                              : 'azure key'
                                }
                                value={apiKey}
                                onChange={setApiKey}
                                monospace
                                wide
                            />
                        </label>
                        <p className={s.modalHelp}>
                            Key 只存在本機 (localStorage，namespaced 在 llm.{provider.id}.{apiKeyField})，
                            不會上傳。可隨時覆寫或清除。
                        </p>
                        {saveError && (
                            <div className={s.modalErrorBox}>⚠ {saveError}</div>
                        )}
                        <div className={s.modalActions}>
                            {provider.multiMode && (
                                <PBtn onClick={() => setMode('choose')}>← 換個方式</PBtn>
                            )}
                            {apiKeyConfigured && (
                                <PBtn danger onClick={handleClearApiKey}>
                                    清除已存的 key
                                </PBtn>
                            )}
                            <div style={{ flex: 1 }} />
                            <PBtn onClick={onClose}>取消</PBtn>
                            <PBtn
                                primary
                                onClick={handleSaveApiKey}
                                disabled={!apiKey.trim() && !apiKeyConfigured}
                            >
                                儲存
                            </PBtn>
                        </div>
                    </div>
                )}

                {mode === 'oauth' && (
                    <div className={s.modalForm}>
                        <div className={s.modalOauthBox}>
                            <div className={s.modalOauthTitle}>
                                {oauthState === 'done'
                                    ? '✓ 已登入 ChatGPT 帳號'
                                    : '使用 ChatGPT 帳號登入'}
                            </div>
                            <div className={s.modalOauthDesc}>
                                {oauthState === 'pending' ? (
                                    <>
                                        瀏覽器已開啟 OpenAI 登入頁。請在那邊完成授權，這個視窗會自動繼續。
                                        <br />
                                        授權超時 5 分鐘會自動失敗。
                                    </>
                                ) : oauthState === 'done' ? (
                                    <>
                                        ChatGPT access token 已存在本機。摘要 / Q&A 會走訂閱方案額度。
                                        如果要換帳號或斷開，按下方「登出」。
                                    </>
                                ) : (
                                    <>
                                        按下「開啟登入」會在預設瀏覽器開啟 OpenAI 的 OAuth 頁，授權後
                                        ClassNote 會收到 access token，接著就能用訂閱方案的額度。
                                    </>
                                )}
                            </div>
                            <div className={s.modalOauthHint}>
                                {oauthState === 'pending'
                                    ? '⟳ 等待瀏覽器完成…'
                                    : '需要 ChatGPT Plus 或 Pro 帳號 · 不會看到密碼'}
                            </div>
                        </div>
                        {oauthError && (
                            <div className={s.modalErrorBox}>⚠ {oauthError}</div>
                        )}
                        <div className={s.modalActions}>
                            {provider.multiMode && oauthState !== 'pending' && (
                                <PBtn onClick={() => setMode('choose')}>← 換個方式</PBtn>
                            )}
                            {oauthState === 'done' && (
                                <PBtn danger onClick={handleSignOutOAuth}>
                                    登出
                                </PBtn>
                            )}
                            <div style={{ flex: 1 }} />
                            {oauthState === 'pending' ? (
                                <PBtn danger onClick={handleCancelOAuth}>
                                    取消登入
                                </PBtn>
                            ) : oauthState === 'done' ? (
                                <PBtn primary onClick={onClose}>
                                    完成
                                </PBtn>
                            ) : (
                                <>
                                    <PBtn onClick={onClose}>取消</PBtn>
                                    <PBtn primary onClick={handleStartOAuth}>
                                        開啟登入
                                    </PBtn>
                                </>
                            )}
                        </div>
                    </div>
                )}
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

const HOME_LAYOUT_OPTS: { v: Variant; t: string; d: string }[] = [
    { v: 'A', t: '預設模式', d: '小週曆 + Inbox 主視，右側課程預覽' },
    { v: 'B', t: 'Inbox 為主', d: 'Inbox 滿版主視，右側今日 + 預覽' },
    { v: 'C', t: '行事曆為主', d: '大週曆主視，右側 Inbox' },
];

const FONT_SIZE_OPTS: { value: 'small' | 'normal' | 'large'; label: string }[] = [
    { value: 'small', label: '緊湊' },
    { value: 'normal', label: '標準' },
    { value: 'large', label: '大' },
];

export function PAppearance({
    effectiveTheme,
    onToggleTheme,
}: {
    effectiveTheme: 'light' | 'dark';
    onToggleTheme: () => void;
    applyTheme: (t: 'light' | 'dark') => void;
}) {
    const { settings, update } = useAppSettings();
    const appearance = settings?.appearance || {};
    const homeLayout: Variant = (appearance.layout as Variant) || 'A';
    const homeOpt =
        HOME_LAYOUT_OPTS.find((o) => o.v === homeLayout) || HOME_LAYOUT_OPTS[0];
    const followSystem = appearance.themeMode === 'system';
    const fontSize = appearance.fontSize || 'normal';
    const fontSizeLabel =
        FONT_SIZE_OPTS.find((o) => o.value === fontSize)?.label || '標準';
    const compact = appearance.density === 'compact';

    return (
        <div>
            <PHeader
                title="介面與顯示"
                hint="主頁佈局、錄音版面、主題、AI 助教與字級。"
            />

            {/* 主頁佈局 SVG preview + 3-card switch */}
            <PHead first>主頁佈局</PHead>
            <p
                style={{
                    fontSize: 11,
                    color: 'var(--h18-text-dim)',
                    margin: '4px 0 12px',
                    lineHeight: 1.55,
                }}
            >
                切換首頁的三欄排版方式。下方預覽會即時更新，按下也會立刻套用，回到首頁就能看到。
            </p>

            <div className={s.layoutPreviewBox}>
                <div key={homeLayout} className={s.layoutPreviewInner}>
                    <LayoutPreviewSVG
                        kind="home"
                        variant={homeLayout}
                        theme={effectiveTheme}
                    />
                </div>
                <div className={s.layoutPreviewCaption}>
                    <div className={s.layoutPreviewEyebrow}>
                        預覽 · LAYOUT {homeLayout}
                    </div>
                    <div className={s.layoutPreviewTitle}>{homeOpt.t}</div>
                    <div className={s.layoutPreviewDesc}>{homeOpt.d}</div>
                </div>
            </div>

            <div className={s.layoutCards}>
                {HOME_LAYOUT_OPTS.map((opt) => (
                    <button
                        key={opt.v}
                        type="button"
                        className={`${s.layoutCard} ${homeLayout === opt.v ? s.layoutCardActive : ''}`}
                        onClick={() =>
                            update({
                                appearance: {
                                    ...(settings?.appearance || {}),
                                    layout: opt.v,
                                },
                            })
                        }
                    >
                        <span className={s.layoutCardLetter}>{opt.v}</span>
                        <span className={s.layoutCardTitle}>{opt.t}</span>
                    </button>
                ))}
            </div>

            {/* 主題 */}
            <PHead>主題</PHead>
            <PRow
                label="主題模式"
                hint={`目前：${effectiveTheme === 'dark' ? '暗色' : '明亮'}。${keymapService.getDisplayLabel('toggleTheme')} 也可即時切換。`}
                right={
                    <PSeg
                        value={effectiveTheme}
                        onChange={(v) => {
                            if (v !== effectiveTheme) onToggleTheme();
                        }}
                        options={[
                            { value: 'light', label: '☀ 亮色' },
                            { value: 'dark', label: '☾ 深色' },
                        ]}
                    />
                }
            />
            <PRow
                label="跟隨系統"
                hint="開啟後依系統 prefers-color-scheme 自動切換（appearance.themeMode = 'system'）"
                right={
                    <PToggle
                        on={followSystem}
                        onChange={(v) =>
                            update({
                                appearance: {
                                    ...appearance,
                                    themeMode: v ? 'system' : effectiveTheme,
                                },
                            })
                        }
                    />
                }
            />

            <PHead>字級 / 密度</PHead>
            <PRow
                label="基準字級"
                hint="影響 TopBar / Rail / 列表內容（preview 仍走 prose 自身字級）"
                right={
                    <PSelect
                        value={fontSizeLabel}
                        options={FONT_SIZE_OPTS.map((o) => o.label)}
                        onChange={(label) => {
                            const sel = FONT_SIZE_OPTS.find(
                                (o) => o.label === label,
                            );
                            if (!sel) return;
                            update({
                                appearance: {
                                    ...appearance,
                                    fontSize: sel.value,
                                },
                            });
                        }}
                    />
                }
            />
            <PRow
                label="緊湊模式"
                hint="開啟後 TopBar 跟列表 padding 縮一階，適合 13 吋螢幕"
                right={
                    <PToggle
                        on={compact}
                        onChange={(v) =>
                            update({
                                appearance: {
                                    ...appearance,
                                    density: v ? 'compact' : 'comfortable',
                                },
                            })
                        }
                    />
                }
            />
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PKeyboard — 鍵盤快捷鍵 (Phase 7 Sprint 3 R2 · S3a-2)
 *
 * Single source of truth for shortcut display + capture. Each row
 * shows the OS-aware label from keymapService; clicking the chip
 * enters capture mode where the next keypress is serialised via
 * `comboFromEvent` and committed through `keymapService.set`.
 *
 * Conflict handling: `set` throws if the combo collides with another
 * action, surfaced as a `toast.warning` (lazy import to avoid
 * coupling the panel to toastService at load time).
 * ════════════════════════════════════════════════════════════════ */

const ACTION_LABELS: Record<ActionId, string> = {
    search: '搜尋',
    toggleAiDock: '開關 AI 對話',
    newCourse: '新增課程',
    goHome: '回首頁',
    goProfile: '個人資料',
    toggleTheme: '切換主題',
    floatingNotes: '浮動筆記',
};

// Stable display order — matches DEFAULT_KEYMAP declaration order in
// the contract, which itself follows perceived importance.
const ACTION_ORDER: ActionId[] = [
    'search',
    'toggleAiDock',
    'newCourse',
    'goHome',
    'goProfile',
    'toggleTheme',
    'floatingNotes',
];

export function PKeyboard() {
    // Bump on subscribe to force re-render when ANY binding changes
    // (including ones outside the row currently being edited).
    const [, setVersion] = useState(0);
    const [capturing, setCapturing] = useState<ActionId | null>(null);

    useEffect(() => {
        return keymapService.subscribe(() => setVersion((v) => v + 1));
    }, []);

    const handleStartCapture = (actionId: ActionId) => {
        setCapturing(actionId);
    };

    const handleKeyDownCapture = (e: React.KeyboardEvent) => {
        if (!capturing) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
            setCapturing(null);
            return;
        }
        // Standalone modifier presses fire keydown too — wait for the
        // actual non-modifier key.
        if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return;

        const combo = comboFromEvent(e.nativeEvent);
        try {
            keymapService.set(capturing, combo);
            setCapturing(null);
        } catch (err) {
            // Conflict — surface as a non-blocking warning toast and
            // stay in capture mode so the user can try again.
            void import('../../services/toastService').then(
                ({ toastService }) => {
                    toastService.warning('快捷鍵衝突', String(err));
                },
            );
        }
    };

    const handleReset = (actionId: ActionId) => {
        keymapService.reset(actionId);
    };

    const isOverridden = (id: ActionId) =>
        keymapService.getCombo(id) !== DEFAULT_KEYMAP[id];

    return (
        <div onKeyDown={handleKeyDownCapture} tabIndex={-1}>
            <PHeader
                title="鍵盤快捷鍵"
                hint="點 chip 進入錄入模式，按下新快捷鍵組合。Esc 取消。"
            />

            <PHead first>動作綁定</PHead>
            <div className={s.kbdList}>
                {ACTION_ORDER.map((id) => (
                    <div key={id} className={s.kbdRow}>
                        <span className={s.kbdLabel}>{ACTION_LABELS[id]}</span>

                        {capturing === id ? (
                            <span className={s.kbdCapturing}>
                                按下新快捷鍵…
                            </span>
                        ) : (
                            <button
                                type="button"
                                className={s.kbdChip}
                                onClick={() => handleStartCapture(id)}
                            >
                                {keymapService.getDisplayLabel(id)}
                            </button>
                        )}

                        {isOverridden(id) && capturing !== id && (
                            <button
                                type="button"
                                className={s.kbdReset}
                                onClick={() => handleReset(id)}
                            >
                                重設
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PAudio — 音訊與字幕
 * ════════════════════════════════════════════════════════════════ */

interface AudioDevice {
    deviceId: string;
    label?: string;
}

const FONT_SIZE_OPTIONS = [
    { value: 12, label: '小' },
    { value: 16, label: '標準' },
    { value: 20, label: '大' },
    { value: 26, label: '超大' },
] as const;

export function PAudio() {
    const { settings, update } = useAppSettings();
    const sub = settings?.subtitle;
    const audioCfg = settings?.audio;

    const [devices, setDevices] = useState<AudioDevice[]>([]);
    useEffect(() => {
        let cancelled = false;
        import('../../services/audioDeviceService')
            .then(({ audioDeviceService }) => {
                const list = audioDeviceService.getDevices();
                if (!cancelled && list) setDevices(list as AudioDevice[]);
            })
            .catch(() => {
                /* swallow */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const fontSize = sub?.font_size ?? 16;
    const fontLabel =
        FONT_SIZE_OPTIONS.find((o) => o.value === fontSize)?.label || '標準';
    const bilingual = sub?.display_mode === 'both';

    const deviceLabels = devices.length > 0
        ? ['預設裝置', ...devices.map((d) => d.label || d.deviceId)]
        : ['預設裝置'];
    const currentDevice = audioCfg?.device_id
        ? (devices.find((d) => d.deviceId === audioCfg.device_id)?.label ||
              audioCfg.device_id)
        : '預設裝置';

    return (
        <div>
            <PHeader
                title="音訊與字幕"
                hint="麥克風選擇、聲道、字幕字級與雙語顯示。"
            />

            <PHead first>麥克風</PHead>
            <PRow
                label="輸入裝置"
                hint={
                    devices.length > 0
                        ? `偵測到 ${devices.length} 個輸入裝置`
                        : '尚未列舉輸入裝置（首次使用麥克風授權後出現）'
                }
                right={
                    <PSelect
                        value={currentDevice}
                        options={deviceLabels}
                        onChange={(label) => {
                            const d = devices.find(
                                (x) => (x.label || x.deviceId) === label,
                            );
                            update({
                                audio: {
                                    sample_rate: audioCfg?.sample_rate ?? 48000,
                                    chunk_duration: audioCfg?.chunk_duration ?? 5,
                                    device_id: d?.deviceId,
                                },
                            });
                        }}
                    />
                }
            />
            <PRow
                label="自動切換偵測"
                hint="移除耳機 / 關靜音時提示再次選裝置 (recordingDeviceMonitor 開關)"
                right={
                    <PToggle
                        on={audioCfg?.auto_switch_detection !== false}
                        onChange={(v) =>
                            update({
                                audio: {
                                    sample_rate: audioCfg?.sample_rate ?? 48000,
                                    chunk_duration:
                                        audioCfg?.chunk_duration ?? 5,
                                    device_id: audioCfg?.device_id,
                                    auto_switch_detection: v,
                                },
                            })
                        }
                    />
                }
            />

            <PHead>字幕外觀</PHead>
            <PRow
                label="字幕字級"
                right={
                    <PSelect
                        value={fontLabel}
                        options={FONT_SIZE_OPTIONS.map((o) => o.label)}
                        onChange={(label) => {
                            const sel = FONT_SIZE_OPTIONS.find((o) => o.label === label);
                            if (!sel) return;
                            update({
                                subtitle: {
                                    ...(sub || {
                                        font_color: '#fff',
                                        background_opacity: 0.6,
                                        position: 'bottom',
                                        display_mode: 'en',
                                    }),
                                    font_size: sel.value,
                                },
                            });
                        }}
                    />
                }
            />
            <PRow
                label="雙語字幕"
                hint="同時顯示來源 + 翻譯"
                right={
                    <PToggle
                        on={bilingual}
                        onChange={(v) =>
                            update({
                                subtitle: {
                                    ...(sub || {
                                        font_size: 16,
                                        font_color: '#fff',
                                        background_opacity: 0.6,
                                        position: 'bottom',
                                        display_mode: 'en',
                                    }),
                                    display_mode: v ? 'both' : 'en',
                                },
                            })
                        }
                    />
                }
            />
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PData — 匯入匯出 + 回收桶 (Phase 7 Sprint 3 R3 / S3f)
 *
 * 垃圾桶改成階層樹：
 *   - 同一 course 底下被 cascade 軟刪的 lectures group 在一起。
 *   - 課程本身也在垃圾桶 → 顯示「已刪課程」標籤 + course-level 還原鈕。
 *   - lecture 的 parent course 還活著 → 點 lecture 還原會直接 restore_lecture。
 *   - lecture 的 parent course 也在垃圾桶 → 點 lecture 還原前先 confirm
 *     「需要連同課程一起回復」，OK 才呼 restore_course (cascade)。
 *   - bulk: checkbox + 全選 / 還原選取 / 永久刪除選取 (後者目前不支援
 *     by-id，只能等 30 天清掃 — 標 TODO toast)。
 *
 * 對應後端 commands (cp73.0 後)：
 *   list_trashed_lectures(userId: null), list_deleted_courses(userId),
 *   restore_lecture(id), restore_course(id) → number,
 *   hard_delete_trashed_older_than(days)。
 *
 * 注意：cp73.0 沒新增 list_trashed_courses；繼續用既有的
 * list_deleted_courses(user_id) — 兩者語意一樣。先嘗試 list_trashed_courses
 * (萬一未來補上)，失敗再 fallback 到 list_deleted_courses。
 * ════════════════════════════════════════════════════════════════ */

interface CourseGroup {
    /** course 在垃圾桶 → Course；course 還活著 → null。 */
    course: Course | null;
    /** 為了顯示 fallback 標題用。 */
    courseId: string;
    lectures: Lecture[];
}

export function PData() {
    const [trashedLectures, setTrashedLectures] = useState<Lecture[]>([]);
    const [trashedCourses, setTrashedCourses] = useState<Course[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);

    const loadTrash = async () => {
        const lectures = await invoke<Lecture[]>('list_trashed_lectures', {
            userId: null,
        }).catch((err) => {
            console.warn('[PData] list_trashed_lectures failed:', err);
            return [] as Lecture[];
        });

        // cp73.0 沒新增 list_trashed_courses；既有 list_deleted_courses(user_id)
        // 同義。先嘗試新名稱（未來可能補），失敗再 fallback。
        const courses = await (async () => {
            try {
                return await invoke<Course[]>('list_trashed_courses', {
                    userId: null,
                });
            } catch {
                try {
                    return await invoke<Course[]>('list_deleted_courses', {
                        userId: 'default_user',
                    });
                } catch (err) {
                    console.warn('[PData] list_deleted_courses failed:', err);
                    return [] as Course[];
                }
            }
        })();

        setTrashedLectures(lectures || []);
        setTrashedCourses(courses || []);
    };

    useEffect(() => {
        void loadTrash();
    }, []);

    /** group lectures by course_id, attach trashed-course meta if any. */
    const groupedView = useMemo<CourseGroup[]>(() => {
        const byCourse = new Map<string, CourseGroup>();
        for (const lec of trashedLectures) {
            const key = lec.course_id;
            let g = byCourse.get(key);
            if (!g) {
                const trashedCourse =
                    trashedCourses.find((c) => c.id === key) || null;
                g = { course: trashedCourse, courseId: key, lectures: [] };
                byCourse.set(key, g);
            }
            g.lectures.push(lec);
        }
        // courses that are themselves trashed but had no trashed lectures
        for (const c of trashedCourses) {
            if (!byCourse.has(c.id)) {
                byCourse.set(c.id, {
                    course: c,
                    courseId: c.id,
                    lectures: [],
                });
            }
        }
        return Array.from(byCourse.values());
    }, [trashedLectures, trashedCourses]);

    const totalCount = trashedLectures.length + trashedCourses.length;

    const allIds = useMemo(() => {
        const ids = new Set<string>();
        trashedLectures.forEach((l) => ids.add(l.id));
        trashedCourses.forEach((c) => ids.add(c.id));
        return ids;
    }, [trashedLectures, trashedCourses]);

    const toggleSelect = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSelectAll = () => {
        // toggle: 已全選 → 清空；否則全選
        setSelected((prev) =>
            prev.size === allIds.size && allIds.size > 0
                ? new Set()
                : new Set(allIds),
        );
    };

    const handleRestoreLecture = async (lecture: Lecture) => {
        if (busy) return;
        const isCourseDead = trashedCourses.some(
            (c) => c.id === lecture.course_id,
        );

        if (isCourseDead) {
            const ok = await confirmService.ask({
                title: '需要連同課程一起回復',
                message: `「${lecture.title}」屬於已刪課程。要把整個課程跟所有課堂都救回嗎？`,
                confirmLabel: '一起回復',
                cancelLabel: '取消',
            });
            if (!ok) return;

            setBusy(true);
            try {
                const count = await invoke<number>('restore_course', {
                    id: lecture.course_id,
                    userId: authService.getUser()?.username || 'default_user',
                });
                await loadTrash();
                toastService.success(
                    '已還原',
                    `課程與 ${count ?? 0} 個課堂已還原`,
                );
                window.dispatchEvent(
                    new CustomEvent('classnote-courses-changed'),
                );
            } catch (err) {
                toastService.error('還原失敗', String(err));
            } finally {
                setBusy(false);
            }
            return;
        }

        setBusy(true);
        try {
            await invoke('restore_lecture', {
                id: lecture.id,
                userId: authService.getUser()?.username || 'default_user',
            });
            await loadTrash();
            toastService.success('已還原', `「${lecture.title}」已還原`);
        } catch (err) {
            toastService.error('還原失敗', String(err));
        } finally {
            setBusy(false);
        }
    };

    const handleRestoreCourse = async (course: Course) => {
        if (busy) return;
        setBusy(true);
        try {
            const count = await invoke<number>('restore_course', {
                id: course.id,
                userId: authService.getUser()?.username || 'default_user',
            });
            await loadTrash();
            toastService.success(
                '已還原',
                `課程「${course.title}」與 ${count ?? 0} 個課堂已還原`,
            );
            window.dispatchEvent(new CustomEvent('classnote-courses-changed'));
        } catch (err) {
            toastService.error('還原失敗', String(err));
        } finally {
            setBusy(false);
        }
    };

    const handleBulkRestore = async () => {
        if (busy || selected.size === 0) return;
        setBusy(true);
        const initialSize = selected.size;
        try {
            // Step 1: courses 先 — 它們會 cascade 把自己底下的 lectures 帶回，
            // 之後 lectures 那一步就只剩 parent-course-alive 那批。
            const courseIds = trashedCourses
                .map((c) => c.id)
                .filter((id) => selected.has(id));
            const restoredViaCourse = new Set<string>();
            for (const cid of courseIds) {
                try {
                    await invoke<number>('restore_course', {
                        id: cid,
                        userId: authService.getUser()?.username || 'default_user',
                    });
                    restoredViaCourse.add(cid);
                    // lectures whose course was just restored are now alive again
                    for (const lec of trashedLectures) {
                        if (lec.course_id === cid) {
                            restoredViaCourse.add(lec.id);
                        }
                    }
                } catch (err) {
                    console.warn(`[PData] restore_course ${cid} failed:`, err);
                }
            }

            // Step 2: lectures 還沒被 cascade 帶回的 (parent course alive)。
            const lectureIds = trashedLectures
                .map((l) => l.id)
                .filter(
                    (id) => selected.has(id) && !restoredViaCourse.has(id),
                );
            for (const lid of lectureIds) {
                try {
                    await invoke('restore_lecture', {
                        id: lid,
                        userId: authService.getUser()?.username || 'default_user',
                    });
                } catch (err) {
                    console.warn(`[PData] restore_lecture ${lid} failed:`, err);
                }
            }

            await loadTrash();
            setSelected(new Set());
            toastService.success(
                '批次還原完成',
                `${initialSize} 個項目已處理`,
            );
            window.dispatchEvent(new CustomEvent('classnote-courses-changed'));
        } finally {
            setBusy(false);
        }
    };

    const handleBulkPermanentDelete = async () => {
        // Phase 7 cp74.1: hard_delete_lectures_by_ids Tauri command 已加。
        // 課程目前沒提供獨立的 by-id 永久刪除（cascade 從課堂端帶；30 天
        // 清掃在 boot 時批次跑）。本版只處理 lecture ids，selected 集合
        // 內的 course id 跳過 + toast 提示。
        const lectureIdsToPurge: string[] = [];
        const courseIdsSkipped: string[] = [];
        for (const id of selected) {
            const isCourse = trashedCourses.some((c) => c.id === id);
            if (isCourse) courseIdsSkipped.push(id);
            else lectureIdsToPurge.push(id);
        }

        if (lectureIdsToPurge.length === 0) {
            toastService.warning(
                '沒有可永久刪除的課堂',
                '目前選取只有課程，課程的永久刪除請等 30 天清掃或先還原後再刪。',
            );
            return;
        }

        const ok = await confirmService.ask({
            title: '永久刪除選取',
            message: `${lectureIdsToPurge.length} 個課堂將被永久刪除（含字幕、摘要、索引），無法回復。${
                courseIdsSkipped.length > 0
                    ? `\n（${courseIdsSkipped.length} 個課程會略過 — 課程級永久刪除請等 30 天清掃。）`
                    : ''
            }`,
            confirmLabel: '永久刪除',
            cancelLabel: '取消',
            variant: 'danger',
        });
        if (!ok) return;

        try {
            const purged = await invoke<string[]>(
                'hard_delete_lectures_by_ids',
                {
                    ids: lectureIdsToPurge,
                    userId: authService.getUser()?.username || 'default_user',
                },
            );
            setSelected(new Set());
            await loadTrash();
            toastService.success(
                '已永久刪除',
                `${purged.length} 個課堂已從垃圾桶清除`,
            );
            window.dispatchEvent(new CustomEvent('classnote-courses-changed'));
        } catch (err) {
            toastService.error('永久刪除失敗', String(err));
        }
    };

    const handleNotImplemented = (label: string) => {
        toastService.show({
            message: `${label} 功能後端尚未實作`,
            detail:
                '前端 UI 已就緒，等對應 Tauri command (export/import/wipe) 寫好後 1 行接上。',
            type: 'warning',
        });
    };

    const handleDangerWipe = async () => {
        const ok = await confirmService.ask({
            title: '清空全部本機資料？',
            message:
                '這會刪除所有課程、課堂、字幕、筆記、AI 索引、設定。不可逆。\n\n（後端 wipe command 尚未實作，按下「確定」會出 toast 提示而非真清除。）',
            confirmLabel: '我了解，繼續',
            variant: 'danger',
        });
        if (!ok) return;
        handleNotImplemented('清空全部');
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
                hint="把所有 course / lecture / note 打包成一個 .zip（後端命令尚未實作）"
                right={
                    <PBtn onClick={() => handleNotImplemented('匯出 backup')}>
                        匯出
                    </PBtn>
                }
            />
            <PRow
                label="匯入 backup"
                hint="從 .zip 還原，merge 現有資料，重複 id 跳過（後端命令尚未實作）"
                right={
                    <PBtn onClick={() => handleNotImplemented('匯入 backup')}>
                        選擇檔案
                    </PBtn>
                }
            />

            <PHead>回收桶</PHead>
            <PRow
                label={`垃圾桶 · ${totalCount}`}
                hint="刪除後的課程與課堂暫存於此，30 天後自動清空。已刪課程底下的課堂會一起列出，可以選擇單獨救回課堂或連課程一起回復。"
            >
                {totalCount === 0 ? (
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
                    <>
                        {/* bulk action bar */}
                        <div
                            style={{
                                marginTop: 8,
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                                flexWrap: 'wrap',
                            }}
                        >
                            <PBtn onClick={handleSelectAll}>
                                {selected.size > 0
                                    ? `已選 ${selected.size} / ${allIds.size}`
                                    : '全選'}
                            </PBtn>
                            {selected.size > 0 && (
                                <>
                                    <PBtn
                                        primary
                                        disabled={busy}
                                        onClick={handleBulkRestore}
                                    >
                                        還原選取
                                    </PBtn>
                                    <PBtn
                                        danger
                                        disabled={busy}
                                        onClick={handleBulkPermanentDelete}
                                    >
                                        永久刪除選取
                                    </PBtn>
                                </>
                            )}
                        </div>

                        <div
                            className={s.trashList}
                            style={{ marginTop: 10, gap: 8 }}
                        >
                            {groupedView.map((g) => (
                                <div
                                    key={g.courseId}
                                    style={{
                                        border: '1px solid var(--h18-border-soft)',
                                        borderRadius: 8,
                                        padding: 8,
                                        background: 'var(--h18-surface2)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 4,
                                    }}
                                >
                                    {/* course header row */}
                                    {g.course ? (
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    'auto 1fr auto auto',
                                                gap: 10,
                                                alignItems: 'center',
                                                fontSize: 12,
                                                padding: '4px 6px',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selected.has(g.course.id)}
                                                onChange={() =>
                                                    toggleSelect(g.course!.id)
                                                }
                                                aria-label={`選取課程 ${g.course.title}`}
                                            />
                                            <span
                                                style={{
                                                    color: 'var(--h18-text)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {g.course.title}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    padding: '2px 6px',
                                                    borderRadius: 999,
                                                    background:
                                                        'var(--h18-hot-bg, rgba(255,80,80,0.15))',
                                                    color: 'var(--h18-hot, #ff8080)',
                                                }}
                                            >
                                                已刪課程
                                            </span>
                                            <PBtn
                                                disabled={busy}
                                                onClick={() =>
                                                    handleRestoreCourse(
                                                        g.course!,
                                                    )
                                                }
                                            >
                                                還原
                                            </PBtn>
                                        </div>
                                    ) : (
                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    '1fr auto',
                                                gap: 10,
                                                alignItems: 'center',
                                                fontSize: 11,
                                                color: 'var(--h18-text-dim)',
                                                padding: '2px 6px',
                                            }}
                                        >
                                            <span
                                                style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                課程：{g.courseId}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    padding: '2px 6px',
                                                    borderRadius: 999,
                                                    background:
                                                        'var(--h18-surface3, rgba(255,255,255,0.04))',
                                                    color: 'var(--h18-text-dim)',
                                                }}
                                            >
                                                課程仍存活
                                            </span>
                                        </div>
                                    )}

                                    {/* lecture children */}
                                    {g.lectures.map((lec) => (
                                        <div
                                            key={lec.id}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    'auto 1fr auto auto',
                                                gap: 10,
                                                alignItems: 'center',
                                                fontSize: 12,
                                                padding: '4px 6px 4px 22px',
                                                borderTop:
                                                    '1px dashed var(--h18-border-soft)',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selected.has(lec.id)}
                                                onChange={() =>
                                                    toggleSelect(lec.id)
                                                }
                                                aria-label={`選取課堂 ${lec.title}`}
                                            />
                                            <span
                                                className={s.trashTitle}
                                                style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {lec.title}
                                            </span>
                                            <span className={s.trashMeta}>
                                                {lec.date?.slice(0, 10) || '—'}
                                            </span>
                                            <PBtn
                                                disabled={busy}
                                                onClick={() =>
                                                    handleRestoreLecture(lec)
                                                }
                                            >
                                                還原
                                            </PBtn>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </PRow>

            <PHead>危險區</PHead>
            <PRow
                label="清空全部本機資料"
                hint="刪除所有 course / lecture / note / 字幕 / RAG index / 設定。不可逆。"
                right={
                    <PBtn danger onClick={handleDangerWipe}>
                        清空…
                    </PBtn>
                }
            />
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PIntegrations — 第三方平台整合 (Canvas 等)
 * ════════════════════════════════════════════════════════════════ */

export function PIntegrations() {
    const { settings, update } = useAppSettings();
    const calendarRss =
        settings?.integrations?.canvas?.calendar_rss ?? '';
    const integrations = settings?.integrations || {};
    const canvas = integrations.canvas || {};
    const ignoredCourseIds = canvas.ignored_course_ids || [];

    const [pairingState, setPairingState] = useState<{
        canvasCourses: { canvasCourseId: string; fullTitle: string }[];
        localCourses: Course[];
    } | null>(null);
    const [pairingError, setPairingError] = useState<string | null>(null);
    const [pairingBusy, setPairingBusy] = useState(false);

    const handleOpenPairing = async () => {
        if (!calendarRss.trim()) {
            setPairingError('請先填 Calendar URL。');
            return;
        }
        setPairingBusy(true);
        setPairingError(null);
        try {
            const feed = await fetchCalendarFeed(calendarRss.trim());
            saveCanvasCache('calendar:global', feed);
            const localCourses = await storageService.listCourses();
            setPairingState({
                canvasCourses: feed.courses,
                localCourses,
            });
        } catch (err) {
            console.error('[PIntegrations] fetch calendar failed:', err);
            setPairingError(
                (err as Error)?.message || '抓 Canvas 行事曆失敗 — 確認 URL 跟網路。',
            );
        } finally {
            setPairingBusy(false);
        }
    };

    const handleCommit = async (changes: PairingChanges) => {
        // 1. Pair existing local courses → write canvas_course_id
        for (const p of changes.pairExisting) {
            const c = pairingState?.localCourses.find((x) => x.id === p.localCourseId);
            if (!c) continue;
            await storageService.saveCourse({
                ...c,
                canvas_course_id: p.canvasCourseId,
                updated_at: new Date().toISOString(),
            });
        }
        // 2. Create new local courses (light — just title + canvas_course_id)
        for (const n of changes.createNew) {
            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            await storageService.saveCourse({
                id,
                user_id: '',
                title: n.title,
                canvas_course_id: n.canvasCourseId,
                created_at: now,
                updated_at: now,
            });
        }
        // 3. Append to ignored list
        if (changes.ignore.length > 0) {
            const merged = [...new Set([...ignoredCourseIds, ...changes.ignore])];
            await update({
                integrations: {
                    ...integrations,
                    canvas: { ...canvas, ignored_course_ids: merged },
                },
            });
        }
    };

    return (
        <div>
            <PHeader
                title="整合"
                hint="把 Canvas 等 LMS 平台的 feed 接進來，App 會在課程預覽顯示提醒。"
            />

            <PHead first>Canvas</PHead>
            <PRow
                label="Calendar RSS (全域)"
                hint={
                    <>
                        Canvas 帳號底下**所有課程**的事件 / 截止日，是 per-user 一條 URL。
                        <br />
                        到 Canvas → Calendar 頁右下角點「Calendar Feed」即可取得。
                        <br />
                        填好後按右側「⇄ 配對課程」配對 Canvas 課程到本機。
                    </>
                }
                right={
                    <PInput
                        placeholder="https://canvas.example.edu/feeds/calendars/user_xxx.ics"
                        value={calendarRss}
                        onChange={(v) =>
                            update({
                                integrations: {
                                    ...integrations,
                                    canvas: { ...canvas, calendar_rss: v.trim() || undefined },
                                },
                            })
                        }
                        monospace
                        wide
                    />
                }
            />
            <PRow
                label="配對 Canvas 課程"
                hint={
                    pairingError ? (
                        <span style={{ color: 'var(--h18-hot)' }}>⚠ {pairingError}</span>
                    ) : ignoredCourseIds.length > 0 ? (
                        `已忽略 ${ignoredCourseIds.length} 門課；重新配對可在 wizard 裡取消忽略。`
                    ) : (
                        '抓一次行事曆，列出所有 Canvas 課讓你決定要對應、新建還是忽略。'
                    )
                }
                right={
                    <PBtn
                        primary
                        disabled={!calendarRss.trim() || pairingBusy}
                        onClick={handleOpenPairing}
                    >
                        {pairingBusy ? '抓取中…' : '⇄ 配對課程'}
                    </PBtn>
                }
            />

            <PHead>每門課的設定</PHead>
            <p style={{ fontSize: 11, color: 'var(--h18-text-dim)', lineHeight: 1.7, marginTop: 6 }}>
                Canvas 的「課程公告 RSS」是 per-course 的，每門課自己的 announcements feed 不一樣。
                請到該課程的「課程編輯」頁底下「Canvas 公告」卡片填入。
            </p>

            {pairingState && (
                <CanvasPairingWizard
                    canvasCourses={pairingState.canvasCourses}
                    localCourses={pairingState.localCourses}
                    ignoredCourseIds={ignoredCourseIds}
                    onClose={() => setPairingState(null)}
                    onCommit={handleCommit}
                />
            )}
        </div>
    );
}

/* ════════════════════════════════════════════════════════════════
 * PAbout — 關於與更新
 * ════════════════════════════════════════════════════════════════ */

export function PAbout() {
    const { settings, update } = useAppSettings();
    const updates = settings?.updates;
    const [version, setVersion] = useState<string>('—');
    const [systemInfo, setSystemInfo] = useState<string>('—');
    const [updateState, setUpdateState] = useState<{
        kind: 'idle' | 'checking' | 'available' | 'latest' | 'error';
        version?: string;
        message?: string;
    }>({ kind: 'idle' });

    useEffect(() => {
        import('@tauri-apps/api/app')
            .then(({ getVersion }) => getVersion())
            .then((v) => setVersion(v))
            .catch(() => {});
        // System info (best effort from navigator)
        try {
            const ua = navigator.userAgent;
            const platform =
                /Windows NT ([\d.]+)/.exec(ua)?.[0] ||
                /Mac OS X ([\d_]+)/.exec(ua)?.[0]?.replace(/_/g, '.') ||
                /Linux/.exec(ua)?.[0] ||
                'Unknown OS';
            const arch = /x64|arm64|aarch64|x86_64/.exec(ua)?.[0] || '';
            setSystemInfo(`${platform}${arch ? ' · ' + arch : ''}`);
        } catch {
            /* swallow */
        }
    }, []);

    const handleCheckUpdate = async () => {
        setUpdateState({ kind: 'checking' });
        try {
            const { updateService } = await import('../../services/updateService');
            const result = await updateService.checkForUpdates();
            if (result.available) {
                setUpdateState({
                    kind: 'available',
                    version: result.version,
                });
            } else {
                setUpdateState({ kind: 'latest' });
            }
        } catch (err) {
            setUpdateState({
                kind: 'error',
                message: (err as Error)?.message || '未知錯誤',
            });
        }
    };

    const handleOpenFolder = async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const audioDir = await invoke<string>('get_audio_dir');
            const { openPath } = await import('@tauri-apps/plugin-opener');
            const parentDir = audioDir.replace(/[\\/]audio[\\/]?$/, '');
            await openPath(parentDir || audioDir);
        } catch (err) {
            console.warn('[PAbout] open folder failed:', err);
        }
    };

    const handleOpenGitHub = async () => {
        try {
            const { openUrl } = await import('@tauri-apps/plugin-opener');
            await openUrl('https://github.com/sklonely/ClassNoteAI');
        } catch (err) {
            console.warn('[PAbout] open github failed:', err);
        }
    };

    const handleOpenDevTools = async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('open_devtools').catch(() => {});
        } catch {
            /* swallow */
        }
    };

    const handleResetSetup = async () => {
        const { confirmService } = await import(
            '../../services/confirmService'
        );
        const ok = await confirmService.ask({
            title: '重新執行 Setup Wizard？',
            message:
                '這會清掉「setup 已完成」的標記，下次啟動時會重新跑環境檢查 + 模型下載精靈。已下載的模型不會被刪除。',
            confirmLabel: '重置並關閉',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            const { setupService } = await import(
                '../../services/setupService'
            );
            await setupService.resetStatus();
            const { toastService } = await import(
                '../../services/toastService'
            );
            toastService.show({
                message: 'Setup 標記已清除',
                detail: '請手動關閉並重新開啟 App，會自動進入 Setup Wizard。',
                type: 'success',
                durationMs: 0,
            });
        } catch (err) {
            console.warn('[PAbout] resetStatus failed:', err);
            const { toastService } = await import(
                '../../services/toastService'
            );
            toastService.show({
                message: '重置失敗',
                detail: (err as Error)?.message || '未知錯誤',
                type: 'error',
            });
        }
    };

    return (
        <div>
            <PHeader title="關於與更新" />

            {/* Hero update card — 對應 prototype L2934 */}
            <div className={s.aboutHero}>
                <div className={s.aboutHeroBadge}>C</div>
                <div className={s.aboutHeroBody}>
                    <h2 className={s.aboutHeroTitle}>ClassNote AI</h2>
                    <div className={s.aboutHeroVersion}>
                        v{version} · build {new Date().toISOString().slice(0, 10)} ·
                        Tauri 2
                    </div>
                    <div className={s.aboutHeroSystem}>{systemInfo}</div>
                </div>
                <button
                    type="button"
                    onClick={handleCheckUpdate}
                    disabled={updateState.kind === 'checking'}
                    className={s.aboutHeroBtn}
                >
                    {updateState.kind === 'checking' ? '檢查中…' : '檢查更新'}
                </button>
            </div>

            {/* Update status banner — only render when we have a result */}
            {updateState.kind === 'available' && (
                <div className={s.aboutUpdateBanner}>
                    <span className={s.aboutUpdateBannerIcon}>✦</span>
                    <span className={s.aboutUpdateBannerLabel}>
                        NEW v{updateState.version}
                    </span>
                    <span>有新版本可下載</span>
                    <div className={s.aboutUpdateBannerSpacer} />
                    <PBtn primary>下載</PBtn>
                </div>
            )}
            {updateState.kind === 'latest' && (
                <div className={s.aboutUpdateBanner}>
                    <span className={s.aboutUpdateBannerIcon}>✓</span>
                    <span className={s.aboutUpdateBannerLabel}>UP TO DATE</span>
                    <span>已是最新版本</span>
                </div>
            )}
            {updateState.kind === 'error' && (
                <div
                    className={s.aboutUpdateBanner}
                    style={{
                        borderColor: 'var(--h18-hot)',
                        background: 'var(--h18-hot-bg)',
                    }}
                >
                    <span className={s.aboutUpdateBannerIcon}>⚠</span>
                    <span style={{ color: 'var(--h18-hot)' }}>
                        檢查失敗：{updateState.message}
                    </span>
                </div>
            )}

            <PHead>更新</PHead>
            <PRow
                label="更新通道"
                hint="Beta 每週更新；Alpha 含 prerelease。切換後下次「檢查更新」會用新通道。"
                right={
                    <PSelect
                        value={updates?.channel || 'stable'}
                        options={['stable', 'beta', 'alpha']}
                        onChange={(v) =>
                            update({
                                updates: {
                                    ...(updates || {}),
                                    channel: v as 'stable' | 'beta' | 'alpha',
                                },
                            })
                        }
                    />
                }
            />
            <PRow
                label="自動下載更新"
                hint="背景下載，準備好後在這裡通知"
                right={
                    <PToggle
                        on={updates?.autoDownload !== false}
                        onChange={(v) =>
                            update({
                                updates: { ...(updates || {}), autoDownload: v },
                            })
                        }
                    />
                }
            />
            <PRow
                label="自動安裝（重啟時）"
                hint="關閉 app 時自動安裝下載好的更新"
                right={
                    <PToggle
                        on={updates?.autoInstall === true}
                        onChange={(v) =>
                            update({
                                updates: { ...(updates || {}), autoInstall: v },
                            })
                        }
                    />
                }
            />

            <PHead>診斷</PHead>
            <PRow
                label="開啟 app data 資料夾"
                hint="包含 audio / pdf / RAG index / 設定檔"
                right={<PBtn onClick={handleOpenFolder}>開啟</PBtn>}
            />
            <PRow
                label="DevTools"
                hint="WebView2 開發者工具（除錯用）"
                right={<PBtn onClick={handleOpenDevTools}>開啟</PBtn>}
            />
            <PRow
                label="重新執行 Setup Wizard"
                hint="重新走一次首次啟動的環境檢查與模型下載流程"
                right={
                    <PBtn danger onClick={handleResetSetup}>
                        重置
                    </PBtn>
                }
            />

            <PHead>連結</PHead>
            <PRow
                label="GitHub"
                hint="原始碼、issues、release notes"
                right={<PBtn onClick={handleOpenGitHub}>前往</PBtn>}
            />
            <PRow
                label="使用者指南"
                hint="基本操作 / FAQ / 鍵盤快捷鍵 — 尚無 docs URL，等網站上線後接"
                right={<PBtn disabled>留白</PBtn>}
            />
        </div>
    );
}
