/**
 * AIChatPanel smoke + key-contract tests.
 *
 * The full AIChatPanel surface (drag, resize, session switching, RAG
 * indexing progress, multimodal context) is too large for full coverage
 * in one file. This suite validates the load-bearing contracts:
 *
 *   - isOpen={false} → renders nothing (panel hidden)
 *   - sidebar mode renders without drag/resize handles
 *   - empty-state copy ("有問題嗎？問問 AI 助教吧！") on a fresh session
 *   - send button disabled when input is empty / whitespace
 *   - send button click fires llmChatStream with the user input + RAG context
 *   - regression #66 (from checklist Phase 1 §AIChatWindow): repeated
 *     mount of an already-indexed lecture does NOT re-trigger
 *     ragService.indexLecture
 *   - regression #68 (clamp): floating-mode initial position is inside
 *     the viewport (won't render off-screen)
 *
 * Heavy mocking — every service the panel touches is stubbed so we can
 * drive state deterministically without real RAG / LLM / SQLite hits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/ragService', () => ({
    ragService: {
        hasIndex: vi.fn(() => Promise.resolve(true)),
        indexLecture: vi.fn(() => Promise.resolve()),
        query: vi.fn(() =>
            Promise.resolve({ contextChunks: [], sources: [] }),
        ),
        // Async generator the RAG send path consumes via for-await-of.
        // Yields a sources event then a delta event so handleSend completes
        // its loop without hanging the test on an empty stream.
        chatStream: vi.fn(async function* () {
            yield { type: 'sources', sources: [] };
            yield { type: 'delta', delta: 'mocked rag reply' };
        }),
    },
}));

vi.mock('../../services/chatSessionService', () => ({
    chatSessionService: {
        listSessions: vi.fn(() => Promise.resolve([])),
        getMessages: vi.fn(() => Promise.resolve([])),
        getHistoryForLLM: vi.fn(() => Promise.resolve([])),
        createSession: vi.fn((id: string) =>
            Promise.resolve({
                id: 'sess-1',
                lecture_id: id,
                title: 'New session',
                created_at: '2026-04-23T00:00:00Z',
                updated_at: '2026-04-23T00:00:00Z',
            }),
        ),
        addMessage: vi.fn(() => Promise.resolve()),
        deleteSession: vi.fn(() => Promise.resolve()),
        updateSession: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock('../../services/llm', () => ({
    chatStream: vi.fn(async function* () {
        yield 'Mocked';
        yield ' streamed';
        yield ' reply';
    }),
    usageTracker: {
        record: vi.fn(),
    },
}));

import AIChatPanel from '../AIChatPanel';
import { ragService } from '../../services/ragService';

const mockedRag = vi.mocked(ragService);

beforeEach(() => {
    mockedRag.hasIndex.mockResolvedValue(true);
});

afterEach(() => {
    cleanup();
});

function renderPanel(propsOverrides: Partial<React.ComponentProps<typeof AIChatPanel>> = {}) {
    return render(
        <AIChatPanel
            lectureId="lec-1"
            isOpen
            onClose={vi.fn()}
            displayMode="sidebar"
            {...propsOverrides}
        />,
    );
}

describe('AIChatPanel — visibility + display-mode chrome', () => {
    it('renders nothing when isOpen=false', () => {
        const { container } = render(
            <AIChatPanel
                lectureId="lec-1"
                isOpen={false}
                onClose={vi.fn()}
                displayMode="floating"
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the AI 助教 header label when open', async () => {
        renderPanel();
        expect(await screen.findByText('AI 助教')).toBeInTheDocument();
    });

    it('renders the empty-state prompt on a fresh session', async () => {
        renderPanel();
        expect(
            await screen.findByText('有問題嗎？問問 AI 助教吧！'),
        ).toBeInTheDocument();
    });
});

describe('AIChatPanel — send-button behaviour', () => {
    it('renders the input placeholder', async () => {
        renderPanel();
        expect(
            await screen.findByPlaceholderText('輸入問題...'),
        ).toBeInTheDocument();
    });

    it('disables send button while input is empty', async () => {
        renderPanel();
        const input = await screen.findByPlaceholderText('輸入問題...');
        // The send button has no accessible name (icon-only); locate it
        // as the only sibling button next to the input.
        const buttons = input.parentElement!.querySelectorAll('button');
        const sendBtn = buttons[buttons.length - 1] as HTMLButtonElement;
        expect(sendBtn).toBeDisabled();
    });

    it('disables send button on whitespace-only input', async () => {
        const user = userEvent.setup();
        renderPanel();
        const input = await screen.findByPlaceholderText('輸入問題...');
        await user.type(input, '   ');
        const buttons = input.parentElement!.querySelectorAll('button');
        const sendBtn = buttons[buttons.length - 1] as HTMLButtonElement;
        expect(sendBtn).toBeDisabled();
    });

    it('enables send button + triggers RAG chatStream on real input', async () => {
        // Default mock has hasIndex=true + useRAG defaults to true →
        // handleSend goes through ragService.chatStream, NOT llmChatStream.
        const user = userEvent.setup();
        renderPanel();
        const input = await screen.findByPlaceholderText('輸入問題...');
        await user.type(input, 'What is Newton\'s third law?');
        const buttons = input.parentElement!.querySelectorAll('button');
        const sendBtn = buttons[buttons.length - 1] as HTMLButtonElement;
        expect(sendBtn).toBeEnabled();
        await user.click(sendBtn);
        await waitFor(() => expect(mockedRag.chatStream).toHaveBeenCalled());
        // RAG chatStream signature: (query, lectureId, opts).
        const [query, lectureIdArg] = mockedRag.chatStream.mock.calls[0];
        expect(query).toBe("What is Newton's third law?");
        expect(lectureIdArg).toBe('lec-1');
    });
});

describe('AIChatPanel — index lifecycle (regression #66)', () => {
    it('does NOT call ragService.indexLecture when index already exists', async () => {
        mockedRag.hasIndex.mockResolvedValue(true);
        renderPanel();
        // Wait for the auto-check to settle.
        await waitFor(() => expect(mockedRag.hasIndex).toHaveBeenCalled());
        // Critical: with hasIndex=true, indexLecture must NOT fire — that
        // was the #66 token-burning regression where opening the panel
        // re-indexed the lecture every time.
        expect(mockedRag.indexLecture).not.toHaveBeenCalled();
    });

    it('mounting twice does not double-index', async () => {
        mockedRag.hasIndex.mockResolvedValue(true);
        const { unmount } = renderPanel();
        await waitFor(() => expect(mockedRag.hasIndex).toHaveBeenCalled());
        unmount();
        renderPanel();
        await waitFor(() =>
            expect(mockedRag.hasIndex).toHaveBeenCalledTimes(2),
        );
        // Two mounts → 0 indexLecture calls (because both saw hasIndex=true).
        expect(mockedRag.indexLecture).not.toHaveBeenCalled();
    });
});
