/**
 * H18ReviewPage · v0.7.0 Phase 6.4
 *
 * 對應 docs/design/h18-deep/h18-review-page.jsx L436-895 (ReviewPage).
 * 取代 NotesView 的 review mode。Layout：
 *   ┌──────────────────────────── Hero ────────────────────────────┐
 *   │ TOC (220px)  │  Transcript (1fr)  │  Tabs (420px)            │
 *   └──────────────────── H18AudioPlayer (52px) ────────────────────┘
 *
 * 接到既有 backend：
 *  - lecture       → storageService.getLecture(id)
 *  - subtitles     → storageService.getSubtitles(id)
 *  - notes         → storageService.getNote(id)  (Note shape with sections + summary)
 *  - audio src     → resolveOrRecoverAudioPath → convertFileSrc
 *
 * 留白：
 *  - bilink concept hover (RVBilink) — concept extraction 沒做
 *  - "考點" tag — 沒 exam 欄位 (subtitle 也沒這 flag)
 *  - 概念圖 list — 同上
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { storageService } from '../../services/storageService';
import { resolveOrRecoverAudioPath } from '../../services/audioPathService';
import type { Course, Lecture, Note, Subtitle, Section } from '../../types';
import { courseColor } from './courseColor';
import H18AudioPlayer from './H18AudioPlayer';
import H18RecordingPage from './H18RecordingPage';
import { RecoveryHintBanner } from './RecoveryHintBanner';
import { useRecordingSession, fmtElapsed } from './useRecordingSession';
import {
    loadUserNotes,
    saveUserNotes,
    subscribeUserNotes,
} from './userNotesStore';
import {
    getExamMarks,
    subscribeExamMarks,
    type ExamMark,
} from '../../services/examMarksStore';
import {
    taskTrackerService,
    type TaskTrackerEntry,
} from '../../services/taskTrackerService';
import { recordingSessionService } from '../../services/recordingSessionService';
import s from './H18ReviewPage.module.css';

export interface H18ReviewPageProps {
    courseId: string;
    lectureId: string;
    onBack: () => void;
}

type Lang = 'zh' | 'en' | 'both';
type Group = 'para' | 'sent';
type Tab = 'notes' | 'summary' | 'qa';

function fmtTime(sec: number): string {
    if (!isFinite(sec) || sec < 0) return '00:00';
    const m = Math.floor(sec / 60);
    const s2 = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}`;
}

function fmtSavedTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function shortDate(iso?: string): string {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

interface Para {
    section: Section | null;
    sectionIndex: number;
    items: Subtitle[];
}

function groupSubsBySections(subs: Subtitle[], sections: Section[]): Para[] {
    const sortedSubs = [...subs].sort((a, b) => a.timestamp - b.timestamp);
    if (sections.length === 0) {
        return sortedSubs.length > 0
            ? [{ section: null, sectionIndex: -1, items: sortedSubs }]
            : [];
    }
    const sortedSections = [...sections].sort((a, b) => a.timestamp - b.timestamp);
    const groups: Para[] = sortedSections.map((sec, i) => ({
        section: sec,
        sectionIndex: i,
        items: [],
    }));
    // pre-section bucket for any subs before the first section's timestamp
    const preSection: Para = { section: null, sectionIndex: -1, items: [] };
    for (const sub of sortedSubs) {
        let placed = false;
        for (let i = sortedSections.length - 1; i >= 0; i--) {
            if (sub.timestamp >= sortedSections[i].timestamp) {
                groups[i].items.push(sub);
                placed = true;
                break;
            }
        }
        if (!placed) preSection.items.push(sub);
    }
    return preSection.items.length > 0
        ? [preSection, ...groups.filter((g) => g.items.length > 0)]
        : groups.filter((g) => g.items.length > 0);
}

export default function H18ReviewPage({
    courseId,
    lectureId,
    onBack,
}: H18ReviewPageProps) {
    const [lecture, setLecture] = useState<Lecture | null>(null);
    const [course, setCourse] = useState<Course | null>(null);
    const [subs, setSubs] = useState<Subtitle[]>([]);
    const [note, setNote] = useState<Note | null>(null);
    const [loading, setLoading] = useState(true);

    const [lang, setLang] = useState<Lang>('zh');
    const [grouping, setGrouping] = useState<Group>('para');
    const [tab, setTab] = useState<Tab>('notes');
    const [editingNotes, setEditingNotes] = useState(false);
    const [notesDraft, setNotesDraft] = useState(() => loadUserNotes(lectureId));
    const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
    const [notesDirty, setNotesDirty] = useState(false);
    const notesSaveTimerRef = useRef<number | null>(null);

    const [examMarks, setExamMarks] = useState<ExamMark[]>(() =>
        getExamMarks(lectureId),
    );
    const [summarizeError, setSummarizeError] = useState<string | null>(null);

    // Phase 7 Sprint 2 (S2.4) — subscribe to taskTracker for the
    // streaming summary task that may have been kicked off by the stop
    // pipeline (or by a prior retry click). We track the most recent
    // summarize-task entry for *this* lectureId so the summary tab can
    // show progress / error / retry inline. `null` = no recent task.
    const [summaryTask, setSummaryTask] = useState<TaskTrackerEntry | null>(
        null,
    );

    useEffect(() => {
        setExamMarks(getExamMarks(lectureId));
        const off = subscribeExamMarks(lectureId, (next) =>
            setExamMarks(next),
        );
        return off;
    }, [lectureId]);

    // Subscribe to taskTracker — pick the most-recent summarize task for
    // this lecture (running OR failed). When it transitions to `done`,
    // refetch the note so the new summary text re-renders.
    useEffect(() => {
        const off = taskTrackerService.subscribe((tasks) => {
            // pick the most recent (largest startedAt) summarize task for
            // this lecture, regardless of status — UI needs to see
            // running / failed / done.
            let pick: TaskTrackerEntry | null = null;
            for (const t of tasks) {
                if (t.kind !== 'summarize') continue;
                if (t.lectureId !== lectureId) continue;
                if (!pick || t.startedAt > pick.startedAt) pick = t;
            }
            setSummaryTask((prev) => {
                // On done transition, refetch note so summary tab re-renders.
                if (
                    prev &&
                    prev.status !== 'done' &&
                    pick &&
                    pick.status === 'done' &&
                    pick.id === prev.id
                ) {
                    storageService
                        .getNote(lectureId)
                        .then((n) => setNote(n))
                        .catch(() => {
                            /* swallow — keep previous note */
                        });
                }
                return pick;
            });
        });
        return off;
    }, [lectureId]);

    const [audioOpen, setAudioOpen] = useState(false);
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [audioErr, setAudioErr] = useState<string | null>(null);
    const [currentSec, setCurrentSec] = useState(0);
    const [seekTo, setSeekTo] = useState<number | null>(null);
    const [autoFollow, setAutoFollow] = useState(true);
    const [activeSubId, setActiveSubId] = useState<string | null>(null);

    // Phase 7 S1.5 — thin reader of the recording singleton. Lets us
    // overlay an "active recording" badge / "saving…" hint when the
    // singleton's lectureId matches the lecture currently displayed.
    const { state: recState } = useRecordingSession();

    const transcriptRef = useRef<HTMLDivElement | null>(null);

    /* ────────── 3-column resizable splitters ───────── */
    const TOC_MIN = 160;
    const TOC_MAX = 380;
    const RIGHT_MIN = 320;
    const RIGHT_MAX = 560;
    const PANEL_W_KEY = 'classnote-h18-review-panels';

    const [tocWidth, setTocWidth] = useState<number>(220);
    const [rightWidth, setRightWidth] = useState<number>(420);
    const [dragSide, setDragSide] = useState<'toc' | 'right' | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);

    // Load persisted widths
    useEffect(() => {
        try {
            const raw = localStorage.getItem(PANEL_W_KEY);
            if (!raw) return;
            const p = JSON.parse(raw) as { toc?: number; right?: number };
            if (typeof p.toc === 'number') {
                setTocWidth(Math.min(TOC_MAX, Math.max(TOC_MIN, p.toc)));
            }
            if (typeof p.right === 'number') {
                setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, p.right)));
            }
        } catch {
            /* swallow */
        }
    }, []);

    // Persist widths
    useEffect(() => {
        try {
            localStorage.setItem(
                PANEL_W_KEY,
                JSON.stringify({ toc: tocWidth, right: rightWidth }),
            );
        } catch {
            /* swallow */
        }
    }, [tocWidth, rightWidth]);

    const startSplitterDrag = (
        side: 'toc' | 'right',
        e: React.PointerEvent<HTMLDivElement>,
    ) => {
        if (e.button !== 0) return;
        setDragSide(side);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
    };

    const onSplitterMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragSide || !bodyRef.current) return;
        const rect = bodyRef.current.getBoundingClientRect();
        if (dragSide === 'toc') {
            const next = e.clientX - rect.left;
            setTocWidth(Math.min(TOC_MAX, Math.max(TOC_MIN, next)));
        } else {
            const next = rect.right - e.clientX;
            setRightWidth(Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, next)));
        }
    };

    const endSplitterDrag = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragSide) {
            setDragSide(null);
            try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch {
                /* swallow */
            }
        }
    };

    // Load lecture, course, subs, notes
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            storageService.getLecture(lectureId),
            storageService.getCourse(courseId).catch(() => null),
            storageService.getSubtitles(lectureId).catch(() => []),
            storageService.getNote(lectureId).catch(() => null),
        ])
            .then(([lec, c, ss, n]) => {
                if (cancelled) return;
                setLecture(lec);
                setCourse(c);
                setSubs(ss);
                setNote(n);
            })
            .catch((err) => console.warn('[H18ReviewPage] load failed:', err))
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [lectureId, courseId]);

    // Resolve audio source on lecture change
    useEffect(() => {
        let cancelled = false;
        if (!lecture) {
            setAudioSrc(null);
            return;
        }
        // video takes precedence as a playable source
        if (lecture.video_path) {
            try {
                setAudioSrc(convertFileSrc(lecture.video_path));
                setAudioErr(null);
            } catch (err) {
                console.warn('[H18ReviewPage] convertFileSrc(video) failed:', err);
                setAudioErr('影片路徑解析失敗');
            }
            return;
        }
        if (!lecture.audio_path) {
            setAudioSrc(null);
            setAudioErr(null);
            return;
        }
        resolveOrRecoverAudioPath(lecture.id, lecture.audio_path)
            .then((rec) => {
                if (cancelled) return;
                if (rec.resolvedPath) {
                    setAudioSrc(convertFileSrc(rec.resolvedPath));
                    setAudioErr(null);
                } else {
                    setAudioSrc(null);
                    setAudioErr('音訊檔不存在或路徑遺失');
                }
            })
            .catch((err) => {
                console.warn('[H18ReviewPage] resolveOrRecoverAudioPath failed:', err);
                if (!cancelled) {
                    setAudioSrc(null);
                    setAudioErr('音訊載入失敗');
                }
            });
        return () => {
            cancelled = true;
        };
    }, [lecture]);

    // Load user notes (free-form) for this lecture + sync with floating
    // notes window edits made on the recording page.
    useEffect(() => {
        const cur = loadUserNotes(lectureId);
        setNotesDraft(cur);
        setNotesSavedAt(cur.length > 0 ? Date.now() : null);
        setNotesDirty(false);
        const off = subscribeUserNotes(lectureId, () => {
            const next = loadUserNotes(lectureId);
            setNotesDraft((d) => (d === next ? d : next));
        });
        return () => {
            off();
            // best-effort flush of any pending save when navigating away
            if (notesSaveTimerRef.current) {
                window.clearTimeout(notesSaveTimerRef.current);
                notesSaveTimerRef.current = null;
            }
        };
    }, [lectureId]);

    const handleNotesChange = (next: string) => {
        setNotesDraft(next);
        setNotesDirty(true);
        if (notesSaveTimerRef.current) {
            window.clearTimeout(notesSaveTimerRef.current);
        }
        notesSaveTimerRef.current = window.setTimeout(() => {
            saveUserNotes(lectureId, next);
            setNotesSavedAt(Date.now());
            setNotesDirty(false);
        }, 500);
    };

    const flushNotesSave = () => {
        if (notesSaveTimerRef.current) {
            window.clearTimeout(notesSaveTimerRef.current);
            notesSaveTimerRef.current = null;
        }
        if (notesDirty) {
            saveUserNotes(lectureId, notesDraft);
            setNotesSavedAt(Date.now());
            setNotesDirty(false);
        }
    };

    // Phase 7 Sprint 2 (S2.7) — cancel-on-regen. Click 「✦ 重新生成」 →
    // cancel any active summarize task for this lecture (running or
    // queued), then start a new tracked task and run summarize inline so
    // the user gets streaming progress in the same tab.
    const handleRegenerateSummary = () => {
        if (subs.length === 0) return;
        setSummarizeError(null);
        // 1. cancel existing summarize tasks (running OR failed) for this
        //    lecture so we don't leave stale rows in the tasks tray.
        taskTrackerService.getActive().forEach((t) => {
            if (t.kind === 'summarize' && t.lectureId === lectureId) {
                taskTrackerService.cancel(t.id);
            }
        });
        // 2. start a new tracked task and inline-run summarize.
        const newTaskId = taskTrackerService.start({
            kind: 'summarize',
            label: '重新生成摘要',
            lectureId,
        });
        void runSummary(newTaskId, lectureId, lecture?.title);
    };

    // Phase 7 Sprint 2 (S2.6) — retry button on failed task.
    // Cancels the existing failed task (so the tasks tray drops it) and
    // starts a fresh summarize task using the same inline runner.
    const handleRetrySummary = () => {
        if (!summaryTask) return;
        setSummarizeError(null);
        taskTrackerService.cancel(summaryTask.id);
        const newTaskId = taskTrackerService.start({
            kind: 'summarize',
            label: '重試摘要',
            lectureId,
        });
        void runSummary(newTaskId, lectureId, lecture?.title);
    };

    // Phase 7 Sprint 2 (S2.10) — retry the stop-pipeline finalize when a
    // lecture is in `failed` status (audio + subtitles best-effort
    // preserved but summary / index didn't finish). Falls back to a
    // mustFinalizeSync drain.
    const handleRetryFinalize = () => {
        // Best-effort: kick off a fresh summarize task; the singleton's
        // mustFinalizeSync handles the lower-level pipeline retry.
        void recordingSessionService.mustFinalizeSync().catch((err) => {
            console.warn(
                '[H18ReviewPage] mustFinalizeSync retry failed:',
                err,
            );
        });
        // Also kick a fresh summarize task — that's the most user-visible
        // missing piece.
        if (subs.length > 0) {
            const newTaskId = taskTrackerService.start({
                kind: 'summarize',
                label: '重試摘要',
                lectureId,
            });
            void runSummary(newTaskId, lectureId, lecture?.title);
        }
    };

    const handleSeedFromAi = () => {
        if (!note) return;
        const md = renderNoteAsMarkdown(note);
        setNotesDraft(md);
        setNotesDirty(true);
        // also kick the debounced save so it lands within 500ms
        if (notesSaveTimerRef.current) window.clearTimeout(notesSaveTimerRef.current);
        notesSaveTimerRef.current = window.setTimeout(() => {
            saveUserNotes(lectureId, md);
            setNotesSavedAt(Date.now());
            setNotesDirty(false);
        }, 500);
    };

    const paragraphs = useMemo(
        () => groupSubsBySections(subs, note?.sections || []),
        [subs, note?.sections],
    );

    // Track which subtitle is active during playback (smallest timestamp <= currentSec)
    useEffect(() => {
        if (subs.length === 0) {
            setActiveSubId(null);
            return;
        }
        const sorted = [...subs].sort((a, b) => a.timestamp - b.timestamp);
        let current: Subtitle | null = null;
        for (const sub of sorted) {
            if (sub.timestamp <= currentSec) current = sub;
            else break;
        }
        setActiveSubId(current?.id ?? null);
    }, [currentSec, subs]);

    // Auto-follow: scroll active subtitle into view
    useEffect(() => {
        if (!autoFollow || !activeSubId || !transcriptRef.current) return;
        const el = transcriptRef.current.querySelector<HTMLElement>(
            `[data-sub-id="${activeSubId}"]`,
        );
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeSubId, autoFollow]);

    if (loading) {
        return (
            <div className={s.page}>
                <div className={s.notFound}>載入中…</div>
            </div>
        );
    }
    if (!lecture) {
        return (
            <div className={s.page}>
                <div className={s.notFound}>
                    找不到這堂課（可能被刪除）。
                    <br />
                    <button onClick={onBack} className={s.crumbBack} style={{ marginTop: 12 }}>
                        ← 返回
                    </button>
                </div>
            </div>
        );
    }

    // P6.5: status='recording' 的 lecture 走 H18RecordingPage chrome wrap
    if (lecture.status === 'recording') {
        return (
            <H18RecordingPage
                courseId={courseId}
                lectureId={lectureId}
                onBack={onBack}
            />
        );
    }

    const courseAccent = courseColor(courseId);
    const sectionsForToc = note?.sections || [];

    const examCount = (note?.qa_records?.length ?? 0) + examMarks.length;

    const startSeek = (sec: number) => {
        setSeekTo(sec);
        // open audio bar if user wants to hear it
        if (audioSrc && !audioOpen) setAudioOpen(true);
    };

    // Phase 7 S1.5 — recording-singleton overlays for this lecture.
    const recMatchesLecture = recState.lectureId === lecture.id;
    const showActiveRecBadge =
        recMatchesLecture &&
        (recState.status === 'recording' || recState.status === 'paused');
    const showStopProgressHint =
        (recMatchesLecture && recState.status === 'stopping') ||
        lecture.status === 'stopping';

    // Phase 7 S2.4 — derived from the live summarize task entry.
    const summaryTaskRunning =
        summaryTask?.status === 'running' || summaryTask?.status === 'queued';
    const summaryProgressPct = Math.max(
        0,
        Math.min(100, Math.round((summaryTask?.progress ?? 0) * 100)),
    );

    // Phase 7 S2.10 — show the failed-finalize banner when the lecture
    // row itself was persisted with `status='failed'` (stop pipeline
    // crashed mid-way). Independent of the recording singleton's state.
    const showFailedBanner = lecture.status === 'failed';

    return (
        <div className={s.page}>
            {/* Phase 7 S1.5 · Goal B — RecoveryHintBanner self-gates on
                localStorage `_recovery:<lectureId>`; when no flag is
                present it renders nothing. */}
            <RecoveryHintBanner lectureId={lecture.id} />
            <div className={s.hero}>
                {showActiveRecBadge && (
                    <div
                        role="status"
                        aria-live="polite"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 12px',
                            marginBottom: 10,
                            borderRadius: 6,
                            border: '1px solid var(--h18-hot, #d23)',
                            background: 'var(--h18-hot-bg, rgba(221,51,51,0.08))',
                            color: 'var(--h18-hot, #d23)',
                            fontSize: 11,
                            fontFamily: 'var(--h18-font-mono)',
                            letterSpacing: '0.06em',
                            fontWeight: 700,
                        }}
                    >
                        <span aria-hidden style={{ fontSize: 9 }}>●</span>
                        {recState.status === 'paused' ? '錄音已暫停' : '錄音中'}
                        {' · '}
                        {fmtElapsed(recState.elapsed)}
                        <span style={{ flex: 1 }} />
                        <span style={{ opacity: 0.8 }}>切到錄音頁繼續 ↗</span>
                    </div>
                )}
                {showStopProgressHint && (
                    <div
                        role="status"
                        aria-live="polite"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 12px',
                            marginBottom: 10,
                            borderRadius: 6,
                            border: '1px dashed var(--h18-border)',
                            background: 'var(--h18-surface-alt, var(--h18-surface))',
                            color: 'var(--h18-text-mid)',
                            fontSize: 11,
                            fontFamily: 'var(--h18-font-mono)',
                            letterSpacing: '0.06em',
                        }}
                    >
                        <span aria-hidden>⟳</span>
                        正在儲存課堂…
                        {recState.stopPhase ? ` · ${recState.stopPhase}` : ''}
                    </div>
                )}
                {/* Phase 7 S2.10 — lecture.status='failed' banner.
                    Stop pipeline crashed; audio + subtitles best-effort
                    preserved but summary / index may need a manual retry. */}
                {showFailedBanner && (
                    <div
                        role="alert"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: 'var(--h18-space-3) var(--h18-space-5)',
                            marginBottom: 'var(--h18-space-5, 12px)',
                            borderRadius: 'var(--h18-radius-md, 6px)',
                            background: 'var(--h18-hot-bg)',
                            borderLeft: '3px solid var(--h18-hot)',
                            color: 'var(--h18-hot)',
                            fontSize: 12,
                        }}
                    >
                        <span style={{ flex: 1 }}>
                            ⚠ 此堂課儲存時發生錯誤。錄音已盡力保留，部分摘要 /
                            索引可能需手動重試。
                        </span>
                        <button
                            type="button"
                            onClick={handleRetryFinalize}
                            className={s.editBtn}
                        >
                            重試
                        </button>
                    </div>
                )}
                <div className={s.heroTopRow}>
                    <div className={s.crumb}>
                        <button
                            onClick={onBack}
                            className={s.crumbBack}
                            title={course?.title ? `返回 ${course.title}` : '返回課程'}
                        >
                            ← {course?.title || '返回課程'}
                        </button>
                        <span className={s.crumbDivider}>/</span>
                        <span className={s.crumbCourse}>{lecture.title}</span>
                    </div>
                    <span className={s.crumbExtra}>
                        {[
                            shortDate(lecture.date),
                            lecture.duration > 0
                                ? `${Math.round(lecture.duration / 60)} 分鐘`
                                : null,
                            subs.length > 0 ? `${subs.length} 句字幕` : null,
                            note?.summary ? '已摘要' : null,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                    <button
                        type="button"
                        onClick={() => setAudioOpen((o) => !o)}
                        disabled={!audioSrc}
                        title={
                            audioErr ||
                            (audioSrc ? (audioOpen ? '關閉播放器' : '展開播放器') : '無音訊檔')
                        }
                        className={`${s.audioToggle} ${audioOpen ? s.audioToggleActive : ''}`}
                    >
                        {audioOpen
                            ? `▶ 回放中 · ${fmtTime(currentSec)}`
                            : audioSrc
                              ? '▶ 回放錄音'
                              : '✗ 無音訊'}
                    </button>
                </div>
                <h1 className={s.heroTitle}>{lecture.title}</h1>
                <div className={s.heroMeta}>
                    {[
                        lecture.keywords ? `關鍵字：${lecture.keywords}` : null,
                        lecture.audio_path ? '🎙 音訊' : null,
                        lecture.video_path ? '🎬 影片' : null,
                        lecture.pdf_path ? '📄 PDF' : null,
                    ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                </div>
            </div>

            <div
                ref={bodyRef}
                className={s.body}
                style={
                    {
                        '--toc-w': `${tocWidth}px`,
                        '--right-w': `${rightWidth}px`,
                        cursor: dragSide ? 'col-resize' : undefined,
                    } as React.CSSProperties
                }
            >
                {/* TOC */}
                <div className={s.toc}>
                    <div className={s.tocHead}>章節 · {sectionsForToc.length}</div>
                    {sectionsForToc.length === 0 ? (
                        <div className={s.tocEmpty}>
                            尚未生成章節 — 等 AI 摘要跑完會自動切章節。
                        </div>
                    ) : (
                        sectionsForToc.map((sec, i) => {
                            const isActive =
                                paragraphs.find(
                                    (p) =>
                                        p.section?.timestamp === sec.timestamp &&
                                        p.items.some((it) => it.id === activeSubId),
                                ) != null;
                            return (
                                <button
                                    key={`${sec.timestamp}-${i}`}
                                    type="button"
                                    onClick={() => startSeek(sec.timestamp)}
                                    className={`${s.tocRow} ${isActive ? s.tocRowActive : ''}`}
                                    title={sec.title}
                                >
                                    <div className={s.tocTime}>{fmtTime(sec.timestamp)}</div>
                                    <div className={s.tocTitle}>{sec.title}</div>
                                </button>
                            );
                        })
                    )}

                    <div className={`${s.tocHead} ${s.tocHeadGap}`}>概念圖 · 0</div>
                    <div className={s.tocEmpty}>
                        Concept extraction 尚未啟動 — P6.x 後接。
                    </div>
                </div>

                {/* TOC ↔ Transcript splitter */}
                <div
                    className={`${s.splitter} ${dragSide === 'toc' ? s.splitterActive : ''}`}
                    onPointerDown={(e) => startSplitterDrag('toc', e)}
                    onPointerMove={onSplitterMove}
                    onPointerUp={endSplitterDrag}
                    onPointerCancel={endSplitterDrag}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="調整章節欄寬度"
                />

                {/* Transcript */}
                <div className={s.transcript} ref={transcriptRef}>
                    <div className={s.transcriptControls}>
                        <span className={s.transcriptHead}>
                            完整逐字稿 · {paragraphs.length} 段 · {subs.length} 句
                        </span>
                        <div style={{ flex: 1 }} />

                        <div className={s.toggleRow}>
                            {(['both', 'zh', 'en'] as const).map((k) => (
                                <button
                                    key={k}
                                    onClick={() => setLang(k)}
                                    className={`${s.toggleBtn} ${lang === k ? s.toggleBtnActive : ''}`}
                                >
                                    {k === 'both' ? '雙語' : k === 'zh' ? '中' : 'EN'}
                                </button>
                            ))}
                        </div>

                        <div className={s.toggleRow}>
                            {(['para', 'sent'] as const).map((k) => (
                                <button
                                    key={k}
                                    onClick={() => setGrouping(k)}
                                    title={
                                        k === 'para' ? '按章節分段（易讀）' : '每句帶時間戳'
                                    }
                                    className={`${s.toggleBtn} ${grouping === k ? s.toggleBtnActive : ''}`}
                                >
                                    {k === 'para' ? '段落' : '逐句'}
                                </button>
                            ))}
                        </div>

                        <button
                            type="button"
                            onClick={() => setAutoFollow((v) => !v)}
                            className={`${s.followBtn} ${autoFollow ? s.followBtnActive : ''}`}
                            title="播放時自動捲到當前字幕"
                        >
                            {autoFollow ? '◉' : '○'} 自動跟隨
                        </button>
                    </div>

                    {subs.length === 0 ? (
                        <div className={s.transcriptEmpty}>
                            這堂課還沒有逐字稿。
                            <br />
                            錄音 + 轉錄完成後會出現在這裡。
                        </div>
                    ) : grouping === 'para' ? (
                        paragraphs.map((p, i) => (
                            <div key={i} className={s.para}>
                                <div className={s.paraHead}>
                                    <button
                                        type="button"
                                        className={s.paraTime}
                                        onClick={() =>
                                            startSeek(p.section?.timestamp ?? p.items[0]?.timestamp ?? 0)
                                        }
                                        style={{ color: courseAccent }}
                                    >
                                        {fmtTime(p.section?.timestamp ?? p.items[0]?.timestamp ?? 0)}
                                    </button>
                                    <span className={s.paraTitle}>
                                        {p.section?.title || '未分章節'}
                                    </span>
                                    <span className={s.paraCount}>{p.items.length} 句</span>
                                </div>
                                {(lang === 'both' || lang === 'zh') && (
                                    <div className={s.paraZh}>
                                        {p.items.map((it) => (
                                            <span
                                                key={`zh-${it.id}`}
                                                data-sub-id={it.id}
                                                className={
                                                    it.id === activeSubId ? s.paraSubActive : ''
                                                }
                                            >
                                                {it.text_zh || it.text_en}{' '}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {(lang === 'both' || lang === 'en') && (
                                    <div
                                        className={
                                            lang === 'en' ? s.paraEnSole : s.paraEn
                                        }
                                    >
                                        {p.items.map((it) => (
                                            <span
                                                key={`en-${it.id}`}
                                                data-sub-id={it.id + '-en'}
                                                className={
                                                    it.id === activeSubId ? s.paraSubActive : ''
                                                }
                                            >
                                                {it.text_en}{' '}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        subs
                            .sort((a, b) => a.timestamp - b.timestamp)
                            .map((sub) => (
                                <div
                                    key={sub.id}
                                    data-sub-id={sub.id}
                                    onClick={() => startSeek(sub.timestamp)}
                                    className={`${s.sent} ${sub.id === activeSubId ? s.sentActive : ''}`}
                                >
                                    <div className={s.sentHead}>
                                        <span className={s.sentTime}>
                                            {fmtTime(sub.timestamp)}
                                        </span>
                                    </div>
                                    {(lang === 'both' || lang === 'zh') && sub.text_zh && (
                                        <div className={s.sentZh}>{sub.text_zh}</div>
                                    )}
                                    {(lang === 'both' || lang === 'en') && (
                                        <div className={s.sentEn}>{sub.text_en}</div>
                                    )}
                                </div>
                            ))
                    )}
                </div>

                {/* Transcript ↔ Right splitter */}
                <div
                    className={`${s.splitter} ${dragSide === 'right' ? s.splitterActive : ''}`}
                    onPointerDown={(e) => startSplitterDrag('right', e)}
                    onPointerMove={onSplitterMove}
                    onPointerUp={endSplitterDrag}
                    onPointerCancel={endSplitterDrag}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="調整側邊欄寬度"
                />

                {/* Right tabs */}
                <div className={s.right}>
                    {/* Course context strip — instructor / TA / location / grading */}
                    {course && (
                        <CourseContextStrip course={course} />
                    )}

                    <div className={s.tabRow}>
                        {(
                            [
                                { k: 'notes' as const, label: '筆記' },
                                { k: 'summary' as const, label: 'AI 摘要' },
                                { k: 'qa' as const, label: `Q&A · ${examCount}` },
                            ] as const
                        ).map((o) => (
                            <button
                                key={o.k}
                                type="button"
                                onClick={() => setTab(o.k)}
                                className={`${s.tabBtn} ${tab === o.k ? s.tabBtnActive : ''}`}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>

                    {tab === 'notes' && (
                        <div className={s.tabPane}>
                            <div className={s.tabHead}>
                                <span className={s.tabHeadEyebrow}>
                                    我的筆記
                                    <span className={s.tabHeadStatus}>
                                        {notesDirty
                                            ? ' · 編輯中…'
                                            : notesSavedAt
                                              ? ` · 已儲存 ${fmtSavedTime(notesSavedAt)}`
                                              : notesDraft.length > 0
                                                ? ''
                                                : ' · 空白'}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (editingNotes) flushNotesSave();
                                        setEditingNotes((v) => !v);
                                    }}
                                    className={s.editBtn}
                                >
                                    {editingNotes ? '✓ 完成' : '✎ 編輯'}
                                </button>
                            </div>
                            {editingNotes ? (
                                <textarea
                                    value={notesDraft}
                                    onChange={(e) => handleNotesChange(e.target.value)}
                                    onBlur={flushNotesSave}
                                    placeholder={'用 markdown 寫下重點 / 公式 / 疑問…\n\n錄音時用 ⌘⇧N 浮動筆記窗，這裡會同步看到。'}
                                    className={s.notesEdit}
                                    spellCheck={false}
                                />
                            ) : notesDraft.trim().length > 0 ? (
                                <div className={s.notesUserView}>{notesDraft}</div>
                            ) : note && note.sections.length > 0 ? (
                                <>
                                    <div className={s.notesSeedBar}>
                                        還沒有手寫筆記 — 可以從 AI 章節為起點：
                                        <button
                                            type="button"
                                            onClick={handleSeedFromAi}
                                            className={s.editBtn}
                                            style={{ marginLeft: 'auto' }}
                                        >
                                            從 AI 摘要載入
                                        </button>
                                    </div>
                                    <div className={s.notesView}>
                                        {note.sections.map((sec, i) => (
                                            <div key={i} className={s.section}>
                                                <h3 className={s.sectionTitle}>
                                                    <span>{sec.title}</span>
                                                    <button
                                                        type="button"
                                                        className={s.sectionTime}
                                                        onClick={() => startSeek(sec.timestamp)}
                                                    >
                                                        {fmtTime(sec.timestamp)}
                                                    </button>
                                                </h3>
                                                {sec.bullets && sec.bullets.length > 0 && (
                                                    <ul className={s.sectionBullets}>
                                                        {sec.bullets.map((b, j) => (
                                                            <li key={j} className={s.sectionBullet}>
                                                                {b}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                                <div className={s.sectionContent}>{sec.content}</div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <div className={s.tabEmpty}>
                                    還沒有筆記 — 按 ✎ 編輯 開始寫，或在錄音時用 ⌘⇧N 開浮動筆記窗。
                                    <div className={s.tabEmptyTag}>autosave · localStorage</div>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'summary' && (
                        <div className={s.tabPane}>
                            <div className={s.tabHead}>
                                <span className={s.tabHeadEyebrow}>
                                    AI 自動摘要
                                    {summaryTaskRunning && (
                                        <span className={s.tabHeadStatus}>
                                            {' · 生成中…'}
                                        </span>
                                    )}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleRegenerateSummary}
                                    disabled={subs.length === 0}
                                    className={s.editBtn}
                                    title={
                                        subs.length === 0
                                            ? '沒有逐字稿，沒得摘要'
                                            : summaryTaskRunning
                                              ? '取消當前摘要並重新生成'
                                              : note?.summary
                                                ? '用最新逐字稿重新生成'
                                                : '從目前逐字稿生成摘要'
                                    }
                                >
                                    {summaryTaskRunning
                                        ? '✦ 重新生成'
                                        : note?.summary
                                          ? '✦ 重新生成'
                                          : '✦ 生成摘要'}
                                </button>
                            </div>
                            {/* Phase 7 S2.4 — streaming progress hint when
                                a summarize task is active for this lecture. */}
                            {summaryTaskRunning && (
                                <div
                                    role="status"
                                    aria-live="polite"
                                    style={{
                                        padding: '8px 10px',
                                        margin: '8px 0',
                                        borderRadius: 6,
                                        border: '1px dashed var(--h18-border)',
                                        background:
                                            'var(--h18-surface-alt, var(--h18-surface))',
                                        color: 'var(--h18-text-mid)',
                                        fontSize: 11,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 6,
                                    }}
                                >
                                    <span>
                                        ✦ 摘要生成中 · 約 {summaryProgressPct}%
                                    </span>
                                    <div
                                        aria-hidden
                                        style={{
                                            height: 3,
                                            borderRadius: 2,
                                            background: 'var(--h18-border-soft)',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: `${summaryProgressPct}%`,
                                                height: '100%',
                                                background: 'var(--h18-accent)',
                                                transition: 'width 200ms linear',
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                            {/* Phase 7 S2.6 — failed task → red banner +
                                retry button. */}
                            {summaryTask?.status === 'failed' && (
                                <div
                                    role="alert"
                                    style={{
                                        padding: '8px 10px',
                                        margin: '8px 0',
                                        borderRadius: 6,
                                        border: '1px solid var(--h18-hot)',
                                        background: 'var(--h18-hot-bg)',
                                        color: 'var(--h18-hot)',
                                        fontSize: 11,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                    }}
                                >
                                    <span style={{ flex: 1 }}>
                                        ✦ 摘要生成失敗：
                                        {summaryTask.error || 'unknown'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleRetrySummary}
                                        className={s.editBtn}
                                    >
                                        重試
                                    </button>
                                </div>
                            )}
                            {summarizeError && (
                                <div
                                    style={{
                                        padding: '8px 10px',
                                        margin: '8px 0',
                                        borderRadius: 6,
                                        border: '1px solid var(--h18-hot)',
                                        background: 'var(--h18-hot-bg)',
                                        color: 'var(--h18-hot)',
                                        fontSize: 11,
                                    }}
                                >
                                    ⚠ {summarizeError}
                                </div>
                            )}
                            {note?.summary ? (
                                <div className={s.summaryBox}>{note.summary}</div>
                            ) : (
                                <div className={s.tabEmpty}>
                                    尚未生成 AI 摘要。
                                    <br />
                                    按右上角「✦ 生成摘要」用目前逐字稿即時跑。
                                    <div className={s.tabEmptyTag}>
                                        llm.summarize · 走當前 default provider
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'qa' && (
                        <div className={s.tabPane}>
                            <div className={s.tabHead}>
                                <span className={s.tabHeadEyebrow}>
                                    Q&A · {examCount}
                                </span>
                            </div>

                            {examMarks.length > 0 && (
                                <>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            letterSpacing: '0.06em',
                                            color: 'var(--h18-text-dim)',
                                            margin: '8px 0 6px',
                                            textTransform: 'uppercase',
                                        }}
                                    >
                                        ⚑ 錄音時標記的考點 · {examMarks.length}
                                    </div>
                                    {examMarks.map((m) => (
                                        <button
                                            key={`${m.elapsedSec}-${m.markedAtMs}`}
                                            type="button"
                                            onClick={() => startSeek(m.elapsedSec)}
                                            className={s.qaRow}
                                            style={{
                                                textAlign: 'left',
                                                width: '100%',
                                                cursor: 'pointer',
                                                background: 'transparent',
                                                border: '1px dashed var(--h18-border-soft)',
                                            }}
                                            title="跳到這個時間點"
                                        >
                                            <div className={s.qaQuestion}>
                                                ⚑ {fmtTime(m.elapsedSec)}
                                                {m.label ? ` · ${m.label}` : ''}
                                            </div>
                                            {m.text && (
                                                <div
                                                    className={s.qaAnswer}
                                                    style={{ color: 'var(--h18-text-mid)' }}
                                                >
                                                    {m.text}
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </>
                            )}

                            {note?.qa_records && note.qa_records.length > 0 ? (
                                <>
                                    {examMarks.length > 0 && (
                                        <div
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                letterSpacing: '0.06em',
                                                color: 'var(--h18-text-dim)',
                                                margin: '12px 0 6px',
                                                textTransform: 'uppercase',
                                            }}
                                        >
                                            AI 整理的 Q&A · {note.qa_records.length}
                                        </div>
                                    )}
                                    {note.qa_records.map((qa, i) => (
                                        <div key={i} className={s.qaRow}>
                                            <div className={s.qaQuestion}>
                                                Q · {fmtTime(qa.timestamp)}
                                            </div>
                                            <div className={s.qaAnswer}>{qa.question}</div>
                                            <div
                                                className={s.qaAnswer}
                                                style={{
                                                    marginTop: 6,
                                                    color: 'var(--h18-text-mid)',
                                                }}
                                            >
                                                {qa.answer}
                                            </div>
                                        </div>
                                    ))}
                                </>
                            ) : examMarks.length === 0 ? (
                                <div className={s.tabEmpty}>
                                    沒有 Q&A 紀錄。
                                    <br />
                                    錄音時按 ⚑ 標記考點，或等 AI 摘要產出 Q&A。
                                    <div className={s.tabEmptyTag}>
                                        P6.4 · 待 concept extraction
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            {audioOpen && audioSrc && (
                <H18AudioPlayer
                    src={audioSrc}
                    lectureTitle={lecture.title}
                    onTimeUpdate={setCurrentSec}
                    seekTo={seekTo}
                    onClose={() => setAudioOpen(false)}
                />
            )}
        </div>
    );
}

/**
 * Phase 7 Sprint 2 R3 (S2.6 / S2.7) — inline summarize runner.
 *
 * Lives at module scope (not inside the component) so it can be invoked
 * from both the regenerate and retry click handlers without re-binding
 * to component-instance state. Mirrors the stop-pipeline pattern in
 * `recordingSessionService.runBackgroundSummary` (Sprint 2 Round 2)
 * intentionally — duplication is the cost of staying inside the
 * Sprint-2-R3 whitelist (we can't refactor the singleton). A future
 * sprint can lift this into `services/summarizeRunner.ts`.
 *
 * Reports progress + terminal status via the taskTracker; storage write
 * happens before `complete()` so subscribers reloading the note row see
 * the new summary text by the time they react to the `done` transition.
 */
async function runSummary(
    taskId: string,
    lectureId: string,
    title?: string,
): Promise<void> {
    try {
        const subs = await storageService.getSubtitles(lectureId).catch(
            () => [] as Subtitle[],
        );
        const text = subs
            .map((s) => s.text_zh || s.text_en || '')
            .filter(Boolean)
            .join('\n');
        if (text.trim().length < 100) {
            // Not enough content to bother — short-circuit to done so
            // the tracker row clears.
            taskTrackerService.complete(taskId);
            return;
        }
        taskTrackerService.update(taskId, { status: 'running' });

        // Pick output language from the user's translation target.
        let lang: 'zh' | 'en' = 'zh';
        try {
            const settings = await storageService.getAppSettings();
            const tgt = settings?.translation?.target_language || 'zh-TW';
            lang = tgt.startsWith('zh') ? 'zh' : 'en';
        } catch {
            /* default zh */
        }

        const { summarizeStream } = await import('../../services/llm/tasks');
        let full = '';
        let chunkCount = 0;
        for await (const event of summarizeStream({
            content: text,
            language: lang,
            title,
        })) {
            if (event.phase === 'reduce-delta' && event.delta) {
                full += event.delta;
                chunkCount += 1;
                taskTrackerService.update(taskId, {
                    progress: Math.min(0.95, chunkCount * 0.05),
                    status: 'running',
                });
            } else if (event.phase === 'done' && event.fullText) {
                full = event.fullText;
            }
        }

        const existing = await storageService.getNote(lectureId).catch(
            () => null,
        );
        await storageService.saveNote({
            lecture_id: lectureId,
            title: existing?.title ?? title ?? '',
            summary: full,
            sections: existing?.sections ?? [],
            qa_records: existing?.qa_records ?? [],
            generated_at: new Date().toISOString(),
        });
        taskTrackerService.complete(taskId);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        taskTrackerService.fail(taskId, msg);
    }
}

function CourseContextStrip({ course }: { course: Course }) {
    const sy = course.syllabus_info || {};
    const items: { label: string; value: string }[] = [];
    if (sy.instructor) items.push({ label: '老師', value: sy.instructor });
    if (sy.teaching_assistants) items.push({ label: '助教', value: sy.teaching_assistants });
    if (sy.location) items.push({ label: '地點', value: sy.location });
    if (sy.time) items.push({ label: '時間', value: sy.time });

    const grading = sy.grading || [];

    if (items.length === 0 && grading.length === 0) return null;

    return (
        <div className={s.ctxStrip}>
            {items.length > 0 && (
                <div className={s.ctxRow}>
                    {items.map((it) => (
                        <div key={it.label} className={s.ctxItem}>
                            <span className={s.ctxLabel}>{it.label}</span>
                            <span className={s.ctxValue}>{it.value}</span>
                        </div>
                    ))}
                </div>
            )}
            {grading.length > 0 && (
                <div className={s.ctxGrading}>
                    <span className={s.ctxLabel}>評分</span>
                    <div className={s.ctxGradingList}>
                        {grading.map((g, i) => (
                            <span key={i} className={s.ctxGradingChip}>
                                {g.item} {g.percentage}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function renderNoteAsMarkdown(note: Note): string {
    const parts: string[] = [`# ${note.title}\n`];
    if (note.summary) parts.push(`> ${note.summary}\n`);
    for (const sec of note.sections) {
        parts.push(`## ${sec.title}\n`);
        if (sec.bullets && sec.bullets.length > 0) {
            for (const b of sec.bullets) parts.push(`- ${b}`);
            parts.push('');
        }
        if (sec.content) parts.push(sec.content + '\n');
    }
    return parts.join('\n');
}
