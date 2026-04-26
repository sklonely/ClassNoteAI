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
 * 留白 (per "沒做的後端就留白"):
 *  - 課堂提醒 (course-scoped Inbox) — reminders schema 沒做
 *  - 已複習 / NEW status per lecture — 沒 reviewed 欄位
 *  - ★ key count per lecture — 沒 concept extraction
 *  - 老師 / 助教 email — 沒儲存
 *  - 加權平均成績 — 沒 grade 欄位
 */

import { useEffect, useMemo, useState } from 'react';
import { storageService } from '../../services/storageService';
import type { Course, Lecture } from '../../types';
import { courseColor } from './courseColor';
import s from './CourseDetailPage.module.css';

export interface CourseDetailPageProps {
    courseId: string;
    onBack: () => void;
    onSelectLecture: (lectureId: string) => void;
    onCreateLecture: () => void;
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

export default function CourseDetailPage({
    courseId,
    onBack,
    onSelectLecture,
    onCreateLecture,
}: CourseDetailPageProps) {
    const [course, setCourse] = useState<Course | null>(null);
    const [lectures, setLectures] = useState<Lecture[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            storageService.getCourse(courseId),
            storageService.listLecturesByCourse(courseId).catch(() => []),
        ])
            .then(([c, lst]) => {
                if (cancelled) return;
                setCourse(c);
                setLectures(lst);
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
    }, [courseId]);

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
                            >
                                ← HOME
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

                    {schedule.length > 0 && schedule.length > sortedLectures.length && (
                        <>
                            <div className={s.lecturesGroupHead}>
                                ○ 未開始 · {schedule.length - sortedLectures.length}
                            </div>
                            <div className={s.lecturesGroup}>
                                {schedule.slice(sortedLectures.length).map((title, i) => {
                                    const n = sortedLectures.length + i + 1;
                                    return (
                                        <div
                                            key={`${n}-${title}`}
                                            className={s.scheduleRow}
                                        >
                                            <span
                                                className={`${s.lectureCode} ${s.lectureCodeMuted}`}
                                            >
                                                L{n}
                                            </span>
                                            <span
                                                className={`${s.lectureRowTitle} ${s.lectureRowTitleMuted}`}
                                            >
                                                {title}
                                            </span>
                                            <span className={s.lectureMeta}>第 {Math.ceil(n / 2) + 1} 週</span>
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

                <div className={s.rightHead}>這堂課的提醒 · 0</div>
                <div className={s.inboxEmpty}>
                    Reminders 後端待開 (作業、老師說、公告、成績…)。
                    <div className={s.inboxTag}>P6.2 · 留白</div>
                </div>

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
        </div>
    );
}
