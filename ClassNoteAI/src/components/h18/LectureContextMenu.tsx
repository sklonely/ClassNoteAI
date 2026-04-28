/**
 * LectureContextMenu · Phase 7 Sprint 3 Round 3 (S3d)
 *
 * Right-click menu shown when the user right-clicks a lecture row in
 * CourseDetailPage. Wraps the generic H18ContextMenu (S3b-1) with the
 * lecture-specific item set required by PHASE-7-PLAN §3d + F3 + U6.
 *
 * Items (top → bottom):
 *   1. 編輯              — caller opens LectureEditDialog (S3c-2)
 *   2. 重新命名           — caller toggles inline rename state
 *   3. 匯出 ▸             — submenu: SRT 字幕 / Markdown
 *                           leaves call exportService.exportLecture()
 *                           directly; result is reported via toastService
 *   4. 移動到其他課程 ▸   — submenu lists every course OTHER than the
 *                           lecture's current course; selecting one calls
 *                           onMoveToCourse(newCourseId)
 *   5. ─sep
 *   6. 刪除               — confirmService.ask first; if user confirms,
 *                           onDelete() is awaited (caller drives the
 *                           actual storage call + list refresh)
 *
 * Notes on design:
 *   - The submenu leaves intentionally call services (export / toast /
 *     confirm) themselves. This keeps the integration site (CourseDetailPage)
 *     thin: callers only own the bits that touch their local state
 *     (open dialog, set inline rename, refresh lecture list, navigate).
 *   - H18ContextMenu already calls onClose after a leaf click, so we
 *     don't need to call it manually inside any onClick.
 *   - U6 hover-to-open submenu is already implemented in H18ContextMenu;
 *     no extra wiring needed here.
 */

import { exportLecture } from '../../services/exportService';
import { toastService } from '../../services/toastService';
import { confirmService } from '../../services/confirmService';
import { H18ContextMenu, type H18ContextMenuItem } from './H18ContextMenu';
import type { Course, Lecture } from '../../types';

export interface LectureContextMenuProps {
    lecture: Lecture;
    /**
     * Full course list — used to populate the 「移動到其他課程」 submenu.
     * The lecture's own course is filtered out at render time.
     */
    courses: Course[];
    x: number;
    y: number;
    onClose: () => void;
    /** Caller opens LectureEditDialog. */
    onEdit: () => void;
    /** Caller toggles inline rename mode for the lecture row. */
    onRename: () => void;
    /**
     * Caller persists the move (saveLecture w/ new course_id) + refreshes
     * the lecture list / navigates. Throwing surfaces a toast.error here.
     */
    onMoveToCourse: (newCourseId: string) => Promise<void>;
    /**
     * Caller persists the delete (invoke('delete_lecture', ...)) + refreshes
     * the list. Confirmation is handled inside this menu before calling.
     */
    onDelete: () => Promise<void>;
}

export function LectureContextMenu({
    lecture,
    courses,
    x,
    y,
    onClose,
    onEdit,
    onRename,
    onMoveToCourse,
    onDelete,
}: LectureContextMenuProps) {
    const moveSubmenu: H18ContextMenuItem[] = courses
        .filter((c) => c.id !== lecture.course_id)
        .map((c) => ({
            id: `move-${c.id}`,
            label: c.title,
            onClick: async () => {
                try {
                    await onMoveToCourse(c.id);
                    toastService.success('已移動', `已移到「${c.title}」`);
                } catch (err) {
                    toastService.error('移動失敗', String(err));
                }
            },
        }));

    const items: H18ContextMenuItem[] = [
        {
            id: 'edit',
            label: '編輯',
            onClick: onEdit,
        },
        {
            id: 'rename',
            label: '重新命名',
            onClick: onRename,
        },
        {
            id: 'export',
            label: '匯出',
            submenu: [
                {
                    id: 'export-srt',
                    label: 'SRT 字幕',
                    onClick: async () => {
                        try {
                            const r = await exportLecture(lecture.id, 'srt');
                            // r === null when the user cancelled the save
                            // dialog — treat as silent no-op (no success toast).
                            if (r) toastService.success('已匯出 SRT', r.path);
                        } catch (err) {
                            toastService.error('匯出失敗', String(err));
                        }
                    },
                },
                {
                    id: 'export-md',
                    label: 'Markdown',
                    onClick: async () => {
                        try {
                            const r = await exportLecture(lecture.id, 'md');
                            if (r) toastService.success('已匯出 Markdown', r.path);
                        } catch (err) {
                            toastService.error('匯出失敗', String(err));
                        }
                    },
                },
            ],
        },
        {
            id: 'move',
            label: '移動到其他課程',
            // Even when the submenu is empty (no other courses), keep the
            // entry visible so the menu shape is stable; the empty
            // H18ContextMenu submenu layer simply renders no items if the
            // submenu length is 0 (handled by H18ContextMenu itself).
            submenu: moveSubmenu,
        },
        { id: 'sep', label: '─', disabled: true },
        {
            id: 'delete',
            label: '刪除',
            danger: true,
            onClick: async () => {
                const ok = await confirmService.ask({
                    title: '刪除課堂？',
                    message: `「${lecture.title}」會移到垃圾桶，可以還原。`,
                    confirmLabel: '刪除',
                    variant: 'danger',
                });
                if (!ok) return;
                try {
                    await onDelete();
                } catch (err) {
                    toastService.error('刪除失敗', String(err));
                }
            },
        },
    ];

    return (
        <H18ContextMenu
            items={items}
            x={x}
            y={y}
            onClose={onClose}
            ariaLabel={`${lecture.title} 操作`}
        />
    );
}

export default LectureContextMenu;
