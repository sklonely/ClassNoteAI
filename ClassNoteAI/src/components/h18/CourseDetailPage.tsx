/**
 * H18 CourseDetailPage · v0.7.0 Phase 6.3
 *
 * 對應 docs/design/h18-deep/h18-nav-pages.jsx L283-601 (CourseDetailPage)。
 *
 * 取代 legacy CourseDetailView.tsx。所有資料 wire 到既有 storageService：
 *  - course / syllabus_info → getCourse(id)
 *  - lectures               → listLecturesByCourse(id)
 *  - keywords               → course.keywords (comma string)
 *  - grading                → syllabus_info.grading[]
 *  - schedule               → syllabus_info.schedule[] (字串列表)
 *
 * 已接：
 *  - 課程編輯 → CourseEditPage (✎ 編輯按鈕在 hero)
 *
 * 留白 (per "沒做的後端就留白"):
 *  - 課堂提醒 (course-scoped Inbox) — reminders schema 沒做
 *  - 已複習 / NEW status per lecture — 沒 reviewed 欄位
 *  - ★ key count per lecture — 沒 concept extraction
 *  - 加權平均成績 — 沒 grade 欄位
 */

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { storageService } from '../../services/storageService';
import { toastService } from '../../services/toastService';
import type { Course, Lecture } from '../../types';
import { courseColor } from './courseColor';
import CanvasRemindersPanel from './CanvasRemindersPanel';
import CanvasItemPreviewModal, {
    type CanvasPreviewItem,
} from './CanvasItemPreviewModal';
import { LectureContextMenu } from './LectureContextMenu';
import { LectureEditDialog } from './LectureEditDialog';
import s from './CourseDetailPage.module.css';

export interface CourseDetailPageProps {
    courseId: string;
    onBack: () => void;
    onSelectLecture: (lectureId: string) => void;
    onCreateLecture: () => void;
    onEditCourse: () => void;
}

const GRADING_COLORS = ['#3451b2', '#1f7a4f', '#9e3a24', '#6a3da0', '#1d6477'];

function shortDateLabel(iso?: string): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        const now = new Date();
        const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 0) return '今天';
        if (days === 1) return '昨天';
        if (days < 7) return `${days} 天前`;
        if (days < 30) return `${Math.floor(days / 7)} 週前`;
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

function formatDuration(seconds?: number): string {
    if (!seconds || seconds < 1) return '—';
    const m = Math.floor(seconds / 60);
    return `${m}m`;
}

function totalRecorded(lectures: Lecture[]): string {
    const totalMin = Math.floor(
        lectures.reduce((acc, l) => acc + (l.duration || 0), 0) / 60,
    );
    if (totalMin < 60) return `${totalMin}m`;
    return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

function parsePercent(p?: string): number {
    if (!p) return 0;
    const n = parseFloat(p.replace('%', '').trim());
    return isNaN(n) ? 0 : n;
}

/**
 * Strip date / day-of-week prefix from a schedule entry so the title
 * column can show JUST the topic (date is shown separately in the meta
 * column). Tolerates the formats we see in real AI output:
 *   "Mon 03/30: Introduction" → "Introduction"
 *   "(04/15) Backpropagation" → "Backpropagation"
 *   "週一 03/30: 簡介"          → "簡介"
 *   "Lecture 1"                 → "Lecture 1" (unchanged when no prefix)
 */
function stripScheduleDatePrefix(text: string): string {
    let cleaned = text;
    // Day-of-week (English / Chinese)
    cleaned = cleaned
        .replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|s)?\s*/i, '')
        .replace(/^(?:週|周|星期)[一二三四五六日天]\s*/, '');
    // Date prefix: optional `(`, M/D, optional `)`, optional separator
    cleaned = cleaned.replace(/^\(?\s*\d{1,2}[\/\-]\d{1,2}\s*\)?\s*[:：\-—]?\s*/, '');
    return cleaned.trim() || text;
}

