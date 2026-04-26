import { useState } from 'react';
import { AlertTriangle, Save, Trash2, X, Loader2, Sparkles } from 'lucide-react';
import {
    recordingRecoveryService,
    type RecoverableSession,
} from '../services/recordingRecoveryService';
import s from './RecoveryPromptModal.module.css';

/**
 * v0.5.2 crash-recovery modal. Replaces the MVP `window.confirm()` in
 * App.tsx with a proper list UI, because a user with multiple crashed
 * sessions (rare but possible across several days of laptop-lid-close
 * "sleep"-kill events) shouldn't be forced through N sequential
 * blocking dialogs.
 */

interface Props {
    sessions: RecoverableSession[];
    onSessionResolved: (lectureId: string) => void;
    onAllResolved: () => void;
}

type ActionState = { inFlight: boolean; error?: string; done?: boolean };

export default function RecoveryPromptModal({
    sessions,
    onSessionResolved,
    onAllResolved,
}: Props) {
    const [states, setStates] = useState<Record<string, ActionState>>({});

    if (sessions.length === 0) return null;

    const setActionState = (id: string, st: ActionState) => {
        setStates((prev) => ({ ...prev, [id]: st }));
    };

    const handleRecover = async (session: RecoverableSession) => {
        setActionState(session.lectureId, { inFlight: true });
        try {
            const path = await recordingRecoveryService.recover(session.lectureId);
            console.log(`[Recovery] Recovered ${session.lectureId} → ${path}`);
            setActionState(session.lectureId, { inFlight: false, done: true });
            onSessionResolved(session.lectureId);
            if (sessions.length === 1) onAllResolved();
        } catch (err) {
            setActionState(session.lectureId, {
                inFlight: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const handleDiscard = async (session: RecoverableSession) => {
        if (!window.confirm(`確定要丟棄「${session.lecture.title || '(未命名)'}」的錄音嗎？此動作無法復原。`)) {
            return;
        }
        setActionState(session.lectureId, { inFlight: true });
        try {
            await recordingRecoveryService.discard(session.lectureId, true);
            console.log(`[Recovery] Discarded ${session.lectureId}`);
            setActionState(session.lectureId, { inFlight: false, done: true });
            onSessionResolved(session.lectureId);
            if (sessions.length === 1) onAllResolved();
        } catch (err) {
            setActionState(session.lectureId, {
                inFlight: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const handleSkipUntilNextLaunch = (session: RecoverableSession) => {
        onSessionResolved(session.lectureId);
        if (sessions.length === 1) onAllResolved();
    };

    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds} 秒`;
        const m = Math.round(seconds / 60);
        if (m < 60) return `${m} 分鐘`;
        const h = Math.floor(m / 60);
        const rem = m % 60;
        return rem === 0 ? `${h} 小時` : `${h} 小時 ${rem} 分`;
    };

    const formatStarted = (iso: string | null): string => {
        if (!iso) return '時間未知';
        try {
            const d = new Date(iso);
            return d.toLocaleString('zh-TW', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return iso;
        }
    };

    const remaining = sessions.filter((sess) => !states[sess.lectureId]?.done);
    const anyInFlight = remaining.some((sess) => states[sess.lectureId]?.inFlight);

    const bulkRun = async (
        fn: (sess: RecoverableSession) => Promise<void>,
    ) => {
        for (const sess of remaining) {
            const cur = states[sess.lectureId];
            if (cur?.done || cur?.inFlight) continue;
            // eslint-disable-next-line no-await-in-loop
            await fn(sess);
        }
    };

    const handleRecoverAll = () => bulkRun(handleRecover);
    const handleDiscardAll = async () => {
        if (
            !window.confirm(
                `確定要丟棄全部 ${remaining.length} 筆未完成錄音嗎？此動作無法復原。`,
            )
        )
            return;
        await bulkRun(async (sess) => {
            setActionState(sess.lectureId, { inFlight: true });
            try {
                await recordingRecoveryService.discard(sess.lectureId, true);
                setActionState(sess.lectureId, { inFlight: false, done: true });
                onSessionResolved(sess.lectureId);
            } catch (err) {
                setActionState(sess.lectureId, {
                    inFlight: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        });
        if (remaining.every((sess) => states[sess.lectureId]?.done)) onAllResolved();
    };

    return (
        <div className={s.backdrop}>
            <div className={s.card}>
                <div className={s.header}>
                    <div className={s.headerIcon}>
                        <AlertTriangle />
                    </div>
                    <div className={s.headerText}>
                        <div className={s.eyebrow}>CRASH RECOVERY</div>
                        <h2 className={s.title}>
                            未完成的錄音（{remaining.length}）
                        </h2>
                        <p className={s.description}>
                            上次錄音時 app 沒有正常結束。這些音檔還保存在磁碟上，可以選擇還原成 WAV，或直接丟棄。
                        </p>
                    </div>
                    {remaining.length > 1 && (
                        <div className={s.bulkRow}>
                            <button
                                onClick={handleRecoverAll}
                                disabled={anyInFlight}
                                className={`${s.bulkBtn} ${s.bulkRecover}`}
                                title="還原每一筆未處理的錄音"
                            >
                                <Sparkles size={12} />
                                全部還原
                            </button>
                            <button
                                onClick={handleDiscardAll}
                                disabled={anyInFlight}
                                className={`${s.bulkBtn} ${s.bulkDiscard}`}
                                title="丟棄每一筆未處理的錄音"
                            >
                                <Trash2 size={12} />
                                全部丟棄
                            </button>
                        </div>
                    )}
                </div>

                <div className={s.list}>
                    {sessions.map((session) => {
                        const state = states[session.lectureId] || { inFlight: false };
                        if (state.done) return null;
                        const resolving = state.inFlight;

                        return (
                            <div
                                key={session.lectureId}
                                className={`${s.row} ${resolving ? s.rowResolving : ''}`}
                            >
                                <div className={s.rowMeta}>
                                    <div className={s.rowTitle}>
                                        {session.lecture.title || '（未命名課堂）'}
                                    </div>
                                    <div className={s.rowSub}>
                                        <span>約 {formatDuration(session.durationSeconds)}</span>
                                        <span>·</span>
                                        <span>{formatStarted(session.startedAt)}</span>
                                        <span>·</span>
                                        <span>{(session.bytes / 1_000_000).toFixed(1)} MB</span>
                                        {session.transcriptSegments > 0 && (
                                            <>
                                                <span>·</span>
                                                <span className={s.rowSubAccent}>
                                                    含 {session.transcriptSegments} 段已轉錄字幕
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    {state.error && (
                                        <div className={s.rowError}>
                                            <span>錯誤：{state.error}</span>
                                            <button
                                                onClick={() => handleSkipUntilNextLaunch(session)}
                                                className={s.rowSkip}
                                                title="本次啟動先跳過此項目；下次啟動仍會再次出現"
                                            >
                                                暫時跳過
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => handleDiscard(session)}
                                    disabled={state.inFlight}
                                    className={`${s.rowBtn} ${s.rowDiscard}`}
                                >
                                    <Trash2 size={12} />
                                    丟棄
                                </button>
                                <button
                                    onClick={() => handleRecover(session)}
                                    disabled={state.inFlight}
                                    className={`${s.rowBtn} ${s.rowRecover}`}
                                >
                                    {state.inFlight ? (
                                        <Loader2 size={12} className={s.spin} />
                                    ) : (
                                        <Save size={12} />
                                    )}
                                    還原
                                </button>
                            </div>
                        );
                    })}
                </div>

                <div className={s.footer}>
                    <span className={s.footerNote}>
                        <X size={11} />
                        關閉本視窗前請先處理所有項目
                    </span>
                    <span className={s.footerVer}>v0.5.2 crash-recovery</span>
                </div>
            </div>
        </div>
    );
}
