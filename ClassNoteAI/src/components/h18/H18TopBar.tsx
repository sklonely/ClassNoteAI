/**
 * H18 TopBar · v0.7.0 Phase 6.1
 *
 * 對應 docs/design/h18-deep/h18-parts.jsx H18TopBar (L52-103).
 *
 * 取代 MainWindow 的中央 nav TopBar。新模型：
 *   left  · WindowControls (traffic lights) + logo "C" + brand + datetime
 *   right · ⌘K search trigger + 錄音 button + 主題切換 + TaskIndicator
 *
 * Inbox count 在 prototype 是 "Inbox · 14 項"，但 reminders schema
 * 沒做 → 留白（不顯示）。
 */

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import WindowControls from '../WindowControls';
import TaskIndicator from '../TaskIndicator';
import s from './H18TopBar.module.css';

/** Active recording lecture metadata for the center "recording island". */
export interface ActiveRecording {
    courseShort: string;
    courseColor: string;
    lectureNumber: number | string;
    /** Elapsed seconds since recording started. */
    elapsedSec: number;
    /** Click → nav back to recording page. */
    onClick: () => void;
}

export interface H18TopBarProps {
    dense?: boolean;
    showWindowControls?: boolean;
    onOpenSearch: () => void;
    effectiveTheme: 'light' | 'dark';
    onToggleTheme: () => void;
    /** Inbox unread count (留白 — schema 沒做時固定 0)。 */
    inboxCount?: number;
    onOpenInbox?: () => void;
    /** Currently active recording session, displayed as center island. */
    activeRecording?: ActiveRecording | null;
}

function formatDateTime(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const weekday = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][d.getDay()];
    return `${yyyy}·${mm}·${dd} · ${weekday} ${hh}:${mi}`;
}

function fmtElapsed(sec: number): string {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    if (m >= 60) {
        const h = Math.floor(m / 60);
        return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function H18TopBar({
    dense = false,
    showWindowControls = true,
    onOpenSearch,
    effectiveTheme,
    onToggleTheme,
    inboxCount = 0,
    onOpenInbox,
    activeRecording,
}: H18TopBarProps) {
    const [now, setNow] = useState(() => formatDateTime(new Date()));
    useEffect(() => {
        const t = setInterval(() => setNow(formatDateTime(new Date())), 30_000);
        return () => clearInterval(t);
    }, []);

    return (
        <div
            className={`${s.bar} ${dense ? s.barDense : ''}`}
            data-tauri-drag-region
        >
            <div className={s.left} data-tauri-drag-region>
                {showWindowControls && (
                    <>
                        <span data-tauri-drag-region="false">
                            <WindowControls />
                        </span>
                        <div className={s.divider} />
                    </>
                )}
                <div className={s.logoBadge} data-tauri-drag-region="false">C</div>
                <span className={s.brand} data-tauri-drag-region>
                    ClassNote
                </span>
                <button
                    type="button"
                    onClick={onOpenInbox}
                    className={s.inboxIndicator}
                    title="Inbox"
                    data-tauri-drag-region="false"
                >
                    Inbox · {inboxCount} 項
                </button>
                <div className={s.divider} />
                <span className={s.meta}>{now}</span>
            </div>

            {/* Center — recording island (only when actively recording) */}
            <div className={s.center} data-tauri-drag-region>
                {activeRecording && (
                    <button
                        type="button"
                        onClick={activeRecording.onClick}
                        className={s.recIsland}
                        data-tauri-drag-region="false"
                        title="返回錄音"
                    >
                        <span className={s.recIslandDot} />
                        <span
                            className={s.recIslandShort}
                            style={{ background: activeRecording.courseColor }}
                        >
                            {activeRecording.courseShort}
                        </span>
                        <span className={s.recIslandLec}>L{activeRecording.lectureNumber}</span>
                        <span className={s.recIslandTime}>
                            {fmtElapsed(activeRecording.elapsedSec)}
                        </span>
                    </button>
                )}
            </div>

            <div className={s.right} data-tauri-drag-region="false">
                <button
                    type="button"
                    onClick={onOpenSearch}
                    title="搜尋 (⌘K)"
                    aria-label="搜尋"
                    className={s.search}
                >
                    <span className={s.searchIcon}>⌕</span>
                    <span className={s.searchPlaceholder}>
                        搜尋筆記、課程、語音片段…
                    </span>
                    <span className={s.searchKbd}>⌘K</span>
                </button>

                <button
                    type="button"
                    onClick={onToggleTheme}
                    title="切換主題 (⌘\\)"
                    aria-label="切換主題"
                    className={s.themeBtn}
                >
                    {effectiveTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </button>

                <TaskIndicator />
            </div>
        </div>
    );
}
