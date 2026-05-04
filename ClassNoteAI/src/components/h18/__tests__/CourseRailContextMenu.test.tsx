/**
 * CourseRailContextMenu tests · Phase 7 Sprint 3 Round 3 (W12)
 *
 * Specs covered (per PLAN §9.5 W12):
 *   1. renders 3 items: 編輯 / 新建課堂 / 刪除 (no 「快速錄音」)
 *   2. NO 「快速錄音」 item exists
 *   3. role="menu" + items role="menuitem"
 *   4. 編輯 click → onEdit fires + onClose
 *   5. 新建課堂 click → onCreateLecture fires + onClose
 *   6. 刪除 click → confirmService.ask invoked (does NOT call onDelete yet)
 *   7. confirm cancel (dismiss) → onDelete NOT called
 *   8. confirm accept → onDelete called
 *   9. ariaLabel applied (course title 操作)
 *  10. delete item has danger class
 *  11. legacy onAction prop is also called for backward compat
 *      (covers the caller in H18Rail still passing onAction)
 *  12. mounting with neither legacy onAction nor new onEdit doesn't crash
 *      on edit click (graceful no-op)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CourseRailContextMenu from '../CourseRailContextMenu';
import type { Course } from '../../../types';
import { confirmService } from '../../../services/confirmService';

function makeCourse(over: Partial<Course> = {}): Course {
    return {
        id: 'c1',
        user_id: 'u1',
        title: '機器學習',
        ...over,
    } as Course;
}

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 1280,
    });
    Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 800,
    });
});

afterEach(() => {
    if (confirmService.current()) confirmService.dismiss();
    vi.restoreAllMocks();
});

describe('CourseRailContextMenu', () => {
    it('renders exactly 3 actionable items: 編輯 / 新建課堂 / 刪除', () => {
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={vi.fn()}
            />,
        );

        expect(screen.getByText('編輯')).toBeInTheDocument();
        expect(screen.getByText('新建課堂')).toBeInTheDocument();
        expect(screen.getByText('刪除')).toBeInTheDocument();
        // 3 actionable items (+ a disabled separator row rendered by the
        // H18ContextMenu base — that one has aria-disabled="true").
        const items = screen.getAllByRole('menuitem');
        const enabled = items.filter(
            (el) => el.getAttribute('aria-disabled') === 'false',
        );
        expect(enabled).toHaveLength(3);
    });

    it('does NOT render 「快速錄音」 (course menu no longer surfaces it)', () => {
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={vi.fn()}
            />,
        );

        expect(screen.queryByText('快速錄音')).toBeNull();
    });

    it('has role="menu" + each item role="menuitem"', () => {
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        expect(screen.getByRole('menu')).toBeInTheDocument();
        // Each row (including the disabled separator) carries
        // role="menuitem" via the H18ContextMenu base.
        expect(screen.getAllByRole('menuitem').length).toBeGreaterThanOrEqual(3);
    });

    it('編輯 click invokes onEdit and onClose', () => {
        const onEdit = vi.fn();
        const onClose = vi.fn();
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={onClose}
                onEdit={onEdit}
                onCreateLecture={vi.fn()}
                onDelete={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByText('編輯'));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('新建課堂 click invokes onCreateLecture and onClose', () => {
        const onCreateLecture = vi.fn();
        const onClose = vi.fn();
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={onClose}
                onEdit={vi.fn()}
                onCreateLecture={onCreateLecture}
                onDelete={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByText('新建課堂'));

        expect(onCreateLecture).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('刪除 click triggers confirmService.ask (and does NOT call onDelete yet)', async () => {
        const ask = vi.spyOn(confirmService, 'ask');
        const onDelete = vi.fn().mockResolvedValue(undefined);

        render(
            <CourseRailContextMenu
                course={makeCourse({ title: '量子物理' })}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={onDelete}
            />,
        );

        fireEvent.click(screen.getByText('刪除'));

        // confirmService.ask should be called with danger variant + title containing course name
        await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
        const req = ask.mock.calls[0][0];
        expect(req.variant).toBe('danger');
        expect(req.message).toContain('量子物理');
        // onDelete still not called — waiting for confirm
        expect(onDelete).not.toHaveBeenCalled();
    });

    it('confirm cancel → onDelete NOT called', async () => {
        const onDelete = vi.fn().mockResolvedValue(undefined);

        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={onDelete}
            />,
        );

        fireEvent.click(screen.getByText('刪除'));

        // Wait for ask() to be pending
        await waitFor(() => expect(confirmService.current()).not.toBeNull());

        // User cancels
        await act(async () => {
            confirmService.dismiss();
        });

        await waitFor(() => expect(confirmService.current()).toBeNull());

        expect(onDelete).not.toHaveBeenCalled();
    });

    it('confirm accept → onDelete called', async () => {
        const onDelete = vi.fn().mockResolvedValue(undefined);

        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={onDelete}
            />,
        );

        fireEvent.click(screen.getByText('刪除'));

        await waitFor(() => expect(confirmService.current()).not.toBeNull());

        await act(async () => {
            confirmService.accept();
        });

        await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    });

    it('uses an ariaLabel that mentions the course title', () => {
        render(
            <CourseRailContextMenu
                course={makeCourse({ title: '生物化學' })}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        const menu = screen.getByRole('menu');
        const label = menu.getAttribute('aria-label') ?? '';
        expect(label).toContain('生物化學');
    });

    it('刪除 item has the danger class applied via H18ContextMenu base', () => {
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={vi.fn()}
                onEdit={vi.fn()}
                onCreateLecture={vi.fn()}
                onDelete={vi.fn()}
            />,
        );
        const del = screen.getByText('刪除').closest('[role="menuitem"]') as HTMLElement;
        expect(del).not.toBeNull();
        // CSS modules hash class names; assert the className string contains 'danger'
        expect(del.className).toMatch(/danger/);
    });

    it('legacy onAction prop is still called for backward compat (edit)', () => {
        // H18Rail current caller passes onAction(action). Until that caller
        // migrates, the legacy prop must still fire on edit.
        const onAction = vi.fn();
        const onClose = vi.fn();
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={onClose}
                onAction={onAction}
            />,
        );

        fireEvent.click(screen.getByText('編輯'));
        expect(onAction).toHaveBeenCalledWith('edit');
    });

    it('legacy onAction is NOT invoked for 新建課堂 (caller must use onCreateLecture)', () => {
        // 'new-lecture' is a W12-only action; the legacy CourseRailAction
        // union ('edit' | 'quick-record' | 'delete') doesn't include it,
        // so we deliberately do not route it through onAction. Existing
        // callers that haven't migrated will simply see no fire — which
        // is safer than emitting an action they can't type-narrow.
        const onAction = vi.fn();
        render(
            <CourseRailContextMenu
                course={makeCourse({ id: 'c2', title: 'x' })}
                x={50}
                y={50}
                onClose={vi.fn()}
                onAction={onAction}
            />,
        );
        fireEvent.click(screen.getByText('新建課堂'));
        expect(onAction).not.toHaveBeenCalled();
    });

    it('clicking 編輯 with no onEdit and no onAction is a graceful no-op', () => {
        // Smoke: should not throw when caller forgot to wire either prop
        const onClose = vi.fn();
        render(
            <CourseRailContextMenu
                course={makeCourse()}
                x={50}
                y={50}
                onClose={onClose}
            />,
        );

        expect(() => fireEvent.click(screen.getByText('編輯'))).not.toThrow();
        // onClose should still fire (menu always closes after a leaf click)
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
