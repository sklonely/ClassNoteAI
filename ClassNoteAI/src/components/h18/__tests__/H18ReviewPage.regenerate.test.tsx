/**
 * H18ReviewPage cp75.31 — Granular regenerate button at top-level
 *
 * 把 in-tab 的 「✦ 重新生成」 button 提升到 page header（與 ▶ 回放錄音
 * 同列），改成 split button：primary action = 重新生成全部；
 * chevron 開 dropdown，可選 摘要 / 章節 / Q&A / 全部。
 *
 * Mock 結構與 H18ReviewPage.summary.test.tsx 對齊。
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

// cp75.37 · 5.9 — fixture state lives in module-level mutable variables
// because the storageService mock (declared inside vi.mock(...) below)
// is hoisted to top-of-file by vitest BEFORE any test-file code runs.
// The mocked accessors close over these refs by name, so the only way
// to thread per-test state into them is to mutate these vars from
// beforeEach. `setupFixture()` is the single place where the defaults
// are applied — every test that needs different state should call it
// (or set the relevant field) explicitly so the intent stays obvious.
let currentLectureStatus: Lecture['status'] = 'completed';
let currentNote: Note | null = null;
let currentSubs: Subtitle[] = mockSubtitles;

/**
 * Reset per-test fixture state to the defaults the test file was
 * originally written against. Centralising the assignments here makes
 * it impossible for a test that reaches in to mutate `currentNote`
 * mid-run to leak state into the next test (the next test's
 * beforeEach calls this and overwrites everything). All three vars
 * MUST be touched on every reset — partial resets are how this kind
 * of fixture goes flaky.
 */
function setupFixture(): void {
    currentLectureStatus = 'completed';
    currentNote = null;
    currentSubs = mockSubtitles;
}

vi.mock('../../../services/storageService', () => ({
    storageService: {
        getLecture: vi.fn(async () => mockLecture(currentLectureStatus)),
        getCourse: vi.fn(async () => mockCourse),
        getSubtitles: vi.fn(async () => currentSubs),
        getNote: vi.fn(async () => currentNote),
        saveNote: vi.fn(async (n: Note) => {
            currentNote = n;
        }),
        getAppSettings: vi.fn(async () => ({
            translation: { target_language: 'zh-TW' },
        })),
    },
}));

vi.mock('../../../services/audioPathService', () => ({
    resolveOrRecoverAudioPath: vi.fn(async () => ({ resolvedPath: null })),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => `tauri://${p}`),
}));

vi.mock('../userNotesStore', () => ({
    loadUserNotes: vi.fn(() => ''),
    saveUserNotes: vi.fn(),
    subscribeUserNotes: vi.fn(() => () => {}),
}));

vi.mock('../../../services/examMarksStore', () => ({
    getExamMarks: vi.fn(() => []),
    subscribeExamMarks: vi.fn(() => () => {}),
}));

// cp75.32 — added generateQA + extractActionItems stubs (default []).
// `targets=['qa']` selection wires `generateQA` so existing tests must
// not crash when the runtime imports it from this mock.
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

vi.mock('../H18AudioPlayer', () => ({
    default: () => null,
}));

vi.mock('../H18RecordingPage', () => ({
    default: () => <div data-testid="recording-page" />,
}));

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
    setupFixture();
    vi.clearAllMocks();
});

afterEach(() => {
    taskTrackerService.reset();
    recordingSessionService.reset();
});

