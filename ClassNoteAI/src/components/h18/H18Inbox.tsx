/**
 * H18Inbox · v0.7.x
 *
 * 跨所有有 Canvas 配對的 course 顯示「待你處理」清單：
 *   - 即將到期的作業 / 小考
 *   - 最近公告
 *
 * v0.7.x update — 推遲 / 已完成 actionable state:
 *   每條 row 可以 ✓ 標記完成 或 ⏰ 推遲 (1 小時 / 今晚 / 明天 / 1 週).
 *   filter pills: 待辦 / 高優 / 作業 / 公告 / 已推遲 / 已完成。
 *   state 由 inboxStateService 持久化 (localStorage), pubsub 重 render。
 *   snoozedUntil 過期時靠 60s setInterval bump 把 row 推回待辦。
 *
 * 對應 docs/design/h18-deep/h18-inbox-preview.jsx L78-135.
 *
 * 不在這支做（per user spec）：
 *  - 已過未錄 lecture (只在 CourseDetailPage 顯示)
 *  - 老師說 (尚未實作)
 */

import { useEffect, useMemo, useState } from 'react';
import type { Course } from '../../types';
import {
    useAggregatedCanvasInbox,
    type InboxItem,
    type InboxItemGroup,
} from './useAggregatedCanvasInbox';
import { courseColor } from './courseColor';
import InboxRow from './InboxRow';
import {
    clearInboxState,
    getInboxState,
    setInboxDone,
    setInboxSnooze,
    subscribeInboxStates,
    type InboxItemEffectiveState,
    type InboxStateInfo,
} from '../../services/inboxStateService';
import s from './H18Inbox.module.css';

export interface H18InboxProps {
    courses: Course[];
    /** Click 一條 row 後，由父元件決定怎麼處理 (通常: 開 focus modal). */
    onSelectItem?: (item: InboxItem) => void;
    /** Currently focused inbox item id (UI 高亮). */
    selectedItemId?: string;
    /** Click 「下一堂課」sticky row → 父元件建 lecture + 跳 recording page. */
    onStartNextLecture?: (courseId: string) => void;
}

/* ────────── next class helper ──────────
 * Walk forward day-by-day across all courses with parseable `time`,
 * return the earliest upcoming class meeting.
 */
const CN_WEEKDAY: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
};
const EN_WEEKDAY: Record<string, number> = {
    mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};

interface NextClassInfo {
    course: Course;
    courseColor: string;
    date: Date;
    location?: string;
    timeRange: string; // "14:00-15:50"
}

function parseClassTime(time: string): {
    weekdays: Set<number>;
    startHour: number;
    startMin: number;
    endHour: number;
    endMin: number;
} | null {
    if (!time) return null;
    const days = new Set<number>();
    let m: RegExpExecArray | null;
    const cnRe = /(?:週|周|星期)\s*([一二三四五六日天])/g;
    while ((m = cnRe.exec(time))) {
        const w = CN_WEEKDAY[m[1]];
        if (w) days.add(w);
    }
    const enRe = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi;
    while ((m = enRe.exec(time))) {
        const w = EN_WEEKDAY[m[1].toLowerCase()];
        if (w) days.add(w);
    }
    const tm = time.match(/(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})/);
    if (!tm || days.size === 0) return null;
    return {
        weekdays: days,
        startHour: parseInt(tm[1], 10),
        startMin: parseInt(tm[2], 10),
        endHour: parseInt(tm[3], 10),
        endMin: parseInt(tm[4], 10),
    };
}

