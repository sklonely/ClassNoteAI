import { useState } from 'react';
import { AlertTriangle, Save, Trash2, X, Loader2, Sparkles } from 'lucide-react';
import {
    recordingRecoveryService,
    type RecoverableSession,
} from '../services/recordingRecoveryService';

/**
 * v0.5.2 crash-recovery modal. Replaces the MVP `window.confirm()` in
 * App.tsx with a proper list UI, because a user with multiple crashed
 * sessions (rare but possible across several days of laptop-lid-close
 * "sleep"-kill events) shouldn't be forced through N sequential
 * blocking dialogs.
 *
 * Design notes:
 * - Non-dismissable by clicking outside. Recovery is a decision point
 *   that shouldn't be accidentally skipped — the .pcm on disk is
 *   dead weight until the user picks an action.
 * - Per-session recover/discard buttons. For >1 session, also show
 *   bulk "Recover all" / "Discard all" in the header so a user
 *   returning after multiple laptop-lid crashes isn't forced into N
 *   sequential clicks (F5 polish).
 * - Shows approx duration + started-at so the user knows whether a
 *   given orphan is worth keeping (2 min of noise vs 45 min of class).
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

    const setActionState = (id: string, s: ActionState) => {
        setStates((prev) => ({ ...prev, [id]: s }));
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

    /** Escape hatch for the case where both Recover AND Discard fail
     *  deterministically (disk full, permissions broken, corrupted
     *  .pcm). Without this the user would be trapped forever on the
     *  modal every launch. "Skip" removes the session from the UI
     *  list for this session only — the .pcm and DB row remain so a
     *  future fix can still pick them up. Hidden behind an error
     *  state so normal users never see it. */
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

    const remaining = sessions.filter((s) => !states[s.lectureId]?.done);
    const anyInFlight = remaining.some((s) => states[s.lectureId]?.inFlight);

    /** Bulk action helper: run recover or discard over every un-done
     *  session sequentially, skipping ones that already failed (their
     *  error state remains so the user can retry individually). */
    const bulkRun = async (
        fn: (s: RecoverableSession) => Promise<void>,
    ) => {
        for (const s of remaining) {
            const cur = states[s.lectureId];
            if (cur?.done || cur?.inFlight) continue;
            // eslint-disable-next-line no-await-in-loop
            await fn(s);
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
        await bulkRun(async (s) => {
            setActionState(s.lectureId, { inFlight: true });
            try {
                await recordingRecoveryService.discard(s.lectureId, true);
                setActionState(s.lectureId, { inFlight: false, done: true });
                onSessionResolved(s.lectureId);
            } catch (err) {
                setActionState(s.lectureId, {
                    inFlight: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        });
        if (remaining.every((s) => states[s.lectureId]?.done)) onAllResolved();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-2xl mx-4 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                    <div className="flex-1">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            未完成的錄音（{remaining.length}）
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            上次錄音時 app 沒有正常結束。這些音檔還保存在磁碟上，可以選擇還原成 WAV，或直接丟棄。
                        </p>
                    </div>
                    {/* Bulk actions. Only visible with >1 pending session —
                        a single-session prompt already has per-row buttons
                        that are closer to the info. */}
                    {remaining.length > 1 && (
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                onClick={handleRecoverAll}
                                disabled={anyInFlight}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="還原每一筆未處理的錄音"
                            >
                                <Sparkles className="w-3 h-3" />
                                全部還原
                            </button>
                            <button
                                onClick={handleDiscardAll}
                                disabled={anyInFlight}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="丟棄每一筆未處理的錄音"
                            >
                                <Trash2 className="w-3 h-3" />
                                全部丟棄
                            </button>
                        </div>
                    )}
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-4 space-y-3">
                    {sessions.map((session) => {
                        const state = states[session.lectureId] || { inFlight: false };
                        if (state.done) return null;

                        return (
                            <div
                                key={session.lectureId}
                                className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-800/50"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                        {session.lecture.title || '（未命名課堂）'}
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-3">
                                        <span>約 {formatDuration(session.durationSeconds)}</span>
                                        <span>·</span>
                                        <span>{formatStarted(session.startedAt)}</span>
                                        <span>·</span>
                                        <span className="font-mono text-[10px]">
                                            {(session.bytes / 1_000_000).toFixed(1)} MB
                                        </span>
                                    </div>
                                    {state.error && (
                                        <div className="text-xs text-red-500 mt-2 flex items-center gap-2 flex-wrap">
                                            <span>錯誤：{state.error}</span>
                                            <button
                                                onClick={() => handleSkipUntilNextLaunch(session)}
                                                className="underline text-red-700 dark:text-red-400 hover:text-red-900"
                                                title="本次啟動先跳過此項目；下次啟動仍會再次出現"
                                            >
                                                暫時跳過
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button
                                        onClick={() => handleRecover(session)}
                                        disabled={state.inFlight}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {state.inFlight ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Save className="w-3.5 h-3.5" />
                                        )}
                                        還原
                                    </button>
                                    <button
                                        onClick={() => handleDiscard(session)}
                                        disabled={state.inFlight}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        丟棄
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-800/30 flex items-center justify-between">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <X className="w-3 h-3" />
                        關閉本視窗前請先處理所有項目
                    </p>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                        v0.5.2 crash-recovery
                    </div>
                </div>
            </div>
        </div>
    );
}
