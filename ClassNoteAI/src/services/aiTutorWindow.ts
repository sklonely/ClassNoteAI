/**
 * Thin wrapper around Tauri's WebviewWindow for opening the
 * "獨立視窗" AI 助教 mode. Gives the caller one async entry point
 * that either focuses an already-open window for the same lectureId
 * or creates a new one.
 *
 * Window labels follow the `aiTutor-<lectureId>` pattern so the
 * capability whitelist (see capabilities/default.json) matches them
 * via the `aiTutor-*` glob. One window per lecture keeps things
 * simple -- re-clicking the button in the main window re-focuses
 * instead of opening duplicates.
 */
export async function openDetachedAiTutor(lectureId: string, theme: 'light' | 'dark' = 'light'): Promise<void> {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = `aiTutor-${lectureId}`;
    // Try to find an existing window for this lecture and focus it.
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
        try {
            await existing.setFocus();
            return;
        } catch {
            // Fall through and recreate.
        }
    }
    const url = `/?aiTutorWindow=1&lectureId=${encodeURIComponent(lectureId)}&theme=${theme}`;
    const win = new WebviewWindow(label, {
        url,
        title: 'AI 助教',
        width: 480,
        height: 700,
        minWidth: 360,
        minHeight: 420,
        resizable: true,
        center: true,
    });
    win.once('tauri://error', (e) => {
        console.error('[openDetachedAiTutor] tauri://error:', e);
    });
}
