/**
 * CanvasRemindersPanel · v0.7.x
 *
 * Per-course Canvas integration mini-panel — 顯示這門課的：
 *   - 即將到期的 calendar events (assignment / quiz)
 *   - 最近的 announcements
 *   - 沒設好 RSS 時的設定引導
 *
 * 抽自 H18Preview，原本只有右欄 single-course view 用。v0.7.x 起：
 *   - H18Preview course-mode 仍掛這個（行為不變）
 *   - CourseDetailPage 右欄也掛這個（取代 placeholder）
 *
 * 這只是 per-course 視角。**跨課程** 的 aggregate (Inbox 的工作) 不在這支。
 */

import { useMemo } from 'react';
import type { Course } from '../../types';
import { useAppSettings } from './useAppSettings';
import {
    fetchAnnouncementsFeed,
    fetchCalendarFeed,
    type CanvasAnnouncement,
    type CanvasCalendarEvent,
} from '../../services/canvasFeedService';
import { useCanvasFeed } from '../../services/canvasCacheService';
import s from './CanvasRemindersPanel.module.css';

export interface CanvasRemindersPanelProps {
    course: Course;
    /** Click → focus modal / item detail. Caller decides what to do. */
    onPickEvent?: (ev: CanvasCalendarEvent) => void;
    onPickAnnouncement?: (a: CanvasAnnouncement) => void;
    /** Click → navigate to course-edit page (用於 hint 行)。 */
    onEditCourse?: () => void;
    /** Click → navigate to integrations setting (用於 calendar 沒設好 hint)。 */
    onOpenIntegrations?: () => void;
}

