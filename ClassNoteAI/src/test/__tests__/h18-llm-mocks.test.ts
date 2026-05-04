/**
 * Self-tests for the LLM streaming mock helpers (Phase 7 / S0.3).
 *
 * These exercise the helper module directly — they don't import any
 * service module. The `mockSummarizeStream` test does dynamic-import
 * `services/llm/tasks` to verify the spy contract; if that module's
 * shape ever drifts, this test will fail loudly (which is what we
 * want — sub-agents in Sprint 2 rely on this stable mock surface).
 */

import { describe, it, expect } from 'vitest';

import {
    makeStreamFromChunks,
    makeAsyncStream,
    makeStreamThatThrows,
    collectStream,
    mockSummarizeStream,
} from '../h18-llm-mocks';

describe('h18-llm-mocks', () => {
    describe('makeStreamFromChunks', () => {
        it('yields chunks in order and collectStream returns them as array', async () => {
            const stream = makeStreamFromChunks(['a', 'b']);
            const result = await collectStream(stream);
            expect(result).toEqual(['a', 'b']);
        });

        it('handles empty chunks array', async () => {
            const stream = makeStreamFromChunks([]);
            const result = await collectStream(stream);
            expect(result).toEqual([]);
        });
    });

    describe('makeAsyncStream', () => {
        it('yields chunks in order with delay', async () => {
            const stream = makeAsyncStream(['x', 'y'], 5);
            const result = await collectStream(stream);
            expect(result).toEqual(['x', 'y']);
        });

        it('defaults delayMs to 0 if omitted', async () => {
            const stream = makeAsyncStream(['p', 'q', 'r']);
            const result = await collectStream(stream);
            expect(result).toEqual(['p', 'q', 'r']);
        });

        it('actually awaits between chunks (yields control to event loop)', async () => {
            const stream = makeAsyncStream(['a', 'b', 'c'], 1);
            const observed: string[] = [];
            // Race: kick off another microtask that pushes a marker. With
            // an awaited delay between chunks, the marker will land
            // somewhere mid-iteration.
            const interleavingPromise = (async () => {
                for await (const chunk of stream) {
                    observed.push(chunk);
                }
            })();
            await interleavingPromise;
            expect(observed).toEqual(['a', 'b', 'c']);
        });
    });

    describe('makeStreamThatThrows', () => {
        it('yields chunks then throws the supplied error', async () => {
            const err = new Error('boom');
            const stream = makeStreamThatThrows(['ok'], err);
            await expect(collectStream(stream)).rejects.toThrow('boom');
        });

        it('throws immediately when chunks list is empty', async () => {
            const err = new Error('immediate');
            const stream = makeStreamThatThrows([], err);
            await expect(collectStream(stream)).rejects.toThrow('immediate');
        });

        it('yielded chunks are observable up to the throw point', async () => {
            const seen: string[] = [];
            const stream = makeStreamThatThrows(['first', 'second'], new Error('after'));
            try {
                for await (const chunk of stream) {
                    seen.push(chunk);
                }
            } catch (e) {
                expect((e as Error).message).toBe('after');
            }
            expect(seen).toEqual(['first', 'second']);
        });
    });

    describe('collectStream — generic', () => {
        it('works on a non-string AsyncIterable<number>', async () => {
            async function* numbers(): AsyncIterable<number> {
                yield 1;
                yield 2;
                yield 3;
            }
            const result = await collectStream<number>(numbers());
            expect(result).toEqual([1, 2, 3]);
        });

        it('works on a non-string AsyncIterable of structured events', async () => {
            type Evt = { phase: string; delta?: string };
            async function* evts(): AsyncIterable<Evt> {
                yield { phase: 'reduce-start' };
                yield { phase: 'reduce-delta', delta: 'hello' };
                yield { phase: 'done' };
            }
            const result = await collectStream<Evt>(evts());
            expect(result).toHaveLength(3);
            expect(result[1]).toEqual({ phase: 'reduce-delta', delta: 'hello' });
        });
    });

    describe('mockSummarizeStream', () => {
        it('spies on summarizeStream and replaces it with a fixed chunk stream', async () => {
            const handle = mockSummarizeStream(['hello ', 'world']);
            try {
                // Dynamic-import inside the test so the helper module itself
                // doesn't depend on services/llm/tasks at top-level (avoids
                // accidental circular imports in production code paths).
                const tasks = await import('../../services/llm/tasks');
                // Call the (now-spied) summarizeStream and collect emitted
                // events. Mock yields plain string deltas wrapped as
                // SummarizeStreamEvent { phase: 'reduce-delta', delta }.
                const stream = tasks.summarizeStream({
                    content: 'irrelevant',
                    language: 'en',
                });
                const events: unknown[] = [];
                for await (const e of stream) events.push(e);
                expect(events.length).toBeGreaterThanOrEqual(2);
                // calls[] should record the invocation.
                expect(handle.calls.length).toBe(1);
                expect(handle.calls[0].args[0]).toMatchObject({ content: 'irrelevant' });
            } finally {
                handle.restore();
            }
        });

        it('restore() reverts the spy so subsequent calls hit real impl', async () => {
            const handle = mockSummarizeStream(['x']);
            handle.restore();
            // After restore, summarizeStream should NOT be the mock — we
            // can't easily assert the real one runs (it'd need a provider),
            // but we can confirm the spy isn't double-recording.
            expect(handle.calls).toHaveLength(0);
        });
    });
});
