/**
 * H18 Rail · v0.7.0 Phase 6.1
 *
 * Left 62px vertical icon rail. Source of truth for top-level
 * navigation; replaces the old TopBar nav (上課 / 設置).
 *
 * 對應 docs/design/h18-deep/h18-parts.jsx L106-161.
 *
 * Course chips are dynamic from storageService.listCourses(). Color
 * is hashed from course id (we don't store color column). Per-course
 * urgent badge is fed from H18DeepApp's aggregated Canvas inbox
 * (urgent = due today/tomorrow OR announcement <24h, pending state).
 */

import { useState } from 'react';
import { Home, BookText, Sparkles } from 'lucide-react';
import type { Course } from '../../types';
import type { H18ActiveNav } from '../../types/h18Nav';
import { courseColor, courseShort } from './courseColor';
import CourseRailContextMenu, {
    type CourseRailAction,
} from './CourseRailContextMenu';
import s from './H18Rail.module.css';

export interface H18RailProps {
    activeNav: H18ActiveNav;
    onNav: (target: H18ActiveNav | 'add') => void;
    courses: Course[];
    /**
     * 來自 Canvas 行事曆但本機尚未建立 / 配對的課程，會在 rail 上以
     * dashed 半透明 chip 顯示，提示使用者「這幾門課我知道存在但你還沒設」。
     * 點下去呼叫 onPickVirtualCourse → 父元件開 AddCourseDialog 預填。
     */
    virtualCourses?: { canvasCourseId: string; fullTitle: string }[];
    onPickVirtualCourse?: (canvasCourseId: string, fullTitle: string) => void;
    /** First letter of user display name for avatar (P6.7 will wire). */
    avatarInitial?: string;
    /** 右鍵 course chip 觸發。父元件處理 navigation / DB ops。 */
    onCourseAction?: (courseId: string, action: CourseRailAction) => void;
    /** Per-course urgent badge count (e.g. due today/tomorrow). Empty
     *  / missing entries render no badge. */
    urgentByCourseId?: Map<string, number> | Record<string, number>;
}

interface MenuState {
    courseId: string;
    x: number;
    y: number;
}

export default function H18Rail({
    activeNav,
    onNav,
    courses,
    virtualCourses = [],
    onPickVirtualCourse,
    avatarInitial = 'U',
    onCourseAction,
    urgentByCourseId,
}: H18RailProps) {
    const [menu, setMenu] = useState<MenuState | null>(null);
    const isActive = (key: string) => activeNav === key;
    const isCourseActive = (id: string) => activeNav === `course:${id}`;
    const menuCourse = menu ? courses.find((c) => c.id === menu.courseId) : null;
    const urgentLookup = (id: string): number => {
        if (!urgentByCourseId) return 0;
        if (urgentByCourseId instanceof Map) return urgentByCourseId.get(id) ?? 0;
        return urgentByCourseId[id] ?? 0;
    };

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
                const unread = urgentLookup(c.id);
                return (
                    <button
                        type="button"
                        key={c.id}
                        onClick={() => onNav(`course:${c.id}`)}
                        onContextMenu={(e) => {
                            if (!onCourseAction) return;
                            e.preventDefault();
                            setMenu({ courseId: c.id, x: e.clientX, y: e.clientY });
                        }}
                        title={`${c.title}（右鍵更多操作）`}
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

            {virtualCourses.length > 0 && (
                <>
                    <div className={s.dividerSoft} />
                    {virtualCourses.map((v) => {
                        const initials = canvasInitials(v.fullTitle);
                        return (
                            <button
                                type="button"
                                key={`virtual-${v.canvasCourseId}`}
                                onClick={() =>
                                    onPickVirtualCourse?.(v.canvasCourseId, v.fullTitle)
                                }
                                title={`${v.fullTitle}（從 Canvas 找到，尚未建立本機課；點此建立）`}
                                aria-label={`未配對 Canvas 課程：${v.fullTitle}`}
                                className={s.virtualChip}
                            >
                                {initials}
                                <span className={s.virtualBadge}>?</span>
                            </button>
                        );
                    })}
                </>
            )}

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

            {menu && menuCourse && onCourseAction && (
                <CourseRailContextMenu
                    course={menuCourse}
                    x={menu.x}
                    y={menu.y}
                    onAction={(action) => onCourseAction(menuCourse.id, action)}
                    onClose={() => setMenu(null)}
                />
            )}
        </nav>
    );
}

/**
 * 從 Canvas 全名抽 2 字縮寫給虛擬 chip 用。
 * "HUMAN-COMPUTER INTERACTION (CS_565_001_S2026)" → "HC"
 * 中文不另外處理 (本來就是 sub-string 取前 2 字)，先去掉 (...) 部分。
 */
function canvasInitials(fullTitle: string): string {
    const stripped = fullTitle.replace(/\s*\(.*?\)\s*$/, '').trim();
    const words = stripped.split(/[\s\-_/]+/).filter(Boolean);
    if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return stripped.slice(0, 2).toUpperCase();
}
