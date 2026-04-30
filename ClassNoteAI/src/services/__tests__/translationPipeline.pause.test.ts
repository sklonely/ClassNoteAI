/**
 * translationPipeline — cp75.25 P1-B pause/resume tests.
 *
 * Pause stops dispatching new jobs from the queue. Already-running jobs
 * (the one currently awaiting translateRough) finish their HTTP roundtrip
 * — we can't kill them mid-call cleanly. Resume picks up where pause left
 * off; idempotent on both sides.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const translateRoughMock = vi.fn();
vi.mock('../translationService', () => ({
    translateRough: (
        text: string,
        sourceLang: string,
        targetLang: string,
        useCache: boolean,
    ) => translateRoughMock(text, sourceLang, targetLang, useCache),
}));

import { subtitleStream, type SubtitleEvent } from '../streaming/subtitleStream';
import { translationPipeline } from '../streaming/translationPipeline';

let captured: SubtitleEvent[];
let unsubscribe: () => void;

beforeEach(() => {
    captured = [];
    unsubscribe = subtitleStream.subscribe((e) => captured.push(e));
    translateRoughMock.mockReset();
    translationPipeline.reset();
});

afterEach(async () => {
    unsubscribe();
    // Release any pause state and drop queued jobs from a failing test,
    // so the next test's drain loop isn't stuck waiting on the gate
    // and stale jobs don't bleed into the next test's mock counter.
    translationPipeline.reset();
    // Give any in-flight drain coroutine that woke up via reset() a
    // chance to land before the next test's mock state is set up.
    await new Promise((r) => setTimeout(r, 20));
});

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

async function waitForReady(id: string, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (
            captured.some(
                (e) =>
                    e.kind === 'translation_ready' &&
                    (e as { id: string }).id === id,
            )
        ) {
            return;
        }
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(
        `timeout waiting for translation_ready id=${id}; events: ${captured.map((e) => e.kind).join(',')}`,
    );
}

describe('translationPipeline — cp75.25 pause/resume', () => {
    it('pause() stops dispatching new translations from the queue', async () => {
        translateRoughMock.mockImplementation(async (text: string) => ({
            translated_text: `ZH(${text})`,
            source: 'rough',
            confidence: 0.9,
        }));

        // Pause BEFORE any enqueue so the drain loop has no in-flight
        // job — the queued items must never be dispatched.
        translationPipeline.pause();
        expect(translationPipeline.isPaused()).toBe(true);

        translationPipeline.enqueue({
            id: 'p1',
            sessionId: 's',
            textEn: 'first.',
            enqueuedAt: 0,
        });
        translationPipeline.enqueue({
            id: 'p2',
            sessionId: 's',
            textEn: 'second.',
            enqueuedAt: 0,
        });

        // Give the loop several microtask ticks to misbehave if it's
        // going to.
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 50));
        await flushMicrotasks();

        expect(translateRoughMock).not.toHaveBeenCalled();
        expect(
            captured.filter((e) => e.kind === 'translation_ready').length,
        ).toBe(0);
    });

    it('resume() restarts dispatch and the queued jobs translate', async () => {
        translateRoughMock.mockImplementation(async (text: string) => ({
            translated_text: `ZH(${text})`,
            source: 'rough',
            confidence: 0.9,
        }));

        translationPipeline.pause();
        translationPipeline.enqueue({
            id: 'r1',
            sessionId: 's',
            textEn: 'hello.',
            enqueuedAt: 0,
        });
        await flushMicrotasks();
        expect(translateRoughMock).not.toHaveBeenCalled();

        translationPipeline.resume();
        expect(translationPipeline.isPaused()).toBe(false);

        await waitForReady('r1');
        expect(translateRoughMock).toHaveBeenCalledTimes(1);
    });

    it('pause/resume is idempotent (multiple pauses without resume = single pause)', async () => {
        translateRoughMock.mockImplementation(async (text: string) => ({
            translated_text: `ZH(${text})`,
            source: 'rough',
            confidence: 0.9,
        }));

        translationPipeline.pause();
        translationPipeline.pause();
        translationPipeline.pause();
        expect(translationPipeline.isPaused()).toBe(true);

        translationPipeline.enqueue({
            id: 'i1',
            sessionId: 's',
            textEn: 'hi.',
            enqueuedAt: 0,
        });
        await flushMicrotasks();
        expect(translateRoughMock).not.toHaveBeenCalled();

        // A single resume() must lift the pause regardless of how many
        // pause()s preceded it.
        translationPipeline.resume();
        expect(translationPipeline.isPaused()).toBe(false);

        await waitForReady('i1');
    });

    it('resume() without a prior pause() is a no-op', () => {
        expect(translationPipeline.isPaused()).toBe(false);
        expect(() => translationPipeline.resume()).not.toThrow();
        expect(translationPipeline.isPaused()).toBe(false);
    });

    it('pause() after enqueue lets the in-flight job finish but blocks subsequent ones', async () => {
        let firstResolve: (v: unknown) => void = () => undefined;
        const calls: string[] = [];
        translateRoughMock.mockImplementation(async (text: string) => {
            calls.push(text);
            if (text === 'a.') {
                // Hold the first call open so we can pause while it's
                // in-flight.
                return new Promise((resolve) => {
                    firstResolve = resolve;
                });
            }
            return {
                translated_text: `ZH(${text})`,
                source: 'rough',
                confidence: 0.9,
            };
        });

        translationPipeline.enqueue({
            id: 'a',
            sessionId: 's',
            textEn: 'a.',
            enqueuedAt: 0,
        });
        translationPipeline.enqueue({
            id: 'b',
            sessionId: 's',
            textEn: 'b.',
            enqueuedAt: 0,
        });

        // Wait for the first call to actually be dispatched.
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 10));
        expect(calls).toEqual(['a.']);

        // Now pause — the in-flight 'a' will finish; 'b' must NOT
        // dispatch.
        translationPipeline.pause();

        // Let 'a' resolve.
        firstResolve({
            translated_text: 'ZH(a.)',
            source: 'rough',
            confidence: 0.9,
        });
        await waitForReady('a');

        // Give the loop time to misbehave.
        await new Promise((r) => setTimeout(r, 50));
        await flushMicrotasks();

        // 'b' must still be queued, not dispatched.
        expect(calls).toEqual(['a.']);
        expect(
            captured.find(
                (e) =>
                    e.kind === 'translation_ready' &&
                    (e as { id: string }).id === 'b',
            ),
        ).toBeUndefined();

        // Resume — 'b' should now translate.
        translationPipeline.resume();
        await waitForReady('b');
        expect(calls).toEqual(['a.', 'b.']);
    });

    it('reset() clears pause state', async () => {
        translateRoughMock.mockImplementation(async (text: string) => ({
            translated_text: `ZH(${text})`,
            source: 'rough',
            confidence: 0.9,
        }));

        translationPipeline.pause();
        expect(translationPipeline.isPaused()).toBe(true);

        translationPipeline.reset();
        expect(translationPipeline.isPaused()).toBe(false);

        // After reset, a fresh enqueue must dispatch normally.
        translationPipeline.enqueue({
            id: 'x',
            sessionId: 's',
            textEn: 'x.',
            enqueuedAt: 0,
        });
        await waitForReady('x');
    });
});
