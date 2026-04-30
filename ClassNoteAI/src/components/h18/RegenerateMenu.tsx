/**
 * RegenerateMenu · cp75.31
 *
 * Top-level split-button for re-running the AI summary pipeline.
 * Primary action defaults to ['all']; chevron exposes 摘要 / 章節 /
 * Q&A / 全部.
 *
 * Vanilla HTML/CSS — no shadcn, no Radix. Closes on Esc + click-outside.
 *
 * NOTE: Q&A regeneration not yet implemented (cp75.32). The menu item
 * shows but is wired as a no-op so users see the upcoming option.
 */

import { useEffect, useRef, useState } from 'react';
import s from './H18ReviewPage.module.css';

export type RegenerateTarget = 'summary' | 'sections' | 'qa' | 'all';

export interface RegenerateMenuProps {
    onRegenerate: (targets: RegenerateTarget[]) => void;
    disabled?: boolean;
    running?: boolean;
    hasExistingSummary?: boolean;
}

export function RegenerateMenu({
    onRegenerate,
    disabled = false,
    running = false,
    hasExistingSummary = false,
}: RegenerateMenuProps) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement | null>(null);

    // Esc + click-outside.
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        const onPointerDown = (e: PointerEvent) => {
            if (
                wrapRef.current &&
                e.target instanceof Node &&
                !wrapRef.current.contains(e.target)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    const fireAndClose = (targets: RegenerateTarget[]) => {
        setOpen(false);
        onRegenerate(targets);
    };

    const primaryLabel = running
        ? '✦ 生成中…'
        : hasExistingSummary
          ? '✦ 重新生成'
          : '✦ 生成摘要';

    const primaryTitle = disabled
        ? '沒有逐字稿，無法重新生成'
        : running
          ? '取消當前任務並重新生成全部'
          : hasExistingSummary
            ? '用最新逐字稿重新生成（摘要 + 章節 + Q&A）'
            : '從目前逐字稿生成摘要、章節、Q&A';

    return (
        <div ref={wrapRef} className={s.regenWrap}>
            <button
                type="button"
                onClick={() => fireAndClose(['all'])}
                disabled={disabled}
                aria-busy={running ? true : undefined}
                title={primaryTitle}
                className={s.regenPrimary}
            >
                {primaryLabel}
            </button>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="重新生成選項"
                title="選擇要重新生成的部分"
                className={s.regenChevron}
            >
                ▼
            </button>
            {open && (
                <div role="menu" className={s.regenMenu}>
                    <button
                        type="button"
                        role="menuitem"
                        className={s.regenMenuItem}
                        onClick={() => fireAndClose(['summary'])}
                    >
                        摘要
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={s.regenMenuItem}
                        onClick={() => fireAndClose(['sections'])}
                    >
                        章節
                    </button>
                    {/* TODO cp75.32 — generateQA not yet implemented; clicking
                        this option is a no-op for now so users still see the
                        upcoming target on the menu. */}
                    <button
                        type="button"
                        role="menuitem"
                        className={s.regenMenuItem}
                        onClick={() => fireAndClose(['qa'])}
                        title="即將推出 — cp75.32"
                    >
                        Q&A
                        <span className={s.regenMenuItemHint}>· 即將推出</span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={s.regenMenuItem}
                        onClick={() => fireAndClose(['all'])}
                    >
                        全部
                    </button>
                </div>
            )}
        </div>
    );
}

export default RegenerateMenu;
