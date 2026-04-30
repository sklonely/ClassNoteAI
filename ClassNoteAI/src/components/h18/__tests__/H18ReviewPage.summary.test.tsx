/**
 * H18ReviewPage summary streaming + retry tests · Phase 7 Sprint 2 R3
 *
 * 涵蓋 S2.4 (streaming summary subscribe) + S2.6 (retry button) + S2.7
 * (cancel-on-regen) + S2.10 (lecture.status='failed'/'stopping' UI).
 *
 *   1. summary task running → 顯示「✦ 摘要生成中 · 約 X%」
 *   2. summary task done → reload note + render note.summary
 *   3. summary task failed → 顯示「✦ 失敗 · 重試」 button
 *   4. retry button → cancel 舊 task + start 新 task (spy taskTracker)
 *   5. 重新生成 button → cancel running summarize + start 新
 *   6. lecture.status='failed' → 顯示 hero failed banner
 *   7. lecture.status='completed' → 不顯示 failed banner
 *   8. lecture.status='stopping' → 顯示 stopping hint
 *
 * 由於 H18ReviewPage 是 600+ 行 component，我們 mock 掉所有外部 service
 * (storageService / examMarksStore / audioPathService / userNotesStore /
 * llm/tasks / convertFileSrc) 跟 H18AudioPlayer / RecoveryHintBanner /
 * H18RecordingPage，只留下 taskTrackerService + recordingSessionService
 * 真 singleton 跑（直接驗其互動）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Lecture, Note, Subtitle, Course } from '../../../types';

// ─── Mocks (must be before component import) ─────────────────────────

const mockLecture = (status: Lecture['status']): Lecture => ({
    id: 'L1',
    course_id: 'C1',
    title: 'Test Lecture',
    date: '2026-04-28',
    duration: 600,
    status,
    created_at: '2026-04-28T00:00:00.000Z',
    updated_at: '2026-04-28T00:00:00.000Z',
    is_deleted: false,
});

const mockCourse: Course = {
    id: 'C1',
    user_id: 'user-1',
    title: 'Test Course',
    created_at: '2026-04-28T00:00:00.000Z',
    updated_at: '2026-04-28T00:00:00.000Z',
    is_deleted: false,
};

const mockSubtitles: Subtitle[] = [
    {
        id: 'sub-1',
        lecture_id: 'L1',
        timestamp: 0,
        text_en: 'Hello world this is a test sentence used to drive a long enough transcript for summarisation.',
        text_zh: '你好這是測試句子，用來讓逐字稿夠長以驅動摘要產生。',
        type: 'fine',
        created_at: '2026-04-28T00:00:00.000Z',
    },
];

const mockNoteWithSummary: Note = {
    lecture_id: 'L1',
    title: 'Test Lecture',
    summary: '這堂課重點摘要 — 測試固定字串。',
    sections: [],
    qa_records: [],
    generated_at: '2026-04-28T01:00:00.000Z',
};

let currentLectureStatus: Lecture['status'] = 'completed';
let currentNote: Note | null = null;

vi.mock('../../../services/storageService', () => ({
    storageService: {
        getLecture: vi.fn(async () => mockLecture(currentLectureStatus)),
        getCourse: vi.fn(async () => mockCourse),
        getSubtitles: vi.fn(async () => mockSubtitles),
        getNote: vi.fn(async () => currentNote),
        saveNote: vi.fn(async (n: Note) => {
            currentNote = n;
        }),
        getAppSettings: vi.fn(async () => ({
            translation: { target_language: 'zh-TW' },
        })),
    },
}));

// audioPathService — never resolves so audio tab stays in "no audio".
vi.mock('../../../services/audioPathService', () => ({
    resolveOrRecoverAudioPath: vi.fn(async () => ({ resolvedPath: null })),
}));

// convertFileSrc — short-circuit.
vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => `tauri://${p}`),
}));

// userNotesStore — empty notes draft.
vi.mock('../userNotesStore', () => ({
    loadUserNotes: vi.fn(() => ''),
    saveUserNotes: vi.fn(),
    subscribeUserNotes: vi.fn(() => () => {}),
}));

// examMarksStore — empty marks.
vi.mock('../../../services/examMarksStore', () => ({
    getExamMarks: vi.fn(() => []),
    subscribeExamMarks: vi.fn(() => () => {}),
}));

// llm/tasks — mock summarizeStream + summarize + segmentSections.
// Default: yield one delta + done; segmenter returns null so the path
// falls back to summary's ## headings (matches pre-cp75.17 behaviour
// these tests were written against).
//
// cp75.32 — added generateQA + extractActionItems stubs returning [] so
// existing summary tests are unaffected (they only assert summary state,
// not Q&A). Tests that want to verify Q&A wiring can override per-test.
vi.mock('../../../services/llm/tasks', () => ({
    summarizeStream: vi.fn(async function* () {
        yield { phase: 'reduce-delta', delta: '## 摘要\n' };
        yield { phase: 'reduce-delta', delta: '本堂課重點...' };
        yield { phase: 'done', fullText: '## 摘要\n本堂課重點...' };
    }),
    summarize: vi.fn(async () => '## 摘要\n本堂課重點...'),
    segmentSections: vi.fn(async () => null),
    generateQA: vi.fn(async () => []),
    extractActionItems: vi.fn(async () => []),
}));

// H18AudioPlayer — heavy media component, stub.
vi.mock('../H18AudioPlayer', () => ({
    default: () => null,
}));

// H18RecordingPage — when status='recording' it renders this; we mock it.
vi.mock('../H18RecordingPage', () => ({
    default: () => <div data-testid="recording-page" />,
}));

// RecoveryHintBanner — gates on localStorage flag, but mock to noop.
vi.mock('../RecoveryHintBanner', () => ({
    RecoveryHintBanner: () => null,
}));

// ─── Imports (after mocks) ───────────────────────────────────────────
import H18ReviewPage from '../H18ReviewPage';
import { taskTrackerService } from '../../../services/taskTrackerService';
import { recordingSessionService } from '../../../services/recordingSessionService';

beforeEach(() => {
    taskTrackerService.reset();
    recordingSessionService.reset();
    currentLectureStatus = 'completed';
    currentNote = null;
    vi.clearAllMocks();
});

afterEach(() => {
    taskTrackerService.reset();
    recordingSessionService.reset();
});

// Drain async microtasks queued by useEffect setState calls so DOM has
// the latest state. The component awaits Promise.all(getLecture / getCourse
// / getSubtitles / getNote) at mount.
async function flushAsync(times = 4) {
    for (let i = 0; i < times; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

function switchToSummaryTab() {
    const summaryTab = screen.getByRole('button', { name: /AI 摘要/ });
    fireEvent.click(summaryTab);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('H18ReviewPage · summary streaming subscribe (S2.4)', () => {
    it('shows progress hint when an active summarize task matches lectureId', async () => {
        currentNote = null;

        // Pre-register an active task for this lecture before mount so the
        // subscriber sees it on first render.
        const taskId = taskTrackerService.start({
            kind: 'summarize',
            label: '生成課堂摘要',
            lectureId: 'L1',
        });
        taskTrackerService.update(taskId, { progress: 0.45, status: 'running' });

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        switchToSummaryTab();

        // 「✦ 摘要生成中 · 約 45%」(allow whitespace flexibility)
        expect(
            screen.getByText(/摘要生成中/),
        ).toBeInTheDocument();
        expect(screen.getByText(/45/)).toBeInTheDocument();
    });

    it('reloads note + renders summary text when task transitions to done', async () => {
        currentNote = null;
        const taskId = taskTrackerService.start({
            kind: 'summarize',
            label: '生成課堂摘要',
            lectureId: 'L1',
        });
        taskTrackerService.update(taskId, { status: 'running', progress: 0.5 });

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        // Now flip to done — but first arm storage so the reload picks
        // up the new note.
        currentNote = mockNoteWithSummary;
        await act(async () => {
            taskTrackerService.complete(taskId);
        });
        await flushAsync();

        expect(
            screen.getByText('這堂課重點摘要 — 測試固定字串。'),
        ).toBeInTheDocument();
    });
});

describe('H18ReviewPage · summary failed retry (S2.6)', () => {
    it('shows error banner with retry button when task is failed', async () => {
        currentNote = null;
        const taskId = taskTrackerService.start({
            kind: 'summarize',
            label: '生成摘要',
            lectureId: 'L1',
        });
        taskTrackerService.update(taskId, { status: 'running' });
        taskTrackerService.fail(taskId, 'rate limit');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        expect(screen.getByRole('alert')).toHaveTextContent(/rate limit/);
        expect(
            screen.getByRole('button', { name: /重試/ }),
        ).toBeInTheDocument();
    });

    it('retry button cancels failed task + starts new summarize task', async () => {
        currentNote = null;
        const failedId = taskTrackerService.start({
            kind: 'summarize',
            label: '生成摘要',
            lectureId: 'L1',
        });
        taskTrackerService.fail(failedId, 'oops');

        const cancelSpy = vi.spyOn(taskTrackerService, 'cancel');
        const startSpy = vi.spyOn(taskTrackerService, 'start');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        const retryBtn = screen.getByRole('button', { name: /重試/ });
        await act(async () => {
            fireEvent.click(retryBtn);
        });
        await flushAsync();

        expect(cancelSpy).toHaveBeenCalledWith(failedId);
        expect(startSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'summarize',
                lectureId: 'L1',
            }),
        );
    });
});

describe('H18ReviewPage · cancel-on-regen (S2.7)', () => {
    it('regenerate button cancels existing summarize task + starts new', async () => {
        currentNote = mockNoteWithSummary;
        const oldId = taskTrackerService.start({
            kind: 'summarize',
            label: '生成摘要',
            lectureId: 'L1',
        });
        taskTrackerService.update(oldId, { status: 'running' });

        const cancelSpy = vi.spyOn(taskTrackerService, 'cancel');
        const startSpy = vi.spyOn(taskTrackerService, 'start');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // cp75.31 — 「✦ 重新生成」 button moved to top-level header (split
        // button next to ▶ 回放錄音). Click the primary half (which has
        // visible "✦ 重新生成" text), not the chevron (aria-label only).
        const btns = screen.getAllByRole('button');
        const regenBtn = btns.find(
            (b) =>
                b.textContent != null &&
                /^✦?\s*(重新生成|生成摘要|生成中)/.test(
                    b.textContent.trim(),
                ),
        );
        expect(regenBtn).toBeDefined();
        await act(async () => {
            fireEvent.click(regenBtn!);
        });
        await flushAsync();

        expect(cancelSpy).toHaveBeenCalledWith(oldId);
        expect(startSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'summarize',
                lectureId: 'L1',
            }),
        );
    });
});

describe('H18ReviewPage · lecture.status banner (S2.10)', () => {
    it('shows hero failed banner when lecture.status="failed"', async () => {
        currentLectureStatus = 'failed';
        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(
            screen.getByText(/此堂課儲存時發生錯誤/),
        ).toBeInTheDocument();
    });

    it('does NOT show failed banner when lecture.status="completed"', async () => {
        currentLectureStatus = 'completed';
        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(
            screen.queryByText(/此堂課儲存時發生錯誤/),
        ).toBeNull();
    });

    it('shows stopping hint when recording singleton is in stopping state for this lecture', async () => {
        currentLectureStatus = 'completed';
        recordingSessionService._setStateForTest({
            status: 'stopping',
            stopPhase: 'segment',
            lectureId: 'L1',
            courseId: 'C1',
            elapsed: 60,
            sessionStartMs: Date.now() - 60_000,
        });

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        expect(screen.getByText(/正在儲存課堂/)).toBeInTheDocument();
    });
});
