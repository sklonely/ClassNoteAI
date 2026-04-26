/**
 * H18RecordingPage · v0.7.0 Phase 6.5+ (real RV2 Layout A)
 *
 * 對應 docs/design/h18-deep/h18-recording-v2.jsx (RecordingPage +
 * RV2LayoutA + RV2Transport + RV2FinishingOverlay).
 *
 * Layout A：86px slide strip | 1fr main slide | 460px subtitle stream
 * 底 60px transport bar (start/pause/stop + elapsed)。
 *
 * 接 backend 的部分：
 *  - useRecordingSession hook：AudioRecorder + transcriptionService +
 *    subtitleService + storageService.saveLecture
 *  - subtitle stream live：subtitleService.subscribe → re-render
 *
 * 留白（per CP-6.5+ 範圍）：
 *  - Slide strip / 投影片：display only，PDF 匯入 / OCR / 對齊**沒接**
 *  - RV2FloatingNotes 浮動筆記窗：沒做
 *  - 5-step finishing animation：UI 在，但跑的是 fixed timer (3.6s 模擬)
 *    ，沒對應後端的 transcribe → segment → summary → index 階段事件
 *  - BatteryMonitor / recordingDeviceMonitor：沒接（用戶低電量時不會 auto-stop）
 *  - 鍵盤快捷鍵 ⌘⇧N（floating notes）/ Esc：沒接
 *  - drag-drop 教材匯入：沒接
 */

import { useEffect, useState } from 'react';
import { FileText, BookOpen, Mic, Pause, Play, Square } from 'lucide-react';
import type { Course, Lecture } from '../../types';
import { storageService } from '../../services/storageService';
import {
    useRecordingSession,
    fmtElapsed,
} from './useRecordingSession';
import { courseColor } from './courseColor';
import s from './H18RecordingPage.module.css';

export interface H18RecordingPageProps {
    courseId: string;
    lectureId: string;
    onBack: () => void;
}

const FINISH_STEPS = [
    { key: 'transcribe', label: '轉錄收尾', hint: '把最後幾段未提交的句子寫進 DB' },
    { key: 'segment', label: '段落切分', hint: '依停頓 / 主題切章節' },
    { key: 'summary', label: '生成摘要', hint: 'AI 抽重點 + Q&A' },
    { key: 'index', label: '建立索引', hint: 'RAG embedding + 全域搜尋' },
    { key: 'done', label: '完成', hint: '跳到 Review' },
] as const;

const FINISH_STEP_MS = 720;

