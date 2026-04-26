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

/** Extract events from one course's syllabus.time string. */
function parseCourseTime(course: Course): WeekEvent[] {
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

/** All events across all courses for a single canonical week. */
export function deriveWeekEvents(courses: Course[]): WeekEvent[] {
    return courses.flatMap(parseCourseTime);
}
