/**
 * useAggregatedCanvasInbox · v0.7.x
 *
 * 跨所有有 canvas_course_id 的 course，把 Canvas calendar events +
 * announcements 合併成 flat InboxItem[]。
 *
 * Why a custom hook (not multiple useCanvasFeed loops): Rules-of-Hooks
 * 禁止 dynamic count of hooks per render。這支自己管 cache 訂閱 +
 * 觸發 fetch，給呼叫端統一的 InboxItem array。
 *
 * 不在這支做：
 *  - 已過未錄 lecture (per user spec — 只在 CourseDetailPage 顯示)
 *  - 老師強調的字幕段落 (尚未實作)
 */

import { useEffect, useMemo, useState } from 'react';
import type { Course } from '../../types';
import {
    fetchAnnouncementsFeed,
    fetchCalendarFeed,
    type CanvasAnnouncement,
    type CanvasCalendarEvent,
} from '../../services/canvasFeedService';
import {
    loadCanvasCache,
    saveCanvasCache,
    saveCanvasCacheError,
    subscribeCanvasCache,
} from '../../services/canvasCacheService';
import { useAppSettings } from './useAppSettings';
import { courseColor } from './courseColor';

export type InboxItemType = 'assignment' | 'quiz' | 'announcement' | 'event';
export type InboxItemGroup = 'today' | 'week' | 'ann' | 'later';

export interface InboxItem {
    /** Stable id — Canvas tag URI for ann, event UID for calendar. */
    id: string;
    type: InboxItemType;
    /** Local Course.id (after pairing). */
    courseId: string;
    /** Local Course.title (使用者可能改成縮寫). */
    courseTitle: string;
    /** Course chip color (derived). */
    courseColor: string;
    /** 1-line headline. */
    title: string;
    /** Optional 2nd-line preview (description plain text first 80 char). */
    detail?: string;
    /** Original event (for the focus modal). */
    rawEvent?: CanvasCalendarEvent;
    /** Original announcement (for the focus modal). */
    rawAnnouncement?: CanvasAnnouncement;
    /** Due date for events; published-at for announcements. */
    when: Date;
    /** Group bucket for the inbox UI. */
    group: InboxItemGroup;
    /** True if due today/tomorrow OR announcement published in last 24h. */
    urgent: boolean;
}

const HORIZON_DAYS_DEFAULT = 30;
const ANN_PER_COURSE_LIMIT = 3;

export interface UseAggregatedCanvasInboxResult {
    items: InboxItem[];
    /** Anything currently in-flight? UI uses this for «更新中…» badge. */
    isFetching: boolean;
    /** Aggregated error messages from failed fetches (per source). */
    errors: string[];
}

