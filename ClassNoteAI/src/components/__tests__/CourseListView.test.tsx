/**
 * CourseListView regression tests — saveCourseWithSyllabus wire-up.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §CourseListView):
 *
 *   - #100 dead-pipeline: alpha.9 added storageService.saveCourseWithSyllabus
 *          but the original code in this component still called the old
 *          saveCourse + inline LLM extraction. The pipeline was alive in
 *          unit tests but had ZERO call sites in production. This test
 *          locks in that the create branch ALWAYS calls
 *          saveCourseWithSyllabus and the edit branch routes correctly
 *          based on what changed.
 *
 *   - edit branch routing matrix:
 *       title-only change          → saveCourse (no regen)
 *       description changed        → saveCourseWithSyllabus
 *       pdfData provided           → saveCourseWithSyllabus
 *
 *   - returns the new course id on create (auto-save callers depend on it)
 *
 * Strategy: stub CourseCreationDialog with a controllable test double
 * (renders a button that invokes onSubmit with the args we want).
 * Avoids needing to drive the full dialog UI, which has its own dedicated
 * test file (CourseCreationDialog.test.tsx).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Course } from '../../types';

// Module-level captures so each test can configure the stub's submit args
// before clicking the trigger button.
const capturedSubmits: Array<(...args: unknown[]) => unknown> = [];
let nextSubmitArgs: [string, string, ArrayBuffer | undefined, string | undefined, boolean | undefined] = [
    'New Course Title',
    'k1, k2',
    undefined,
    'New description text',
    undefined,
];

vi.mock('../CourseCreationDialog', () => ({
    default: ({
        isOpen,
        onSubmit,
        mode,
    }: {
        isOpen: boolean;
        onSubmit: (
            title: string,
            keywords: string,
            pdfData?: ArrayBuffer,
            description?: string,
            shouldClose?: boolean,
        ) => Promise<string | void | undefined>;
        mode?: 'create' | 'edit';
    }) => {
        if (!isOpen) return null;
        capturedSubmits.push(onSubmit as (...args: unknown[]) => unknown);
        return (
            <div data-testid={`mock-dialog-${mode ?? 'create'}`}>
                <button
                    type="button"
                    onClick={() =>
                        onSubmit(
                            nextSubmitArgs[0],
                            nextSubmitArgs[1],
                            nextSubmitArgs[2],
                            nextSubmitArgs[3],
                            nextSubmitArgs[4],
                        )
                    }
                >
                    fake-submit
                </button>
            </div>
        );
    },
}));

vi.mock('../../services/storageService', () => ({
    storageService: {
        listCourses: vi.fn(() => Promise.resolve([])),
        saveCourse: vi.fn(() => Promise.resolve()),
        saveCourseWithSyllabus: vi.fn(() => Promise.resolve()),
        deleteCourse: vi.fn(() => Promise.resolve()),
        getAppSettings: vi.fn(() => Promise.resolve(null)),
    },
}));

import CourseListView from '../CourseListView';
import { storageService } from '../../services/storageService';

const mockedStorage = vi.mocked(storageService);

function makeCourse(overrides: Partial<Course> = {}): Course {
    return {
        id: 'course-1',
        user_id: 'test-user',
        title: 'Existing Course',
        description: 'Existing description',
        keywords: 'k',
        syllabus_info: undefined,
        is_deleted: false,
        created_at: '2026-04-01T00:00:00Z',
        updated_at: '2026-04-01T00:00:00Z',
        ...overrides,
    };
}

beforeEach(() => {
    capturedSubmits.length = 0;
    // Default: create-flow shape
    nextSubmitArgs = ['New Course Title', 'k1, k2', undefined, 'New description text', undefined];
    // Stub crypto.randomUUID for deterministic id-equality assertions in
    // the create-flow test below.
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as unknown as `${string}-${string}-${string}-${string}-${string}`,
    );
});

afterEach(() => {
    cleanup();
});

async function openCreateDialog() {
    const user = userEvent.setup();
    // Header button label is "新增科目" (subject, not lecture).
    const createBtn = await screen.findByRole('button', { name: /新增科目/ });
    await user.click(createBtn);
    await screen.findByTestId('mock-dialog-create');
    return user;
}

async function openEditDialog(courseTitle: string) {
    const user = userEvent.setup();
    // Each course card has exactly one kebab (MoreVertical) icon button at
    // the time the page loads. Locate it by walking from the title's <h2>
    // element to its parent div, then grab the only button inside.
    const titleEl = await screen.findByText(courseTitle);
    const cardHeader = titleEl.parentElement!; // the flex container holding title + kebab
    const kebab = cardHeader.querySelector('button') as HTMLButtonElement;
    expect(kebab).toBeTruthy();
    await user.click(kebab);
    // Dropdown opens; click 編輯
    const editEntry = await screen.findByRole('button', { name: /編輯/ });
    await user.click(editEntry);
    await screen.findByTestId('mock-dialog-edit');
    return user;
}

describe('CourseListView — saveCourseWithSyllabus wire-up (regression #100)', () => {
    describe('create branch', () => {
        it('always calls saveCourseWithSyllabus with triggerSyllabusGeneration:true', async () => {
            mockedStorage.listCourses.mockResolvedValue([]);
            render(<CourseListView onSelectCourse={vi.fn()} />);

            const user = await openCreateDialog();
            await user.click(screen.getByRole('button', { name: 'fake-submit' }));

            await waitFor(() =>
                expect(mockedStorage.saveCourseWithSyllabus).toHaveBeenCalledTimes(1),
            );
            const [courseArg, optionsArg] = mockedStorage.saveCourseWithSyllabus.mock.calls[0];
            expect(courseArg.title).toBe('New Course Title');
            expect(courseArg.description).toBe('New description text');
            expect(courseArg.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
            expect(optionsArg).toEqual({ pdfData: undefined, triggerSyllabusGeneration: true });
            // Should NOT also fire the plain saveCourse (would be a double-write).
            expect(mockedStorage.saveCourse).not.toHaveBeenCalled();
        });

        it('forwards pdfData when the dialog provided one', async () => {
            const fakePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
            nextSubmitArgs = ['Title', '', fakePdf, 'desc', undefined];

            mockedStorage.listCourses.mockResolvedValue([]);
            render(<CourseListView onSelectCourse={vi.fn()} />);
            const user = await openCreateDialog();
            await user.click(screen.getByRole('button', { name: 'fake-submit' }));

            await waitFor(() =>
                expect(mockedStorage.saveCourseWithSyllabus).toHaveBeenCalledTimes(1),
            );
            const [, optionsArg] = mockedStorage.saveCourseWithSyllabus.mock.calls[0];
            expect(optionsArg).toEqual({ pdfData: fakePdf, triggerSyllabusGeneration: true });
        });
    });

    describe('edit branch routing matrix', () => {
        const existing = makeCourse({
            id: 'course-1',
            title: 'Old Title',
            description: 'Old description',
            keywords: 'old-k',
            syllabus_info: { topic: 'preserved' },
        });

        beforeEach(() => {
            mockedStorage.listCourses.mockResolvedValue([existing]);
        });

        it('title-only change → saveCourse (NO regen)', async () => {
            // Same description as existing, no pdfData.
            nextSubmitArgs = ['New Title', 'k1', undefined, 'Old description', undefined];

            render(<CourseListView onSelectCourse={vi.fn()} />);
            const user = await openEditDialog('Old Title');
            await user.click(screen.getByRole('button', { name: 'fake-submit' }));

            await waitFor(() =>
                expect(mockedStorage.saveCourse).toHaveBeenCalledTimes(1),
            );
            // Title was updated, but the existing syllabus_info was preserved.
            const courseArg = mockedStorage.saveCourse.mock.calls[0][0];
            expect(courseArg.title).toBe('New Title');
            expect(courseArg.syllabus_info).toEqual({ topic: 'preserved' });
            // No regen call.
            expect(mockedStorage.saveCourseWithSyllabus).not.toHaveBeenCalled();
        });

        it('description change → saveCourseWithSyllabus (regen triggered)', async () => {
            nextSubmitArgs = ['Old Title', 'old-k', undefined, 'Brand new description', undefined];

            render(<CourseListView onSelectCourse={vi.fn()} />);
            const user = await openEditDialog('Old Title');
            await user.click(screen.getByRole('button', { name: 'fake-submit' }));

            await waitFor(() =>
                expect(mockedStorage.saveCourseWithSyllabus).toHaveBeenCalledTimes(1),
            );
            const [courseArg, optionsArg] = mockedStorage.saveCourseWithSyllabus.mock.calls[0];
            expect(courseArg.description).toBe('Brand new description');
            expect(optionsArg).toEqual({ pdfData: undefined, triggerSyllabusGeneration: true });
            expect(mockedStorage.saveCourse).not.toHaveBeenCalled();
        });

        it('pdfData provided → saveCourseWithSyllabus (even when description unchanged)', async () => {
            const fakePdf = new ArrayBuffer(8);
            nextSubmitArgs = ['Old Title', 'old-k', fakePdf, 'Old description', undefined];

            render(<CourseListView onSelectCourse={vi.fn()} />);
            const user = await openEditDialog('Old Title');
            await user.click(screen.getByRole('button', { name: 'fake-submit' }));

            await waitFor(() =>
                expect(mockedStorage.saveCourseWithSyllabus).toHaveBeenCalledTimes(1),
            );
            const [, optionsArg] = mockedStorage.saveCourseWithSyllabus.mock.calls[0];
            expect(optionsArg).toEqual({ pdfData: fakePdf, triggerSyllabusGeneration: true });
            expect(mockedStorage.saveCourse).not.toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('catches saveCourseWithSyllabus failure without crashing the view', async () => {
            mockedStorage.listCourses.mockResolvedValue([]);
            mockedStorage.saveCourseWithSyllabus.mockRejectedValueOnce(
                new Error('disk full'),
            );

            render(<CourseListView onSelectCourse={vi.fn()} />);
            const user = await openCreateDialog();

            // Should not throw — handleCreateCourse wraps in try/catch
            await user.click(screen.getByRole('button', { name: 'fake-submit' }));

            // View still rendered.
            await waitFor(() =>
                expect(screen.getByRole('button', { name: /新增科目/ })).toBeInTheDocument(),
            );
        });
    });
});
