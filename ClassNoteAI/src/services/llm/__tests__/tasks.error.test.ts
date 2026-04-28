/**
 * Phase 7 Sprint 2 W7 + W8 — `summarizeStream` / `chatStream` resilience tests.
 *
 *   W7  Map-reduce per-section error recovery
 *   ─────────────────────────────────────────
 *   When one map-phase section fails, the whole summarise must NOT
 *   throw. Instead the failed section collapses to a placeholder, the
 *   remaining sections still reduce, and the generator yields a
 *   `partial-failure` event so the UI can surface "1/N 段失敗" without
 *   parsing the markdown body.
 *
 *   W8  AbortController cancellation
 *   ─────────────────────────────────────────
 *   Every streaming entry point (`summarizeStream`, `chatStream`)
 *   accepts an optional `signal`. When fired:
 *     • before the first call → throws `DOMException('Aborted', 'AbortError')`
 *     • mid-stream            → no further chunks are yielded; the
 *                              throw bubbles out of the generator
 *     • absent                → back-compat: original happy-path runs
 *
 *   These tests stub `resolveActiveProvider` so we never touch real
 *   keystore / network. The provider stub honours `request.signal`
 *   the same way `openai-compat#streamOpenAICompatible` does — abort
 *   before we yield, abort between chunks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks (vi.mock factories run before imports) ─────────────
//
// We hoist `mockComplete` / `mockStream` so the test body can reset
// behaviour between cases. `vi.hoisted` is the only safe way to expose
// these to a `vi.mock(...)` factory under Vitest's import ordering.
const { mockComplete, mockStream } = vi.hoisted(() => ({
    mockComplete: vi.fn(),
    mockStream: vi.fn(),
}));

vi.mock('../registry', () => {
    const fakeProvider = {
        descriptor: { id: 'test-provider' },
        complete: mockComplete,
        stream: mockStream,
        listModels: async () => [{ id: 'test-model' }],
        isConfigured: async () => true,
    };
    return {
        resolveActiveProvider: vi.fn(async () => fakeProvider),
    };
});

import { summarizeStream, chatStream, type SummarizeStreamEvent } from '../tasks';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Build a transcript long enough to trigger the 6-section map-reduce
 *  path. SECTION_CHUNK_CHARS=4000 with 200 overlap → ~3800 effective
 *  per section, so 6 × 4000 = 24000 chars puts us safely at 6 sections.
 *  Use short, period-terminated sentences so the chunker breaks on
 *  sentence boundaries cleanly. */
function makeSixSectionTranscript(): string {
    // 24000 chars / 50 chars-per-sentence ≈ 480 sentences.
    return Array.from(
        { length: 480 },
        (_, i) => `Sentence ${i} about lecture topic with content.`,
    ).join(' ');
}

/** Build a transcript short enough (<12000 chars) to take the
 *  single-pass path — no map-reduce, just one streaming call. Used
 *  for the abort-mid-stream and no-signal back-compat tests. */
function makeShortTranscript(): string {
    return 'Lecture intro. '.repeat(50); // ~750 chars
}

/** Drain a `summarizeStream` generator into an array of events. */
async function collectEvents(
    gen: AsyncGenerator<SummarizeStreamEvent, void, void>,
): Promise<SummarizeStreamEvent[]> {
    const out: SummarizeStreamEvent[] = [];
    for await (const ev of gen) out.push(ev);
    return out;
}

/** Async-iterable stream that:
 *   • throws AbortError immediately if the signal is already aborted,
 *   • yields the given chunks one at a time,
 *   • throws AbortError if the signal fires between chunks.
 *  Mirrors how a real `openai-compat#streamOpenAICompatible` behaves
 *  when given a `request.signal`. */
function makeAbortableStream(
    chunks: Array<{ delta?: string; done?: boolean; usage?: { inputTokens?: number; outputTokens?: number } }>,
    signal?: AbortSignal,
) {
    return (async function* () {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        for (const c of chunks) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            yield c;
        }
    })();
}

// ─── Setup / teardown ────────────────────────────────────────────────

