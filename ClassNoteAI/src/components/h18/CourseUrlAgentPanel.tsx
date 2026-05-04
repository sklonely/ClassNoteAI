/**
 * CourseUrlAgentPanel · v0.7.x
 *
 * 嵌進 AddCourseDialog "從網址" mode 的 inner panel — 給 user 貼網址、
 * 跑 courseUrlAgent、即時顯示進度，完成後 hand AgentResult 上去
 * 由 dialog 的 handleSubmit 帶進 onSubmit。
 */

import { useEffect, useRef, useState } from 'react';
import {
    AgentError,
    processCourseUrl,
    type AgentProgress,
    type AgentResult,
} from '../../services/courseUrlAgent';
import s from './CourseUrlAgentPanel.module.css';

export interface CourseUrlAgentPanelProps {
    /** Title hint (從 dialog 的 title input 同步進來，給 AI 當 fallback)。 */
    titleHint?: string;
    /** 完成時把 result 給父元件 — 父元件預填 form / 開放「建立」。 */
    onResult: (result: AgentResult) => void;
    /** 任何時候 result 失效（user 改 URL / 取消 / 失敗）就清掉父元件 state。 */
    onClear: () => void;
}

interface RunState {
    kind: 'idle' | 'running' | 'success' | 'error';
    progress: AgentProgress[];
    result?: AgentResult;
    error?: { kind: AgentError['kind']; message: string };
}

const STEP_ICON: Record<AgentProgress['step'], string> = {
    'fetch-root': '◐',
    'detect-login': '◐',
    discover: '◐',
    'fetch-page': '◐',
    extract: '◐',
    analyze: '◐',
    done: '✓',
};

