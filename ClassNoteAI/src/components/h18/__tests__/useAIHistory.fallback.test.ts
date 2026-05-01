/**
 * cp75.30 — useAIHistory fallback grounding when RAG is empty.
 *
 * Today, when RAG returns no chunks (no index built / embedding service
 * missing), the system prompt is the bare global prompt → AI answers
 * "I don't know which lecture you mean" even though the page passed a
 * lecture context. Fallback path: stuff `note.summary` + section titles
 * + recent transcript into the system prompt as grounding.
 *
 * Boundaries asserted here:
 *   1. RAG empty + lecture ctx → fallback fetched & stuffed
 *   2. RAG hit                 → no extra DB calls, no double-stuff
 *   3. ctx undefined / global  → no fetch attempted at all
 *   4. recording-in-progress   → transcript window trimmed to last 60s
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const {
    retrieveContextMock,
    retrieveCourseContextMock,
    getNoteMock,
    getSubtitlesMock,
    chatStreamMock,
    getRecordingStateMock,
} = vi.hoisted(() => {
    type State = {
        status: string;
        segments: never[];
        currentText: string;
        elapsed: number;
        lectureId?: string;
        courseId?: string;
    };
    const initial: State = {
        status: 'idle',
        segments: [],
        currentText: '',
        elapsed: 0,
    };
    return {
        retrieveContextMock: vi.fn(),
        retrieveCourseContextMock: vi.fn(),
        getNoteMock: vi.fn(),
        getSubtitlesMock: vi.fn(),
        chatStreamMock: vi.fn(),
        getRecordingStateMock: vi.fn<() => State>(() => initial),
    };
});

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
    },
}));

vi.mock('../../../services/recordingSessionService', () => ({
    recordingSessionService: {
        getState: getRecordingStateMock,
    },
}));

import { useAIHistory } from '../useAIHistory';

/**
 * Capture the messages array that was passed into chatStream so tests
 * can assert on the system message content.
 */
function captureChatStreamMessages() {
    let captured: Array<{ role: string; content: string }> | null = null;
    chatStreamMock.mockImplementation(async function* (msgs: Array<{ role: string; content: string }>) {
        captured = msgs;
        yield '';
    });
    return () => captured;
}

beforeEach(() => {
    localStorage.clear();
    retrieveContextMock.mockReset();
    retrieveCourseContextMock.mockReset();
    getNoteMock.mockReset();
    getSubtitlesMock.mockReset();
    chatStreamMock.mockReset();
    getRecordingStateMock.mockReset();
    getRecordingStateMock.mockReturnValue({ status: 'idle', segments: [], currentText: '', elapsed: 0 });
});

afterEach(() => {
    localStorage.clear();
});

