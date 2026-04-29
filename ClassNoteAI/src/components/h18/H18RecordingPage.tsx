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
 *  - RV2FloatingNotes 浮動筆記窗 — 已做 (FloatingNotesPanel)，autosave 進 userNotesStore
 *  - 5-step finishing animation：UI 在，但跑的是 fixed timer (3.6s 模擬)
 *    ，沒對應後端的 transcribe → segment → summary → index 階段事件
 *  - BatteryMonitor / recordingDeviceMonitor：沒接（用戶低電量時不會 auto-stop）
 *  - 鍵盤快捷鍵 ⌘⇧N (floating notes) — 已接 (本次)；Esc 關閉浮動筆記
 *  - drag-drop 教材匯入：沒接
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, BookOpen } from 'lucide-react';
import type { Course, Lecture } from '../../types';
import { storageService } from '../../services/storageService';
import { toastService } from '../../services/toastService';
import { confirmService } from '../../services/confirmService';
import {
    useRecordingSession,
    fmtElapsed,
} from './useRecordingSession';
import { courseColor } from './courseColor';
import FloatingNotesPanel from './FloatingNotesPanel';
import { useAppSettings } from './useAppSettings';
import { addExamMark, getExamMarks } from '../../services/examMarksStore';
import { selectPDFFile } from '../../services/fileService';
import { keymapService } from '../../services/keymapService';
import { SHORTCUTS_CHANGE_EVENT } from '../../services/__contracts__/keymapService.contract';
import s from './H18RecordingPage.module.css';

export interface H18RecordingPageProps {
    courseId: string;
    lectureId: string;
    onBack: () => void;
}

type RecLayout = 'A' | 'B' | 'C';

const FINISH_STEPS = [
    { key: 'transcribe', label: '轉錄收尾', hint: '停止 ASR，flush 字幕尾段' },
    { key: 'segment', label: '寫入錄音檔', hint: '把 .pcm 整理成 .wav 落到磁碟' },
    { key: 'summary', label: '保存課堂', hint: '更新 lecture 狀態為 completed' },
    { key: 'index', label: '建立索引', hint: 'RAG embedding 由背景服務處理' },
    { key: 'done', label: '完成', hint: '可以回到 Review' },
] as const;

type FinishStepKey = (typeof FINISH_STEPS)[number]['key'];

