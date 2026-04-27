/**
 * H18Preview · v0.7.0 (revised)
 *
 * 對應 docs/design/h18-deep/h18-inbox-preview.jsx，但 v0.7+ 把
 * 「課程描述 descBox」拿掉，改由 AI 摘要 (syllabus.overview) 直接
 * 取代 — 使用者既然在這頁就是要快速看「這堂課接下來怎樣」，文謅謅
 * 的描述就移除。
 *
 * 結構：
 *   - 標題列 (course chip + instructor)
 *   - hero 標題 + 副 (上課時間、地點、堂數)
 *   - ✦ AI 摘要      ← 取代原本 descBox（吃 overview / description）
 *   - 待辦 / 提醒    ← 下一堂、進度、Canvas 公告 (RSS 占位)
 *   - 相關筆記        ← 最近 lecture 列表
 *   - actions
 *
 * 接得到後端的：course.title / instructor / syllabus_info.overview /
 *   listLecturesByCourse / start_date+end_date+time → 下一堂日期。
 *
 * 留白：
 *  - Canvas RSS 真的抓 — 留 phase 2，先顯示「未設定」連到課程編輯。
 *  - 鍵盤快速鍵 footer 顯示但 disabled。
 */

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { storageService } from '../../services/storageService';
import type { Course, Lecture } from '../../types';
import { courseColor } from './courseColor';
import { useAppSettings } from './useAppSettings';
import {
    fetchAnnouncementsFeed,
    fetchCalendarFeed,
    type CanvasAnnouncement,
    type CanvasCalendarEvent,
} from '../../services/canvasFeedService';
import { useCanvasFeed } from '../../services/canvasCacheService';
import CanvasItemPreviewModal, {
    type CanvasPreviewItem,
} from './CanvasItemPreviewModal';
import type { InboxItem } from './useAggregatedCanvasInbox';
import {
    buildSnoozePresets,
    clearInboxState,
    describeMarkedAt,
    describeSnoozeUntil,
    getInboxState,
    setInboxDone,
    setInboxSnooze,
    subscribeInboxStates,
} from '../../services/inboxStateService';
import s from './H18Preview.module.css';

export interface H18PreviewProps {
    course: Course | null;
    onOpenCourse: (courseId: string) => void;
    onOpenLecture: (courseId: string, lectureId: string) => void;
    effectiveTheme: 'light' | 'dark';
    /** v0.7.x Phase B: focused inbox item from H18Inbox click. When set,
     *  preview switches to "focus mode" and shows the item's full content. */
    focusedInboxItem?: InboxItem | null;
    /** Callback to clear focus (用於返回 course mode / empty mode). */
    onClearFocus?: () => void;
}

function shortDate(iso?: string): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

function formatDuration(seconds?: number): string {
    if (!seconds || seconds < 1) return '—';
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

const WEEKDAY_TABLE_CN: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
};
const WEEKDAY_TABLE_EN: Record<string, number> = {
    mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

function parseWeekdaysFromTime(time?: string): Set<number> {
    const days = new Set<number>();
    if (!time) return days;
    const cnRe = /(?:週|周|星期)\s*([一二三四五六日天])/g;
    const enRe = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = cnRe.exec(time))) {
        const d = WEEKDAY_TABLE_CN[m[1]];
        if (d) days.add(d);
    }
    while ((m = enRe.exec(time))) {
        const d = WEEKDAY_TABLE_EN[m[1].toLowerCase()];
        if (d) days.add(d);
    }
    return days;
}

interface NextLecture {
    date: Date;
    daysAway: number;
}

function computeNextLecture(course: Course): NextLecture | null {
    const sy = course.syllabus_info;
    if (!sy?.time) return null;
    const weekdays = parseWeekdaysFromTime(sy.time);
    if (weekdays.size === 0) return null;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let endLimit: Date | null = null;
    if (sy.end_date) {
        const end = new Date(sy.end_date);
        if (!isNaN(end.getTime())) {
            endLimit = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        }
    }

    let startLimit: Date | null = null;
    if (sy.start_date) {
        const start = new Date(sy.start_date);
        if (!isNaN(start.getTime())) {
            startLimit = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        }
    }

    // Walk forward up to 14 days looking for the next class meeting day
    for (let i = 0; i < 14; i++) {
        const cur = new Date(today);
        cur.setDate(today.getDate() + i);
        if (startLimit && cur < startLimit) continue;
        if (endLimit && cur > endLimit) return null;
        const internal = cur.getDay() === 0 ? 7 : cur.getDay();
        if (weekdays.has(internal)) {
            return { date: cur, daysAway: i };
        }
    }
    return null;
}

