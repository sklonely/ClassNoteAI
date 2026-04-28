/**
 * Exam-mark store · v0.7.x
 *
 * 「⚑ 標記考點」按下時把當下時間 + 字幕原文存進 localStorage，
 * lecture-scoped。沒做 schema 變動 (subtitle.is_exam_mark) 是因為：
 *  - 標記只是給使用者複習時看的 UI hint，沒進 RAG / 摘要 pipeline
 *  - 真要進 DB 等之後 concept extraction 一起設計欄位
 *
 * 之後 Schema 化的時候，這裡的 marks 會被一次性 migrate 進 subtitle 表。
 */

const STORAGE_KEY_PREFIX = 'classnote-exam-marks-v1:';

export interface ExamMark {
    /** Seconds since recording start when 「⚑」 was pressed. */
    elapsedSec: number;
    /** Snapshot of the live transcript at the moment of marking
     *  (subtitleService.currentText). Empty string if no live text. */
    text: string;
    /** Wall-clock unix ms — for sort fallback. */
    markedAtMs: number;
    /** User-supplied label, default '考點'. */
    label?: string;
}

type Listener = (marks: ExamMark[]) => void;

const listeners = new Map<string, Set<Listener>>();

function key(lectureId: string): string {
    return `${STORAGE_KEY_PREFIX}${lectureId}`;
}

export function getExamMarks(lectureId: string): ExamMark[] {
    try {
        const raw = localStorage.getItem(key(lectureId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as ExamMark[]) : [];
    } catch {
        return [];
    }
}

function writeMarks(lectureId: string, marks: ExamMark[]): void {
    try {
        localStorage.setItem(key(lectureId), JSON.stringify(marks));
    } catch (err) {
        console.warn('[examMarksStore] persist failed:', err);
    }
    const subs = listeners.get(lectureId);
    if (subs) {
        for (const cb of subs) {
            try {
                cb(marks);
            } catch (err) {
                console.warn('[examMarksStore] listener threw:', err);
            }
        }
    }
}

export function addExamMark(lectureId: string, mark: ExamMark): void {
    const cur = getExamMarks(lectureId);
    // Dedupe within 2s window (double-press guard).
    if (
        cur.some(
            (m) => Math.abs(m.elapsedSec - mark.elapsedSec) < 2,
        )
    ) {
        return;
    }
    const next = [...cur, mark].sort((a, b) => a.elapsedSec - b.elapsedSec);
    writeMarks(lectureId, next);
}

export function removeExamMark(lectureId: string, elapsedSec: number): void {
    const cur = getExamMarks(lectureId);
    writeMarks(
        lectureId,
        cur.filter((m) => m.elapsedSec !== elapsedSec),
    );
}

export function subscribeExamMarks(
    lectureId: string,
    cb: Listener,
): () => void {
    if (!listeners.has(lectureId)) {
        listeners.set(lectureId, new Set());
    }
    listeners.get(lectureId)!.add(cb);
    return () => {
        const subs = listeners.get(lectureId);
        if (subs) {
            subs.delete(cb);
            if (subs.size === 0) listeners.delete(lectureId);
        }
    };
}
