/**
 * H18ReviewPage · cp75.36 — markdown rendering in Q&A tab
 *
 * cp75.29 wired ReactMarkdown for `note.summary` but Q&A answers were
 * still rendered as plain `<div>{qa.answer}</div>`, so when generateQA
 * (cp75.32) emits backtick code, bullets, **bold** etc. the user saw
 * literal markers. This file pins the new behaviour: each `qa.answer`
 * is rendered through ReactMarkdown + remark-gfm + rehype-sanitize,
 * matching the summary box's render stack.
 *
 * `qa.question` stays plain text on purpose — questions are typically
 * short ("What is X?") and we don't want unintended `*` / `#` / `` ` ``
 * characters in user-facing language to be reinterpreted as markdown.
 *
 * Mock setup mirrors H18ReviewPage.summaryRender.test.tsx so the
 * component mounts cleanly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Lecture, Note, Subtitle, Course, QARecord } from '../../../types';

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
        text_en: 'Hello world this is a test sentence.',
        text_zh: '你好這是測試句子。',
        type: 'fine',
        created_at: '2026-04-28T00:00:00.000Z',
    },
];

const makeNote = (qa: QARecord[]): Note => ({
    lecture_id: 'L1',
    title: 'Test Lecture',
    summary: '',
    sections: [],
    qa_records: qa,
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
    summarize: vi.fn(async () => ''),
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

function switchToQATab() {
    const qaTab = screen.getByRole('button', { name: /Q&A/ });
    fireEvent.click(qaTab);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('H18ReviewPage · cp75.36 markdown rendering in Q&A tab', () => {
    it('QA answer renders **bold** as <strong>', async () => {
        currentNote = makeNote([
            {
                question: 'What is the formula?',
                answer: 'The formula is **F = ma**.',
                timestamp: 100,
            },
        ]);

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToQATab();

        const strong = document.querySelector('strong');
        expect(strong).not.toBeNull();
        expect(strong?.textContent).toBe('F = ma');
    });

    it('QA answer renders bullet list as <ul><li>', async () => {
        currentNote = makeNote([
            {
                question: 'What are the variables?',
                answer:
                    'The variables are:\n\n- F: force\n- m: mass\n- a: acceleration',
                timestamp: 100,
            },
        ]);

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToQATab();

        const items = document.querySelectorAll('ul li');
        expect(items.length).toBe(3);
        expect(items[0].textContent).toBe('F: force');
        expect(items[1].textContent).toBe('m: mass');
        expect(items[2].textContent).toBe('a: acceleration');
    });

    it('QA question is rendered as plain text (NOT markdown)', async () => {
        // The question contains markdown-looking syntax. We expect the
        // literal characters to remain visible — questions are short
        // natural-language prompts and we don't want them silently
        // reinterpreted.
        currentNote = makeNote([
            {
                question: 'What does **bold** mean here?',
                answer: 'It just means emphasis.',
                timestamp: 100,
            },
        ]);

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToQATab();

        // The literal `**bold**` substring is still present in the DOM.
        expect(
            screen.getByText(/What does \*\*bold\*\* mean here\?/),
        ).toBeInTheDocument();
        // And there is no <strong> coming from the question — the only
        // markdown render path is the answer, whose content here is plain.
        expect(document.querySelector('strong')).toBeNull();
    });

    it('XSS in QA answer is sanitized', async () => {
        currentNote = makeNote([
            {
                question: 'Is this safe?',
                answer:
                    '## Heading\n\n<script>alert("xss")</script>\n\nSafe body.',
                timestamp: 100,
            },
        ]);

        render(
            <H18ReviewPage courseId="C1" lectureId="L1" onBack={() => {}} />,
        );
        await flushAsync();
        switchToQATab();

        // Heading rendered.
        expect(
            screen.getByRole('heading', { level: 2, name: 'Heading' }),
        ).toBeInTheDocument();
        // Body text rendered.
        expect(screen.getByText('Safe body.')).toBeInTheDocument();
        // No <script> made it into the DOM.
        expect(document.querySelector('script')).toBeNull();
    });
});
