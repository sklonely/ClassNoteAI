import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { exists } from '@tauri-apps/plugin-fs';
import { clearMockInvokeResults, setMockInvokeResult } from '../../test/setup';
import {
  auditCompletedLectureAudioLinks,
  resolveAudioPath,
  resolveOrRecoverAudioPath,
  toRelativeAudioPath,
} from '../audioPathService';
import type { Lecture } from '../../types';

describe('audioPathService', () => {
  beforeEach(() => {
    clearMockInvokeResults();
    vi.clearAllMocks();
    vi.mocked(exists).mockReset();
  });

  it('resolves a relative audio path against the audio dir', async () => {
    setMockInvokeResult('get_audio_dir', '/tmp/audio');
    vi.mocked(exists).mockResolvedValueOnce(true);

    await expect(resolveAudioPath('lecture_1.wav')).resolves.toBe('/tmp/audio/lecture_1.wav');
  });

  it('recovers a stale stored path by invoking backend relink', async () => {
    setMockInvokeResult('get_audio_dir', '/tmp/audio');
    setMockInvokeResult('try_recover_audio_path', 'lecture_1_relinked.wav');
    vi.mocked(exists)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(resolveOrRecoverAudioPath('lec-1', '/old/home/audio/lecture_1.wav')).resolves.toEqual({
      resolvedPath: '/tmp/audio/lecture_1_relinked.wav',
      storedPath: 'lecture_1_relinked.wav',
      recovered: true,
    });
  });

  it('returns null when neither the stored path nor recovery target exists', async () => {
    setMockInvokeResult('get_audio_dir', '/tmp/audio');
    setMockInvokeResult('try_recover_audio_path', null);
    vi.mocked(exists).mockResolvedValueOnce(false);

    await expect(resolveOrRecoverAudioPath('lec-1', 'lecture_missing.wav')).resolves.toEqual({
      resolvedPath: null,
      storedPath: 'lecture_missing.wav',
      recovered: false,
    });
  });

  it('audits only completed audio lectures and flags unresolved stale paths', async () => {
    const lectures: Lecture[] = [
      {
        id: 'ok',
        course_id: 'c',
        title: 'ok',
        date: '',
        duration: 0,
        status: 'completed',
        created_at: '',
        updated_at: '',
        audio_path: 'lecture_ok.wav',
      },
      {
        id: 'stale',
        course_id: 'c',
        title: 'stale',
        date: '',
        duration: 0,
        status: 'completed',
        created_at: '',
        updated_at: '',
        audio_path: '/old/home/lecture_stale.wav',
      },
      {
        id: 'missing',
        course_id: 'c',
        title: 'missing',
        date: '',
        duration: 0,
        status: 'completed',
        created_at: '',
        updated_at: '',
      },
      {
        id: 'video-only',
        course_id: 'c',
        title: 'video-only',
        date: '',
        duration: 0,
        status: 'completed',
        created_at: '',
        updated_at: '',
        video_path: 'video.mp4',
      },
      {
        id: 'recording',
        course_id: 'c',
        title: 'recording',
        date: '',
        duration: 0,
        status: 'recording',
        created_at: '',
        updated_at: '',
        audio_path: 'lecture_recording.wav',
      },
    ];

    setMockInvokeResult('get_audio_dir', '/tmp/audio');
    setMockInvokeResult('try_recover_audio_path', 'lecture_missing_recovered.wav');
    vi.mocked(exists)
      .mockResolvedValueOnce(true)   // ok
      .mockResolvedValueOnce(false)  // stale
      .mockResolvedValueOnce(false)  // stale recovery target missing
      .mockResolvedValueOnce(true);  // missing recovery target exists

    const result = await auditCompletedLectureAudioLinks(lectures);

    expect(result.recoveredLectureIds).toEqual(['missing']);
    expect(result.unresolvedLectureIds).toEqual(['stale']);

    const commands = (invoke as unknown as { mock: { calls: Array<[string, unknown]> } }).mock.calls
      .map((call) => call[0]);
    expect(commands.filter((command) => command === 'try_recover_audio_path')).toHaveLength(2);
  });

  it('relativizes paths inside the audio dir', () => {
    expect(toRelativeAudioPath('/tmp/audio', '/tmp/audio/nested/lecture.wav')).toBe('nested/lecture.wav');
  });
});
