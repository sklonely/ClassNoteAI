/**
 * Setup Wizard Component
 * 
 * First-run setup wizard for detecting and installing dependencies.
 */

import { useState, useCallback } from 'react';
import {
    CheckCircle,
    XCircle,
    AlertTriangle,
    Download,
    Loader2,
    ArrowRight,
    RefreshCw,
    Zap,
    Mic,
    Languages,
    HardDrive
} from 'lucide-react';
import { setupService } from '../services/setupService';
import AIProviderSettings from './AIProviderSettings';
import {
    SetupStatus,
    Requirement,
    Progress,
    isInstalled,
    isOutdated,
    isError,
    getProgressPercentage
} from '../types/setup';
import './SetupWizard.css';

interface SetupWizardProps {
    onComplete: () => void;
}

type WizardStep =
    | 'welcome'
    | 'language'
    | 'ai-provider'   // v0.5.2: pick GitHub Models vs ChatGPT (or skip)
    | 'ai-config'     // v0.5.2: configure the chosen provider (PAT / OAuth)
    | 'checking'
    | 'gpu-check'     // v0.6.1: detect NVIDIA/Vulkan/Metal + save preference
    | 'review'
    | 'installing'
    | 'complete';

interface GpuDetection {
    cuda: { gpu_name: string; driver_version: string } | null;
    metal: boolean;
    vulkan: boolean;
    effective: string;
}

type SourceLang = 'auto' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'zh-TW' | 'zh-CN';

