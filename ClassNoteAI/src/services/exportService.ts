/**
 * exportService — Phase 7 Sprint 3 (S3e)
 *
 * Pure-string formatters + a high-level orchestrator that fetches lecture
 * data via storageService, opens a Tauri save dialog, and writes the result
 * via the fs plugin.
 *
 * Two formats are supported:
 *   - **SRT**: standard SubRip with optional bilingual lines (en above zh).
 *     Adjacent subtitles are chained — each entry's end-time is the next
 *     entry's start-time. The final entry gets a +3s tail since we don't
 *     know its real duration.
 *   - **Markdown**: lecture metadata block + optional summary + optional
 *     sections + optional bilingual transcript with `MM:SS` headings.
 *     Each missing piece is silently skipped so callers can pass partial
 *     `note` payloads (e.g. when the LLM summary failed).
 *
 * The service is split into pure functions (`exportLectureSRT`,
 * `exportLectureMarkdown`) and an integration entrypoint (`exportLecture`)
 * so unit tests can exercise the formatting logic without touching Tauri.
 *
 * PLAN ref: §3e (exportService) + §S3 (Markdown 範本) + §F2 (匯出格式).
 */

import { formatRelativeTime } from '../utils/subtitleTimestamp';

/** A subtitle row reduced to the bits we need for export. */
export interface ExportSubtitle {
    /** Lecture-relative seconds (float). */
    timestamp: number;
    text_en?: string;
    text_zh?: string;
}

/** Lecture metadata used in the Markdown header. */
export interface ExportLectureMeta {
    id: string;
    title: string;
    courseName?: string;
    date?: string;
    /** ms epoch when the lecture started — currently unused by the formatter
     *  but accepted on the meta type so callers don't need to strip it. */
    startedAtMs?: number;
    /** Lecture length in seconds. */
    duration?: number;
    keywords?: string[];
}

/** Note payload used by the Markdown summary + sections blocks. */
export interface ExportNote {
    summary?: string;
    sections?: Array<{ heading: string; bullets: string[] }>;
}

/** SRT export options. */
export interface ExportSRTOptions {
    /** Which language(s) to render. `'both'` (default) puts en above zh. */
    language?: 'zh' | 'en' | 'both';
}

/**
 * Build an SRT-formatted string from a sorted list of subtitles.
 *
 * Caller's responsibility: subtitles must already be sorted ascending by
 * `timestamp`. We don't sort defensively here because the storageService
 * read path already enforces order, and re-sorting would hide bugs upstream.
 */
export function exportLectureSRT(
    subtitles: ExportSubtitle[],
    options: ExportSRTOptions = {},
): string {
    const lang = options.language ?? 'both';
    const lines: string[] = [];

    subtitles.forEach((sub, i) => {
        const startSec = sub.timestamp;
        // Use next subtitle's start as this one's end. For the final
        // entry we don't know the real duration; +3s is a reasonable
        // fallback that matches typical sentence-display dwell time.
        const endSec =
            i + 1 < subtitles.length ? subtitles[i + 1].timestamp : startSec + 3;

        lines.push(String(i + 1));
        lines.push(`${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}`);

        if (lang === 'both') {
            if (sub.text_en) lines.push(sub.text_en);
            if (sub.text_zh) lines.push(sub.text_zh);
        } else if (lang === 'en') {
            if (sub.text_en) lines.push(sub.text_en);
        } else if (lang === 'zh') {
            if (sub.text_zh) lines.push(sub.text_zh);
        }

        // SRT spec: blank line between entries (and trailing blank is OK).
        lines.push('');
    });

    return lines.join('\n');
}

/** Format a relative-second value into SRT's `HH:MM:SS,mmm` format. */
function formatSrtTime(sec: number): string {
    const total = Number.isFinite(sec) ? Math.max(0, sec) : 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    const ms = Math.floor((total - Math.floor(total)) * 1000);
    return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

function pad3(n: number): string {
    return String(n).padStart(3, '0');
}

/**
 * Build a Markdown document from lecture metadata, an optional note, and an
 * optional transcript. Each block is conditional so partial inputs render
 * cleanly without empty headings.
 */
export function exportLectureMarkdown(
    lecture: ExportLectureMeta,
    note: ExportNote,
    subtitles: ExportSubtitle[],
): string {
    const lines: string[] = [];

    lines.push(`# ${lecture.title}`);
    lines.push('');

    // ----- Metadata -----
    lines.push('## 課程資訊');
    if (lecture.courseName) lines.push(`- 課程：${lecture.courseName}`);
    if (lecture.date) lines.push(`- 日期：${lecture.date}`);
    if (typeof lecture.duration === 'number' && lecture.duration > 0) {
        lines.push(`- 時長：${formatRelativeTime(lecture.duration)}`);
    }
    if (lecture.keywords && lecture.keywords.length) {
        lines.push(`- 關鍵字：${lecture.keywords.join(', ')}`);
    }
    lines.push('');

    // ----- Summary -----
    if (note.summary) {
        lines.push('## 摘要');
        lines.push('');
        lines.push(note.summary);
        lines.push('');
    }

    // ----- Sections -----
    if (note.sections && note.sections.length) {
        lines.push('## 章節');
        lines.push('');
        for (const sec of note.sections) {
            lines.push(`### ${sec.heading}`);
            for (const b of sec.bullets) {
                lines.push(`- ${b}`);
            }
            lines.push('');
        }
    }

    // ----- Bilingual transcript -----
    if (subtitles.length) {
        lines.push('## 雙語逐字稿');
        lines.push('');
        for (const sub of subtitles) {
            const ts = formatRelativeTime(sub.timestamp);
            lines.push(`### [${ts}]`);
            if (sub.text_en) lines.push(`> ${sub.text_en}`);
            if (sub.text_zh) lines.push(`> ${sub.text_zh}`);
            lines.push('');
        }
    }

    return lines.join('\n');
}

/**
 * High-level export: fetch data via storageService, prompt for a save path,
 * and write the file. Returns `null` if the user cancels the save dialog.
 *
 * Throws when the lecture id can't be resolved — caller should surface this
 * to the user (toast) rather than silently failing.
 */
export async function exportLecture(
    lectureId: string,
    format: 'srt' | 'md',
): Promise<{ path: string; size: number } | null> {
    // Dynamic imports keep this module tree-shakeable for tests that only
    // exercise the pure formatters, and avoid pulling in Tauri plugins on
    // module load.
    const { storageService } = await import('./storageService');
    const lecture = await storageService.getLecture(lectureId);
    if (!lecture) throw new Error(`Lecture ${lectureId} not found`);

    const subtitles = ((await storageService.getSubtitles?.(lectureId)) ??
        []) as ExportSubtitle[];
    const note =
        format === 'md'
            ? ((await storageService.getNote?.(lectureId)) as ExportNote | null)
            : null;

    let content: string;
    let suggestedName: string;

    if (format === 'srt') {
        content = exportLectureSRT(subtitles);
        suggestedName = `${lecture.title}.srt`;
    } else {
        // Spread `lecture` first so explicitly-set fields (id, title) on the
        // left override any same-named fields on the lecture row.
        content = exportLectureMarkdown(
            {
                ...(lecture as Partial<ExportLectureMeta>),
                id: lectureId,
                title: lecture.title,
            },
            note ?? {},
            subtitles,
        );
        suggestedName = `${lecture.title}.md`;
    }

    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });

    if (!path) return null; // user cancelled

    await writeTextFile(path, content);
    return { path, size: content.length };
}
