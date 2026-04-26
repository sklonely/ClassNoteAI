/**
 * H18Calendar · v0.7.0 Phase 6.2
 *
 * 對應 docs/design/h18-deep/h18-parts.jsx L163-268 (H18Calendar).
 * Week grid 9:00–20:00, 7 columns (週一..週日, ISO 1..7).
 *
 * Events 由 course.syllabus_info.time 推 — 推不到的就沒事件
 * (per "留白" rule)。事件點擊 → 跳對應 course detail。
 */

import { useEffect, useMemo, useState } from 'react';
import type { Course } from '../../types';
import { courseColor } from './courseColor';
import { deriveWeekEvents } from './weekParse';
import s from './H18Calendar.module.css';

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] as const;
const DAYS_LABEL = ['一', '二', '三', '四', '五', '六', '日'] as const;
const ROW_H = 30; // px

export interface H18CalendarProps {
    courses: Course[];
    onPickCourse?: (courseId: string) => void;
    /** Compact mode for embedded uses; only "today" column. */
    onlyToday?: boolean;
}

function todayIso1to7(): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
    // JS getDay() Sun=0..Sat=6 → ISO Mon=1..Sun=7
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
    const r = new Date(d);
    r.setDate(d.getDate() + diff);
    return r;
}

export default function H18Calendar({
    courses,
    onPickCourse,
    onlyToday = false,
}: H18CalendarProps) {
    const today = todayIso1to7();
    const events = useMemo(() => deriveWeekEvents(courses), [courses]);

    // recompute "now" line every minute
    const [now, setNow] = useState(nowFractionHours());
    useEffect(() => {
        const t = setInterval(() => setNow(nowFractionHours()), 60_000);
        return () => clearInterval(t);
    }, []);

    const weekDates = useMemo(() => {
        const monday = startOfWeek(new Date());
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            return d.getDate();
        });
    }, []);

    const dayIdxs: number[] = onlyToday ? [today] : [1, 2, 3, 4, 5, 6, 7];
    const days = onlyToday ? 1 : 7;

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
            <div className={s.cornerCell} />
            {dayIdxs.map((wd) => {
                const isToday = wd === today;
                return (
                    <div
                        key={wd}
                        className={`${s.dayHeader} ${isToday ? s.dayHeaderToday : ''}`}
                    >
                        <span>週{DAYS_LABEL[wd - 1]}</span>
                        <span className={s.dayDate}>{weekDates[wd - 1]}</span>
                        {isToday && <span className={s.todayBadge}>TODAY</span>}
                    </div>
                );
            })}

            <div className={s.body}>
                <div className={s.hourCol}>
                    {HOURS.map((h) => (
                        <div key={h} className={s.hourLabel}>
                            {h}
                        </div>
                    ))}
                </div>
                {dayIdxs.map((wd) => {
                    const isToday = wd === today;
                    const dayEvents = events.filter((e) => e.weekday === wd);
                    return (
                        <div
                            key={wd}
                            className={`${s.dayCol} ${isToday ? s.dayColToday : ''}`}
                        >
                            {HOURS.map((h) => (
                                <div key={h} className={s.hourSlot} />
                            ))}
                            {isToday && now >= 9 && now <= 20 && (
                                <div
                                    className={s.nowLine}
                                    style={{ top: (now - 9) * ROW_H }}
                                >
                                    <span className={s.nowDot} />
                                    <span className={s.nowLabel}>{formatHM(now)}</span>
                                </div>
                            )}
                            {dayEvents.map((e, i) => {
                                const color = courseColor(e.courseId);
                                const top = (e.startHour - 9) * ROW_H;
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
                        沒有從 syllabus 推到時間 — 在課程編輯加上「上課時間」(例如「週一 14:00-15:30」) 即會顯示。
                    </div>
                )}
            </div>
        </div>
    );
}