export default function CourseDetailPage({
    courseId,
    onBack,
    onSelectLecture,
    onCreateLecture,
    onEditCourse,
}: CourseDetailPageProps) {
    const [course, setCourse] = useState<Course | null>(null);
    const [lectures, setLectures] = useState<Lecture[]>([]);
    const [allCourses, setAllCourses] = useState<Course[]>([]);
    const [canvasPreview, setCanvasPreview] = useState<CanvasPreviewItem | null>(null);
    const [loading, setLoading] = useState(true);

    /* ────────── S3d: lecture right-click menu state ──────────
     * `menuState` drives the LectureContextMenu (right-click menu) and
     * `editingLecture` opens the LectureEditDialog when the user picks
     * 「編輯」 from that menu. Both clear back to null after the action
     * resolves. `refreshTick` forces the lectures useEffect to re-fetch
     * after a destructive op (delete / move) without us holding stale
     * lists locally — the backend remains the source of truth. */
    const [menuState, setMenuState] = useState<{
        x: number;
        y: number;
        lecture: Lecture;
    } | null>(null);
    const [editingLecture, setEditingLecture] = useState<Lecture | null>(null);
    const [refreshTick, setRefreshTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            storageService.getCourse(courseId),
            storageService.listLecturesByCourse(courseId).catch(() => []),
            // Pull every course so the lecture context-menu's
            // 「移動到其他課程」 submenu has a complete list. Failure
            // here shouldn't break the page — fall back to []。
            storageService.listCourses().catch(() => []),
        ])
            .then(([c, lst, all]) => {
                if (cancelled) return;
                setCourse(c);
                setLectures(lst);
                setAllCourses(all);
            })
            .catch((err) => {
                console.warn('[CourseDetailPage] load failed:', err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [courseId, refreshTick]);

    /* ────────── S3d: handlers ──────────
     * Caller-side responsibilities for LectureContextMenu:
     *   - move : persist new course_id + bump refreshTick (lecture leaves
     *            this page when it moves to another course)
     *   - delete: invoke Rust 'delete_lecture' + bump refreshTick
     *   - edit  : open LectureEditDialog (handled in JSX state)
     *   - rename: stubbed for now — inline rename UX is a follow-up
     */
    const handleContextMenu = (
        e: React.MouseEvent,
        lecture: Lecture,
    ) => {
        e.preventDefault();
        // Stop propagation so H18DeepApp's global text-context-menu listener
        // doesn't ALSO fire on top of our lecture menu.
        e.stopPropagation();
        setMenuState({ x: e.clientX, y: e.clientY, lecture });
    };

    const handleMoveToCourse = async (newCourseId: string) => {
        if (!menuState) return;
        const lec = menuState.lecture;
        // saveLecture demands a full Lecture row; spread + override course_id
        // and updated_at so the backend timestamp reflects the move.
        await storageService.saveLecture({
            ...lec,
            course_id: newCourseId,
            updated_at: new Date().toISOString(),
        });
        // Lecture is no longer in this course's list — refetch the list.
        setRefreshTick((v) => v + 1);
        setMenuState(null);
    };

    const handleDelete = async () => {
        if (!menuState) return;
        try {
            await invoke('delete_lecture', { id: menuState.lecture.id });
            setRefreshTick((v) => v + 1);
            toastService.success(
                '已刪除',
                `「${menuState.lecture.title}」已移到垃圾桶`,
            );
        } catch (err) {
            toastService.error('刪除失敗', String(err));
        } finally {
            setMenuState(null);
        }
    };

    const handleEditSubmit = async (updates: {
        title: string;
        date: string;
        course_id: string;
        keywords: string[];
    }) => {
        if (!editingLecture) return;
        await storageService.saveLecture({
            ...editingLecture,
            title: updates.title,
            date: updates.date,
            course_id: updates.course_id,
            keywords: updates.keywords.join(', '),
            updated_at: new Date().toISOString(),
        });
        setRefreshTick((v) => v + 1);
    };

    const color = courseColor(courseId);
    const gradient = `linear-gradient(135deg, ${color}, ${color}dd)`;

    const sortedLectures = useMemo(
        () =>
            [...lectures].sort((a, b) => {
                const da = new Date(a.date).getTime();
                const db = new Date(b.date).getTime();
                return db - da;
            }),
        [lectures],
    );

    const completedCount = sortedLectures.filter((l) => l.status === 'completed').length;
    const inProgress = sortedLectures.find((l) => l.status === 'recording') ?? null;

    const schedule = course?.syllabus_info?.schedule || [];
    const grading = course?.syllabus_info?.grading || [];
    const instructor = course?.syllabus_info?.instructor;
    const tas = course?.syllabus_info?.teaching_assistants;
    const keywords = (course?.keywords || '')
        .split(/[,，、]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

    const progressPct = schedule.length > 0
        ? Math.round((completedCount / schedule.length) * 100)
        : 0;

    /* ────────── schedule slot date awareness ──────────
     * 之前 schedule 的後半段都歸「未開始」— 但很多 case 是日期已過卻沒
     * 對應的 Lecture 行 (= 沒錄音 / 沒匯入)。把這類 row 拆出來歸「已過未錄」
     * 顯示，UX 才不會誤導。
     *
     * Date 來源（依優先順序）：
     *   1. entry 字串前 30 chars 內的 MM/DD pattern（容錯多格式：
     *      `(04/15) topic` / `Mon 04/15: topic` / `04/15 - topic`）
     *   2. 沒 match 時，從 course.start_date + 上課 weekdays + index 推算
     *      (e.g. start 3/30 + 週一/三 + L7 → 推算 4/20)
     *   3. 都不行就 null（顯示「日期未明」走 ordinal fallback）
     */
    const today0 = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    const yearHint = useMemo(() => {
        const sd = course?.syllabus_info?.start_date;
        if (sd) {
            const d = new Date(sd);
            if (!isNaN(d.getTime())) return d.getFullYear();
        }
        return today0.getFullYear();
    }, [course?.syllabus_info?.start_date, today0]);

    // Pre-compute meeting weekdays + start date for inference fallback.
    const meetingContext = useMemo(() => {
        const sd = course?.syllabus_info?.start_date;
        const time = course?.syllabus_info?.time || '';
        if (!sd || !time) return null;
        const start = new Date(sd);
        if (isNaN(start.getTime())) return null;
        // ISO weekday: Mon=1..Sun=7
        const weekdays = new Set<number>();
        const cnTable: Record<string, number> = {
            '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
        };
        const enTable: Record<string, number> = {
            mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
        };
        const cnRe = /(?:週|周|星期)\s*([一二三四五六日天])/g;
        const enRe = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi;
        let m: RegExpExecArray | null;
        while ((m = cnRe.exec(time))) {
            const w = cnTable[m[1]];
            if (w) weekdays.add(w);
        }
        while ((m = enRe.exec(time))) {
            const w = enTable[m[1].toLowerCase()];
            if (w) weekdays.add(w);
        }
        if (weekdays.size === 0) return null;
        return {
            startDay: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
            weekdays,
        };
    }, [course?.syllabus_info?.start_date, course?.syllabus_info?.time]);

    /**
     * Walk forward day-by-day from start, count meeting days; return the
     * date corresponding to the n-th meeting (1-based). Capped at 365 days
     * to avoid infinite loops on malformed input.
     */
    const inferScheduleDate = (n: number): Date | null => {
        if (!meetingContext || n < 1) return null;
        const { startDay, weekdays } = meetingContext;
        const cur = new Date(startDay.getTime());
        let count = 0;
        for (let i = 0; i < 365; i++) {
            const isoWd = cur.getDay() === 0 ? 7 : cur.getDay();
            if (weekdays.has(isoWd)) {
                count++;
                if (count === n) {
                    return new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
                }
            }
            cur.setDate(cur.getDate() + 1);
        }
        return null;
    };

    /**
     * Parse MM/DD from the first 30 chars of an entry. Tolerates formats
     * we've seen in real AI output: `(MM/DD) ...`, `Mon MM/DD: ...`,
     * `MM/DD - ...`. Rejects month/day out of range to dodge false
     * positives like "Chapter 4/5".
     */
    const parseDateFromText = (text: string): Date | null => {
        const head = text.slice(0, 30);
        const m = head.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
        if (!m) return null;
        const month = parseInt(m[1], 10) - 1;
        const day = parseInt(m[2], 10);
        if (month < 0 || month > 11 || day < 1 || day > 31) return null;
        return new Date(yearHint, month, day);
    };

    interface ScheduleSlot {
        text: string;
        index: number; // 1-based across full schedule (matches L{N})
        date: Date | null;
        dateSource: 'parsed' | 'inferred' | 'none';
        isPast: boolean;
    }

    const unmatchedSlots: ScheduleSlot[] = useMemo(() => {
        return schedule.slice(sortedLectures.length).map((text, i) => {
            const index = sortedLectures.length + i + 1;
            let date = parseDateFromText(text);
            let dateSource: ScheduleSlot['dateSource'] = date ? 'parsed' : 'none';
            if (!date) {
                const inferred = inferScheduleDate(index);
                if (inferred) {
                    date = inferred;
                    dateSource = 'inferred';
                }
            }
            return {
                text,
                index,
                date,
                dateSource,
                isPast: !!(date && date < today0),
            };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [schedule, sortedLectures.length, yearHint, today0, meetingContext]);

    const pastUncoveredSlots = unmatchedSlots.filter((s) => s.isPast);
    const futureSlots = unmatchedSlots.filter((s) => !s.isPast);

    /**
     * Click handler for "已過未錄" rows — creates a lecture record for
     * the slot (status=completed, date set to slot date so it sorts back
     * with the other completed lectures), then navigates to it. User can
     * then drag-drop a recording / type notes there.
     *
     * Dedup: if a lecture already exists on the slot's date, jump to it
     * instead of creating a duplicate.
     */
    const handleOpenPastSlot = async (slot: ScheduleSlot) => {
        const slotIso = slot.date ? slot.date.toISOString() : new Date().toISOString();
        const slotDayKey = slotIso.slice(0, 10); // YYYY-MM-DD
        const existing = sortedLectures.find(
            (l) => l.date && l.date.slice(0, 10) === slotDayKey,
        );
        if (existing) {
            onSelectLecture(existing.id);
            return;
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const cleanTitle = stripScheduleDatePrefix(slot.text) || `Lecture ${slot.index}`;
        try {
            await storageService.saveLecture({
                id,
                course_id: courseId,
                title: cleanTitle,
                date: slotIso,
                duration: 0,
                // 已過時間，建立成 completed → review 頁面接 import audio / notes
                status: 'completed',
                created_at: now,
                updated_at: now,
            });
            onSelectLecture(id);
        } catch (err) {
            console.error('[CourseDetailPage] create past lecture failed:', err);
        }
    };

    if (loading) {
        return (
            <div className={s.page}>
                <div className={s.notFound}>載入中…</div>
            </div>
        );
    }
    if (!course) {
        return (
            <div className={s.page}>
                <div className={s.notFound}>
                    找不到這門課（可能被刪除）。
                    <br />
                    <button onClick={onBack} className={s.crumbBack} style={{ marginTop: 12, background: 'var(--h18-invert)', color: 'var(--h18-invert-ink)' }}>
                        返回首頁
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={s.page}>
            <div className={s.left}>
                {/* Hero */}
                <div className={s.hero} style={{ background: gradient }}>
                    <div className={s.heroHeadRow}>
                        <div className={s.crumb}>
                            <button
                                type="button"
                                onClick={onBack}
                                className={s.crumbBack}
                                title="返回首頁"
                            >
                                ← 首頁
                            </button>
                            <span className={s.crumbDivider}>/</span>
                            <span style={{ fontWeight: 700, opacity: 0.95 }}>{course.title}</span>
                        </div>
                        {(instructor || schedule.length > 0) && (
                            <span className={s.crumbExtra}>
                                {[
                                    instructor,
                                    schedule.length > 0 ? `${schedule.length} 週` : null,
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={onEditCourse}
                            className={s.editCourseBtn}
                            title="編輯課程資訊"
                        >
                            ✎ 編輯
                        </button>
                    </div>
                    <h1 className={s.heroTitle}>{course.title}</h1>
                    <div className={s.heroStats}>
                        <div className={s.heroStat}>
                            <b className={s.heroStatNum}>{completedCount}</b>
                            {schedule.length > 0 && (
                                <span className={s.heroStatTotal}> / {schedule.length}</span>
                            )}
                            <span> lectures</span>
                        </div>
                        <div className={s.heroStat}>
                            <b className={s.heroStatNum}>{totalRecorded(sortedLectures)}</b> 已錄
                        </div>
                        {schedule.length > 0 && (
                            <div className={s.heroStat}>
                                <b className={s.heroStatNum}>{progressPct}%</b> 進度
                            </div>
                        )}
                        <div className={s.heroStat}>
                            <b className={s.heroStatNum}>—</b>{' '}
                            <span style={{ opacity: 0.6 }}>成績待接</span>
                        </div>
                    </div>
                </div>

                {/* Next lecture / start recording */}
                <div className={s.section}>
                    <div className={s.sectionEyebrow}>
                        {inProgress ? '進行中' : '下一堂'}
                    </div>
                    <div
                        className={s.nextCard}
                        style={{
                            background: 'var(--h18-surface2)',
                        }}
                    >
                        <div className={s.nextNum} style={{ background: color }}>
                            {inProgress ? 'REC' : '+'}
                        </div>
                        <div className={s.nextBody}>
                            <p className={s.nextTitle}>
                                {inProgress
                                    ? inProgress.title
                                    : sortedLectures.length === 0
                                      ? '還沒有任何課堂'
                                      : '新增下一堂'}
                            </p>
                            <div className={s.nextMeta}>
                                {inProgress
                                    ? `錄音中 · ${shortDateLabel(inProgress.date)}`
                                    : course.syllabus_info?.time
                                      ? course.syllabus_info.time
                                      : '時間未設定'}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={
                                inProgress
                                    ? () => onSelectLecture(inProgress.id)
                                    : onCreateLecture
                            }
                            className={s.nextRecord}
                        >
                            {inProgress ? '繼續 →' : '新增 →'}
                        </button>
                    </div>
                </div>

                {/* Lectures list */}
                <div className={`${s.section} ${s.sectionLast}`}>
                    <div className={s.lecturesHead}>
                        <div className={s.sectionEyebrow}>
                            完整課綱 · {Math.max(schedule.length, sortedLectures.length)} 項
                        </div>
                        <div className={s.lecturesSub}>
                            {completedCount} 已完成
                            {inProgress ? ' · 1 進行中' : ''}
                            {schedule.length > sortedLectures.length
                                ? ` · ${schedule.length - sortedLectures.length} 未開始`
                                : ''}
                        </div>
                    </div>

                    {sortedLectures.length > 0 && (
                        <>
                            <div className={s.lecturesGroupHead}>
                                ● 已完成 · {completedCount}
                            </div>
                            <div className={s.lecturesGroup}>
                                {sortedLectures.filter((l) => l.status === 'completed').map((lec, idx) => {
                                    const n = sortedLectures.length - idx;
                                    return (
                                        <button
                                            type="button"
                                            key={lec.id}
                                            className={s.lectureRow}
                                            onClick={() => onSelectLecture(lec.id)}
                                            onContextMenu={(e) => handleContextMenu(e, lec)}
                                            title={lec.title}
                                        >
                                            <span
                                                className={s.lectureCode}
                                                style={{ color }}
                                            >
                                                L{n}
                                            </span>
                                            <span className={s.lectureRowTitle}>
                                                {lec.title}
                                            </span>
                                            <span className={s.lectureMeta}>
                                                {shortDateLabel(lec.date)} · {formatDuration(lec.duration)}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {pastUncoveredSlots.length > 0 && (
                        <>
                            <div className={s.lecturesGroupHead}>
                                ⚠ 已過未錄 · {pastUncoveredSlots.length}
                            </div>
                            <div className={s.lecturesGroup}>
                                {pastUncoveredSlots.map((slot) => {
                                    const cleanTitle = stripScheduleDatePrefix(slot.text);
                                    const daysAgo = slot.date
                                        ? Math.round(
                                              (today0.getTime() - slot.date.getTime()) /
                                                  (1000 * 60 * 60 * 24),
                                          )
                                        : null;
                                    return (
                                        <button
                                            type="button"
                                            key={`past-${slot.index}-${slot.text}`}
                                            className={`${s.lectureRow} ${s.scheduleRowPast}`}
                                            onClick={() => handleOpenPastSlot(slot)}
                                            title="點開：建立這堂課的紀錄頁，可匯入錄音 / 寫筆記"
                                        >
                                            <span className={s.lectureCode}>
                                                L{slot.index}
                                            </span>
                                            <span className={s.lectureRowTitle}>
                                                {cleanTitle}
                                            </span>
                                            <span className={s.dateCol}>
                                                {slot.date ? (
                                                    <>
                                                        <span className={s.dateColMain}>
                                                            {`${slot.date.getMonth() + 1}/${slot.date.getDate()}`}
                                                        </span>
                                                        <span className={s.dateColRel}>
                                                            {daysAgo === 0
                                                                ? '今天'
                                                                : `${daysAgo} 天前`}
                                                            {slot.dateSource === 'inferred' && ' · 推算'}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className={s.dateColRel}>
                                                        日期未明
                                                    </span>
                                                )}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {futureSlots.length > 0 && (
                        <>
                            <div className={s.lecturesGroupHead}>
                                ○ 未開始 · {futureSlots.length}
                            </div>
                            <div className={s.lecturesGroup}>
                                {futureSlots.map((slot) => {
                                    const cleanTitle = stripScheduleDatePrefix(slot.text);
                                    const days = slot.date
                                        ? Math.round(
                                              (slot.date.getTime() - today0.getTime()) /
                                                  (1000 * 60 * 60 * 24),
                                          )
                                        : null;
                                    const relLabel = (() => {
                                        if (days == null) return null;
                                        if (days === 0) return '今天';
                                        if (days === 1) return '明天';
                                        if (days < 7) return `${days} 天後`;
                                        if (days < 14) return '下週';
                                        return `${days} 天後`;
                                    })();
                                    return (
                                        <div
                                            key={`fut-${slot.index}-${slot.text}`}
                                            className={s.scheduleRow}
                                        >
                                            <span
                                                className={`${s.lectureCode} ${s.lectureCodeMuted}`}
                                            >
                                                L{slot.index}
                                            </span>
                                            <span
                                                className={`${s.lectureRowTitle} ${s.lectureRowTitleMuted}`}
                                            >
                                                {cleanTitle}
                                            </span>
                                            <span className={s.dateCol}>
                                                {slot.date ? (
                                                    <>
                                                        <span className={s.dateColMain}>
                                                            {`${slot.date.getMonth() + 1}/${slot.date.getDate()}`}
                                                        </span>
                                                        <span className={s.dateColRel}>
                                                            {relLabel}
                                                            {slot.dateSource === 'inferred' && ' · 推算'}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className={s.dateColRel}>
                                                        第 {Math.ceil(slot.index / 2)} 週
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}

                    {sortedLectures.length === 0 && schedule.length === 0 && (
                        <div className={s.emptyLectures}>
                            還沒有課堂跟課綱 — 新增第一堂課，或在課程編輯填入課綱大綱。
                        </div>
                    )}
                </div>
            </div>

            {/* Right side panels */}
            <div className={s.right}>
                {grading.length > 0 && (
                    <>
                        <div className={s.rightHead}>評分組成</div>
                        <div className={s.gradeCard}>
                            <div className={s.gradeBar}>
                                {grading.map((g, i) => (
                                    <div
                                        key={i}
                                        className={s.gradeSeg}
                                        style={{
                                            width: `${parsePercent(g.percentage)}%`,
                                            background:
                                                GRADING_COLORS[i % GRADING_COLORS.length],
                                        }}
                                    />
                                ))}
                            </div>
                            {grading.map((g, i) => (
                                <div key={i} className={s.gradeRow}>
                                    <span
                                        className={s.gradeDot}
                                        style={{
                                            background:
                                                GRADING_COLORS[i % GRADING_COLORS.length],
                                        }}
                                    />
                                    <span className={s.gradeName}>{g.item}</span>
                                    <span className={s.gradePct}>{g.percentage}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <div className={s.rightHead}>這堂課的提醒</div>
                <CanvasRemindersPanel
                    course={course}
                    onPickEvent={(ev) =>
                        setCanvasPreview({ kind: 'event', data: ev })
                    }
                    onPickAnnouncement={(a) =>
                        setCanvasPreview({ kind: 'announcement', data: a })
                    }
                    onEditCourse={onEditCourse}
                />

                {keywords.length > 0 && (
                    <>
                        <div className={s.rightHead}>關鍵字 · 常出現</div>
                        <div className={s.kwBox}>
                            {keywords.map((k) => (
                                <span key={k} className={s.kw}>
                                    {k}
                                </span>
                            ))}
                        </div>
                    </>
                )}

                {(instructor || tas) && (
                    <>
                        <div className={s.rightHead}>助教 / 老師</div>
                        <div className={s.peopleBox}>
                            {instructor && (
                                <div className={s.personRow}>
                                    <div className={s.personAvatar}>
                                        {instructor.charAt(0)}
                                    </div>
                                    <div>
                                        <div className={s.personName}>{instructor}</div>
                                        <div className={s.personRole}>教授</div>
                                    </div>
                                </div>
                            )}
                            {tas && (
                                <div className={s.personRow}>
                                    <div className={s.personAvatar}>TA</div>
                                    <div>
                                        <div className={s.personName}>{tas}</div>
                                        <div className={s.personRole}>助教</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {canvasPreview && (
                <CanvasItemPreviewModal
                    item={canvasPreview}
                    accent={color}
                    courseTitle={course.title}
                    onClose={() => setCanvasPreview(null)}
                />
            )}

            {/* S3d: lecture right-click menu */}
            {menuState && (
                <LectureContextMenu
                    lecture={menuState.lecture}
                    courses={allCourses}
                    x={menuState.x}
                    y={menuState.y}
                    onClose={() => setMenuState(null)}
                    onEdit={() => {
                        setEditingLecture(menuState.lecture);
                        setMenuState(null);
                    }}
                    onRename={() => {
                        // Inline rename UX is a follow-up — use 編輯 dialog
                        // for now so the menu hand-off is still useful.
                        setEditingLecture(menuState.lecture);
                        setMenuState(null);
                    }}
                    onMoveToCourse={handleMoveToCourse}
                    onDelete={handleDelete}
                />
            )}

            {editingLecture && (
                <LectureEditDialog
                    isOpen={!!editingLecture}
                    lecture={editingLecture}
                    courses={allCourses.length > 0 ? allCourses : [course]}
                    onClose={() => setEditingLecture(null)}
                    onSubmit={handleEditSubmit}
                />
            )}
        </div>
    );
}
