/**
 * RecoveryHintBanner · Phase 7 Sprint 1 (S1.9)
 *
 * recoveryService 修復成功後 set localStorage flag `_recovery:<lectureId>`，
 * 本 banner 偵測到該 flag 時顯示「這堂課因 crash 自動還原」+ dismiss button。
 *
 * - 純 read-only consumer：只讀／刪 localStorage flag，不寫
 * - 不依 recoveryService 模組（避免 circular import / mount 順序問題）
 * - z-index 用 `--h18-z-banner` (30)（見 H18-MODAL-CONVENTIONS §2）
 * - role="status" + aria-live="polite"（被動公告，不打斷使用者）
 */

import { useEffect, useState } from 'react';
import styles from './RecoveryHintBanner.module.css';

const RECOVERY_FLAG_PREFIX = '_recovery:';

export interface RecoveryHintBannerProps {
    /** Lecture id used to look up the localStorage flag. */
    lectureId: string;
    /** Optional callback fired after the user dismisses the banner. */
    onDismiss?: () => void;
}

export function RecoveryHintBanner({
    lectureId,
    onDismiss,
}: RecoveryHintBannerProps) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        try {
            const key = `${RECOVERY_FLAG_PREFIX}${lectureId}`;
            const raw = localStorage.getItem(key);
            setVisible(raw != null);
        } catch {
            // localStorage blocked (private mode, SecurityError, etc.) — silently hide
            setVisible(false);
        }
    }, [lectureId]);

    const handleDismiss = () => {
        try {
            localStorage.removeItem(`${RECOVERY_FLAG_PREFIX}${lectureId}`);
        } catch {
            // ignore quota / blocked — still hide locally so user isn't stuck
        }
        setVisible(false);
        onDismiss?.();
    };

    if (!visible) return null;

    return (
        <div role="status" aria-live="polite" className={styles.banner}>
            <span className={styles.icon} aria-hidden>⚡</span>
            <span className={styles.text}>
                這堂課因為應用程式或系統崩潰時被自動還原。請確認字幕跟摘要無誤。
            </span>
            <button
                type="button"
                className={styles.dismissBtn}
                onClick={handleDismiss}
                aria-label="關閉提示"
            >
                我知道了
            </button>
        </div>
    );
}

export default RecoveryHintBanner;
