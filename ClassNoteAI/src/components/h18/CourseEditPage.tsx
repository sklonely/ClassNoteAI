/**
 * CourseEditPage · v0.7.0
 *
 * 「低負擔」設計：AI 從使用者上傳的 PDF / 課綱文字幫忙整理，這頁
 * 只是讓人微調最後結果。
 *
 * 結構：
 *   ┌─────── topbar ────────┐  ← 取消 / 課程名 / 重新生成 / 儲存
 *   │ AI status banner      │  ← generating / ready / failed (only when not idle)
 *   │ 基本資料卡            │  ← title / description (AI 預填)
 *   │ 老師卡 (1)            │  ← name / email / office hours
 *   │ 助教卡 (n)            │  ← name / email / office hours, addable
 *   │ 評分組成卡            │  ← item + %
 *   │ 課程堂數卡            │  ← Lecture 1, 2, 3...
 *   └───────────────────────┘
 *
 * 「重新生成」呼叫 storageService.retryCourseSyllabusGeneration(courseId)
 * 一旦進到 generating 狀態，banner 會反應；ready 後 syllabus_info 自動更新
 * (broadcast classnote-course-updated)，本頁監聽事件 reload。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    storageService,
    getCourseSyllabusState,
    getCourseSyllabusFailureReason,
} from '../../services/storageService';
import { selectPDFFile } from '../../services/fileService';
import type { AgentResult } from '../../services/courseUrlAgent';
import CourseUrlAgentPanel from './CourseUrlAgentPanel';
import { toastService } from '../../services/toastService';
import type { Course, SyllabusInfo, TeachingPerson } from '../../types';
import { courseColor } from './courseColor';
import s from './CourseEditPage.module.css';

type ReimportMode = 'text' | 'file' | 'url';

const REIMPORT_OPTS: { k: ReimportMode; label: string; hint: string }[] = [
    { k: 'text', label: '貼文字', hint: '改 / 貼新大綱重跑 AI' },
    { k: 'file', label: '上傳檔案', hint: '換 PDF · 重新解析' },
    { k: 'url', label: '從網址', hint: '抓取課程網址 syllabus' },
];

export interface CourseEditPageProps {
    courseId: string;
    onBack: () => void;
}

interface GradingRow {
    item: string;
    percentage: string;
}

/**
 * 從 syllabus_info.time 字串解析出上課的 weekday set
 * (Mon=1, Tue=2, ..., Sun=7)。對齊 weekParse.ts 的格式假設：
 * 中文「週X / 周X / 星期X」、英文 "Mon / Tue / Wed / Thu / Fri / Sat / Sun"。
 */
function parseWeekdaysFromTime(time: string): Set<number> {
    const days = new Set<number>();
    if (!time) return days;
    const cnTable: Record<string, number> = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
    };
    const enTable: Record<string, number> = {
        mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
    };
    const cnRe = /(?:週|周|星期)\s*([一二三四五六日天])/g;
    let m: RegExpExecArray | null;
    while ((m = cnRe.exec(time))) {
        const d = cnTable[m[1]];
        if (d) days.add(d);
    }
    const enRe = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi;
    while ((m = enRe.exec(time))) {
        const d = enTable[m[1].toLowerCase()];
        if (d) days.add(d);
    }
    return days;
}

function parseLegacyTAs(s?: string): TeachingPerson[] {
    if (!s) return [];
    return s
        .split(/[,，、/／]/)
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .map((name) => ({ name }));
}

function joinTANames(list: TeachingPerson[]): string | undefined {
    const names = list.map((p) => p.name.trim()).filter((n) => n.length > 0);
    return names.length > 0 ? names.join('、') : undefined;
}