export default function H18RecordingPage({
    courseId,
    lectureId,
    onBack,
}: H18RecordingPageProps) {
    const [lecture, setLecture] = useState<Lecture | null>(null);
    const [course, setCourse] = useState<Course | null>(null);

    const session = useRecordingSession({ courseId, lectureId });

    const [finishOpen, setFinishOpen] = useState(false);
    const [finishStep, setFinishStep] = useState(0);
    const [finishedDone, setFinishedDone] = useState(false);

    // Load lecture + course meta
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            storageService.getLecture(lectureId),
            storageService.getCourse(courseId),
        ]).then(([lec, c]) => {
            if (cancelled) return;
            setLecture(lec);
            setCourse(c);
        });
        return () => {
            cancelled = true;
        };
    }, [lectureId, courseId]);

    // Auto-start recording on mount (lecture is already status='recording'
    // when we land here). User can click "結束" to stop.
    useEffect(() => {
        if (session.status === 'idle') {
            void session.start();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 5-step finishing overlay simulation
    useEffect(() => {
        if (!finishOpen) return;
        if (finishStep >= FINISH_STEPS.length - 1) {
            setFinishedDone(true);
            return;
        }
        const t = setTimeout(() => setFinishStep((s) => s + 1), FINISH_STEP_MS);
        return () => clearTimeout(t);
    }, [finishOpen, finishStep]);

    const handleStop = async () => {
        setFinishOpen(true);
        setFinishStep(0);
        setFinishedDone(false);
        await session.stop();
    };

    const handleFinishDone = () => {
        setFinishOpen(false);
        onBack();
    };

    const handlePauseResume = () => {
        if (session.status === 'recording') void session.pause();
        else if (session.status === 'paused') void session.resume();
    };

    const isRunning = session.status === 'recording' || session.status === 'paused';
    const isPaused = session.status === 'paused';
    const accent = courseColor(courseId);

    return (
        <div className={s.page}>
            {/* Hero */}
            <div className={s.hero}>
                <div className={s.crumb}>
                    <button type="button" onClick={onBack} className={s.crumbBack}>
                        ← 返回課程
                    </button>
                    {course && (
                        <>
                            <span className={s.crumbCourse} style={{ color: accent }}>
                                {course.title}
                            </span>
                            <span className={s.crumbDivider}>/</span>
                        </>
                    )}
                    <span className={s.crumbLecture}>
                        {lecture?.title || '錄音中…'}
                    </span>
                </div>
                <span
                    className={`${s.livePill} ${isPaused ? s.livePillPaused : ''}`}
                >
                    <span className={s.liveDot} />
                    {isPaused ? 'PAUSED' : '● REC · LIVE'}
                </span>
                <div className={s.heroSpacer} />
                <span className={s.elapsed}>{fmtElapsed(session.elapsed)}</span>
            </div>

            {/* Body */}
            <div className={s.body}>
                {/* Slide strip (留白) */}
                <div className={s.slideStrip}>
                    <div className={s.slideStripEmpty}>
                        投影片<br />
                        匯入<br />
                        留白
                    </div>
                </div>

                {/* Main slide (留白) */}
                <div className={s.slideMain}>
                    <div className={s.slideEmpty}>
                        <span className={s.slideEmptyIcon}>
                            <BookOpen size={36} />
                        </span>
                        <div>還沒匯入投影片</div>
                        <div className={s.slideEmptyHint}>
                            錄音已就緒 · 投影片 / PDF 對齊 P6.x 後接
                        </div>
                        <button type="button" className={s.slideImportBtn} disabled>
                            ⤓ 匯入教材（留白）
                        </button>
                    </div>
                </div>

                {/* Subtitle stream */}
                <div className={s.subPane}>
                    <div className={s.subHead}>
                        <FileText size={12} />
                        <span className={s.subHeadEyebrow}>雙語字幕</span>
                        <span className={s.subHeadCount}>
                            {session.segments.length} 句
                        </span>
                    </div>
                    <div className={s.subStream}>
                        {session.segments.length === 0 && !session.currentText && (
                            <div className={s.subEmpty}>
                                字幕將顯示在這裡。
                                <br />
                                開始錄音後 Parakeet 會即時轉錄。
                            </div>
                        )}
                        {session.segments.map((seg) => (
                            <div key={seg.id} className={s.subRow}>
                                <div className={s.subTime}>
                                    {fmtElapsed(
                                        Math.max(0, Math.floor((seg.startTime - (seg.startTime > 0 ? seg.startTime - seg.endTime + seg.endTime : 0)) / 1000)),
                                    ) || '—'}
                                </div>
                                <div className={s.subEn}>{seg.displayText || seg.text}</div>
                                {seg.displayTranslation && (
                                    <div className={s.subZh}>{seg.displayTranslation}</div>
                                )}
                            </div>
                        ))}
                        {session.currentText && (
                            <div className={s.subCurrent}>
                                <div className={s.subCurrentEyebrow}>● 即時轉錄</div>
                                <div className={s.subCurrentText}>{session.currentText}</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Transport bar */}
            <div className={s.transport}>
                <button
                    type="button"
                    onClick={isRunning ? handleStop : () => void session.start()}
                    disabled={session.status === 'stopping'}
                    className={`${s.recBtn} ${isRunning ? s.recBtnRecording : ''}`}
                    title={isRunning ? '結束錄音' : '開始錄音'}
                    aria-label={isRunning ? '結束錄音' : '開始錄音'}
                >
                    {session.status === 'recording' ? (
                        <Square size={16} />
                    ) : isPaused ? (
                        <Square size={16} />
                    ) : (
                        <Mic size={18} />
                    )}
                </button>

                <button
                    type="button"
                    onClick={handlePauseResume}
                    disabled={!isRunning || session.status === 'stopping'}
                    className={s.transportBtn}
                >
                    {isPaused ? (
                        <>
                            <Play size={12} /> 繼續
                        </>
                    ) : (
                        <>
                            <Pause size={12} /> 暫停
                        </>
                    )}
                </button>

                <span className={s.transportStatus}>
                    {session.status === 'idle' && '準備中…'}
                    {session.status === 'recording' && `● REC · ${session.segments.length} 句`}
                    {session.status === 'paused' && '已暫停'}
                    {session.status === 'stopping' && '處理中…'}
                    {session.status === 'stopped' && '已完成'}
                    {session.status === 'error' && '錯誤'}
                </span>

                <div className={s.transportSpacer} />

                {session.error && (
                    <span className={s.transportError} title={session.error}>
                        ⚠ {session.error}
                    </span>
                )}

                <button
                    type="button"
                    onClick={onBack}
                    className={`${s.transportBtn} ${s.transportBtnDanger}`}
                    disabled={session.status === 'stopping'}
                >
                    關閉
                </button>
            </div>

            {/* RV2 Finishing Overlay */}
            {finishOpen && (
                <div className={s.finishScrim}>
                    <div className={s.finishCard}>
                        <div className={s.finishHead}>
                            <div className={s.finishEyebrow}>FINISHING</div>
                            <h2 className={s.finishTitle}>整理這堂課</h2>
                            <div className={s.finishSub}>
                                {fmtElapsed(session.elapsed)} · {session.segments.length} 句字幕
                            </div>
                        </div>
                        <div className={s.finishSteps}>
                            {FINISH_STEPS.map((step, i) => {
                                const state =
                                    i < finishStep
                                        ? 'done'
                                        : i === finishStep
                                          ? 'active'
                                          : 'pending';
                                return (
                                    <div
                                        key={step.key}
                                        className={`${s.stepRow} ${state === 'done' ? s.stepDone : ''} ${state === 'active' ? s.stepActive : ''}`}
                                    >
                                        <div className={s.stepIcon}>
                                            {state === 'done' ? '✓' : i + 1}
                                        </div>
                                        <div>
                                            <div className={s.stepLabel}>{step.label}</div>
                                            <div className={s.stepHint}>{step.hint}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className={s.finishFoot}>
                            <span className={s.finishHint}>
                                {finishedDone
                                    ? '可以回到課程了。'
                                    : '處理中…請稍候。'}
                            </span>
                            <button
                                type="button"
                                onClick={handleFinishDone}
                                disabled={!finishedDone}
                                className={s.finishBtn}
                            >
                                {finishedDone ? '完成 →' : '處理中…'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
