/**
 * H18Calendar · v0.7.x
 *
 * 對應 docs/design/h18-deep/h18-parts.jsx L163-268 (H18Calendar)。
 * Week grid view，7 columns (週一..週日, ISO 1..7) × 24 hour rows。
 *
 * v0.7.x 新功能：
 *  - 全 24 小時 grid（之前只 9-20，會漏掉早課/晚課）
 *  - body 可內部 scroll；mount 時自動捲到當前小時 ± 一些 buffer
 *  - prev / next week 切換 + 「第 N 週」counter（從最早 course.start_date 算）
 *  - weekOffset !== 0 時不顯示 today 標記 + now-line
 *
 * Events 由 course.syllabus_info.time / start_date / end_date 推 — 推不到的
 * 沒事件 (per "留白" rule)。事件點擊 → 跳對應 course detail。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course } from '../../types';
import { courseColor } from './courseColor';
import { deriveWeekEvents, type WeekRange } from './weekParse';
import s from './H18Calendar.module.css';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS_LABEL = ['一', '二', '三', '四', '五', '六', '日'] as const;
const ROW_H_DEFAULT = 30; // px
const ROW_H_COMPACT = 22; // px
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface H18CalendarProps {
    courses: Course[];
    onPickCourse?: (courseId: string) => void;
    /** Compact mode: shorter row height (22 vs 30). */
    compact?: boolean;
    /** Show only today column. */
    onlyToday?: boolean;
}

function todayIso1to7(): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
    const d = new Date().getDay();
    return ((d === 0 ? 7 : d) as 1 | 2 | 3 | 4 | 5 | 6 | 7);
}

function nowFractionHours(): number {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
}

function formatHM(h: number): string {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function startOfWeek(d: Date): Date {
    // Monday-first
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + diff);
    return r;
}

/**
 * Given the earliest course start_date among the given courses, compute
 * the week number (1-indexed) for the displayed Monday.
 * Returns null when no courses have a start_date set.
 */
function semesterWeekNumber(displayedMonday: Date, courses: Course[]): number | null {
    let earliestStart: Date | null = null;
    for (const c of courses) {
        const sd = c.syllabus_info?.start_date;
        if (!sd) continue;
        const d = new Date(sd);
        if (isNaN(d.getTime())) continue;
        if (!earliestStart || d < earliestStart) earliestStart = d;
    }
    if (!earliestStart) return null;
    const semesterMonday = startOfWeek(earliestStart);
    const diffDays = Math.round(
        (displayedMonday.getTime() - semesterMonday.getTime()) / MS_PER_DAY,
    );
    return Math.floor(diffDays / 7) + 1;
}

