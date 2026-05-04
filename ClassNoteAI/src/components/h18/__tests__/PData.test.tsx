/**
 * PData · Phase 7 Sprint 3 R3 (S3f-FE) tests.
 *
 * The Trash region of PData is the customer-facing surface for the
 * Phase 7 cascade-delete plumbing (PLAN §3f, §8.1 V14/V15 + N3 + S6).
 * This suite locks down the user-visible contract:
 *
 *   1. mount → invoke('list_trashed_lectures', { userId: null })
 *   2. 兩條 list 都空 → 顯示 empty 文案 (「回收桶空空。」)
 *   3. 有 trashed → render 階層樹 (course group + lecture rows)
 *   4. 點某 lecture 的「還原」(parent course alive) → invoke restore_lecture
 *   5. lecture 的 parent course 也在垃圾桶 → confirm 跳「需連同 course」
 *   6. confirm OK → invoke restore_course (改帶整個 course 回來)
 *   7. 全選 → 把所有 lecture + course id 設為 selected
 *   8. bulk restore → 對 selected 內每個 id 各 invoke 一次 (course 先, lecture 後)
 *
 * 我們 mock 三件事：
 *   - `@tauri-apps/api/core` 的 `invoke` (per-cmd dispatcher)
 *   - `confirmService` (避免真彈 dialog)
 *   - `toastService` (避免真噴 toast → 也方便 assert)
 *
 * 跟 PTranslate.test.tsx 風格對齊。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import * as core from '@tauri-apps/api/core';
import type { Course, Lecture } from '../../../types';

// ─── service mocks (must be set up before component import) ──────────

const { mockConfirm, mockToast, mockStorage } = vi.hoisted(() => ({
    mockConfirm: {
        ask: vi.fn(async (_req: unknown) => true),
    },
    mockToast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        show: vi.fn(),
    },
    mockStorage: {
        // restoreCourse / restoreLecture helpers used by older PData; we
        // route through invoke directly in the new code path so these
        // stays as no-op stubs in case the import is still kept.
        restoreCourse: vi.fn(async (_id: string) => undefined),
        restoreLecture: vi.fn(async (_id: string) => undefined),
        listCourses: vi.fn(async () => [] as Course[]),
        listLectures: vi.fn(async () => [] as Lecture[]),
    },
}));

vi.mock('../../../services/confirmService', () => ({
    confirmService: mockConfirm,
}));

vi.mock('../../../services/toastService', () => ({
    toastService: mockToast,
}));

vi.mock('../../../services/storageService', () => ({
    storageService: mockStorage,
}));

// ─── imports (after mocks) ────────────────────────────────────────────
import { PData } from '../ProfilePanes';

// ─── fixtures ────────────────────────────────────────────────────────

function makeLecture(overrides: Partial<Lecture> = {}): Lecture {
    const now = new Date('2026-04-01T10:00:00Z').toISOString();
    return {
        id: 'lec-1',
        course_id: 'course-1',
        title: 'Lecture 1',
        date: '2026-04-01',
        duration: 0,
        status: 'completed',
        created_at: now,
        updated_at: now,
        is_deleted: true,
        ...overrides,
    };
}

function makeCourse(overrides: Partial<Course> = {}): Course {
    const now = new Date('2026-03-01T10:00:00Z').toISOString();
    return {
        id: 'course-1',
        user_id: 'default_user',
        title: 'Course One',
        created_at: now,
        updated_at: now,
        is_deleted: true,
        ...overrides,
    };
}

/**
 * Configurable invoke mock — each test seeds the responses it needs.
 */
function setupInvoke(opts: {
    trashedLectures?: Lecture[];
    trashedCourses?: Course[];
    /** Throw on list_trashed_courses to simulate cmd-not-implemented. */
    coursesError?: unknown;
    /** Throw on list_trashed_lectures to simulate cmd error. */
    lecturesError?: unknown;
    /** Optional restore_course return — count of restored lectures. */
    restoreCourseCount?: number;
    /** cp75.27 — lectures still in trash AFTER restore_course runs.
     *  Defaults to [] (success path). Tests for the warning toast
     *  pass a non-empty list. */
    remainingAfterRestore?: Lecture[];
}) {
    return vi.spyOn(core, 'invoke').mockImplementation(
        async (cmd: string, _args?: unknown) => {
            if (cmd === 'list_trashed_lectures') {
                if (opts.lecturesError) throw opts.lecturesError;
                return (opts.trashedLectures ?? []) as unknown as never;
            }
            if (cmd === 'list_deleted_courses' || cmd === 'list_trashed_courses') {
                if (opts.coursesError) throw opts.coursesError;
                return (opts.trashedCourses ?? []) as unknown as never;
            }
            if (cmd === 'restore_course') {
                return (opts.restoreCourseCount ?? 0) as unknown as never;
            }
            if (cmd === 'list_trashed_lectures_in_course') {
                // cp75.27 — frontend post-restore probe for stuck-in-trash
                // lectures (independently soft-deleted before the course
                // delete so they didn't pick up the cascade marker).
                return (opts.remainingAfterRestore ?? []) as unknown as never;
            }
            if (cmd === 'restore_lecture') {
                return null as unknown as never;
            }
            return null as unknown as never;
        },
    );
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Drain the few promise ticks PData's mount effect needs to land. */
async function flush(times = 4) {
    for (let i = 0; i < times; i++) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        await act(async () => {});
    }
}

