/**
 * LectureEditDialog tests · Phase 7 Sprint 3 Round 2 (S3c-2)
 *
 * Modal F1 A — 編輯 lecture metadata（標題 / 日期 / 課程 / 關鍵字）。
 * - reuses H18DayPicker for date popover (z-index `--h18-z-popover` 蓋過 modal)
 * - 改 course_id = 移動 lecture (S7) — 由 caller 處理 nav，dialog 只報 onSubmit
 *
 * Specs covered (覆蓋 sub-agent prompt 列出的 12+)：
 *   1. isOpen=false → 不 render
 *   2. isOpen=true → render dialog (role=dialog)
 *   3. 預填 title / date / course_id / keywords from lecture prop
 *   4. 改 title + 點儲存 → onSubmit({ title, ... }) called
 *   5. 點 date button → DayPicker 顯示
 *   6. 選 day → date 更新
 *   7. 加 keyword (Enter) → chips 增加
 *   8. 刪 keyword (×) → chips 減少
 *   9. 取消按鈕 → onClose called
 *   10. 點 scrim → onClose
 *   11. Esc → onClose
 *   12. submit 中 button disabled
 *   13. submit fail → 不關 dialog
 *   14. focus 落第一個 input on open
 *   15. aria-modal + aria-labelledby
 *   16. 改 course → onSubmit 帶新 course_id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { LectureEditDialog } from '../LectureEditDialog';
import type { Course, Lecture } from '../../../types';

function makeLecture(over: Partial<Lecture> = {}): Lecture {
    return {
        id: 'lec-1',
        course_id: 'c-1',
        title: '原始標題',
        date: '2026-04-15',
        duration: 0,
        status: 'completed',
        keywords: 'kw-a, kw-b',
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T00:00:00Z',
        ...over,
    };
}

function makeCourses(): Course[] {
    return [
        {
            id: 'c-1',
            user_id: 'u',
            title: '課程 A',
            created_at: '2026-01-01T00:00:00Z',
        },
        {
            id: 'c-2',
            user_id: 'u',
            title: '課程 B',
            created_at: '2026-01-01T00:00:00Z',
        },
    ];
}

interface RenderArgs {
    isOpen?: boolean;
    lecture?: Lecture;
    courses?: Course[];
    onClose?: () => void;
    onSubmit?: (updates: {
        title: string;
        date: string;
        course_id: string;
        keywords: string[];
    }) => Promise<void>;
}

function setup(args: RenderArgs = {}) {
    const onClose = args.onClose ?? vi.fn();
    const onSubmit = args.onSubmit ?? vi.fn(() => Promise.resolve());
    const lecture = args.lecture ?? makeLecture({ keywords: 'kw-a, kw-b' });
    const courses = args.courses ?? makeCourses();
    const utils = render(
        <LectureEditDialog
            isOpen={args.isOpen ?? true}
            lecture={lecture}
            courses={courses}
            onClose={onClose}
            onSubmit={onSubmit}
        />,
    );
    return { ...utils, onClose, onSubmit, lecture, courses };
}

describe('LectureEditDialog', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    // ── 1. isOpen=false → 不 render ─────────────────────────────────
    it('does not render when isOpen=false', () => {
        setup({ isOpen: false });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    // ── 2. isOpen=true → render dialog (role=dialog) ────────────────
    it('renders a role=dialog when isOpen=true', () => {
        setup();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // ── 3. 預填 title / date / course_id / keywords from lecture ────
    it('pre-fills form fields from lecture prop', () => {
        const lecture = makeLecture({
            title: '預填標題',
            date: '2026-04-20',
            course_id: 'c-2',
            keywords: 'foo, bar',
        });
        setup({ lecture });
        const titleInput = screen.getByLabelText('標題') as HTMLInputElement;
        expect(titleInput.value).toBe('預填標題');
        expect(screen.getByRole('button', { name: '2026-04-20' })).toBeInTheDocument();
        const courseSelect = screen.getByLabelText('課程') as HTMLSelectElement;
        expect(courseSelect.value).toBe('c-2');
        expect(screen.getByText('foo')).toBeInTheDocument();
        expect(screen.getByText('bar')).toBeInTheDocument();
    });

    // ── 4. 改 title + 點儲存 → onSubmit({ title, ... }) called ───────
    it('calls onSubmit with edited title on save', async () => {
        const onSubmit = vi.fn<
            (u: { title: string; date: string; course_id: string; keywords: string[] }) => Promise<void>
        >(() => Promise.resolve());
        setup({ onSubmit });
        const titleInput = screen.getByLabelText('標題') as HTMLInputElement;
        fireEvent.change(titleInput, { target: { value: '新標題' } });
        fireEvent.click(screen.getByRole('button', { name: '儲存' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        const arg = onSubmit.mock.calls[0]![0];
        expect(arg.title).toBe('新標題');
        expect(arg.date).toBe('2026-04-15');
        expect(arg.course_id).toBe('c-1');
        expect(arg.keywords).toEqual(['kw-a', 'kw-b']);
    });

    // ── 5. 點 date button → DayPicker 顯示 ───────────────────────────
    it('opens DayPicker when date button is clicked', () => {
        setup();
        // initially DayPicker 不顯示
        expect(
            screen.queryByRole('dialog', { name: '選擇日期' }),
        ).toBeNull();
        const dateBtn = screen.getByRole('button', { name: '2026-04-15' });
        fireEvent.click(dateBtn);
        expect(
            screen.getByRole('dialog', { name: '選擇日期' }),
        ).toBeInTheDocument();
    });

    // ── 6. 選 day → date 更新 ────────────────────────────────────────
    it('updates date when a day is picked from DayPicker', () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: '2026-04-15' }));
        // pick day 22 (in April 2026)
        const dayPicker = screen.getByRole('dialog', { name: '選擇日期' });
        const day22 = within(dayPicker)
            .getAllByRole('button')
            .find((b) => b.textContent?.trim() === '22');
        expect(day22).toBeDefined();
        fireEvent.click(day22!);
        // date button should now show 2026-04-22 + popover closed
        expect(
            screen.getByRole('button', { name: '2026-04-22' }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('dialog', { name: '選擇日期' }),
        ).toBeNull();
    });

    // ── 7. 加 keyword (Enter) → chips 增加 ───────────────────────────
    it('adds a keyword when Enter is pressed', () => {
        const lecture = makeLecture({ keywords: 'kw-a' });
        setup({ lecture });
        const kwInput = screen.getByPlaceholderText('輸入後 Enter 新增') as HTMLInputElement;
        fireEvent.change(kwInput, { target: { value: 'kw-new' } });
        fireEvent.keyDown(kwInput, { key: 'Enter' });
        expect(screen.getByText('kw-new')).toBeInTheDocument();
        // input cleared
        expect(kwInput.value).toBe('');
    });

    // ── 8. 刪 keyword (×) → chips 減少 ───────────────────────────────
    it('removes a keyword when its × is clicked', () => {
        const lecture = makeLecture({ keywords: 'kw-a, kw-b' });
        setup({ lecture });
        expect(screen.getByText('kw-a')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '刪除 kw-a' }));
        expect(screen.queryByText('kw-a')).toBeNull();
        expect(screen.getByText('kw-b')).toBeInTheDocument();
    });

    // ── 9. 取消按鈕 → onClose called ─────────────────────────────────
    it('calls onClose when cancel button is clicked', () => {
        const onClose = vi.fn();
        setup({ onClose });
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // ── 10. 點 scrim → onClose ───────────────────────────────────────
    it('calls onClose when scrim is clicked', () => {
        const onClose = vi.fn();
        setup({ onClose });
        const dialog = screen.getByRole('dialog');
        // scrim is the dialog's parent
        const scrim = dialog.parentElement!;
        fireEvent.click(scrim);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // ── 11. Esc → onClose ────────────────────────────────────────────
    it('calls onClose on Escape key when no popover is open', () => {
        const onClose = vi.fn();
        setup({ onClose });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // ── 11b. Esc 在 popover 開時不關 modal ──────────────────────────
    it('does not call onClose on Escape while DayPicker popover is open', () => {
        const onClose = vi.fn();
        setup({ onClose });
        fireEvent.click(screen.getByRole('button', { name: '2026-04-15' }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    // ── 12. submit 中 button disabled ────────────────────────────────
    it('disables save button while submit is pending', async () => {
        let resolveSubmit!: () => void;
        const onSubmit = vi.fn(
            () => new Promise<void>((resolve) => { resolveSubmit = resolve; }),
        );
        setup({ onSubmit });
        const saveBtn = screen.getByRole('button', { name: '儲存' });
        fireEvent.click(saveBtn);
        // After click and re-render, button should be disabled and label change
        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /儲存中|儲存/ });
            expect((btn as HTMLButtonElement).disabled).toBe(true);
        });
        await act(async () => {
            resolveSubmit();
        });
    });

    // ── 13. submit fail → 不關 dialog ────────────────────────────────
    it('does not call onClose when submit throws', async () => {
        const onClose = vi.fn();
        const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onSubmit = vi.fn(() => Promise.reject(new Error('boom')));
        setup({ onClose, onSubmit });
        fireEvent.click(screen.getByRole('button', { name: '儲存' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        // Wait a tick for the promise rejection to settle
        await act(async () => { await Promise.resolve(); });
        expect(onClose).not.toHaveBeenCalled();
        consoleErr.mockRestore();
    });

    // ── 14. focus 落第一個 input on open ─────────────────────────────
    it('focuses the title input when opened', async () => {
        setup();
        const titleInput = screen.getByLabelText('標題');
        await waitFor(() => expect(document.activeElement).toBe(titleInput));
    });

    // ── 15. aria-modal + aria-labelledby ─────────────────────────────
    it('exposes aria-modal=true and aria-labelledby pointing at the title', () => {
        setup();
        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const labelledBy = dialog.getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        const titleEl = document.getElementById(labelledBy!);
        expect(titleEl).not.toBeNull();
        expect(titleEl?.textContent).toBe('編輯課堂');
    });

    // ── 16. 改 course → onSubmit 帶新 course_id (S7 移動) ─────────────
    it('passes the new course_id through onSubmit when course changes', async () => {
        const onSubmit = vi.fn<
            (u: { title: string; date: string; course_id: string; keywords: string[] }) => Promise<void>
        >(() => Promise.resolve());
        setup({ onSubmit });
        const courseSelect = screen.getByLabelText('課程') as HTMLSelectElement;
        fireEvent.change(courseSelect, { target: { value: 'c-2' } });
        fireEvent.click(screen.getByRole('button', { name: '儲存' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0]![0].course_id).toBe('c-2');
    });

    // ── 17. 空 title 不能 submit ─────────────────────────────────────
    it('disables save when title is empty', () => {
        const lecture = makeLecture({ title: '' });
        setup({ lecture });
        const saveBtn = screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(true);
    });
});
