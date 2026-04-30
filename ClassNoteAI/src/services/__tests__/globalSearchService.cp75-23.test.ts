/**
 * globalSearchService cp75.23 — orphan / soft-deleted parent course filter.
 *
 * Finding 8.1: `build()` previously listed all `is_deleted=false` lectures
 * but never checked whether the parent course was soft-deleted. Lectures
 * whose course was sent to trash kept showing up in ⌘K, leaking deleted
 * data back into the UI.
 *
 * Fix: when materialising lecture rows, skip any lecture whose
 * `course_id` is missing from the live course list OR whose course has
 * `is_deleted === true`.
 *
 * The existing orphan check (`if (!c) continue`) already handles the
 * "missing entirely" case once we filter `courses` to non-deleted only;
 * we add an explicit test for that to lock it in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Course, Lecture } from '../../types';

// Mock storageService so build() pulls from our fixtures.
const listCourses = vi.fn();
const listLectures = vi.fn();
vi.mock('../storageService', () => ({
    storageService: {
        listCourses: () => listCourses(),
        listLectures: () => listLectures(),
    },
}));

// MiniSearch in-process is fine, but the service is a module-level
// singleton — we re-import per test and call invalidate() to force rebuild.
import { globalSearchService } from '../globalSearchService';

const mkCourse = (id: string, opts: Partial<Course> = {}): Course => ({
    id,
    user_id: 'u',
    title: `Course ${id}`,
    keywords: '',
    is_deleted: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...opts,
});

const mkLecture = (id: string, courseId: string, opts: Partial<Lecture> = {}): Lecture => ({
    id,
    course_id: courseId,
    title: `Lecture ${id}`,
    date: '2025-01-01T00:00:00Z',
    duration: 600,
    status: 'completed',
    is_deleted: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...opts,
});

beforeEach(() => {
    listCourses.mockReset();
    listLectures.mockReset();
    globalSearchService.invalidate();
});

describe('globalSearchService · cp75.23', () => {
    it('excludes lectures whose parent course is soft-deleted', async () => {
        listCourses.mockResolvedValue([
            mkCourse('C-alive', { title: 'Alive Course' }),
            mkCourse('C-trash', { title: 'Trashed Course', is_deleted: true }),
        ]);
        listLectures.mockResolvedValue([
            mkLecture('L1', 'C-alive', { title: 'Lecture One' }),
            mkLecture('L2', 'C-trash', { title: 'Lecture Two' }),
        ]);

        const results = await globalSearchService.search('Lecture');
        const ids = results.map((r) => r.id);
        expect(ids).toContain('lec:L1');
        expect(ids).not.toContain('lec:L2');
    });

    it('excludes lectures whose course is missing entirely (orphan)', async () => {
        listCourses.mockResolvedValue([
            mkCourse('C-alive', { title: 'Alive Course' }),
        ]);
        listLectures.mockResolvedValue([
            mkLecture('L1', 'C-alive', { title: 'Lecture One' }),
            // L2's course_id has no matching course at all
            mkLecture('L2', 'C-missing', { title: 'Lecture Two' }),
        ]);

        const results = await globalSearchService.search('Lecture');
        const ids = results.map((r) => r.id);
        expect(ids).toContain('lec:L1');
        expect(ids).not.toContain('lec:L2');
    });

    it('also excludes the soft-deleted course itself from COURSE results', async () => {
        listCourses.mockResolvedValue([
            mkCourse('C-alive', { title: 'Alive Course' }),
            mkCourse('C-trash', { title: 'Trashed Course', is_deleted: true }),
        ]);
        listLectures.mockResolvedValue([]);

        const results = await globalSearchService.search('Course');
        const ids = results.map((r) => r.id);
        expect(ids).toContain('course:C-alive');
        expect(ids).not.toContain('course:C-trash');
    });
});
