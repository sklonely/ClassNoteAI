/**
 * LectureEditDialog · Phase 7 Sprint 3 Round 2 (S3c-2)
 *
 * 編輯 lecture metadata：標題 / 日期 / 所屬課程 / 關鍵字。
 * 對應 PHASE-7-PLAN.md §3c (line 211-225) + F1A + S7 + S8。
 *
 * 觸發點：
 *   - ReviewPage hero ✎ button (S8) — 本 sprint 接
 *   - 右鍵 menu「編輯」(F3, S3d) — 之後 sub-agent 接
 *
 * 行為注意 (對齊 H18-MODAL-CONVENTIONS)：
 *   - role="dialog" + aria-modal="true" + aria-labelledby
 *   - Esc 關 modal；如果 DayPicker popover 開著 → Esc 只關 popover
 *     (透過 showDayPicker guard，先關 popover 再下一次 Esc 關 modal)
 *   - 點 scrim 關 modal
 *   - 開啟時 focus 落第一個 input (title)
 *   - submit 失敗不關 dialog（讓 caller 顯示 toast / 修正後重試）
 *   - 改 course_id 視為「移動 lecture」(S7)；caller 收到後可自行
 *     發 nav 到新 course。
 *
 * 關鍵字 schema (相容 Lecture.keywords)：
 *   - DB 是逗號分隔字串 (e.g. 'kw-a, kw-b')
 *   - Dialog 內部用 string[]，submit 時透過 `keywords` array 回吐，
 *     由 caller 決定怎麼 join 寫進 DB。
 */

