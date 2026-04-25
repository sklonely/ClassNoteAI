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
  timeoutMs = 2000,
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

// flushMicrotasks kept around in case future tests need finer-grained
// scheduling than the polling waitForOutcome above.
void flushMicrotasks;
