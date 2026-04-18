import { useEffect, useState } from 'react';
import { ScanText, Cloud, Server, X, Zap } from 'lucide-react';
import { storageService } from '../../services/storageService';

type OcrMode = 'auto' | 'remote' | 'local' | 'off';

/**
 * v0.5.2 OCR-mode picker.
 *
 * Four modes; the decision tree lives in ragService.indexLectureWithOCR:
 *   - auto   → prefer remote (cloud LLM vision), fall back to local Ollama,
 *             then pdfjs text layer
 *   - remote → cloud LLM vision only; pdfjs if no provider configured
 *   - local  → Ollama deepseek-ocr only; pdfjs if Ollama not running
 *   - off    → skip OCR entirely, always use pdfjs
 *
 * Default is `auto` so users who have an LLM provider configured
 * (which v0.5.2 onboarding encourages) get real OCR on the first
 * indexed lecture. Users who care about privacy can switch here.
 */

const MODES: {
    value: OcrMode;
    title: string;
    caption: string;
    icon: React.ReactNode;
    privacyNote?: string;
}[] = [
        {
            value: 'auto',
            title: '自動（推薦）',
            caption: '優先使用雲端 LLM vision；沒配置就用本機 Ollama；都沒有就用 PDF 文字層',
            icon: <Zap className="w-4 h-4" />,
            privacyNote: 'PDF 頁面圖片會發送給所設定的雲端 LLM',
        },
        {
            value: 'remote',
            title: '只使用雲端',
            caption: '僅使用 GitHub Models / ChatGPT OAuth 的 vision 模型；沒配置就 fallback 到 PDF 文字層',
            icon: <Cloud className="w-4 h-4" />,
            privacyNote: 'PDF 頁面圖片會發送給所設定的雲端 LLM',
        },
        {
            value: 'local',
            title: '只使用本機',
            caption: '僅使用 Ollama deepseek-ocr（需自行部署）；沒啟動就 fallback 到 PDF 文字層',
            icon: <Server className="w-4 h-4" />,
        },
        {
            value: 'off',
            title: '停用 OCR',
            caption: '只用 PDF 內建文字層；對掃描件 / 圖片型投影片無效',
            icon: <X className="w-4 h-4" />,
        },
    ];

export default function OcrSettings() {
    const [mode, setMode] = useState<OcrMode>('auto');
    const [loaded, setLoaded] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const settings = await storageService.getAppSettings();
                setMode((settings?.ocr?.mode as OcrMode) ?? 'auto');
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const handleChange = async (next: OcrMode) => {
        setMode(next);
        try {
            const existing = await storageService.getAppSettings();
            if (!existing) {
                // If there's no AppSettings yet (fresh install), let the
                // normal setup/SettingsWizard persist the full object.
                // Silently skip — user will come back here after setup.
                return;
            }
            await storageService.saveAppSettings({
                ...existing,
                ocr: { mode: next },
            });
            setSavedAt(Date.now());
        } catch (err) {
            console.error('[OcrSettings] Failed to save:', err);
        }
    };

    if (!loaded) return null;

    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 mb-3">
                <ScanText className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">PDF OCR 模式</span>
                {savedAt && Date.now() - savedAt < 2000 && (
                    <span className="text-[10px] text-green-600 dark:text-green-400">已保存</span>
                )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                影響 AI 助教對 PDF 內容的檢索。預設「自動」模式會優先走雲端 vision —
                比本機 Ollama 準、不用裝 docker、但會傳送頁面圖片到雲端。
            </p>
            <div className="space-y-2">
                {MODES.map((m) => (
                    <label
                        key={m.value}
                        className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${mode === m.value
                                ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800/50'
                            }`}
                    >
                        <input
                            type="radio"
                            name="ocr-mode"
                            className="mt-1 accent-indigo-500"
                            checked={mode === m.value}
                            onChange={() => handleChange(m.value)}
                        />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                                {m.icon}
                                {m.title}
                            </div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                {m.caption}
                            </div>
                            {m.privacyNote && (
                                <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-mono">
                                    ⚠ {m.privacyNote}
                                </div>
                            )}
                        </div>
                    </label>
                ))}
            </div>
        </div>
    );
}
