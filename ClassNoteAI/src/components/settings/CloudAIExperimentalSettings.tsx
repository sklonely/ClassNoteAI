import { useEffect, useState } from 'react';
import { FlaskConical, Sparkles } from 'lucide-react';
import { storageService } from '../../services/storageService';

/**
 * v0.6.1: experimental / opt-in defaults that belong to the **雲端
 * AI 助理** category — anything that spends cloud-LLM tokens. Lives
 * under Settings → 雲端 AI 助理.
 *
 *   - importAiRefine   run LLM fine-refinement after rough transcribe
 *                      for newly-imported videos. Off by default.
 *
 * ASR backend + fast/standard model live in
 * LocalModelExperimentalSettings under 本地轉錄模型 because they
 * only touch the local Whisper pipeline.
 */
export default function CloudAIExperimentalSettings() {
    const [refine, setRefine] = useState<boolean>(false);
    const [loaded, setLoaded] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const s = await storageService.getAppSettings();
                if (typeof s?.experimental?.importAiRefine === 'boolean') {
                    setRefine(s.experimental.importAiRefine);
                }
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const handleChange = async (next: boolean) => {
        setRefine(next);
        try {
            const existing = await storageService.getAppSettings();
            if (!existing) return;
            await storageService.saveAppSettings({
                ...existing,
                experimental: {
                    ...(existing.experimental ?? {}),
                    importAiRefine: next,
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

            <label className="flex items-start gap-2 text-sm">
                <input
                    type="checkbox"
                    checked={refine}
                    onChange={(e) => handleChange(e.target.checked)}
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
                            1 小時影片 ≈ 130k tokens（GPT-4o ≈ $1、Claude Sonnet ≈ $1.5、GitHub Models 免費但可能撞 rate limit）
                        </span>。預設關閉。
                    </span>
                </span>
            </label>
        </div>
    );
}