function describeNextLecture(next: NextLecture): string {
    if (next.daysAway === 0) return '今天';
    if (next.daysAway === 1) return '明天';
    return `${next.daysAway} 天後`;
}

export default function H18Preview({
    course,
    onOpenCourse,
    onOpenLecture,
    effectiveTheme,
    focusedInboxItem,
    onClearFocus,
}: H18PreviewProps) {
    // ─── focus mode short-circuit ─────────────────────────────────
    // 當 user click inbox row 時，preview 整片變成該 item 的詳情視圖
    // (取代既有的 course-mode 內容)。避免改動既有 course-mode 邏輯。
    if (focusedInboxItem) {
        return (
            <FocusedInboxItemView
                item={focusedInboxItem}
                onClear={onClearFocus ?? (() => undefined)}
                onOpenCourse={onOpenCourse}
                effectiveTheme={effectiveTheme}
            />
        );
    }

    const [lectures, setLectures] = useState<Lecture[]>([]);
    const { settings } = useAppSettings();
    const [previewItem, setPreviewItem] = useState<CanvasPreviewItem | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (!course) {
            setLectures([]);
            return;
        }
        storageService
            .listLecturesByCourse(course.id)
            .then((lst) => {
                if (cancelled) return;
                // newest first
                const sorted = [...lst].sort((a, b) => {
                    const da = new Date(a.date).getTime();
                    const db = new Date(b.date).getTime();
                    return db - da;
                });
                setLectures(sorted);
            })
            .catch((err) => {
                console.warn('[H18Preview] listLecturesByCourse failed:', err);
                if (!cancelled) setLectures([]);
            });
        return () => {
            cancelled = true;
        };
    }, [course?.id]);

    const summary = useMemo(() => {
        const sy = course?.syllabus_info;
        const overview = sy?.overview?.trim();
        const desc = course?.description?.trim();
        return overview || desc || '';
    }, [course]);

    const nextLecture = useMemo(
        () => (course ? computeNextLecture(course) : null),
        [course],
    );

    const lectureCountTotal = course?.syllabus_info?.schedule?.length ?? 0;
    const lectureCountDone = lectures.filter((l) => l.status === 'completed').length;

    // ─── Canvas live data (SWR) ────────────────────────────────────
    // Announcements: per-course feed; cache key keyed by course.id so
    // switching course in preview swaps datasets cleanly.
    const announcementsUrl = course?.syllabus_info?.canvas_announcements_rss?.trim();
    const calendarUrlFromSettings = settings?.integrations?.canvas?.calendar_rss?.trim();
    const annFeed = useCanvasFeed(
        `announcements:${course?.id ?? '_'}`,
        () => fetchAnnouncementsFeed(announcementsUrl!),
        { disabled: !announcementsUrl },
    );
    // Calendar: global feed shared across all courses; same cache key as
    // PIntegrations / virtual-course detection so they stay in sync.
    const calFeed = useCanvasFeed(
        `calendar:global`,
        () => fetchCalendarFeed(calendarUrlFromSettings!),
        { disabled: !calendarUrlFromSettings },
    );

    // Filter calendar events to this course (by canvas_course_id) and
    // upcoming-only (≤ 90 days out, sorted by due date).
    const upcomingEvents: CanvasCalendarEvent[] = useMemo(() => {
        if (!course?.canvas_course_id || !calFeed.data) return [];
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
    }, [calFeed.data, course?.canvas_course_id]);

    const recentAnnouncements: CanvasAnnouncement[] = useMemo(() => {
        if (!annFeed.data) return [];
        return annFeed.data.announcements.slice(0, 3);
    }, [annFeed.data]);

    if (!course) {
        return (
            <div className={s.preview}>
                <div className={s.empty}>
                    <p className={s.emptyTitle}>沒有選課程</p>
                    <p className={s.emptyHint}>
                        從左側 rail 點 course chip 或日曆上的 event 選一門課查看預覽。
                    </p>
                </div>
            </div>
        );
    }

    const color = courseColor(course.id);
    const recent = lectures.slice(0, 3);
    const instructor = course.syllabus_info?.instructor;
    const courseAnnouncementsRss = course.syllabus_info?.canvas_announcements_rss;
    const globalCalendarRss = settings?.integrations?.canvas?.calendar_rss;
    const hasAnnouncementsRss = !!courseAnnouncementsRss?.trim();
    const hasGlobalCalendarRss = !!globalCalendarRss?.trim();
    const isPaired = !!course.canvas_course_id;

    return (
        <div className={s.preview}>
            <div className={s.head}>
                <span
                    className={s.courseChip}
                    style={{ background: color }}
                    title={course.title}
                >
                    {course.title}
                </span>
                {instructor && <span className={s.headMeta}>{instructor}</span>}
                <div className={s.headIcons} aria-hidden>⤺ ⤻ ⋯</div>
            </div>
            <div className={s.body}>
                <h2 className={s.title}>{course.title}</h2>
                <div className={s.subTitle}>
                    {course.syllabus_info?.time || '時間未設定'}
                    {course.syllabus_info?.location ? ` · ${course.syllabus_info.location}` : ''}
                    {' · '}
                    {lectures.length} 堂課
                </div>

                {/* AI 摘要 — 取代原本 description；用 H18 tokens 跟著主題 */}
                <div className={s.aiBox}>
                    <div className={s.aiEyebrow}>
                        ✦ AI 摘要
                        {!summary && ' · 待生成'}
                    </div>
                    {summary ? (
                        <div className={s.aiBody}>{summary}</div>
                    ) : (
                        <div className={`${s.aiBody} ${s.aiBodyDim}`}>
                            還沒生成 — 在「課程編輯」上傳 PDF / 課綱，或按「⟳ 重新生成」就會出現。
                        </div>
                    )}
                </div>

                {/* 待辦 / 提醒 — 下一堂 + 進度 + Canvas RSS 占位 */}
                <div className={s.sectionHead}>待辦 / 提醒</div>
                <div className={s.todoList}>
                    {nextLecture && (
                        <div className={s.todoRow}>
                            <span className={s.todoIcon}>●</span>
                            <span className={s.todoTitle}>下一堂</span>
                            <span className={s.todoMeta}>
                                {describeNextLecture(nextLecture)} ·{' '}
                                {String(nextLecture.date.getMonth() + 1).padStart(2, '0')}/
                                {String(nextLecture.date.getDate()).padStart(2, '0')}
                                {course.syllabus_info?.time && (
                                    <> · {extractTimeRange(course.syllabus_info.time)}</>
                                )}
                            </span>
                        </div>
                    )}
                    {lectureCountTotal > 0 && (
                        <div className={s.todoRow}>
                            <span className={s.todoIcon}>◐</span>
                            <span className={s.todoTitle}>本學期進度</span>
                            <span className={s.todoMeta}>
                                {lectureCountDone} / {lectureCountTotal} 堂
                            </span>
                        </div>
                    )}
                </div>

                {/* Canvas 即將到期 — 從全域 Calendar 抓，依 canvas_course_id 過濾 */}
                {hasGlobalCalendarRss && isPaired && upcomingEvents.length > 0 && (
                    <>
                        <div className={s.sectionHead}>
                            Canvas 即將到期 · {upcomingEvents.length}
                            {calFeed.isFetching && (
                                <span className={s.sectionFetching}> · 更新中…</span>
                            )}
                        </div>
                        <div className={s.todoList}>
                            {upcomingEvents.map((ev) => (
                                <button
                                    type="button"
                                    key={ev.uid}
                                    onClick={() =>
                                        setPreviewItem({ kind: 'event', data: ev })
                                    }
                                    className={`${s.todoRow} ${s.todoRowAction}`}
                                    title={ev.description || ev.rawTitle}
                                >
                                    <span className={s.todoIcon}>⚑</span>
                                    <span className={s.todoTitle}>{ev.title}</span>
                                    <span className={s.todoMeta}>
                                        {formatCalendarDue(ev)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {/* Canvas 公告 — 從 per-course Atom feed 抓 */}
                {hasAnnouncementsRss && recentAnnouncements.length > 0 && (
                    <>
                        <div className={s.sectionHead}>
                            Canvas 公告 · {recentAnnouncements.length}
                            {annFeed.isFetching && (
                                <span className={s.sectionFetching}> · 更新中…</span>
                            )}
                        </div>
                        <div className={s.todoList}>
                            {recentAnnouncements.map((a) => (
                                <button
                                    type="button"
                                    key={a.id}
                                    onClick={() =>
                                        setPreviewItem({ kind: 'announcement', data: a })
                                    }
                                    className={`${s.todoRow} ${s.todoRowAction}`}
                                    title={a.contentText.slice(0, 200)}
                                >
                                    <span className={s.todoIcon}>📢</span>
                                    <span className={s.todoTitle}>{a.title}</span>
                                    <span className={s.todoMeta}>
                                        {formatRelativeTime(a.publishedAt)} · {a.author}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {/* Canvas integration setup hints — 還沒接的話給入口 */}
                {(!hasGlobalCalendarRss || !isPaired || !hasAnnouncementsRss) && (
                    <>
                        <div className={s.sectionHead}>Canvas 整合</div>
                        <div className={s.todoList}>
                            {!hasGlobalCalendarRss && (
                                <div className={s.todoRow} title="到「個人頁 → 整合」填一條全域 Calendar feed">
                                    <span className={s.todoIcon}>○</span>
                                    <span className={s.todoTitle}>行事曆 (全域)</span>
                                    <span className={s.todoMeta}>
                                        未設定 · 個人頁 → 整合
                                    </span>
                                </div>
                            )}
                            {hasGlobalCalendarRss && !isPaired && (
                                <div className={s.todoRow} title="到「個人頁 → 整合」按「⇄ 配對課程」對應這門課">
                                    <span className={s.todoIcon}>◇</span>
                                    <span className={s.todoTitle}>這門課還沒配對 Canvas</span>
                                    <span className={s.todoMeta}>
                                        個人頁 → 整合 → 配對
                                    </span>
                                </div>
                            )}
                            {!hasAnnouncementsRss && (
                                <button
                                    type="button"
                                    onClick={() => onOpenCourse(course.id)}
                                    className={`${s.todoRow} ${s.todoRowAction}`}
                                    title="到「課程編輯」填這門課的 Canvas 公告 RSS URL"
                                >
                                    <span className={s.todoIcon}>＋</span>
                                    <span className={s.todoTitle}>公告 RSS (per-course)</span>
                                    <span className={s.todoMeta}>
                                        未設定 · 點此編輯
                                    </span>
                                </button>
                            )}
                        </div>
                    </>
                )}

                {(annFeed.error || calFeed.error) && (
                    <div className={s.canvasError}>
                        ⚠ Canvas 抓取失敗：{annFeed.error || calFeed.error}
                    </div>
                )}

                {/* 相關筆記 — 最近的 lecture（vs design 的「相關筆記 · 3」） */}
                <div className={s.sectionHead}>相關筆記 · {recent.length}</div>
                <div className={s.lectureList}>
                    {recent.length === 0 && (
                        <div className={s.descMissing} style={{ padding: 8, fontSize: 11 }}>
                            還沒有課堂 — 點 rail 的課程進去新增。
                        </div>
                    )}
                    {recent.map((lec) => (
                        <button
                            type="button"
                            key={lec.id}
                            className={s.lectureRow}
                            onClick={() => onOpenLecture(course.id, lec.id)}
                            title={lec.title}
                        >
                            <span className={s.lectureCode}>{shortDate(lec.date)}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {lec.title}
                            </span>
                            <span className={s.lectureMeta}>
                                {formatDuration(lec.duration)}
                            </span>
                        </button>
                    ))}
                </div>

                <div className={s.actions}>
                    <button
                        type="button"
                        className={s.btnPrimary}
                        onClick={() => onOpenCourse(course.id)}
                    >
                        進課堂列表
                    </button>
                    <button type="button" className={s.btnGhost} disabled title="reminders 後端後啟用">
                        延後
                    </button>
                    <button type="button" className={s.btnGhost} disabled title="reminders 後端後啟用">
                        標記完成
                    </button>
                </div>
            </div>
            <div className={s.foot}>
                <span><span className={s.kbd}>J/K</span> 上下</span>
                <span><span className={s.kbd}>E</span> 完成</span>
                <span><span className={s.kbd}>H</span> 延後</span>
                <span><span className={s.kbd}>⌘/</span> 問 AI</span>
                <span className={s.themeMode}>
                    {effectiveTheme === 'dark' ? '●' : '○'} {effectiveTheme}
                </span>
            </div>

            {previewItem && (
                <CanvasItemPreviewModal
                    item={previewItem}
                    accent={color}
                    courseTitle={course.title}
                    onClose={() => setPreviewItem(null)}
                />
            )}
        </div>
    );
}

function extractTimeRange(timeStr: string): string {
    const m = timeStr.match(/(\d{1,2}:\d{2})\s*[-–~]\s*(\d{1,2}:\d{2})/);
    return m ? `${m[1]}-${m[2]}` : '';
}

function formatCalendarDue(ev: CanvasCalendarEvent): string {
    const d = new Date(ev.startAt);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDay0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((dDay0.getTime() - today0.getTime()) / (1000 * 60 * 60 * 24));
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

/* ════════════════════ Focused inbox item view ════════════════════
 * Phase B (focus mode): preview 整片變成單條 inbox item 的詳情。
 * 對 announcement 渲染 HTML，對 calendar event 渲染 description。
 * Click 內嵌 link 走 Tauri openUrl 不會把 webview 跳走。
 */

function safeHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
        .replace(/javascript\s*:/gi, '');
}

function FocusedInboxItemView({
    item,
    onClear,
    onOpenCourse,
    effectiveTheme,
}: {
    item: InboxItem;
    onClear: () => void;
    onOpenCourse: (courseId: string) => void;
    effectiveTheme: 'light' | 'dark';
}) {
    const externalUrl =
        item.type === 'announcement'
            ? item.rawAnnouncement?.link ?? ''
            : item.rawEvent?.url ?? '';

    const sanitizedHtml = useMemo(() => {
        if (item.type === 'announcement' && item.rawAnnouncement) {
            return safeHtml(item.rawAnnouncement.contentHtml);
        }
        if (item.rawEvent?.descriptionHtml) {
            return safeHtml(item.rawEvent.descriptionHtml);
        }
        return null;
    }, [item]);

    const onContentClick = (e: MouseEvent<HTMLDivElement>) => {
        const t = e.target as HTMLElement;
        const a = t.closest('a[href]') as HTMLAnchorElement | null;
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#')) return;
        void openUrl(href).catch(() => {});
    };

    /* Subscribe to inbox-state events so the badge here stays in sync
     * if user dismisses elsewhere. */
    const [stateTick, setStateTick] = useState(0);
    useEffect(() => {
        const off = subscribeInboxStates(() => setStateTick((n) => n + 1));
        const interval = setInterval(() => setStateTick((n) => n + 1), 60_000);
        return () => {
            off();
            clearInterval(interval);
        };
    }, []);
    const itemState = useMemo(
        () => getInboxState(item.id),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [item.id, stateTick],
    );

    const [snoozeOpen, setSnoozeOpen] = useState(false);
    const presets = useMemo(() => buildSnoozePresets(), [stateTick]);

    const handleDone = () => {
        setInboxDone(item.id);
        onClear();
    };
    const handleSnoozeChoice = (untilMs: number) => {
        setInboxSnooze(item.id, untilMs);
        setSnoozeOpen(false);
        onClear();
    };
    const handleUndo = () => {
        clearInboxState(item.id);
    };

    const whenLabel = (() => {
        if (item.type === 'announcement') {
            const ago = Date.now() - item.when.getTime();
            const m = Math.floor(ago / (1000 * 60));
            if (m < 60) return `${m} 分鐘前`;
            const h = Math.floor(m / 60);
            if (h < 24) return `${h} 小時前`;
            const d = Math.floor(h / 24);
            return `${d} 天前`;
        }
        const days = Math.round(
            (item.when.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );
        const mm = String(item.when.getMonth() + 1).padStart(2, '0');
        const dd = String(item.when.getDate()).padStart(2, '0');
        const time = item.rawEvent?.isAllDay
            ? '整天'
            : `${String(item.when.getHours()).padStart(2, '0')}:${String(item.when.getMinutes()).padStart(2, '0')}`;
        if (days === 0) return `今天 ${time}`;
        if (days === 1) return `明天 ${time}`;
        if (days > 0 && days < 7) return `${days} 天後 · ${mm}/${dd} ${time}`;
        return `${mm}/${dd} ${time}`;
    })();

    return (
        <div className={s.preview}>
            <div className={s.head}>
                <button
                    type="button"
                    onClick={onClear}
                    className={s.focusBackBtn}
                    title="返回首頁概覽"
                >
                    ← 返回
                </button>
                <span
                    className={s.courseChip}
                    style={{ background: item.courseColor }}
                    title={item.courseTitle}
                >
                    {item.courseTitle}
                </span>
                <div className={s.headIcons} aria-hidden>
                    {item.type === 'announcement' ? '📢' : '⚑'}
                </div>
            </div>
            <div className={s.body}>
                <div className={s.focusEyebrow}>
                    {item.type === 'announcement'
                        ? '✦ Canvas 公告'
                        : item.type === 'quiz'
                          ? '⚑ Canvas 小考'
                          : '⚑ Canvas 作業'}
                </div>
                <h2 className={s.title}>{item.title}</h2>
                <div className={s.subTitle}>
                    {item.type === 'announcement'
                        ? `${item.rawAnnouncement?.author ?? ''} · ${whenLabel}`
                        : `截止：${whenLabel}`}
                </div>

                {sanitizedHtml ? (
                    <div
                        className={s.focusHtmlBody}
                        onClick={onContentClick}
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                    />
                ) : item.detail ? (
                    <div className={s.focusPlainBody}>{item.detail}</div>
                ) : (
                    <div className={s.aiBody + ' ' + s.aiBodyDim}>
                        沒附說明 — 點下方「在 Canvas 開啟」看完整內容。
                    </div>
                )}

                {(itemState.state === 'snoozed' && itemState.snoozedUntil) ||
                (itemState.state === 'done' && itemState.markedAt) ? (
                    <div className={s.focusStateBadge}>
                        {itemState.state === 'snoozed' && itemState.snoozedUntil
                            ? `⏰ 推遲到 ${describeSnoozeUntil(itemState.snoozedUntil)}`
                            : `✓ 已完成 · ${describeMarkedAt(itemState.markedAt!)}`}
                        <button
                            type="button"
                            className={s.focusStateUndoBtn}
                            onClick={handleUndo}
                            title="還原為待辦"
                        >
                            ↶ 還原
                        </button>
                    </div>
                ) : null}

                <div className={s.actions}>
                    <button
                        type="button"
                        className={s.btnPrimary}
                        onClick={() => onOpenCourse(item.courseId)}
                    >
                        進這門課
                    </button>
                    {externalUrl && (
                        <button
                            type="button"
                            className={s.btnGhost}
                            onClick={() => void openUrl(externalUrl).catch(() => {})}
                        >
                            在 Canvas 開啟 ↗
                        </button>
                    )}
                    {itemState.state === 'pending' && (
                        <>
                            <button
                                type="button"
                                className={s.btnGhost}
                                onClick={handleDone}
                                title="標記為完成 (E)"
                            >
                                ✓ 完成
                            </button>
                            <div className={s.focusSnoozeWrap}>
                                <button
                                    type="button"
                                    className={s.btnGhost}
                                    onClick={() => setSnoozeOpen((o) => !o)}
                                    title="推遲 (H)"
                                    aria-expanded={snoozeOpen}
                                >
                                    ⏰ 推遲
                                </button>
                                {snoozeOpen && (
                                    <div
                                        className={s.focusSnoozePopover}
                                        role="menu"
                                    >
                                        <div className={s.focusSnoozeHead}>
                                            推遲到
                                        </div>
                                        {presets.map((p) => (
                                            <button
                                                key={p.key}
                                                type="button"
                                                className={s.focusSnoozeOption}
                                                onClick={() =>
                                                    handleSnoozeChoice(p.untilMs)
                                                }
                                                role="menuitem"
                                            >
                                                <span>{p.label}</span>
                                                {p.hint && (
                                                    <span
                                                        className={s.focusSnoozeHint}
                                                    >
                                                        {p.hint}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
            <div className={s.foot}>
                <span className={s.themeMode}>
                    {effectiveTheme === 'dark' ? '●' : '○'} {effectiveTheme}
                </span>
            </div>
        </div>
    );
}