function findNextClass(courses: Course[]): NextClassInfo | null {
    let best: NextClassInfo | null = null;
    const now = new Date();
    for (const c of courses) {
        const t = c.syllabus_info?.time;
        if (!t) continue;
        const parsed = parseClassTime(t);
        if (!parsed) continue;
        const startBound = c.syllabus_info?.start_date
            ? new Date(c.syllabus_info.start_date)
            : null;
        const endBound = c.syllabus_info?.end_date
            ? new Date(c.syllabus_info.end_date)
            : null;
        const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        for (let i = 0; i < 14; i++) {
            const day = new Date(cur);
            day.setDate(cur.getDate() + i);
            if (
                startBound &&
                day <
                    new Date(
                        startBound.getFullYear(),
                        startBound.getMonth(),
                        startBound.getDate(),
                    )
            )
                continue;
            if (
                endBound &&
                day >
                    new Date(
                        endBound.getFullYear(),
                        endBound.getMonth(),
                        endBound.getDate(),
                    )
            )
                break;
            const wd = day.getDay() === 0 ? 7 : day.getDay();
            if (!parsed.weekdays.has(wd)) continue;
            const meeting = new Date(
                day.getFullYear(),
                day.getMonth(),
                day.getDate(),
                parsed.startHour,
                parsed.startMin,
                0,
                0,
            );
            if (meeting < now) continue;
            const candidate: NextClassInfo = {
                course: c,
                courseColor: '',
                date: meeting,
                location: c.syllabus_info?.location,
                timeRange: `${String(parsed.startHour).padStart(2, '0')}:${String(parsed.startMin).padStart(2, '0')}-${String(parsed.endHour).padStart(2, '0')}:${String(parsed.endMin).padStart(2, '0')}`,
            };
            if (!best || candidate.date < best.date) best = candidate;
            break;
        }
    }
    return best;
}

