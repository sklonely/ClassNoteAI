/**
 * Phase 1 of speech-pipeline-v0.6.5 (#52). The transcript-JSONL
 * recovery path must satisfy three invariants:
 *
 *   1. recoverTranscript imports every well-formed segment into
 *      sqlite, not just one or some.
 *   2. recover() always imports the transcript BEFORE finalizing
 *      the audio, so a finalize failure leaves the JSONL on disk
 *      for a retry next launch.
 *   3. When the same segment id appears twice (rough-only line
 *      followed by rough+text_zh line), the LATER entry wins —
 *      that is the version with the translation.
 *
 * The Tauri IPC is mocked so we can drive the contract end-to-end
 * without spinning up the Rust runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setMockInvokeResult, clearMockInvokeResults } from '../../test/setup';
import { invoke } from '@tauri-apps/api/core';
import { recordingRecoveryService } from '../recordingRecoveryService';

beforeEach(() => {
  clearMockInvokeResults();
  vi.clearAllMocks();
});

describe('recordingRecoveryService.recoverTranscript', () => {
  it('returns 0 when no JSONL sidecar exists', async () => {
    setMockInvokeResult('read_orphaned_transcript', []);
    const n = await recordingRecoveryService.recoverTranscript('lec-empty');
    expect(n).toBe(0);
    // No segments → no save call.
    const saveCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === 'save_subtitles');
    expect(saveCall).toBeUndefined();
  });

  it('imports every well-formed segment into sqlite via save_subtitles', async () => {
    setMockInvokeResult('read_orphaned_transcript', [
      { id: 'a', timestamp: 1.0, text_en: 'hello', text_zh: null, type: 'rough' },
      { id: 'b', timestamp: 2.0, text_en: 'world', text_zh: '世界', type: 'rough' },
      { id: 'c', timestamp: 3.0, text_en: 'goodbye', text_zh: null, type: 'rough' },
    ]);
    setMockInvokeResult('save_subtitles', undefined);

    const n = await recordingRecoveryService.recoverTranscript('lec-3');
    expect(n).toBe(3);

    const saveCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === 'save_subtitles');
    expect(saveCall).toBeDefined();
    const subtitles = (saveCall![1] as { subtitles: unknown[] }).subtitles;
    expect(subtitles).toHaveLength(3);
  });

  it('dedupes by id and keeps the latest entry (with translation populated)', async () => {
    // First the rough-only commit, then the rough+text_zh upgrade —
    // common when translation completes between two sqlite flushes.
    setMockInvokeResult('read_orphaned_transcript', [
      { id: 'dup', timestamp: 1.0, text_en: 'hi', text_zh: null, type: 'rough' },
      { id: 'dup', timestamp: 1.0, text_en: 'hi', text_zh: '嗨', type: 'rough' },
    ]);
    setMockInvokeResult('save_subtitles', undefined);

    const n = await recordingRecoveryService.recoverTranscript('lec-dup');
    expect(n).toBe(1);

    const saveCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === 'save_subtitles');
    const subtitles = (saveCall![1] as {
      subtitles: Array<{ id: string; text_zh: string | null }>;
    }).subtitles;
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].text_zh).toBe('嗨');
  });

  it('returns 0 when read_orphaned_transcript IPC fails (logged, not thrown)', async () => {
    // Simulate a Rust-side failure (lecture id rejected, IO error,
    // whatever). recoverTranscript must not propagate — the recovery
    // flow degrades to "audio only" in that case rather than refusing
    // to recover anything.
    vi.mocked(invoke).mockImplementationOnce(() =>
      Promise.reject(new Error('rust threw')),
    );
    const n = await recordingRecoveryService.recoverTranscript('lec-err');
    expect(n).toBe(0);
  });
});

describe('recordingRecoveryService.recover (full flow)', () => {
  it('imports transcript BEFORE finalize, then discards JSONL after both succeed', async () => {
    const callOrder: string[] = [];
    vi.mocked(invoke).mockImplementation((cmd) => {
      callOrder.push(cmd);
      if (cmd === 'get_audio_dir') return Promise.resolve('/tmp/audio');
      if (cmd === 'read_orphaned_transcript') {
        return Promise.resolve([
          { id: 'a', timestamp: 0.5, text_en: 'x', text_zh: null, type: 'rough' },
        ] as unknown);
      }
      if (cmd === 'save_subtitles') return Promise.resolve(undefined);
      if (cmd === 'finalize_recording') return Promise.resolve(0);
      if (cmd === 'discard_orphaned_transcript') return Promise.resolve(undefined);
      if (cmd === 'update_lecture_status') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await recordingRecoveryService.recover('lec-flow');

    const transcriptIdx = callOrder.indexOf('save_subtitles');
    const finalizeIdx = callOrder.indexOf('finalize_recording');
    const discardIdx = callOrder.indexOf('discard_orphaned_transcript');

    expect(transcriptIdx).toBeGreaterThanOrEqual(0);
    expect(finalizeIdx).toBeGreaterThan(transcriptIdx);
    expect(discardIdx).toBeGreaterThan(finalizeIdx);
  });

  it('does NOT discard JSONL if finalize fails (so retry next launch still works)', async () => {
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'get_audio_dir') return Promise.resolve('/tmp/audio');
      if (cmd === 'read_orphaned_transcript') {
        return Promise.resolve([
          { id: 'a', timestamp: 0.5, text_en: 'x', text_zh: null, type: 'rough' },
        ] as unknown);
      }
      if (cmd === 'save_subtitles') return Promise.resolve(undefined);
      if (cmd === 'finalize_recording') {
        return Promise.reject(new Error('disk full'));
      }
      return Promise.resolve(undefined);
    });

    await expect(recordingRecoveryService.recover('lec-broken')).rejects.toThrow();

    const discardCalled = vi
      .mocked(invoke)
      .mock.calls.some(([cmd]) => cmd === 'discard_orphaned_transcript');
    expect(discardCalled).toBe(false);
  });
});
