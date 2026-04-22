/**
 * StorageService Unit Tests
 * 
 * Tests the frontend data access layer by mocking Tauri invoke calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { setMockInvokeResult, clearMockInvokeResults } from '../../test/setup';

// We re-mock authService since storageService uses it
vi.mock('../authService', () => ({
    authService: {
        getUser: vi.fn(() => ({ id: 'test_user', username: 'test_user' })),
        getCurrentUserId: vi.fn(() => 'test_user'),
        isLoggedIn: vi.fn(() => true),
    },
}));

// Import after mocking
import {
    storageService,
    getCourseSyllabusState,
    getCourseSyllabusFailureReason,
} from '../storageService';
import type { AppSettings, Course, Lecture, Subtitle } from '../../types';

describe('StorageService', () => {
    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
    });

    // ===== Course Tests =====
    describe('Course Operations', () => {
        it('should save course by calling invoke with save_course', async () => {
            const mockCourse: Course = {
                id: 'course-1',
                user_id: 'test_user',
                title: 'Test Course',
                description: 'Description',
                keywords: 'key1, key2',
                syllabus_info: undefined,
                is_deleted: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
            };

            setMockInvokeResult('save_course', undefined);

            await storageService.saveCourse(mockCourse);

            expect(invoke).toHaveBeenCalledWith('save_course', { course: mockCourse });
        });

        it('should get course by id', async () => {
            const mockCourse: Course = {
                id: 'course-1',
                user_id: 'test_user',
                title: 'Retrieved Course',
                description: undefined,
                keywords: undefined,
                syllabus_info: undefined,
                is_deleted: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
            };

            setMockInvokeResult('get_course', mockCourse);

            const result = await storageService.getCourse('course-1');

            expect(invoke).toHaveBeenCalledWith('get_course', { id: 'course-1' });
            expect(result).toEqual(mockCourse);
        });

        it('should return null for non-existent course', async () => {
            setMockInvokeResult('get_course', null);

            const result = await storageService.getCourse('non-existent');

            expect(result).toBeNull();
        });

        it('should list courses for current user', async () => {
            const mockCourses: Course[] = [
                {
                    id: 'course-1',
                    user_id: 'test_user',
                    title: 'Course 1',
                    description: undefined,
                    keywords: undefined,
                    syllabus_info: undefined,
                    is_deleted: false,
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z',
                },
                {
                    id: 'course-2',
                    user_id: 'test_user',
                    title: 'Course 2',
                    description: undefined,
                    keywords: undefined,
                    syllabus_info: undefined,
                    is_deleted: false,
                    created_at: '2024-01-02T00:00:00Z',
                    updated_at: '2024-01-02T00:00:00Z',
                },
            ];

            setMockInvokeResult('list_courses', mockCourses);

            const result = await storageService.listCourses();

            expect(invoke).toHaveBeenCalledWith('list_courses', { userId: 'test_user' });
            expect(result).toHaveLength(2);
            expect(result[0].title).toBe('Course 1');
        });

        it('should delete course', async () => {
            setMockInvokeResult('delete_course', undefined);

            await storageService.deleteCourse('course-1');

            expect(invoke).toHaveBeenCalledWith('delete_course', { id: 'course-1' });
        });
    });

    // ===== Course Syllabus Lifecycle State Machine =====
    // These pure helpers gate every UI branch in CourseDetailView. Back-compat
    // with pre-alpha.9 courses (no `_classnote_status` meta key) is critical —
    // old courses with real content must still register as 'ready'.
    //
    // The lifecycle meta keys (`_classnote_status` etc.) are intentionally
    // internal to storageService and NOT on the public `SyllabusInfo` type,
    // so test literals that exercise them need a cast. Keep casts explicit
    // per-assertion rather than hiding behind a helper — the cast itself is
    // the signal that we're testing a storage-layer protocol, not UI contract.
    const asSyllabus = (v: Record<string, unknown>): Course['syllabus_info'] =>
        v as unknown as Course['syllabus_info'];

    describe('Course Syllabus Lifecycle', () => {
        it('treats undefined/null syllabus_info as idle', () => {
            expect(getCourseSyllabusState(undefined)).toBe('idle');
            // Backend may round-trip missing values as either undefined or null;
            // cast so we can cover the null branch that the runtime actually sees.
            expect(getCourseSyllabusState(null as unknown as Course['syllabus_info'])).toBe('idle');
        });

        it('treats empty object as idle', () => {
            expect(getCourseSyllabusState({})).toBe('idle');
        });

        it('treats pre-alpha.9 course with real content as ready (no _classnote_status)', () => {
            // Back-compat: courses saved before the lifecycle was introduced have
            // raw SyllabusInfo objects with no meta keys. The UI must render them.
            expect(getCourseSyllabusState({ topic: 'Physics 101' })).toBe('ready');
            expect(getCourseSyllabusState({ schedule: ['Week 1', 'Week 2'] })).toBe('ready');
            expect(getCourseSyllabusState({ grading: [{ item: 'Midterm', percentage: '30%' }] })).toBe('ready');
        });

        it('honors explicit _classnote_status over content inference', () => {
            // A failed regeneration carries no content but the UI must still show
            // the failed state rather than falling back to 'idle'.
            expect(getCourseSyllabusState(asSyllabus({ _classnote_status: 'failed', _classnote_error_message: 'Timeout' }))).toBe('failed');
            expect(getCourseSyllabusState(asSyllabus({ _classnote_status: 'generating' }))).toBe('generating');
            // Generating while old content still present (regenerate path).
            expect(getCourseSyllabusState(asSyllabus({ topic: 'Old', _classnote_status: 'generating' }))).toBe('generating');
        });

        it('ignores invalid _classnote_status values and falls back to content check', () => {
            expect(getCourseSyllabusState(asSyllabus({ _classnote_status: 'bogus', topic: 'Physics' }))).toBe('ready');
            expect(getCourseSyllabusState(asSyllabus({ _classnote_status: 'bogus' }))).toBe('idle');
        });

        it('does NOT count lifecycle meta keys as content', () => {
            // Pure meta object (status written during bg task but no content yet)
            // must not register as 'ready'. Without this filter, the generating
            // state would briefly flash 'ready' with empty fields.
            expect(getCourseSyllabusState(asSyllabus({
                _classnote_status: 'failed',
                _classnote_source: 'pdf',
                _classnote_updated_at: '2024-01-01T00:00:00Z',
                _classnote_error_message: 'LLM timeout',
            }))).toBe('failed');
        });

        it('treats empty-string / empty-array content as no content', () => {
            expect(getCourseSyllabusState({ topic: '' })).toBe('idle');
            expect(getCourseSyllabusState({ topic: '   ' })).toBe('idle');
            expect(getCourseSyllabusState({ schedule: [] })).toBe('idle');
        });

        it('returns failure reason only when _classnote_error_message is non-empty string', () => {
            expect(getCourseSyllabusFailureReason(asSyllabus({ _classnote_error_message: 'LLM timeout' }))).toBe('LLM timeout');
            expect(getCourseSyllabusFailureReason(asSyllabus({ _classnote_error_message: '' }))).toBeUndefined();
            expect(getCourseSyllabusFailureReason(asSyllabus({ _classnote_error_message: '   ' }))).toBeUndefined();
            expect(getCourseSyllabusFailureReason({})).toBeUndefined();
            expect(getCourseSyllabusFailureReason(undefined)).toBeUndefined();
        });

        it('handles non-object syllabus_info gracefully', () => {
            // Defensive: SQLite round-trip or sync bugs could theoretically yield
            // an array / string. The helpers must not crash.
            expect(getCourseSyllabusState([] as unknown as Course['syllabus_info'])).toBe('idle');
            expect(getCourseSyllabusFailureReason([] as unknown as Course['syllabus_info'])).toBeUndefined();
        });
    });

    // ===== Lecture Tests =====
    describe('Lecture Operations', () => {
        it('should save lecture', async () => {
            const mockLecture: Lecture = {
                id: 'lecture-1',
                course_id: 'course-1',
                title: 'Test Lecture',
                date: '2024-01-01T00:00:00Z',
                duration: 3600,
                pdf_path: undefined,
                audio_path: undefined,
                status: 'recording',
                is_deleted: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
            };

            setMockInvokeResult('save_lecture', undefined);

            await storageService.saveLecture(mockLecture);

            expect(invoke).toHaveBeenCalledWith('save_lecture', {
                lecture: mockLecture,
                userId: 'test_user',
            });
        });

        it('should get lecture by id', async () => {
            const mockLecture: Lecture = {
                id: 'lecture-1',
                course_id: 'course-1',
                title: 'Retrieved Lecture',
                date: '2024-01-01T00:00:00Z',
                duration: 3600,
                pdf_path: '/path/to/pdf',
                audio_path: '/path/to/audio',
                status: 'completed',
                is_deleted: false,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
            };

            setMockInvokeResult('get_lecture', mockLecture);

            const result = await storageService.getLecture('lecture-1');

            expect(result).toEqual(mockLecture);
        });

        it('should update lecture status', async () => {
            setMockInvokeResult('update_lecture_status', undefined);

            await storageService.updateLectureStatus('lecture-1', 'completed');

            expect(invoke).toHaveBeenCalledWith('update_lecture_status', {
                id: 'lecture-1',
                status: 'completed',
            });
        });
    });

    // ===== Subtitle Tests =====
    describe('Subtitle Operations', () => {
        it('should save subtitle', async () => {
            const mockSubtitle: Subtitle = {
                id: 'sub-1',
                lecture_id: 'lecture-1',
                timestamp: 0.0,
                text_en: 'Hello world',
                text_zh: '你好世界',
                type: 'rough',
                confidence: 0.95,
                created_at: '2024-01-01T00:00:00Z',
            };

            setMockInvokeResult('save_subtitle', undefined);

            await storageService.saveSubtitle(mockSubtitle);

            expect(invoke).toHaveBeenCalledWith('save_subtitle', { subtitle: mockSubtitle });
        });

        it('should get subtitles for lecture', async () => {
            const mockSubtitles: Subtitle[] = [
                {
                    id: 'sub-1',
                    lecture_id: 'lecture-1',
                    timestamp: 0.0,
                    text_en: 'First',
                    text_zh: '第一',
                    type: 'rough',
                    confidence: 0.9,
                    created_at: '2024-01-01T00:00:00Z',
                },
                {
                    id: 'sub-2',
                    lecture_id: 'lecture-1',
                    timestamp: 2.5,
                    text_en: 'Second',
                    text_zh: '第二',
                    type: 'fine',
                    confidence: 0.98,
                    created_at: '2024-01-01T00:00:01Z',
                },
            ];

            setMockInvokeResult('get_subtitles', mockSubtitles);

            const result = await storageService.getSubtitles('lecture-1');

            expect(invoke).toHaveBeenCalledWith('get_subtitles', { lectureId: 'lecture-1' });
            expect(result).toHaveLength(2);
            expect(result[0].text_en).toBe('First');
            expect(result[1].type).toBe('fine');
        });

        it('should batch save subtitles', async () => {
            const subtitles: Subtitle[] = [
                { id: 'sub-1', lecture_id: 'lec-1', timestamp: 0, text_en: 'A', text_zh: undefined, type: 'rough', confidence: undefined, created_at: '' },
                { id: 'sub-2', lecture_id: 'lec-1', timestamp: 1, text_en: 'B', text_zh: undefined, type: 'rough', confidence: undefined, created_at: '' },
            ];

            setMockInvokeResult('save_subtitles', undefined);

            await storageService.saveSubtitles(subtitles);

            expect(invoke).toHaveBeenCalledWith('save_subtitles', { subtitles });
        });
    });

    // ===== Settings Tests =====
    describe('Settings Operations', () => {
        const baseAppSettings: AppSettings = {
            server: {
                url: 'http://localhost',
                port: 3000,
                enabled: false,
            },
            audio: {
                sample_rate: 16000,
                chunk_duration: 5,
            },
            subtitle: {
                font_size: 16,
                font_color: '#ffffff',
                background_opacity: 0.8,
                position: 'bottom',
                display_mode: 'both',
            },
            theme: 'light',
        };

        it('should save setting', async () => {
            setMockInvokeResult('save_setting', undefined);

            await storageService.saveSetting('theme', 'dark');

            expect(invoke).toHaveBeenCalledWith('save_setting', { key: 'theme', value: 'dark' });
        });

        it('should get setting', async () => {
            setMockInvokeResult('get_setting', 'dark');

            const result = await storageService.getSetting('theme');

            expect(invoke).toHaveBeenCalledWith('get_setting', { key: 'theme' });
            expect(result).toBe('dark');
        });

        it('should return null for non-existent setting', async () => {
            setMockInvokeResult('get_setting', null);

            const result = await storageService.getSetting('non_existent');

            expect(result).toBeNull();
        });

        it('normalizes retired local OCR / Ollama settings on read', async () => {
            const legacySettings = {
                ...baseAppSettings,
                ocr: { mode: 'local' },
                experimental: { refineProvider: 'ollama' },
                ollama: {
                    host: 'http://127.0.0.1:11434',
                },
            } as unknown as AppSettings & Record<string, unknown>;

            setMockInvokeResult('get_setting', JSON.stringify(legacySettings));

            const result = await storageService.getAppSettings();

            expect(invoke).toHaveBeenCalledWith('get_setting', { key: 'app_settings' });
            expect(result?.ocr?.mode).toBe('off');
            expect(result?.experimental?.refineProvider).toBe('auto');
            expect('ollama' in ((result ?? {}) as Record<string, unknown>)).toBe(false);
        });

        it('strips retired local OCR / Ollama settings before persisting app settings', async () => {
            setMockInvokeResult('save_setting', undefined);

            const legacySettings = {
                ...baseAppSettings,
                ocr: { mode: 'local' },
                experimental: { refineProvider: 'ollama' },
                ollama: {
                    host: 'http://127.0.0.1:11434',
                },
            } as unknown as AppSettings & Record<string, unknown>;

            await storageService.saveAppSettings(legacySettings as AppSettings);

            expect(invoke).toHaveBeenCalledWith('save_setting', {
                key: 'app_settings',
                value: JSON.stringify({
                    ...baseAppSettings,
                    ocr: { mode: 'off' },
                    experimental: { refineProvider: 'auto' },
                }),
            });
        });
    });
});
