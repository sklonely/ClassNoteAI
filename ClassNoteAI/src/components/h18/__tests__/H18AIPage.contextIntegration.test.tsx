/**
 * cp75.33 — H18AIPage end-to-end aiContext propagation (no useAIHistory mock).
 *
 * The companion `H18AIPage.context.test.tsx` mocks the entire `useAIHistory`
 * hook, so it can verify the page calls `send(text, ctx)` correctly — but a
 * regression in `useAIHistory.send` (e.g. the RAG fallback dropping ctx,
 * the system prompt template missing the `${ragGrounding}` slot) would
 * silently slip past. This file fills that gap by mocking only the
 * downstream dependencies (`chatStream`, `ragService`, `storageService`)
 * and asserting that the lecture context flows ALL THE WAY into the
 * `chatStream` system message.
 *
 * Boundaries pinned:
 *   1. With `aiContext.kind = 'lecture'` and a real lecture's note +
 *      subtitles in storageService, the system prompt handed to chatStream
 *      must contain text from BOTH note.summary and the subtitle rows.
 *   2. Without aiContext, the system prompt must NOT contain any
 *      lecture-derived grounding — RAG / fallback must be inert.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const {
    chatStreamMock,
    retrieveContextMock,
    retrieveCourseContextMock,
    getNoteMock,
    getSubtitlesMock,
    listLecturesMock,
    getRecordingStateMock,
} = vi.hoisted(() => ({
    chatStreamMock: vi.fn(),
    retrieveContextMock: vi.fn(),
    retrieveCourseContextMock: vi.fn(),
    getNoteMock: vi.fn(),
    getSubtitlesMock: vi.fn(),
    listLecturesMock: vi.fn(),
    getRecordingStateMock: vi.fn(() => ({
        status: 'idle',
        segments: [],
        currentText: '',
        elapsed: 0,
    })),
}));

vi.mock('../../../services/llm', () => ({
    chatStream: chatStreamMock,
}));

vi.mock('../../../services/ragService', () => ({
    ragService: {
        retrieveContext: retrieveContextMock,
        retrieveCourseContext: retrieveCourseContextMock,
    },
}));

vi.mock('../../../services/storageService', () => ({
    storageService: {
        getNote: getNoteMock,
        getSubtitles: getSubtitlesMock,
        listLectures: listLecturesMock,
    },
}));

vi.mock('../../../services/recordingSessionService', () => ({
    recordingSessionService: {
        getState: getRecordingStateMock,
    },
}));

vi.mock('../../../services/keymapService', () => ({
    keymapService: {
        getDisplayLabel: vi.fn(() => '⌘J'),
    },
}));

vi.mock('../../../services/__contracts__/keymapService.contract', () => ({
    SHORTCUTS_CHANGE_EVENT: 'shortcuts-change',
}));

import H18AIPage from '../H18AIPage';
import type { AIContext } from '../useAIHistory';

/** Configure chatStream to capture the messages array passed in. */
function captureChatStreamMessages() {
    let captured: Array<{ role: string; content: string }> | null = null;
    chatStreamMock.mockImplementation(async function* (
        msgs: Array<{ role: string; content: string }>,
    ) {
        captured = msgs;
        yield 'AI replies here';
    });
    return () => captured;
}

beforeEach(() => {
    localStorage.clear();
    chatStreamMock.mockReset();
    retrieveContextMock.mockReset();
    retrieveCourseContextMock.mockReset();
    getNoteMock.mockReset();
    getSubtitlesMock.mockReset();
    listLecturesMock.mockReset();
    listLecturesMock.mockResolvedValue([]);
    getRecordingStateMock.mockReturnValue({
        status: 'idle',
        segments: [],
        currentText: '',
        elapsed: 0,
    });
});

afterEach(() => {
    localStorage.clear();
});

describe('H18AIPage · cp75.33 — end-to-end aiContext → chatStream system prompt', () => {
    it('aiContext.lectureId flows all the way to chatStream system prompt (RAG empty → fallback grounding)', async () => {
        // RAG returns nothing → useAIHistory falls back to note + subtitle stuffing.
        retrieveContextMock.mockResolvedValue({ chunks: [], formattedContext: '' });
        getNoteMock.mockResolvedValue({
            lecture_id: 'L1',
            title: 'ML',
            summary: '## Test summary marker',
            sections: [{ title: 'Section A', content: '', timestamp: 0 }],
            qa_records: [],
            generated_at: '2026-04-30T00:00:00.000Z',
        });
        getSubtitlesMock.mockResolvedValue([
            {
                id: 's1',
                lecture_id: 'L1',
                timestamp: 0,
                text_en: 'unique-subtitle-text-marker',
                type: 'rough',
                created_at: '2026-04-30T00:00:00.000Z',
            },
        ]);

        const getMessages = captureChatStreamMessages();

        const ctx: AIContext = {
            kind: 'lecture',
            lectureId: 'L1',
            courseId: 'C1',
            label: 'ML · L1',
        };
        render(<H18AIPage aiContext={ctx} onBack={() => {}} />);

        const input = screen.getByPlaceholderText('問 AI 任何問題…') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'what is gradient descent' } });
        fireEvent.click(screen.getByRole('button', { name: '送出' }));

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });

        const captured = getMessages()!;
        expect(captured[0].role).toBe('system');
        const sys = captured[0].content;
        // Note summary must appear in system prompt.
        expect(sys).toContain('Test summary marker');
        // Subtitle text must appear in system prompt.
        expect(sys).toContain('unique-subtitle-text-marker');
        // Lecture label must appear (system prompt formatting includes ctx.label).
        expect(sys).toContain('ML · L1');

        // useAIHistory used the lecture id to look things up — proves
        // aiContext was actually forwarded through send(text, ctx).
        expect(getNoteMock).toHaveBeenCalledWith('L1');
        expect(getSubtitlesMock).toHaveBeenCalledWith('L1');
    });

    it('without aiContext, system prompt has no lecture-derived grounding', async () => {
        // Even if we accidentally returned data, with no ctx the page
        // must NOT trigger the fallback fetch.
        getNoteMock.mockResolvedValue({
            lecture_id: 'L_NONE',
            summary: 'should-not-leak-into-prompt',
            sections: [],
            qa_records: [],
            generated_at: '2026-04-30T00:00:00.000Z',
        });
        getSubtitlesMock.mockResolvedValue([]);

        const getMessages = captureChatStreamMessages();

        render(<H18AIPage onBack={() => {}} />);

        const input = screen.getByPlaceholderText('問 AI 任何問題…') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'general question' } });
        fireEvent.click(screen.getByRole('button', { name: '送出' }));

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });

        const sys = getMessages()![0].content;
        expect(sys).not.toContain('should-not-leak-into-prompt');
        // Neither RAG nor fallback fetches should have been attempted.
        expect(retrieveContextMock).not.toHaveBeenCalled();
        expect(getNoteMock).not.toHaveBeenCalled();
        expect(getSubtitlesMock).not.toHaveBeenCalled();
    });
});
