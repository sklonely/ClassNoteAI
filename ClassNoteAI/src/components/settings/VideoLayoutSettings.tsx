import { useEffect, useState } from 'react';
import { Film, Rows2, PictureInPicture2 } from 'lucide-react';
import { storageService } from '../../services/storageService';

type LayoutMode = 'split' | 'pip';

/**
 * v0.6.0 — when a lecture has both an imported video and a PDF/PPT,
 * the user can choose between:
 *
 *   - split — left panel splits vertically into video (top) + PDF
 *             (bottom); resizable divider.
 *   - pip   — PDF takes the full left panel; video floats as a small
 *             draggable overlay (Zoom / Meet-style picture-in-picture).
 *
 * No "best" choice — split wins when slides are dense (coding / math
 * lectures where you need to read line-by-line) because the video is
 * big enough to see the prof's face/pointer. PiP wins when the video
 * is the primary content (demos, tours) and the slides are reference.
 * Rather than auto-guess we let users pick the same way they pick
 * the AI 助教 display mode.
 */

const MODES: {
    value: LayoutMode;
    title: string;
    caption: string;
    icon: React.ReactNode;
}[] = [
    {
        value: 'split',
        title: '上下分割',
        caption: '左邊板面垂直分成上下兩塊，影片在上、投影片在下，分隔線可拖動調整比例。',
        icon: <Rows2 className="w-4 h-4" />,
    },
    {
        value: 'pip',
        title: '懸浮小窗 (PiP)',
        caption: '投影片佔滿左邊板面，影片變成可拖移的小視窗，像 Zoom 的分格視窗。適合以投影片為主的課堂。',
        icon: <PictureInPicture2 className="w-4 h-4" />,
    },
];

export default function VideoLayoutSettings() {
    const [mode, setMode] = useState<LayoutMode>('split');
    const [loaded, setLoaded] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const settings = await storageService.getAppSettings();
                setMode(
                    (settings?.lectureLayout?.videoPdfMode as LayoutMode) ?? 'split',
                );
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const handleChange = async (next: LayoutMode) => {
        setMode(next);
        try {
            const existing = await storageService.getAppSettings();
            if (!existing) return;
            await storageService.saveAppSettings({
                ...existing,
                lectureLayout: {
                    ...(existing.lectureLayout ?? {}),
                    videoPdfMode: next,
                },
            });
            setSavedAt(Date.now());
        } catch (err) {
            console.error('[VideoLayoutSettings] Failed to save:', err);
        }
    };

    if (!loaded) return null;

    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 mb-3">
                <Film className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    影片與投影片佈局
                </span>
                {savedAt && Date.now() - savedAt < 2000 && (
                    <span className="text-[10px] text-green-600 dark:text-green-400">已保存</span>
                )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                當課堂同時有匯入的影片與投影片時使用的排版方式。切換會即時生效。
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
                            name="video-layout-mode"
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
