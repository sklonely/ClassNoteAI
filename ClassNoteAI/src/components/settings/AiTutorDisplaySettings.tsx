import { useEffect, useState } from 'react';
import { Bot, Move, PanelRight, ExternalLink } from 'lucide-react';
import { storageService } from '../../services/storageService';

type DisplayMode = 'floating' | 'sidebar' | 'detached';

/**
 * v0.5.3 AI tutor display-mode picker. Three layouts for the same
 * chat panel:
 *
 *   - floating  — draggable overlay panel, default (v0.5.2 behavior).
 *   - sidebar   — docks a right-side column inside the notes view so
 *                 the chat doesn't cover the PDF.
 *   - detached  — opens a separate OS window. Intended for multi-
 *                 monitor setups where the lecture is fullscreen on
 *                 one display.
 *
 * The mode is read in NotesView and handed to AIChatPanel; the panel
 * renders itself differently per mode but the underlying chat session
 * state is the same (persisted per-lectureId in SQLite, so cross-window
 * is already coherent).
 */

const MODES: {
    value: DisplayMode;
    title: string;
    caption: string;
    icon: React.ReactNode;
}[] = [
    {
        value: 'floating',
        title: '懸浮視窗',
        caption: '可拖曳、可縮放，疊在筆記上方。適合小螢幕或需要快速切換時。',
        icon: <Move className="w-4 h-4" />,
    },
    {
        value: 'sidebar',
        title: '側邊欄',
        caption: '右側常駐欄，不遮筆記。適合寬螢幕一邊看筆記一邊提問。',
        icon: <PanelRight className="w-4 h-4" />,
    },
    {
        value: 'detached',
        title: '獨立視窗',
        caption: '單獨的作業系統視窗，可拖到第二螢幕。適合多螢幕工作流。',
        icon: <ExternalLink className="w-4 h-4" />,
    },
];

export default function AiTutorDisplaySettings() {
    const [mode, setMode] = useState<DisplayMode>('floating');
    const [loaded, setLoaded] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const settings = await storageService.getAppSettings();
                setMode((settings?.aiTutor?.displayMode as DisplayMode) ?? 'floating');
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const handleChange = async (next: DisplayMode) => {
        setMode(next);
        try {
            const existing = await storageService.getAppSettings();
            if (!existing) return;
            await storageService.saveAppSettings({
                ...existing,
                aiTutor: { ...(existing.aiTutor ?? {}), displayMode: next },
            });
            setSavedAt(Date.now());
        } catch (err) {
            console.error('[AiTutorDisplaySettings] Failed to save:', err);
        }
    };

    if (!loaded) return null;

    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 mb-3">
                <Bot className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">AI 助教顯示方式</span>
                {savedAt && Date.now() - savedAt < 2000 && (
                    <span className="text-[10px] text-green-600 dark:text-green-400">已保存</span>
                )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                選擇 AI 助教面板的呈現方式。切換後重新開啟 AI 助教即可看到新樣式。
            </p>
            <div className="space-y-2">
                {MODES.map((m) => (
                    <label
                        key={m.value}
                        className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                            mode === m.value
                                ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800/50'
                        }`}
                    >
                        <input
                            type="radio"
                            name="aitutor-display-mode"
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
                        </div>
                    </label>
                ))}
            </div>
        </div>
    );
}
