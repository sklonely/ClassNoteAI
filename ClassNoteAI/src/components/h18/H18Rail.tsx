/**
 * H18 Rail · v0.7.0 Phase 6.1
 *
 * Left 62px vertical icon rail. Source of truth for top-level
 * navigation; replaces the old TopBar nav (上課 / 設置).
 *
 * 對應 docs/design/h18-deep/h18-parts.jsx L106-161.
 *
 * Course chips are dynamic from storageService.listCourses(). Color
 * is hashed from course id (we don't store color column). Unread
 * badge currently always 0 — wires to a backend that doesn't exist
 * yet (per "留白" rule).
 */

import { Home, BookText, Sparkles } from 'lucide-react';
import type { Course } from '../../types';
import type { H18ActiveNav } from '../../types/h18Nav';
import { courseColor, courseShort } from './courseColor';
import s from './H18Rail.module.css';

export interface H18RailProps {
    activeNav: H18ActiveNav;
    onNav: (target: H18ActiveNav | 'add') => void;
    courses: Course[];
    /** First letter of user display name for avatar (P6.7 will wire). */
    avatarInitial?: string;
}

export default function H18Rail({
    activeNav,
    onNav,
    courses,
    avatarInitial = 'U',
}: H18RailProps) {
    const isActive = (key: string) => activeNav === key;
    const isCourseActive = (id: string) => activeNav === `course:${id}`;

    return (
        <nav className={s.rail} aria-label="主導覽">
            <button
                type="button"
                onClick={() => onNav('home')}
                title="首頁"
                aria-label="首頁"
                className={`${s.item} ${isActive('home') ? s.itemActive : ''}`}
            >
                <Home size={16} />
            </button>
            <button
                type="button"
                onClick={() => onNav('notes')}
                title="知識庫"
                aria-label="知識庫"
                className={`${s.item} ${isActive('notes') ? s.itemActive : ''}`}
            >
                <BookText size={16} />
            </button>

            <div className={s.divider} />

            {courses.map((c) => {
                const color = courseColor(c.id);
                const short = courseShort(c.title, c.keywords);
                const active = isCourseActive(c.id);
                const unread = 0; // 留白：reminders schema 沒做，固定 0
                return (
                    <button
                        type="button"
                        key={c.id}
                        onClick={() => onNav(`course:${c.id}`)}
                        title={c.title}
                        aria-label={c.title}
                        className={`${s.courseChip} ${active ? s.courseChipActive : ''}`}
                        style={{
                            background: `linear-gradient(135deg, ${color}, ${color}c8)`,
                        }}
                    >
                        {short}
                        {unread > 0 && (
                            <span className={s.courseBadge}>{unread}</span>
                        )}
                    </button>
                );
            })}

            <button
                type="button"
                onClick={() => onNav('add')}
                title="新增課程"
                aria-label="新增課程"
                className={s.addChip}
            >
                +
            </button>

            <div className={s.spacer} />

            <button
                type="button"
                onClick={() => onNav('ai')}
                title="AI 助教"
                aria-label="AI 助教"
                className={`${s.item} ${isActive('ai') ? s.itemActive : ''}`}
            >
                <Sparkles size={16} />
            </button>
            <button
                type="button"
                onClick={() => onNav('profile')}
                title="個人頁"
                aria-label="個人頁"
                className={`${s.avatar} ${isActive('profile') ? s.avatarActive : ''}`}
            >
                {avatarInitial}
            </button>
        </nav>
    );
}
