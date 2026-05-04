/**
 * InboxRow · v0.7.x
 *
 * Single row inside H18Inbox. Extracted because the row now owns:
 *   - click → focus item in preview
 *   - hover-revealed action buttons (✓ 完成 / ⏰ 推遲)
 *   - per-row snooze popover with presets
 *   - state badges (推遲到 明天 08:00 / 已完成 2 小時前)
 *   - undo button when done/snoozed
 *
 * Why a wrapper <div> + inner <button>: nesting <button> inside
 * <button> is invalid HTML. The wrapper is .rowWrap (positioning
 * context for the absolute-positioned action overlay), inner
 * .row is the focus-target button, and .actions is a sibling.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { InboxItem } from './useAggregatedCanvasInbox';
import {
    buildSnoozePresets,
    describeMarkedAt,
    describeSnoozeUntil,
    type InboxStateInfo,
} from '../../services/inboxStateService';
import s from './InboxRow.module.css';

export const TYPE_TAG: Record<InboxItem['type'], string> = {
    assignment: '作業',
    quiz: '小考',
    announcement: '公告',
    event: '事件',
};

export const TYPE_ICON: Record<InboxItem['type'], string> = {
    assignment: '✎',
    quiz: '⚑',
    announcement: '📢',
    event: '◆',
};

function formatWhen(item: InboxItem, now: number): string {
    const t = item.when.getTime();
    const days = Math.round((t - now) / (1000 * 60 * 60 * 24));
    const mm = String(item.when.getMonth() + 1).padStart(2, '0');
    const dd = String(item.when.getDate()).padStart(2, '0');
    if (item.type === 'announcement') {
        const ago = now - t;
        const minsAgo = Math.floor(ago / (1000 * 60));
        if (minsAgo < 1) return '剛剛';
        if (minsAgo < 60) return `${minsAgo} 分前`;
        const hoursAgo = Math.floor(minsAgo / 60);
        if (hoursAgo < 24) return `${hoursAgo} 小時前`;
        const daysAgo = Math.floor(hoursAgo / 24);
        if (daysAgo < 7) return `${daysAgo} 天前`;
        return `${mm}/${dd}`;
    }
    if (days === 0) {
        const hh = String(item.when.getHours()).padStart(2, '0');
        const mi = String(item.when.getMinutes()).padStart(2, '0');
        return `今天 ${hh}:${mi}`;
    }
    if (days === 1) return `明天 ${mm}/${dd}`;
    if (days > 0 && days < 7) return `${days} 天後 · ${mm}/${dd}`;
    return `${mm}/${dd}`;
}

export interface InboxRowProps {
    item: InboxItem;
    selected: boolean;
    state: InboxStateInfo;
    /** ms epoch — passed in so all rows share the same "now" snapshot
     *  per render and labels stay consistent. */
    now: number;
    onSelect: () => void;
    onMarkDone: () => void;
    onSnooze: (untilMs: number) => void;
    onUndo: () => void;
}

export default function InboxRow({
    item,
    selected,
    state,
    now,
    onSelect,
    onMarkDone,
    onSnooze,
    onUndo,
}: InboxRowProps) {
    const [snoozeOpen, setSnoozeOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!snoozeOpen) return;
        const handleClickOutside = (e: globalThis.MouseEvent) => {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(e.target as Node)
            ) {
                setSnoozeOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSnoozeOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKey);
        };
    }, [snoozeOpen]);

    const presets = useMemo(() => buildSnoozePresets(new Date(now)), [now]);

    const isPending = state.state === 'pending';
    const isSnoozed = state.state === 'snoozed';
    const isDone = state.state === 'done';

    const stop = (e: MouseEvent) => {
        e.stopPropagation();
    };

    const wrapClass = [
        s.rowWrap,
        selected ? s.rowWrapSelected : '',
        item.urgent && isPending ? s.rowWrapUrgent : '',
        isSnoozed ? s.rowWrapSnoozed : '',
        isDone ? s.rowWrapDone : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={wrapClass}>
            <button
                type="button"
                onClick={onSelect}
                className={s.row}
                title={item.detail || item.title}
            >
                <div className={s.rowCourse}>
                    <span
                        className={s.rowCourseDot}
                        style={{ background: item.courseColor }}
                    />
                    <span className={s.rowCourseShort}>{item.courseTitle}</span>
                </div>
                <span className={s.rowTypeIcon}>{TYPE_ICON[item.type]}</span>
                <div className={s.rowMain}>
                    <div
                        className={`${s.rowTitle} ${isDone ? s.rowTitleDone : ''}`}
                    >
                        {item.title}
                    </div>
                    {(item.detail || isSnoozed || isDone) && (
                        <div className={s.rowDetail}>
                            <span className={s.rowKindTag}>
                                {TYPE_TAG[item.type]}
                            </span>
                            {isSnoozed && state.snoozedUntil ? (
                                <span className={s.stateBadgeSnoozed}>
                                    ⏰ 推遲到{' '}
                                    {describeSnoozeUntil(state.snoozedUntil, now)}
                                </span>
                            ) : isDone && state.markedAt ? (
                                <span className={s.stateBadgeDone}>
                                    ✓ 已完成 ·{' '}
                                    {describeMarkedAt(state.markedAt, now)}
                                </span>
                            ) : (
                                item.detail && (
                                    <span className={s.rowDetailText}>
                                        {item.detail}
                                    </span>
                                )
                            )}
                        </div>
                    )}
                </div>
                <span
                    className={`${s.rowWhen} ${
                        item.urgent && isPending ? s.rowWhenUrgent : ''
                    }`}
                >
                    {formatWhen(item, now)}
                </span>
            </button>

            <div className={s.actions} onClick={stop} onMouseDown={stop}>
                {isPending && (
                    <>
                        <button
                            type="button"
                            className={s.actionBtn}
                            onClick={(e) => {
                                e.stopPropagation();
                                onMarkDone();
                            }}
                            title="標記為完成 (E)"
                            aria-label="標記為完成"
                        >
                            ✓
                        </button>
                        <div className={s.snoozeWrap} ref={popoverRef}>
                            <button
                                type="button"
                                className={s.actionBtn}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSnoozeOpen((o) => !o);
                                }}
                                title="推遲 (H)"
                                aria-label="推遲"
                                aria-expanded={snoozeOpen}
                            >
                                ⏰
                            </button>
                            {snoozeOpen && (
                                <div className={s.snoozePopover} role="menu">
                                    <div className={s.snoozeHead}>推遲到</div>
                                    {presets.map((p) => (
                                        <button
                                            key={p.key}
                                            type="button"
                                            className={s.snoozeOption}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onSnooze(p.untilMs);
                                                setSnoozeOpen(false);
                                            }}
                                            role="menuitem"
                                        >
                                            <span className={s.snoozeLabel}>
                                                {p.label}
                                            </span>
                                            {p.hint && (
                                                <span className={s.snoozeHint}>
                                                    {p.hint}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}
                {(isSnoozed || isDone) && (
                    <button
                        type="button"
                        className={s.actionBtn}
                        onClick={(e) => {
                            e.stopPropagation();
                            onUndo();
                        }}
                        title="還原為待辦"
                        aria-label="還原為待辦"
                    >
                        ↶
                    </button>
                )}
            </div>
        </div>
    );
}