beforeEach(() => {
    mockComplete.mockReset();
    mockStream.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

// ─── W7  Per-section partial-failure ─────────────────────────────────

describe('summarizeStream — W7 per-section error catch (map-reduce)', () => {
    it('one failing section among 6 → 5 normal + 1 placeholder, reduce still runs', async () => {
        // Map-phase: section index 2 (0-based, i.e. the 3rd section)
        // throws; all others return their note. The mock keys on the
        // request body containing "Section N of 6" — that's the only
        // signal we have to identify which call this is.
        mockComplete.mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
            const userMsg = req.messages.find((m) => /Section \d+ of \d+/.test(m.content))?.content ?? '';
            const m = /Section (\d+) of (\d+)/.exec(userMsg);
            const idx = m ? Number(m[1]) - 1 : -1;
            if (idx === 2) throw new Error('rate limited');
            return { content: `Note for section ${idx + 1}`, usage: { inputTokens: 10, outputTokens: 20 } };
        });
        // Reduce-phase stream: emit a couple of deltas + done.
        mockStream.mockImplementation(() =>
            makeAbortableStream([
                { delta: '# Reduced summary\n', done: false },
                { delta: 'body.\n', done: false },
                { delta: '', done: true, usage: { inputTokens: 100, outputTokens: 50 } },
            ]),
        );

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'zh' }),
        );

        // We MUST have got a `done` — partial failure does not abort.
        const doneEv = events.find((e) => e.phase === 'done');
        expect(doneEv).toBeDefined();
        expect(doneEv!.fullText).toContain('# Reduced summary');

        // Map-phase emitted 6 `complete` calls (one per section) and
        // exactly one of them threw → exactly one placeholder in the
        // reducer's input.
        expect(mockComplete).toHaveBeenCalledTimes(6);
        const reducerCall = mockStream.mock.calls[0][0];
        const reducerUserContent = reducerCall.messages
            .filter((m: { role: string }) => m.role === 'user')
            .map((m: { content: string }) => m.content)
            .join('\n');
        // Five normal section notes + one placeholder.
        expect(reducerUserContent).toContain('Note for section 1');
        expect(reducerUserContent).toContain('Note for section 2');
        expect(reducerUserContent).toContain('Note for section 4');
        expect(reducerUserContent).toContain('Note for section 5');
        expect(reducerUserContent).toContain('Note for section 6');
        expect(reducerUserContent).toMatch(/此段摘要失敗.*rate limited/);
    });

    it('yields exactly one `partial-failure` event for that failed section (with index + error)', async () => {
        mockComplete.mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
            const userMsg = req.messages.find((m) => /Section \d+ of \d+/.test(m.content))?.content ?? '';
            const m = /Section (\d+) of (\d+)/.exec(userMsg);
            const idx = m ? Number(m[1]) - 1 : -1;
            if (idx === 2) throw new Error('rate limited');
            return { content: `Note ${idx + 1}`, usage: {} };
        });
        mockStream.mockImplementation(() =>
            makeAbortableStream([{ delta: 'ok', done: false }, { delta: '', done: true }]),
        );

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'en' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(1);
        expect(partials[0].failedSectionIndex).toBe(2);
        expect(partials[0].sectionCount).toBe(6);
        expect(partials[0].error).toContain('rate limited');
    });

    it('multiple failing sections → multiple `partial-failure` events, ordered by section index', async () => {
        // Sections 0, 3, 5 fail (0-based). The remaining 1, 2, 4 succeed.
        mockComplete.mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
            const userMsg = req.messages.find((m) => /Section \d+ of \d+/.test(m.content))?.content ?? '';
            const m = /Section (\d+) of (\d+)/.exec(userMsg);
            const idx = m ? Number(m[1]) - 1 : -1;
            if (idx === 0 || idx === 3 || idx === 5) throw new Error(`fail-${idx}`);
            return { content: `Note ${idx + 1}`, usage: {} };
        });
        mockStream.mockImplementation(() =>
            makeAbortableStream([{ delta: 'r', done: false }, { delta: '', done: true }]),
        );

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'zh' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(3);
        expect(partials.map((p) => p.failedSectionIndex)).toEqual([0, 3, 5]);
        expect(partials[0].error).toContain('fail-0');
        // The reducer was still called — partial failure is not fatal.
        expect(mockStream).toHaveBeenCalledTimes(1);
    });

    it('all sections fail → reducer still runs with 6 placeholders, surfaces 6 partial-failure events', async () => {
        mockComplete.mockImplementation(async () => {
            throw new Error('upstream 500');
        });
        // Reducer receives all-placeholder input but still streams
        // some final text (LLM degraded gracefully).
        mockStream.mockImplementation(() =>
            makeAbortableStream([
                { delta: '> Heads up: every section failed.\n', done: false },
                { delta: '', done: true },
            ]),
        );

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'zh' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(6);
        // All map-phase calls fired; reducer fired exactly once.
        expect(mockComplete).toHaveBeenCalledTimes(6);
        expect(mockStream).toHaveBeenCalledTimes(1);

        // Reducer body should contain six placeholders, one per section.
        const reducerCall = mockStream.mock.calls[0][0];
        const reducerUserContent = reducerCall.messages
            .filter((m: { role: string }) => m.role === 'user')
            .map((m: { content: string }) => m.content)
            .join('\n');
        const placeholderHits = reducerUserContent.match(/此段摘要失敗/g) ?? [];
        expect(placeholderHits).toHaveLength(6);

        const doneEv = events.find((e) => e.phase === 'done');
        expect(doneEv).toBeDefined();
    });

    it('zero failures → no `partial-failure` events emitted (back-compat)', async () => {
        mockComplete.mockImplementation(async (req: { messages: Array<{ content: string }> }) => {
            const userMsg = req.messages.find((m) => /Section \d+ of \d+/.test(m.content))?.content ?? '';
            const m = /Section (\d+) of (\d+)/.exec(userMsg);
            const idx = m ? Number(m[1]) - 1 : -1;
            return { content: `Note ${idx + 1}`, usage: {} };
        });
        mockStream.mockImplementation(() =>
            makeAbortableStream([{ delta: 'final', done: false }, { delta: '', done: true }]),
        );

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'en' }),
        );

        expect(events.filter((e) => e.phase === 'partial-failure')).toHaveLength(0);
        // Per-section progress events still emit for all 6 sections.
        expect(events.filter((e) => e.phase === 'map-section-done')).toHaveLength(6);
    });
});

