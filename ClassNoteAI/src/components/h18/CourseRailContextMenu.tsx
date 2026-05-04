/**
 * CourseRailContextMenu · v0.7.0 → Phase 7 Sprint 3 Round 3 (W12)
 *
 * Right-click on a course chip in H18Rail. As of W12 the menu is unified
 * to three actions:
 *
 *   編輯
 *   新建課堂
 *   ─
 *   刪除
 *
 * 「快速錄音」 was removed (the rail already exposes a record entry
 * point — duplicating it inside the menu was confusing). The component
 * now delegates to the generic H18ContextMenu base (Sprint 3 Round 1)
 * for keyboard nav, viewport clamping, role wiring and animation.
 *
 * Delete confirmation goes through `confirmService` instead of the old
 * inline two-step view, matching all other destructive flows in H18.
 *
 * ## Backward compatibility
 *
 * Earlier callers (H18Rail) wire a single `onAction(action)` callback.
 * That signature is still supported (as `onAction`) so this refactor
 * doesn't force a same-PR caller migration. Newer callers can pass
 * `onEdit` / `onCreateLecture` / `onDelete` directly.
 *
 * The legacy 'quick-record' action is retained as a type member only so
 * any caller that switches on the action union still type-checks; it is
 * never emitted from this menu anymore.
 */

import type { Course } from '../../types';
import { confirmService } from '../../services/confirmService';
import { H18ContextMenu, type H18ContextMenuItem } from './H18ContextMenu';

/**
 * Legacy action union, retained verbatim so existing callers
 * (`H18DeepApp.handleCourseAction` etc.) keep type-checking. The
 * 'quick-record' member is no longer surfaced from the menu but stays
 * here for callers that still switch on the old shape. The new W12
 * 「新建課堂」 action does NOT route through this legacy callback —
 * use the dedicated `onCreateLecture` prop instead.
 */
export type CourseRailAction = 'edit' | 'quick-record' | 'delete';

export interface CourseRailContextMenuProps {
    course: Course;
    /** Anchor coordinates (clientX / clientY of the contextmenu event). */
    x: number;
    y: number;
    onClose: () => void;
    /** Preferred (W12+) per-action callbacks. */
    onEdit?: () => void;
    onCreateLecture?: () => void;
    onDelete?: () => void | Promise<void>;
    /**
     * Legacy single-callback shape. H18Rail still uses this; kept so
     * the caller migration can land in a separate PR. New call sites
     * should prefer the per-action callbacks above.
     *
     * @deprecated Wire `onEdit` / `onCreateLecture` / `onDelete` instead.
     */
    onAction?: (action: CourseRailAction) => void;
}

export function CourseRailContextMenu({
    course,
    x,
    y,
    onClose,
    onEdit,
    onCreateLecture,
    onDelete,
    onAction,
}: CourseRailContextMenuProps) {
    const items: H18ContextMenuItem[] = [
        {
            id: 'edit',
            label: '編輯',
            onClick: () => {
                onEdit?.();
                onAction?.('edit');
            },
        },
        {
            id: 'new-lecture',
            label: '新建課堂',
            onClick: () => {
                onCreateLecture?.();
                // Legacy callers don't know about 'new-lecture'; this
                // action is intentionally not forwarded to onAction.
            },
        },
        {
            id: 'sep',
            label: '─',
            disabled: true,
        },
        {
            id: 'delete',
            label: '刪除',
            danger: true,
            onClick: () => {
                // Fire-and-forget: H18ContextMenu's onClick is sync.
                // We close the menu immediately (parent's onClose is
                // already invoked by the base after this returns) and
                // then await the user's confirmation.
                void (async () => {
                    const ok = await confirmService.ask({
                        title: '刪除課程？',
                        message: `「${course.title}」與內含課堂全部會移到垃圾桶。`,
                        confirmLabel: '刪除',
                        variant: 'danger',
                    });
                    if (!ok) return;
                    if (onDelete) {
                        await onDelete();
                    } else {
                        onAction?.('delete');
                    }
                })();
            },
        },
    ];

    return (
        <H18ContextMenu
            items={items}
            x={x}
            y={y}
            onClose={onClose}
            ariaLabel={`${course.title} 操作`}
        />
    );
}

export default CourseRailContextMenu;
