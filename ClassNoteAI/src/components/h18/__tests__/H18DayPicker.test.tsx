/**
 * H18DayPicker tests · Phase 7 Sprint 3 (S3c-1)
 *
 * 規格：自刻日期選擇器，month grid，週日為 col 0。
 *  - value=null → viewMonth 預設當月
 *  - value=Date → viewMonth = 該月、該 day 有 .selected
 *  - prev / next month 切換
 *  - click day → onChange(Date)
 *  - today highlight
 *  - minDate / maxDate / isDayDisabled 限制
 *  - role="dialog" + aria-label="選擇日期"
 *  - 月份切換不丟 selected value
 *
 * 對應 PHASE-7-PLAN.md §3c (line 211-225) + U5。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { H18DayPicker } from '../H18DayPicker';

// ─── Helpers ──────────────────────────────────────────────────────────
function getDayButton(container: HTMLElement, dayNum: number): HTMLButtonElement {
    // Get all day buttons (those with aria-selected attribute), filter by visible label.
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[aria-selected]');
    const matched = Array.from(buttons).filter(
        (b) => b.textContent?.trim() === String(dayNum),
    );
    if (matched.length === 0) {
        throw new Error(`no day button with text "${dayNum}" found`);
    }
    // If multiple (rare — shouldn't happen since we already filtered to grid cells),
    // return the first.
    return matched[0];
}

describe('H18DayPicker', () => {
    beforeEach(() => {
        // Use real timers by default; specific tests override.
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── 1. value=null + 不指定 viewMonth → 顯示當月 ──────────────────
    it('renders current month label when value is null', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 3, 28)); // 2026-04-28
        const { container } = render(<H18DayPicker value={null} onChange={() => {}} />);
        expect(container.textContent).toContain('2026');
        expect(container.textContent).toContain('4');
    });

    // ── 2. value=2026-04-15 → viewMonth=2026-04, day 15 selected ─────
    it('renders the month of the value and marks the value day as selected', () => {
        const value = new Date(2026, 3, 15);
        const { container } = render(<H18DayPicker value={value} onChange={() => {}} />);
        expect(container.textContent).toContain('2026');
        expect(container.textContent).toContain('4');

        const day15 = getDayButton(container, 15);
        expect(day15.getAttribute('aria-selected')).toBe('true');
    });

    // ── 3. click 上個月 → viewMonth=2026-03 ──────────────────────────
    it('navigates to previous month when prev button is clicked', () => {
        const value = new Date(2026, 3, 15);
        const { container } = render(<H18DayPicker value={value} onChange={() => {}} />);
        const prevBtn = screen.getByRole('button', { name: '上個月' });
        fireEvent.click(prevBtn);
        // After click → 3 月
        const label = container.querySelector('[class*="monthLabel"]')!;
        expect(label.textContent).toContain('2026');
        expect(label.textContent).toContain('3');
    });

    // ── 4. click 下個月 → viewMonth=2026-05 ──────────────────────────
    it('navigates to next month when next button is clicked', () => {
        const value = new Date(2026, 3, 15);
        const { container } = render(<H18DayPicker value={value} onChange={() => {}} />);
        const nextBtn = screen.getByRole('button', { name: '下個月' });
        fireEvent.click(nextBtn);
        const label = container.querySelector('[class*="monthLabel"]')!;
        expect(label.textContent).toContain('2026');
        expect(label.textContent).toContain('5');
    });

    // ── 5. click day 20 → onChange called with Date(2026, 3, 20) ──────
    it('calls onChange with the clicked date', () => {
        const onChange = vi.fn();
        const value = new Date(2026, 3, 15);
        const { container } = render(<H18DayPicker value={value} onChange={onChange} />);
        const day20 = getDayButton(container, 20);
        fireEvent.click(day20);
        expect(onChange).toHaveBeenCalledTimes(1);
        const arg = onChange.mock.calls[0][0] as Date;
        expect(arg).toBeInstanceOf(Date);
        expect(arg.getFullYear()).toBe(2026);
        expect(arg.getMonth()).toBe(3);
        expect(arg.getDate()).toBe(20);
    });

    // ── 6. selected day 有 .selected class ───────────────────────────
    it('applies selected class to the value day', () => {
        const value = new Date(2026, 3, 15);
        const { container } = render(<H18DayPicker value={value} onChange={() => {}} />);
        const day15 = getDayButton(container, 15);
        expect(day15.className).toMatch(/selected/);
    });

    // ── 7. today 有 .today class (mock Date.now) ─────────────────────
    it('applies today class to the current date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 3, 28));
        const { container } = render(<H18DayPicker value={null} onChange={() => {}} />);
        const day28 = getDayButton(container, 28);
        expect(day28.className).toMatch(/today/);
    });

    // ── 8. minDate constraint → 早於 minDate 的 day disabled ─────────
    it('disables days before minDate', () => {
        const value = new Date(2026, 3, 15);
        const minDate = new Date(2026, 3, 10);
        const { container } = render(
            <H18DayPicker value={value} onChange={() => {}} minDate={minDate} />,
        );
        const day5 = getDayButton(container, 5);
        expect(day5.disabled).toBe(true);
        const day15 = getDayButton(container, 15);
        expect(day15.disabled).toBe(false);
    });

    // ── 9. maxDate constraint → 晚於 maxDate disabled ────────────────
    it('disables days after maxDate', () => {
        const value = new Date(2026, 3, 15);
        const maxDate = new Date(2026, 3, 20);
        const { container } = render(
            <H18DayPicker value={value} onChange={() => {}} maxDate={maxDate} />,
        );
        const day25 = getDayButton(container, 25);
        expect(day25.disabled).toBe(true);
        const day15 = getDayButton(container, 15);
        expect(day15.disabled).toBe(false);
    });

    // ── 10. isDayDisabled fn → 回 true 的 day disabled ───────────────
    it('disables days where isDayDisabled returns true', () => {
        const value = new Date(2026, 3, 15);
        const isDayDisabled = (d: Date) => d.getDate() === 13;
        const { container } = render(
            <H18DayPicker
                value={value}
                onChange={() => {}}
                isDayDisabled={isDayDisabled}
            />,
        );
        const day13 = getDayButton(container, 13);
        expect(day13.disabled).toBe(true);
        const day14 = getDayButton(container, 14);
        expect(day14.disabled).toBe(false);
    });

    // ── 11. role="dialog" + aria-label="選擇日期" ────────────────────
    it('exposes role=dialog with the correct aria-label', () => {
        render(<H18DayPicker value={null} onChange={() => {}} />);
        const dialog = screen.getByRole('dialog', { name: '選擇日期' });
        expect(dialog).toBeInTheDocument();
    });

    // ── 12. 月份切換不丟 selected value ───────────────────────────────
    it('keeps selected value across month navigation', () => {
        const value = new Date(2026, 3, 15);
        const { container } = render(<H18DayPicker value={value} onChange={() => {}} />);
        // Move forward → no "15" should be selected on May.
        fireEvent.click(screen.getByRole('button', { name: '下個月' }));
        // On May, day 15 exists but should NOT be selected (different month).
        const day15May = getDayButton(container, 15);
        expect(day15May.getAttribute('aria-selected')).toBe('false');

        // Go back to April → day 15 selected again.
        fireEvent.click(screen.getByRole('button', { name: '上個月' }));
        const day15Apr = getDayButton(container, 15);
        expect(day15Apr.getAttribute('aria-selected')).toBe('true');
    });

    // ── 13. disabled day 不會 fire onChange ──────────────────────────
    it('does not call onChange when a disabled day is clicked', () => {
        const onChange = vi.fn();
        const value = new Date(2026, 3, 15);
        const minDate = new Date(2026, 3, 10);
        const { container } = render(
            <H18DayPicker
                value={value}
                onChange={onChange}
                minDate={minDate}
            />,
        );
        const day5 = getDayButton(container, 5);
        fireEvent.click(day5);
        expect(onChange).not.toHaveBeenCalled();
    });

    // ── 14. 週標頭顯示日一二三四五六（週日為 col 0） ─────────────────
    it('renders week header with Sunday first', () => {
        const { container } = render(<H18DayPicker value={null} onChange={() => {}} />);
        const weekHeader = container.querySelector('[class*="weekHeader"]');
        expect(weekHeader).not.toBeNull();
        const labels = within(weekHeader as HTMLElement).getAllByText(
            /^[日一二三四五六]$/,
        );
        expect(labels.map((n) => n.textContent)).toEqual([
            '日',
            '一',
            '二',
            '三',
            '四',
            '五',
            '六',
        ]);
    });
});
