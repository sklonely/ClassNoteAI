// Translation pipeline contract tests. Cover the three behaviours we
// committed to in the v2 streaming refactor:
//
//   1. Sequential drain — even when many sentences enqueue at once, we
//      translate one at a time so order in / order out matches.
//   2. Retry-once on transient backend errors (sidecar restart, brief
//      network hiccup) before surfacing translation_failed. Without the
//      retry, every momentary llama-server stall drops a sentence
//      permanently from the user's subtitles.
//   3. Empty/whitespace translations are surfaced as `translation_failed`
//      not `translation_ready` — silent empty rows in the UI are worse
//      than an error row a developer can grep for.

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

afterEach(() => {
  unsubscribe();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForOutcome(
  ids: string[],
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const outcomes = new Set(
      captured
        .filter(
          (e) => e.kind === 'translation_ready' || e.kind === 'translation_failed',
        )
        .map((e) => (e as { id: string }).id),
    );
    if (ids.every((id) => outcomes.has(id))) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timeout waiting for outcomes; got ${captured.length} events, ` +
      `outcomes seen: ${[...captured.filter((e) => e.kind.startsWith('translation_')).map((e) => e.kind + ':' + (e as { id: string }).id)].join(', ')}`,
  );
}

describe('TranslationPipeline.enqueue — drain order', () => {
  it('translates sentences one at a time in enqueue order', async () => {
    const order: string[] = [];
    translateRoughMock.mockImplementation(async (text: string) => {
      order.push(text);
      // Delay each call so concurrent processing would interleave.
      await new Promise((r) => setTimeout(r, 10));
      return { translated_text: `ZH(${text})`, source: 'rough', confidence: 0.9 };
    });

    translationPipeline.enqueue({ id: 'a', sessionId: 's1', textEn: 'first.', enqueuedAt: 0 });
    translationPipeline.enqueue({ id: 'b', sessionId: 's1', textEn: 'second.', enqueuedAt: 0 });
    translationPipeline.enqueue({ id: 'c', sessionId: 's1', textEn: 'third.', enqueuedAt: 0 });

    await waitForOutcome(['a', 'b', 'c']);

    expect(order).toEqual(['first.', 'second.', 'third.']);
    const readyOrder = captured
      .filter((e) => e.kind === 'translation_ready')
      .map((e) => (e as { id: string }).id);
    expect(readyOrder).toEqual(['a', 'b', 'c']);
  });
});

describe('TranslationPipeline — retry-once on transient errors', () => {
  it('retries once when translateRough throws a connect/timeout error and succeeds', async () => {
    let calls = 0;
    translateRoughMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('TranslateGemma 服務未啟動 (connect refused on :8080)');
      }
      return { translated_text: '你好', source: 'rough', confidence: 0.9 };
    });

    translationPipeline.enqueue({ id: 'r1', sessionId: 's', textEn: 'Hello.', enqueuedAt: 0 });
    await waitForOutcome(['r1']);

    expect(calls).toBe(2);
    const ready = captured.find(
      (e) => e.kind === 'translation_ready' && (e as { id: string }).id === 'r1',
    );
    expect(ready).toBeDefined();
  });

  it('does NOT retry on non-retryable errors (e.g. malformed input)', async () => {
    let calls = 0;
    translateRoughMock.mockImplementation(async () => {
      calls += 1;
      throw new Error('invalid input: source language code unknown');
    });

    translationPipeline.enqueue({ id: 'r2', sessionId: 's', textEn: 'Hello.', enqueuedAt: 0 });
    await waitForOutcome(['r2']);

    expect(calls).toBe(1);
    const failed = captured.find(
      (e) => e.kind === 'translation_failed' && (e as { id: string }).id === 'r2',
    );
    expect(failed).toBeDefined();
    expect((failed as { error: string }).error).toContain('invalid input');
  });

  it('surfaces failure after both attempts fail', async () => {
    let calls = 0;
    translateRoughMock.mockImplementation(async () => {
      calls += 1;
      throw new Error('connection refused');
    });

    translationPipeline.enqueue({ id: 'r3', sessionId: 's', textEn: 'Hello.', enqueuedAt: 0 });
    await waitForOutcome(['r3']);

    expect(calls).toBe(2); // initial + 1 retry
    const failed = captured.find(
      (e) => e.kind === 'translation_failed' && (e as { id: string }).id === 'r3',
    );
    expect(failed).toBeDefined();
  });
});

describe('TranslationPipeline — empty results', () => {
  it('emits translation_failed when backend returns whitespace-only text', async () => {
    translateRoughMock.mockResolvedValue({
      translated_text: '   \n  ',
      source: 'rough',
      confidence: 0.5,
    });

    translationPipeline.enqueue({ id: 'e1', sessionId: 's', textEn: 'Test.', enqueuedAt: 0 });
    await waitForOutcome(['e1']);

    const failed = captured.find(
      (e) => e.kind === 'translation_failed' && (e as { id: string }).id === 'e1',
    );
    expect(failed).toBeDefined();
    expect((failed as { error: string }).error).toContain('empty');
  });
});

describe('TranslationPipeline.reset', () => {
  it('is callable and idempotent (no rolling-context state to clear today)', () => {
    expect(() => translationPipeline.reset()).not.toThrow();
    expect(() => {
      translationPipeline.reset();
      translationPipeline.reset();
    }).not.toThrow();
  });
});

// ----- Phase 7 Sprint 2 · S2.2 + W9 -----
//
// awaitDrain():
//   - Lets recordingSessionService.stop() block on the LAST sentence's
//     translation coming back before flipping the lecture to 'completed'.
//   - Without it we routinely lose the final 1-2 zh subtitles because the
//     stop pipeline races ahead of the in-flight translateRough call.
//
// queue cap (W9):
//   - Defensive: if the translator wedges (sidecar dies mid-lecture) the
//     queue can grow unboundedly. 5000 cap keeps memory bounded and
//     surfaces a UI-visible 'translation_backlog' CustomEvent so the
//     TopBar / log can show the user what's happening.

describe('TranslationPipeline.awaitDrain', () => {
  it('resolves immediately when queue is empty and pipeline idle', async () => {
    // Pristine state — reset() in beforeEach + nothing enqueued.
    await expect(translationPipeline.awaitDrain()).resolves.toBeUndefined();
  });

  it('resolves only after the last enqueued job has been processed', async () => {
    translateRoughMock.mockImplementation(async (text: string) => {
      // Each translation takes ~15ms; awaitDrain must wait until queue
      // is fully drained (3 * 15ms ≈ 45ms minimum).
      await new Promise((r) => setTimeout(r, 15));
      return { translated_text: `ZH(${text})`, source: 'rough', confidence: 0.9 };
    });

    translationPipeline.enqueue({ id: 'd1', sessionId: 's', textEn: 'one.', enqueuedAt: 0 });
    translationPipeline.enqueue({ id: 'd2', sessionId: 's', textEn: 'two.', enqueuedAt: 0 });
    translationPipeline.enqueue({ id: 'd3', sessionId: 's', textEn: 'three.', enqueuedAt: 0 });

    await translationPipeline.awaitDrain();

    expect(translationPipeline.getQueueLength()).toBe(0);
    const ready = captured.filter((e) => e.kind === 'translation_ready');
    expect(ready.map((e) => (e as { id: string }).id).sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('handles concurrent awaitDrain callers — all resolve once drained', async () => {
    translateRoughMock.mockImplementation(async (text: string) => {
      await new Promise((r) => setTimeout(r, 10));
      return { translated_text: `ZH(${text})`, source: 'rough', confidence: 0.9 };
    });

    translationPipeline.enqueue({ id: 'c1', sessionId: 's', textEn: 'a.', enqueuedAt: 0 });
    translationPipeline.enqueue({ id: 'c2', sessionId: 's', textEn: 'b.', enqueuedAt: 0 });

    const p1 = translationPipeline.awaitDrain();
    const p2 = translationPipeline.awaitDrain();
    const p3 = translationPipeline.awaitDrain();

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([undefined, undefined, undefined]);
    expect(translationPipeline.getQueueLength()).toBe(0);
  });
});

describe('TranslationPipeline — queue cap (W9)', () => {
  // We don't want to actually push 5000+ jobs in a unit test — temporarily
  // shrink the cap via the test helper. afterEach restores via reset().
  const TEST_CAP = 5;

  afterEach(() => {
    translationPipeline.__setMaxQueueSizeForTest(null); // restore default
  });

  it('drops jobs once the queue hits MAX_QUEUE_SIZE', async () => {
    // Translator never resolves → queue grows unbounded without the cap.
    let resolveHold: (() => void) | null = null;
    translateRoughMock.mockImplementation(
      () =>
        new Promise(() => {
          // Hold the first job forever; subsequent jobs can never start
          // because drain() is sequential. This forces the queue to fill.
          resolveHold = () => {}; // noop — keep promise pending
        }),
    );

    translationPipeline.__setMaxQueueSizeForTest(TEST_CAP);

    // First job: gets pulled by drain() and held pending. So it leaves the
    // queue immediately. The remaining TEST_CAP slots fill from #2..#(TEST_CAP+1).
    // Pushing more than that should drop them.
    for (let i = 0; i < TEST_CAP + 10; i++) {
      translationPipeline.enqueue({
        id: `cap${i}`,
        sessionId: 's',
        textEn: `t${i}.`,
        enqueuedAt: 0,
      });
    }

    expect(translationPipeline.getQueueLength()).toBeLessThanOrEqual(TEST_CAP);
    void resolveHold;
  });

  it('emits translation_backlog CustomEvent on the window when dropping', async () => {
    translateRoughMock.mockImplementation(() => new Promise(() => {})); // never resolves

    translationPipeline.__setMaxQueueSizeForTest(TEST_CAP);

    const handler = vi.fn();
    window.addEventListener('translation_backlog', handler as EventListener);
    try {
      // Push enough to exceed the cap (1 in-flight + TEST_CAP queued + several dropped).
      for (let i = 0; i < TEST_CAP + 8; i++) {
        translationPipeline.enqueue({
          id: `bk${i}`,
          sessionId: 's',
          textEn: `t${i}.`,
          enqueuedAt: 0,
        });
      }
      expect(handler).toHaveBeenCalled();
      const evt = handler.mock.calls[0][0] as CustomEvent;
      expect(evt.type).toBe('translation_backlog');
      expect(evt.detail).toMatchObject({
        dropped: expect.any(Number),
        queueSize: expect.any(Number),
      });
      expect((evt.detail as { dropped: number }).dropped).toBeGreaterThan(0);
    } finally {
      window.removeEventListener('translation_backlog', handler as EventListener);
    }
  });

  it('does not drop or emit backlog event when queue stays below cap', async () => {
    translateRoughMock.mockImplementation(() => new Promise(() => {})); // never resolves

    translationPipeline.__setMaxQueueSizeForTest(TEST_CAP);

    const handler = vi.fn();
    window.addEventListener('translation_backlog', handler as EventListener);
    try {
      // Push TEST_CAP - 1 jobs total. First gets pulled to in-flight, the
      // rest sit in queue (length = TEST_CAP - 2). Below cap → no drop.
      for (let i = 0; i < TEST_CAP - 1; i++) {
        translationPipeline.enqueue({
          id: `nd${i}`,
          sessionId: 's',
          textEn: `t${i}.`,
          enqueuedAt: 0,
        });
      }
      expect(handler).not.toHaveBeenCalled();
      expect(translationPipeline.getQueueLength()).toBeLessThan(TEST_CAP);
    } finally {
      window.removeEventListener('translation_backlog', handler as EventListener);
    }
  });
});

// flushMicrotasks kept around in case future tests need finer-grained
// scheduling than the polling waitForOutcome above.
void flushMicrotasks;