function describeNextClassWhen(date: Date, now: Date): string {
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
    );
    const days = Math.round(
        (dayOfDate.getTime() - today0.getTime()) / (1000 * 60 * 60 * 24),
    );
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    if (days === 0) {
        const minsUntil = Math.round(
            (date.getTime() - now.getTime()) / (1000 * 60),
        );
        if (minsUntil < 60) return `今天 ${hh}:${mm} · ${minsUntil} 分鐘後`;
        return `今天 ${hh}:${mm}`;
    }
    if (days === 1) return `明天 ${hh}:${mm}`;
    if (days < 7) return `${days} 天後 · ${hh}:${mm}`;
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${m}/${d} ${hh}:${mm}`;
}

/* ────────── filter ────────── */

type FilterKey = 'all' | 'urgent' | 'hw' | 'ann' | 'snoozed' | 'done';

interface FilterDef {
    key: FilterKey;
    label: string;
    /** Section label when this filter is active. */
    emptyTitle: string;
    emptyHint: string;
}

const FILTER_DEFS: FilterDef[] = [
    {
        key: 'all',
        label: '待辦',
        emptyTitle: '沒有待處理',
        emptyHint:
            'Canvas 沒新公告也沒近期到期。\n自動每 60 秒會 refresh 一次。',
    },
    {
        key: 'urgent',
        label: '高優',
        emptyTitle: '沒有高優先項',
        emptyHint: '今天 / 明天到期或新公告會出現在這裡。',
    },
    {
        key: 'hw',
        label: '作業',
        emptyTitle: '沒有作業',
        emptyHint: 'Canvas 上近期沒新作業 / 小考。',
    },
    {
        key: 'ann',
        label: '公告',
        emptyTitle: '沒有公告',
        emptyHint: 'Canvas 上近期沒新公告。',
    },
    {
        key: 'snoozed',
        label: '已推遲',
        emptyTitle: '沒有已推遲項目',
        emptyHint: '對某條 row 按 ⏰ 推遲後會出現在這裡。',
    },
    {
        key: 'done',
        label: '已完成',
        emptyTitle: '沒有已完成項目',
        emptyHint: '對某條 row 按 ✓ 完成後會出現在這裡。',
    },
];

const GROUP_ORDER: InboxItemGroup[] = ['today', 'week', 'ann', 'later'];
const GROUP_LABEL: Record<InboxItemGroup, string> = {
    today: '今天到期',
    week: '本週',
    ann: '最近公告',
    later: '稍後',
};

interface EnrichedItem {
    item: InboxItem;
    state: InboxStateInfo;
}

function matchesFilter(en: EnrichedItem, filter: FilterKey): boolean {
    const eff: InboxItemEffectiveState = en.state.state;
    switch (filter) {
        case 'all':
            return eff === 'pending';
        case 'urgent':
            return eff === 'pending' && en.item.urgent;
        case 'hw':
            return (
                eff === 'pending' &&
                (en.item.type === 'assignment' || en.item.type === 'quiz')
            );
        case 'ann':
            return eff === 'pending' && en.item.type === 'announcement';
        case 'snoozed':
            return eff === 'snoozed';
        case 'done':
            return eff === 'done';
    }
}

export default function H18Inbox({
    courses,
    onSelectItem,
    selectedItemId,
    onStartNextLecture,
}: H18InboxProps) {
    const { items, isFetching, errors } = useAggregatedCanvasInbox(courses);
    const [filter, setFilter] = useState<FilterKey>('all');

    /* Bump on inbox-state change OR every 60s (so snoozed items wake up). */
    const [stateTick, setStateTick] = useState(0);
    useEffect(() => {
        const off = subscribeInboxStates(() => setStateTick((n) => n + 1));
        const interval = setInterval(() => setStateTick((n) => n + 1), 60_000);
        return () => {
            off();
            clearInterval(interval);
        };
    }, []);

    const nextClass = useMemo(() => findNextClass(courses), [courses]);

    /* Resolve effective state for every item; recomputed when items
     * change OR stateTick fires (state event / 60s lazy expiry). */
    const enriched: EnrichedItem[] = useMemo(() => {
        const now = Date.now();
        return items.map((item) => ({
            item,
            state: getInboxState(item.id, now),
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, stateTick]);

    const counts = useMemo(() => {
        const c: Record<FilterKey, number> = {
            all: 0,
            urgent: 0,
            hw: 0,
            ann: 0,
            snoozed: 0,
            done: 0,
        };
        for (const en of enriched) {
            for (const f of FILTER_DEFS) {
                if (matchesFilter(en, f.key)) c[f.key] += 1;
            }
        }
        return c;
    }, [enriched]);

    const filtered = useMemo(
        () => enriched.filter((en) => matchesFilter(en, filter)),
        [enriched, filter],
    );

    /* Groupings differ by filter:
     *   - active filters (all/urgent/hw/ann) — group by InboxItemGroup
     *     (today/week/ann/later)
     *   - snoozed — sort by snoozedUntil ASC (soonest waking first)
     *   - done — sort by markedAt DESC (newest dismissals first)
     */
    const grouped = useMemo(() => {
        if (filter === 'snoozed') {
            const list = [...filtered].sort(
                (a, b) =>
                    (a.state.snoozedUntil ?? 0) - (b.state.snoozedUntil ?? 0),
            );
            return { __flat__: list } as Record<string, EnrichedItem[]>;
        }
        if (filter === 'done') {
            const list = [...filtered].sort(
                (a, b) => (b.state.markedAt ?? 0) - (a.state.markedAt ?? 0),
            );
            return { __flat__: list } as Record<string, EnrichedItem[]>;
        }
        const m: Record<InboxItemGroup, EnrichedItem[]> = {
            today: [],
            week: [],
            ann: [],
            later: [],
        };
        for (const en of filtered) m[en.item.group].push(en);
        return m as Record<string, EnrichedItem[]>;
    }, [filtered, filter]);

    const now = Date.now();
    const hasAnyConfigured = courses.some(
        (c) => c.canvas_course_id || c.syllabus_info?.canvas_announcements_rss,
    );
    const activeFilterDef = FILTER_DEFS.find((f) => f.key === filter)!;
    const isFlatList = filter === 'snoozed' || filter === 'done';

    return (
        <div className={s.inbox}>
            {/* Filters */}
            <div className={s.filters}>
                {FILTER_DEFS.map((f) => (
                    <button
                        type="button"
                        key={f.key}
                        onClick={() => setFilter(f.key)}
                        className={`${s.pill} ${filter === f.key ? s.pillActive : ''}`}
                        title={`${f.label} · ${counts[f.key]}`}
                    >
                        {f.label} · {counts[f.key]}
                    </button>
                ))}
                {isFetching && (
                    <span
                        className={s.fetching}
                        title="正在抓取 Canvas 最新資料"
                    >
                        更新中…
                    </span>
                )}
            </div>

            <div className={s.body}>
                {nextClass && onStartNextLecture && filter === 'all' && (
                    <button
                        type="button"
                        className={s.nextClass}
                        onClick={() => onStartNextLecture(nextClass.course.id)}
                        title="開始這堂課的錄音"
                    >
                        <span className={s.nextClassEyebrow}>下一堂課</span>
                        <div className={s.nextClassRow}>
                            <span
                                className={s.nextClassDot}
                                style={{
                                    background: courseColor(
                                        nextClass.course.id,
                                    ),
                                }}
                            />
                            <div className={s.nextClassMain}>
                                <div className={s.nextClassTitle}>
                                    {nextClass.course.title}
                                </div>
                                <div className={s.nextClassMeta}>
                                    {describeNextClassWhen(
                                        nextClass.date,
                                        new Date(),
                                    )}
                                    {nextClass.timeRange && (
                                        <>
                                            <span className={s.nextClassMetaDot}>
                                                ·
                                            </span>
                                            <span>{nextClass.timeRange}</span>
                                        </>
                                    )}
                                    {nextClass.location && (
                                        <>
                                            <span className={s.nextClassMetaDot}>
                                                ·
                                            </span>
                                            <span className={s.nextClassLoc}>
                                                {nextClass.location}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <span className={s.nextClassCta}>● 開始錄音</span>
                        </div>
                    </button>
                )}

                {filtered.length === 0 && !isFetching && (
                    <div className={s.empty}>
                        <span className={s.emptyIcon}>✉</span>
                        {filter === 'all' && !hasAnyConfigured ? (
                            <>
                                <p className={s.emptyTitle}>
                                    還沒設好 Canvas 整合
                                </p>
                                <p className={s.emptyHint}>
                                    去「個人頁 → 整合」貼 Calendar URL，
                                    然後配對課程才會看到公告 / 作業到期。
                                </p>
                            </>
                        ) : (
                            <>
                                <p className={s.emptyTitle}>
                                    {activeFilterDef.emptyTitle}
                                </p>
                                <p className={s.emptyHint}>
                                    {activeFilterDef.emptyHint}
                                </p>
                            </>
                        )}
                    </div>
                )}

                {/* Active filters — grouped by group bucket */}
                {!isFlatList &&
                    GROUP_ORDER.filter(
                        (g) => g !== 'later' && (grouped[g]?.length ?? 0) > 0,
                    ).map((g) => (
                        <div key={g}>
                            <div className={s.groupHead}>
                                <span>{GROUP_LABEL[g]}</span>
                                <span className={s.groupCount}>
                                    {grouped[g].length}
                                </span>
                                <div className={s.groupRule} />
                            </div>
                            {grouped[g].map((en) => (
                                <InboxRow
                                    key={`${en.item.type}-${en.item.id}`}
                                    item={en.item}
                                    state={en.state}
                                    selected={selectedItemId === en.item.id}
                                    now={now}
                                    onSelect={() => onSelectItem?.(en.item)}
                                    onMarkDone={() =>
                                        setInboxDone(en.item.id)
                                    }
                                    onSnooze={(until) =>
                                        setInboxSnooze(en.item.id, until)
                                    }
                                    onUndo={() =>
                                        clearInboxState(en.item.id)
                                    }
                                />
                            ))}
                        </div>
                    ))}

                {/* Flat list filters (snoozed / done) — single sorted list */}
                {isFlatList && grouped['__flat__']?.length > 0 && (
                    <div>
                        <div className={s.groupHead}>
                            <span>
                                {filter === 'snoozed'
                                    ? '已推遲'
                                    : '已完成'}
                            </span>
                            <span className={s.groupCount}>
                                {grouped['__flat__'].length}
                            </span>
                            <div className={s.groupRule} />
                        </div>
                        {grouped['__flat__'].map((en) => (
                            <InboxRow
                                key={`${en.item.type}-${en.item.id}`}
                                item={en.item}
                                state={en.state}
                                selected={selectedItemId === en.item.id}
                                now={now}
                                onSelect={() => onSelectItem?.(en.item)}
                                onMarkDone={() => setInboxDone(en.item.id)}
                                onSnooze={(until) =>
                                    setInboxSnooze(en.item.id, until)
                                }
                                onUndo={() => clearInboxState(en.item.id)}
                            />
                        ))}
                    </div>
                )}

                {errors.length > 0 && (
                    <div className={s.errorBox}>
                        {errors.slice(0, 3).map((e, i) => (
                            <div key={i}>⚠ {e}</div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