export default function H18RecordingPage({
    courseId,
    lectureId,
    onBack,
}: H18RecordingPageProps) {
    const [lecture, setLecture] = useState<Lecture | null>(null);
    const [course, setCourse] = useState<Course | null>(null);
    const { settings, update: updateSettings } = useAppSettings();
    const persistedLayout = settings?.appearance?.recordingLayout;
    const [layout, setLayoutState] = useState<RecLayout>('A');
    // Sync local state with persisted value once it loads. We mirror to
    // local state so the switcher feels instant; persistence catches up
    // on next render.
    useEffect(() => {
        if (persistedLayout && persistedLayout !== layout) {
            setLayoutState(persistedLayout);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistedLayout]);
    const setLayout = (next: RecLayout) => {
        setLayoutState(next);
        void updateSettings({
            appearance: {
                ...(settings?.appearance || {}),
                recordingLayout: next,
            },
        });
    };
    const [followMode, setFollowMode] = useState(true);
    const [notesOpen, setNotesOpen] = useState(false);

    const session = useRecordingSession({ courseId, lectureId });

    const [finishOpen, setFinishOpen] = useState(false);

    // Map session.stopPhase → step index. While the user is on the
    // overlay we read the real phase from useRecordingSession instead
    // of running a dummy timer. The 'idle' phase (before stop ran) maps
    // to step 0; 'done' maps to the last step.
    const finishStep = useMemo<number>(() => {
        const idx = FINISH_STEPS.findIndex(
            (s) => s.key === (session.stopPhase as FinishStepKey),
        );
        return idx >= 0 ? idx : 0;
    }, [session.stopPhase]);
    const finishedDone = session.stopPhase === 'done';

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

    // v0.7.x: 不再 auto-start。使用者進到這頁可能是「準備錄音」(從首頁
    // 下一堂或 rail [+] 進來) 或「中斷後回來」。一律由使用者明確按
    // transport bar 的 ● 開始錄音 才啟動 session.start()，避免 mic
    // 在使用者沒準備好時就被搶走。

    // S3a-4: floating-notes shortcut now goes through keymapService —
    // user-customisable from PKeyboard, default Mod+Shift+N.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (keymapService.matchesEvent('floatingNotes', e)) {
                e.preventDefault();
                setNotesOpen((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // S3a-3: re-render the 筆記 chip when the user remaps floatingNotes.
    const [, setShortcutsTick] = useState(0);
    useEffect(() => {
        const onChange = () => setShortcutsTick((n) => n + 1);
        window.addEventListener(SHORTCUTS_CHANGE_EVENT, onChange);
        return () =>
            window.removeEventListener(SHORTCUTS_CHANGE_EVENT, onChange);
    }, []);
    const floatingNotesLabel = keymapService.getDisplayLabel('floatingNotes');

    const handleStop = async () => {
        // S3h: 結束 = 不可逆 (停止 mic + finalize pipeline)，先過 themed
        // confirm gate。Cancel → 留在錄音中，session 不動。
        const ok = await confirmService.ask({
            title: '結束錄音？',
            message:
                '字幕跟摘要會自動生成。可在背景繼續，可隨時去其他頁面。',
            confirmLabel: '結束',
            cancelLabel: '繼續錄音',
            variant: 'default',
        });
        if (!ok) return;

        setFinishOpen(true);
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

    const handleAddMark = () => {
        addExamMark(lectureId, {
            elapsedSec: session.elapsed,
            text: session.currentText || '',
            markedAtMs: Date.now(),
        });
        const total = getExamMarks(lectureId).length;
        toastService.info(
            '已標記考點',
            `${fmtElapsed(session.elapsed)} · 共 ${total} 個標記（review 頁面會看到）`,
        );
    };

    const handleImport = async () => {
        if (!lecture) return;
        try {
            const picked = await selectPDFFile();
            if (!picked) return;
            // Persist binary: use Tauri raw command (storageService doesn't
            // own slide files). For now, just attach pdf_path on the lecture
            // — the actual byte payload is already on disk at picked.path.
            await storageService.saveLecture({
                ...lecture,
                pdf_path: picked.path,
                updated_at: new Date().toISOString(),
            });
            toastService.success(
                '教材已綁定',
                `${picked.path.split(/[\\/]/).pop()} · 之後 review 頁可開啟`,
            );
        } catch (err) {
            console.warn('[H18RecordingPage] import failed:', err);
            toastService.error('匯入失敗', (err as Error)?.message || '未知錯誤');
        }
    };

    const isRunning = session.status === 'recording' || session.status === 'paused';
    const isPaused = session.status === 'paused';
    const accent = courseColor(courseId);

    return (
        <div className={s.page}>
            {/* Hero — breadcrumb + layout switcher + 筆記 + 匯入 (per prototype) */}
            <div className={s.hero}>
                <div className={s.crumb}>
                    <button
                        type="button"
                        onClick={onBack}
                        className={s.crumbBack}
                        title={course?.title ? `返回 ${course.title}` : '返回課程'}
                    >
                        ← {course?.title || '返回課程'}
                    </button>
                    {course && <span className={s.crumbDivider}>/</span>}
                    <span className={s.crumbLecture}>
                        {lecture?.title || '錄音中…'}
                    </span>
                    {isPaused && (
                        <span className={s.pauseTag} aria-label="已暫停">
                            PAUSED
                        </span>
                    )}
                </div>

                {/* Layout switcher — only A wired (B/C 留白) */}
                <div className={s.layoutSwitcher}>
                    {(
                        [
                            { k: 'A' as RecLayout, label: '雙欄' },
                            { k: 'B' as RecLayout, label: '字幕專注' },
                            { k: 'C' as RecLayout, label: '影片' },
                        ] as const
                    ).map((o) => (
                        <button
                            key={o.k}
                            type="button"
                            onClick={() => setLayout(o.k)}
                            className={`${s.layoutBtn} ${layout === o.k ? s.layoutBtnActive : ''}`}
                            title={
                                o.k === 'A'
                                    ? '雙欄：投影片 + 字幕並列'
                                    : o.k === 'B'
                                      ? '字幕專注：字幕滿版 + 右側投影片 thumb'
                                      : '影片：影片預覽 + 字幕邊欄 + 時間軸'
                            }
                        >
                            {o.label}
                        </button>
                    ))}
                </div>

                {/* 筆記 toggle — 浮動 markdown 筆記窗 (floatingNotes) */}
                <button
                    type="button"
                    onClick={() => setNotesOpen((v) => !v)}
                    className={`${s.heroBtn} ${notesOpen ? s.heroBtnActive : ''}`}
                    title={`筆記 ${floatingNotesLabel}`}
                >
                    ✎ 筆記
                    <span className={s.heroBtnKbd}>{floatingNotesLabel}</span>
                </button>

                {/* 匯入教材 button */}
                <button
                    type="button"
                    onClick={handleImport}
                    className={s.heroBtnDashed}
                    title="匯入教材"
                >
                    ⤓ 匯入教材
                </button>
            </div>

            {/* Body — render variant per layout */}
            {layout === 'A' && (
                <div className={s.body}>
                    {/* Slide strip (留白) */}
                    <div className={s.slideStrip}>
                        <div className={s.slideStripEmpty}>
                            投影片<br />匯入<br />留白
                        </div>
                    </div>
                    {/* Main slide */}
                    <div className={s.slideMain}>
                        <SlideEmpty />
                    </div>
                    {/* Subtitle stream */}
                    <SubPane session={session} />
                </div>
            )}

            {layout === 'B' && (
                <div className={s.bodyB}>
                    {/* Subtitle full width with focus styling */}
                    <SubPane session={session} focus />
                    {/* Slide strip thumbs vertical right */}
                    <div className={s.slideStripWide}>
                        <div className={s.subHead}>
                            <BookOpen size={12} />
                            <span className={s.subHeadEyebrow}>教材</span>
                            <span className={s.subHeadCount}>0</span>
                        </div>
                        <div className={s.slideStripWideEmpty}>
                            尚未匯入投影片<br />⤓ 匯入教材
                        </div>
                    </div>
                </div>
            )}

            {layout === 'C' && (
                <div className={s.bodyC}>
                    <div className={s.bodyCTop}>
                        {/* Black video panel with REC tag */}
                        <div className={s.videoPanel}>
                            <div className={s.videoRecTag}>
                                <span className={s.videoRecDot} />
                                {session.status === 'recording' ? '● REC · LIVE' : 'PAUSED'}
                                <span className={s.videoElapsed}>
                                    · {fmtElapsed(session.elapsed)}
                                </span>
                            </div>
                            <div className={s.videoEmpty}>
                                <div className={s.videoEmptyIcon}>▶</div>
                                <div className={s.videoEmptyMeta}>
                                    1920 × 1080 · 30fps
                                    <br />
                                    <span style={{ opacity: 0.6 }}>影片預覽待匯入</span>
                                </div>
                            </div>
                            {session.currentText && (
                                <div className={s.videoSubOverlay}>
                                    {session.currentText}
                                </div>
                            )}
                        </div>
                        {/* Subs sidebar */}
                        <SubPane session={session} mini />
                    </div>
                    {/* Timeline scrubber */}
                    <div className={s.timeline}>
                        <div className={s.timelineHead}>
                            時間軸 · {fmtElapsed(session.elapsed)} /{' '}
                            {fmtElapsed(Math.max(session.elapsed + 60, 600))}
                        </div>
                        <div className={s.timelineTrack}>
                            <div
                                className={s.timelineFill}
                                style={{ width: `${Math.min(100, (session.elapsed / 600) * 100)}%` }}
                            />
                            {session.segments.slice(0, 30).map((seg, i) => (
                                <div
                                    key={seg.id}
                                    className={s.timelineMarker}
                                    style={{
                                        left: `${Math.min(100, (i / 30) * 100)}%`,
                                    }}
                                />
                            ))}
                            <div
                                className={s.timelinePlayhead}
                                style={{ left: `${Math.min(100, (session.elapsed / 600) * 100)}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Transport bar — per prototype RV2Transport */}
            <div className={s.transport}>
                {/* Recording dot + elapsed (replaces the big mic circle) */}
                <div className={s.recIndicator}>
                    <span
                        className={`${s.recDot} ${session.status === 'recording' ? s.recDotLive : ''}`}
                    />
                    <span className={s.recTime}>{fmtElapsed(session.elapsed)}</span>
                </div>

                {/* idle 狀態 = 明確紅色 ● 開始錄音；其他狀態走 pause/resume/finished */}
                <button
                    type="button"
                    onClick={
                        isRunning
                            ? handlePauseResume
                            : () => void session.start()
                    }
                    disabled={session.status === 'stopping'}
                    className={`${s.transportBtn} ${session.status === 'idle' ? s.transportBtnRedFill : ''} ${isPaused ? s.transportBtnRedFill : ''} ${session.status === 'recording' ? s.transportBtnInvert : ''}`}
                >
                    {session.status === 'idle' && '● 開始錄音'}
                    {session.status === 'recording' && '暫停'}
                    {isPaused && '繼續錄'}
                    {session.status === 'stopping' && '處理中'}
                    {session.status === 'stopped' && '已結束'}
                </button>

                {/* 跟隨模式 toggle */}
                <button
                    type="button"
                    onClick={() => setFollowMode((v) => !v)}
                    className={`${s.transportBtn} ${followMode ? s.transportBtnFollow : ''}`}
                    title="自動同步投影片 / 字幕"
                    style={
                        followMode
                            ? ({ '--accent': accent } as React.CSSProperties)
                            : undefined
                    }
                >
                    <span
                        className={s.followDot}
                        style={{ background: followMode ? accent : 'var(--h18-text-faint)' }}
                    />
                    跟隨模式
                </button>

                {/* ⚑ 標記考點 */}
                <button
                    type="button"
                    onClick={handleAddMark}
                    disabled={!isRunning}
                    className={s.transportBtn}
                    title="把目前句子標為考點"
                >
                    ⚑ 標記考點
                </button>

                <div className={s.transportSpacer} />

                {/* S1.4 — singleton stopPhase progress hint (inline). The
                 *  5-step finish overlay below renders the same data as a
                 *  modal; this inline hint catches the case where stopPhase
                 *  surfaces while the modal is closed (e.g. retry-from-failed
                 *  shown on next mount). Sprint 2 真實 6-step pipeline 完成後
                 *  才會看到 transcribe → segment → index 全程；目前最常見的
                 *  自然觀察是 transcribe → done 跟 failed。 */}
                {session.stopPhase === 'transcribe' && (
                    <span className={s.transportStatus}>正在收尾字幕…</span>
                )}
                {session.stopPhase === 'segment' && (
                    <span className={s.transportStatus}>正在儲存錄音…</span>
                )}
                {session.stopPhase === 'index' && (
                    <span className={s.transportStatus}>建立字幕索引…</span>
                )}
                {session.stopPhase === 'summary' && (
                    <span className={s.transportStatus}>
                        生成摘要中（可離開）…
                    </span>
                )}
                {session.stopPhase === 'failed' && (
                    <span
                        className={s.transportError}
                        style={{ color: 'var(--h18-hot)' }}
                    >
                        儲存失敗 · 已嘗試保留現有字幕
                    </span>
                )}

                {session.error && session.stopPhase !== 'failed' && (
                    <span className={s.transportError} title={session.error}>
                        ⚠ {session.error}
                    </span>
                )}

                {/* 結束 · 儲存 — red bg, primary action right */}
                <button
                    type="button"
                    onClick={handleStop}
                    disabled={!isRunning && session.status !== 'stopping'}
                    className={s.transportBtnFinish}
                    title="停止錄音並儲存"
                >
                    結束 · 儲存
                </button>
            </div>

            {/* Floating notes window (⌘⇧N) — autosaves to userNotesStore */}
            {notesOpen && (
                <FloatingNotesPanel
                    lectureId={lectureId}
                    lectureTitle={lecture?.title}
                    onClose={() => setNotesOpen(false)}
                />
            )}

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
                                // When the whole pipeline is finished
                                // (stopPhase === 'done'), every step gets
                                // the ✓ — including the last one ('完成')
                                // itself. Otherwise the last row stays
                                // stuck on the spinner / number icon even
                                // after everything's done.
                                const state = finishedDone
                                    ? 'done'
                                    : i < finishStep
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

/* ────────── Helper components for layout variants ────────── */

function SlideEmpty() {
    return (
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
    );
}

interface SubPaneProps {
    session: ReturnType<typeof useRecordingSession>;
    focus?: boolean;
    mini?: boolean;
}

function SubPane({ session, focus, mini }: SubPaneProps) {
    // Auto-scroll behaviour:
    //  - 預設貼底，新字幕進來自動跟著捲。
    //  - 使用者主動往上滾離底部 → 暫停 auto-scroll（可慢慢翻舊字幕）。
    //  - 滾回底部（< 24px 視為「貼底」）→ 恢復 auto-scroll。
    // 監聽的依賴：segments.length（新句 commit）、currentText（streaming
    // 過程的尚未 commit 字也算）。
    const streamRef = useRef<HTMLDivElement | null>(null);
    const stickToBottomRef = useRef(true);
    const STICK_THRESHOLD_PX = 24;

    const handleScroll = (): void => {
        const el = streamRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickToBottomRef.current = distFromBottom <= STICK_THRESHOLD_PX;
    };

    useEffect(() => {
        const el = streamRef.current;
        if (!el) return;
        if (!stickToBottomRef.current) return;
        // 用 requestAnimationFrame 等 layout flush 完才量 scrollHeight。
        const id = requestAnimationFrame(() => {
            const node = streamRef.current;
            if (!node) return;
            node.scrollTop = node.scrollHeight;
        });
        return () => cancelAnimationFrame(id);
    }, [session.segments.length, session.currentText]);

    return (
        <div className={`${s.subPane} ${focus ? s.subPaneFocus : ''} ${mini ? s.subPaneMini : ''}`}>
            <div className={s.subHead}>
                <FileText size={12} />
                <span className={s.subHeadEyebrow}>
                    {focus ? '字幕專注' : mini ? '字幕' : '雙語字幕'}
                </span>
                <span className={s.subHeadCount}>{session.segments.length} 句</span>
            </div>
            <div
                ref={streamRef}
                className={s.subStream}
                onScroll={handleScroll}
            >
                {session.segments.length === 0 && !session.currentText && (
                    <div className={s.subEmpty}>
                        字幕將顯示在這裡。
                        <br />
                        開始錄音後 Parakeet 會即時轉錄。
                    </div>
                )}
                {session.segments.map((seg) => {
                    // seg.startTime 是 epoch ms（subtitleService 直接收的）
                    // — 必須減 sessionStartMs 才會得到真正的 elapsed。
                    // 沒減的話顯示成 493706:38:19（≈ 56 年 = epoch 至今）。
                    const baseMs = session.sessionStartMs || 0;
                    const elapsedSec = baseMs > 0
                        ? Math.max(0, Math.floor((seg.startTime - baseMs) / 1000))
                        : 0;
                    return (
                        <div key={seg.id} className={s.subRow}>
                            <div className={s.subTime}>
                                {fmtElapsed(elapsedSec) || '—'}
                            </div>
                            <div className={s.subEn}>{seg.displayText || seg.text}</div>
                            {seg.displayTranslation && !mini && (
                                <div className={s.subZh}>{seg.displayTranslation}</div>
                            )}
                        </div>
                    );
                })}
                {session.currentText && (
                    <div className={s.subCurrent}>
                        <div className={s.subCurrentEyebrow}>● 即時轉錄</div>
                        <div className={s.subCurrentText}>{session.currentText}</div>
                    </div>
                )}
            </div>
        </div>
    );
}
