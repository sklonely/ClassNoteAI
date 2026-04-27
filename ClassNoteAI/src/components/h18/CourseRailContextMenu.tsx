/**
 * CourseRailContextMenu · v0.7.0
 *
 * 右鍵 H18Rail 課程 chip 跳出來的小 menu。三個動作：
 *   - 編輯 → 跳 CourseEditPage
 *   - 快速錄音 → 建新 lecture + 跳 recording
 *   - 移除 → 兩段確認（不用 window.confirm）
 *
 * Position 由父元件給（client coords）。Esc / 點外面 / blur 都會關閉。
 */

import { useEffect, useRef, useState } from 'react';
import type { Course } from '../../types';
import { courseColor } from './courseColor';
import s from './CourseRailContextMenu.module.css';

export type CourseRailAction = 'edit' | 'quick-record' | 'delete';

export interface CourseRailContextMenuProps {
    course: Course;
    /** Anchor coordinates (clientX / clientY of the contextmenu event). */
    x: number;
    y: number;
    onAction: (action: CourseRailAction) => void;
    onClose: () => void;
}

const MENU_WIDTH = 200;
const MENU_HEIGHT_ESTIMATE = 180; // generous upper bound

export default function CourseRailContextMenu({
    course,
    x,
    y,
    onAction,
    onClose,
}: CourseRailContextMenuProps) {
    const [confirming, setConfirming] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const accent = courseColor(course.id);

    // Position — clamp to viewport so the menu doesn't fall off edges
    const left = Math.min(
        Math.max(8, x),
        Math.max(8, window.innerWidth - MENU_WIDTH - 8),
    );
    const top = Math.min(
        Math.max(8, y),
        Math.max(8, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8),
    );

    // Esc close + outside-click close
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const onDoc = (e: MouseEvent) => {
            if (!ref.current) return;
            if (!ref.current.contains(e.target as Node)) onClose();
        };
        window.addEventListener('keydown', onKey);
        // Use capture phase so we beat any other handlers
        document.addEventListener('mousedown', onDoc, true);
        document.addEventListener('contextmenu', onDoc, true);
        return () => {
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDoc, true);
            document.removeEventListener('contextmenu', onDoc, true);
        };
    }, [onClose]);

    const handle = (action: CourseRailAction) => {
        if (action === 'delete' && !confirming) {
            setConfirming(true);
            return;
        }
        onAction(action);
        onClose();
    };

    return (
        <div
            ref={ref}
            className={s.menu}
            style={{ left, top, width: MENU_WIDTH }}
            role="menu"
        >
            <div className={s.header}>
                <span className={s.headerDot} style={{ background: accent }} />
                <span className={s.headerName} title={course.title}>
                    {course.title}
                </span>
            </div>

            {!confirming ? (
                <>
                    <button
                        type="button"
                        onClick={() => handle('edit')}
                        className={s.item}
                        role="menuitem"
                    >
                        <span className={s.itemIcon}>✎</span>
                        <span>編輯課程</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => handle('quick-record')}
                        className={s.item}
                        role="menuitem"
                    >
                        <span className={s.itemIcon} style={{ color: '#c0392b' }}>
                            ●
                        </span>
                        <span>快速錄音</span>
                        <span className={s.itemHint}>新建 lecture</span>
                    </button>
                    <div className={s.divider} />
                    <button
                        type="button"
                        onClick={() => handle('delete')}
                        className={`${s.item} ${s.itemDanger}`}
                        role="menuitem"
                    >
                        <span className={s.itemIcon}>🗑</span>
                        <span>移除課程</span>
                    </button>
                </>
            ) : (
                <div className={s.confirmBox}>
                    <div className={s.confirmTitle}>確定要移除這門課？</div>
                    <div className={s.confirmDesc}>
                        會移到回收桶，30 天內可從「資料管理」還原。
                    </div>
                    <div className={s.confirmActions}>
                        <button
                            type="button"
                            onClick={() => setConfirming(false)}
                            className={s.confirmCancel}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={() => handle('delete')}
                            className={s.confirmDelete}
                        >
                            移除
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
