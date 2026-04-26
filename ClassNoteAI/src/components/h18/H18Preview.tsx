/**
 * H18Preview · v0.7.0 Phase 6.2
 *
 * 對應 docs/design/h18-deep/h18-inbox-preview.jsx L137-260.
 *
 * 接得到後端的：title / instructor / description / 最近 3 個 lecture。
 * 留白：
 *  - reminders 相關 (HW3 / 截止 / 預估時間 / urgency bar) — 沒 schema
 *  - AI 摘要 — 之後接 lecture summarizer，現在顯示 empty state
 *  - 鍵盤快速鍵 footer 顯示但 disable
 */

import { useEffect, useState } from 'react';
import { storageService } from '../../services/storageService';
import type { Course, Lecture } from '../../types';
import { courseColor } from './courseColor';
import s from './H18Preview.module.css';

export interface H18PreviewProps {
    course: Course | null;
    onOpenCourse: (courseId: string) => void;
    onOpenLecture: (courseId: string, lectureId: string) => void;
    effectiveTheme: 'light' | 'dark';
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

export default function H18Preview({
    course,
    onOpenCourse,
    onOpenLecture,
    effectiveTheme,
}: H18PreviewProps) {
    const [lectures, setLectures] = useState<Lecture[]>([]);

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
    const top3 = lectures.slice(0, 3);
    const instructor = course.syllabus_info?.instructor;

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

                {course.description ? (
                    <div className={s.descBox}>{course.description}</div>
                ) : (
                    <div className={`${s.descBox} ${s.descMissing}`}>
                        課程描述空白 — 在課程編輯填入後會顯示。
                    </div>
                )}

                <div className={s.sectionHead}>最近課堂 · {top3.length}</div>
                <div className={s.lectureList}>
                    {top3.length === 0 && (
                        <div className={s.descMissing} style={{ padding: 8, fontSize: 11 }}>
                            還沒有課堂 — 點 rail 的課程進去新增。
                        </div>
                    )}
                    {top3.map((lec) => (
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

                <div className={s.aiBox}>
                    <div className={s.aiEyebrow}>✦ AI 摘要 · 待生成</div>
                    <div className={`${s.aiBody} ${s.aiBodyDim}`}>
                        AI 摘要尚未串接到 lecture summarizer — 這個區塊會在 P6.4 review 之後生效。
                    </div>
                    <div className={s.aiActions}>
                        <button type="button" className={s.aiBtn} disabled>跳到第一個重點</button>
                        <button type="button" className={s.aiBtn} disabled>問 AI 追問</button>
                    </div>
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
        </div>
    );
}
