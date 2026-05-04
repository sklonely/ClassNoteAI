/**
 * FloatingNotesPanel · v0.7.0
 *
 * 浮動 markdown 筆記窗 — H18RecordingPage 的 ⌘⇧N 用這個。
 *
 * 行為：
 *  - position: fixed，可拖拉 header 移動
 *  - 內容用 textarea，500ms debounce 寫進 userNotesStore
 *  - 顯示 "已儲存 / 編輯中" 狀態
 *  - Esc 關閉
 *  - 重新打開時記住上次位置 (localStorage)
 */

import {
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { loadUserNotes, saveUserNotes, subscribeUserNotes } from './userNotesStore';
import s from './FloatingNotesPanel.module.css';

const POS_KEY = 'classnote-h18-notes-panel-pos';
const DEFAULT_W = 380;
const DEFAULT_H = 460;

interface Pos {
    x: number;
    y: number;
}

function loadPos(): Pos {
    try {
        const raw = localStorage.getItem(POS_KEY);
        if (!raw) return defaultPos();
        const p = JSON.parse(raw) as Pos;
        if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    } catch {
        /* swallow */
    }
    return defaultPos();
}

function defaultPos(): Pos {
    if (typeof window === 'undefined') return { x: 80, y: 120 };
    return {
        x: Math.max(20, window.innerWidth - DEFAULT_W - 32),
        y: 120,
    };
}

function clampPos(p: Pos): Pos {
    if (typeof window === 'undefined') return p;
    const maxX = Math.max(0, window.innerWidth - 80);
    const maxY = Math.max(0, window.innerHeight - 60);
    return {
        x: Math.min(Math.max(0, p.x), maxX),
        y: Math.min(Math.max(0, p.y), maxY),
    };
}

export interface FloatingNotesPanelProps {
    lectureId: string;
    lectureTitle?: string;
    onClose: () => void;
}

export default function FloatingNotesPanel({
    lectureId,
    lectureTitle,
    onClose,
}: FloatingNotesPanelProps) {
    const [text, setText] = useState(() => loadUserNotes(lectureId));
    const [pos, setPos] = useState<Pos>(() => loadPos());
    const [savedAt, setSavedAt] = useState<number | null>(
        text.length > 0 ? Date.now() : null,
    );
    const [dirty, setDirty] = useState(false);

    const panelRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ dx: number; dy: number; pid: number } | null>(null);
    const saveTimerRef = useRef<number | null>(null);

    // Reload when lectureId changes
    useEffect(() => {
        const next = loadUserNotes(lectureId);
        setText(next);
        setSavedAt(next.length > 0 ? Date.now() : null);
        setDirty(false);
    }, [lectureId]);

    // Cross-window sync (review page edits while floating panel open)
    useEffect(() => {
        return subscribeUserNotes(lectureId, () => {
            const next = loadUserNotes(lectureId);
            setText((cur) => (cur === next ? cur : next));
        });
    }, [lectureId]);

    // Esc to close
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Persist position whenever it stops moving (debounced via effect)
    useEffect(() => {
        try {
            localStorage.setItem(POS_KEY, JSON.stringify(pos));
        } catch {
            /* swallow */
        }
    }, [pos]);

    // Re-clamp on window resize so panel never falls off-screen
    useEffect(() => {
        const onResize = () => setPos((p) => clampPos(p));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Debounced autosave
    const handleChange = (next: string) => {
        setText(next);
        setDirty(true);
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
            saveUserNotes(lectureId, next);
            setSavedAt(Date.now());
            setDirty(false);
        }, 500);
    };

    // Flush pending save on unmount
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                // best-effort flush
                saveUserNotes(lectureId, text);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ────────── drag ───────── */
    const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        // Only left button or touch / pen
        if (e.button !== 0) return;
        const rect = panelRef.current?.getBoundingClientRect();
        if (!rect) return;
        dragRef.current = {
            dx: e.clientX - rect.left,
            dy: e.clientY - rect.top,
            pid: e.pointerId,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pid !== e.pointerId) return;
        setPos(clampPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }));
    };

    const onHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.pid === e.pointerId) {
            dragRef.current = null;
            try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
                /* swallow */
            }
        }
    };

    const status = dirty
        ? '編輯中…'
        : savedAt
          ? `已儲存 ${fmtSavedTime(savedAt)}`
          : '尚未編輯';

    return (
        <div
            ref={panelRef}
            className={s.panel}
            style={{
                left: pos.x,
                top: pos.y,
                width: DEFAULT_W,
                height: DEFAULT_H,
            }}
            role="dialog"
            aria-label="浮動筆記"
        >
            <div
                className={s.header}
                onPointerDown={onHeaderPointerDown}
                onPointerMove={onHeaderPointerMove}
                onPointerUp={onHeaderPointerUp}
                onPointerCancel={onHeaderPointerUp}
            >
                <span className={s.headerIcon} aria-hidden>✎</span>
                <span className={s.headerTitle}>
                    我的筆記
                    {lectureTitle && (
                        <span className={s.headerLecture}> · {lectureTitle}</span>
                    )}
                </span>
                <span className={`${s.headerStatus} ${dirty ? s.headerStatusDirty : ''}`}>
                    {status}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    className={s.headerClose}
                    aria-label="關閉筆記"
                    title="Esc"
                >
                    ✕
                </button>
            </div>
            <textarea
                className={s.textarea}
                value={text}
                onChange={(e) => handleChange(e.target.value)}
                placeholder={'用 markdown 寫下重點 / 公式 / 疑問…\n\n會自動跟錄音對齊，回到 Review 頁繼續編輯。'}
                spellCheck={false}
            />
            <div className={s.footer}>
                <span className={s.footerHint}>
                    自動儲存 · 切換到 Review 頁仍可繼續編輯
                </span>
                <span className={s.footerCount}>{text.length} 字</span>
            </div>
        </div>
    );
}

function fmtSavedTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
