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

import {
    summarizeStream,
    chatStream,
    classifyMapSectionError,
    type SummarizeStreamEvent,
} from '../tasks';

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

/** True if the request looks like a map-phase section call (the
 *  user-content has the "Section N of M" marker the map prompt builds).
 *  The reducer's user content uses different framing ("Combine these N
 *  per-section notes…"), so this lets a single mockStream impl dispatch
 *  on phase. cp75.16 — needed because both map and reduce now go
 *  through `mockStream` (map used to be `mockComplete`). */
function isMapSectionRequest(req: { messages: Array<{ role: string; content: string }> }) {
    return req.messages.some(
        (m) => m.role === 'user' && /Section \d+ of \d+/.test(m.content),
    );
}
function getMapSectionIndex(req: { messages: Array<{ role: string; content: string }> }) {
    const userMsg = req.messages.find((m) => /Section \d+ of \d+/.test(m.content))?.content ?? '';
    const m = /Section (\d+) of (\d+)/.exec(userMsg);
    return m ? Number(m[1]) - 1 : -1;
}

/** Build a fake map-section stream that emits a single delta and done.
 *  Use the section index in the body so tests can assert which call this
 *  was. Honours `signal` like the real provider. */
function makeMapSectionStream(idx: number, signal?: AbortSignal) {
    return makeAbortableStream(
        [
            { delta: `Note ${idx + 1}`, done: false },
            { delta: '', done: true, usage: { inputTokens: 10, outputTokens: 4 } },
        ],
        signal,
    );
}

