/**
 * H18 LLM streaming mock helpers — Phase 7 / S0.3.
 *
 * Sprint 2 sub-agents will write a lot of tests against streaming
 * LLM call sites (`summarizeStream`, `chatStream`, RAG `chatStream`,
 * etc.). All of those return `AsyncIterable<...>`, which is fiddly
 * to mock by hand: forgetting `async`, forgetting the generator `*`,
 * mixing `Promise<AsyncIterable>` with `AsyncIterable<Promise>` —
 * the same handful of bugs over and over.
 *
 * This module gives every test a small, type-safe surface:
 *
 *   • `makeStreamFromChunks(['a', 'b'])` — synchronous-feeling stream;
 *     useful when you don't care about timing.
 *   • `makeAsyncStream(['a', 'b'], delayMs)` — yields between chunks
 *     via `setTimeout(0)` so the event loop turns; closer to a real
 *     network stream and lets test code observe intermediate UI state
 *     between deltas.
 *   • `makeStreamThatThrows([...], err)` — yields a few chunks then
 *     throws; for testing error fallback paths.
 *   • `collectStream(stream)` — drains an `AsyncIterable<T>` into
 *     `T[]` so tests can `expect(arr).toEqual(...)`.
 *   • `mockSummarizeStream([...])` — applies a `vi.spyOn` against
 *     `services/llm/tasks#summarizeStream` and returns a handle with
 *     `.restore()` + `.calls`.
 *
 * Design notes:
 *   • This module deliberately does NOT import any service module at
 *     top level. `mockSummarizeStream` dynamic-imports `tasks` so the
 *     helper file itself stays import-cycle-free.
 *   • Generic `collectStream<T>` lets tests use it on streams of
 *     events too (e.g. `SummarizeStreamEvent`), not just strings.
 *
 * Example usage (Sprint 2 chat test sketch):
 *
 *   import { describe, it, expect } from 'vitest';
 *   import { mockSummarizeStream, collectStream } from '@/test/h18-llm-mocks';
 *
 *   it('renders streaming summary', async () => {
 *     const handle = mockSummarizeStream(['## Header\n', 'body text']);
 *     try {
 *       // ... mount component, trigger summarize, assert ...
 *       expect(handle.calls).toHaveLength(1);
 *     } finally {
 *       handle.restore();
 *     }
 *   });
 */

import { vi } from 'vitest';

// ─── Basic stream constructors ──────────────────────────────────────

/**
 * Build a fake `AsyncIterable<string>` that yields each chunk in
 * order, with no awaits between them. Equivalent to wrapping a sync
 * array in async-iter clothes — fine when timing isn't part of the
 * thing under test.
 */
export function makeStreamFromChunks(chunks: string[]): AsyncIterable<string> {
    // Implemented via an async generator so the returned object is a
    // genuine AsyncIterable (has both Symbol.asyncIterator AND the
    // generator's iterator protocol). Hand-rolling { [Symbol.asyncIterator]() }
    // works too but trips up some downstream code that does
    // `instanceof` checks on the result of `gen.next()`.
    async function* gen(): AsyncIterable<string> {
        for (const c of chunks) yield c;
    }
    return gen();
}

/**
 * Build an async stream that awaits `delayMs` (default 0 → microtask
 * tick) between chunks. The default of 0 is deliberate: it still
 * yields control to the event loop, which is the realistic behaviour
 * for "streaming feels async even though it's instant in tests".
 */
export async function* makeAsyncStream(
    chunks: string[],
    delayMs: number = 0,
): AsyncIterable<string> {
    for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
            // Even at delayMs=0 this yields a real macrotask, not just a
            // microtask — useful for letting React state-flushes happen
            // between deltas under test.
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
        yield chunks[i];
    }
}

/**
 * Build a stream that yields the given chunks then throws `err`. If
 * `yieldedChunks` is empty, throws on the first `.next()` call.
 *
 * Useful for testing error-fallback paths in components that consume
 * `summarizeStream` / `chatStream` (they should render whatever was
 * delta'd before the throw, then surface the error).
 */
