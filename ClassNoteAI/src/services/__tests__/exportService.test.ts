/**
 * exportService — Phase 7 Sprint 3 (S3e)
 *
 * Coverage:
 *   - exportLectureSRT: empty / single / multi / bilingual / language option /
 *     fractional seconds / hours overflow
 *   - exportLectureMarkdown: full sections / missing summary / missing sections /
 *     missing transcript / keywords / duration formatting
 *   - exportLecture: integration with mocked storageService + dialog/fs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    exportLectureSRT,
    exportLectureMarkdown,
    exportLecture,
    type ExportSubtitle,
    type ExportLectureMeta,
    type ExportNote,
} from '../exportService';

// Mock storageService — exportLecture dynamically imports it
vi.mock('../storageService', () => ({
    storageService: {
        getLecture: vi.fn(),
        getSubtitles: vi.fn(),
        getNote: vi.fn(),
    },
}));

import { storageService } from '../storageService';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

describe('exportService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ===== exportLectureSRT =====
    describe('exportLectureSRT', () => {
        it('returns empty string for 0 subtitles', () => {
            expect(exportLectureSRT([])).toBe('');
        });

        it('emits valid block for a single subtitle', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 0, text_en: 'Hello', text_zh: '你好' },
            ];
            const out = exportLectureSRT(subs);
            // sequence number, time arrow, both text lines, blank line
            expect(out).toContain('1\n');
            expect(out).toContain('00:00:00,000 --> 00:00:03,000');
            expect(out).toContain('Hello');
            expect(out).toContain('你好');
            // ends with trailing blank-line separator
            expect(out.endsWith('\n')).toBe(true);
        });

        it('renders sequence numbers + chained timestamps for multiple subs', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 0, text_en: 'A' },
                { timestamp: 5, text_en: 'B' },
                { timestamp: 10, text_en: 'C' },
            ];
            const out = exportLectureSRT(subs);
            const lines = out.split('\n');
            // sequence numbers present in order
            expect(lines).toContain('1');
            expect(lines).toContain('2');
            expect(lines).toContain('3');
            // chained timestamps: i ends where i+1 starts
            expect(out).toContain('00:00:00,000 --> 00:00:05,000');
            expect(out).toContain('00:00:05,000 --> 00:00:10,000');
            // last sub has no successor → +3s tail
            expect(out).toContain('00:00:10,000 --> 00:00:13,000');
        });

        it('renders both languages on separate lines (default)', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 0, text_en: 'Hello', text_zh: '你好' },
            ];
            const out = exportLectureSRT(subs);
            const block = out.split('\n');
            // text_en line should be immediately after timestamp line, then text_zh
            const arrowIdx = block.findIndex((l) => l.includes('-->'));
            expect(block[arrowIdx + 1]).toBe('Hello');
            expect(block[arrowIdx + 2]).toBe('你好');
        });

        it('renders only text_zh when text_en is missing', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 0, text_zh: '只有中文' },
            ];
            const out = exportLectureSRT(subs);
            expect(out).toContain('只有中文');
            // ensure no stray empty lang line — between arrow and blank trailer
            // we should have exactly one text line
            const lines = out.split('\n');
            const arrowIdx = lines.findIndex((l) => l.includes('-->'));
            expect(lines[arrowIdx + 1]).toBe('只有中文');
            expect(lines[arrowIdx + 2]).toBe('');
        });

        it('respects options.language="en" (suppresses zh)', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 0, text_en: 'Hello', text_zh: '你好' },
            ];
            const out = exportLectureSRT(subs, { language: 'en' });
            expect(out).toContain('Hello');
            expect(out).not.toContain('你好');
        });

        it('respects options.language="zh" (suppresses en)', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 0, text_en: 'Hello', text_zh: '你好' },
            ];
            const out = exportLectureSRT(subs, { language: 'zh' });
            expect(out).toContain('你好');
            expect(out).not.toContain('Hello');
        });

        it('formats fractional seconds with millisecond precision', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 12.345, text_en: 'A' },
                { timestamp: 15.678, text_en: 'B' },
            ];
            const out = exportLectureSRT(subs);
            expect(out).toContain('00:00:12,345 --> 00:00:15,678');
        });

        it('formats timestamps over 1 hour correctly', () => {
            const subs: ExportSubtitle[] = [
                { timestamp: 3600, text_en: 'one hour mark' },
            ];
            const out = exportLectureSRT(subs);
            expect(out).toContain('01:00:00,000 --> 01:00:03,000');
        });
    });

    // ===== exportLectureMarkdown =====
    describe('exportLectureMarkdown', () => {
        const baseLecture: ExportLectureMeta = {
            id: 'lec-1',
            title: 'Linear Algebra L1',
            courseName: 'MATH101',
            date: '2026-04-28',
            duration: 125, // 2:05
            keywords: ['vector', 'matrix'],
        };

        it('emits all sections when fully populated', () => {
            const note: ExportNote = {
                summary: 'Today we covered vectors.',
                sections: [
                    { heading: 'Intro', bullets: ['What is a vector', 'Notation'] },
                    { heading: 'Operations', bullets: ['Addition', 'Scalar multiply'] },
                ],
            };
            const subs: ExportSubtitle[] = [
                { timestamp: 0, text_en: 'Hello', text_zh: '你好' },
                { timestamp: 65, text_en: 'A vector is...', text_zh: '向量是...' },
            ];

            const out = exportLectureMarkdown(baseLecture, note, subs);

            expect(out).toContain('# Linear Algebra L1');
            // metadata
            expect(out).toContain('## 課程資訊');
            expect(out).toContain('- 課程：MATH101');
            expect(out).toContain('- 日期：2026-04-28');
            expect(out).toContain('- 時長：02:05');
            expect(out).toContain('- 關鍵字：vector, matrix');
            // summary
            expect(out).toContain('## 摘要');
            expect(out).toContain('Today we covered vectors.');
            // sections
            expect(out).toContain('## 章節');
            expect(out).toContain('### Intro');
            expect(out).toContain('- What is a vector');
            expect(out).toContain('### Operations');
            expect(out).toContain('- Scalar multiply');
            // transcript
            expect(out).toContain('## 雙語逐字稿');
            expect(out).toContain('### [00:00]');
            expect(out).toContain('> Hello');
            expect(out).toContain('> 你好');
            expect(out).toContain('### [01:05]');
        });

        it('skips summary section when summary is missing', () => {
            const out = exportLectureMarkdown(baseLecture, {}, []);
            expect(out).not.toContain('## 摘要');
        });

        it('skips sections when none provided', () => {
            const out = exportLectureMarkdown(
                baseLecture,
                { summary: 'short' },
                [],
            );
            expect(out).not.toContain('## 章節');
        });

        it('skips transcript when 0 subtitles', () => {
            const out = exportLectureMarkdown(baseLecture, { summary: 'x' }, []);
            expect(out).not.toContain('## 雙語逐字稿');
        });

        it('joins keywords with comma + space', () => {
            const out = exportLectureMarkdown(
                { ...baseLecture, keywords: ['a', 'b', 'c'] },
                {},
                [],
            );
            expect(out).toContain('- 關鍵字：a, b, c');
        });

        it('formats duration via formatRelativeTime (MM:SS)', () => {
            // 65 seconds → 01:05
            const out = exportLectureMarkdown(
                { ...baseLecture, duration: 65 },
                {},
                [],
            );
            expect(out).toContain('- 時長：01:05');
        });

        it('omits optional metadata fields when undefined', () => {
            const minimal: ExportLectureMeta = {
                id: 'x',
                title: 'Bare',
            };
            const out = exportLectureMarkdown(minimal, {}, []);
            expect(out).toContain('# Bare');
            expect(out).not.toContain('- 課程：');
            expect(out).not.toContain('- 日期：');
            expect(out).not.toContain('- 時長：');
            expect(out).not.toContain('- 關鍵字：');
        });
    });

    // ===== exportLecture (integration) =====
    describe('exportLecture', () => {
        it('exports SRT via storageService + dialog/fs', async () => {
            (storageService.getLecture as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                id: 'lec-1',
                title: 'Test Lecture',
                duration: 60,
            });
            (storageService.getSubtitles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
                { timestamp: 0, text_en: 'Hello' },
            ]);
            (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/tmp/Test Lecture.srt');

            const result = await exportLecture('lec-1', 'srt');

            expect(result).not.toBeNull();
            expect(result!.path).toBe('/tmp/Test Lecture.srt');
            expect(result!.size).toBeGreaterThan(0);
            // dialog called with correct filter
            expect(save).toHaveBeenCalledWith(
                expect.objectContaining({
                    defaultPath: 'Test Lecture.srt',
                    filters: expect.arrayContaining([
                        expect.objectContaining({ extensions: ['srt'] }),
                    ]),
                }),
            );
            // writeTextFile called with the SRT content
            expect(writeTextFile).toHaveBeenCalledWith(
                '/tmp/Test Lecture.srt',
                expect.stringContaining('00:00:00,000 -->'),
            );
        });

        it('exports Markdown including note when format=md', async () => {
            (storageService.getLecture as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                id: 'lec-1',
                title: 'MD Lecture',
                duration: 60,
            });
            (storageService.getSubtitles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
            (storageService.getNote as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                summary: 'A summary',
                sections: [{ heading: 'H', bullets: ['b1'] }],
            });
            (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/tmp/MD Lecture.md');

            const result = await exportLecture('lec-1', 'md');

            expect(result).not.toBeNull();
            expect(storageService.getNote).toHaveBeenCalledWith('lec-1');
            const writeCall = (writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(writeCall[0]).toBe('/tmp/MD Lecture.md');
            expect(writeCall[1]).toContain('# MD Lecture');
            expect(writeCall[1]).toContain('A summary');
            expect(writeCall[1]).toContain('### H');
        });

        it('returns null when user cancels save dialog', async () => {
            (storageService.getLecture as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                id: 'lec-1',
                title: 'Test',
                duration: 0,
            });
            (storageService.getSubtitles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
            (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

            const result = await exportLecture('lec-1', 'srt');

            expect(result).toBeNull();
            expect(writeTextFile).not.toHaveBeenCalled();
        });

        it('throws when lecture not found', async () => {
            (storageService.getLecture as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

            await expect(exportLecture('missing-id', 'srt')).rejects.toThrow(
                /Lecture missing-id not found/,
            );
            expect(save).not.toHaveBeenCalled();
            expect(writeTextFile).not.toHaveBeenCalled();
        });

        it('does not call getNote when format=srt', async () => {
            (storageService.getLecture as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                id: 'lec-1',
                title: 'Test',
                duration: 0,
            });
            (storageService.getSubtitles as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
            (save as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/tmp/Test.srt');

            await exportLecture('lec-1', 'srt');

            expect(storageService.getNote).not.toHaveBeenCalled();
        });
    });
});