export default function CanvasRemindersPanel({
    course,
    onPickEvent,
    onPickAnnouncement,
    onEditCourse,
    onOpenIntegrations,
}: CanvasRemindersPanelProps) {
    const { settings } = useAppSettings();

    const announcementsUrl = course.syllabus_info?.canvas_announcements_rss?.trim();
    const calendarUrlFromSettings = settings?.integrations?.canvas?.calendar_rss?.trim();
    const isPaired = !!course.canvas_course_id;
    const hasGlobalCalendarRss = !!calendarUrlFromSettings;
    const hasAnnouncementsRss = !!announcementsUrl;

    const annFeed = useCanvasFeed(
        `announcements:${course.id}`,
        () => fetchAnnouncementsFeed(announcementsUrl!),
        { disabled: !announcementsUrl },
    );
    const calFeed = useCanvasFeed(
        `calendar:global`,
        () => fetchCalendarFeed(calendarUrlFromSettings!),
        { disabled: !calendarUrlFromSettings },
    );

    const upcomingEvents: CanvasCalendarEvent[] = useMemo(() => {
        if (!course.canvas_course_id || !calFeed.data) return [];
        const events = calFeed.data.events;
        const now = Date.now();
        const horizonMs = 90 * 24 * 60 * 60 * 1000;
        return events
            .filter((e) => e.canvasCourseId === course.canvas_course_id)
            .filter((e) => {
                const t = new Date(e.startAt).getTime();
                return !isNaN(t) && t >= now - 60 * 60 * 1000 && t <= now + horizonMs;
            })
            .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
            .slice(0, 5);
    }, [calFeed.data, course.canvas_course_id]);

    const recentAnnouncements: CanvasAnnouncement[] = useMemo(() => {
        if (!annFeed.data) return [];
        return annFeed.data.announcements.slice(0, 3);
    }, [annFeed.data]);

    const showSetup = !hasGlobalCalendarRss || !isPaired || !hasAnnouncementsRss;

    return (
        <div className={s.panel}>
            {/* 即將到期 */}
            {hasGlobalCalendarRss && isPaired && upcomingEvents.length > 0 && (
                <>
                    <div className={s.sectionHead}>
                        Canvas 即將到期 · {upcomingEvents.length}
                        {calFeed.isFetching && (
                            <span className={s.sectionFetching}> · 更新中…</span>
                        )}
                    </div>
                    <div className={s.list}>
                        {upcomingEvents.map((ev) => (
                            <button
                                type="button"
                                key={ev.uid}
                                onClick={() => onPickEvent?.(ev)}
                                className={`${s.row} ${s.rowAction}`}
                                title={ev.description || ev.rawTitle}
                            >
                                <span className={s.rowIcon}>⚑</span>
                                <span className={s.rowTitle}>{ev.title}</span>
                                <span className={s.rowMeta}>
                                    {formatCalendarDue(ev)}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/* 公告 */}
            {hasAnnouncementsRss && recentAnnouncements.length > 0 && (
                <>
                    <div className={s.sectionHead}>
                        Canvas 公告 · {recentAnnouncements.length}
                        {annFeed.isFetching && (
                            <span className={s.sectionFetching}> · 更新中…</span>
                        )}
                    </div>
                    <div className={s.list}>
                        {recentAnnouncements.map((a) => (
                            <button
                                type="button"
                                key={a.id}
                                onClick={() => onPickAnnouncement?.(a)}
                                className={`${s.row} ${s.rowAction}`}
                                title={a.contentText.slice(0, 200)}
                            >
                                <span className={s.rowIcon}>📢</span>
                                <span className={s.rowTitle}>{a.title}</span>
                                <span className={s.rowMeta}>
                                    {formatRelativeTime(a.publishedAt)} · {a.author}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/* 設定引導 */}
            {showSetup && (
                <>
                    <div className={s.sectionHead}>Canvas 整合</div>
                    <div className={s.list}>
                        {!hasGlobalCalendarRss && (
                            <button
                                type="button"
                                onClick={onOpenIntegrations}
                                className={`${s.row} ${onOpenIntegrations ? s.rowAction : ''}`}
                                title="到「個人頁 → 整合」填一條全域 Calendar feed"
                            >
                                <span className={s.rowIcon}>○</span>
                                <span className={s.rowTitle}>行事曆 (全域)</span>
                                <span className={s.rowMeta}>未設定 · 個人頁 → 整合</span>
                            </button>
                        )}
                        {hasGlobalCalendarRss && !isPaired && (
                            <button
                                type="button"
                                onClick={onOpenIntegrations}
                                className={`${s.row} ${onOpenIntegrations ? s.rowAction : ''}`}
                                title="到「個人頁 → 整合」按「⇄ 配對課程」對應這門課"
                            >
                                <span className={s.rowIcon}>◇</span>
                                <span className={s.rowTitle}>這門課還沒配對 Canvas</span>
                                <span className={s.rowMeta}>個人頁 → 整合 → 配對</span>
                            </button>
                        )}
                        {!hasAnnouncementsRss && (
                            <button
                                type="button"
                                onClick={onEditCourse}
                                className={`${s.row} ${onEditCourse ? s.rowAction : ''}`}
                                title="到「課程編輯」填這門課的 Canvas 公告 RSS URL"
                            >
                                <span className={s.rowIcon}>＋</span>
                                <span className={s.rowTitle}>公告 RSS (per-course)</span>
                                <span className={s.rowMeta}>未設定 · 點此編輯</span>
                            </button>
                        )}
                    </div>
                </>
            )}

            {(annFeed.error || calFeed.error) && (
                <div className={s.errorBox}>
                    ⚠ Canvas 抓取失敗：{annFeed.error || calFeed.error}
                </div>
            )}
        </div>
    );
}

/* ────────── helpers ────────── */

function formatCalendarDue(ev: CanvasCalendarEvent): string {
    const d = new Date(ev.startAt);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDay0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round(
        (dDay0.getTime() - today0.getTime()) / (1000 * 60 * 60 * 24),
    );
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const time = ev.isAllDay
        ? '整天'
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (days === 0) return `今天 ${time}`;
    if (days === 1) return `明天 ${time}`;
    if (days > 0 && days < 7) return `${days} 天後 · ${mm}/${dd} ${time}`;
    return `${mm}/${dd} ${time}`;
}

function formatRelativeTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / (1000 * 60));
    if (mins < 1) return '剛剛';
    if (mins < 60) return `${mins} 分鐘前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小時前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}`;
}
