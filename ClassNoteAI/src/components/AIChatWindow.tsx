import { useEffect } from 'react';
import AIChatPanel from './AIChatPanel';
import { storageService } from '../services/storageService';

/**
 * Standalone window host for `AIChatPanel` when the user picks
 * "獨立視窗" in settings. Rendered by `App.tsx` when the URL query
 * string contains `aiTutorWindow=1`.
 *
 * Pass-through context is empty: chat history is persisted in SQLite
 * keyed by lectureId via chatSessionService, so sessions are
 * automatically shared with the main window. Index rebuild should
 * be done in the main window where the PDF buffer is already in
 * memory -- keeping this window's responsibilities minimal.
 */
export default function AIChatWindow() {
    const params = new URLSearchParams(window.location.search);
    const lectureId = params.get('lectureId') ?? '';

    useEffect(() => {
        (async () => {
            const urlTheme = params.get('theme');
            const settings = await storageService.getAppSettings().catch(() => null);
            const theme = urlTheme ?? settings?.theme ?? 'light';
            if (theme === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
        })();
    }, []);

    // Override the main-app-window-tuned CSS. The shared index.css sets
    // `body { min-width: 1200px; min-height: 700px }` which is fine for
    // the primary window (tauri.conf.json pins that min size) but the
    // detached AI-tutor window opens at ~480x700 max and the body's
    // 1200x700 minimum forces scrolling bars and pushes the panel
    // out of view. We only need this unconstrained inside this window,
    // so we flip it on mount and restore on unmount (unmount is
    // effectively never, but kept for hygiene).
    useEffect(() => {
        const prev = {
            bodyMinW: document.body.style.minWidth,
            bodyMinH: document.body.style.minHeight,
            rootH: (document.getElementById('root') as HTMLElement | null)?.style.height,
            rootW: (document.getElementById('root') as HTMLElement | null)?.style.width,
        };
        document.body.style.minWidth = '0';
        document.body.style.minHeight = '0';
        const root = document.getElementById('root') as HTMLElement | null;
        if (root) {
            root.style.height = '100vh';
            root.style.width = '100vw';
        }
        return () => {
            document.body.style.minWidth = prev.bodyMinW;
            document.body.style.minHeight = prev.bodyMinH;
            if (root) {
                root.style.height = prev.rootH ?? '';
                root.style.width = prev.rootW ?? '';
            }
        };
    }, []);

    if (!lectureId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900">
                <p className="text-sm text-gray-500">缺少 lectureId，無法開啟 AI 助教視窗。</p>
            </div>
        );
    }

    return (
        // h-screen (not min-h-screen) is load-bearing: the inner
        // AIChatPanel uses flex-col + h-full so its messages area can
        // grow with flex-1. If the wrapper is auto-height, h-full
        // resolves to 0 and the panel collapses to the natural
        // height of its header + input with a large black void below.
        <div className="h-screen w-screen bg-white dark:bg-slate-900 overflow-hidden">
            <AIChatPanel
                lectureId={lectureId}
                isOpen
                onClose={() => {
                    import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
                        getCurrentWebviewWindow().close().catch(() => {});
                    });
                }}
                displayMode="detached"
            />
        </div>
    );
}