describe('PData · S3f trash bin', () => {
    it('1. mount → invoke list_trashed_lectures + courses with the logged-in user_id (cp75.19)', async () => {
        // cp75.19 — pre-fix the load path passed `userId: null` which
        // the Rust handler defaults to `'default_user'`. Multi-user
        // migration (cp75.3) made real users own their rows under
        // their actual username, so passing null silently returned
        // an empty trash. Both list calls must now use the auth user.
        const invokeSpy = setupInvoke({});

        render(<PData />);
        await flush();

        const lectureCall = invokeSpy.mock.calls.find(
            ([cmd]) => cmd === 'list_trashed_lectures',
        );
        expect(lectureCall).toBeTruthy();
        // Tests run unauthenticated → authService.getUser() returns
        // null → falls back to 'default_user' (matches the Rust
        // handler's own fallback). The important regression guard is
        // that we no longer pass `null`.
        expect(lectureCall?.[1]).toEqual({ userId: 'default_user' });

        const courseCall = invokeSpy.mock.calls.find(
            ([cmd]) =>
                cmd === 'list_trashed_courses' ||
                cmd === 'list_deleted_courses',
        );
        expect(courseCall).toBeTruthy();
        expect(courseCall?.[1]).toEqual({ userId: 'default_user' });
    });

    it('2. 兩條 list 都空 → 顯示 empty 文案', async () => {
        setupInvoke({});

        render(<PData />);
        await flush();

        expect(screen.getByText(/回收桶空空/)).toBeInTheDocument();
    });

    it('3. 有 trashed → render 階層樹 (course group + lecture rows)', async () => {
        const lecA = makeLecture({ id: 'lec-a', title: 'Lecture A', course_id: 'course-1' });
        const lecB = makeLecture({ id: 'lec-b', title: 'Lecture B', course_id: 'course-1' });
        const courseDead = makeCourse({ id: 'course-1', title: 'Dead Course' });
        setupInvoke({
            trashedLectures: [lecA, lecB],
            trashedCourses: [courseDead],
        });

        render(<PData />);
        await flush();

        expect(screen.getByText('Dead Course')).toBeInTheDocument();
        expect(screen.getByText('Lecture A')).toBeInTheDocument();
        expect(screen.getByText('Lecture B')).toBeInTheDocument();
        // 兩個 lecture row + 一個 course row 都應該有「還原」鈕
        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        expect(restoreBtns.length).toBeGreaterThanOrEqual(3);
    });

    it('4. 點 lecture 還原 (course alive) → invoke restore_lecture', async () => {
        // Lecture's course is NOT in trashed_courses → course alive path.
        const lec = makeLecture({ id: 'lec-x', title: 'Lone Lecture', course_id: 'alive-course' });
        const invokeSpy = setupInvoke({
            trashedLectures: [lec],
            trashedCourses: [], // alive-course not here → course alive
        });

        render(<PData />);
        await flush();

        // The lecture row's 還原 button — there's only one because course
        // is alive (not rendered with its own restore button).
        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        await act(async () => {
            fireEvent.click(restoreBtns[0]);
        });
        await flush();

        const restoreCall = invokeSpy.mock.calls.find(
            ([cmd]) => cmd === 'restore_lecture',
        );
        expect(restoreCall).toBeTruthy();
        // cp75.6: ownership check piggybacks userId; tests run unauthenticated
        // so the value is the default_user fallback.
        expect(restoreCall?.[1]).toEqual({ id: 'lec-x', userId: 'default_user' });
    });

    it('5. lecture 的 course 在垃圾桶 → confirm 跳「需連同 course」', async () => {
        const lec = makeLecture({ id: 'lec-y', title: 'Orphaned', course_id: 'course-1' });
        const courseDead = makeCourse({ id: 'course-1', title: 'Dead Course' });
        setupInvoke({
            trashedLectures: [lec],
            trashedCourses: [courseDead],
        });
        // Pretend the user cancels so we only assert the confirm shape.
        mockConfirm.ask.mockResolvedValueOnce(false);

        render(<PData />);
        await flush();

        // 點 lecture 行（不是 course 行）的「還原」。
        // course row 的還原是第一個（因為 courseDead 先 render），
        // lecture 行緊隨其後。
        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        // 最後一個是 lecture row。
        await act(async () => {
            fireEvent.click(restoreBtns[restoreBtns.length - 1]);
        });
        await flush();

        expect(mockConfirm.ask).toHaveBeenCalledTimes(1);
        const askArg = mockConfirm.ask.mock.calls[0][0] as { title: string };
        expect(askArg.title).toMatch(/連同課程/);
    });

    it('6. confirm OK → invoke restore_course', async () => {
        const lec = makeLecture({ id: 'lec-z', title: 'Orphaned 2', course_id: 'course-1' });
        const courseDead = makeCourse({ id: 'course-1', title: 'Dead Course' });
        const invokeSpy = setupInvoke({
            trashedLectures: [lec],
            trashedCourses: [courseDead],
            restoreCourseCount: 1,
        });
        mockConfirm.ask.mockResolvedValueOnce(true);

        render(<PData />);
        await flush();

        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        await act(async () => {
            fireEvent.click(restoreBtns[restoreBtns.length - 1]);
        });
        await flush();

        const restoreCourseCall = invokeSpy.mock.calls.find(
            ([cmd]) => cmd === 'restore_course',
        );
        expect(restoreCourseCall).toBeTruthy();
        // cp75.6: ownership check piggybacks userId.
        expect(restoreCourseCall?.[1]).toEqual({
            id: 'course-1',
            userId: 'default_user',
        });
    });

    it('7. 全選 → checkbox 全打勾', async () => {
        const lec1 = makeLecture({ id: 'lec-a', title: 'A', course_id: 'course-1' });
        const lec2 = makeLecture({ id: 'lec-b', title: 'B', course_id: 'course-1' });
        const courseDead = makeCourse({ id: 'course-1', title: 'Dead Course' });
        setupInvoke({
            trashedLectures: [lec1, lec2],
            trashedCourses: [courseDead],
        });

        render(<PData />);
        await flush();

        const selectAllBtn = screen.getByRole('button', { name: /全選/ });
        await act(async () => {
            fireEvent.click(selectAllBtn);
        });

        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes.length).toBeGreaterThanOrEqual(3);
        for (const cb of checkboxes) {
            expect((cb as HTMLInputElement).checked).toBe(true);
        }
    });

    it('8. bulk restore → 對 selected 內每個 id 都 invoke (course 先 lecture 後)', async () => {
        const lec1 = makeLecture({ id: 'lec-a', title: 'A', course_id: 'course-1' });
        const lec2 = makeLecture({ id: 'lec-b', title: 'B', course_id: 'course-1' });
        const courseDead = makeCourse({ id: 'course-1', title: 'Dead Course' });
        const invokeSpy = setupInvoke({
            trashedLectures: [lec1, lec2],
            trashedCourses: [courseDead],
            restoreCourseCount: 2,
        });

        render(<PData />);
        await flush();

        // 全選
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /全選/ }));
        });

        const bulkRestoreBtn = screen.getByRole('button', { name: /還原選取/ });
        await act(async () => {
            fireEvent.click(bulkRestoreBtn);
        });
        await flush(8);

        const courseCalls = invokeSpy.mock.calls.filter(
            ([cmd]) => cmd === 'restore_course',
        );
        // course 在 selected 裡 → 至少一次 restore_course
        expect(courseCalls.length).toBeGreaterThanOrEqual(1);
        // 因 course-1 被 restore，lectures 也跟著回來 → 不重複呼叫 restore_lecture
        // 但即使有也應指向 selected 的 id 之一。
        const lectureCalls = invokeSpy.mock.calls.filter(
            ([cmd]) => cmd === 'restore_lecture',
        );
        for (const [, args] of lectureCalls) {
            const a = args as { id: string };
            expect(['lec-a', 'lec-b']).toContain(a.id);
        }
    });
});

