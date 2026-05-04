/**
 * storageService syllabus-pipeline e2e tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 2
 * §storageService syllabus pipeline):
 *
 *   - saveCourseWithSyllabus({pdfData}) — IPC ordering + lifecycle:
 *       write_binary_file (PDF) → save_course (generating) →
 *       background extracts → save_course (ready)
 *   - background failure path → save_course (failed) + toast
 *   - retryCourseSyllabusGeneration with no PDF AND no description
 *     fails fast and writes a failed-state course
 *   - recoverStaleGeneratingSyllabuses honours the staleAfterMs gate
 *   - saveCourseSyllabusPdf 50 MB size guard fires BEFORE invoke
 *
 * Lifecycle helpers (getCourseSyllabusState etc.) are pure functions
 * already covered in storageService.test.ts; we focus here on the
 * orchestration that hits invoke + LLM + pdfService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
    setMockInvokeResult,
    clearMockInvokeResults,
} from '../../test/setup';
import type { Course } from '../../types';

vi.mock('../authService', () => ({
    authService: {
        getUser: vi.fn(() => ({ username: 'test_user' })),
    },
}));

vi.mock('../llm', () => ({
    extractSyllabus: vi.fn(),
}));

// pdfService is lazy-imported inside generateCourseSyllabusInBackground.
// vi.doMock OR a top-level vi.mock both work because vitest hoists vi.mock.
// We need the module path to match the dynamic import string.
vi.mock('../pdfService', () => ({
    pdfService: {
        extractText: vi.fn(() => Promise.resolve('PDF body extracted text')),
    },
}));

vi.mock('../toastService', () => ({
    toastService: {
        error: vi.fn(),
        warning: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
    },
}));

import { storageService } from '../storageService';
import { extractSyllabus } from '../llm';
import { toastService } from '../toastService';

const mockedExtractSyllabus = vi.mocked(extractSyllabus);
const mockedToast = vi.mocked(toastService);

function makeCourse(overrides: Partial<Course> = {}): Course {
    return {
        id: 'course-1',
        user_id: 'test_user',
        title: 'Physics 101',
        description: '',
        keywords: '',
        syllabus_info: undefined,
        is_deleted: false,
        created_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z',
        ...overrides,
    };
}

beforeEach(() => {
    clearMockInvokeResults();
    vi.clearAllMocks();
    // Sensible defaults for invoke commands the pipeline touches.
    setMockInvokeResult('get_app_data_dir', '/fake/appdata');
    setMockInvokeResult('write_binary_file', undefined);
    setMockInvokeResult('save_course', undefined);
    setMockInvokeResult('list_courses', []);
});

describe('saveCourseWithSyllabus — happy path with pdfData', () => {
    it('writes PDF, saves generating-state course, then in bg saves ready-state course', async () => {
        mockedExtractSyllabus.mockResolvedValue({ topic: 'Newtonian mechanics' });
        const course = makeCourse({ description: 'short' });
        const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

        // Capture get_course mock for the bg refresh step.
        setMockInvokeResult('get_course', course);

        await storageService.saveCourseWithSyllabus(course, {
            pdfData,
            triggerSyllabusGeneration: true,
        });

        // Foreground assertions: PDF write + initial generating save.
        const calls = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
        expect(calls).toContain('write_binary_file');
        expect(calls).toContain('save_course');

        // The first save_course payload should carry generating state.
        const firstSave = vi.mocked(invoke).mock.calls.find(
            ([cmd]) => cmd === 'save_course',
        )!;
        const savedCourse = (firstSave[1] as { course: Course }).course;
        const meta = savedCourse.syllabus_info as Record<string, unknown> | undefined;
        expect(meta?.['_classnote_status']).toBe('generating');

        // Wait for background task to finish; final save_course should be 'ready'.
        await new Promise((r) => setTimeout(r, 30));
        const readyCall = vi.mocked(invoke).mock.calls.find(
            ([cmd, args]) => {
                if (cmd !== 'save_course') return false;
                const c = (args as { course: Course }).course;
                const m = c.syllabus_info as Record<string, unknown> | undefined;
                return m?.['_classnote_status'] === 'ready';
            },
        );
        expect(readyCall).toBeTruthy();
        expect(mockedExtractSyllabus).toHaveBeenCalledTimes(1);
    });
});

describe('saveCourseWithSyllabus — background failure path', () => {
    it('writes failed state + fires toast when extractSyllabus throws', async () => {
        mockedExtractSyllabus.mockRejectedValue(new Error('rate limit'));
        const course = makeCourse({ description: 'short' });
        const pdfData = new ArrayBuffer(4);
        setMockInvokeResult('get_course', course);

        await storageService.saveCourseWithSyllabus(course, {
            pdfData,
            triggerSyllabusGeneration: true,
        });

        await new Promise((r) => setTimeout(r, 30));

        const failedCall = vi.mocked(invoke).mock.calls.find(([cmd, args]) => {
            if (cmd !== 'save_course') return false;
            const c = (args as { course: Course }).course;
            const m = c.syllabus_info as Record<string, unknown> | undefined;
            return m?.['_classnote_status'] === 'failed';
        });
        expect(failedCall).toBeTruthy();
        const failedCourse = (failedCall![1] as { course: Course }).course;
        const meta = failedCourse.syllabus_info as Record<string, unknown>;
        expect(meta['_classnote_error_message']).toContain('rate limit');
        // Production toast signature evolved to (title, description, action?).
        // Match title + description, ignore the navRequest action object.
        expect(mockedToast.error).toHaveBeenCalledWith(
            '課程大綱生成失敗',
            expect.stringContaining('rate limit'),
            expect.objectContaining({ label: '重新生成' }),
        );
    });
});

describe('saveCourseSyllabusPdf — 50 MB size guard', () => {
    it('throws BEFORE invoking write_binary_file when payload exceeds 50 MB', async () => {
        const huge = new ArrayBuffer(50 * 1024 * 1024 + 1);
        await expect(
            storageService.saveCourseSyllabusPdf('course-X', huge),
        ).rejects.toThrow(/50 MB/);

        // Should NOT have hit the IPC layer at all.
        const writeCalls = vi.mocked(invoke).mock.calls.filter(
            ([cmd]) => cmd === 'write_binary_file',
        );
        expect(writeCalls).toHaveLength(0);
    });

    it('accepts a 5 MB payload and forwards to write_binary_file', async () => {
        const ok = new ArrayBuffer(5 * 1024 * 1024);
        await expect(
            storageService.saveCourseSyllabusPdf('course-X', ok),
        ).resolves.toMatch(/courses/);
        const writeCalls = vi.mocked(invoke).mock.calls.filter(
            ([cmd]) => cmd === 'write_binary_file',
        );
        expect(writeCalls).toHaveLength(1);
    });
});

describe('retryCourseSyllabusGeneration', () => {
    it('throws when courseId does not exist', async () => {
        setMockInvokeResult('get_course', null);
        await expect(
            storageService.retryCourseSyllabusGeneration('missing-id'),
        ).rejects.toThrow(/找不到課程/);
    });

    it('writes failed-state when course has neither PDF on disk nor description', async () => {
        // get_course returns the course; read_binary_file (the PDF probe)
        // rejects → no PDF; description is empty → bg task should fail
        // fast with the "沒有可用的課程 PDF 或課程描述" message.
        const course = makeCourse({ description: '' });
        setMockInvokeResult('get_course', course);
        setMockInvokeResult(
            'read_binary_file',
            new Error('ENOENT'),
        );

        await storageService.retryCourseSyllabusGeneration('course-1');
        // forceRegenerate fires bg task synchronously after the foreground
        // save_course; let the bg task settle.
        await new Promise((r) => setTimeout(r, 30));

        const failedCall = vi.mocked(invoke).mock.calls.find(([cmd, args]) => {
            if (cmd !== 'save_course') return false;
            const c = (args as { course: Course }).course;
            const m = c.syllabus_info as Record<string, unknown> | undefined;
            return m?.['_classnote_status'] === 'failed';
        });
        expect(failedCall).toBeTruthy();
        const meta = (failedCall![1] as { course: Course }).course.syllabus_info as Record<string, unknown>;
        expect(meta['_classnote_error_message']).toMatch(/沒有可用的課程/);
    });
});

describe('recoverStaleGeneratingSyllabuses', () => {
    it('flips a course whose generating timestamp is older than the gate', async () => {
        const stale = makeCourse({
            id: 'stale',
            syllabus_info: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                _classnote_status: 'generating',
                // 11 minutes ago — > default 10 min gate
                _classnote_updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        });
        setMockInvokeResult('list_courses', [stale]);

        await storageService.recoverStaleGeneratingSyllabuses();

        const failedCall = vi.mocked(invoke).mock.calls.find(([cmd, args]) => {
            if (cmd !== 'save_course') return false;
            const c = (args as { course: Course }).course;
            return c.id === 'stale';
        });
        expect(failedCall).toBeTruthy();
        const meta = (failedCall![1] as { course: Course }).course.syllabus_info as Record<string, unknown>;
        expect(meta['_classnote_status']).toBe('failed');
        expect(meta['_classnote_error_message']).toMatch(/上次生成中斷/);
    });

    it('leaves alone a course whose generating timestamp is fresh', async () => {
        const fresh = makeCourse({
            id: 'fresh',
            syllabus_info: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                _classnote_status: 'generating',
                // 30 seconds ago — well under gate
                _classnote_updated_at: new Date(Date.now() - 30 * 1000).toISOString(),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        });
        setMockInvokeResult('list_courses', [fresh]);

        await storageService.recoverStaleGeneratingSyllabuses();

        // No save_course should fire for "fresh".
        const saveCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'save_course');
        expect(saveCalls).toHaveLength(0);
    });

    it('recovers a generating course with malformed timestamp (defensive)', async () => {
        const broken = makeCourse({
            id: 'broken',
            syllabus_info: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                _classnote_status: 'generating',
                _classnote_updated_at: 'not-a-timestamp',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        });
        setMockInvokeResult('list_courses', [broken]);

        await storageService.recoverStaleGeneratingSyllabuses();

        const failedCall = vi.mocked(invoke).mock.calls.find(([cmd, args]) => {
            if (cmd !== 'save_course') return false;
            const c = (args as { course: Course }).course;
            return c.id === 'broken';
        });
        // Better to recover than to leave stuck — assert recovery fired.
        expect(failedCall).toBeTruthy();
    });

    it('does not touch courses that are not generating', async () => {
        const ready = makeCourse({
            id: 'ready',
            syllabus_info: { topic: 'Physics' },
        });
        const idle = makeCourse({ id: 'idle', syllabus_info: undefined });
        setMockInvokeResult('list_courses', [ready, idle]);

        await storageService.recoverStaleGeneratingSyllabuses();

        const saveCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'save_course');
        expect(saveCalls).toHaveLength(0);
    });
});