export default function SetupWizard({ onComplete }: SetupWizardProps) {
    const [step, setStep] = useState<WizardStep>('welcome');
    const [status, setStatus] = useState<SetupStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [includeOptional, setIncludeOptional] = useState(false);
    const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
    const [isInstalling, setIsInstalling] = useState(false);

    // v0.5.1: first-run language pair. Persisted to AppSettings at the
    // end of the language step so transcriptionService picks it up when
    // the user eventually starts a lecture.
    const [sourceLang, setSourceLang] = useState<SourceLang>('auto');
    const [targetLang, setTargetLang] = useState<string>('zh-TW');
    // v0.5.2: wizard LLM steps. `selectedProviderId` is null on ai-provider
    // until the user picks a card; once set, we advance to ai-config and
    // pass it as `forceProviderId` to AIProviderSettings so the user only
    // sees the picked provider's config form (not both). Splitting these
    // into two steps was a review fix — the combined step overflowed the
    // wizard container and the "Continue" button got clipped off-screen.
    const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

    // v0.6.1: GPU backend detection state for the `gpu-check` step.
    const [gpuDetection, setGpuDetection] = useState<GpuDetection | null>(null);

    // Check requirements when entering checking step. v0.6.1: after
    // the env check we insert `gpu-check` so users see their hardware
    // story (CUDA / Vulkan / Metal / CPU) before committing to a
    // multi-GB model download — avoids the "why is this so slow?"
    // surprise post-install.
    const checkRequirements = useCallback(async () => {
        setStep('checking');
        setError(null);

        try {
            const setupStatus = await setupService.checkStatus();
            setStatus(setupStatus);
            // Kick off GPU detection in parallel with the env check so
            // the gpu-check step has data ready when we transition.
            // Swallow errors: older binaries missing the command just
            // skip the GPU step content gracefully.
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const d = await invoke<GpuDetection>('detect_gpu_backends', {
                    preference: 'auto',
                });
                setGpuDetection(d);
            } catch {
                /* detection unavailable — step still renders a CPU fallback notice */
            }

            // If everything is already installed, skip past review
            // but still show the GPU summary so the user knows what
            // backend they're on.
            if (setupStatus.is_complete) {
                setStep('gpu-check');
            } else {
                setStep('gpu-check');
            }
        } catch (err) {
            setError(`環境檢查失敗: ${err}`);
            setStep('review');
        }
    }, []);

    const continueFromGpuCheck = useCallback(async () => {
        // Persist the auto preference so the ImportModal / settings
        // both pick it up on first open. User can override in settings.
        try {
            const { storageService } = await import('../services/storageService');
            const existing = (await storageService.getAppSettings()) ?? {} as any;
            await storageService.saveAppSettings({
                ...existing,
                experimental: {
                    ...(existing.experimental ?? {}),
                    asrBackend: 'auto',
                },
            });
        } catch {
            /* non-fatal; settings can be set later */
        }
        if (status?.is_complete) {
            await setupService.markComplete();
            setStep('complete');
        } else {
            setStep('review');
        }
    }, [status]);

    // Start installation
    const startInstallation = useCallback(async () => {
        if (!status) return;

        setStep('installing');
        setIsInstalling(true);
        setError(null);

        // Get IDs of requirements to install
        const idsToInstall = setupService.getAllMissingIds(status, includeOptional);

        // Initialize progress for all tasks
        const initialProgress: Record<string, Progress> = {};
        idsToInstall.forEach(id => {
            const req = status.requirements.find(r => r.id === id);
            initialProgress[id] = {
                task_id: id,
                task_name: req?.name || id,
                status: 'Pending',
                current: 0,
                total: 100,
                speed_bps: null,
                eta_seconds: null,
                message: null
            };
        });
        setProgressMap(initialProgress);

        // Listen for progress updates
        const unlisten = await setupService.onProgress((progress) => {
            setProgressMap(prev => ({
                ...prev,
                [progress.task_id]: progress
            }));
        });

        try {
            await setupService.startInstallation(idsToInstall);
            await setupService.markComplete();
            setStep('complete');
        } catch (err) {
            setError(`安裝失敗: ${err}`);
        } finally {
            setIsInstalling(false);
            unlisten();
        }
    }, [status, includeOptional]);

    // Cancel installation
    const cancelInstallation = useCallback(async () => {
        try {
            await setupService.cancelInstallation();
            setIsInstalling(false);
            setStep('review');
        } catch (err) {
            console.error('Failed to cancel:', err);
        }
    }, []);

    // Get icon for requirement category
    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'System':
                return <HardDrive className="w-5 h-5" />;
            case 'Model':
                return <Zap className="w-5 h-5" />;
            default:
                return <Zap className="w-5 h-5" />;
        }
    };

    // Get status icon for requirement
    const getStatusIcon = (req: Requirement) => {
        if (isInstalled(req.status)) {
            return <CheckCircle className="w-5 h-5 text-green-500" />;
        }
        if (isOutdated(req.status)) {
            return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
        }
        if (isError(req.status)) {
            return <XCircle className="w-5 h-5 text-red-500" />;
        }
        // Not installed
        if (req.is_optional) {
            return <AlertTriangle className="w-5 h-5 text-gray-400" />;
        }
        return <XCircle className="w-5 h-5 text-red-500" />;
    };

    // Render welcome step
    const renderWelcome = () => (
        <div className="setup-step welcome-step">
            <div className="setup-icon-container">
                <div className="setup-icon">
                    <Languages className="w-16 h-16 text-blue-500" />
                </div>
            </div>

            <h1 className="setup-title">歡迎使用 ClassNoteAI</h1>
            <p className="setup-description">
                智能課堂筆記助手，支援即時語音轉錄、自動翻譯與 AI 摘要
            </p>

            <div className="feature-cards">
                <div className="feature-card">
                    <Mic className="feature-icon" />
                    <h3>語音轉錄</h3>
                    <p>使用 Whisper AI 即時轉錄課堂內容</p>
                </div>
                <div className="feature-card">
                    <Languages className="feature-icon" />
                    <h3>自動翻譯</h3>
                    <p>本地 AI 翻譯，無需網路連線</p>
                </div>
                <div className="feature-card">
                    <Zap className="feature-icon" />
                    <h3>智能摘要</h3>
                    <p>AI 生成課堂重點與筆記</p>
                </div>
            </div>

            <p className="setup-note">
                首次使用需要下載必要的 AI 模型，請確保網路連線穩定。
            </p>

            <button className="setup-button primary" onClick={() => setStep('language')}>
                開始設置 <ArrowRight className="w-5 h-5" />
            </button>
        </div>
    );

    // Render language step (v0.5.1)
    const renderLanguage = () => (
        <div className="setup-step welcome-step">
            <div className="setup-icon-container">
                <div className="setup-icon">
                    <Languages className="w-16 h-16 text-green-500" />
                </div>
            </div>

            <h2 className="setup-subtitle">選擇語言</h2>
            <p className="setup-description">
                設定課堂的講者語言（來源）和你想看到的翻譯語言（目標）。
                之後隨時可以在「設定 → 轉錄與翻譯」修改。
            </p>

            {/* v0.5.2 styling fix: the prior inline `background: 'white'`
                + no explicit `color` produced white-on-white selected text
                in the dark-themed wizard. Switch to a dark-native styled
                select so the chosen option is actually visible. */}
            <div className="w-full max-w-md mx-auto mt-6 mb-4 flex flex-col gap-4 text-left">
                <label className="block">
                    <span className="block text-sm font-medium mb-1.5 text-white/90">
                        講者語言（來源）
                    </span>
                    <select
                        value={sourceLang}
                        onChange={(e) => setSourceLang(e.target.value as SourceLang)}
                        className="w-full px-3 py-2.5 rounded-lg border border-white/20 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="auto">自動偵測（推薦）</option>
                        <option value="en">English</option>
                        <option value="ja">日本語 (Japanese)</option>
                        <option value="ko">한국어 (Korean)</option>
                        <option value="fr">Français (French)</option>
                        <option value="de">Deutsch (German)</option>
                        <option value="es">Español (Spanish)</option>
                        <option value="zh-TW">繁體中文</option>
                        <option value="zh-CN">簡體中文</option>
                    </select>
                </label>

                <label className="block">
                    <span className="block text-sm font-medium mb-1.5 text-white/90">
                        目標語言
                    </span>
                    <select
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-white/20 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="zh-TW">繁體中文 (Traditional Chinese)</option>
                        <option value="zh-CN">簡體中文 (Simplified Chinese)</option>
                        <option value="en">English</option>
                        <option value="ja">日本語 (Japanese)</option>
                        <option value="ko">한국어 (Korean)</option>
                    </select>
                </label>
            </div>

            <button
                className="setup-button primary"
                onClick={async () => {
                    // Persist the pair to AppSettings before moving on so
                    // transcriptionService reads it when a lecture starts.
                    try {
                        const { storageService } = await import('../services/storageService');
                        const existing = (await storageService.getAppSettings()) || ({} as any);
                        await storageService.saveAppSettings({
                            ...existing,
                            translation: {
                                ...(existing.translation || {}),
                                source_language: sourceLang,
                                target_language: targetLang,
                            },
                        });
                    } catch (e) {
                        console.warn('[SetupWizard] Could not persist language pair:', e);
                    }
                    // v0.5.2: route to the AI provider-pick step next, not
                    // straight into environment checks. Users can still
                    // skip AI config there.
                    setStep('ai-provider');
                }}
            >
                繼續 <ArrowRight className="w-5 h-5" />
            </button>
        </div>
    );

    // v0.5.2: LLM provider PICK step.
    //
    // Kept deliberately minimal — two big cards (GitHub Models, ChatGPT
    // OAuth) + a Skip button — so the wizard viewport isn't crowded and
    // the Continue button always stays visible. Picking a card advances
    // to the `ai-config` step where the actual PAT input / OAuth flow
    // lives, filtered to JUST the picked provider.
    //
    // Review context: combining pick + config on one step caused the
    // Save/Test buttons and the wizard's own "Continue" button to fall
    // below the 700 px-max-width container's viewport — users couldn't
    // even finish the step they'd already completed.
    const renderAIProvider = () => {
        const PROVIDERS = [
            {
                id: 'github-models',
                title: 'GitHub Models',
                tagline: '使用你的 GitHub PAT（Copilot Pro / Business / Enterprise 訂閱包含額度）',
                caveat: '需要 scope: models:read 的 fine-grained token',
            },
            {
                id: 'chatgpt-oauth',
                title: 'ChatGPT Subscription',
                tagline: '用你的 ChatGPT Plus / Pro / Enterprise 帳號登入（非官方管道 — Codex 流程）',
                caveat: '第一次登入會開一個瀏覽器 OAuth 視窗',
            },
        ];

        return (
            <div className="setup-step welcome-step">
                <div className="setup-icon-container">
                    <div className="setup-icon">
                        <Zap className="w-16 h-16 text-purple-500" />
                    </div>
                </div>
                <h2 className="setup-subtitle">選擇 AI 服務提供商（可選）</h2>
                <p className="setup-description">
                    AI 助教問答、自動摘要、關鍵字提取、字幕精修、跨語言 RAG 檢索 都需要雲端 LLM。<br />
                    <strong>可以先跳過</strong>，之後在「設定 → 雲端 AI 助理」也能配置。
                </p>

                <div className="w-full max-w-md mx-auto my-4 flex flex-col gap-3 text-left">
                    {PROVIDERS.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => {
                                setSelectedProviderId(p.id);
                                setStep('ai-config');
                            }}
                            className="group p-4 rounded-lg border border-white/20 bg-white/5 hover:bg-white/10 hover:border-blue-400 transition-colors text-left"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-white">{p.title}</div>
                                    <div className="text-xs text-white/60 mt-1">{p.tagline}</div>
                                    <div className="text-[11px] text-white/40 mt-1">{p.caveat}</div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-white/50 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-transform flex-shrink-0 mt-1" />
                            </div>
                        </button>
                    ))}
                </div>

                <div className="setup-actions">
                    <button
                        className="setup-button secondary"
                        onClick={async () => {
                            // Skip — still check requirements so the
                            // rest of the wizard runs. User can come
                            // back via Settings → 雲端 AI 助理.
                            await checkRequirements();
                        }}
                    >
                        跳過此步驟 <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    };

    // v0.5.2: LLM provider CONFIG step.
    //
    // Renders `AIProviderSettings` filtered to the single provider the
    // user picked on the prior step. All the existing PAT save / OAuth
    // sign-in / test-connection logic is reused — we just hide the
    // cross-provider picker row. User can hit "返回" to reselect or
    // "下一步" to advance to environment checks (requirements download).
    const renderAIConfig = () => (
        <div className="setup-step welcome-step">
            <div className="setup-icon-container">
                <div className="setup-icon">
                    <Zap className="w-16 h-16 text-purple-500" />
                </div>
            </div>
            <h2 className="setup-subtitle">
                設定 {selectedProviderId === 'chatgpt-oauth' ? 'ChatGPT' : 'GitHub Models'}
            </h2>
            <p className="setup-description">
                填入 token 或登入 OAuth 後，點「下一步」繼續。
            </p>

            <div className="w-full max-w-lg mx-auto my-4 text-left">
                {selectedProviderId && <AIProviderSettings forceProviderId={selectedProviderId} />}
            </div>

            <div className="setup-actions">
                <button
                    className="setup-button secondary"
                    onClick={() => {
                        setSelectedProviderId(null);
                        setStep('ai-provider');
                    }}
                >
                    返回
                </button>
                <button
                    className="setup-button primary"
                    onClick={async () => {
                        // Advance regardless of whether the user saved
                        // credentials or not — the `configured` / ✓ badge
                        // on the provider form already tells the user
                        // their state. A conditional label here was just
                        // noise (and was also buggy: state was only
                        // polled after click, so a successful config
                        // still showed "先不管、繼續").
                        await checkRequirements();
                    }}
                >
                    繼續 <ArrowRight className="w-5 h-5" />
                </button>
            </div>
        </div>
    );

    // Render checking step
    const renderChecking = () => (
        <div className="setup-step checking-step">
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
            <h2 className="setup-subtitle">正在檢查系統環境...</h2>
            <p className="setup-description">請稍候，正在檢測必要的依賴項目</p>
        </div>
    );

    // v0.6.1: GPU-check step. Reuses the same `requirements-list` /
    // `requirement-item` classes as the env-check step for visual
    // consistency with the rest of the wizard (dark translucent cards
    // on the gradient background). Previously used ad-hoc white
    // cards that looked out of place.
    const renderGpuCheck = () => {
        const rows: { ok: boolean; label: string; detail: string }[] = gpuDetection
            ? [
                  {
                      ok: !!gpuDetection.cuda,
                      label: 'CUDA (NVIDIA)',
                      detail: gpuDetection.cuda
                          ? `${gpuDetection.cuda.gpu_name} · driver ${gpuDetection.cuda.driver_version}`
                          : '未偵測到 NVIDIA 驅動',
                  },
                  {
                      ok: gpuDetection.vulkan,
                      label: 'Vulkan',
                      detail: gpuDetection.vulkan
                          ? 'Vulkan loader 已存在'
                          : '未偵測到 Vulkan runtime',
                  },
                  {
                      ok: gpuDetection.metal,
                      label: 'Metal (macOS)',
                      detail: gpuDetection.metal ? '原生支援' : '不適用此系統',
                  },
              ]
            : [];
        return (
            <div className="setup-step review-step">
                <h2 className="setup-subtitle">硬體加速偵測</h2>
                <p className="setup-description">可用的 Whisper 加速後端</p>

                <div className="requirements-list">
                    {rows.map((r) => (
                        <div
                            key={r.label}
                            className={`requirement-item ${r.ok ? 'installed' : 'missing'}`}
                        >
                            <div className="requirement-info">
                                {r.ok ? (
                                    <CheckCircle className="w-5 h-5" style={{ color: '#22c55e' }} />
                                ) : (
                                    <XCircle className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                                )}
                                <div className="requirement-details">
                                    <span className="requirement-name">{r.label}</span>
                                    <span className="requirement-desc">{r.detail}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        className="btn-primary"
                        onClick={continueFromGpuCheck}
                    >
                        繼續 <ArrowRight className="w-5 h-5" />
                    </button>
                </div>
            </div>
        );
    };

    // Render review step
    const renderReview = () => {
        if (!status) return null;

        const missingRequired = setupService.getMissingRequirements(status);
        const missingOptional = setupService.getOptionalMissing(status);
        const allInstalled = missingRequired.length === 0;

        return (
            <div className="setup-step review-step">
                <h2 className="setup-subtitle">環境檢查結果</h2>

                {error && (
                    <div className="setup-error">
                        <XCircle className="w-5 h-5" />
                        {error}
                    </div>
                )}

                <div className="requirements-list">
                    {status.requirements.map(req => (
                        <div
                            key={req.id}
                            className={`requirement-item ${isInstalled(req.status) ? 'installed' : 'missing'}`}
                        >
                            <div className="requirement-info">
                                {getCategoryIcon(req.category)}
                                <div className="requirement-details">
                                    <span className="requirement-name">
                                        {req.name}
                                        {req.is_optional && <span className="optional-badge">可選</span>}
                                    </span>
                                    <span className="requirement-desc">{req.description}</span>
                                </div>
                            </div>
                            <div className="requirement-status">
                                {getStatusIcon(req)}
                                {!isInstalled(req.status) && req.install_size_mb > 0 && (
                                    <span className="requirement-size">~{req.install_size_mb}MB</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {missingRequired.length > 0 && (
                    <div className="install-summary">
                        <p>
                            需要安裝 <strong>{missingRequired.length}</strong> 個必要項目
                            {missingOptional.length > 0 && `，${missingOptional.length} 個可選項目`}
                        </p>
                        <p className="install-estimate">
                            總計約 {status.total_download_size_mb}MB，
                            預計需要 {status.estimated_time_minutes} 分鐘
                        </p>

                        {missingOptional.length > 0 && (
                            <label className="optional-checkbox">
                                <input
                                    type="checkbox"
                                    checked={includeOptional}
                                    onChange={(e) => setIncludeOptional(e.target.checked)}
                                />
                                同時安裝可選項目
                            </label>
                        )}
                    </div>
                )}

                <div className="setup-actions">
                    <button
                        className="setup-button secondary"
                        onClick={checkRequirements}
                    >
                        <RefreshCw className="w-4 h-4" /> 重新檢查
                    </button>

                    {allInstalled ? (
                        <button
                            className="setup-button primary"
                            onClick={async () => {
                                await setupService.markComplete();
                                setStep('complete');
                            }}
                        >
                            繼續 <ArrowRight className="w-5 h-5" />
                        </button>
                    ) : (
                        <button
                            className="setup-button primary"
                            onClick={startInstallation}
                        >
                            <Download className="w-5 h-5" /> 開始安裝
                        </button>
                    )}
                </div>
            </div>
        );
    };

    // Render installing step
    const renderInstalling = () => {
        const tasks = Object.values(progressMap);
        const completedCount = tasks.filter(t => t.status === 'Completed').length;
        const currentTask = tasks.find(t => t.status === 'InProgress');
        const overallProgress = tasks.length > 0
            ? Math.round((completedCount / tasks.length) * 100)
            : 0;

        return (
            <div className="setup-step installing-step">
                <h2 className="setup-subtitle">正在安裝...</h2>

                {error && (
                    <div className="setup-error">
                        <XCircle className="w-5 h-5" />
                        {error}
                    </div>
                )}

                <div className="overall-progress">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{ width: `${overallProgress}%` }}
                        />
                    </div>
                    <span className="progress-text">{overallProgress}%</span>
                </div>

                {currentTask && (
                    <div className="current-task">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>{currentTask.task_name}</span>
                        {currentTask.message && (
                            <span className="task-message">{currentTask.message}</span>
                        )}
                    </div>
                )}

                <div className="task-list">
                    {tasks.map(task => (
                        <div
                            key={task.task_id}
                            className={`task-item ${task.status === 'Completed' ? 'completed' :
                                task.status === 'InProgress' ? 'active' :
                                    typeof task.status === 'object' ? 'failed' : 'pending'
                                }`}
                        >
                            <span className="task-name">{task.task_name}</span>
                            {task.status === 'Completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                            {task.status === 'InProgress' && (
                                <span className="task-progress">{getProgressPercentage(task)}%</span>
                            )}
                            {typeof task.status === 'object' && task.status.Failed && (
                                <XCircle className="w-4 h-4 text-red-500" />
                            )}
                        </div>
                    ))}
                </div>

                <button
                    className="setup-button secondary"
                    onClick={cancelInstallation}
                    disabled={!isInstalling}
                >
                    取消安裝
                </button>
            </div>
        );
    };

    // Render complete step
    const renderComplete = () => (
        <div className="setup-step complete-step">
            <div className="complete-icon">
                <CheckCircle className="w-20 h-20 text-green-500" />
            </div>

            <h2 className="setup-subtitle">設置完成！</h2>
            <p className="setup-description">
                所有必要的元件已安裝完成，您可以開始使用 ClassNoteAI 了。
            </p>

            <div className="feature-summary">
                <div className="feature-item">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>語音轉錄功能已就緒</span>
                </div>
                <div className="feature-item">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>本地翻譯功能已就緒</span>
                </div>
                <div className="feature-item">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>雲端翻譯備援已就緒</span>
                </div>
            </div>

            <button className="setup-button primary" onClick={onComplete}>
                開始使用 <ArrowRight className="w-5 h-5" />
            </button>
        </div>
    );

    return (
        <div className="setup-wizard">
            <div className="setup-container">
                {/* Progress indicator — the two ai-* steps share a single
                    dot since the user experience is "one thing" (configure
                    an LLM) split across two screens for viewport reasons. */}
                {(() => {
                    const visualSteps: WizardStep[] = ['welcome', 'language', 'ai-provider', 'checking', 'review', 'installing', 'complete'];
                    const normalisedStep: WizardStep = step === 'ai-config' ? 'ai-provider' : step;
                    const currentIdx = visualSteps.indexOf(normalisedStep);
                    return (
                        <div className="step-indicator">
                            {visualSteps.map((s, i) => (
                                <div
                                    key={s}
                                    className={`step-dot ${s === normalisedStep ? 'active' : currentIdx > i ? 'done' : ''}`}
                                />
                            ))}
                        </div>
                    );
                })()}

                {/* Step content */}
                {step === 'welcome' && renderWelcome()}
                {step === 'language' && renderLanguage()}
                {step === 'ai-provider' && renderAIProvider()}
                {step === 'ai-config' && renderAIConfig()}
                {step === 'checking' && renderChecking()}
                {step === 'gpu-check' && renderGpuCheck()}
                {step === 'review' && renderReview()}
                {step === 'installing' && renderInstalling()}
                {step === 'complete' && renderComplete()}
            </div>
        </div>
    );
}
