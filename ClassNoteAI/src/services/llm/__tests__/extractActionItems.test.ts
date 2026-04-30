/**
 * cp75.32 — `extractActionItems` tests.
 *
 * Coverage:
 *   - happy path: clean JSON → ActionItem[] with description / due_date /
 *     mentioned_at_timestamp
 *   - validation: drops malformed entries; missing due_date → null/undefined
 *   - clamps mentioned_at_timestamp to [0, durationSec]
 *   - empty / whitespace-only transcript short-circuits
 *   - returns [] gracefully on unparseable model output (no throw)
 *   - retry envelope: transient → retry; fatal → throw
 *   - abort signal honoured before any network call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockComplete } = vi.hoisted(() => ({ mockComplete: vi.fn() }));

vi.mock('../registry', () => {
    const fakeProvider = {
        descriptor: { id: 'test-provider' },
        complete: mockComplete,
        stream: vi.fn(),
        listModels: async () => [{ id: 'gpt-4.1' }],
        isConfigured: async () => true,
    };
    return { resolveActiveProvider: vi.fn(async () => fakeProvider) };
});

import { extractActionItems } from '../tasks';

beforeEach(() => {
    mockComplete.mockReset();
});

const sampleTranscript =
    `[00:00] Welcome.\n` +
    `[10:00] Please read chapter 5 by next Monday.\n` +
    `[58:20] homework: problem set 3, due next Wednesday.\n` +
    `[59:30] Don't forget the project proposal.`;

function itemsResponse(arr: unknown[]): string {
    return JSON.stringify({ items: arr });
}

describe('extractActionItems — happy path', () => {
    it('returns parsed ActionItem[] from transcript with HW mentions', async () => {
        mockComplete.mockResolvedValue({
            content: itemsResponse([
                {
                    description: 'Submit problem set 3',
                    due_date: '2026-05-06',
                    mentioned_at_timestamp: 3500,
                },
            ]),
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(out).toHaveLength(1);
        expect(out[0].description).toContain('problem set 3');
        expect(out[0].due_date).toBe('2026-05-06');
        expect(out[0].mentioned_at_timestamp).toBe(3500);
    });

    it('accepts a bare array (no {items: ...} wrapper) for tolerance', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                {
                    description: 'Read chapter 5',
                    due_date: null,
                    mentioned_at_timestamp: 600,
                },
            ]),
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(out).toHaveLength(1);
        expect(out[0].description).toBe('Read chapter 5');
    });

    it('handles missing due_date gracefully (null persists)', async () => {
        mockComplete.mockResolvedValue({
            content: itemsResponse([
                {
                    description: 'Practice perceptron problems',
                    due_date: null,
                    mentioned_at_timestamp: 100,
                },
                {
                    description: 'Review backprop notes', // no due_date key at all
                    mentioned_at_timestamp: 200,
                },
            ]),
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(out).toHaveLength(2);
        // Both null AND undefined-via-missing-key normalize to null|undefined
        // (we accept either as long as it's falsy and JSON-serializable).
        expect(out[0].due_date == null).toBe(true);
        expect(out[1].due_date == null).toBe(true);
    });

    it('clamps mentioned_at_timestamp to [0, durationSec]', async () => {
        mockComplete.mockResolvedValue({
            content: itemsResponse([
                {
                    description: 'underflow item',
                    due_date: null,
                    mentioned_at_timestamp: -50,
                },
                {
                    description: 'overflow item',
                    due_date: null,
                    mentioned_at_timestamp: 99999,
                },
                {
                    description: 'normal item',
                    due_date: null,
                    mentioned_at_timestamp: 1500,
                },
            ]),
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3000,
        });
        expect(out.find((i) => i.description === 'underflow item')!
            .mentioned_at_timestamp).toBe(0);
        expect(out.find((i) => i.description === 'overflow item')!
            .mentioned_at_timestamp).toBe(3000);
        expect(out.find((i) => i.description === 'normal item')!
            .mentioned_at_timestamp).toBe(1500);
    });

    it('strips ```json fenced code blocks', async () => {
        mockComplete.mockResolvedValue({
            content:
                '```json\n' +
                itemsResponse([
                    {
                        description: 'submit lab report',
                        due_date: '2026-05-13',
                        mentioned_at_timestamp: 100,
                    },
                ]) +
                '\n```',
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(out).toHaveLength(1);
        expect(out[0].description).toBe('submit lab report');
    });

    it('drops malformed entries (missing description)', async () => {
        mockComplete.mockResolvedValue({
            content: itemsResponse([
                { description: 'Good item', due_date: null, mentioned_at_timestamp: 0 },
                { description: '', due_date: null, mentioned_at_timestamp: 10 }, // empty
                { due_date: '2026-05-01', mentioned_at_timestamp: 20 }, // missing
                { description: 'Also good', due_date: null, mentioned_at_timestamp: 30 },
            ]),
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(out.map((i) => i.description)).toEqual(['Good item', 'Also good']);
    });
});

describe('extractActionItems — input validation', () => {
    it('returns [] for empty transcript without hitting the LLM', async () => {
        const out = await extractActionItems({
            transcript: '',
            language: 'en',
            durationSec: 0,
        });
        expect(out).toEqual([]);
        expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns [] for a whitespace-only transcript without hitting the LLM', async () => {
        const out = await extractActionItems({
            transcript: '   \n\n\t  ',
            language: 'en',
            durationSec: 0,
        });
        expect(out).toEqual([]);
        expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns [] when transcript has no action items (model emits empty array)', async () => {
        mockComplete.mockResolvedValue({
            content: itemsResponse([]),
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(out).toEqual([]);
    });

    it('returns [] gracefully when model returns garbage (no throw)', async () => {
        mockComplete.mockResolvedValue({
            content: 'I cannot answer.',
            usage: {},
        });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(out).toEqual([]);
    });

    it('throws AbortError when signal is aborted before call', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(
            extractActionItems({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 3600,
                signal: ac.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockComplete).not.toHaveBeenCalled();
    });
});

describe('extractActionItems — retry envelope', () => {
    it('transient (429) → retries → succeeds', async () => {
        mockComplete
            .mockRejectedValueOnce(new Error('429 Too Many Requests'))
            .mockResolvedValueOnce({
                content: itemsResponse([
                    { description: 'ok', due_date: null, mentioned_at_timestamp: 0 },
                ]),
                usage: {},
            });
        const out = await extractActionItems({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });
        expect(mockComplete).toHaveBeenCalledTimes(2);
        expect(out).toHaveLength(1);
    });

    it('fatal (401) → no retry → throws', async () => {
        mockComplete.mockRejectedValue(new Error('401 unauthorized'));
        await expect(
            extractActionItems({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 3600,
            }),
        ).rejects.toThrow(/401/);
        expect(mockComplete).toHaveBeenCalledTimes(1);
    });
});
