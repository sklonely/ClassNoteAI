import { useEffect, useState } from 'react';
import { FlaskConical, Sparkles, Zap, Gauge } from 'lucide-react';
import { storageService } from '../../services/storageService';

type Intensity = 'off' | 'light' | 'deep';
type Provider =
    | 'auto'
    | 'chatgpt-oauth'
    | 'github-models'
    | 'gemini'
    | 'groq'
    | 'mistral'
    | 'openrouter'
    | 'user-key';

/**
 * v0.6.0-alpha.1: cloud-AI settings. Splits the old single "匯入後自動
 * AI 精修" checkbox into an intensity selector + provider pin so users
 * can pick their tradeoff between cost and quality explicitly.
 *
 * Why the split:
 *   - a full per-subtitle refinement on a 70-min lecture was 1296 LLM
 *     calls × ~200 tokens ≈ 260k tokens, blowing free tiers after 2-3
 *     lectures. Batched per 5-min section cuts that to 14 calls ≈
 *     15k-50k tokens depending on intensity.
 *   - primary user segments are Copilot Pro subscribers (GitHub
 *     OAuth → Models) and ChatGPT Plus subscribers (Codex-style
 *     OAuth → Plus subscription quota). Both flows are already in
 *     the codebase (`llm/providers/chatgpt-oauth.ts`, `github-
 *     models.ts`) — the refine path just picks from those same
 *     configured providers.
 *   - free-tier options (Gemini, Groq, Mistral) are
 *     shown for users with neither subscription or when a user
 *     wants to keep their paid quota for other tasks.
 *
 * ASR backend + fast/standard model live in
 * LocalModelExperimentalSettings under 本地轉錄模型 because they
 * only touch the local Whisper pipeline.
 */
export default function CloudAIExperimentalSettings() {
    const [intensity, setIntensity] = useState<Intensity>('off');
    const [provider, setProvider] = useState<Provider>('auto');
    const [loaded, setLoaded] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const s = await storageService.getAppSettings();
                const exp = s?.experimental;
                if (exp?.refineIntensity) {
                    setIntensity(exp.refineIntensity);
                } else if (typeof exp?.importAiRefine === 'boolean') {
                    // Legacy boolean → intensity mapping. Old true = deep
                    // so existing users don't silently lose quality after
                    // the upgrade.
                    setIntensity(exp.importAiRefine ? 'deep' : 'off');
                }
                if (exp?.refineProvider) setProvider(exp.refineProvider);
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const patch = async (changes: Partial<{ refineIntensity: Intensity; refineProvider: Provider }>) => {
        try {
            const existing = await storageService.getAppSettings();
            if (!existing) return;
            await storageService.saveAppSettings({
                ...existing,
                experimental: {
                    ...(existing.experimental ?? {}),
                    ...changes,
                    // Drop the legacy boolean — `refineIntensity`
                    // supersedes it. Keeping both would let them
                    // drift.
                    importAiRefine: undefined,
                },
            });
            setSavedAt(Date.now());
        } catch (err) {
            console.error('[CloudAIExperimental] save failed:', err);
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
                {/* Intensity selector */}
                <div>
                    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                        <Sparkles className="w-4 h-4 text-purple-500" />
                        AI 精修字幕強度
                    </label>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                        粗翻譯由本機 CT2 完成後，選擇是否請雲端 LLM 再潤飾。
                        批次以 5 分鐘為一段（70 分鐘講堂 ≈ 14 次 LLM 呼叫）。
                    </p>
                    <div className="flex gap-2">
                        {(
                            [
                                { id: 'off' as const, label: '關', hint: '不呼叫 LLM' },
                                { id: 'light' as const, label: '輕量', hint: '~15k tokens / 小時' },
                                { id: 'deep' as const, label: '深度', hint: '~50k tokens / 小時' },
                            ]
                        ).map((opt) => (
                            <button
                                key={opt.id}
                                onClick={() => {
                                    setIntensity(opt.id);
                                    void patch({ refineIntensity: opt.id });
                                }}
                                className={`flex-1 text-xs px-3 py-2 rounded-md border transition-colors ${
                                    intensity === opt.id
                                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800/50'
                                }`}
                            >
                                <div className="font-medium">{opt.label}</div>
                                <div className="text-[10px] opacity-75 mt-0.5">{opt.hint}</div>
                            </button>
                        ))}
                    </div>
                    {intensity !== 'off' && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                            {intensity === 'light' ? (
                                <>
                                    <Gauge className="w-3 h-3 inline mr-1 text-emerald-500" />
                                    使用 mid-tier 模型（GPT-4o-mini / Haiku / Gemini Flash）。
                                    修語法、術語；保留原意。適合日常使用。
                                </>
                            ) : (
                                <>
                                    <Zap className="w-3 h-3 inline mr-1 text-amber-500" />
                                    使用 upper-mid / frontier 模型（Mistral Large 2 /
                                    Claude Sonnet）。跨 section 保持術語一致、整段重寫可讀性。
                                    token 花費較高，免費層可能撞限額。
                                </>
                            )}
                        </p>
                    )}
                </div>

                {/* Provider pick (only meaningful if intensity != off) */}
                {intensity !== 'off' && (
                    <div>
                        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            LLM 提供者
                        </label>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                            依序嘗試你已登入的 provider；任一 rate-limit 就自動換下一個。
                            想固定一個就選下拉；選「自動」則依下列優先順序。
                        </p>
                        <select
                            value={provider}
                            onChange={(e) => {
                                const v = e.target.value as Provider;
                                setProvider(v);
                                void patch({ refineProvider: v });
                            }}
                            className="w-full text-sm px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100"
                        >
                            <option value="auto">自動（ChatGPT OAuth → Copilot OAuth → 免費 API → 使用者金鑰）</option>
                            <option value="chatgpt-oauth">ChatGPT Plus（已登入）— 用你的訂閱額度</option>
                            <option value="github-models">GitHub Models（Copilot 已登入）— 用你的 Copilot 額度</option>
                            <option value="gemini">Google Gemini 2.5 Flash — 免費 500 req/day</option>
                            <option value="groq">Groq Llama 3.3 70B — 免費 14.4k req/day、速度最快</option>
                            <option value="mistral">Mistral La Plateforme Experiment — 免費 1B token/月</option>
                            <option value="openrouter">OpenRouter 免費模型 — 50 req/day</option>
                            <option value="user-key">使用者貼的 API 金鑰（在 AI 提供者頁設定）</option>
                        </select>
                    </div>
                )}
            </div>
        </div>
    );
}
