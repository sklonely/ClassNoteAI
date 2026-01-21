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
import { storageService } from '../storageService';
import type { Course, Lecture, Subtitle } from '../../types';

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
                syllabus_info: null,
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
                description: null,
                keywords: null,
                syllabus_info: null,
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
                    description: null,
                    keywords: null,
                    syllabus_info: null,
                    is_deleted: false,
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z',
                },
                {
                    id: 'course-2',
                    user_id: 'test_user',
                    title: 'Course 2',
                    description: null,
                    keywords: null,
                    syllabus_info: null,
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

    // ===== Lecture Tests =====
    describe('Lecture Operations', () => {
        it('should save lecture', async () => {
            const mockLecture: Lecture = {
                id: 'lecture-1',
                course_id: 'course-1',
                title: 'Test Lecture',
                date: '2024-01-01T00:00:00Z',
                duration: 3600,
                pdf_path: null,
                audio_path: null,
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
                { id: 'sub-1', lecture_id: 'lec-1', timestamp: 0, text_en: 'A', text_zh: null, type: 'rough', confidence: null, created_at: '' },
                { id: 'sub-2', lecture_id: 'lec-1', timestamp: 1, text_en: 'B', text_zh: null, type: 'rough', confidence: null, created_at: '' },
            ];

            setMockInvokeResult('save_subtitles', undefined);

            await storageService.saveSubtitles(subtitles);

            expect(invoke).toHaveBeenCalledWith('save_subtitles', { subtitles });
        });
    });

    // ===== Settings Tests =====
    describe('Settings Operations', () => {
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
    });
});
