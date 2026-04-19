import { useEffect, useState } from 'react';
import { FlaskConical, Zap, Sparkles, Cpu } from 'lucide-react';
import { storageService } from '../../services/storageService';

type Speed = 'fast' | 'standard';
type Backend = 'auto' | 'cuda' | 'metal' | 'vulkan' | 'cpu';

/**
 * v0.6.1 experimental / opt-in defaults for the video-import pipeline.
 * Previously the user had to pick speed + AI-refine from the
 * ImportModal every single time; those selectors now fall back to the
 * values here so users with a consistent workflow (always fast, always
 * refine, etc.) can set-and-forget.
 *
 * Also the staging area for upcoming toggles — GPU backend selector
 * lives here but is display-only in Phase 1 since the build doesn't
 * link any GPU features yet. When Phase 2+ lands the runtime detector,
 * this same control will flip to active without further UI work.
 */
export default function ExperimentalSettings() {
    const [speed, setSpeed] = useState<Speed>('fast');
    const [refine, setRefine] = useState<boolean>(false);
    const [backend, setBackend] = useState<Backend>('auto');
    const [loaded, setLoaded] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const s = await storageService.getAppSettings();
                const exp = s?.experimental;
                if (exp?.importSpeed) setSpeed(exp.importSpeed);
                if (typeof exp?.importAiRefine === 'boolean') setRefine(exp.importAiRefine);
                if (exp?.asrBackend) setBackend(exp.asrBackend);
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const save = async (next: {
        importSpeed?: Speed;
        importAiRefine?: boolean;
        asrBackend?: Backend;
    }) => {
        try {
            const existing = await storageService.getAppSettings();
            if (!existing) return;
            await storageService.saveAppSettings({
                ...existing,
                experimental: { ...(existing.experimental ?? {}), ...next },
            });
            setSavedAt(Date.now());
        } catch (err) {
            console.error('[ExperimentalSettings] save failed:', err);
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
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                匯入影片時的預設行為。每次匯入還是可以在對話框裡臨時覆蓋這些設定。
            </p>

            <div className="space-y-4">
                {/* Import speed default */}
                <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        <Zap className="w-4 h-4 text-amber-500" />
                        匯入轉錄速度預設
                    </label>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                        快速 = 使用 base 模型（每小時影片約 5-10 分鐘）。
                        標準 = 使用主設定的 Whisper 模型（通常較慢但精度高）。
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

                {/* AI refine default */}
                <div>
                    <label className="flex items-start gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={refine}
                            onChange={(e) => {
                                setRefine(e.target.checked);
                                void save({ importAiRefine: e.target.checked });
                            }}
                            className="mt-1 accent-indigo-500"
                        />
                        <span>
                            <span className="flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                                <Sparkles className="w-4 h-4 text-purple-500" />
                                匯入後自動執行 AI 精修字幕
                            </span>
                            <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                粗翻譯完成後請 LLM 修正 ASR 錯誤 + 自然中文。
                                <span className="text-amber-600 dark:text-amber-500">
                                    預估 1 小時影片 ≈ 130k tokens（GPT-4o ≈ $1、Claude Sonnet ≈ $1.5、GitHub Models 免費但可能撞 rate limit）
                                </span>。預設關閉。
                            </span>
                        </span>
                    </label>
                </div>

                {/* GPU backend selector — Phase 1 stub */}
                <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        <Cpu className="w-4 h-4 text-blue-500" />
                        ASR 加速後端
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-normal">
                            尚未啟用
                        </span>
                    </label>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                        選擇 Whisper 轉錄使用的後端。目前版本所有 build 都是 CPU，GPU 支援會在之後的版本啟用（需要 CUDA Toolkit 或 Vulkan SDK 打包）。現在設定值只會儲存，不會生效。
                    </p>
                    <select
                        value={backend}
                        onChange={(e) => {
                            const v = e.target.value as Backend;
                            setBackend(v);
                            void save({ asrBackend: v });
                        }}
                        className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                    >
                        <option value="auto">自動（偵測可用 GPU，否則 CPU）</option>
                        <option value="cuda">CUDA（NVIDIA）</option>
                        <option value="metal">Metal（macOS）</option>
                        <option value="vulkan">Vulkan（跨廠牌）</option>
                        <option value="cpu">強制 CPU</option>
                    </select>
                </div>
            </div>
        </div>
    );
}
