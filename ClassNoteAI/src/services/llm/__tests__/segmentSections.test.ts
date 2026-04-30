/**
 * cp75.17 — `segmentSections` tests.
 *
 * Coverage:
 *   - happy path: model returns clean JSON → parsed into Section[]
 *   - tolerance: ```json fences, leading/trailing prose, sloppy keys
 *   - validation: drops malformed entries, force-clamps timestamps
 *   - retry envelope: transient → retry → success / fatal → throw / abort → throw
 *   - empty / minimal input short-circuits without an LLM call
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

import { segmentSections } from '../tasks';

beforeEach(() => {
    mockComplete.mockReset();
});

const sampleTranscript =
    `[00:00] Welcome to the lecture on neural networks.\n` +
    `[02:30] First we'll cover the perceptron model.\n` +
    `[15:45] Now let's discuss multi-layer networks.\n` +
    `[31:20] Next, our presenter will demo the implementation.\n` +
    `[45:00] Q&A session begins now.`;

describe('segmentSections — happy path', () => {
    it('returns parsed Section[] when model emits clean JSON', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                { timestamp: 0, title: 'Introduction', summary: 'Welcome.' },
                { timestamp: 150, title: 'Perceptron', summary: 'Single-layer.' },
                { timestamp: 945, title: 'MLP', summary: 'Multi-layer.' },
                { timestamp: 1880, title: 'Demo', summary: 'Implementation walkthrough.' },
                { timestamp: 2700, title: 'Q&A', summary: 'Audience questions.' },
            ]),
            usage: { inputTokens: 200, outputTokens: 100 },
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 3600,
        });

        expect(result).toHaveLength(5);
        expect(result[0]).toEqual({
            timestamp: 0,
            title: 'Introduction',
            content: 'Welcome.',
        });
        expect(result[4].title).toBe('Q&A');
        expect(result[4].timestamp).toBe(2700);
    });

    it('strips ```json fenced code blocks', async () => {
        mockComplete.mockResolvedValue({
            content:
                '```json\n' +
                JSON.stringify([
                    { timestamp: 0, title: 'A', summary: 's1' },
                    { timestamp: 100, title: 'B', summary: 's2' },
                ]) +
                '\n```',
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'zh',
            durationSec: 600,
        });

        expect(result).toHaveLength(2);
        expect(result[1].title).toBe('B');
    });

    it('strips ``` (no language tag) fenced code blocks', async () => {
        mockComplete.mockResolvedValue({
            content:
                '```\n' +
                JSON.stringify([{ timestamp: 0, title: 'T', summary: 'x' }]) +
                '\n```',
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 60,
        });
        expect(result).toHaveLength(1);
    });

    it('salvages JSON when the model bolted on a leading/trailing prose blob', async () => {
        mockComplete.mockResolvedValue({
            content:
                'Here is the analysis you asked for:\n\n' +
                JSON.stringify([{ timestamp: 0, title: 'X', summary: 'y' }]) +
                '\n\nThanks!',
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 60,
        });
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('X');
    });
});

describe('segmentSections — input validation', () => {
    it('returns [] for an empty transcript without hitting the LLM', async () => {
        const result = await segmentSections({
            transcript: '',
            language: 'en',
            durationSec: 0,
        });
        expect(result).toEqual([]);
        expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns [] for a whitespace-only transcript without hitting the LLM', async () => {
        const result = await segmentSections({
            transcript: '   \n\n\t  ',
            language: 'en',
            durationSec: 0,
        });
        expect(result).toEqual([]);
        expect(mockComplete).not.toHaveBeenCalled();
    });

    it('throws when an aborted signal is passed before any work', async () => {
        const ac = new AbortController();
        ac.abort();
        await expect(
            segmentSections({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 100,
                signal: ac.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockComplete).not.toHaveBeenCalled();
    });
});

describe('segmentSections — output validation', () => {
    it('drops entries missing title or timestamp', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                { timestamp: 0, title: 'Good', summary: 'ok' },
                { timestamp: 100 /* no title */, summary: 'no title' },
                { title: 'no timestamp', summary: 'no ts' },
                { timestamp: 'abc', title: 'bad ts', summary: 'x' }, // not a number
                { timestamp: 200, title: '', summary: 'empty title' },
                { timestamp: 300, title: 'Also good', summary: 'y' },
            ]),
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 1000,
        });

        expect(result).toHaveLength(2);
        expect(result.map((s) => s.title)).toEqual(['Good', 'Also good']);
    });

    it('cp75.23 — clamps timestamp to 0 when durationSec === 0 (NOT the model-emitted ts)', async () => {
        // Pre cp75.23: `Math.min(durationSec || ts, Math.round(ts))` short-circuits
        // when durationSec === 0 (recovered lecture, mock test) — `||` falls through
        // to `ts`, so `Math.min(ts, ts) === ts` and the over-large timestamp is
        // never clamped. Defensive fix: switch to `durationSec > 0 ? durationSec : 0`
        // so the upper bound is a real number when duration is unknown.
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                { timestamp: 0, title: 'A', summary: 's' },
                { timestamp: 999, title: 'B', summary: 's' },
            ]),
            usage: {},
        });
        const result = await segmentSections({
            transcript: 'x',
            language: 'en',
            durationSec: 0,
        });
        // Pre cp75.23: result[1].timestamp would be 999 (no clamp because || short-circuit).
        // Post cp75.23: result[1].timestamp must be 0 (clamped to 0 because durationSec=0).
        expect(result[1].timestamp).toBe(0);
    });

    it('clamps model-emitted timestamps to [0, durationSec]', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                { timestamp: -10, title: 'underflow', summary: 's' },
                { timestamp: 5000, title: 'overflow', summary: 's' }, // duration 100
                { timestamp: 50, title: 'normal', summary: 's' },
            ]),
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 100,
        });

        expect(result.find((s) => s.title === 'underflow')!.timestamp).toBe(0);
        expect(result.find((s) => s.title === 'overflow')!.timestamp).toBe(100);
        expect(result.find((s) => s.title === 'normal')!.timestamp).toBe(50);
    });

    it('sorts sections chronologically even if model emitted out-of-order', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                { timestamp: 200, title: 'B', summary: 's' },
                { timestamp: 0, title: 'A', summary: 's' },
                { timestamp: 100, title: 'middle', summary: 's' },
            ]),
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 1000,
        });

        expect(result.map((s) => s.title)).toEqual(['A', 'middle', 'B']);
    });

    it('forces the first section to start at 0 (model skipped lecture intro)', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                { timestamp: 84, title: 'starts late', summary: 's' },
                { timestamp: 200, title: 'second', summary: 's' },
            ]),
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 1000,
        });

        expect(result[0].timestamp).toBe(0);
        expect(result[0].title).toBe('starts late');
        expect(result[1].timestamp).toBe(200);
    });

    it('throws when model returns a non-array top level', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify({ sections: [{ timestamp: 0, title: 'x' }] }),
            usage: {},
        });

        await expect(
            segmentSections({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 100,
            }),
        ).rejects.toThrow(/not an array/);
    });

    it('throws when model returns unparseable garbage', async () => {
        mockComplete.mockResolvedValue({
            content: 'I cannot process this request.',
            usage: {},
        });

        await expect(
            segmentSections({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 100,
            }),
        ).rejects.toThrow(/JSON/i);
    });

    it('throws when array contains nothing parseable (every entry malformed)', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                { foo: 'bar' },
                { timestamp: 'nope', title: '' },
            ]),
            usage: {},
        });

        await expect(
            segmentSections({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 100,
            }),
        ).rejects.toThrow(/no valid section/);
    });

    it('truncates excessively long titles and summaries (defensive)', async () => {
        mockComplete.mockResolvedValue({
            content: JSON.stringify([
                {
                    timestamp: 0,
                    title: 'a'.repeat(100),
                    summary: 'b'.repeat(800),
                },
            ]),
            usage: {},
        });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 100,
        });
        expect(result[0].title.length).toBeLessThanOrEqual(30);
        expect(result[0].content.length).toBeLessThanOrEqual(500);
    });
});

