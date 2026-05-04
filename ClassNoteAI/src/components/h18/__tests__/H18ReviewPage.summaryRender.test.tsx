/**
 * H18ReviewPage · cp75.29 — markdown rendering in 摘要 tab
 *
 * Issue 3 from earlier audit: previously the summary box rendered
 * `note.summary` as raw text, so users saw literal `## 標題`,
 * `**bold**`, `- bullet` markers. This file pins the new behaviour:
 * summary is rendered through ReactMarkdown + remark-gfm + rehype-sanitize.
 *
 * Mock setup mirrors H18ReviewPage.summary.test.tsx — same external
 * service mocks so the component mounts cleanly.
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

const makeNote = (summary: string): Note => ({
    lecture_id: 'L1',
    title: 'Test Lecture',
    summary,
    sections: [],
    qa_records: [],
    generated_at: '2026-04-28T01:00:00.000Z',
});

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

vi.mock('../../../services/llm/tasks', () => ({
    summarizeStream: vi.fn(async function* () {
        yield { phase: 'done', fullText: '## 摘要\n本堂課重點...' };
    }),
    summarize: vi.fn(async () => '## 摘要\n本堂課重點...'),
    segmentSections: vi.fn(async () => null),
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
    currentLectureStatus = 'completed';
    currentNote = null;
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

function switchToSummaryTab() {
    const summaryTab = screen.getByRole('button', { name: /AI 摘要/ });
    fireEvent.click(summaryTab);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('H18ReviewPage · cp75.29 markdown rendering in 摘要 tab', () => {
    it('renders ## heading as h2 element', async () => {
        currentNote = makeNote('## My Heading\n\nbody text');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        expect(
            screen.getByRole('heading', { level: 2, name: 'My Heading' }),
        ).toBeInTheDocument();
    });

    it('renders **bold** as <strong>', async () => {
        currentNote = makeNote('Some **bold word** here');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        const strong = document.querySelector('strong');
        expect(strong).not.toBeNull();
        expect(strong?.textContent).toBe('bold word');
    });

    it('renders bullet list as <ul><li>', async () => {
        currentNote = makeNote('- item one\n- item two');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        const items = document.querySelectorAll('ul li');
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe('item one');
        expect(items[1].textContent).toBe('item two');
    });

    it('does NOT render literal "##" as visible text', async () => {
        currentNote = makeNote('## Heading');

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        // The raw "## Heading" string must NOT be present anywhere in
        // the DOM — it should have been transformed into an <h2>.
        expect(screen.queryByText('## Heading')).toBeNull();
        // And the heading text alone IS present (as the h2 child).
        expect(
            screen.getByRole('heading', { level: 2, name: 'Heading' }),
        ).toBeInTheDocument();
    });

    it('sanitizes script tag in summary content (XSS guard)', async () => {
        currentNote = makeNote(
            '## Title\n\n<script>alert("xss")</script>\n\nBody',
        );

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToSummaryTab();

        // Heading rendered.
        expect(
            screen.getByRole('heading', { level: 2, name: 'Title' }),
        ).toBeInTheDocument();
        // Body text rendered.
        expect(screen.getByText('Body')).toBeInTheDocument();
        // No <script> made it into the DOM.
        expect(document.querySelector('script')).toBeNull();
    });
});
