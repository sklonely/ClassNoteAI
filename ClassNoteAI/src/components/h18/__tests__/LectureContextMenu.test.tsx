/**
 * LectureContextMenu tests · Phase 7 Sprint 3 Round 3 (S3d)
 *
 * Right-click menu for a lecture row (in CourseDetailPage). Wraps
 * H18ContextMenu (S3b-1) with lecture-specific items:
 *
 *   1. 編輯              → onEdit (caller opens LectureEditDialog)
 *   2. 重新命名           → onRename (caller toggles inline rename)
 *   3. 匯出 ▸             → SRT 字幕 / Markdown   (calls exportService)
 *   4. 移動到其他課程 ▸   → list of OTHER courses (calls onMoveToCourse)
 *   5. ─sep
 *   6. 刪除               → confirmService.ask → onDelete
 *
 * Specs covered (覆蓋 sub-agent prompt 列出的 11 個)：
 *   1. mounts + renders 5 leaf items (編輯 / 重命名 / 匯出 / 移動 / 刪除)
 *   2. 點編輯 → onEdit + onClose
 *   3. 點重命名 → onRename + onClose
 *   4. hover 匯出 → submenu 顯示 (SRT / Markdown)
 *   5. 點 SRT → exportLecture('srt') called + toast.success
 *   6. hover 移動 → submenu 顯示 courses (排除自己 lecture.course_id)
 *   7. 點某 course → onMoveToCourse(courseId) + toast.success
 *   8. 點刪除 → confirm 跳；cancel = 不 onDelete
 *   9. confirm OK → onDelete called
 *   10. submenu items role="menuitem"
 *   11. 沒其他 course → 移動 submenu 為空 (展開無 items 時整個 submenu 不顯示)
 *
 *   bonus: export 失敗 → toast.error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── module mocks: must be hoisted before importing the SUT ──────────
vi.mock('../../../services/exportService', () => ({
    exportLecture: vi.fn(() => Promise.resolve({ path: '/tmp/x.srt', size: 10 })),
}));

vi.mock('../../../services/toastService', () => ({
    toastService: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
    },
}));

vi.mock('../../../services/confirmService', () => ({
    confirmService: {
        ask: vi.fn(() => Promise.resolve(true)),
    },
}));

import { LectureContextMenu } from '../LectureContextMenu';
import type { Course, Lecture } from '../../../types';
import { exportLecture } from '../../../services/exportService';
import { toastService } from '../../../services/toastService';
import { confirmService } from '../../../services/confirmService';

function makeLecture(over: Partial<Lecture> = {}): Lecture {
    return {
        id: 'lec-1',
        course_id: 'c-1',
        title: 'L1 簡介',
        date: '2026-04-15',
        duration: 0,
        status: 'completed',
        keywords: '',
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T00:00:00Z',
        ...over,
    };
}

function makeCourses(): Course[] {
    return [
        { id: 'c-1', user_id: 'u', title: '課程 A', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c-2', user_id: 'u', title: '課程 B', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c-3', user_id: 'u', title: '課程 C', created_at: '2026-01-01T00:00:00Z' },
    ];
}

interface SetupArgs {
    lecture?: Lecture;
    courses?: Course[];
    onEdit?: () => void;
    onRename?: () => void;
    onMoveToCourse?: (newCourseId: string) => Promise<void>;
    onDelete?: () => Promise<void>;
    onClose?: () => void;
}

function setup(args: SetupArgs = {}) {
    const lecture = args.lecture ?? makeLecture();
    const courses = args.courses ?? makeCourses();
    const onEdit = args.onEdit ?? vi.fn();
    const onRename = args.onRename ?? vi.fn();
    const onMoveToCourse = args.onMoveToCourse ?? vi.fn(() => Promise.resolve());
    const onDelete = args.onDelete ?? vi.fn(() => Promise.resolve());
    const onClose = args.onClose ?? vi.fn();
    const utils = render(
        <LectureContextMenu
            lecture={lecture}
            courses={courses}
            x={100}
            y={100}
            onClose={onClose}
            onEdit={onEdit}
            onRename={onRename}
            onMoveToCourse={onMoveToCourse}
            onDelete={onDelete}
        />,
    );
    return {
        ...utils,
        lecture,
        courses,
        onEdit,
        onRename,
        onMoveToCourse,
        onDelete,
        onClose,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 768,
    });
    // default behaviours each test can override
    (exportLecture as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: '/tmp/x.srt',
        size: 10,
    });
    (confirmService.ask as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

describe('LectureContextMenu', () => {
    // ── 1. mounts + renders 5 leaf items ─────────────────────────────
    it('renders 編輯 / 重新命名 / 匯出 / 移動到其他課程 / 刪除', () => {
        setup();
        expect(screen.getByText('編輯')).toBeInTheDocument();
        expect(screen.getByText('重新命名')).toBeInTheDocument();
        expect(screen.getByText('匯出')).toBeInTheDocument();
        expect(screen.getByText('移動到其他課程')).toBeInTheDocument();
        expect(screen.getByText('刪除')).toBeInTheDocument();
    });

    // ── 2. 點編輯 → onEdit + onClose ─────────────────────────────────
    it('clicking 編輯 calls onEdit and onClose', () => {
        const { onEdit, onClose } = setup();
        fireEvent.click(screen.getByText('編輯'));
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // ── 3. 點重命名 → onRename + onClose ─────────────────────────────
    it('clicking 重新命名 calls onRename and onClose', () => {
        const { onRename, onClose } = setup();
        fireEvent.click(screen.getByText('重新命名'));
        expect(onRename).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // ── 4. hover 匯出 → submenu 顯示 (SRT / Markdown) ────────────────
    it('hovering 匯出 reveals SRT / Markdown submenu', () => {
        setup();
        // submenu not yet visible
        expect(screen.queryByText('SRT 字幕')).toBeNull();
        fireEvent.mouseEnter(screen.getByText('匯出'));
        expect(screen.getByText('SRT 字幕')).toBeInTheDocument();
        expect(screen.getByText('Markdown')).toBeInTheDocument();
    });

    // ── 5. 點 SRT → exportLecture('srt') called + toast.success ──────
    it('clicking SRT 字幕 calls exportLecture("srt") and toasts success', async () => {
        const { lecture } = setup();
        fireEvent.mouseEnter(screen.getByText('匯出'));
        fireEvent.click(screen.getByText('SRT 字幕'));

        await waitFor(() =>
            expect(exportLecture).toHaveBeenCalledWith(lecture.id, 'srt'),
        );
        await waitFor(() =>
            expect(toastService.success).toHaveBeenCalled(),
        );
        const args = (toastService.success as unknown as ReturnType<typeof vi.fn>).mock
            .calls[0]!;
        expect(String(args[0])).toMatch(/SRT/);
    });

    // ── 5b. 點 Markdown → exportLecture('md') called ─────────────────
    it('clicking Markdown calls exportLecture("md")', async () => {
        const { lecture } = setup();
        fireEvent.mouseEnter(screen.getByText('匯出'));
        fireEvent.click(screen.getByText('Markdown'));
        await waitFor(() =>
            expect(exportLecture).toHaveBeenCalledWith(lecture.id, 'md'),
        );
    });

    // ── 5c. export 失敗 → toast.error ────────────────────────────────
    it('shows toast.error when exportLecture rejects', async () => {
        (exportLecture as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('disk full'),
        );
        setup();
        fireEvent.mouseEnter(screen.getByText('匯出'));
        fireEvent.click(screen.getByText('SRT 字幕'));
        await waitFor(() =>
            expect(toastService.error).toHaveBeenCalled(),
        );
    });

    // ── 6. hover 移動 → submenu 顯示 courses (排除自己) ──────────────
    it('hovering 移動到其他課程 shows OTHER courses (excludes own)', () => {
        const lecture = makeLecture({ course_id: 'c-1' });
        setup({ lecture });
        // submenu not yet visible
        expect(screen.queryByText('課程 B')).toBeNull();
        fireEvent.mouseEnter(screen.getByText('移動到其他課程'));
        // own course excluded
        expect(screen.queryByText('課程 A')).toBeNull();
        // others present
        expect(screen.getByText('課程 B')).toBeInTheDocument();
        expect(screen.getByText('課程 C')).toBeInTheDocument();
    });

    // ── 7. 點某 course → onMoveToCourse(courseId) + toast ─────────────
    it('clicking a target course calls onMoveToCourse with that id and toasts', async () => {
        const onMoveToCourse = vi.fn(() => Promise.resolve());
        setup({ onMoveToCourse });
        fireEvent.mouseEnter(screen.getByText('移動到其他課程'));
        fireEvent.click(screen.getByText('課程 B'));
        await waitFor(() => expect(onMoveToCourse).toHaveBeenCalledWith('c-2'));
        await waitFor(() => expect(toastService.success).toHaveBeenCalled());
    });

    // ── 7b. move 失敗 → toast.error ──────────────────────────────────
    it('shows toast.error when onMoveToCourse rejects', async () => {
        const onMoveToCourse = vi.fn(() =>
            Promise.reject(new Error('cascade fail')),
        );
        setup({ onMoveToCourse });
        fireEvent.mouseEnter(screen.getByText('移動到其他課程'));
        fireEvent.click(screen.getByText('課程 B'));
        await waitFor(() => expect(toastService.error).toHaveBeenCalled());
    });

    // ── 8. 點刪除 → confirm 跳 → cancel = 不 onDelete ────────────────
    it('asks for confirmation before delete; cancel skips onDelete', async () => {
        (confirmService.ask as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            false,
        );
        const onDelete = vi.fn(() => Promise.resolve());
        setup({ onDelete });
        fireEvent.click(screen.getByText('刪除'));
        await waitFor(() => expect(confirmService.ask).toHaveBeenCalled());
        // cancel resolved to false → onDelete NOT called
        await Promise.resolve();
        expect(onDelete).not.toHaveBeenCalled();
    });

    // ── 9. confirm OK → onDelete called ──────────────────────────────
    it('calls onDelete after the user confirms', async () => {
        (confirmService.ask as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
            true,
        );
        const onDelete = vi.fn(() => Promise.resolve());
        setup({ onDelete });
        fireEvent.click(screen.getByText('刪除'));
        await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    });

    // ── 9b. confirm 帶課堂標題 (UX) ──────────────────────────────────
    it('confirm message references the lecture title', async () => {
        const lecture = makeLecture({ title: '關鍵那一堂' });
        setup({ lecture });
        fireEvent.click(screen.getByText('刪除'));
        await waitFor(() => expect(confirmService.ask).toHaveBeenCalled());
        const arg = (confirmService.ask as unknown as ReturnType<typeof vi.fn>).mock
            .calls[0]![0];
        expect(String(arg.message)).toContain('關鍵那一堂');
        // danger variant
        expect(arg.variant).toBe('danger');
    });

    // ── 10. submenu items role="menuitem" ────────────────────────────
    it('submenu items render with role="menuitem"', () => {
        setup();
        fireEvent.mouseEnter(screen.getByText('匯出'));
        const srt = screen.getByText('SRT 字幕').closest('[role="menuitem"]');
        const md = screen.getByText('Markdown').closest('[role="menuitem"]');
        expect(srt).not.toBeNull();
        expect(md).not.toBeNull();
    });

    // ── 11. 沒其他 course → 移動 submenu 為空 (展開後不出 items) ─────
    it('renders no target courses when this is the only course', () => {
        const courses: Course[] = [
            { id: 'c-1', user_id: 'u', title: '課程 A', created_at: '2026-01-01T00:00:00Z' },
        ];
        const lecture = makeLecture({ course_id: 'c-1' });
        setup({ lecture, courses });
        fireEvent.mouseEnter(screen.getByText('移動到其他課程'));
        // No target courses to show
        expect(screen.queryByText('課程 A')).toBeNull();
    });

    // ── 12. ariaLabel 包含 lecture.title (對齊 H18ContextMenu §6) ────
    it('uses an aria-label that references the lecture title', () => {
        const lecture = makeLecture({ title: '專屬標題' });
        setup({ lecture });
        const menu = screen.getByRole('menu');
        expect(menu.getAttribute('aria-label')).toContain('專屬標題');
    });
});
