/**
 * userNotesStore · v0.7.0
 *
 * Free-form markdown notes the user types during a lecture, kept
 * separate from the AI-generated `Note.sections` shape.
 *
 * Persisted in localStorage keyed by lecture_id so the floating notes
 * window in H18RecordingPage and the 筆記 tab in H18ReviewPage share
 * the same content. No DB schema change required.
 *
 * Schema upgrade path: when we eventually add a `user_note` column to
 * the lectures table this module becomes the single migration point —
 * load/save signatures stay the same.
 */

const PREFIX = 'classnote-h18-user-notes:';
const EVT = 'classnote-h18-user-notes-changed';

function key(lectureId: string): string {
    return PREFIX + lectureId;
}

export function loadUserNotes(lectureId: string): string {
    if (!lectureId) return '';
    try {
        return localStorage.getItem(key(lectureId)) ?? '';
    } catch {
        return '';
    }
}

export function saveUserNotes(lectureId: string, text: string): void {
    if (!lectureId) return;
    try {
        if (text.length === 0) {
            localStorage.removeItem(key(lectureId));
        } else {
            localStorage.setItem(key(lectureId), text);
        }
        window.dispatchEvent(
            new CustomEvent(EVT, { detail: { lectureId } }),
        );
    } catch (err) {
        console.warn('[userNotesStore] save failed:', err);
    }
}

/** Subscribe to changes for one lecture. Returns unsubscribe. */
export function subscribeUserNotes(
    lectureId: string,
    cb: () => void,
): () => void {
    const onChange = (e: Event) => {
        const detail = (e as CustomEvent<{ lectureId: string }>).detail;
        if (!detail || detail.lectureId === lectureId) cb();
    };
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
}
