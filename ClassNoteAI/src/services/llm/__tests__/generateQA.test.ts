/**
 * cp75.32 — `generateQA` tests.
 *
 * Coverage (mirrors segmentSections.test.ts shape):
 *   - happy path: clean JSON → QARecord[]
 *   - tolerance: ```json fences, leading/trailing prose
 *   - validation: drops malformed entries (missing question/answer/timestamp)
 *   - empty / minimal input short-circuits without an LLM call
 *   - retry envelope: transient → retry → success / fatal → throw
 *   - abort signal honoured before any network call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockComplete } = vi.hoisted(() => ({ mockComplete: vi.fn() }));

vi.mock('../registry', () => {
    const fakeProvider = {
        descriptor: { id: 'test-provider' },
        complete: mockComplete,
        stream: vi.fn(),
        listModels: async () => [{ id: 'gpt-4.1' }], // 'high' tier
        isConfigured: async () => true,
    };
    return { resolveActiveProvider: vi.fn(async () => fakeProvider) };
});

import { generateQA } from '../tasks';

beforeEach(() => {
    mockComplete.mockReset();
});

const sampleTranscript =
    `[00:00] Welcome to the lecture on neural networks.\n` +
    `[02:30] First we'll cover the perceptron model.\n` +
    `[15:45] Now let's discuss multi-layer networks.\n` +
    `[31:20] Backpropagation is the standard training algorithm.`;

// Tolerate the implementation wrapping the array under either `{questions: [...]}`
// or returning a bare array — both are reasonable. The parser must accept both.
function questionsResponse(arr: unknown[]): string {
    return JSON.stringify({ questions: arr });
}

describe('generateQA — happy path', () => {
    it('returns parsed QARecord[] when model emits clean JSON', async () => {
        mockComplete.mockResolvedValue({
            content: questionsResponse([
                {
                    question: 'What is X?',
                    answer: 'X is Y.',
                    timestamp: 60,
                    level: 'recall',
                },
                {
                    question: 'How does X relate to Y?',
                    answer: 'Through Z.',
                    timestamp: 200,
                    level: 'comprehend',
                },
            ]),
            usage: {},
        });
        const out = await generateQA({
            transcript: sampleTranscript,
            language: 'en',
        });
        expect(out).toHaveLength(2);
        expect(out[0].question).toBe('What is X?');
        expect(out[0].answer).toBe('X is Y.');
        expect(out[0].timestamp).toBe(60);
        expect(out[0].level).toBe('recall');
        expect(out[1].level).toBe('comprehend');
    });

    it('accepts a bare array (no {questions: ...} wrapper) for tolerance', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                {
                    question: 'Q1?',
                    answer: 'A1.',
                    timestamp: 10,
                },
            ]),
            usage: {},
        });
        const out = await generateQA({
            transcript: sampleTranscript,
            language: 'en',
        });
        expect(out).toHaveLength(1);
        expect(out[0].question).toBe('Q1?');
    });

    it('strips ```json fenced code blocks', async () => {
        mockComplete.mockResolvedValue({
            content:
                '```json\n' +
                questionsResponse([
                    { question: 'Q?', answer: 'A.', timestamp: 5 },
                ]) +
                '\n```',
            usage: {},
        });
        const out = await generateQA({
            transcript: sampleTranscript,
            language: 'zh',
        });
        expect(out).toHaveLength(1);
        expect(out[0].question).toBe('Q?');
    });

    it('drops malformed entries (missing question or answer)', async () => {
        mockComplete.mockResolvedValue({
            content: questionsResponse([
                { question: 'Good?', answer: 'Yes.', timestamp: 0 },
                { question: '', answer: 'no question', timestamp: 10 }, // empty Q
                { question: 'no answer', answer: '', timestamp: 20 }, // empty A
                { answer: 'no Q field', timestamp: 30 }, // missing Q
                { question: 'no A field', timestamp: 40 }, // missing A
                { question: 'no ts', answer: 'still ok' }, // ts default 0
                { question: 'Also good?', answer: 'Also yes.', timestamp: 50 },
            ]),
            usage: {},
        });
        const out = await generateQA({
            transcript: sampleTranscript,
            language: 'en',
        });
        // The 2 fully-valid entries plus the "no ts" one (which we treat as 0).
        expect(out.map((q) => q.question)).toEqual([
            'Good?',
            'no ts',
            'Also good?',
        ]);
    });

    it('respects abort signal — throws AbortError before any LLM call', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(
            generateQA({
                transcript: sampleTranscript,
                language: 'en',
                signal: ac.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockComplete).not.toHaveBeenCalled();
    });
});

describe('generateQA — input validation', () => {
    it('returns [] for an empty transcript without hitting the LLM', async () => {
        const out = await generateQA({
            transcript: '',
            language: 'en',
        });
        expect(out).toEqual([]);
        expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns [] for a whitespace-only transcript without hitting the LLM', async () => {
        const out = await generateQA({
            transcript: '   \n\n\t  ',
            language: 'en',
        });
        expect(out).toEqual([]);
        expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns [] when model returns unparseable garbage (graceful, no throw)', async () => {
        mockComplete.mockResolvedValue({
            content: 'I cannot process this request.',
            usage: {},
        });
        // Q&A is a value-add feature — failure here should NOT crash the
        // background pipeline. Empty array is the safe degradation.
        const out = await generateQA({
            transcript: sampleTranscript,
            language: 'en',
        });
        expect(out).toEqual([]);
    });
});

describe('generateQA — retry envelope', () => {
    it('transient (429) error → retries → succeeds', async () => {
        mockComplete
            .mockRejectedValueOnce(new Error('429 Too Many Requests'))
            .mockResolvedValueOnce({
                content: questionsResponse([
                    { question: 'ok?', answer: 'yes.', timestamp: 0 },
                ]),
                usage: {},
            });
        const out = await generateQA({
            transcript: sampleTranscript,
            language: 'en',
        });
        expect(mockComplete).toHaveBeenCalledTimes(2);
        expect(out).toHaveLength(1);
    });

    it('fatal (401) → no retry → throws', async () => {
        mockComplete.mockRejectedValue(new Error('401 unauthorized'));
        await expect(
            generateQA({
                transcript: sampleTranscript,
                language: 'en',
            }),
        ).rejects.toThrow(/401/);
        expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it('persistent transient → retries exhausted → throws last error', async () => {
        mockComplete.mockRejectedValue(new Error('503 Service Unavailable'));
        await expect(
            generateQA({
                transcript: sampleTranscript,
                language: 'en',
            }),
        ).rejects.toThrow(/503/);
        expect(mockComplete).toHaveBeenCalledTimes(3); // 1 + 2 retries
    }, 20_000);
});
