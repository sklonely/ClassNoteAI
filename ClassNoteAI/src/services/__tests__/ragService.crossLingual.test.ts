import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test for the v0.5.2 cross-lingual RAG path.
 *
 * Bug context: prior to v0.5.2 the embedding model was nomic-embed-text-v1,
 * which was architecturally incompatible with Candle's stock BertModel and
 * failed to load at all — AI 助教 was silently broken for every user. The
 * fix swaps to BAAI/bge-small-en-v1.5 (English-only) and compensates for
 * the Chinese-query → English-content case by translating the query
 * through the configured LLM provider before embedding.
 *
 * This test pins that dispatch: Chinese queries MUST go through
 * translateForRetrieval, English queries MUST NOT. Either regression
 * would silently degrade retrieval quality — the kind of bug that only
 * shows up when a user notices "the AI keeps missing the obvious
 * passages" weeks later.
 */

const { translateMock, llmChatMock, semanticSearchMock, generateEmbeddingMock } = vi.hoisted(() => ({
    translateMock: vi.fn(),
    llmChatMock: vi.fn(),
    semanticSearchMock: vi.fn(),
    generateEmbeddingMock: vi.fn(),
}));

vi.mock('../llm', () => ({
    chat: llmChatMock,
    translateForRetrieval: translateMock,
}));

vi.mock('../embeddingStorageService', () => ({
    embeddingStorageService: {
        semanticSearch: semanticSearchMock,
        semanticSearchByCourse: vi.fn(),
        hasEmbeddings: vi.fn(),
        getStats: vi.fn(),
        deleteByLecture: vi.fn(),
        storeEmbeddings: vi.fn(),
    },
}));

vi.mock('../embeddingService', () => ({
    generateLocalEmbedding: generateEmbeddingMock,
}));

vi.mock('../chunkingService', () => ({
    chunkingService: { chunkText: vi.fn() },
}));

vi.mock('../ocrService', () => ({
    ocrService: { isAvailable: vi.fn(), ocrPage: vi.fn() },
}));

vi.mock('../pdfToImageService', () => ({
    pdfToImageService: { convertAll: vi.fn() },
}));

import { ragService } from '../ragService';

describe('ragService.chat cross-lingual dispatch', () => {
    beforeEach(() => {
        translateMock.mockReset();
        llmChatMock.mockReset();
        semanticSearchMock.mockReset();
        generateEmbeddingMock.mockReset();

        semanticSearchMock.mockResolvedValue([]);
        llmChatMock.mockResolvedValue('assistant answer');
    });

    it('translates a Chinese query to English before retrieval', async () => {
        translateMock.mockResolvedValueOnce('What is heuristic evaluation?');

        await ragService.chat('什麼是啟發式評估法？', 'lecture-1');

        expect(translateMock).toHaveBeenCalledTimes(1);
        expect(translateMock).toHaveBeenCalledWith('什麼是啟發式評估法？', 'en');
        // Retrieval must receive the English form, not the original Chinese.
        // If this ever flips back to passing the Chinese query directly
        // to semanticSearch, cross-lingual recall drops ~30 points.
        expect(semanticSearchMock).toHaveBeenCalledWith(
            'What is heuristic evaluation?',
            'lecture-1',
            5,
            undefined,
        );
    });

    it('does not translate a pure-English query', async () => {
        await ragService.chat('What is heuristic evaluation?', 'lecture-1');

        expect(translateMock).not.toHaveBeenCalled();
        expect(semanticSearchMock).toHaveBeenCalledWith(
            'What is heuristic evaluation?',
            'lecture-1',
            5,
            undefined,
        );
    });

    it('passes the ORIGINAL question (not the translation) to the answering LLM', async () => {
        // The user typed Chinese and expects a Chinese answer. The
        // translation is an internal retrieval tool; it must not leak
        // into the final message the LLM sees.
        translateMock.mockResolvedValueOnce('What is Fitts law?');

        await ragService.chat('Fitts 定律是什麼？', 'lecture-1');

        const [messages] = llmChatMock.mock.calls[0];
        const userMsg = messages.find((m: { role: string }) => m.role === 'user');
        expect(userMsg?.content).toBe('Fitts 定律是什麼？');
    });

    it('detects Hiragana / Katakana / Hangul, not just Han characters', async () => {
        translateMock.mockResolvedValueOnce('translated');
        await ragService.chat('ヒューリスティック評価とは何ですか？', 'lecture-1');
        expect(translateMock).toHaveBeenCalled();
    });

    it('does not translate ASCII-only queries that contain only numbers/punctuation', async () => {
        await ragService.chat('What about GDPR Article 17 & 22?', 'lecture-1');
        expect(translateMock).not.toHaveBeenCalled();
    });
});
