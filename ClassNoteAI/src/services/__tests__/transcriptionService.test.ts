// transcriptionService is a thin shim over asrPipeline + the
// subtitleStream → subtitleService bridge. These tests cover the
// behavioural contract that LectureView / NotesView depend on:
//
//   * `pause()` followed by `addAudioChunk()` must NOT silently kick
//     off a fresh `asrPipeline.start()` — the pre-fix code did exactly
//     that, killing the in-flight session and dropping the chunk that
//     resumed playback.
//   * `clear()` resets all state cleanly even mid-session.
//
// We mock asrPipeline so we can assert on its method calls without
// spinning up a real Parakeet session.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
const pushAudioMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../streaming/asrPipeline', () => ({
  asrPipeline: {
    start: (...args: unknown[]) => startMock(...args),
    stop: () => stopMock(),
    pushAudio: (chunk: Int16Array) => pushAudioMock(chunk),
  },
}));

import { transcriptionService } from '../transcriptionService';
import type { AudioChunk } from '../audioRecorder';

function fakeChunk(samples: number[] = [1, 2, 3]): AudioChunk {
  return {
    data: new Int16Array(samples),
    timestamp: 0,
    sampleRate: 16000,
  } as AudioChunk;
}

beforeEach(() => {
  startMock.mockClear();
  stopMock.mockClear();
  pushAudioMock.mockClear();
});

afterEach(async () => {
  await transcriptionService.stop();
  transcriptionService.clear();
});

describe('transcriptionService.start / stop', () => {
  it('start() calls asrPipeline.start once; idempotent on repeat', async () => {
    await transcriptionService.start();
    await transcriptionService.start();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('stop() calls asrPipeline.stop and is safe to repeat', async () => {
    await transcriptionService.start();
    await transcriptionService.stop();
    await transcriptionService.stop();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});

describe('transcriptionService.addAudioChunk — implicit start', () => {
  it('fires asrPipeline.start when no session is active yet', async () => {
    transcriptionService.addAudioChunk(fakeChunk());
    // start() is called fire-and-forget; await one microtask so the
    // mock registers the invocation.
    await Promise.resolve();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('forwards the chunk to asrPipeline.pushAudio', async () => {
    await transcriptionService.start();
    const chunk = fakeChunk([42, 43, 44]);
    transcriptionService.addAudioChunk(chunk);
    expect(pushAudioMock).toHaveBeenCalledWith(chunk.data);
  });

  it('waits for the ASR session to finish starting before pushing the first chunk', async () => {
    let resolveStart!: () => void;
    startMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveStart = resolve;
      }),
    );

    const chunk = fakeChunk([10, 11, 12]);
    transcriptionService.addAudioChunk(chunk);
    await Promise.resolve();

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(pushAudioMock).not.toHaveBeenCalled();

    resolveStart();
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushAudioMock).toHaveBeenCalledWith(chunk.data);
  });
});

describe('transcriptionService.pause / resume — regression #R3', () => {
  it('pause() does NOT stop the underlying session', async () => {
    await transcriptionService.start();
    transcriptionService.pause();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('addAudioChunk while paused drops the chunk and does NOT trigger a re-start', async () => {
    await transcriptionService.start();
    startMock.mockClear();
    transcriptionService.pause();
    transcriptionService.addAudioChunk(fakeChunk());
    transcriptionService.addAudioChunk(fakeChunk());
    await Promise.resolve();
    // Pre-fix: `pause()` set `active=false` which made the next
    // addAudioChunk see `!active` and call `start()` again, killing
    // the in-flight session.
    expect(startMock).not.toHaveBeenCalled();
    expect(pushAudioMock).not.toHaveBeenCalled();
  });

  it('addAudioChunk after resume() flows again to the same session', async () => {
    await transcriptionService.start();
    transcriptionService.pause();
    transcriptionService.resume();
    transcriptionService.addAudioChunk(fakeChunk([7, 8, 9]));
    expect(pushAudioMock).toHaveBeenCalledTimes(1);
  });
});

describe('transcriptionService.clear', () => {
  it('clears lecture id and source language', async () => {
    transcriptionService.setLectureId('abc');
    transcriptionService.setLanguages('en', 'zh');
    await transcriptionService.start();
    transcriptionService.clear();
    expect(transcriptionService.lectureId).toBeNull();
  });
});

describe('transcriptionService — deprecated no-ops kept for back-compat', () => {
  it('setInitialPrompt is a silent no-op', () => {
    expect(() => transcriptionService.setInitialPrompt('foo', 'bar')).not.toThrow();
  });
  it('setRefineIntensity is a silent no-op', () => {
    expect(() => transcriptionService.setRefineIntensity('deep')).not.toThrow();
  });
  it('refreshFineRefinementAvailability resolves immediately', async () => {
    await expect(transcriptionService.refreshFineRefinementAvailability()).resolves.toBeUndefined();
  });
});
