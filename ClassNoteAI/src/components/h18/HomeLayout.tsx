/**
 * HomeLayout · v0.7.0 Phase 6.2 (variant A)
 *
 * 對應 docs/design/h18-deep/h18-app.jsx HomeLayout (variant A，
 * Q4 lock 為預設)。
 *
 * Variant A：
 *   ┌──────────────────────┬───────────┐
 *   │ Calendar 280px       │           │
 *   ├──────────────────────┤  Preview  │
 *   │                      │  380px    │
 *   │     Inbox            │           │
 *   └──────────────────────┴───────────┘
 *
 * B / C 變體 defer 到 v0.7.x（per plan §3.4）。
 */

import type { Course } from '../../types';
import H18Calendar from './H18Calendar';
import H18Inbox from './H18Inbox';
import H18Preview from './H18Preview';
import s from './HomeLayout.module.css';

export interface HomeLayoutProps {
    courses: Course[];
    selectedCourse: Course | null;
    effectiveTheme: 'light' | 'dark';
    onPickCourse: (courseId: string) => void;
    onOpenCourse: (courseId: string) => void;
    onOpenLecture: (courseId: string, lectureId: string) => void;
}

function todayLabel(): string {
    const d = new Date();
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `週${wd} ${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function HomeLayout({
    courses,
    selectedCourse,
    effectiveTheme,
    onPickCourse,
    onOpenCourse,
    onOpenLecture,
}: HomeLayoutProps) {
    return (
        <div className={s.home}>
            <div className={s.leftCol}>
                <div className={s.calendarSlot}>
                    <div className={s.calendarHead}>
                        <span className={s.calendarTitle}>本週</span>
                        <span className={s.calendarSubtitle}>{todayLabel()}</span>
                    </div>
                    <H18Calendar
                        courses={courses}
                        onPickCourse={onPickCourse}
                    />
                </div>
                <div className={s.inboxSlot}>
                    <H18Inbox />
                </div>
            </div>
            <H18Preview
                course={selectedCourse}
                onOpenCourse={onOpenCourse}
                onOpenLecture={onOpenLecture}
                effectiveTheme={effectiveTheme}
            />
        </div>
    );
}
