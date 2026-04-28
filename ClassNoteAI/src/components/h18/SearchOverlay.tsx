/**
 * SearchOverlay · v0.7.0 Phase 6.8
 *
 * 對應 docs/design/h18-deep/h18-nav-pages.jsx SearchOverlay (L27+).
 * ⌘K 觸發。從 globalSearchService 拉真實 courses + lectures + actions
 * 結果。
 *
 * 留白：
 *  - Concept extraction (concepts indexed) — 沒做
 *  - Reminder index — 沒 reminders schema
 *  - 「重要程度」排序 (我們直接信任 minisearch fuzzy + boost)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
    globalSearchService,
    type SearchItem,
} from '../../services/globalSearchService';
import { keymapService } from '../../services/keymapService';
import { SHORTCUTS_CHANGE_EVENT } from '../../services/__contracts__/keymapService.contract';
import { H18EmptyState } from './H18EmptyState';
import s from './SearchOverlay.module.css';

export interface SearchOverlayProps {
    open: boolean;
    onClose: () => void;
    /** Action dispatcher — search picks an item, this routes it. */
    onAction: (action: SearchAction) => void;
}

export type SearchAction =
    | { kind: 'open-course'; courseId: string }
    | { kind: 'open-lecture'; courseId: string; lectureId: string }
    | { kind: 'home' }
    | { kind: 'add-course' }
    | { kind: 'open-ai' }
    | { kind: 'open-settings' };

function itemToAction(item: SearchItem): SearchAction | null {
    if (item.kind === 'COURSE' && item.courseId) {
        return { kind: 'open-course', courseId: item.courseId };
    }
    if (item.kind === 'NOTE' && item.courseId && item.lectureId) {
        return {
            kind: 'open-lecture',
            courseId: item.courseId,
            lectureId: item.lectureId,
        };
    }
    if (item.kind === 'ACTION' && item.action) {
        switch (item.action) {
            case 'home': return { kind: 'home' };
            case 'add-course': return { kind: 'add-course' };
            case 'open-ai': return { kind: 'open-ai' };
            case 'open-settings': return { kind: 'open-settings' };
        }
    }
    return null;
}

export default function SearchOverlay({ open, onClose, onAction }: SearchOverlayProps) {
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<SearchItem[]>([]);
    const [sel, setSel] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    // Refresh items on query change
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        globalSearchService.search(query).then((res) => {
            if (cancelled) return;
            setItems(res);
            setSel(0);
        });
        return () => {
            cancelled = true;
        };
    }, [open, query]);

    // Reset on open
    useEffect(() => {
        if (open) {
            setQuery('');
            // delay to give animation time + focus
            const t = setTimeout(() => inputRef.current?.focus(), 60);
            return () => clearTimeout(t);
        }
    }, [open]);

    // Scroll selected into view
    useEffect(() => {
        if (!listRef.current) return;
        const el = listRef.current.querySelector<HTMLElement>(
            `[data-idx="${sel}"]`,
        );
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [sel]);

    // S3a-3: refresh chip labels when shortcuts change.
    const [, setShortcutsTick] = useState(0);
    useEffect(() => {
        const onChange = () => setShortcutsTick((n) => n + 1);
        window.addEventListener(SHORTCUTS_CHANGE_EVENT, onChange);
        return () =>
            window.removeEventListener(SHORTCUTS_CHANGE_EVENT, onChange);
    }, []);

    const grouped = useMemo(() => {
        const order: string[] = [];
        const byGroup = new Map<string, { item: SearchItem; flatIdx: number }[]>();
        items.forEach((it, flatIdx) => {
            if (!byGroup.has(it.group)) {
                byGroup.set(it.group, []);
                order.push(it.group);
            }
            byGroup.get(it.group)!.push({ item: it, flatIdx });
        });
        return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
    }, [items]);

    if (!open) return null;

    const fire = (idx: number) => {
        const it = items[idx];
        if (!it) return;
        const action = itemToAction(it);
        onClose();
        if (action) onAction(action);
    };

    const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((cur) => Math.min(cur + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((cur) => Math.max(cur - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            fire(sel);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        }
    };

    return (
        <div className={s.scrim} onClick={onClose} role="dialog" aria-label="搜尋">
            <div className={s.modal} onClick={(e) => e.stopPropagation()}>
                <div className={s.head}>
                    <span className={s.headIcon} aria-hidden>⌕</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKey}
                        placeholder="搜尋課程、課堂、動作…"
                        className={s.input}
                    />
                    <span className={s.kbdHint}>ESC</span>
                </div>

                <div className={s.list} ref={listRef}>
                    {items.length === 0 ? (
                        <H18EmptyState
                            icon={<Search size={24} />}
                            heading={
                                query
                                    ? `找不到符合「${query}」的結果`
                                    : '輸入關鍵字開始搜尋'
                            }
                            description={
                                query
                                    ? `試試更短的關鍵字、課程標題、lecture title，或 ${keymapService.getDisplayLabel('newCourse')} / ${keymapService.getDisplayLabel('toggleAiDock')} / ${keymapService.getDisplayLabel('goHome')}。`
                                    : '可搜尋課程、lecture、或常用動作。'
                            }
                        />
                    ) : (
                        grouped.map((g) => (
                            <div key={g.group}>
                                <div className={s.groupHead}>{g.group}</div>
                                {g.items.map(({ item, flatIdx }) => {
                                    const selected = flatIdx === sel;
                                    const kindClass =
                                        item.kind === 'COURSE'
                                            ? s.kindCourse
                                            : item.kind === 'ACTION'
                                              ? s.kindAction
                                              : s.kindNote;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            data-idx={flatIdx}
                                            onMouseEnter={() => setSel(flatIdx)}
                                            onClick={() => fire(flatIdx)}
                                            className={`${s.row} ${selected ? s.rowSelected : ''}`}
                                        >
                                            <span className={`${s.kind} ${kindClass}`}>
                                                {item.kind}
                                            </span>
                                            <div className={s.rowBody}>
                                                <div className={s.rowLabel}>{item.label}</div>
                                                <div className={s.rowSub}>{item.sub}</div>
                                            </div>
                                            <div className={s.rowRight}>
                                                {item.shortcut && (
                                                    <span className={s.shortcut}>
                                                        {item.shortcut}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>

                <div className={s.foot}>
                    <span className={s.footHint}>
                        <span className={s.footKbd}>↑↓</span> 切換
                    </span>
                    <span className={s.footHint}>
                        <span className={s.footKbd}>↵</span> 開啟
                    </span>
                    <span className={s.footHint}>
                        <span className={s.footKbd}>ESC</span> 關閉
                    </span>
                </div>
            </div>
        </div>
    );
}
