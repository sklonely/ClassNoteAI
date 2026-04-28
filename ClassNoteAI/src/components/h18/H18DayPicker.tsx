/**
 * H18DayPicker · Phase 7 Sprint 3 (S3c-1)
 *
 * 自刻 H18 day picker — month grid，週日為 col 0（跟 zh-TW 直觀一致；
 * H18Calendar 是週課表所以走 ISO 週一開始，這裡是日期選擇器，使用習慣
 * 為週日先）。完全用 H18 design tokens（不 hardcode 顏色 / spacing）。
 *
 * 使用情境：LectureEditDialog 的日期欄位 popover（U5 / S3c）。z-index
 * 用 `--h18-z-popover` 蓋過 modal 自己的 z-modal。
 *
 * Props：
 *   value:           Date | null         — 已選日期
 *   onChange:        (Date) => void      — pick day callback
 *   isDayDisabled?:  (Date) => boolean   — 自訂某天 disable
 *   minDate?:        Date                — inclusive 最早可選
 *   maxDate?:        Date                — inclusive 最晚可選
 *
 * 不在範圍：keyboard arrow navigation（先做 click，鍵盤之後 sprint 補）。
 */

import { useState } from 'react';
import s from './H18DayPicker.module.css';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export interface H18DayPickerProps {
    value: Date | null;
    onChange: (date: Date) => void;
    isDayDisabled?: (date: Date) => boolean;
    minDate?: Date;
    maxDate?: Date;
}

function sameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function prevMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

function nextMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/**
 * Generate a 6-week grid for the given month. Sunday = col 0.
 * Cells outside the month are `null`.
 */
function getMonthGrid(month: Date): Array<Array<Date | null>> {
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const firstDay = new Date(year, monthIdx, 1).getDay(); // 0 = Sunday
    const lastDate = new Date(year, monthIdx + 1, 0).getDate();

    const cells: Array<Date | null> = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= lastDate; d++) cells.push(new Date(year, monthIdx, d));
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: Array<Array<Date | null>> = [];
    for (let i = 0; i < cells.length; i += 7) {
        rows.push(cells.slice(i, i + 7));
    }
    return rows;
}

export function H18DayPicker({
    value,
    onChange,
    isDayDisabled,
    minDate,
    maxDate,
}: H18DayPickerProps) {
    const [viewMonth, setViewMonth] = useState<Date>(() => {
        const seed = value ?? new Date();
        return new Date(seed.getFullYear(), seed.getMonth(), 1);
    });

    const grid = getMonthGrid(viewMonth);
    const today = new Date();
    const minD = minDate ? startOfDay(minDate) : null;
    const maxD = maxDate ? startOfDay(maxDate) : null;

    const checkDisabled = (d: Date): boolean => {
        const day = startOfDay(d);
        if (isDayDisabled?.(d)) return true;
        if (minD && day.getTime() < minD.getTime()) return true;
        if (maxD && day.getTime() > maxD.getTime()) return true;
        return false;
    };

    return (
        <div className={s.picker} role="dialog" aria-label="選擇日期">
            <div className={s.header}>
                <button
                    type="button"
                    onClick={() => setViewMonth((m) => prevMonth(m))}
                    className={s.navBtn}
                    aria-label="上個月"
                >
                    {'‹'}
                </button>
                <span className={s.monthLabel}>
                    {viewMonth.getFullYear()} 年 {viewMonth.getMonth() + 1} 月
                </span>
                <button
                    type="button"
                    onClick={() => setViewMonth((m) => nextMonth(m))}
                    className={s.navBtn}
                    aria-label="下個月"
                >
                    {'›'}
                </button>
            </div>
            <div className={s.weekHeader}>
                {WEEK_LABELS.map((w) => (
                    <div key={w} className={s.weekDay}>
                        {w}
                    </div>
                ))}
            </div>
            <div className={s.grid}>
                {grid.map((row, ri) =>
                    row.map((d, ci) => {
                        if (!d) {
                            return (
                                <div
                                    key={`${ri}-${ci}`}
                                    className={s.empty}
                                    aria-hidden="true"
                                />
                            );
                        }
                        const isSelected = !!value && sameDay(d, value);
                        const isToday = sameDay(d, today);
                        const disabled = checkDisabled(d);
                        const cls = [
                            s.day,
                            isSelected ? s.selected : '',
                            isToday ? s.today : '',
                            disabled ? s.disabled : '',
                        ]
                            .filter(Boolean)
                            .join(' ');

                        return (
                            <button
                                key={`${ri}-${ci}`}
                                type="button"
                                className={cls}
                                disabled={disabled}
                                onClick={() => {
                                    if (!disabled) onChange(d);
                                }}
                                aria-label={d.toLocaleDateString('zh-TW')}
                                aria-selected={isSelected}
                            >
                                {d.getDate()}
                            </button>
                        );
                    }),
                )}
            </div>
        </div>
    );
}

export default H18DayPicker;
