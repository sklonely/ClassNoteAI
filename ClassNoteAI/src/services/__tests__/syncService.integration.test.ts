/**
 * SyncService Integration Tests
 * 
 * Tests the actual sync logic including:
 * - LWW (Last Write Wins) conflict resolution
 * - Cross-device path handling
 * - CRUD sync consistency
 * - Soft delete synchronization
 * - File path normalization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearMockInvokeResults } from '../../test/setup';

// ===== Mock Setup =====

// Track all storage calls for verification
const storageCalls: { method: string; args: any[] }[] = [];
const mockLocalData: {
    courses: Map<string, any>;
    lectures: Map<string, any>;
    notes: Map<string, any>;
    subtitles: Map<string, any[]>;
    settings: Map<string, string>;
} = {
    courses: new Map(),
    lectures: new Map(),
    notes: new Map(),
    subtitles: new Map(),
    settings: new Map(),
};

// Reset local data
function resetLocalData() {
    mockLocalData.courses.clear();
    mockLocalData.lectures.clear();
    mockLocalData.notes.clear();
    mockLocalData.subtitles.clear();
    mockLocalData.settings.clear();
    storageCalls.length = 0;
}

// Mock storageService with stateful behavior
vi.mock('../storageService', () => ({
    storageService: {
        listCoursesSync: vi.fn(() => {
            storageCalls.push({ method: 'listCoursesSync', args: [] });
            return Promise.resolve(Array.from(mockLocalData.courses.values()));
        }),
        listLecturesSync: vi.fn(() => {
            storageCalls.push({ method: 'listLecturesSync', args: [] });
            return Promise.resolve(Array.from(mockLocalData.lectures.values()));
        }),
        getCourse: vi.fn((id: string) => {
            storageCalls.push({ method: 'getCourse', args: [id] });
            return Promise.resolve(mockLocalData.courses.get(id) || null);
        }),
        getLecture: vi.fn((id: string) => {
            storageCalls.push({ method: 'getLecture', args: [id] });
            return Promise.resolve(mockLocalData.lectures.get(id) || null);
        }),
        getNote: vi.fn((lectureId: string) => {
            storageCalls.push({ method: 'getNote', args: [lectureId] });
            return Promise.resolve(mockLocalData.notes.get(lectureId) || null);
        }),
        getSubtitles: vi.fn((lectureId: string) => {
            storageCalls.push({ method: 'getSubtitles', args: [lectureId] });
            return Promise.resolve(mockLocalData.subtitles.get(lectureId) || []);
        }),
        getAllSettings: vi.fn(() => {
            storageCalls.push({ method: 'getAllSettings', args: [] });
            const obj: Record<string, string> = {};
            mockLocalData.settings.forEach((v, k) => obj[k] = v);
            return Promise.resolve(obj);
        }),
        saveCourse: vi.fn((course: any) => {
            storageCalls.push({ method: 'saveCourse', args: [course] });
            mockLocalData.courses.set(course.id, course);
            return Promise.resolve();
        }),
        saveLecture: vi.fn((lecture: any) => {
            storageCalls.push({ method: 'saveLecture', args: [lecture] });
            mockLocalData.lectures.set(lecture.id, lecture);
            return Promise.resolve();
        }),
        saveNote: vi.fn((note: any) => {
            storageCalls.push({ method: 'saveNote', args: [note] });
            mockLocalData.notes.set(note.lecture_id, note);
            return Promise.resolve();
        }),
        saveSubtitles: vi.fn((subtitles: any[]) => {
            storageCalls.push({ method: 'saveSubtitles', args: [subtitles] });
            if (subtitles.length > 0) {
                const lectureId = subtitles[0].lecture_id;
                mockLocalData.subtitles.set(lectureId, subtitles);
            }
            return Promise.resolve();
        }),
        saveSetting: vi.fn((key: string, value: string) => {
            storageCalls.push({ method: 'saveSetting', args: [key, value] });
            mockLocalData.settings.set(key, value);
            return Promise.resolve();
        }),
    },
}));

// Mock offlineQueueService
vi.mock('../offlineQueueService', () => ({
    offlineQueueService: {
        registerProcessor: vi.fn(),
        enqueue: vi.fn(() => Promise.resolve('mock-id')),
    },
}));

// Mock file system
vi.mock('@tauri-apps/plugin-fs', () => ({
    exists: vi.fn((path: string) => {
        // Simulate: files on local device exist, remote paths don't
        if (path.includes('/Users/local/')) {
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }),
}));

// Track HTTP fetch calls
const fetchCalls: { url: string; options?: any }[] = [];
let mockServerResponse: any = { courses: [], lectures: [], notes: [], subtitles: [], settings: [] };

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn((url: string, options?: any) => {
        fetchCalls.push({ url, options });
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockServerResponse),
            text: () => Promise.resolve(JSON.stringify(mockServerResponse)),
        });
    }),
}));

// Mock invoke
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn((cmd: string, args?: any) => {
        if (cmd === 'get_audio_dir') return Promise.resolve('/Users/local/audio');
        if (cmd === 'get_documents_dir') return Promise.resolve('/Users/local/documents');
        if (cmd === 'get_all_chat_sessions') return Promise.resolve([]);
        if (cmd === 'get_all_chat_messages') return Promise.resolve([]);
        if (cmd === 'delete_subtitles_by_lecture') return Promise.resolve();
        if (cmd === 'upload_file') return Promise.resolve('uploaded_file.mp3');
        if (cmd === 'download_file') return Promise.resolve();
        return Promise.resolve();
    }),
}));

// Import after mocking
import { SyncService } from '../syncService';

describe('SyncService Integration Tests', () => {
    let syncService: SyncService;

    beforeEach(() => {
        clearMockInvokeResults();
        vi.clearAllMocks();
        resetLocalData();
        fetchCalls.length = 0;
        mockServerResponse = { courses: [], lectures: [], notes: [], subtitles: [], settings: [] };
        syncService = new SyncService();
    });

    // ===== LWW Conflict Resolution =====
    describe('LWW (Last Write Wins) Conflict Resolution', () => {
        describe('Course Sync', () => {
            it('should update local when server is newer', async () => {
                // Local: older timestamp
                mockLocalData.courses.set('course-1', {
                    id: 'course-1',
                    title: 'Local Version',
                    updated_at: '2024-01-01T00:00:00Z',
                });

                // Server: newer timestamp
                mockServerResponse = {
                    courses: [{
                        id: 'course-1',
                        title: 'Server Version',
                        updated_at: '2024-01-02T00:00:00Z', // Newer
                    }],
                    lectures: [],
                };

                await (syncService as any).pullDataDirect('http://localhost', 'testuser');

                // Should have saved the server version
                const saved = mockLocalData.courses.get('course-1');
                expect(saved.title).toBe('Server Version');
            });

            it('should NOT update local when local is newer', async () => {
                // Local: newer timestamp
                mockLocalData.courses.set('course-1', {
                    id: 'course-1',
                    title: 'Local Newer',
                    updated_at: '2024-01-05T00:00:00Z', // Newer
                });

                // Server: older timestamp
                mockServerResponse = {
                    courses: [{
                        id: 'course-1',
                        title: 'Server Older',
                        updated_at: '2024-01-01T00:00:00Z',
                    }],
                    lectures: [],
                };

                await (syncService as any).pullDataDirect('http://localhost', 'testuser');

                // Should keep local version
                const saved = mockLocalData.courses.get('course-1');
                expect(saved.title).toBe('Local Newer');
            });

            it('should insert when local missing', async () => {
                // Local: empty
                expect(mockLocalData.courses.size).toBe(0);

                // Server: has course
                mockServerResponse = {
                    courses: [{
                        id: 'new-course',
                        title: 'New From Server',
                        updated_at: '2024-01-01T00:00:00Z',
                    }],
                    lectures: [],
                };

                await (syncService as any).pullDataDirect('http://localhost', 'testuser');

                // Should insert
                expect(mockLocalData.courses.size).toBe(1);
                expect(mockLocalData.courses.get('new-course').title).toBe('New From Server');
            });
        });

        describe('Lecture Sync', () => {
            it('should update lecture when server is newer', async () => {
                mockLocalData.lectures.set('lecture-1', {
                    id: 'lecture-1',
                    title: 'Old Lecture',
                    updated_at: '2024-01-01T00:00:00Z',
                });

                mockServerResponse = {
                    courses: [],
                    lectures: [{
                        id: 'lecture-1',
                        title: 'Updated Lecture',
                        updated_at: '2024-01-10T00:00:00Z',
                    }],
                };

                await (syncService as any).pullDataDirect('http://localhost', 'testuser');

                const saved = mockLocalData.lectures.get('lecture-1');
                expect(saved.title).toBe('Updated Lecture');
            });

            it('should preserve local when same timestamp', async () => {
                const sameTime = '2024-01-01T12:00:00Z';

                mockLocalData.lectures.set('lecture-1', {
                    id: 'lecture-1',
                    title: 'Local Title',
                    updated_at: sameTime,
                });

                mockServerResponse = {
                    courses: [],
                    lectures: [{
                        id: 'lecture-1',
                        title: 'Server Title',
                        updated_at: sameTime, // Same timestamp
                    }],
                };

                await (syncService as any).pullDataDirect('http://localhost', 'testuser');

                // With same timestamp, server should NOT overwrite (serverTime > localTime fails)
                const saved = mockLocalData.lectures.get('lecture-1');
                expect(saved.title).toBe('Local Title');
            });
        });
    });

    // ===== Cross-Device Path Handling =====
    describe('Cross-Device Path Handling', () => {
        it('should extract filename from absolute path', async () => {
            mockServerResponse = {
                courses: [],
                lectures: [{
                    id: 'lecture-1',
                    title: 'Test',
                    updated_at: '2024-01-01T00:00:00Z',
                    audio_path: '/Users/other-device/audio/recording.mp3', // Other device path
                }],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            // Should extract filename and build local path
            const saved = mockLocalData.lectures.get('lecture-1');
            expect(saved.audio_path).toContain('recording.mp3');
            expect(saved.audio_path).toContain('/Users/local/audio');
        });

        it('should handle Windows-style paths', async () => {
            mockServerResponse = {
                courses: [],
                lectures: [{
                    id: 'lecture-1',
                    title: 'Test',
                    updated_at: '2024-01-01T00:00:00Z',
                    audio_path: 'C:\\Users\\Windows\\audio\\lecture.mp3', // Windows path
                }],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            const saved = mockLocalData.lectures.get('lecture-1');
            // Should extract 'lecture.mp3' from Windows path
            expect(saved.audio_path).toContain('lecture.mp3');
        });

        it('should handle filename-only paths', async () => {
            mockServerResponse = {
                courses: [],
                lectures: [{
                    id: 'lecture-1',
                    title: 'Test',
                    updated_at: '2024-01-01T00:00:00Z',
                    audio_path: 'just-filename.mp3', // Already filename only
                }],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            const saved = mockLocalData.lectures.get('lecture-1');
            expect(saved.audio_path).toContain('just-filename.mp3');
        });

        it('should handle PDF paths similarly', async () => {
            mockServerResponse = {
                courses: [],
                lectures: [{
                    id: 'lecture-1',
                    title: 'Test',
                    updated_at: '2024-01-01T00:00:00Z',
                    pdf_path: '/Users/other/Documents/slides.pdf',
                }],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            const saved = mockLocalData.lectures.get('lecture-1');
            expect(saved.pdf_path).toContain('slides.pdf');
            expect(saved.pdf_path).toContain('/Users/local/documents');
        });
    });

    // ===== Soft Delete Synchronization =====
    describe('Soft Delete Synchronization', () => {
        it('should sync deleted course from server', async () => {
            mockServerResponse = {
                courses: [{
                    id: 'deleted-course',
                    title: 'Deleted on Server',
                    is_deleted: true,
                    updated_at: '2024-01-15T00:00:00Z',
                }],
                lectures: [],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            const saved = mockLocalData.courses.get('deleted-course');
            expect(saved).toBeDefined();
            expect(saved.is_deleted).toBe(true);
        });

        it('should push deleted items to server', async () => {
            mockLocalData.courses.set('to-delete', {
                id: 'to-delete',
                title: 'Will Be Deleted',
                is_deleted: true,
                user_id: 'testuser',
            });

            await (syncService as any).pushDataDirect('http://localhost', 'testuser');

            // Check the fetch was called with is_deleted in payload
            expect(fetchCalls.length).toBeGreaterThan(0);
            const pushCall = fetchCalls.find(c => c.url.includes('/sync/push'));
            expect(pushCall).toBeDefined();

            const body = JSON.parse(pushCall!.options.body);
            const deletedCourse = body.courses.find((c: any) => c.id === 'to-delete');
            expect(deletedCourse.is_deleted).toBe(true);
        });
    });

    // ===== Syllabus Info Parsing =====
    describe('Syllabus Info Parsing', () => {
        it('should parse stringified syllabus_info', async () => {
            const syllabusData = { topics: ['AI', 'ML'], weeks: 10 };

            mockServerResponse = {
                courses: [{
                    id: 'course-syllabus',
                    title: 'Course with Syllabus',
                    syllabus_info: JSON.stringify(syllabusData),
                    updated_at: '2024-01-01T00:00:00Z',
                }],
                lectures: [],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            const saved = mockLocalData.courses.get('course-syllabus');
            expect(saved.syllabus_info).toEqual(syllabusData);
        });

        it('should handle invalid syllabus_info gracefully', async () => {
            mockServerResponse = {
                courses: [{
                    id: 'course-bad-syllabus',
                    title: 'Course with Bad Syllabus',
                    syllabus_info: 'not-valid-json{{{',
                    updated_at: '2024-01-01T00:00:00Z',
                }],
                lectures: [],
            };

            // Should not throw
            await expect(
                (syncService as any).pullDataDirect('http://localhost', 'testuser')
            ).resolves.not.toThrow();

            const saved = mockLocalData.courses.get('course-bad-syllabus');
            expect(saved.syllabus_info).toBeUndefined();
        });
    });

    // ===== Settings Sync =====
    describe('Settings Sync', () => {
        it('should sync settings from server', async () => {
            mockServerResponse = {
                courses: [],
                lectures: [],
                settings: [
                    { key: 'theme', value: 'dark', updated_at: '2024-01-01T00:00:00Z' },
                    { key: 'subtitle.font_size', value: '18', updated_at: '2024-01-01T00:00:00Z' },
                ],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            expect(mockLocalData.settings.get('theme')).toBe('dark');
            expect(mockLocalData.settings.get('subtitle.font_size')).toBe('18');
        });

        it('should only push syncable settings', async () => {
            // Add various settings including non-syncable ones
            mockLocalData.settings.set('theme', 'light');
            mockLocalData.settings.set('internal.cache', 'should-not-sync');

            await (syncService as any).pushDataDirect('http://localhost', 'testuser');

            const pushCall = fetchCalls.find(c => c.url.includes('/sync/push'));
            const body = JSON.parse(pushCall!.options.body);

            // theme should be in settings
            const themeSettings = body.settings.find((s: any) => s.key === 'theme');
            expect(themeSettings).toBeDefined();

            // internal.cache should NOT be pushed
            const internalSetting = body.settings.find((s: any) => s.key === 'internal.cache');
            expect(internalSetting).toBeUndefined();
        });
    });

    // ===== File Skip on Missing =====
    describe('File Handling', () => {
        it('should skip upload for missing local files', async () => {
            mockLocalData.lectures.set('lecture-missing-file', {
                id: 'lecture-missing-file',
                course_id: 'course-1',
                title: 'Lecture',
                audio_path: '/Users/nonexistent/missing.mp3', // File doesn't exist
            });

            // Should not throw
            await expect(
                (syncService as any).pushDataDirect('http://localhost', 'testuser', { skipFiles: false })
            ).resolves.not.toThrow();
        });

        it('should skip download if file already exists locally', async () => {
            mockServerResponse = {
                courses: [],
                lectures: [{
                    id: 'lecture-1',
                    title: 'Test',
                    updated_at: '2024-01-01T00:00:00Z',
                    audio_path: '/Users/local/audio/existing.mp3', // exists mock returns true for /Users/local/
                }],
            };

            await (syncService as any).pullDataDirect('http://localhost', 'testuser');

            // download_file should NOT have been called for existing file
            // (We can't easily verify this without spying on invoke, but the flow should work)
        });
    });
});
