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

type WizardStep = 'welcome' | 'checking' | 'review' | 'installing' | 'complete';

export default function SetupWizard({ onComplete }: SetupWizardProps) {
    const [step, setStep] = useState<WizardStep>('welcome');
    const [status, setStatus] = useState<SetupStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [includeOptional, setIncludeOptional] = useState(false);
    const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});
    const [isInstalling, setIsInstalling] = useState(false);

    // Check requirements when entering checking step
    const checkRequirements = useCallback(async () => {
        setStep('checking');
        setError(null);

        try {
            const setupStatus = await setupService.checkStatus();
            setStatus(setupStatus);

            // If everything is already installed, skip to complete
            if (setupStatus.is_complete) {
                await setupService.markComplete();
                setStep('complete');
            } else {
                setStep('review');
            }
        } catch (err) {
            setError(`環境檢查失敗: ${err}`);
            setStep('review');
        }
    }, []);

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

            <button className="setup-button primary" onClick={checkRequirements}>
                開始設置 <ArrowRight className="w-5 h-5" />
            </button>
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
                {/* Progress indicator */}
                <div className="step-indicator">
                    {['welcome', 'checking', 'review', 'installing', 'complete'].map((s, i) => (
                        <div
                            key={s}
                            className={`step-dot ${s === step ? 'active' :
                                ['welcome', 'checking', 'review', 'installing', 'complete'].indexOf(step) > i ? 'done' : ''
                                }`}
                        />
                    ))}
                </div>

                {/* Step content */}
                {step === 'welcome' && renderWelcome()}
                {step === 'checking' && renderChecking()}
                {step === 'review' && renderReview()}
                {step === 'installing' && renderInstalling()}
                {step === 'complete' && renderComplete()}
            </div>
        </div>
    );
}