export default function CourseUrlAgentPanel({
    titleHint,
    onResult,
    onClear,
}: CourseUrlAgentPanelProps) {
    const [url, setUrl] = useState('');
    const [run, setRun] = useState<RunState>({ kind: 'idle', progress: [] });
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    const start = async () => {
        const trimmed = url.trim();
        if (!trimmed) return;
        // Cancel any prior run
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setRun({ kind: 'running', progress: [] });
        onClear();
        try {
            const gen = processCourseUrl(trimmed, {
                signal: controller.signal,
                courseTitleHint: titleHint?.trim() || undefined,
            });
            let last: IteratorResult<AgentProgress, AgentResult>;
            while (true) {
                last = await gen.next();
                if (last.done) break;
                const ev = last.value;
                setRun((cur) =>
                    cur.kind === 'running'
                        ? { ...cur, progress: [...cur.progress, ev] }
                        : cur,
                );
            }
            const result = last.value as AgentResult;
            setRun((cur) =>
                cur.kind === 'running'
                    ? { kind: 'success', progress: cur.progress, result }
                    : cur,
            );
            onResult(result);
        } catch (err) {
            if (controller.signal.aborted) {
                setRun({ kind: 'idle', progress: [] });
                return;
            }
            const ae =
                err instanceof AgentError
                    ? err
                    : new AgentError(
                          'fetch-failed',
                          (err as Error)?.message || '未知錯誤',
                      );
            setRun((cur) => ({
                kind: 'error',
                progress: cur.progress,
                error: { kind: ae.kind, message: ae.message },
            }));
        }
    };

    const cancel = () => {
        abortRef.current?.abort();
        setRun({ kind: 'idle', progress: [] });
        onClear();
    };

    const reset = () => {
        setRun({ kind: 'idle', progress: [] });
        onClear();
    };

    const handleUrlChange = (next: string) => {
        setUrl(next);
        // Invalidate previous result whenever URL changes
        if (run.kind !== 'idle') {
            setRun({ kind: 'idle', progress: [] });
            onClear();
        }
    };

    return (
        <div className={s.panel}>
            <div className={s.inputRow}>
                <input
                    className={s.urlInput}
                    type="url"
                    value={url}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && run.kind !== 'running') {
                            e.preventDefault();
                            void start();
                        }
                    }}
                    placeholder="https://prof.example.edu/cs101 / 學校公開 syllabus 頁"
                    disabled={run.kind === 'running'}
                />
                {run.kind === 'running' ? (
                    <button type="button" onClick={cancel} className={s.btnGhost}>
                        取消
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={start}
                        disabled={!url.trim()}
                        className={s.btnPrimary}
                    >
                        ✦ 解析
                    </button>
                )}
            </div>

            <p className={s.hint}>
                Agent 會抓主頁 → 偵測登入牆 → 找相關連結（同站同層）→ 餵 AI
                整理欄位。<strong>Canvas / Moodle 等需要登入的 LMS 不支援</strong>，
                請改走「個人頁 → 整合」的 RSS 路徑。
            </p>

            {run.progress.length > 0 && (
                <div className={s.progressList}>
                    {run.progress.map((p, i) => {
                        const isLast = i === run.progress.length - 1;
                        const icon =
                            run.kind === 'success' || (!isLast && run.kind === 'running')
                                ? '✓'
                                : run.kind === 'error' && isLast
                                  ? '⚠'
                                  : STEP_ICON[p.step];
                        return (
                            <div
                                key={i}
                                className={`${s.progressRow} ${
                                    !isLast || run.kind === 'success'
                                        ? s.progressRowDone
                                        : run.kind === 'error' && isLast
                                          ? s.progressRowError
                                          : s.progressRowActive
                                }`}
                            >
                                <span className={s.progressIcon}>{icon}</span>
                                <span className={s.progressMsg}>
                                    {p.message}
                                    {typeof p.current === 'number' && typeof p.total === 'number' && (
                                        <span className={s.progressCount}>
                                            {' '}
                                            ({p.current}/{p.total})
                                        </span>
                                    )}
                                </span>
                                {p.detail && (
                                    <span className={s.progressDetail}>{p.detail}</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {run.kind === 'error' && run.error && (
                <div className={s.errorBox}>
                    <div className={s.errorTitle}>
                        ⚠{' '}
                        {run.error.kind === 'login-required'
                            ? '需要登入'
                            : run.error.kind === 'invalid-url'
                              ? '網址格式不正確'
                              : run.error.kind === 'not-html'
                                ? '不是 HTML 頁面'
                                : run.error.kind === 'no-content'
                                  ? '抓不到內容'
                                  : run.error.kind === 'ai-failed'
                                    ? 'AI 整理失敗'
                                    : run.error.kind === 'fetch-failed'
                                      ? '網路或 fetch 失敗'
                                      : '解析失敗'}
                    </div>
                    <div className={s.errorMessage}>{run.error.message}</div>
                    <div className={s.errorActions}>
                        <button type="button" onClick={reset} className={s.btnGhost}>
                            清除
                        </button>
                        <button type="button" onClick={start} className={s.btnPrimary}>
                            重試
                        </button>
                    </div>
                </div>
            )}

            {run.kind === 'success' && run.result && (
                <div className={s.resultBox}>
                    <div className={s.resultEyebrow}>✓ 解析完成 — 預覽如下</div>
                    <div className={s.resultRow}>
                        <span className={s.resultLabel}>標題</span>
                        <span className={s.resultValue}>{run.result.title}</span>
                    </div>
                    {run.result.syllabus.instructor && (
                        <div className={s.resultRow}>
                            <span className={s.resultLabel}>老師</span>
                            <span className={s.resultValue}>
                                {run.result.syllabus.instructor}
                                {run.result.syllabus.instructor_email && (
                                    <span className={s.resultMuted}>
                                        {' · '}
                                        {run.result.syllabus.instructor_email}
                                    </span>
                                )}
                            </span>
                        </div>
                    )}
                    {run.result.syllabus.time && (
                        <div className={s.resultRow}>
                            <span className={s.resultLabel}>時間</span>
                            <span className={s.resultValue}>{run.result.syllabus.time}</span>
                        </div>
                    )}
                    {run.result.syllabus.location && (
                        <div className={s.resultRow}>
                            <span className={s.resultLabel}>地點</span>
                            <span className={s.resultValue}>
                                {run.result.syllabus.location}
                            </span>
                        </div>
                    )}
                    {run.result.syllabus.grading &&
                        run.result.syllabus.grading.length > 0 && (
                            <div className={s.resultRow}>
                                <span className={s.resultLabel}>評分</span>
                                <span className={s.resultValue}>
                                    {run.result.syllabus.grading
                                        .map((g) => `${g.item} ${g.percentage}`)
                                        .join('、')}
                                </span>
                            </div>
                        )}
                    {run.result.syllabus.schedule &&
                        run.result.syllabus.schedule.length > 0 && (
                            <div className={s.resultRow}>
                                <span className={s.resultLabel}>堂數</span>
                                <span className={s.resultValue}>
                                    {run.result.syllabus.schedule.length} 堂 (lecture-by-lecture)
                                </span>
                            </div>
                        )}
                    {run.result.syllabus.overview && (
                        <div className={s.resultOverview}>
                            {run.result.syllabus.overview}
                        </div>
                    )}
                    <div className={s.resultFoot}>
                        <span className={s.resultMuted}>
                            來源 · {run.result.sourceUrls.length} 頁
                        </span>
                        <button type="button" onClick={reset} className={s.btnGhost}>
                            重新解析
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
