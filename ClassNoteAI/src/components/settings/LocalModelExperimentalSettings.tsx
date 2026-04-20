import { useEffect, useState } from 'react';
import { FlaskConical, Zap, Cpu, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { storageService } from '../../services/storageService';

type Speed = 'fast' | 'standard';
type Backend = 'auto' | 'cuda' | 'metal' | 'vulkan' | 'cpu';

interface DriverHint {
    severity: string;
    title: string;
    message: string;
    action_url: string;
    action_label: string;
}

interface GpuDetection {
    cuda: { gpu_name: string; driver_version: string } | null;
    metal: boolean;
    vulkan: boolean;
    effective: string;
    driver_hint?: DriverHint | null;
}

/**
 * v0.6.1: experimental / opt-in defaults that belong to the **本地
 * 轉錄模型** category — anything that tunes how the local Whisper
 * pipeline runs. Lives under Settings → 本地轉錄模型.
 *
 *   - importSpeed      which Whisper model variant powers bulk video
 *                      imports (base vs the user's main model)
 *   - asrBackend + GPU readout   CPU / CUDA / Metal / Vulkan preference
 *
 * LLM-backed fine refinement lives in CloudAIExperimentalSettings
 * because it hits a cloud API, not the local model.
 */
export default function LocalModelExperimentalSettings() {
    const [speed, setSpeed] = useState<Speed>('fast');
    const [backend, setBackend] = useState<Backend>('auto');
    const [detection, setDetection] = useState<GpuDetection | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const s = await storageService.getAppSettings();
                const exp = s?.experimental;
                if (exp?.importSpeed) setSpeed(exp.importSpeed);
                if (exp?.asrBackend) setBackend(exp.asrBackend);
                try {
                    const d = await invoke<GpuDetection>('detect_gpu_backends', {
                        preference: exp?.asrBackend ?? 'auto',
                    });
                    setDetection(d);
                } catch {
                    /* older binary — leave null */
                }
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const save = async (patch: Partial<{ importSpeed: Speed; asrBackend: Backend }>) => {
        try {
            const existing = await storageService.getAppSettings();
            if (!existing) return;
            await storageService.saveAppSettings({
                ...existing,
                experimental: { ...(existing.experimental ?? {}), ...patch },
            });
            setSavedAt(Date.now());
        } catch (err) {
            console.error('[LocalModelExperimental] save failed:', err);
        }
    };

    if (!loaded) return null;

    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 mb-3">
                <FlaskConical className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    實驗性功能
                </span>
                {savedAt && Date.now() - savedAt < 2000 && (
                    <span className="text-[10px] text-green-600 dark:text-green-400">已保存</span>
                )}
            </div>

            <div className="space-y-4">
                {/* Import speed default */}
                <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        <Zap className="w-4 h-4 text-amber-500" />
                        匯入轉錄速度預設
                    </label>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                        快速 = base 模型（約 5-10 分鐘/小時影片）。
                        標準 = 主設定的 Whisper 模型（通常較慢但精度高）。
                    </p>
                    <div className="flex gap-2">
                        {(['fast', 'standard'] as Speed[]).map((v) => (
                            <button
                                key={v}
                                onClick={() => {
                                    setSpeed(v);
                                    void save({ importSpeed: v });
                                }}
                                className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                                    speed === v
                                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800/50'
                                }`}
                            >
                                {v === 'fast' ? '快速 (base)' : '標準'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* GPU backend selector + detection readout */}
                <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        <Cpu className="w-4 h-4 text-blue-500" />
                        GPU 加速後端
                    </label>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                        套用到所有支援 GPU 的本地模型：Whisper 轉錄、BGE 向量索引、CT2 本地翻譯。
                    </p>

                    {detection?.driver_hint && (
                        // Non-blocking advisory for driver mismatch. Shown
                        // when we see a GPU but the driver is older than
                        // our shipped CUDA runtime needs. Rust side fills
                        // in the exact version numbers + download URL.
                        <div
                            className={`mb-2 p-3 rounded-md border flex gap-2.5 ${
                                detection.driver_hint.severity === 'warning'
                                    ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/40'
                                    : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-900/40'
                            }`}
                        >
                            <AlertTriangle
                                className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                                    detection.driver_hint.severity === 'warning'
                                        ? 'text-amber-500'
                                        : 'text-blue-500'
                                }`}
                            />
                            <div className="flex-1 min-w-0">
                                <div
                                    className={`text-xs font-semibold mb-1 ${
                                        detection.driver_hint.severity === 'warning'
                                            ? 'text-amber-800 dark:text-amber-300'
                                            : 'text-blue-800 dark:text-blue-300'
                                    }`}
                                >
                                    {detection.driver_hint.title}
                                </div>
                                <p className="text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed">
                                    {detection.driver_hint.message}
                                </p>
                                <button
                                    onClick={() => {
                                        void openUrl(detection.driver_hint!.action_url);
                                    }}
                                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                                >
                                    {detection.driver_hint.action_label}
                                    <ExternalLink className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    )}

                    {detection && (
                        <div className="mb-2 p-2.5 rounded-md bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-gray-700 space-y-1">
                            <DetRow
                                ok={!!detection.cuda}
                                label="CUDA (NVIDIA)"
                                detail={
                                    detection.cuda
                                        ? `${detection.cuda.gpu_name} · driver ${detection.cuda.driver_version}`
                                        : '未偵測到 NVIDIA 驅動'
                                }
                            />
                            <DetRow
                                ok={detection.metal}
                                label="Metal (macOS)"
                                detail={detection.metal ? '原生支援' : '不適用此系統'}
                            />
                            <DetRow
                                ok={detection.vulkan}
                                label="Vulkan"
                                detail={detection.vulkan ? 'Vulkan loader 已存在' : '未偵測到 Vulkan runtime'}
                            />
                        </div>
                    )}

                    <select
                        value={backend}
                        onChange={(e) => {
                            const v = e.target.value as Backend;
                            setBackend(v);
                            void save({ asrBackend: v });
                        }}
                        className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                    >
                        <option value="auto">自動（優先用最快的可用後端）</option>
                        <option value="cuda" disabled={!detection?.cuda}>
                            CUDA（NVIDIA）
                            {detection && !detection.cuda ? ' — 未偵測' : ''}
                        </option>
                        <option value="metal" disabled={!detection?.metal}>
                            Metal（macOS）
                            {detection && !detection.metal ? ' — 不適用' : ''}
                        </option>
                        <option value="vulkan" disabled={!detection?.vulkan}>
                            Vulkan（跨廠牌）
                            {detection && !detection.vulkan ? ' — 未偵測' : ''}
                        </option>
                        <option value="cpu">強制 CPU</option>
                    </select>
                </div>
            </div>
        </div>
    );
}

function DetRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
    return (
        <div className="flex items-start gap-2 text-[11px]">
            {ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
            ) : (
                <XCircle className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
            )}
            <span className={ok ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}>
                <span className="font-medium">{label}</span>
                <span className="ml-1">— {detail}</span>
            </span>
        </div>
    );
}