export function makeStreamThatThrows(
    yieldedChunks: string[],
    err: Error,
): AsyncIterable<string> {
    async function* gen(): AsyncIterable<string> {
        for (const c of yieldedChunks) yield c;
        throw err;
    }
    return gen();
}

// ─── Drain helper ───────────────────────────────────────────────────

/**
 * Drain an `AsyncIterable<T>` into a `T[]`. Re-throws errors from the
 * stream so tests can `await expect(collectStream(...)).rejects...`.
 */
export async function collectStream<T = string>(
    stream: AsyncIterable<T>,
): Promise<T[]> {
    const out: T[] = [];
    for await (const item of stream) out.push(item);
    return out;
}

// ─── summarizeStream spy helper ─────────────────────────────────────

/** Handle returned by `mockSummarizeStream`. */
export interface MockSummarizeStreamHandle {
    /** Restore the original `summarizeStream` implementation. Always
     *  call this in a `finally` so a failing test doesn't bleed the
     *  spy into adjacent tests. */
    restore: () => void;
    /** Per-invocation call records. Each entry has `args` (the
     *  positional argument list passed to `summarizeStream`). */
    calls: Array<{ args: unknown[] }>;
}

/**
 * Spy on `services/llm/tasks#summarizeStream` and replace its body
 * with a generator that yields the configured chunks wrapped as
 * `SummarizeStreamEvent` objects (one `reduce-start`, one
 * `reduce-delta` per chunk, one `done` at the end with the assembled
 * `fullText`).
 *
 * The wrapping mimics the shape `summarizeStream` actually emits, so
 * call-sites (NotesView.handleGenerateSummary etc.) that branch on
 * `phase` will go through their happy path.
 *
 * Implemented via dynamic-import + `vi.spyOn` so this helper module
 * doesn't import the tasks module at top level (keeps Sprint 2 sub-
 * agents from accidentally pulling in the LLM provider chain when
 * they only wanted the mock helpers).
 *
 * Note: dynamic import inside `vi.spyOn` is asynchronous; we kick it
 * off and stash the spy install in a Promise behind `restore()`.
 * Tests that need to wait for the spy to be live should `await` the
 * first call (the dynamic import resolves on the same microtask
 * before any code that imported tasks could call summarizeStream).
 */
export function mockSummarizeStream(chunks: string[]): MockSummarizeStreamHandle {
    const calls: Array<{ args: unknown[] }> = [];

    // The mock generator. Captures args into `calls` on each invocation.
    function makeMockImpl() {
        return async function* mockImpl(...args: unknown[]) {
            calls.push({ args });
            yield { phase: 'reduce-start' as const };
            let fullText = '';
            for (const chunk of chunks) {
                fullText += chunk;
                yield { phase: 'reduce-delta' as const, delta: chunk };
            }
            yield { phase: 'done' as const, fullText };
        };
    }

    // We need a real spy reference for restore. The dynamic import
    // resolves synchronously on next-microtask in Vitest's ESM loader,
    // but we can't assume that — so capture the spy through a closure
    // and let `restore()` await the install if the test races it.
    let spy: ReturnType<typeof vi.spyOn> | null = null;
    let restoreCalled = false;

    const installPromise = (async () => {
        const tasks = await import('../services/llm/tasks');
        if (restoreCalled) return; // raced against an early restore
        spy = vi.spyOn(tasks, 'summarizeStream').mockImplementation(
            // Cast: the mock impl returns AsyncGenerator<SummarizeStreamEvent>
            // with the right shape; vi.spyOn's inferred type pins it to the
            // exact original signature, so we need to satisfy it.
            makeMockImpl() as unknown as typeof tasks.summarizeStream,
        );
    })();

    return {
        calls,
        restore: () => {
            restoreCalled = true;
            // If the install already landed, restore now. Otherwise it
            // will short-circuit on the `restoreCalled` flag.
            if (spy) {
                spy.mockRestore();
                spy = null;
            } else {
                // Fire-and-forget: when install resolves, it'll see the
                // flag and skip applying. No await needed because the
                // caller invoking restore() expects sync semantics.
                void installPromise;
            }
        },
    };
}
