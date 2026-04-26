import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import s from './AlignmentBanner.module.css';

/**
 * H18 alignment-suggestion banner. Replaces the bottom-center
 * `animate-bounce` button with a top-center pill that has its own
 * countdown bar (8s) and pill-style accept/dismiss actions.
 *
 * Designed against docs/design/h18-deep/extras-alignment-banner.jsx.
 *
 * Wiring lives in NotesView (subscribes to autoAlignmentService);
 * this component is presentational only.
 */
export interface AlignmentBannerProps {
    /** Currently suggested page (1-indexed) */
    toPage: number;
    /** Confidence 0..1 from autoAlignmentService */
    confidence: number;
    /** Optional originating page for the "p.X → p.Y" chip */
    fromPage?: number;
    /** Called when user clicks the accept button (jumps to page). */
    onAccept: () => void;
    /** Called when user dismisses or the 8s countdown elapses. */
    onDismiss: () => void;
}

export default function AlignmentBanner({
    toPage,
    confidence,
    fromPage,
    onAccept,
    onDismiss,
}: AlignmentBannerProps) {
    const [accepted, setAccepted] = useState(false);

    // 8s auto-dismiss; matches the bar animation duration.
    useEffect(() => {
        if (accepted) return;
        const t = setTimeout(onDismiss, 8000);
        return () => clearTimeout(t);
    }, [accepted, onDismiss, toPage, fromPage]);

    const handleAccept = () => {
        setAccepted(true);
        onAccept();
        // Linger 600ms on the "已接受" state, then dismiss.
        setTimeout(onDismiss, 600);
    };

    const chip = fromPage ? `p.${fromPage} → p.${toPage}` : `p.${toPage}`;

    return (
        <div className={s.wrap}>
            <div className={s.pill}>
                <span className={s.icon}>✦</span>
                <div className={s.message}>
                    <span className={s.messageText}>AI 偵測到老師翻到投影片</span>
                    <span className={s.pageChip}>{chip}</span>
                </div>
                <div className={s.spacer} />
                {accepted ? (
                    <span className={s.accepted}>
                        <Check size={12} />
                        已接受 ({(confidence * 100).toFixed(0)}%)
                    </span>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={onDismiss}
                            className={`${s.btn} ${s.btnDismiss}`}
                        >
                            略過
                        </button>
                        <button
                            type="button"
                            onClick={handleAccept}
                            className={`${s.btn} ${s.btnAccept}`}
                        >
                            跳到 p.{toPage}
                        </button>
                    </>
                )}
                {!accepted && (
                    <div className={s.bar}>
                        <div className={s.barFill} />
                    </div>
                )}
            </div>
        </div>
    );
}