export default function CourseEditPage({
    courseId,
    onBack,
}: CourseEditPageProps) {
    const [original, setOriginal] = useState<Course | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // form state — basics
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [keywords, setKeywords] = useState('');
    const [time, setTime] = useState('');
    const [location, setLocation] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [canvasAnnouncementsRss, setCanvasAnnouncementsRss] = useState('');

    // instructor
    const [instructor, setInstructor] = useState<TeachingPerson>({ name: '' });
    // tas
    const [tas, setTas] = useState<TeachingPerson[]>([]);
    const [taOfficeHours, setTaOfficeHours] = useState('');
    // grading + schedule
    const [grading, setGrading] = useState<GradingRow[]>([]);
    const [schedule, setSchedule] = useState<string[]>([]);

    // cp75.2: re-import section (paste text / upload PDF / fetch URL).
    // Mirrors AddCourseDialog's three source modes so editing a course
    // is symmetric with creating one.
    const [reimportMode, setReimportMode] = useState<ReimportMode>('text');
    const [reimportText, setReimportText] = useState('');
    const [reimportPdf, setReimportPdf] = useState<{ path: string; data: ArrayBuffer } | null>(null);
    const [reimportAgent, setReimportAgent] = useState<AgentResult | null>(null);
    const [reimporting, setReimporting] = useState(false);

    /* ────────── load ────────── */
    const loadCourse = (id: string) => {
        setLoading(true);
        return storageService
            .getCourse(id)
            .then((c) => {
                if (!c) return;
                setOriginal(c);
                setTitle(c.title || '');
                // Prefer the AI-organized overview when available; only fall
                // back to the raw user-pasted description if AI hasn't run.
                setDescription(c.syllabus_info?.overview || c.description || '');
                setKeywords(c.keywords || '');
                const sy = c.syllabus_info || {};
                setTime(sy.time || '');
                setLocation(sy.location || '');
                setStartDate(sy.start_date || '');
                setEndDate(sy.end_date || '');
                setCanvasAnnouncementsRss(sy.canvas_announcements_rss || '');
                setInstructor({
                    name: sy.instructor || '',
                    email: sy.instructor_email,
                    office_hours:
                        sy.instructor_office_hours || sy.office_hours || '',
                });
                const taList =
                    sy.teaching_assistant_list && sy.teaching_assistant_list.length > 0
                        ? sy.teaching_assistant_list.map((t) => ({ ...t }))
                        : parseLegacyTAs(sy.teaching_assistants);
                setTas(taList);
                setTaOfficeHours(sy.ta_office_hours || '');
                setGrading(sy.grading?.length ? [...sy.grading] : []);
                setSchedule(sy.schedule?.length ? [...sy.schedule] : []);
            })
            .catch((err) => {
                console.warn('[CourseEditPage] load failed:', err);
                setError('載入課程失敗');
            })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        let cancelled = false;
        void loadCourse(courseId).then(() => {
            if (cancelled) return;
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courseId]);

    // listen for AI completion → reload
    useEffect(() => {
        const onCourseUpdated = (e: Event) => {
            const detail = (e as CustomEvent<{ courseId?: string }>).detail;
            if (detail?.courseId === courseId) {
                void loadCourse(courseId);
                setRegenerating(false);
            }
        };
        window.addEventListener('classnote-course-updated', onCourseUpdated);
        return () =>
            window.removeEventListener('classnote-course-updated', onCourseUpdated);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courseId]);

    const syllabusState = original ? getCourseSyllabusState(original.syllabus_info) : 'idle';
    const failureReason = original
        ? getCourseSyllabusFailureReason(original.syllabus_info)
        : undefined;

    /* ────────── ready banner: auto-dismiss after 3s ────────── */
    const [readyBannerVisible, setReadyBannerVisible] = useState(true);
    useEffect(() => {
        if (syllabusState !== 'ready') {
            // Reset for the *next* time we hit ready
            setReadyBannerVisible(true);
            return;
        }
        if (!readyBannerVisible) return;
        const t = window.setTimeout(() => setReadyBannerVisible(false), 3000);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syllabusState]);

    /* ────────── missing-fields card after fresh AI completion ────────── */
    const prevSyllabusStateRef = useRef(syllabusState);
    const [showMissingCard, setShowMissingCard] = useState(false);
    useEffect(() => {
        const prev = prevSyllabusStateRef.current;
        prevSyllabusStateRef.current = syllabusState;
        if (prev === 'generating' && syllabusState === 'ready') {
            setShowMissingCard(true);
        }
    }, [syllabusState]);

    const missingFields: string[] = (() => {
        if (!original) return [];
        const sy = original.syllabus_info || {};
        const list: string[] = [];
        if (!sy.topic?.trim()) list.push('課程主題');
        if (!sy.overview?.trim()) list.push('課程簡介');
        if (!sy.time?.trim()) list.push('上課時間');
        if (!sy.location?.trim()) list.push('上課地點');
        if (!sy.start_date?.trim()) list.push('開始日期');
        if (!sy.end_date?.trim()) list.push('結束日期');
        if (!sy.instructor?.trim()) list.push('授課老師');
        if (!sy.instructor_email?.trim()) list.push('老師 Email');
        if (!sy.instructor_office_hours?.trim() && !sy.office_hours?.trim()) {
            list.push('老師 Office Hours');
        }
        const taList = sy.teaching_assistant_list || [];
        if (taList.length === 0 && !sy.teaching_assistants?.trim()) {
            list.push('助教');
        } else {
            const taMissingEmail = taList.filter((t) => !t.email?.trim()).length;
            const taMissingOH = taList.filter(
                (t) => !t.office_hours?.trim(),
            ).length;
            if (taMissingEmail > 0) list.push(`助教 Email (${taMissingEmail} 位)`);
            if (taMissingOH > 0 && !sy.ta_office_hours?.trim()) {
                list.push(`助教 Office Hours (${taMissingOH} 位)`);
            }
        }
        if (!sy.grading || sy.grading.length === 0) list.push('評分組成');
        if (!sy.schedule || sy.schedule.length === 0) list.push('課程堂數');
        return list;
    })();

    /* ────────── handlers ────────── */
    const updateInstructor = (patch: Partial<TeachingPerson>) =>
        setInstructor((cur) => ({ ...cur, ...patch }));

    const updateTA = (i: number, patch: Partial<TeachingPerson>) =>
        setTas((cur) => cur.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
    const addTA = () => setTas((cur) => [...cur, { name: '' }]);
    const removeTA = (i: number) =>
        setTas((cur) => cur.filter((_, idx) => idx !== i));

    const updateGrading = (i: number, key: keyof GradingRow, v: string) =>
        setGrading((cur) =>
            cur.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)),
        );
    const addGrading = () =>
        setGrading((cur) => [...cur, { item: '', percentage: '' }]);
    const removeGrading = (i: number) =>
        setGrading((cur) => cur.filter((_, idx) => idx !== i));

    const updateSchedule = (i: number, v: string) =>
        setSchedule((cur) => cur.map((row, idx) => (idx === i ? v : row)));
    const addSchedule = () => setSchedule((cur) => [...cur, '']);
    const removeSchedule = (i: number) =>
        setSchedule((cur) => cur.filter((_, idx) => idx !== i));
    const moveSchedule = (i: number, dir: -1 | 1) => {
        setSchedule((cur) => {
            const j = i + dir;
            if (j < 0 || j >= cur.length) return cur;
            const next = [...cur];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    };

    /**
     * 從 start_date / end_date / time（每週上課日）自動產生 Lecture 1, 2, … 占位。
     * 沒有主題就只放日期，使用者之後再補。
     */
    const canAutoGenLectures = !!(startDate && endDate && time.trim());
    const autoGenLectures = () => {
        if (!canAutoGenLectures) return;
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return;
        const weekdays = parseWeekdaysFromTime(time);
        if (weekdays.size === 0) return;

        const lectures: string[] = [];
        const cur = new Date(start);
        while (cur <= end && lectures.length < 200) {
            // JS getDay(): Sun=0, Mon=1, ..., Sat=6
            // Our internal: Mon=1, ..., Sun=7
            const internal = cur.getDay() === 0 ? 7 : cur.getDay();
            if (weekdays.has(internal)) {
                const mm = String(cur.getMonth() + 1).padStart(2, '0');
                const dd = String(cur.getDate()).padStart(2, '0');
                lectures.push(`(${mm}/${dd}) `);
            }
            cur.setDate(cur.getDate() + 1);
        }
        setSchedule(lectures);
    };

    const handleRegenerate = async () => {
        if (!original) return;
        setRegenerating(true);
        setError(null);
        try {
            await storageService.retryCourseSyllabusGeneration(courseId);
            // 不立刻 reload — generating 過程中等 'classnote-course-updated' event
        } catch (err) {
            console.error('[CourseEditPage] regenerate failed:', err);
            setError(
                (err as Error)?.message || '重新生成失敗，請查看 console。',
            );
            setRegenerating(false);
        }
    };

    // ─── Re-import handlers (cp75.2) ─────────────────────────────────
    // Three-mode parity with AddCourseDialog:
    //   text → swap description + force AI re-extract
    //   file → upload new PDF + re-extract
    //   url  → fetch via courseUrlAgent + apply pre-parsed syllabus directly
    //          (skip extractSyllabus, the agent already did the work).

    const handlePickReimportFile = async () => {
        try {
            const picked = await selectPDFFile();
            if (picked) setReimportPdf(picked);
        } catch (err) {
            console.warn('[CourseEditPage] selectPDFFile failed:', err);
        }
    };

    const handleApplyTextReimport = async () => {
        if (!original) return;
        const trimmed = reimportText.trim();
        if (!trimmed) return;
        setReimporting(true);
        setError(null);
        try {
            // Push the new description through the same path AddCourseDialog
            // uses: saveCourseWithSyllabus { forceRegenerate: true } makes
            // the AI pipeline run on the freshly-pasted text.
            const next: Course = {
                ...original,
                description: trimmed,
                updated_at: new Date().toISOString(),
            };
            await storageService.saveCourseWithSyllabus(next, {
                forceRegenerate: true,
            });
            setDescription(trimmed);
            setReimportText('');
            toastService.success(
                '已套用新文字，AI 重新解析中…',
                '完成後欄位會自動更新。',
            );
        } catch (err) {
            console.error('[CourseEditPage] reimport text failed:', err);
            setError((err as Error)?.message || '重新匯入失敗');
        } finally {
            setReimporting(false);
        }
    };

    const handleApplyFileReimport = async () => {
        if (!original || !reimportPdf) return;
        setReimporting(true);
        setError(null);
        try {
            await storageService.saveCourseWithSyllabus(
                { ...original, updated_at: new Date().toISOString() },
                { pdfData: reimportPdf.data, forceRegenerate: true },
            );
            setReimportPdf(null);
            toastService.success(
                '已套用新 PDF，AI 重新解析中…',
                '完成後欄位會自動更新。',
            );
        } catch (err) {
            console.error('[CourseEditPage] reimport file failed:', err);
            setError((err as Error)?.message || '重新匯入 PDF 失敗');
        } finally {
            setReimporting(false);
        }
    };

    const handleApplyUrlReimport = async () => {
        if (!original || !reimportAgent) return;
        setReimporting(true);
        setError(null);
        try {
            // URL agent already produced a structured syllabus — apply it
            // directly without re-running extractSyllabus (mirrors
            // H18DeepApp.tsx URL-agent path used at course creation).
            const now = new Date().toISOString();
            const stampedSyllabus = {
                ...reimportAgent.syllabus,
                _classnote_status: 'ready',
                _classnote_source: 'description',
                _classnote_updated_at: now,
                _classnote_raw_description: reimportAgent.sourceText,
            } as unknown as SyllabusInfo;
            await storageService.saveCourse({
                ...original,
                syllabus_info: stampedSyllabus,
                updated_at: now,
            });
            setReimportAgent(null);
            toastService.success(
                '已套用網址解析結果',
                '頁面欄位將自動刷新。',
            );
        } catch (err) {
            console.error('[CourseEditPage] reimport url failed:', err);
            setError((err as Error)?.message || '套用網址結果失敗');
        } finally {
            setReimporting(false);
        }
    };

    const handleSave = async () => {
        if (!original) return;
        setSaving(true);
        setError(null);
        try {
            const cleanGrading = grading
                .map((g) => ({ item: g.item.trim(), percentage: g.percentage.trim() }))
                .filter((g) => g.item.length > 0);
            const cleanSchedule = schedule
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            const cleanTAs = tas
                .map((t) => ({
                    name: t.name.trim(),
                    email: t.email?.trim() || undefined,
                    office_hours: t.office_hours?.trim() || undefined,
                }))
                .filter((t) => t.name.length > 0);
            const instructorName = instructor.name.trim();
            const instructorEmail = instructor.email?.trim();
            const instructorOH = instructor.office_hours?.trim();
            const taOH = taOfficeHours.trim();

            const nextSyllabus: SyllabusInfo = {
                ...(original.syllabus_info || {}),
                time: time.trim() || undefined,
                location: location.trim() || undefined,
                start_date: startDate.trim() || undefined,
                end_date: endDate.trim() || undefined,
                canvas_announcements_rss: canvasAnnouncementsRss.trim() || undefined,
                instructor: instructorName || undefined,
                instructor_email: instructorEmail || undefined,
                instructor_office_hours: instructorOH || undefined,
                // sync legacy office_hours so display fallback still works
                office_hours: instructorOH || undefined,
                teaching_assistant_list: cleanTAs.length > 0 ? cleanTAs : undefined,
                teaching_assistants: joinTANames(cleanTAs),
                ta_office_hours: taOH || undefined,
                grading: cleanGrading.length ? cleanGrading : undefined,
                schedule: cleanSchedule.length ? cleanSchedule : undefined,
                // The description form field is bound to overview when AI
                // has run, so always sync the user's edit back here.
                overview: description.trim() || undefined,
            };

            const next: Course = {
                ...original,
                title: title.trim() || original.title,
                description: description.trim() || undefined,
                keywords: keywords.trim() || undefined,
                syllabus_info: nextSyllabus,
                updated_at: new Date().toISOString(),
            };

            await storageService.saveCourse(next);
            onBack();
        } catch (err) {
            console.error('[CourseEditPage] save failed:', err);
            setError(
                (err as Error)?.message || '儲存失敗，請查看 console。',
            );
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className={s.page}>
                <div className={s.loading}>載入中…</div>
            </div>
        );
    }
    if (!original) {
        return (
            <div className={s.page}>
                <div className={s.loading}>
                    找不到這門課。
                    <button type="button" onClick={onBack} className={s.backBtn} style={{ marginTop: 12 }}>
                        ← 返回
                    </button>
                </div>
            </div>
        );
    }

    const accent = courseColor(courseId);
    const totalPct = grading.reduce((acc, g) => {
        const n = parseFloat(g.percentage.replace('%', '').trim());
        return acc + (isNaN(n) ? 0 : n);
    }, 0);

    const isBusy = saving || regenerating || syllabusState === 'generating';

    return (
        <div className={s.page}>
            <div className={s.topbar}>
                <button type="button" onClick={onBack} className={s.backBtn}>
                    ← 取消
                </button>
                <div className={s.crumb}>
                    <span className={s.crumbCourse} style={{ color: accent }}>
                        {original.title}
                    </span>
                    <span className={s.crumbDivider}>/</span>
                    <span className={s.crumbHere}>編輯課程</span>
                </div>
                <div style={{ flex: 1 }} />
                {error && <span className={s.errorTag}>⚠ {error}</span>}
                <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={isBusy}
                    className={s.regenBtn}
                    title="用原始 PDF / 課綱重跑 AI 解析"
                >
                    {regenerating || syllabusState === 'generating' ? '⟳ AI 整理中…' : '⟳ 重新生成'}
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isBusy}
                    className={s.saveBtn}
                >
                    {saving ? '儲存中…' : '✓ 儲存'}
                </button>
            </div>

            {syllabusState !== 'idle' && syllabusState !== 'ready' && (
                <div
                    className={`${s.banner} ${
                        syllabusState === 'failed' ? s.bannerFail : s.bannerInfo
                    }`}
                >
                    {syllabusState === 'generating' && (
                        <>
                            <span className={s.bannerSpinner}>⟳</span>
                            <span>
                                AI 正在解析這門課的 PDF / 課綱…
                                <span className={s.bannerHint}>
                                    完成後欄位會自動更新。期間可以先離開、過幾秒回來。
                                </span>
                            </span>
                        </>
                    )}
                    {syllabusState === 'failed' && (
                        <>
                            <span>⚠</span>
                            <span>
                                上次 AI 解析失敗：{failureReason || '未知原因'}
                                <span className={s.bannerHint}>
                                    可以按「⟳ 重新生成」重試，或手動填寫下方欄位。
                                </span>
                            </span>
                        </>
                    )}
                </div>
            )}
            {syllabusState === 'ready' && readyBannerVisible && (
                <div className={`${s.banner} ${s.bannerOk} ${s.bannerFade}`}>
                    <span>✦</span>
                    <span>
                        以下內容由 AI 從這門課的課綱整理而來。微調後按「✓ 儲存」即可，
                        如果整理結果跟原始 PDF 差太多，按「⟳ 重新生成」重跑。
                    </span>
                </div>
            )}

            {showMissingCard && missingFields.length > 0 && (
                <div className={s.missingCard}>
                    <div className={s.missingHead}>
                        <span className={s.missingEyebrow}>AI 抽不到的部分</span>
                        <button
                            type="button"
                            onClick={() => setShowMissingCard(false)}
                            className={s.missingClose}
                            aria-label="關閉"
                            title="關閉"
                        >
                            ✕
                        </button>
                    </div>
                    <div className={s.missingBody}>
                        AI 從課綱裡沒有找到這幾個欄位，要不要自己補一下？
                    </div>
                    <div className={s.missingChips}>
                        {missingFields.map((f) => (
                            <span key={f} className={s.missingChip}>
                                {f}
                            </span>
                        ))}
                    </div>
                    <div className={s.missingActions}>
                        <button
                            type="button"
                            onClick={() => setShowMissingCard(false)}
                            className={s.missingSkipBtn}
                        >
                            略過
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowMissingCard(false)}
                            className={s.missingFillBtn}
                        >
                            好，我來填
                        </button>
                    </div>
                </div>
            )}
            {showMissingCard && missingFields.length === 0 && (
                <div className={`${s.banner} ${s.bannerOk}`}>
                    <span>✦</span>
                    <span>
                        AI 已經把所有欄位都填好了，檢查一下、儲存就完成。
                    </span>
                    <button
                        type="button"
                        onClick={() => setShowMissingCard(false)}
                        className={s.bannerClose}
                        aria-label="關閉"
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className={s.body}>
                {/* 重新匯入 (cp75.2) — symmetric with AddCourseDialog */}
                <Card
                    title="重新匯入課綱"
                    eyebrow="RE-IMPORT"
                >
                    <div className={s.reimportHint}>
                        從新來源蓋掉現有 syllabus。三種模式跟新增課程時相同 —
                        貼新文字 / 換新 PDF / 改抓另一個課程網址。
                    </div>
                    <div className={s.reimportSrcRow}>
                        {REIMPORT_OPTS.map((o) => (
                            <button
                                key={o.k}
                                type="button"
                                onClick={() => setReimportMode(o.k)}
                                disabled={reimporting}
                                className={`${s.reimportSrcBtn} ${reimportMode === o.k ? s.reimportSrcBtnActive : ''}`}
                            >
                                <div className={s.reimportSrcLabel}>{o.label}</div>
                                <div className={s.reimportSrcHint}>{o.hint}</div>
                            </button>
                        ))}
                    </div>

                    {reimportMode === 'text' && (
                        <div className={s.reimportBody}>
                            <textarea
                                className={s.textarea}
                                rows={6}
                                value={reimportText}
                                onChange={(e) => setReimportText(e.target.value)}
                                disabled={reimporting}
                                placeholder={`貼新的課綱 / 大綱 / 老師說明文字。提交後 AI 會用這份新文字重新解析。\n\n例：\n計算機網路 · 陳老師 · 週三 10:00 · 資訊館 204\n單元：TCP / UDP / routing / socket / security ...`}
                            />
                            <div className={s.reimportActions}>
                                <button
                                    type="button"
                                    onClick={handleApplyTextReimport}
                                    disabled={
                                        reimporting || !reimportText.trim()
                                    }
                                    className={s.reimportApplyBtn}
                                >
                                    {reimporting
                                        ? '解析中…'
                                        : '✦ 套用新文字'}
                                </button>
                            </div>
                        </div>
                    )}

                    {reimportMode === 'file' && (
                        <div className={s.reimportBody}>
                            <button
                                type="button"
                                className={s.fileDrop}
                                onClick={handlePickReimportFile}
                                disabled={reimporting}
                            >
                                <div className={s.fileDropIcon}>⎘</div>
                                <div className={s.fileDropTitle}>
                                    {reimportPdf
                                        ? '已選新 PDF — 點擊更換'
                                        : '點擊選擇新 PDF 檔案'}
                                </div>
                                <div className={s.fileDropHint}>PDF · 最多 20 MB</div>
                            </button>
                            {reimportPdf && (
                                <div className={s.fileSelectedRow}>
                                    ✓ {reimportPdf.path.split(/[\\/]/).pop()} ·{' '}
                                    {(reimportPdf.data.byteLength / 1024).toFixed(0)} KB
                                </div>
                            )}
                            <div className={s.reimportActions}>
                                <button
                                    type="button"
                                    onClick={handleApplyFileReimport}
                                    disabled={reimporting || !reimportPdf}
                                    className={s.reimportApplyBtn}
                                >
                                    {reimporting
                                        ? '解析中…'
                                        : '✦ 套用新 PDF'}
                                </button>
                            </div>
                        </div>
                    )}

                    {reimportMode === 'url' && (
                        <div className={s.reimportBody}>
                            <CourseUrlAgentPanel
                                titleHint={title}
                                onResult={(r) => setReimportAgent(r)}
                                onClear={() => setReimportAgent(null)}
                            />
                            <div className={s.reimportActions}>
                                <button
                                    type="button"
                                    onClick={handleApplyUrlReimport}
                                    disabled={
                                        reimporting || !reimportAgent
                                    }
                                    className={s.reimportApplyBtn}
                                >
                                    {reimporting
                                        ? '套用中…'
                                        : reimportAgent
                                            ? '✦ 套用此網址結果'
                                            : '先在上方貼網址解析'}
                                </button>
                            </div>
                        </div>
                    )}
                </Card>

                {/* 基本資料 */}
                <Card title="基本資料" eyebrow="ABOUT">
                    <Field label="課程名稱">
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className={s.input}
                            placeholder="e.g. 機器學習導論"
                        />
                    </Field>
                    <Field
                        label="課程描述"
                        hint="一兩段話介紹這門課，會出現在首頁卡片跟全域搜尋。"
                    >
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className={s.textarea}
                            rows={4}
                            placeholder="(AI 會從上傳的 PDF / 課綱填這欄；可手動覆寫)"
                        />
                    </Field>
                    <div className={s.row2}>
                        <Field
                            label="上課時間"
                            hint="格式建議：週一、週三 14:00-15:50（24 小時制；Home 排堂會吃這欄）"
                        >
                            <input
                                type="text"
                                value={time}
                                onChange={(e) => setTime(e.target.value)}
                                className={s.input}
                                placeholder="e.g. 週一、週三 14:00-15:50"
                            />
                        </Field>
                        <Field label="上課地點">
                            <input
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                className={s.input}
                                placeholder="e.g. 工程三館 102"
                            />
                        </Field>
                    </div>
                    <div className={s.row2}>
                        <Field
                            label="開始日期"
                            hint="學期 / 課程開始的第一天，給自動產 Lecture 1/2/3 用。"
                        >
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className={s.input}
                            />
                        </Field>
                        <Field label="結束日期" hint="學期最後一天。">
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className={s.input}
                            />
                        </Field>
                    </div>
                    <Field label="關鍵字" hint="逗號分隔，用於 RAG / 全域搜尋。">
                        <input
                            type="text"
                            value={keywords}
                            onChange={(e) => setKeywords(e.target.value)}
                            className={s.input}
                            placeholder="ML, supervised, gradient descent"
                        />
                    </Field>
                </Card>

                {/* 授課老師 */}
                <Card
                    title="授課老師"
                    eyebrow="INSTRUCTOR"
                >
                    <PersonForm
                        person={instructor}
                        onChange={updateInstructor}
                        roleLabel="老師"
                        accent={accent}
                    />
                </Card>

                {/* 助教 */}
                <Card
                    title="助教"
                    eyebrow="TEACHING ASSISTANTS"
                    actions={
                        <button type="button" onClick={addTA} className={s.smallAddBtn}>
                            + 新增助教
                        </button>
                    }
                >
                    {tas.length === 0 && (
                        <div className={s.empty}>
                            這門課暫無助教 — 按右上「+ 新增助教」加一位。
                        </div>
                    )}
                    {tas.map((ta, i) => (
                        <PersonForm
                            key={i}
                            person={ta}
                            onChange={(patch) => updateTA(i, patch)}
                            roleLabel={`TA ${i + 1}`}
                            accent={accent}
                            onRemove={() => removeTA(i)}
                        />
                    ))}
                    {tas.length > 0 && (
                        <Field
                            label="共用 TA Office Hours"
                            hint="所有助教共同的時間。個別 TA 在自己卡片內覆寫。"
                        >
                            <input
                                type="text"
                                value={taOfficeHours}
                                onChange={(e) => setTaOfficeHours(e.target.value)}
                                className={s.input}
                                placeholder="e.g. 週四 18:00-20:00 / 工程館 502"
                            />
                        </Field>
                    )}
                </Card>

                {/* 評分組成 */}
                <Card
                    title="評分組成"
                    eyebrow="GRADING"
                    actions={
                        <span
                            className={`${s.totalPct} ${Math.abs(totalPct - 100) > 0.5 ? s.totalPctWarn : ''}`}
                        >
                            合計 {totalPct}%
                        </span>
                    }
                >
                    {grading.length === 0 && (
                        <div className={s.empty}>
                            還沒有評分項目 — 按下方「+ 新增」加第一條。
                        </div>
                    )}
                    {grading.map((g, i) => (
                        <div key={i} className={s.gradingRow}>
                            <input
                                type="text"
                                value={g.item}
                                onChange={(e) => updateGrading(i, 'item', e.target.value)}
                                className={s.input}
                                placeholder="項目（e.g. 期中考）"
                            />
                            <input
                                type="text"
                                value={g.percentage}
                                onChange={(e) => updateGrading(i, 'percentage', e.target.value)}
                                className={`${s.input} ${s.inputPct}`}
                                placeholder="30%"
                            />
                            <button
                                type="button"
                                onClick={() => removeGrading(i)}
                                className={s.iconBtn}
                                aria-label="刪除這項"
                                title="刪除"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={addGrading} className={s.addBtn}>
                        + 新增評分項目
                    </button>
                </Card>

                {/* 課程堂數 */}
                <Card
                    title="課程堂數"
                    eyebrow="LECTURES"
                    actions={
                        <>
                            {canAutoGenLectures && (
                                <button
                                    type="button"
                                    onClick={autoGenLectures}
                                    className={s.smallAddBtn}
                                    title="從上課時間 + 開始/結束日期自動產出 Lecture 1, 2, ..."
                                >
                                    ⟳ 依日期自動產生
                                </button>
                            )}
                            <span className={s.countTag}>
                                {schedule.length} 堂
                            </span>
                        </>
                    }
                >
                    <p className={s.cardIntro}>
                        每一條對應一堂課（Lecture 1 / 2 / 3 …），不是「每週」。
                        一週可以有多堂，也可以一週都沒有。
                        {canAutoGenLectures && schedule.length === 0 && (
                            <>
                                {' '}
                                上面已經填了上課時間 + 起訖日期 — 按右上「⟳ 依日期自動產生」會排出占位列表。
                            </>
                        )}
                    </p>
                    {schedule.length === 0 && (
                        <div className={s.empty}>
                            還沒有 lecture 大綱 — 按下方加入第 1 堂。
                        </div>
                    )}
                    {schedule.map((row, i) => (
                        <div key={i} className={s.lectureRow}>
                            <span className={s.lectureNum} style={{ color: accent }}>
                                L{i + 1}
                            </span>
                            <input
                                type="text"
                                value={row}
                                onChange={(e) => updateSchedule(i, e.target.value)}
                                className={s.input}
                                placeholder={`Lecture ${i + 1} 主題`}
                            />
                            <button
                                type="button"
                                onClick={() => moveSchedule(i, -1)}
                                disabled={i === 0}
                                className={s.iconBtn}
                                aria-label="上移"
                                title="上移"
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                onClick={() => moveSchedule(i, 1)}
                                disabled={i === schedule.length - 1}
                                className={s.iconBtn}
                                aria-label="下移"
                                title="下移"
                            >
                                ↓
                            </button>
                            <button
                                type="button"
                                onClick={() => removeSchedule(i)}
                                className={s.iconBtn}
                                aria-label="刪除"
                                title="刪除"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={addSchedule} className={s.addBtn}>
                        + 新增 Lecture {schedule.length + 1}
                    </button>
                </Card>

                {/* Canvas 公告 RSS — 這欄是 per-course；行事曆是全域，
                    放在「個人頁 → 整合」。 */}
                <Card title="Canvas 公告" eyebrow="ANNOUNCEMENTS RSS">
                    <p className={s.cardIntro}>
                        Canvas 課程頁面右上角點「即時通知」會看到 RSS / Atom 連結，
                        貼進這裡 App 會在課程預覽的「待辦 / 提醒」區塊顯示新公告。
                        <br />
                        <span style={{ color: 'var(--h18-text-mid)' }}>
                            行事曆（作業到期 / 考試日期）是 Canvas 帳號全域的，請到
                            「個人頁 → 整合」設定一條共用的 Calendar feed。
                        </span>
                        <br />
                        <span style={{ color: 'var(--h18-accent)', fontWeight: 700 }}>
                            ※ 抓取功能 v0.7.x 後接 (Phase 2)；目前先存 URL。
                        </span>
                    </p>
                    <Field
                        label="公告 RSS"
                        hint="Course Announcements feed — 這門課自己的公告流。"
                    >
                        <input
                            type="url"
                            value={canvasAnnouncementsRss}
                            onChange={(e) => setCanvasAnnouncementsRss(e.target.value)}
                            className={s.input}
                            placeholder="https://canvas.example.edu/feeds/announcements/..."
                        />
                    </Field>
                </Card>
            </div>
        </div>
    );
}

/* ════════════════════ helpers ════════════════════ */

function Card({
    title,
    eyebrow,
    actions,
    children,
}: {
    title: string;
    eyebrow?: string;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className={s.card}>
            <div className={s.cardHead}>
                {eyebrow && <span className={s.cardEyebrow}>{eyebrow}</span>}
                <h2 className={s.cardTitle}>{title}</h2>
                <div style={{ flex: 1 }} />
                {actions}
            </div>
            <div className={s.cardBody}>{children}</div>
        </section>
    );
}

function Field({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <label className={s.field}>
            <span className={s.fieldLabel}>{label}</span>
            {children}
            {hint && <span className={s.fieldHint}>{hint}</span>}
        </label>
    );
}

function PersonForm({
    person,
    onChange,
    roleLabel,
    accent,
    onRemove,
}: {
    person: TeachingPerson;
    onChange: (patch: Partial<TeachingPerson>) => void;
    roleLabel: string;
    accent: string;
    onRemove?: () => void;
}) {
    const initial = (person.name || '?').charAt(0).toUpperCase();
    return (
        <div className={s.personCard}>
            <div className={s.personHead}>
                <div
                    className={s.personAvatar}
                    style={{ background: accent }}
                >
                    {initial}
                </div>
                <span className={s.personRole}>{roleLabel}</span>
                {onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        className={s.iconBtn}
                        aria-label="移除這位"
                        title="移除"
                        style={{ marginLeft: 'auto' }}
                    >
                        ✕
                    </button>
                )}
            </div>
            <div className={s.row2}>
                <Field label="姓名">
                    <input
                        type="text"
                        value={person.name}
                        onChange={(e) => onChange({ name: e.target.value })}
                        className={s.input}
                        placeholder="e.g. 王小明"
                    />
                </Field>
                <Field label="Email">
                    <input
                        type="email"
                        value={person.email || ''}
                        onChange={(e) => onChange({ email: e.target.value })}
                        className={s.input}
                        placeholder="e.g. wang@cs.nthu.edu.tw"
                    />
                </Field>
            </div>
            <Field
                label="Office Hours"
                hint="可留空使用共用設定（TA）或不顯示（老師）。"
            >
                <input
                    type="text"
                    value={person.office_hours || ''}
                    onChange={(e) => onChange({ office_hours: e.target.value })}
                    className={s.input}
                    placeholder="e.g. 週二 14:00-16:00 / 工程館 502"
                />
            </Field>
        </div>
    );
}