/** Build a fake reducer stream that emits a couple of deltas + done. */
function makeReducerStream(text: string, signal?: AbortSignal) {
    const half = Math.ceil(text.length / 2);
    return makeAbortableStream(
        [
            { delta: text.slice(0, half), done: false },
            { delta: text.slice(half), done: false },
            { delta: '', done: true, usage: { inputTokens: 100, outputTokens: 50 } },
        ],
        signal,
    );
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
//
// cp75.16 — map phase now uses provider.stream (was provider.complete),
// so all the map mocks dispatch via `mockStream` with a request-body
// pattern test. Errors are intentionally chosen to be FATAL by
// `classifyMapSectionError` (e.g. 'auth failed', 'invalid request') so
// each section call fires exactly once — the cp75.16 retry path is
// covered separately in the "retry / timeout" describe below.

describe('summarizeStream — W7 per-section error catch (map-reduce)', () => {
    it('one failing section among 6 → 5 normal + 1 placeholder, reduce still runs', async () => {
        // mockStream dispatches by message content: map sections (one of
        // 6) vs the reducer's combine call. Section 2 (0-based) throws
        // a fatal error so it does NOT trigger the retry loop.
        mockStream.mockImplementation((req) => {
            if (isMapSectionRequest(req)) {
                const idx = getMapSectionIndex(req);
                if (idx === 2) {
                    return (async function* () {
                        throw new Error('400 invalid request');
                    })();
                }
                return makeMapSectionStream(idx, req.signal);
            }
            return makeReducerStream('# Reduced summary\nbody.\n', req.signal);
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'zh' }),
        );

        // We MUST have got a `done` — partial failure does not abort.
        const doneEv = events.find((e) => e.phase === 'done');
        expect(doneEv).toBeDefined();
        expect(doneEv!.fullText).toContain('# Reduced summary');

        // 6 map streams (1 fatal, 5 ok) + 1 reduce stream = 7 total.
        expect(mockStream).toHaveBeenCalledTimes(7);
        const reducerCall = mockStream.mock.calls.find(
            (c) => !isMapSectionRequest(c[0]),
        )!;
        const reducerUserContent = reducerCall[0].messages
            .filter((m: { role: string }) => m.role === 'user')
            .map((m: { content: string }) => m.content)
            .join('\n');
        // Five normal section notes + one placeholder.
        expect(reducerUserContent).toContain('Note 1');
        expect(reducerUserContent).toContain('Note 2');
        expect(reducerUserContent).toContain('Note 4');
        expect(reducerUserContent).toContain('Note 5');
        expect(reducerUserContent).toContain('Note 6');
        expect(reducerUserContent).toMatch(/此段摘要失敗.*invalid request/);
    });

    it('yields exactly one `partial-failure` event for that failed section (with index + error)', async () => {
        mockStream.mockImplementation((req) => {
            if (isMapSectionRequest(req)) {
                const idx = getMapSectionIndex(req);
                if (idx === 2) {
                    return (async function* () {
                        throw new Error('401 unauthorized');
                    })();
                }
                return makeMapSectionStream(idx, req.signal);
            }
            return makeAbortableStream(
                [{ delta: 'ok', done: false }, { delta: '', done: true }],
                req.signal,
            );
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'en' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(1);
        expect(partials[0].failedSectionIndex).toBe(2);
        expect(partials[0].sectionCount).toBe(6);
        expect(partials[0].error).toContain('unauthorized');
    });

    it('multiple failing sections → multiple `partial-failure` events, ordered by section index', async () => {
        // Sections 0, 3, 5 fail (0-based) with fatal 4xx so retries
        // don't fire. The remaining 1, 2, 4 succeed.
        mockStream.mockImplementation((req) => {
            if (isMapSectionRequest(req)) {
                const idx = getMapSectionIndex(req);
                if (idx === 0 || idx === 3 || idx === 5) {
                    return (async function* () {
                        throw new Error(`400 fail-${idx}`);
                    })();
                }
                return makeMapSectionStream(idx, req.signal);
            }
            return makeAbortableStream(
                [{ delta: 'r', done: false }, { delta: '', done: true }],
                req.signal,
            );
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'zh' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(3);
        expect(partials.map((p) => p.failedSectionIndex)).toEqual([0, 3, 5]);
        expect(partials[0].error).toContain('fail-0');
        // The reducer was still called — partial failure is not fatal.
        const reducerCalls = mockStream.mock.calls.filter(
            (c) => !isMapSectionRequest(c[0]),
        );
        expect(reducerCalls).toHaveLength(1);
    });

    it('all sections fail → reducer still runs with 6 placeholders, surfaces 6 partial-failure events', async () => {
        mockStream.mockImplementation((req) => {
            if (isMapSectionRequest(req)) {
                return (async function* () {
                    throw new Error('400 bad request');
                })();
            }
            // Reducer receives all-placeholder input but still streams
            // some final text (LLM degraded gracefully).
            return makeAbortableStream(
                [
                    { delta: '> Heads up: every section failed.\n', done: false },
                    { delta: '', done: true },
                ],
                req.signal,
            );
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'zh' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(6);
        // 6 fatal map streams + 1 reduce stream.
        expect(mockStream).toHaveBeenCalledTimes(7);

        // Reducer body should contain six placeholders, one per section.
        const reducerCall = mockStream.mock.calls.find(
            (c) => !isMapSectionRequest(c[0]),
        )!;
        const reducerUserContent = reducerCall[0].messages
            .filter((m: { role: string }) => m.role === 'user')
            .map((m: { content: string }) => m.content)
            .join('\n');
        const placeholderHits = reducerUserContent.match(/此段摘要失敗/g) ?? [];
        expect(placeholderHits).toHaveLength(6);

        const doneEv = events.find((e) => e.phase === 'done');
        expect(doneEv).toBeDefined();
    });

    it('zero failures → no `partial-failure` events emitted (back-compat)', async () => {
        mockStream.mockImplementation((req) => {
            if (isMapSectionRequest(req)) {
                return makeMapSectionStream(getMapSectionIndex(req), req.signal);
            }
            return makeAbortableStream(
                [{ delta: 'final', done: false }, { delta: '', done: true }],
                req.signal,
            );
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'en' }),
        );

        expect(events.filter((e) => e.phase === 'partial-failure')).toHaveLength(0);
        // Per-section progress events still emit for all 6 sections.
        expect(events.filter((e) => e.phase === 'map-section-done')).toHaveLength(6);
    });

    it('cp75.16 — emits `map-section-delta` events with section index for streaming UI', async () => {
        // Each section emits two deltas. Verify we get 6 sections × 2
        // = 12 delta events, each tagged with the right sectionIndex.
        mockStream.mockImplementation((req) => {
            if (isMapSectionRequest(req)) {
                const idx = getMapSectionIndex(req);
                return makeAbortableStream(
                    [
                        { delta: `note-${idx + 1}-part-A `, done: false },
                        { delta: `note-${idx + 1}-part-B`, done: false },
                        { delta: '', done: true },
                    ],
                    req.signal,
                );
            }
            return makeAbortableStream(
                [{ delta: 'final', done: false }, { delta: '', done: true }],
                req.signal,
            );
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'en' }),
        );

        const deltaEvents = events.filter((e) => e.phase === 'map-section-delta');
        expect(deltaEvents.length).toBeGreaterThanOrEqual(12);
        // Every delta carries a 1-based sectionIndex in [1, 6].
        for (const e of deltaEvents) {
            expect(e.sectionIndex).toBeGreaterThanOrEqual(1);
            expect(e.sectionIndex).toBeLessThanOrEqual(6);
            expect(e.sectionCount).toBe(6);
            expect(typeof e.delta).toBe('string');
        }
        // Each section produced both parts (A and B) at least once.
        for (let i = 1; i <= 6; i++) {
            const pa = deltaEvents.find(
                (e) => e.sectionIndex === i && e.delta?.includes(`note-${i}-part-A`),
            );
            const pb = deltaEvents.find(
                (e) => e.sectionIndex === i && e.delta?.includes(`note-${i}-part-B`),
            );
            expect(pa, `part-A for section ${i}`).toBeDefined();
            expect(pb, `part-B for section ${i}`).toBeDefined();
        }
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
        let mapCallCount = 0;
        // mockStream fires for both map and reduce calls. First map
        // section resolves cleanly; we abort before the others finish.
        // The inner per-section AbortController is hooked to ac, so any
        // section that hasn't resolved yet sees the cancel via signal.
        mockStream.mockImplementation((req) => {
            if (!isMapSectionRequest(req)) {
                // Reducer should never be reached.
                return makeAbortableStream(
                    [{ delta: 'should not reduce', done: false }, { delta: '', done: true }],
                    req.signal,
                );
            }
            mapCallCount++;
            if (mapCallCount === 1) {
                // First section: emit a delta then trigger abort and let
                // makeAbortableStream pick it up on the next iteration.
                return (async function* () {
                    yield { delta: 'first ok', done: false };
                    ac.abort();
                    if (req.signal?.aborted) {
                        throw new DOMException('Aborted', 'AbortError');
                    }
                    yield { delta: '', done: true };
                })();
            }
            // Subsequent calls must see the aborted (inner) signal.
            return makeAbortableStream(
                [{ delta: 'should not get here', done: false }, { delta: '', done: true }],
                req.signal,
            );
        });

        const gen = summarizeStream({
            content: makeSixSectionTranscript(),
            language: 'zh',
            signal: ac.signal,
        });

        await expect(collectEvents(gen)).rejects.toMatchObject({ name: 'AbortError' });
        // Reducer never fired — abort short-circuited the pipeline.
        const reducerCalls = mockStream.mock.calls.filter(
            (c) => !isMapSectionRequest(c[0]),
        );
        expect(reducerCalls).toHaveLength(0);
    });

    it('passes `signal` through to provider.stream (map sections + reducer)', async () => {
        const ac = new AbortController();
        mockStream.mockImplementation((req) => {
            if (isMapSectionRequest(req)) {
                return makeMapSectionStream(getMapSectionIndex(req), req.signal);
            }
            return makeAbortableStream(
                [{ delta: 'done', done: false }, { delta: '', done: true }],
                req.signal,
            );
        });

        await collectEvents(
            summarizeStream({
                content: makeSixSectionTranscript(),
                language: 'zh',
                signal: ac.signal,
            }),
        );

        const mapCalls = mockStream.mock.calls.filter((c) => isMapSectionRequest(c[0]));
        const reducerCalls = mockStream.mock.calls.filter((c) => !isMapSectionRequest(c[0]));
        expect(mapCalls.length).toBe(6);
        expect(reducerCalls.length).toBe(1);

        // Map sections get an INNER AbortSignal (hooked to ac via event
        // listener so timeouts can fire independently). Identity is no
        // longer `=== ac.signal`, but the signal must be defined and a
        // real AbortSignal — we trust the abort propagation tests above
        // to verify the wiring works end-to-end.
        for (const call of mapCalls) {
            expect(call[0].signal).toBeInstanceOf(AbortSignal);
        }
        // Reducer still receives the outer signal directly.
        expect(reducerCalls[0][0].signal).toBe(ac.signal);
    });
});

// ─── cp75.16 — Map-phase retry / timeout ─────────────────────────────

describe('classifyMapSectionError (cp75.16)', () => {
    it('returns "abort" for AbortError (DOMException + Error)', () => {
        expect(classifyMapSectionError(new DOMException('Aborted', 'AbortError'))).toBe('abort');
        const e = new Error('Aborted');
        e.name = 'AbortError';
        expect(classifyMapSectionError(e)).toBe('abort');
    });

    it('returns "transient" for timeouts', () => {
        const e = new Error('section 3 timed out after 90000ms');
        e.name = 'TimeoutError';
        expect(classifyMapSectionError(e)).toBe('transient');
        // Even non-named errors with timeout in the message classify.
        expect(classifyMapSectionError(new Error('connection timed out'))).toBe('transient');
    });

    it('returns "transient" for network errors', () => {
        expect(classifyMapSectionError(new TypeError('Failed to fetch'))).toBe('transient');
        expect(classifyMapSectionError(new Error('ECONNRESET'))).toBe('transient');
        expect(classifyMapSectionError(new Error('connection refused'))).toBe('transient');
    });

    it('returns "transient" for 429 / rate limits', () => {
        expect(classifyMapSectionError(new Error('429 Too Many Requests'))).toBe('transient');
        expect(classifyMapSectionError(new Error('rate limit exceeded'))).toBe('transient');
        expect(classifyMapSectionError(new Error('rate-limited'))).toBe('transient');
    });

    it('returns "transient" for 5xx', () => {
        expect(classifyMapSectionError(new Error('502 Bad Gateway'))).toBe('transient');
        expect(classifyMapSectionError(new Error('503 service unavailable'))).toBe('transient');
        expect(classifyMapSectionError(new Error('500 Internal Server Error'))).toBe('transient');
    });

    it('returns "fatal" for 4xx auth / quota / bad request', () => {
        expect(classifyMapSectionError(new Error('401 unauthorized'))).toBe('fatal');
        expect(classifyMapSectionError(new Error('403 forbidden'))).toBe('fatal');
        expect(classifyMapSectionError(new Error('404 not found'))).toBe('fatal');
        expect(classifyMapSectionError(new Error('400 invalid request'))).toBe('fatal');
    });
});

describe('summarizeStream — cp75.16 retry on transient failures', () => {
    it('transient error on first attempt → retries → succeeds → no partial-failure', async () => {
        // Section 2 fails first time with a 429, succeeds on retry.
        const failsRemaining: Record<number, number> = { 2: 1 };
        mockStream.mockImplementation((req) => {
            if (!isMapSectionRequest(req)) {
                return makeReducerStream('reduced', req.signal);
            }
            const idx = getMapSectionIndex(req);
            if ((failsRemaining[idx] ?? 0) > 0) {
                failsRemaining[idx]--;
                return (async function* () {
                    throw new Error('429 Too Many Requests');
                })();
            }
            return makeMapSectionStream(idx, req.signal);
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'en' }),
        );

        // No partial-failure surfaced — the retry succeeded.
        expect(events.filter((e) => e.phase === 'partial-failure')).toHaveLength(0);
        // Section 2 was called twice (1 failure + 1 retry); others once.
        const mapCalls = mockStream.mock.calls.filter((c) => isMapSectionRequest(c[0]));
        const section2Calls = mapCalls.filter((c) => getMapSectionIndex(c[0]) === 2);
        expect(section2Calls).toHaveLength(2);
        // Total map calls: 5 sections × 1 + section-2 × 2 = 7.
        expect(mapCalls).toHaveLength(7);

        const doneEv = events.find((e) => e.phase === 'done');
        expect(doneEv).toBeDefined();
    });

    it('transient error exhausts retries → partial-failure surfaces with the last error', async () => {
        // Section 4 fails every time with a transient 503. With
        // MAP_SECTION_MAX_RETRIES=2 that's 3 total attempts before we
        // give up.
        mockStream.mockImplementation((req) => {
            if (!isMapSectionRequest(req)) {
                return makeReducerStream('reduced', req.signal);
            }
            const idx = getMapSectionIndex(req);
            if (idx === 4) {
                return (async function* () {
                    throw new Error('503 Service Unavailable');
                })();
            }
            return makeMapSectionStream(idx, req.signal);
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'zh' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(1);
        expect(partials[0].failedSectionIndex).toBe(4);
        expect(partials[0].error).toContain('503');

        // Section 4 was attempted 3 times (1 + 2 retries).
        const section4Calls = mockStream.mock.calls
            .filter((c) => isMapSectionRequest(c[0]))
            .filter((c) => getMapSectionIndex(c[0]) === 4);
        expect(section4Calls).toHaveLength(3);
    }, 20_000);

    it('fatal error → NO retry → partial-failure on first attempt', async () => {
        mockStream.mockImplementation((req) => {
            if (!isMapSectionRequest(req)) {
                return makeReducerStream('reduced', req.signal);
            }
            const idx = getMapSectionIndex(req);
            if (idx === 1) {
                return (async function* () {
                    throw new Error('401 unauthorized');
                })();
            }
            return makeMapSectionStream(idx, req.signal);
        });

        const events = await collectEvents(
            summarizeStream({ content: makeSixSectionTranscript(), language: 'en' }),
        );

        const partials = events.filter((e) => e.phase === 'partial-failure');
        expect(partials).toHaveLength(1);
        // Section 1 attempted exactly once (fatal — no retry).
        const section1Calls = mockStream.mock.calls
            .filter((c) => isMapSectionRequest(c[0]))
            .filter((c) => getMapSectionIndex(c[0]) === 1);
        expect(section1Calls).toHaveLength(1);
    });

    it('AbortError → NO retry, propagates immediately', async () => {
        const ac = new AbortController();
        let mapCallCount = 0;
        mockStream.mockImplementation((req) => {
            if (!isMapSectionRequest(req)) {
                return makeReducerStream('not reached', req.signal);
            }
            mapCallCount++;
            // First map call: fire abort and throw AbortError.
            if (mapCallCount === 1) {
                ac.abort();
                return (async function* () {
                    throw new DOMException('Aborted', 'AbortError');
                })();
            }
            // Other concurrent map calls see the inner abort.
            return makeAbortableStream(
                [{ delta: 'unreached', done: false }, { delta: '', done: true }],
                req.signal,
            );
        });

        const gen = summarizeStream({
            content: makeSixSectionTranscript(),
            language: 'zh',
            signal: ac.signal,
        });

        await expect(collectEvents(gen)).rejects.toMatchObject({ name: 'AbortError' });
        // Aborted section was NOT retried — only one attempt fired.
        const firstSectionCalls = mockStream.mock.calls
            .filter((c) => isMapSectionRequest(c[0]))
            .filter((c) => getMapSectionIndex(c[0]) === 0);
        expect(firstSectionCalls).toHaveLength(1);
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