// ─── W8  AbortController ─────────────────────────────────────────────

describe('summarizeStream — W8 AbortController support', () => {
    it('signal already aborted at call time → throws AbortError before any LLM call', async () => {
        const ac = new AbortController();
        ac.abort();

        const gen = summarizeStream({
            content: makeShortTranscript(),
            language: 'zh',
            signal: ac.signal,
        });

        // Touching `.next()` is what actually drives the generator.
        await expect(collectEvents(gen)).rejects.toMatchObject({ name: 'AbortError' });
        // Aborted before ever talking to the provider.
        expect(mockComplete).not.toHaveBeenCalled();
        expect(mockStream).not.toHaveBeenCalled();
    });

    it('signal aborts mid-stream → no further chunks yielded after the abort', async () => {
        const ac = new AbortController();
        // Single-pass path (short transcript). Build a stream that
        // honours the same signal we'll pass to summarizeStream.
        mockStream.mockImplementation((req: { signal?: AbortSignal }) =>
            makeAbortableStream(
                [
                    { delta: 'first ', done: false },
                    { delta: 'second ', done: false },
                    { delta: 'third ', done: false },
                    { delta: '', done: true },
                ],
                req.signal,
            ),
        );

        const gen = summarizeStream({
            content: makeShortTranscript(),
            language: 'zh',
            signal: ac.signal,
        });

        const seen: SummarizeStreamEvent[] = [];
        await expect(
            (async () => {
                for await (const ev of gen) {
                    seen.push(ev);
                    // After we receive the first delta, fire abort.
                    if (ev.phase === 'reduce-delta' && ev.delta === 'first ') {
                        ac.abort();
                    }
                }
            })(),
        ).rejects.toMatchObject({ name: 'AbortError' });

        // The first delta made it through; the second/third must NOT have.
        const deltas = seen
            .filter((e): e is SummarizeStreamEvent & { delta: string } =>
                e.phase === 'reduce-delta' && typeof e.delta === 'string',
            )
            .map((e) => e.delta);
        expect(deltas).toContain('first ');
        expect(deltas).not.toContain('second ');
        expect(deltas).not.toContain('third ');
        // We never made it to `done`.
        expect(seen.some((e) => e.phase === 'done')).toBe(false);
    });

    it('no signal passed → completes normally (back-compat)', async () => {
        mockStream.mockImplementation(() =>
            makeAbortableStream([
                { delta: 'hello ', done: false },
                { delta: 'world', done: false },
                { delta: '', done: true, usage: { inputTokens: 5, outputTokens: 2 } },
            ]),
        );

        const events = await collectEvents(
            summarizeStream({ content: makeShortTranscript(), language: 'en' }),
        );

        const doneEv = events.find((e) => e.phase === 'done');
        expect(doneEv).toBeDefined();
        expect(doneEv!.fullText).toBe('hello world');
    });

    it('signal aborted during map-phase fan-in → throws AbortError, no reducer call', async () => {
        const ac = new AbortController();
        // First map call resolves; abort fires before the rest can finish.
        let callCount = 0;
        mockComplete.mockImplementation(async (req: { signal?: AbortSignal }) => {
            callCount++;
            if (callCount === 1) {
                // After the first map call, fire the abort.
                ac.abort();
                return { content: 'first ok', usage: {} };
            }
            // Subsequent calls must see the aborted signal and throw.
            if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            return { content: 'should not get here', usage: {} };
        });

        const gen = summarizeStream({
            content: makeSixSectionTranscript(),
            language: 'zh',
            signal: ac.signal,
        });

        await expect(collectEvents(gen)).rejects.toMatchObject({ name: 'AbortError' });
        // Reducer never fired — abort short-circuited the pipeline.
        expect(mockStream).not.toHaveBeenCalled();
    });

    it('passes `signal` through to provider.complete and provider.stream', async () => {
        const ac = new AbortController();
        mockComplete.mockResolvedValue({ content: 'note', usage: {} });
        mockStream.mockImplementation(() =>
            makeAbortableStream([{ delta: 'done', done: false }, { delta: '', done: true }]),
        );

        await collectEvents(
            summarizeStream({
                content: makeSixSectionTranscript(),
                language: 'zh',
                signal: ac.signal,
            }),
        );

        // Every map-phase complete() got the signal.
        for (const call of mockComplete.mock.calls) {
            expect(call[0].signal).toBe(ac.signal);
        }
        // Reducer stream() got the signal too.
        expect(mockStream.mock.calls[0][0].signal).toBe(ac.signal);
    });
});

