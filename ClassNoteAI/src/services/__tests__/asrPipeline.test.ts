// Asr pipeline behavioural tests. The hard one is the tail-loss
// regression — pre-fix, `stop()` tore down its `asr-text` listener
// BEFORE awaiting `asr_end_session`, so the 1-3 word tail the engine
// emits inside its zero-flush phase never reached SentenceAccumulator
// or the subtitle stream. The transcript returned from end_session
// contained those words, but UI consumers reading subtitleStream lost
// them silently. These tests pin the corrected order.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Per-test reset of mocks defined in src/test/setup.ts. We reach into
// the same `invoke` mock the setup file installed.
import { invoke as invokeRaw } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const invoke = invokeRaw as unknown as ReturnType<typeof vi.fn>;
const listenMock = listen as unknown as ReturnType<typeof vi.fn>;

// Captured listener handlers, by event name, so tests can fire events
// at well-defined moments in the lifecycle.
let handlers: Map<string, (event: { payload: unknown }) => void>;

import { subtitleStream, type SubtitleEvent } from '../streaming/subtitleStream';
import { asrPipeline } from '../streaming/asrPipeline';

let captured: SubtitleEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  captured = [];
  unsubscribe = subtitleStream.subscribe((e) => captured.push(e));
  handlers = new Map();

  // Wire `listen()` to record the test-side handler, so we can fire
  // events on demand. Returns an unlisten function that drops the
  // handler from the map.
  listenMock.mockImplementation((eventName: string, handler: (e: { payload: unknown }) => void) => {
    handlers.set(eventName, handler);
    return Promise.resolve(() => {
      handlers.delete(eventName);
    });
  });
});

afterEach(async () => {
  // Clean up the pipeline so state doesn't bleed between tests.
  // stop() calls invoke('asr_end_session') which the per-test default
  // mock resolves to "" — fine.
  try {
    await asrPipeline.stop();
  } catch {
    /* ignore — some tests intentionally leave it in a partial state */
  }
  unsubscribe();
});

function fireAsrText(payload: {
  session_id: string;
  delta: string;
  audio_end_sec: number;
  transcript?: string;
}): void {
  const handler = handlers.get('asr-text');
  if (!handler) {
    throw new Error("listener for 'asr-text' is not attached — start() must run first");
  }
  handler({ payload });
}

describe('asrPipeline.start → onText → subtitleStream', () => {
  it('emits a sentence_committed event after a full sentence accumulates', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_parakeet_status') {
        return { model_present: true, model_loaded: true, session_active: false };
      }
      return null;
    });

    await asrPipeline.start();
    const sessionId = (asrPipeline as unknown as { sessionId: string }).sessionId;

    // Simulate the engine emitting a 4-word sentence over 1.2 s of audio.
    // Per-word duration ~300 ms; total span 1.2 s ⇒ above MIN_DURATION_MS.
    fireAsrText({ session_id: sessionId, delta: 'We will use', audio_end_sec: 0.9 });
    fireAsrText({ session_id: sessionId, delta: 'gradient descent.', audio_end_sec: 1.2 });

    // Allow microtasks to flush so subscribers see the event.
    await Promise.resolve();

    const committed = captured.filter((e) => e.kind === 'sentence_committed');
    expect(committed.length).toBe(1);
    expect((committed[0] as { textEn: string }).textEn).toContain('gradient descent.');
  });

  it('emits partial_text for buffered ASR text before a sentence boundary commits', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_parakeet_status') {
        return { model_present: true, model_loaded: true, session_active: false };
      }
      return null;
    });

    await asrPipeline.start();
    const sessionId = (asrPipeline as unknown as { sessionId: string }).sessionId;

    fireAsrText({ session_id: sessionId, delta: 'this is still buffering', audio_end_sec: 1.2 });
    await Promise.resolve();

    const partial = [...captured].reverse().find((e) => e.kind === 'partial_text');
    expect(partial).toBeDefined();
    expect((partial as { text: string }).text).toBe('this is still buffering');
    expect(captured.filter((e) => e.kind === 'sentence_committed')).toHaveLength(0);
  });

  it('commits stabilized transcript text instead of raw split deltas', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_parakeet_status') {
        return { model_present: true, model_loaded: true, session_active: false };
      }
      return null;
    });

    await asrPipeline.start();
    const sessionId = (asrPipeline as unknown as { sessionId: string }).sessionId;

    fireAsrText({
      session_id: sessionId,
      delta: 'It is actually doubly link',
      transcript: 'It is actually doubly link',
      audio_end_sec: 0.9,
    });
    fireAsrText({
      session_id: sessionId,
      delta: 'ed list.',
      transcript: 'It is actually doubly linked list.',
      audio_end_sec: 1.8,
    });

    await Promise.resolve();

    const committed = captured.filter((e) => e.kind === 'sentence_committed');
    expect(committed).toHaveLength(1);
    expect((committed[0] as { textEn: string }).textEn).toBe('It is actually doubly linked list.');
  });

  it('accepts the current per-variant Parakeet status shape', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_parakeet_status') {
        return {
          variants: [
            { variant: 'int8', present: true },
            { variant: 'fp32', present: false },
          ],
          loaded_variant: null,
          model_loaded: false,
          session_active: false,
        };
      }
      return null;
    });

    await expect(asrPipeline.start()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('asr_start_session', expect.objectContaining({
      sessionId: expect.any(String),
    }));
  });

  it('ignores asr-text events from a different session id', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_parakeet_status') {
        return { model_present: true };
      }
      return null;
    });
    await asrPipeline.start();

    fireAsrText({ session_id: 'some-other-session', delta: 'noise.', audio_end_sec: 1.5 });
    await Promise.resolve();

    expect(captured.filter((e) => e.kind === 'sentence_committed')).toHaveLength(0);
  });
});