export function useAggregatedCanvasInbox(
    courses: Course[],
    options: { horizonDays?: number } = {},
): UseAggregatedCanvasInboxResult {
    const { horizonDays = HORIZON_DAYS_DEFAULT } = options;
    const { settings } = useAppSettings();
    const calendarUrl = settings?.integrations?.canvas?.calendar_rss?.trim();

    // Identity key for the courses list — stable string, used for effect deps.
    const coursesSignature = courses.map((c) => c.id).join(',');

    // Local re-render counter, bumped on cache changes.
    const [bump, setBump] = useState(0);
    const [fetchingCount, setFetchingCount] = useState(0);
    const [errors, setErrors] = useState<string[]>([]);

    // Subscribe to cache invalidation events so consumers re-render
    // when fetches land async.
    useEffect(() => {
        const offs: (() => void)[] = [];
        offs.push(subscribeCanvasCache('calendar:global', () => setBump((n) => n + 1)));
        for (const c of courses) {
            if (!c.syllabus_info?.canvas_announcements_rss?.trim()) continue;
            offs.push(
                subscribeCanvasCache(`announcements:${c.id}`, () =>
                    setBump((n) => n + 1),
                ),
            );
        }
        return () => offs.forEach((o) => o());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coursesSignature]);

    // Trigger background fetches on mount / when course list changes.
    // canvasCacheService applies its own 60s throttle so re-mount won't hammer.
    useEffect(() => {
        let cancelled = false;
        const tasks: Promise<void>[] = [];

        if (calendarUrl) {
            const key = 'calendar:global';
            setFetchingCount((n) => n + 1);
            tasks.push(
                fetchCalendarFeed(calendarUrl)
                    .then((feed) => {
                        if (cancelled) return;
                        saveCanvasCache(key, feed);
                    })
                    .catch((err) => {
                        if (cancelled) return;
                        const msg = (err as Error)?.message || String(err);
                        saveCanvasCacheError(key, msg);
                        setErrors((cur) => [...cur, `行事曆抓取: ${msg}`]);
                    })
                    .finally(() => {
                        if (!cancelled) setFetchingCount((n) => n - 1);
                    }),
            );
        }
        for (const c of courses) {
            const url = c.syllabus_info?.canvas_announcements_rss?.trim();
            if (!url) continue;
            const key = `announcements:${c.id}`;
            setFetchingCount((n) => n + 1);
            tasks.push(
                fetchAnnouncementsFeed(url)
                    .then((feed) => {
                        if (cancelled) return;
                        saveCanvasCache(key, feed);
                    })
                    .catch((err) => {
                        if (cancelled) return;
                        const msg = (err as Error)?.message || String(err);
                        saveCanvasCacheError(key, msg);
                        setErrors((cur) => [...cur, `${c.title} 公告: ${msg}`]);
                    })
                    .finally(() => {
                        if (!cancelled) setFetchingCount((n) => n - 1);
                    }),
            );
        }

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [calendarUrl, coursesSignature]);

    const items = useMemo(() => {
        const all: InboxItem[] = [];
        const today0 = new Date();
        today0.setHours(0, 0, 0, 0);
        const todayEnd = today0.getTime() + 24 * 60 * 60 * 1000 - 1;
        const weekEnd = today0.getTime() + 7 * 24 * 60 * 60 * 1000;
        const horizonEnd = today0.getTime() + horizonDays * 24 * 60 * 60 * 1000;
        const yesterday = today0.getTime() - 24 * 60 * 60 * 1000;

        // ─── Calendar events ─────────────────────────────────────
        const calCache = loadCanvasCache<{ events: CanvasCalendarEvent[] }>(
            'calendar:global',
        );
        if (calCache?.data?.events) {
            for (const ev of calCache.data.events) {
                if (!ev.canvasCourseId) continue;
                const course = courses.find(
                    (c) => c.canvas_course_id === ev.canvasCourseId,
                );
                if (!course) continue;
                const t = new Date(ev.startAt).getTime();
                if (isNaN(t)) continue;
                // skip very old, drop > horizon
                if (t < yesterday) continue;
                if (t > horizonEnd) continue;

                let group: InboxItemGroup;
                if (t <= todayEnd) group = 'today';
                else if (t <= weekEnd) group = 'week';
                else group = 'later';

                const urgent = t <= todayEnd + 24 * 60 * 60 * 1000; // today + tomorrow

                const innerType: InboxItemType =
                    ev.type === 'quiz'
                        ? 'quiz'
                        : ev.type === 'assignment'
                          ? 'assignment'
                          : 'event';

                all.push({
                    id: ev.uid,
                    type: innerType,
                    courseId: course.id,
                    courseTitle: course.title,
                    courseColor: courseColor(course.id),
                    title: ev.title,
                    detail: ev.description.slice(0, 80) || undefined,
                    rawEvent: ev,
                    when: new Date(ev.startAt),
                    group,
                    urgent,
                });
            }
        }

        // ─── Announcements ──────────────────────────────────────
        for (const c of courses) {
            const annCache = loadCanvasCache<{ announcements: CanvasAnnouncement[] }>(
                `announcements:${c.id}`,
            );
            if (!annCache?.data?.announcements) continue;
            const top = annCache.data.announcements.slice(0, ANN_PER_COURSE_LIMIT);
            for (const a of top) {
                const t = new Date(a.publishedAt).getTime();
                if (isNaN(t)) continue;
                // Drop very old (>30 days) — UI noise
                if (t < today0.getTime() - 30 * 24 * 60 * 60 * 1000) continue;
                const urgent = t >= today0.getTime() - 24 * 60 * 60 * 1000;
                all.push({
                    id: a.id,
                    type: 'announcement',
                    courseId: c.id,
                    courseTitle: c.title,
                    courseColor: courseColor(c.id),
                    title: a.title,
                    detail: a.contentText.slice(0, 80) || undefined,
                    rawAnnouncement: a,
                    when: new Date(a.publishedAt),
                    group: 'ann',
                    urgent,
                });
            }
        }

        // Sort: group order first (today → week → ann → later), then time
        const order: Record<InboxItemGroup, number> = {
            today: 0,
            week: 1,
            ann: 2,
            later: 3,
        };
        all.sort((a, b) => {
            if (order[a.group] !== order[b.group]) {
                return order[a.group] - order[b.group];
            }
            // Within same group: ann goes newest-first; events go due-soon-first
            if (a.group === 'ann') return b.when.getTime() - a.when.getTime();
            return a.when.getTime() - b.when.getTime();
        });

        return all;
        // bump triggers re-evaluation when caches update
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courses, bump, horizonDays]);

    return {
        items,
        isFetching: fetchingCount > 0,
        errors,
    };
}