export default function H18Calendar({
    courses,
    onPickCourse,
    onlyToday = false,
    compact = false,
}: H18CalendarProps) {
    const today = todayIso1to7();
    const [weekOffset, setWeekOffset] = useState(0);
    const ROW_H = compact ? ROW_H_COMPACT : ROW_H_DEFAULT;
    const bodyRef = useRef<HTMLDivElement | null>(null);

    // Compute the Monday of the displayed week (current week + offset).
    const displayedMonday = useMemo(() => {
        const m = startOfWeek(new Date());
        m.setDate(m.getDate() + weekOffset * 7);
        return m;
    }, [weekOffset]);

    // Mon-Sun range for filtering events by date.
    const weekRange = useMemo<WeekRange>(() => {
        const weekStart = new Date(
            displayedMonday.getFullYear(),
            displayedMonday.getMonth(),
            displayedMonday.getDate(),
            0, 0, 0, 0,
        );
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        return { weekStart, weekEnd };
    }, [displayedMonday]);

    const events = useMemo(
        () => deriveWeekEvents(courses, weekRange),
        [courses, weekRange],
    );

    // recompute "now" line every minute
    const [now, setNow] = useState(nowFractionHours());
    useEffect(() => {
        const t = setInterval(() => setNow(nowFractionHours()), 60_000);
        return () => clearInterval(t);
    }, []);

    // Auto-scroll body to current hour on mount + when row height changes,
    // so users land near the active part of the day instead of midnight.
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        // scroll so that 1.5 hours of context shows above the current time.
        const target = Math.max(0, (now - 1.5) * ROW_H);
        el.scrollTop = target;
        // Only on mount / row-h change — explicitly NOT on every now-tick.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ROW_H]);

    // Per-day dates for the displayed week (showing 4/27 etc.)
    const weekDates = useMemo(() => {
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(displayedMonday);
            d.setDate(displayedMonday.getDate() + i);
            return { date: d.getDate(), month: d.getMonth() + 1 };
        });
    }, [displayedMonday]);

    const dayIdxs: number[] = onlyToday ? [today] : [1, 2, 3, 4, 5, 6, 7];
    const days = onlyToday ? 1 : 7;

    // Week-of-semester number; null if no course has start_date
    const semesterWeek = useMemo(
        () => semesterWeekNumber(displayedMonday, courses),
        [displayedMonday, courses],
    );

    // Today highlight + now-line apply only when looking at THIS week
    const isCurrentWeek = weekOffset === 0;

    const weekLabel = (() => {
        if (semesterWeek != null) {
            return `第 ${semesterWeek} 週`;
        }
        if (weekOffset === 0) return '本週';
        if (weekOffset === -1) return '上週';
        if (weekOffset === 1) return '下週';
        if (weekOffset < 0) return `${Math.abs(weekOffset)} 週前`;
        return `${weekOffset} 週後`;
    })();

    const monthDayRangeLabel = (() => {
        const start = weekDates[0];
        const end = weekDates[6];
        const fmt = (d: { month: number; date: number }) =>
            `${String(d.month).padStart(2, '0')}/${String(d.date).padStart(2, '0')}`;
        return `${fmt(start)} – ${fmt(end)}`;
    })();

    return (
        <div
            className={s.cal}
            style={
                {
                    '--days': days,
                    '--row-h': `${ROW_H}px`,
                } as React.CSSProperties
            }
        >
            {/* Top toolbar — week navigation. H18 visual: ghost ←/→ buttons +
                centered semester-week label + mono date range. "回本週" inline
                accent button shows only when off the current week. */}
            {!onlyToday && (
                <div className={s.toolbar}>
                    <button
                        type="button"
                        onClick={() => setWeekOffset((o) => o - 1)}
                        className={s.navBtn}
                        title="上一週"
                        aria-label="上一週"
                    >
                        ‹
                    </button>
                    <div className={s.weekLabel}>
                        <span className={s.weekLabelMain}>{weekLabel}</span>
                        <span className={s.weekLabelDot}>·</span>
                        <span className={s.weekLabelRange}>{monthDayRangeLabel}</span>
                        {weekOffset !== 0 && (
                            <button
                                type="button"
                                onClick={() => setWeekOffset(0)}
                                className={s.navBtnTextual}
                                title="跳回本週"
                            >
                                回本週
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setWeekOffset((o) => o + 1)}
                        className={s.navBtn}
                        title="下一週"
                        aria-label="下一週"
                    >
                        ›
                    </button>
                </div>
            )}

            <div className={s.cornerCell} />
            {dayIdxs.map((wd) => {
                const isToday = isCurrentWeek && wd === today;
                return (
                    <div
                        key={wd}
                        className={`${s.dayHeader} ${isToday ? s.dayHeaderToday : ''}`}
                    >
                        <span>週{DAYS_LABEL[wd - 1]}</span>
                        <span className={s.dayDate}>{weekDates[wd - 1].date}</span>
                        {isToday && <span className={s.todayBadge}>TODAY</span>}
                    </div>
                );
            })}

            <div className={s.body} ref={bodyRef}>
                <div className={s.hourCol}>
                    {HOURS.map((h) => (
                        <div key={h} className={s.hourLabel}>
                            {h}
                        </div>
                    ))}
                </div>
                {dayIdxs.map((wd) => {
                    const isToday = isCurrentWeek && wd === today;
                    const dayEvents = events.filter((e) => e.weekday === wd);
                    return (
                        <div
                            key={wd}
                            className={`${s.dayCol} ${isToday ? s.dayColToday : ''}`}
                        >
                            {HOURS.map((h) => (
                                <div key={h} className={s.hourSlot} />
                            ))}
                            {isToday && (
                                <div
                                    className={s.nowLine}
                                    style={{ top: now * ROW_H }}
                                >
                                    <span className={s.nowDot} />
                                    <span className={s.nowLabel}>{formatHM(now)}</span>
                                </div>
                            )}
                            {dayEvents.map((e, i) => {
                                const color = courseColor(e.courseId);
                                const top = e.startHour * ROW_H;
                                const height = e.durationH * ROW_H - 2;
                                if (height <= 0) return null;
                                return (
                                    <div
                                        key={`${e.courseId}-${i}`}
                                        className={s.event}
                                        title={`${e.courseTitle} · ${formatHM(e.startHour)}-${formatHM(e.startHour + e.durationH)}`}
                                        onClick={(ev) => {
                                            ev.stopPropagation();
                                            onPickCourse?.(e.courseId);
                                        }}
                                        style={{
                                            top,
                                            height,
                                            background: color,
                                            borderLeft: `3px solid ${color}`,
                                        }}
                                    >
                                        <span className={s.eventTitle}>{e.courseTitle}</span>
                                        <span className={s.eventMeta}>
                                            {formatHM(e.startHour)}-
                                            {formatHM(e.startHour + e.durationH)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
                {events.length === 0 && (
                    <div className={s.emptyHint}>
                        {weekOffset === 0
                            ? '沒有從 syllabus 推到時間 — 在課程編輯加上「上課時間」(例如「週一 14:00-15:30」) 即會顯示。'
                            : '這週沒有排到課（或所有課都已過 / 還沒開始）。'}
                    </div>
                )}
            </div>
        </div>
    );
}
