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
      {
        id: 'a',
        timestamp: 1.0,
        text_en: 'hello',
        text_zh: null,
        type: 'rough',
        speaker_role: 'teacher',
        speaker_id: 'speaker-0',
      },
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
    const subtitles = (saveCall![1] as {
      subtitles: Array<{
        id: string;
        speaker_role?: string;
        speaker_id?: string;
      }>;
    }).subtitles;
    expect(subtitles).toHaveLength(3);
    expect(subtitles[0].speaker_role).toBe('teacher');
    expect(subtitles[0].speaker_id).toBe('speaker-0');
    expect(subtitles[1].speaker_role).toBe('unknown');
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

  it('cp75.33 — stamps lecture.duration from last subtitle timestamp after recovery', async () => {
    // The non-recovery stop() path stamps duration in step 6 (cp75.28).
    // Recovery goes through update_lecture_status only, leaving duration=0
    // → review-page sectioning regression. Fix: after the JSONL imports,
    // round the LAST segment's timestamp into Math.round(seconds) and
    // write it back via save_lecture before update_lecture_status flips
    // the row to 'completed'.
    //
    // Boundaries pinned here:
    //   1. recover() invokes get_lecture so it has the canonical row
    //   2. it then invokes save_lecture with duration === ceil(lastTs)
    //   3. save_lecture happens BEFORE update_lecture_status (so a
    //      retry on update_lecture_status failure still has duration)
    const callOrder: string[] = [];
    const saveLectureArgs: unknown[] = [];
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      callOrder.push(cmd);
      if (cmd === 'get_audio_dir') return Promise.resolve('/tmp/audio');
      if (cmd === 'read_orphaned_transcript') {
        return Promise.resolve([
          { id: 'a', timestamp: 0.5, text_en: 'hi', text_zh: null, type: 'rough' },
          { id: 'b', timestamp: 17.2, text_en: 'mid', text_zh: null, type: 'rough' },
          { id: 'c', timestamp: 42.7, text_en: 'late', text_zh: null, type: 'rough' },
        ] as unknown);
      }
      if (cmd === 'save_subtitles') return Promise.resolve(undefined);
      if (cmd === 'finalize_recording') return Promise.resolve(0);
      if (cmd === 'discard_orphaned_transcript') return Promise.resolve(undefined);
      if (cmd === 'get_lecture') {
        return Promise.resolve({
          id: 'lec-dur',
          course_id: 'C1',
          title: 'Recovered',
          date: '2026-04-30',
          duration: 0,
          status: 'recording',
          created_at: '2026-04-30T00:00:00.000Z',
          updated_at: '2026-04-30T00:00:00.000Z',
          is_deleted: false,
        });
      }
      if (cmd === 'save_lecture') {
        saveLectureArgs.push(args);
        return Promise.resolve(undefined);
      }
      if (cmd === 'update_lecture_status') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await recordingRecoveryService.recover('lec-dur');

    // Save_lecture was invoked exactly once with the recovered duration.
    expect(saveLectureArgs).toHaveLength(1);
    const lec = (saveLectureArgs[0] as { lecture: { id: string; duration: number } }).lecture;
    expect(lec.id).toBe('lec-dur');
    // Last subtitle ts is 42.7s → Math.round = 43.
    expect(lec.duration).toBe(43);

    // Order: save_lecture must precede update_lecture_status.
    const saveLectureIdx = callOrder.indexOf('save_lecture');
    const statusIdx = callOrder.indexOf('update_lecture_status');
    expect(saveLectureIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeGreaterThan(saveLectureIdx);
  });

  it('cp75.33 — recovery without any subtitles does NOT call save_lecture (no duration to stamp)', async () => {
    // No JSONL → no segments → nothing to learn duration from. The
    // status flip still happens, but we don't rewrite the lecture row.
    const callOrder: string[] = [];
    vi.mocked(invoke).mockImplementation((cmd) => {
      callOrder.push(cmd);
      if (cmd === 'get_audio_dir') return Promise.resolve('/tmp/audio');
      if (cmd === 'read_orphaned_transcript') return Promise.resolve([] as unknown);
      if (cmd === 'finalize_recording') return Promise.resolve(0);
      if (cmd === 'discard_orphaned_transcript') return Promise.resolve(undefined);
      if (cmd === 'update_lecture_status') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await recordingRecoveryService.recover('lec-no-jsonl');

    expect(callOrder).not.toContain('save_lecture');
    expect(callOrder).toContain('update_lecture_status');
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

// ─── cp75.22 · recovery transcript idempotency contract ─────────────────
//
// Audit 3.4: recoverTranscript() + finalize_recording is not atomic.
// If finalize_recording fails after recoverTranscript imported N rows,
// the user retries on next launch and recoverTranscript imports the
// same N rows again. Without idempotency that would double-write the
// transcript.
//
// The idempotency guard lives in the Rust side: `save_subtitles` uses
// `INSERT OR REPLACE` keyed on `subtitle.id` (see
// src-tauri/src/storage/database.rs::save_subtitle line ~1320). The
// PersistedTranscriptSegment carries a stable `id` from the JSONL
// sidecar, so the same id flows through both first-attempt and retry,
// and the upsert wipes the duplicate.
//
// These tests pin that contract from the JS side: the SAME segment ids
// must be passed on retry (no fresh-uuid generation in
// recoverTranscript), and a retry must NOT add any rows at the
// JS-visible row count level. If anyone ever swaps the id derivation
// for `crypto.randomUUID()` or similar these tests will catch it.

describe('cp75.22 · recoverTranscript idempotency on retry', () => {
  it('passes JSONL segment ids through unchanged (no fresh uuid generation)', async () => {
    // Earlier tests in this file install permanent `mockImplementation`
    // overrides on the Tauri invoke mock. `vi.clearAllMocks()` in
    // beforeEach only clears call history, not implementations — so we
    // re-install our own impl here rather than rely on the default
    // setMockInvokeResult dispatch.
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === 'read_orphaned_transcript') {
        return Promise.resolve([
          { id: 'jsonl-id-1', timestamp: 1.0, text_en: 'a', text_zh: null, type: 'rough' },
          { id: 'jsonl-id-2', timestamp: 2.0, text_en: 'b', text_zh: null, type: 'rough' },
        ] as unknown);
      }
      if (cmd === 'save_subtitles') return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });

    await recordingRecoveryService.recoverTranscript('lec-stable-ids');

    const saveCall = vi
      .mocked(invoke)
      .mock.calls.find(([cmd]) => cmd === 'save_subtitles');
    const subtitles = (saveCall![1] as {
      subtitles: Array<{ id: string }>;
    }).subtitles;
    // The IDs we hand to save_subtitles MUST match the JSONL ids 1:1.
    // Retry will read the same JSONL → same ids → INSERT OR REPLACE
    // silently dedupes on the Rust side.
    expect(subtitles.map((s) => s.id)).toEqual(['jsonl-id-1', 'jsonl-id-2']);
  });

  it('retry after finalize failure passes the SAME ids again (so Rust upsert dedupes)', async () => {
    // First attempt: read JSONL, save_subtitles succeeds, finalize fails.
    let readCount = 0;
    let saveCount = 0;
    const seenIdsPerSave: string[][] = [];
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      if (cmd === 'get_audio_dir') return Promise.resolve('/tmp/audio');
      if (cmd === 'read_orphaned_transcript') {
        readCount++;
        return Promise.resolve([
          { id: 'jsonl-id-1', timestamp: 1.0, text_en: 'a', text_zh: null, type: 'rough' },
          { id: 'jsonl-id-2', timestamp: 2.0, text_en: 'b', text_zh: null, type: 'rough' },
        ] as unknown);
      }
      if (cmd === 'save_subtitles') {
        saveCount++;
        const ids = (args as { subtitles: Array<{ id: string }> }).subtitles.map(
          (s) => s.id,
        );
        seenIdsPerSave.push(ids);
        return Promise.resolve(undefined);
      }
      if (cmd === 'finalize_recording') {
        // Fail on the first attempt, succeed on the second.
        if (saveCount === 1) return Promise.reject(new Error('disk full'));
        return Promise.resolve(0);
      }
      return Promise.resolve(undefined);
    });

    // Attempt 1 — finalize blows up; recover() rejects.
    await expect(recordingRecoveryService.recover('lec-retry')).rejects.toThrow();

    // Attempt 2 — same lecture, retried. Both reads happened; both
    // save_subtitles calls happened; AND the ids passed in were
    // identical → Rust's INSERT OR REPLACE silently dedupes.
    await recordingRecoveryService.recover('lec-retry');

    expect(readCount).toBe(2);
    expect(saveCount).toBe(2);
    expect(seenIdsPerSave).toHaveLength(2);
    // The contract: identical id sets between attempts.
    expect(seenIdsPerSave[1]).toEqual(seenIdsPerSave[0]);
    expect(seenIdsPerSave[0]).toEqual(['jsonl-id-1', 'jsonl-id-2']);
  });
});
