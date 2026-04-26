/**
 * HomeLayout · v0.7.0 — A/B/C variants
 *
 * 對應 docs/design/h18-deep/h18-app.jsx HomeLayout L66-145.
 *
 * Variant A (預設)：
 *   ┌──────────────────────┬───────────┐
 *   │ Calendar 280px       │           │
 *   ├──────────────────────┤  Preview  │
 *   │ Inbox                │  380px    │
 *   └──────────────────────┴───────────┘
 *
 * Variant B (Inbox 為主)：
 *   ┌──────────────────────┬───────────┐
 *   │                      │ Today 260 │
 *   │ Inbox 滿版            ├───────────┤
 *   │                      │ Preview   │
 *   └──────────────────────┴───────────┘
 *
 * Variant C (行事曆為主)：
 *   ┌──────────────────────┬───────────┐
 *   │ 本週行事曆 大版        │ Inbox     │
 *   │                      │ 440px     │
 *   └──────────────────────┴───────────┘
 */

import type { Course } from '../../types';
import H18Calendar from './H18Calendar';
import H18Inbox from './H18Inbox';
import H18Preview from './H18Preview';
import s from './HomeLayout.module.css';

export type HomeVariant = 'A' | 'B' | 'C';

export interface HomeLayoutProps {
    courses: Course[];
    selectedCourse: Course | null;
    effectiveTheme: 'light' | 'dark';
    variant?: HomeVariant;
    onPickCourse: (courseId: string) => void;
    onOpenCourse: (courseId: string) => void;
    onOpenLecture: (courseId: string, lectureId: string) => void;
}

function todayLabel(): string {
    const d = new Date();
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `週${wd} ${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function weekRange(): string {
    const d = new Date();
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (x: Date) =>
        `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
    return `${fmt(monday)} → ${fmt(sunday)}`;
}

export default function HomeLayout({
    courses,
    selectedCourse,
    effectiveTheme,
    variant = 'A',
    onPickCourse,
    onOpenCourse,
    onOpenLecture,
}: HomeLayoutProps) {
    const calendar = (compact = false, onlyToday = false) => (
        <H18Calendar
            courses={courses}
            onPickCourse={onPickCourse}
            onlyToday={onlyToday}
            compact={compact}
        />
    );
    const inbox = <H18Inbox />;
    const preview = (
        <H18Preview
            course={selectedCourse}
            onOpenCourse={onOpenCourse}
            onOpenLecture={onOpenLecture}
            effectiveTheme={effectiveTheme}
        />
    );

    if (variant === 'B') {
        return (
            <div className={`${s.home} ${s.homeB}`}>
                {/* 左：Inbox 滿版 */}
                <div className={s.inboxFull}>{inbox}</div>
                {/* 右：Today calendar 260 + Preview */}
                <div className={s.rightCol}>
                    <div className={s.todaySlot}>
                        <div className={s.calendarHead}>
                            <span className={s.calendarTitle}>今日</span>
                            <span className={s.calendarSubtitle}>{todayLabel()}</span>
                        </div>
                        {calendar(true, true)}
                    </div>
                    <div className={s.previewSlot}>{preview}</div>
                </div>
            </div>
        );
    }

    if (variant === 'C') {
        return (
            <div className={`${s.home} ${s.homeC}`}>
                {/* 左：大週曆 */}
                <div className={s.bigCalSlot}>
                    <div className={s.bigCalHead}>
                        <span className={s.bigCalTitle}>本週行事曆</span>
                        <span className={s.calendarSubtitle}>{weekRange()}</span>
                    </div>
                    {calendar()}
                </div>
                {/* 右：Inbox 440px */}
                <div className={s.inboxSide}>{inbox}</div>
            </div>
        );
    }

    // Variant A (預設)
    return (
        <div className={s.home}>
            <div className={s.leftCol}>
                <div className={s.calendarSlot}>
                    <div className={s.calendarHead}>
                        <span className={s.calendarTitle}>本週</span>
                        <span className={s.calendarSubtitle}>{todayLabel()}</span>
                    </div>
                    {calendar()}
                </div>
                <div className={s.inboxSlot}>{inbox}</div>
            </div>
            {preview}
        </div>
    );
}
