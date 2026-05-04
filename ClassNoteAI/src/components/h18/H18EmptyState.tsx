/**
 * H18EmptyState · Phase 7 Sprint 3 Round 3 (W13)
 *
 * 統一 5 個 surface 的 empty state visual spec：
 *   icon (lucide, optional) + heading + description (optional) + cta (optional)
 *
 * 對應 docs/design/h18-deep/PHASE-7-PLAN.md §9.5 W13。
 *
 * 使用範例：
 *   <H18EmptyState
 *       icon={<Inbox size={24} />}
 *       heading="收件夾是空的"
 *       description="新公告 / 作業到期會出現在這裡。"
 *   />
 *
 *   <H18EmptyState
 *       icon={<FileText size={24} />}
 *       heading="這堂課還沒有內容"
 *       description="可以匯入投影片 / 影片，或開始錄音。"
 *       cta={{ label: '匯入材料', onClick: ..., variant: 'primary' }}
 *   />
 *
 * a11y：
 *   - root 用 role="status" — screen reader 在 empty state 換時被告知
 *   - icon 用 aria-hidden — icon 是裝飾性的，文字本身就帶語意
 */

import React from 'react';
import styles from './H18EmptyState.module.css';

export interface H18EmptyStateCta {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
}

export interface H18EmptyStateProps {
    /** lucide-react icon (or any ReactNode). Optional — surface 沒 natural fit
     *  時 omit，component 會省略 icon 區塊 + 上方 spacing. */
    icon?: React.ReactNode;
    /** Single line title — required. */
    heading: string;
    /** Optional supporting copy. ≤ 320px max-width 自動換行. */
    description?: string;
    /** Optional CTA button. variant='primary' 用 accent；secondary (預設) 用 surface. */
    cta?: H18EmptyStateCta;
}

export function H18EmptyState({
    icon,
    heading,
    description,
    cta,
}: H18EmptyStateProps) {
    return (
        <div className={styles.empty} role="status">
            {icon && (
                <div className={styles.icon} aria-hidden>
                    {icon}
                </div>
            )}
            <div className={styles.heading}>{heading}</div>
            {description && (
                <div className={styles.description}>{description}</div>
            )}
            {cta && (
                <button
                    type="button"
                    className={`${styles.cta} ${cta.variant === 'primary' ? styles.primary : ''}`}
                    onClick={cta.onClick}
                >
                    {cta.label}
                </button>
            )}
        </div>
    );
}

export default H18EmptyState;
