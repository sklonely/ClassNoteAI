/**
 * CourseDetailView regression tests — syllabus four-state machine.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §CourseDetailView — syllabus lifecycle rendering):
 *
 *   - #98  the four-state machine added in alpha.9 (idle / generating /
 *          ready / failed) must render the right UI for each branch.
 *          Pre-#98 the UI was "syllabus_info ? tree : pulse-forever-or-empty",
 *          which lied to users when generation had actually failed.
 *
 *   - back-compat invariant: courses saved BEFORE alpha.9 (no
 *          `_classnote_status` meta key) must still render as 'ready'
 *          when they have real content. We have ~all alpha-cohort users
 *          with this shape; treating their data as 'idle' would wipe
 *          their syllabus tree from view.
 *
 *   - retry button: click → calls retryCourseSyllabusGeneration; disabled
 *     while in flight; toast on error.
 *
 *   - classnote-course-updated event: refreshes only when courseId matches
 *     (cross-course event leakage would wreck performance + cause render
 *     thrash if a user has many courses open across tabs).
 *
 * Stack: vitest + testing-library/react + user-event. storageService is
 * mocked at module boundary so we drive the lifecycle deterministically
 * without hitting the Tauri invoke layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Course, Lecture } from '../../types';

// CourseCreationDialog (rendered as the edit dialog inside this component)
// eagerly imports pdfService at module top-level, which pulls in pdfjs-dist
// and explodes under jsdom because of the missing DOMMatrix global. Mock it
// out at the module boundary — none of these tests open the edit dialog.
vi.mock('../../services/pdfService', () => ({
    pdfService: {
        extractText: vi.fn(() => Promise.resolve('')),
        extractAllPagesText: vi.fn(() => Promise.resolve([])),
    },
}));

vi.mock('../../services/llm', () => ({
    extractKeywords: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../services/storageService', async () => {
    // Re-export the real lifecycle helpers (pure functions); mock the
    // class instance methods that hit Tauri.
    const actual = await vi.importActual<typeof import('../../services/storageService')>(
        '../../services/storageService',
    );
    return {
        ...actual,
        storageService: {
            getCourse: vi.fn(),
            listLecturesByCourse: vi.fn(() => Promise.resolve([])),
            retryCourseSyllabusGeneration: vi.fn(),
            saveCourse: vi.fn(() => Promise.resolve()),
            saveCourseWithSyllabus: vi.fn(() => Promise.resolve()),
            deleteLecture: vi.fn(() => Promise.resolve()),
        },
    };
});

import CourseDetailView from '../CourseDetailView';
import { storageService } from '../../services/storageService';
import { toastService } from '../../services/toastService';

const mockedStorage = vi.mocked(storageService);

function makeCourse(overrides: Partial<Course> = {}): Course {
    return {
        id: 'course-1',
        user_id: 'test-user',
        title: 'Physics 101',
        description: 'Intro physics',
        keywords: 'physics, mechanics',
        syllabus_info: undefined,
        is_deleted: false,
        created_at: '2026-04-22T00:00:00Z',
        updated_at: '2026-04-22T00:00:00Z',
        ...overrides,
    };
}

async function renderDetail(course: Course, lectures: Lecture[] = []) {
    mockedStorage.getCourse.mockResolvedValue(course);
    mockedStorage.listLecturesByCourse.mockResolvedValue(lectures);
    const utils = render(
        <CourseDetailView
            courseId={course.id}
            onBack={vi.fn()}
            onSelectLecture={vi.fn()}
            onCreateLecture={vi.fn()}
        />,
    );
    // Wait for the initial loadData() promise to settle and the loading
    // spinner to be replaced by the real content.
    await waitFor(() => expect(mockedStorage.getCourse).toHaveBeenCalled());
    await waitFor(() =>
        expect(screen.queryByRole('heading', { name: course.title, level: 1 })).toBeInTheDocument(),
    );
    return utils;
}

beforeEach(() => {
    // Real toast methods return number (toast id); mock impls must too.
    vi.spyOn(toastService, 'error').mockImplementation(() => 0);
    vi.spyOn(toastService, 'success').mockImplementation(() => 0);
});

afterEach(() => {
    cleanup();
});

describe('CourseDetailView — syllabus lifecycle rendering (regression #98)', () => {
    describe('state = ready', () => {
        it('renders the structured tree when syllabus has content', async () => {
            await renderDetail(
                makeCourse({
                    syllabus_info: {
                        topic: 'Newtonian mechanics',
                        time: '週一 09:00–11:00',
                        instructor: 'Dr. Newton',
                    },
                }),
            );

            expect(screen.getByText('Newtonian mechanics')).toBeInTheDocument();
            expect(screen.getByText('週一 09:00–11:00')).toBeInTheDocument();
            expect(screen.getByText('Dr. Newton')).toBeInTheDocument();
            // Should NOT show the empty-state copy.
            expect(screen.queryByText('暫無課程大綱信息')).not.toBeInTheDocument();
            // Should NOT show the generating spinner.
            expect(screen.queryByText('AI 正在生成課程大綱...')).not.toBeInTheDocument();
        });

        it('renders ONLY the topic block when only topic is present', async () => {
            await renderDetail(
                makeCourse({
                    syllabus_info: { topic: 'Topic only' },
                }),
            );

            expect(screen.getByText('Topic only')).toBeInTheDocument();
            // No accidental empty siblings — instructor / location / etc.
            // labels should be absent because their values aren't set.
            expect(screen.queryByText('Dr. Newton')).not.toBeInTheDocument();
        });
    });

    describe('state = generating', () => {
        it('shows the pulse + description text when description exists', async () => {
            await renderDetail(
                makeCourse({
                    description: 'A detailed description',
                    syllabus_info: {
                        // The internal lifecycle meta key — cast around the
                        // public SyllabusInfo type, same trick as the
                        // storageService unit tests.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        _classnote_status: 'generating',
                    } as any,
                }),
            );

            expect(screen.getByText('AI 正在生成課程大綱...')).toBeInTheDocument();
            expect(screen.getByText('A detailed description')).toBeInTheDocument();
        });

        it('shows the pulse alone when there is no description', async () => {
            await renderDetail(
                makeCourse({
                    description: '',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    syllabus_info: { _classnote_status: 'generating' } as any,
                }),
            );

            expect(screen.getByText('AI 正在生成課程大綱...')).toBeInTheDocument();
            // Empty-state copy should NOT appear during generation.
            expect(screen.queryByText('暫無課程大綱信息')).not.toBeInTheDocument();
        });
    });

    describe('state = failed', () => {
        it('shows the failure reason and retry button', async () => {
            await renderDetail(
                makeCourse({
                    syllabus_info: {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        _classnote_status: 'failed',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        _classnote_error_message: 'LLM timeout after 90s',
                    } as any,
                }),
            );

            expect(screen.getByText('生成失敗')).toBeInTheDocument();
            expect(screen.getByText('LLM timeout after 90s')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /重試生成/ })).toBeEnabled();
        });

        it('falls back to "生成失敗" when no error message is stored', async () => {
            await renderDetail(
                makeCourse({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    syllabus_info: { _classnote_status: 'failed' } as any,
                }),
            );

            // The failure heading is always rendered; the error message
            // sub-line is only rendered when present.
            expect(screen.getByText('生成失敗')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /重試生成/ })).toBeEnabled();
        });

        it('retry click calls retryCourseSyllabusGeneration and reloads', async () => {
            const user = userEvent.setup();
            mockedStorage.retryCourseSyllabusGeneration.mockResolvedValue(undefined);

            const failedCourse = makeCourse({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                syllabus_info: { _classnote_status: 'failed', _classnote_error_message: 'X' } as any,
            });
            const refreshedCourse = makeCourse({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                syllabus_info: { _classnote_status: 'generating' } as any,
            });

            await renderDetail(failedCourse);

            // Retry click → calls API + re-fetches via getCourse(id)
            mockedStorage.getCourse.mockResolvedValueOnce(refreshedCourse);
            await user.click(screen.getByRole('button', { name: /重試生成/ }));

            expect(mockedStorage.retryCourseSyllabusGeneration).toHaveBeenCalledWith('course-1');
            // After reload, generating spinner should appear
            await waitFor(() =>
                expect(screen.getByText('AI 正在生成課程大綱...')).toBeInTheDocument(),
            );
        });

        it('retry failure surfaces a toast and does not crash', async () => {
            const user = userEvent.setup();
            mockedStorage.retryCourseSyllabusGeneration.mockRejectedValue(
                new Error('LLM provider unreachable'),
            );

            await renderDetail(
                makeCourse({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    syllabus_info: { _classnote_status: 'failed' } as any,
                }),
            );

            await user.click(screen.getByRole('button', { name: /重試生成/ }));

            await waitFor(() =>
                expect(toastService.error).toHaveBeenCalledWith(
                    '重試失敗',
                    'LLM provider unreachable',
                ),
            );
            // Button should be re-enabled after the failure (NOT stuck disabled).
            await waitFor(() =>
                expect(screen.getByRole('button', { name: /重試生成/ })).toBeEnabled(),
            );
        });

        it('retry button is disabled while a retry is in flight', async () => {
            const user = userEvent.setup();
            // Hold the promise open so we can observe the disabled state.
            let resolveRetry: () => void = () => { };
            mockedStorage.retryCourseSyllabusGeneration.mockReturnValueOnce(
                new Promise<void>((res) => { resolveRetry = res; }),
            );

            await renderDetail(
                makeCourse({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    syllabus_info: { _classnote_status: 'failed' } as any,
                }),
            );

            await user.click(screen.getByRole('button', { name: /重試生成/ }));
            // Disabled + spinner-label form
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /重試中/ })).toBeDisabled();
            });
            resolveRetry();
        });
    });

    describe('state = idle', () => {
        // NOTE: in the idle branch the current alpha.9 component renders
        // ONLY the "暫無課程大綱信息" copy regardless of whether
        // course.description is set. Pre-alpha.9 code rendered the
        // description text in this slot too. This may or may not be a
        // deliberate UX choice — flagging here so a future commit can
        // decide whether to restore the description rendering. For now
        // these assertions match what the component actually does.
        it('renders the empty-state copy in the idle branch (description currently NOT shown)', async () => {
            await renderDetail(
                makeCourse({
                    description: 'Plain description, no syllabus parsed yet.',
                    syllabus_info: undefined,
                }),
            );

            expect(screen.getByText('暫無課程大綱信息')).toBeInTheDocument();
            // Should NOT show generating spinner.
            expect(screen.queryByText('AI 正在生成課程大綱...')).not.toBeInTheDocument();
        });

        it('renders the empty-state copy when description AND syllabus are both empty', async () => {
            await renderDetail(
                makeCourse({
                    description: '',
                    syllabus_info: undefined,
                }),
            );

            expect(screen.getByText('暫無課程大綱信息')).toBeInTheDocument();
        });
    });

    describe('regression — back-compat with pre-alpha.9 courses', () => {
        // Courses saved before alpha.9 don't have any `_classnote_*` meta
        // keys; they're just `{ topic, schedule, ... }`. The state machine
        // must infer 'ready' from "has content" so existing user data
        // doesn't disappear after the upgrade.
        it('renders pre-alpha.9 syllabus_info shape as ready', async () => {
            await renderDetail(
                makeCourse({
                    syllabus_info: {
                        topic: 'Pre-alpha.9 topic',
                        schedule: ['Week 1: setup', 'Week 2: linear algebra'],
                    },
                }),
            );

            expect(screen.getByText('Pre-alpha.9 topic')).toBeInTheDocument();
            expect(screen.getByText('Week 1: setup')).toBeInTheDocument();
            expect(screen.getByText('Week 2: linear algebra')).toBeInTheDocument();
            // Critical: do NOT show the empty-state copy when there's content.
            expect(screen.queryByText('暫無課程大綱信息')).not.toBeInTheDocument();
        });
    });

    describe('classnote-course-updated event listener', () => {
        it('reloads when the event matches our courseId', async () => {
            await renderDetail(makeCourse({ id: 'course-1' }));
            // First load already happened via render.
            const callsBefore = mockedStorage.getCourse.mock.calls.length;

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('classnote-course-updated', {
                        detail: { courseId: 'course-1' },
                    }),
                );
            });
            await waitFor(() =>
                expect(mockedStorage.getCourse.mock.calls.length).toBeGreaterThan(callsBefore),
            );
        });

        it('ignores events for a different courseId', async () => {
            await renderDetail(makeCourse({ id: 'course-1' }));
            const callsBefore = mockedStorage.getCourse.mock.calls.length;

            await act(async () => {
                window.dispatchEvent(
                    new CustomEvent('classnote-course-updated', {
                        detail: { courseId: 'OTHER-COURSE' },
                    }),
                );
            });
            // Give the event loop a tick — if the listener fires, it would
            // call getCourse synchronously with the courseId.
            await new Promise((res) => setTimeout(res, 30));
            expect(mockedStorage.getCourse.mock.calls.length).toBe(callsBefore);
        });
    });
});