describe('asrPipeline.stop — tail-loss regression (#R1)', () => {
  it('keeps the asr-text listener attached across asr_end_session so tail deltas reach the stream', async () => {
    // Wire invoke so that asr_end_session FIRES tail asr-text events
    // *during* its execution, mimicking what the Rust end_session does
    // when it pads the sub-chunk tail and runs the three zero-flushes.
    let sessionId = '';
    invoke.mockImplementation(async (cmd: string, args?: { sessionId?: string }) => {
      if (cmd === 'get_parakeet_status') {
        return { model_present: true };
      }
      if (cmd === 'asr_start_session') {
        sessionId = args!.sessionId!;
        return null;
      }
      if (cmd === 'asr_end_session') {
        // Inside end_session: simulate 2 tail emits before resolving.
        fireAsrText({ session_id: sessionId, delta: 'tail clause one.', audio_end_sec: 5.5 });
        fireAsrText({ session_id: sessionId, delta: 'tail clause two.', audio_end_sec: 6.0 });
        return 'tail clause one. tail clause two.';
      }
      return null;
    });

    await asrPipeline.start();

    // Build up enough audio so the boundary thresholds (≥3 words, ≥800ms)
    // would otherwise have already emitted before stop. We deliberately
    // emit a single short delta first that doesn't trip the boundary,
    // forcing accumulator to hold until the tail emits inside stop().
    fireAsrText({ session_id: sessionId, delta: 'before stop', audio_end_sec: 1.0 });
    await Promise.resolve();

    // No sentence yet — only 2 words, no terminator.
    expect(captured.filter((e) => e.kind === 'sentence_committed')).toHaveLength(0);

    await asrPipeline.stop();

    // After the fix: the tail emits inside end_session reached the
    // listener, fed the accumulator, and produced sentences. Before
    // the fix this assertion failed (committed.length === 0).
    const committed = captured.filter((e) => e.kind === 'sentence_committed');
    expect(committed.length).toBeGreaterThanOrEqual(1);
    const allText = committed
      .map((e) => (e as { textEn: string }).textEn)
      .join(' || ');
    expect(allText).toContain('tail clause one.');
  });

  it('emits session_ended exactly once after stop()', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_parakeet_status') return { model_present: true };
      if (cmd === 'asr_end_session') return '';
      return null;
    });

    await asrPipeline.start();
    await asrPipeline.stop();

    const ended = captured.filter((e) => e.kind === 'session_ended');
    expect(ended).toHaveLength(1);
  });

  it('stop() called twice is a no-op the second time', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_parakeet_status') return { model_present: true };
      if (cmd === 'asr_end_session') return '';
      return null;
    });
    await asrPipeline.start();
    await asrPipeline.stop();
    await asrPipeline.stop();
    expect(captured.filter((e) => e.kind === 'session_ended')).toHaveLength(1);
  });
});