// ════════════════════════════════════════════════════════════════════
// cp75.27 P1-G — restore_course completeness UI
//
// `restore_course` only revives lectures whose `cascade_deleted_with`
// matches the course id. Lectures that were INDEPENDENTLY trashed
// before the course-level delete (cascade marker is NULL) stay in
// the bin. Pre-cp75.27 the UI fired a success toast and the user got
// confused about why some lectures didn't come back. We now probe
// `list_trashed_lectures_in_course` after the restore and surface a
// warning toast when anything's still stuck.
// ════════════════════════════════════════════════════════════════════

describe('PData · cp75.27 restore_course completeness', () => {
    it('restore via lecture-confirm path: warning toast when lectures remain in trash', async () => {
        const lec = makeLecture({
            id: 'lec-cascaded',
            title: 'Cascaded Lecture',
            course_id: 'course-1',
        });
        const courseDead = makeCourse({ id: 'course-1', title: 'Dead Course' });
        // After restore_course, one lecture is still in trash because
        // it had been individually deleted before the course delete.
        const remaining = makeLecture({
            id: 'lec-orphan',
            title: 'Independently Trashed',
            course_id: 'course-1',
        });
        setupInvoke({
            trashedLectures: [lec],
            trashedCourses: [courseDead],
            restoreCourseCount: 1,
            remainingAfterRestore: [remaining],
        });
        mockConfirm.ask.mockResolvedValueOnce(true); // OK to restore

        render(<PData />);
        await flush();

        // Click the lecture-row 還原 (last one — course row first).
        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        await act(async () => {
            fireEvent.click(restoreBtns[restoreBtns.length - 1]);
        });
        await flush(8);

        // Warning toast must fire (NOT the plain success toast).
        expect(mockToast.warning).toHaveBeenCalledTimes(1);
        const [title, detail] = mockToast.warning.mock.calls[0];
        expect(title).toMatch(/還原/);
        expect(title).toContain('1'); // count of remaining
        expect(title).toMatch(/仍在垃圾桶/);
        // Detail should explain how to recover the rest.
        expect(detail).toMatch(/單獨/);

        // Plain success toast must NOT fire — we'd be lying to the user.
        expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('restore via lecture-confirm path: success toast when nothing remains in trash', async () => {
        const lec = makeLecture({
            id: 'lec-cascaded',
            title: 'Cascaded Lecture',
            course_id: 'course-1',
        });
        const courseDead = makeCourse({ id: 'course-1', title: 'Dead Course' });
        setupInvoke({
            trashedLectures: [lec],
            trashedCourses: [courseDead],
            restoreCourseCount: 1,
            remainingAfterRestore: [], // clean restore — no orphaned trash
        });
        mockConfirm.ask.mockResolvedValueOnce(true);

        render(<PData />);
        await flush();

        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        await act(async () => {
            fireEvent.click(restoreBtns[restoreBtns.length - 1]);
        });
        await flush(8);

        // The clean-restore path should fire the green success toast,
        // not the warning toast.
        expect(mockToast.success).toHaveBeenCalledTimes(1);
        expect(mockToast.warning).not.toHaveBeenCalled();
    });

    it('restore_course handler probes list_trashed_lectures_in_course with the right course id', async () => {
        const courseDead = makeCourse({ id: 'course-2', title: 'Course Two' });
        const invokeSpy = setupInvoke({
            trashedCourses: [courseDead],
            restoreCourseCount: 0,
            remainingAfterRestore: [],
        });

        render(<PData />);
        await flush();

        // Click the course-row 還原 button. With no lectures and one
        // dead course, there should be exactly one 還原 button.
        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        await act(async () => {
            fireEvent.click(restoreBtns[0]);
        });
        await flush(8);

        const probe = invokeSpy.mock.calls.find(
            ([cmd]) => cmd === 'list_trashed_lectures_in_course',
        );
        expect(probe).toBeTruthy();
        expect(probe?.[1]).toEqual({
            courseId: 'course-2',
            userId: 'default_user',
        });
    });

    it('restore_course handler tolerates list_trashed_lectures_in_course IPC failure', async () => {
        // The probe is best-effort — if it fails, we still want the
        // success path to fire so the user isn't left without any
        // feedback.
        const courseDead = makeCourse({ id: 'course-3', title: 'Course Three' });
        vi.spyOn(core, 'invoke').mockImplementation(
            async (cmd: string, _args?: unknown) => {
                if (cmd === 'list_trashed_lectures') {
                    return [] as unknown as never;
                }
                if (cmd === 'list_deleted_courses' || cmd === 'list_trashed_courses') {
                    return [courseDead] as unknown as never;
                }
                if (cmd === 'restore_course') {
                    return 0 as unknown as never;
                }
                if (cmd === 'list_trashed_lectures_in_course') {
                    throw new Error('IPC down');
                }
                return null as unknown as never;
            },
        );

        render(<PData />);
        await flush();

        const restoreBtns = screen.getAllByRole('button', { name: '還原' });
        await act(async () => {
            fireEvent.click(restoreBtns[0]);
        });
        await flush(8);

        // Probe failure → fall back to success toast (remaining
        // defaults to [] so we treat it as a clean restore). Don't
        // throw, don't fire a confusing error toast.
        expect(mockToast.success).toHaveBeenCalledTimes(1);
        expect(mockToast.error).not.toHaveBeenCalled();
    });
});

// silence unused import warning for `within` (kept for future expansion).
void within;