// ─── W8  chatStream cancellation ─────────────────────────────────────

describe('chatStream — W8 AbortController support', () => {
    it('signal already aborted → throws AbortError, no provider call', async () => {
        const ac = new AbortController();
        ac.abort();

        await expect(
            (async () => {
                for await (const _ of chatStream(
                    [{ role: 'user', content: 'hi' }],
                    { signal: ac.signal },
                )) {
                    // never reached
                }
            })(),
        ).rejects.toMatchObject({ name: 'AbortError' });

        expect(mockStream).not.toHaveBeenCalled();
    });

    it('signal aborts mid-stream → drops remaining chunks', async () => {
        const ac = new AbortController();
        mockStream.mockImplementation((req: { signal?: AbortSignal }) =>
            makeAbortableStream(
                [
                    { delta: 'a', done: false },
                    { delta: 'b', done: false },
                    { delta: 'c', done: false },
                    { delta: '', done: true },
                ],
                req.signal,
            ),
        );

        const seen: string[] = [];
        await expect(
            (async () => {
                for await (const delta of chatStream(
                    [{ role: 'user', content: 'hi' }],
                    { signal: ac.signal },
                )) {
                    seen.push(delta);
                    if (delta === 'a') ac.abort();
                }
            })(),
        ).rejects.toMatchObject({ name: 'AbortError' });

        expect(seen).toContain('a');
        expect(seen).not.toContain('b');
        expect(seen).not.toContain('c');
    });

    it('no signal → completes normally and yields every chunk (back-compat)', async () => {
        mockStream.mockImplementation(() =>
            makeAbortableStream([
                { delta: 'one', done: false },
                { delta: 'two', done: false },
                { delta: '', done: true, usage: { inputTokens: 3, outputTokens: 2 } },
            ]),
        );

        const seen: string[] = [];
        for await (const delta of chatStream([{ role: 'user', content: 'hi' }])) {
            seen.push(delta);
        }
        expect(seen).toEqual(['one', 'two']);
    });

    it('passes `signal` through to provider.stream', async () => {
        const ac = new AbortController();
        mockStream.mockImplementation(() =>
            makeAbortableStream([{ delta: 'x', done: false }, { delta: '', done: true }]),
        );

        for await (const _ of chatStream(
            [{ role: 'user', content: 'hi' }],
            { signal: ac.signal },
        )) {
            // drain
        }
        expect(mockStream.mock.calls[0][0].signal).toBe(ac.signal);
    });
});