describe('segmentSections — retry envelope', () => {
    it('transient error on first attempt → retries → succeeds', async () => {
        mockComplete
            .mockRejectedValueOnce(new Error('429 Too Many Requests'))
            .mockResolvedValueOnce({
                content: JSON.stringify([{ timestamp: 0, title: 'ok', summary: 's' }]),
                usage: {},
            });

        const result = await segmentSections({
            transcript: sampleTranscript,
            language: 'en',
            durationSec: 100,
        });

        expect(mockComplete).toHaveBeenCalledTimes(2);
        expect(result).toHaveLength(1);
    });

    it('fatal error → no retry → propagates immediately', async () => {
        mockComplete.mockRejectedValue(new Error('401 unauthorized'));

        await expect(
            segmentSections({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 100,
            }),
        ).rejects.toThrow(/401/);
        expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it('AbortError during retry → propagates, does NOT retry', async () => {
        const ac = new AbortController();
        mockComplete.mockImplementation(async () => {
            ac.abort();
            throw new DOMException('Aborted', 'AbortError');
        });

        await expect(
            segmentSections({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 100,
                signal: ac.signal,
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        // Aborted on first attempt — no retry.
        expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it('persistent transient → retries exhausted → throws last error', async () => {
        mockComplete.mockRejectedValue(new Error('503 Service Unavailable'));

        await expect(
            segmentSections({
                transcript: sampleTranscript,
                language: 'en',
                durationSec: 100,
            }),
        ).rejects.toThrow(/503/);
        // 1 + 2 retries = 3 attempts.
        expect(mockComplete).toHaveBeenCalledTimes(3);
    }, 20_000);
});