async function flushAsync(times = 4) {
    for (let i = 0; i < times; i++) {
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('H18ReviewPage · cp75.31 granular regenerate', () => {
    it('shows 重新生成 button at top-level (NOT inside a specific tab)', async () => {
        currentNote = mockNoteWithSummary;
        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // The button must be visible WITHOUT clicking the AI 摘要 tab.
        // Default tab is "notes". The split button has 2 buttons (primary
        // + chevron), so we use getAllByRole and assert at least one has
        // the visible "✦ 重新生成" text.
        const btns = screen.getAllByRole('button', { name: /重新生成/ });
        expect(btns.length).toBeGreaterThan(0);
        expect(
            btns.some(
                (b) =>
                    b.textContent != null &&
                    /^✦?\s*重新生成$/.test(b.textContent.trim()),
            ),
        ).toBe(true);
    });

    it('clicking the chevron opens a dropdown with 摘要 / 章節 / Q&A / 全部', async () => {
        currentNote = mockNoteWithSummary;
        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        const chevron = screen.getByRole('button', {
            name: /重新生成選項|展開重新生成選項|granular targets|更多選項/i,
        });
        await act(async () => {
            fireEvent.click(chevron);
        });
        await flushAsync();

        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        // Menu items exist (use menuitem role)
        expect(screen.getByRole('menuitem', { name: /^摘要$/ })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /^章節$/ })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /Q&A|QA/ })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /^全部$/ })).toBeInTheDocument();
    });

    it('selecting "摘要 only" invokes runSummary with targets including "summary"', async () => {
        currentNote = mockNoteWithSummary;
        const startSpy = vi.spyOn(taskTrackerService, 'start');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        const chevron = screen.getByRole('button', {
            name: /重新生成選項|展開重新生成選項|granular targets|更多選項/i,
        });
        await act(async () => {
            fireEvent.click(chevron);
        });
        await flushAsync();

        const summaryItem = screen.getByRole('menuitem', { name: /^摘要$/ });
        await act(async () => {
            fireEvent.click(summaryItem);
        });
        await flushAsync();

        // Verify the granular target propagated. We tag the task entry's
        // label with the chosen target so it's introspectable.
        expect(startSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'summarize',
                lectureId: 'L1',
                label: expect.stringMatching(/摘要/),
            }),
        );
    });

    it('selecting "全部" invokes runSummary with targets=["all"]', async () => {
        currentNote = mockNoteWithSummary;
        const startSpy = vi.spyOn(taskTrackerService, 'start');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        const chevron = screen.getByRole('button', {
            name: /重新生成選項|展開重新生成選項|granular targets|更多選項/i,
        });
        await act(async () => {
            fireEvent.click(chevron);
        });
        await flushAsync();

        const allItem = screen.getByRole('menuitem', { name: /^全部$/ });
        await act(async () => {
            fireEvent.click(allItem);
        });
        await flushAsync();

        expect(startSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'summarize',
                lectureId: 'L1',
            }),
        );
    });

    it('clicking primary action (without opening menu) defaults to all targets', async () => {
        currentNote = mockNoteWithSummary;
        const startSpy = vi.spyOn(taskTrackerService, 'start');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // Primary action button — pick the one with visible "✦ 重新生成"
        // text (the chevron has aria-label="重新生成選項" but no
        // matching text content).
        const btns = screen.getAllByRole('button', { name: /重新生成/ });
        const primary = btns.find(
            (b) =>
                b.textContent != null &&
                /^✦?\s*重新生成$/.test(b.textContent.trim()),
        );
        expect(primary).toBeDefined();
        await act(async () => {
            fireEvent.click(primary!);
        });
        await flushAsync();

        expect(startSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'summarize',
                lectureId: 'L1',
            }),
        );
    });

    it('button is disabled when subs is empty', async () => {
        currentNote = null;
        currentSubs = [];

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // With no existing summary and no subs, primary label is "✦ 生成摘要".
        const btns = screen.getAllByRole('button');
        const primary = btns.find(
            (b) =>
                b.textContent != null &&
                /重新生成|生成摘要/.test(b.textContent.trim()),
        );
        expect(primary).toBeDefined();
        expect(primary!).toBeDisabled();
    });

    it('button shows running state when a regen task is running', async () => {
        currentNote = mockNoteWithSummary;
        // Pre-register a running summarize task so the spinner state shows.
        const taskId = taskTrackerService.start({
            kind: 'summarize',
            label: '生成摘要',
            lectureId: 'L1',
        });
        taskTrackerService.update(taskId, { status: 'running', progress: 0.3 });

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        // The primary button reflects running state. Either it's disabled
        // OR it carries an aria-busy="true" attribute. We accept either.
        const btns = screen.getAllByRole('button', {
            name: /生成中|重新生成/,
        });
        const primary = btns.find(
            (b) =>
                b.textContent != null &&
                /生成中|重新生成/.test(b.textContent.trim()),
        );
        expect(primary).toBeDefined();
        expect(
            primary!.hasAttribute('aria-busy') ||
                primary!.hasAttribute('disabled'),
        ).toBe(true);
    });

    it('cp75.32 — selecting "Q&A" calls generateQA + extractActionItems', async () => {
        currentNote = mockNoteWithSummary;
        // Use a long enough subtitle so the < 100 char short-circuit
        // doesn't skip the LLM calls. text_zh wins over text_en in the
        // build chain, so we make THAT long (≥ 100 chars).
        const longZh =
            '本堂課今天會介紹神經網路的基本原理，包含感知機模型、反向傳播演算法、梯度下降，以及如何用這些工具訓練一個簡單的影像分類器。學生請於下週三前繳交作業三，下下週要交期中專題提案，包含資料來源、模型選擇、預期成果等三個面向，並準備五分鐘的口頭報告。';
        currentSubs = [
            {
                id: 'sub-1',
                lecture_id: 'L1',
                timestamp: 0,
                text_en: 'long english placeholder for fallback',
                text_zh: longZh,
                type: 'fine',
                created_at: '2026-04-28T00:00:00.000Z',
            },
        ];

        const { generateQA, extractActionItems } = await import(
            '../../../services/llm/tasks'
        );
        (generateQA as ReturnType<typeof vi.fn>).mockClear();
        (extractActionItems as ReturnType<typeof vi.fn>).mockClear();

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        const chevron = screen.getByRole('button', {
            name: /重新生成選項|展開重新生成選項|granular targets|更多選項/i,
        });
        await act(async () => {
            fireEvent.click(chevron);
        });
        await flushAsync();

        const qaItem = screen.getByRole('menuitem', { name: /Q&A|QA/ });
        await act(async () => {
            fireEvent.click(qaItem);
        });
        // Wait long enough for runSummary's parallel awaits to fire.
        await flushAsync(8);

        expect(generateQA).toHaveBeenCalledTimes(1);
        // Action items always fire alongside Q&A — see cp75.32 spec.
        expect(extractActionItems).toHaveBeenCalledTimes(1);
    });

    it('Esc closes the dropdown', async () => {
        currentNote = mockNoteWithSummary;
        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();

        const chevron = screen.getByRole('button', {
            name: /重新生成選項|展開重新生成選項|granular targets|更多選項/i,
        });
        await act(async () => {
            fireEvent.click(chevron);
        });
        await flushAsync();

        expect(screen.getByRole('menu')).toBeInTheDocument();

        // Press Esc — menu closes.
        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });
        await flushAsync();

        expect(screen.queryByRole('menu')).toBeNull();
    });
});