import {
    useEffect,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { H18DayPicker } from './H18DayPicker';
import type { Course, Lecture } from '../../types';
import s from './LectureEditDialog.module.css';

export interface LectureEditDialogProps {
    isOpen: boolean;
    lecture: Lecture;
    /** 給 course dropdown 用。改 course_id = 移動 lecture (S7)。 */
    courses: Course[];
    onClose: () => void;
    onSubmit: (updates: {
        title: string;
        date: string;            // YYYY-MM-DD
        course_id: string;
        keywords: string[];
    }) => Promise<void>;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function formatYMD(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatToday(): string {
    return formatYMD(new Date());
}

/**
 * Lecture.keywords (DB) 是逗號分隔字串；dialog 內部用陣列。
 * 接受空字串 / undefined / 含空白的逗號 → 都安全 normalize。
 */
function parseKeywords(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(/[,，、]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
}

/**
 * 把 lecture.date (ISO 字串，可能是 YYYY-MM-DD 也可能是完整 ISO) 轉成
 * YYYY-MM-DD。空 → 今天。
 */
function normalizeDate(raw: string | undefined): string {
    if (!raw) return formatToday();
    // YYYY-MM-DD prefix 直接拿
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    if (m) return m[1];
    // fallback：parse 成 Date 再 format
    try {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) return formatYMD(d);
    } catch {
        /* swallow */
    }
    return formatToday();
}

export function LectureEditDialog({
    isOpen,
    lecture,
    courses,
    onClose,
    onSubmit,
}: LectureEditDialogProps) {
    const [title, setTitle] = useState<string>(lecture.title);
    const [dateStr, setDateStr] = useState<string>(() => normalizeDate(lecture.date));
    const [courseId, setCourseId] = useState<string>(lecture.course_id);
    const [keywords, setKeywords] = useState<string[]>(() => parseKeywords(lecture.keywords));
    const [keywordInput, setKeywordInput] = useState<string>('');
    const [showDayPicker, setShowDayPicker] = useState<boolean>(false);
    const [submitting, setSubmitting] = useState<boolean>(false);

    // Reset form when lecture identity changes (or modal re-opens with a
    // different lecture). We key off lecture.id so editing the same lecture
    // doesn't blow away in-flight edits.
    useEffect(() => {
        setTitle(lecture.title);
        setDateStr(normalizeDate(lecture.date));
        setCourseId(lecture.course_id);
        setKeywords(parseKeywords(lecture.keywords));
        setKeywordInput('');
        setShowDayPicker(false);
        setSubmitting(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lecture.id]);

    // Esc 關 modal（如果 DayPicker popover 開著就先關 popover；下次 Esc
    // 才關 modal — 對齊 H18-MODAL-CONVENTIONS §3）。
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (showDayPicker) {
                e.stopPropagation();
                setShowDayPicker(false);
                return;
            }
            e.stopPropagation();
            onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, showDayPicker, onClose]);

    // Initial focus → title input (對齊 H18-MODAL-CONVENTIONS §4 first input)
    const titleRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (isOpen) {
            // microtask defer 避免 React 18 strict mode 雙 mount 期間
            // ref 還沒指到的 race；用 requestAnimationFrame 太晚會被
            // 後續 layout flush 攔走 focus。
            queueMicrotask(() => titleRef.current?.focus());
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleAddKeyword = () => {
        const k = keywordInput.trim();
        if (!k) return;
        if (keywords.includes(k)) {
            setKeywordInput('');
            return;
        }
        setKeywords([...keywords, k]);
        setKeywordInput('');
    };

    const handleRemoveKeyword = (k: string) => {
        setKeywords(keywords.filter((x) => x !== k));
    };

    const handleKeywordKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
            e.preventDefault();
            handleAddKeyword();
        } else if (e.key === 'Backspace' && !keywordInput && keywords.length > 0) {
            // backspace on empty input → pop last chip (matching AddCourseDialog UX)
            setKeywords(keywords.slice(0, -1));
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (submitting) return;
        const trimmedTitle = title.trim();
        if (!trimmedTitle) return;

        setSubmitting(true);
        try {
            await onSubmit({
                title: trimmedTitle,
                date: dateStr,
                course_id: courseId,
                keywords,
            });
            onClose();
        } catch (err) {
            // Caller 應該顯示 toast；這邊只 log 並保持 dialog 開著讓
            // 使用者可以修正 / 重試。
            console.error('[LectureEditDialog] submit failed:', err);
        } finally {
            setSubmitting(false);
        }
    };

    const titleId = 'lecture-edit-title';

    const titleInputId = 'lecture-edit-title-input';
    const dateBtnId = 'lecture-edit-date-btn';
    const courseSelectId = 'lecture-edit-course-select';
    const keywordInputId = 'lecture-edit-keyword-input';

    return (
        <div
            className={s.scrim}
            onClick={(e) => {
                // 只在點 scrim 本身（不是 dialog card 或內部元素）時才關
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <form
                className={s.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onSubmit={handleSubmit}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id={titleId} className={s.title}>編輯課堂</h2>

                <div className={s.field}>
                    <label htmlFor={titleInputId} className={s.fieldLabel}>標題</label>
                    <input
                        id={titleInputId}
                        ref={titleRef}
                        type="text"
                        className={s.input}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        autoComplete="off"
                        required
                    />
                </div>

                <div className={s.field}>
                    <span id={dateBtnId} className={s.fieldLabel}>日期</span>
                    <button
                        type="button"
                        className={s.dateBtn}
                        onClick={() => setShowDayPicker((v) => !v)}
                        aria-haspopup="dialog"
                        aria-expanded={showDayPicker}
                        aria-label={dateStr}
                    >
                        {dateStr}
                    </button>
                    {showDayPicker && (
                        <div className={s.popoverWrap}>
                            <H18DayPicker
                                value={dateStr ? new Date(dateStr) : null}
                                onChange={(d) => {
                                    setDateStr(formatYMD(d));
                                    setShowDayPicker(false);
                                }}
                            />
                        </div>
                    )}
                </div>

                <div className={s.field}>
                    <label htmlFor={courseSelectId} className={s.fieldLabel}>課程</label>
                    <select
                        id={courseSelectId}
                        className={s.select}
                        value={courseId}
                        onChange={(e) => setCourseId(e.target.value)}
                    >
                        {courses.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.title}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={s.field}>
                    <label htmlFor={keywordInputId} className={s.fieldLabel}>關鍵字</label>
                    <div className={s.keywordRow}>
                        <input
                            id={keywordInputId}
                            type="text"
                            className={s.input}
                            value={keywordInput}
                            onChange={(e) => setKeywordInput(e.target.value)}
                            onKeyDown={handleKeywordKeyDown}
                            placeholder="輸入後 Enter 新增"
                        />
                        <button
                            type="button"
                            className={s.addBtn}
                            onClick={handleAddKeyword}
                            disabled={!keywordInput.trim()}
                        >
                            新增
                        </button>
                    </div>
                    {keywords.length > 0 && (
                        <div className={s.keywordChips}>
                            {keywords.map((k) => (
                                <span key={k} className={s.chip}>
                                    {k}
                                    <button
                                        type="button"
                                        className={s.chipClose}
                                        onClick={() => handleRemoveKeyword(k)}
                                        aria-label={`刪除 ${k}`}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <div className={s.footer}>
                    <button
                        type="button"
                        className={s.btnGhost}
                        onClick={onClose}
                    >
                        取消
                    </button>
                    <button
                        type="submit"
                        className={s.btnPrimary}
                        disabled={submitting || !title.trim()}
                    >
                        {submitting ? '儲存中…' : '儲存'}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default LectureEditDialog;
