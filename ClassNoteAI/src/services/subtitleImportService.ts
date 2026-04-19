import { invoke } from '@tauri-apps/api/core';
import { storageService } from './storageService';
import { ragService } from './ragService';
import type { Subtitle } from '../types';

/**
 * v0.6.0 — companion to videoImportService for the case where the
 * course platform blocks video download but lets users copy the
 * captions. The user pastes SRT / VTT / plain text and we produce the
 * same `subtitles` + RAG-index artifacts that videoImport produces,
 * minus the `video_path`. AI 助教 can then treat the lecture as if
 * it had a normal recording.
 *
 * We deliberately accept three formats in one textarea rather than a
 * file upload: users copy from a caption side-panel in the course
 * player, which is usually just text in their clipboard — never a file
 * on disk. Auto-detect on paste contents: `-->` anywhere means
 * SRT/VTT, otherwise plain text.
 */

export type PasteStage =
    | 'parsing'
    | 'translating'
    | 'saving'
    | 'indexing'
    | 'done';

export interface PasteProgress {
    stage: PasteStage;
    message: string;
}

export type SubtitleLanguage = 'en' | 'zh';

export interface PasteOptions {
    /** Language of the pasted text. en → save as text_en, optionally
     *  translate to Chinese. zh → save as text_zh, skip translation. */
    language: SubtitleLanguage;
    /** When language='en', run CT2 batch-translate to populate text_zh. */
    translateToChinese: boolean;
    onProgress?: (p: PasteProgress) => void;
}

export interface ParsedCue {
    text: string;
    startMs: number;
    endMs: number;
}

/**
 * Parse one of: SRT, VTT, or plain text into timed cues.
 *
 * - SRT: `HH:MM:SS,SSS --> HH:MM:SS,SSS`
 * - VTT: `HH:MM:SS.SSS --> HH:MM:SS.SSS` (plus optional `WEBVTT` header)
 * - Plain text: split on blank lines, assign fake timestamps 4s apart
 *   starting from 0 so each paragraph still has a stable ordering.
 *   Real timestamps are unavailable so playback-sync won't work, but
 *   the transcript/RAG/notes flow all still work.
 */
export function parseSubtitleInput(raw: string): ParsedCue[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (trimmed.includes('-->')) {
        return parseTimestamped(trimmed);
    }
    return parsePlainText(trimmed);
}

function parseTimestamped(input: string): ParsedCue[] {
    // Strip optional WEBVTT header + any NOTE blocks.
    const stripped = input
        .replace(/^WEBVTT[^\n]*\n/i, '')
        .replace(/^NOTE[\s\S]*?(?:\n\s*\n|$)/gim, '');

    const blocks = stripped.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const cues: ParsedCue[] = [];

    // Matches both SRT (,) and VTT (.) fractional-second separators,
    // and optional hours.
    const TS = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

    for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        // Skip optional numeric sequence line (SRT style).
        let idx = 0;
        if (lines[0] && /^\d+$/.test(lines[0].trim())) idx = 1;
        if (idx >= lines.length) continue;

        const m = lines[idx].match(TS);
        if (!m) continue;

        const startMs = tsToMs(m[1], m[2], m[3], m[4]);
        const endMs = tsToMs(m[5], m[6], m[7], m[8]);
        const text = lines
            .slice(idx + 1)
            .join(' ')
            // Strip VTT inline speaker tags and simple HTML from some
            // exporters (Coursera / YouTube).
            .replace(/<[^>]+>/g, '')
            .trim();
        if (!text) continue;
        cues.push({ text, startMs, endMs });
    }
    return cues;
}

function tsToMs(h: string | undefined, m: string, s: string, ms: string): number {
    const hours = h ? parseInt(h, 10) : 0;
    const mins = parseInt(m, 10);
    const secs = parseInt(s, 10);
    // SRT uses 3-digit ms; VTT allows 1-3. Pad so "5" → 500, not 5.
    const fracMs = parseInt(ms.padEnd(3, '0').slice(0, 3), 10);
    return ((hours * 3600 + mins * 60 + secs) * 1000) + fracMs;
}

/**
 * Plain text → paragraph-per-cue. Paragraphs are separated by blank
 * lines; single newlines within a paragraph are joined with a space so
 * copy-paste from PDFs / web captions that hard-wrap at ~80 chars
 * doesn't produce garbage. Fake timestamps 4 s apart keep the UI
 * ordering stable but aren't real.
 */
function parsePlainText(input: string): ParsedCue[] {
    const paragraphs = input
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
        .filter(Boolean);
    return paragraphs.map((text, i) => ({
        text,
        startMs: i * 4000,
        endMs: i * 4000 + 4000,
    }));
}

export const subtitleImportService = {
    /** Full pipeline: parse → optional translate → save → RAG index → mark lecture completed. */
    async importPasted(
        lectureId: string,
        rawText: string,
        options: PasteOptions,
    ): Promise<{ segmentCount: number }> {
        const emit = (p: PasteProgress) => options.onProgress?.(p);

        emit({ stage: 'parsing', message: '解析字幕…' });
        const cues = parseSubtitleInput(rawText);
        if (cues.length === 0) {
            throw new Error('沒有解析到任何字幕內容。請確認貼上的文字非空。');
        }

        // Translate only when source is English AND user asked for it.
        // Chinese source skips translation entirely (the existing
        // translate_ct2_batch is English→Chinese only).
        let translations: string[] = new Array(cues.length).fill('');
        if (options.language === 'en' && options.translateToChinese) {
            emit({
                stage: 'translating',
                message: `翻譯 ${cues.length} 段字幕…`,
            });
            const texts = cues.map((c) => c.text);
            const BATCH = 64;
            for (let i = 0; i < texts.length; i += BATCH) {
                const slice = texts.slice(i, i + BATCH);
                try {
                    const translated = await invoke<string[]>('translate_ct2_batch', { texts: slice });
                    for (let j = 0; j < slice.length; j++) {
                        translations[i + j] = translated[j] ?? '';
                    }
                } catch (err) {
                    // Same graceful degradation as videoImportService.
                    console.warn('[subtitleImport] batch translate failed:', err);
                    for (let j = 0; j < slice.length; j++) translations[i + j] = '';
                }
            }
        }

        emit({ stage: 'saving', message: '儲存字幕…' });
        const nowIso = new Date().toISOString();
        const subtitles: Subtitle[] = cues.map((cue, idx) => {
            const isEn = options.language === 'en';
            return {
                id: crypto.randomUUID(),
                lecture_id: lectureId,
                timestamp: cue.startMs / 1000,
                text_en: isEn ? cue.text : '',
                text_zh: isEn ? (translations[idx] || undefined) : cue.text,
                // Pasted captions came from a human-written source on the
                // course platform — treat as fine rather than rough.
                type: 'fine',
                confidence: undefined,
                created_at: nowIso,
            };
        });
        await storageService.saveSubtitles(subtitles);

        const lecture = await storageService.getLecture(lectureId);
        if (lecture) {
            const lastEndMs = cues[cues.length - 1].endMs;
            await storageService.saveLecture({
                ...lecture,
                duration: Math.max(lecture.duration, Math.round(lastEndMs / 1000)),
                status: 'completed',
                updated_at: new Date().toISOString(),
            });
        }

        emit({ stage: 'indexing', message: '建立 AI 助教索引…' });
        const transcriptText = subtitles
            .map((s) => s.text_zh || s.text_en)
            .filter(Boolean)
            .join('\n');
        await ragService.indexLecture(lectureId, null, transcriptText);

        emit({ stage: 'done', message: '完成' });
        return { segmentCount: cues.length };
    },
};
