/**
 * Parse course.syllabus_info.time strings into week-grid events.
 *
 * Real syllabus time strings encountered in the wild:
 *   "週一 14:00-15:30"
 *   "週一、週三 10:00-11:30"
 *   "Mon 14:00-15:30"
 *   "周二 09:00 - 10:30"
 *
 * We aim for the common Mandarin shape and tolerate a few variants;
 * anything we can't parse just yields zero events for that course
 * (the grid stays empty for that day, per "留白" rule — no error).
 */
import type { Course } from '../../types';

export interface WeekEvent {
    courseId: string;
    courseTitle: string;
    weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    startHour: number; // 14.0 = 14:00, 14.5 = 14:30
    durationH: number; // 1.5 = 90 min
}

const WEEKDAY_TABLE: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
    'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 7,
};

function parseHour(hhmm: string): number | null {
    const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mn = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mn) || h < 0 || h > 23 || mn < 0 || mn > 59) return null;
    return h + mn / 60;
}

function parseDate(iso?: string): Date | null {
    if (!iso) return null;
    const trimmed = iso.trim();
    if (!trimmed) return null;
    // Accept YYYY-MM-DD with optional time
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    return d;
}

export interface WeekRange {
    /** Monday 00:00 of the displayed week. */
    weekStart: Date;
    /** Sunday 23:59:59.999 of the displayed week. */
    weekEnd: Date;
}

/**
 * Returns true when the course is "active" during the displayed week.
 * - No start/end date → always active (legacy / no info)
 * - Has dates → active iff [start, end] overlaps [weekStart, weekEnd]
 */
function isCourseActiveInWeek(course: Course, range?: WeekRange): boolean {
    if (!range) return true;
    const start = parseDate(course.syllabus_info?.start_date);
    const end = parseDate(course.syllabus_info?.end_date);
    if (!start && !end) return true; // no info → don't filter out
    // Treat end-of-day for end_date so a course ending today still counts
    const endDay = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999) : null;
    if (start && start > range.weekEnd) return false; // hasn't started yet
    if (endDay && endDay < range.weekStart) return false; // already ended
    return true;
}

/** Extract events from one course's syllabus.time string. */
function parseCourseTime(course: Course, range?: WeekRange): WeekEvent[] {
    if (!isCourseActiveInWeek(course, range)) return [];

    const raw = course.syllabus_info?.time?.trim();
    if (!raw) return [];

    // Find time range — supports "14:00-15:30", "14:00 - 15:30"
    const timeMatch = raw.match(/(\d{1,2}:\d{2})\s*[-–~]\s*(\d{1,2}:\d{2})/);
    if (!timeMatch) return [];
    const start = parseHour(timeMatch[1]);
    const end = parseHour(timeMatch[2]);
    if (start === null || end === null || end <= start) return [];

    // Find weekdays (could be multiple — "週一、週三")
    const weekdays: Set<number> = new Set();
    // Mandarin: 週X / 周X / 星期X
    const cnRe = /(?:週|周|星期)\s*([一二三四五六日天])/g;
    let m: RegExpExecArray | null;
    while ((m = cnRe.exec(raw))) {
        const w = WEEKDAY_TABLE[m[1]];
        if (w) weekdays.add(w);
    }
    // English: Mon Tue ...
    const enRe = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi;
    while ((m = enRe.exec(raw))) {
        const w = WEEKDAY_TABLE[m[1].toLowerCase()];
        if (w) weekdays.add(w);
    }
    if (weekdays.size === 0) return [];

    return Array.from(weekdays).map((wd) => ({
        courseId: course.id,
        courseTitle: course.title,
        weekday: wd as WeekEvent['weekday'],
        startHour: start,
        durationH: end - start,
    }));
}

/**
 * All events across all courses for the displayed week.
 *
 * If `range` is given, courses with start_date / end_date outside the week
 * are filtered out — handles semester transitions cleanly. Without a range,
 * every course is always shown (matches v0.6 behaviour).
 */
export function deriveWeekEvents(
    courses: Course[],
    range?: WeekRange,
): WeekEvent[] {
    return courses.flatMap((c) => parseCourseTime(c, range));
}