describe('useAIHistory · cp75.30 fallback grounding when RAG empty', () => {
    it('when ctx.kind=lecture and RAG empty, fetches note + subs and stuffs system prompt', async () => {
        retrieveContextMock.mockResolvedValue({ chunks: [], formattedContext: '' });
        getNoteMock.mockResolvedValue({
            lecture_id: 'L1',
            title: 'ML',
            summary: '## Lecture overview\nFoo bar baz',
            sections: [
                { title: 'Section A', content: '', timestamp: 0 },
                { title: 'Section B', content: '', timestamp: 100 },
            ],
            qa_records: [],
            generated_at: '2026-04-28T00:00:00.000Z',
        });
        getSubtitlesMock.mockResolvedValue([
            {
                id: 's1',
                lecture_id: 'L1',
                timestamp: 0,
                text_en: 'gradient descent walks downhill',
                type: 'rough',
                created_at: '2026-04-28T00:00:00.000Z',
            },
            {
                id: 's2',
                lecture_id: 'L1',
                timestamp: 5,
                text_en: 'the loss surface has many local minima',
                type: 'rough',
                created_at: '2026-04-28T00:00:00.000Z',
            },
        ]);

        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', {
                kind: 'lecture',
                lectureId: 'L1',
                courseId: 'C1',
                label: 'ML',
            });
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });

        const captured = getMessages()!;
        expect(captured[0].role).toBe('system');
        const sys = captured[0].content;
        expect(sys).toContain('Lecture overview');
        expect(sys).toContain('gradient descent walks downhill');

        expect(getNoteMock).toHaveBeenCalledWith('L1');
        expect(getSubtitlesMock).toHaveBeenCalledWith('L1');
    });

    it('when RAG returns matches, does NOT additionally stuff fallback', async () => {
        retrieveContextMock.mockResolvedValue({
            chunks: [{ chunkId: 'abc12345' }],
            formattedContext: 'RAG MATCH HERE',
        });

        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', {
                kind: 'lecture',
                lectureId: 'L1',
                courseId: 'C1',
                label: 'ML',
            });
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });
        const sys = getMessages()![0].content;
        expect(sys).toContain('RAG MATCH HERE');
        expect(getNoteMock).not.toHaveBeenCalled();
        expect(getSubtitlesMock).not.toHaveBeenCalled();
    });

    it('when ctx is undefined, no DB calls fired', async () => {
        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', undefined);
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });
        expect(getNoteMock).not.toHaveBeenCalled();
        expect(getSubtitlesMock).not.toHaveBeenCalled();
        expect(retrieveContextMock).not.toHaveBeenCalled();
    });

    it('when ctx.kind=global, no DB calls fired', async () => {
        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', { kind: 'global' });
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });
        expect(getNoteMock).not.toHaveBeenCalled();
        expect(getSubtitlesMock).not.toHaveBeenCalled();
    });

    // ─── cp75.36 — gating + truncation disclosure ──────────────────

    it('cp75.36 — when note is null (lecture in trash), does NOT fetch subtitles', async () => {
        // RAG empty AND get_note returns null — cp75.20 already gates
        // get_note on is_deleted=0, so a null here means the lecture was
        // soft-deleted. The fallback must NOT then go grab the orphaned
        // subtitle rows (subtitles table has no is_deleted column yet)
        // and inject the deleted lecture's transcript as grounding.
        retrieveContextMock.mockResolvedValue({ chunks: [], formattedContext: '' });
        getNoteMock.mockResolvedValue(null);
        getSubtitlesMock.mockResolvedValue([
            {
                id: 's1',
                lecture_id: 'L1',
                timestamp: 0,
                text_en: 'leaked transcript content',
                type: 'rough',
                created_at: '2026-04-28T00:00:00.000Z',
            },
        ]);

        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', {
                kind: 'lecture',
                lectureId: 'L1',
                courseId: 'C1',
            });
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });

        expect(getNoteMock).toHaveBeenCalledWith('L1');
        // Subtitles fetch must be skipped when note is null.
        expect(getSubtitlesMock).not.toHaveBeenCalled();
        // And the transcript content must NOT have leaked into the
        // system prompt as grounding.
        const sys = getMessages()![0].content;
        expect(sys).not.toContain('leaked transcript content');
    });

    it('cp75.36 — when transcript > 30000 chars, system prompt includes truncation warning', async () => {
        retrieveContextMock.mockResolvedValue({ chunks: [], formattedContext: '' });
        getNoteMock.mockResolvedValue({
            lecture_id: 'L1',
            title: 'ML',
            summary: 'short summary',
            sections: [],
            qa_records: [],
            generated_at: '2026-04-28T00:00:00.000Z',
        });
        // Build a transcript whose joined text comfortably exceeds the
        // 30000-char cap. 200 subs × ~200 chars each = ~40000 chars.
        const longLine = 'x'.repeat(200);
        const subs = Array.from({ length: 200 }, (_, i) => ({
            id: `s${i}`,
            lecture_id: 'L1',
            timestamp: i,
            text_en: `${longLine}-${i}`,
            type: 'rough' as const,
            created_at: '2026-04-28T00:00:00.000Z',
        }));
        getSubtitlesMock.mockResolvedValue(subs);

        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', {
                kind: 'lecture',
                lectureId: 'L1',
                courseId: 'C1',
            });
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });

        const sys = getMessages()![0].content;
        // Truncation marker must be present and reference the cap.
        expect(sys).toContain('逐字稿已截斷');
        expect(sys).toContain('30000');
    });

    it('cp75.36 — when transcript fits, no truncation warning in system prompt', async () => {
        retrieveContextMock.mockResolvedValue({ chunks: [], formattedContext: '' });
        getNoteMock.mockResolvedValue({
            lecture_id: 'L1',
            title: 'ML',
            summary: 'short summary',
            sections: [],
            qa_records: [],
            generated_at: '2026-04-28T00:00:00.000Z',
        });
        getSubtitlesMock.mockResolvedValue([
            {
                id: 's1',
                lecture_id: 'L1',
                timestamp: 0,
                text_en: 'a short transcript that fits well under the cap',
                type: 'rough',
                created_at: '2026-04-28T00:00:00.000Z',
            },
        ]);

        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', {
                kind: 'lecture',
                lectureId: 'L1',
                courseId: 'C1',
            });
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });

        const sys = getMessages()![0].content;
        expect(sys).toContain('a short transcript that fits well under the cap');
        expect(sys).not.toContain('逐字稿已截斷');
        expect(sys).not.toContain('摘要已截斷');
    });

    it('truncates fallback transcript to last 60s when isRecording=true', async () => {
        retrieveContextMock.mockResolvedValue({ chunks: [], formattedContext: '' });
        getNoteMock.mockResolvedValue(null);
        // 100 subs at 3s each → 0..297s
        const subs = Array.from({ length: 100 }, (_, i) => ({
            id: `s${i}`,
            lecture_id: 'L1',
            timestamp: i * 3,
            text_en: `line-${i}`,
            type: 'rough' as const,
            created_at: '2026-04-28T00:00:00.000Z',
        }));
        getSubtitlesMock.mockResolvedValue(subs);
        getRecordingStateMock.mockReturnValue({
            status: 'recording',
            lectureId: 'L1',
            courseId: 'C1',
            segments: [],
            currentText: '',
            elapsed: 297,
        });

        const getMessages = captureChatStreamMessages();

        const { result } = renderHook(() => useAIHistory());
        await act(async () => {
            await result.current.send('hello', {
                kind: 'lecture',
                lectureId: 'L1',
                courseId: 'C1',
            });
        });

        await waitFor(() => {
            expect(getMessages()).not.toBeNull();
        });
        const sys = getMessages()![0].content;
        // Last sub is at 297; window = [237, 297] inclusive → indices 79..99
        // Therefore 'line-78' (timestamp 234) must NOT appear, but 'line-99' must.
        expect(sys).toContain('line-99');
        // Bound check: line-50 is at 150s, far outside the 60s window.
        expect(sys).not.toContain('line-50');
        expect(sys).not.toContain('line-78');
    });
});
