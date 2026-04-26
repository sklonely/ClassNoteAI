import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke as invokeRaw } from '@tauri-apps/api/core';

const asrStartMock = vi.fn();
const asrPushAudioMock = vi.fn();
const asrStopMock = vi.fn();
vi.mock('../streaming/asrPipeline', () => ({
  asrPipeline: {
    start: (...args: unknown[]) => asrStartMock(...args),
    pushAudio: (pcm: Int16Array) => asrPushAudioMock(pcm),
    stop: () => asrStopMock(),
  },
}));

const getLectureMock = vi.fn();
const saveLectureMock = vi.fn();
const saveSubtitlesMock = vi.fn();
vi.mock('../storageService', () => ({
  storageService: {
    getLecture: (...args: unknown[]) => getLectureMock(...args),
    saveLecture: (...args: unknown[]) => saveLectureMock(...args),
    saveSubtitles: (...args: unknown[]) => saveSubtitlesMock(...args),
  },
}));

import { subtitleStream } from '../streaming/subtitleStream';
import { videoImportService } from '../videoImportService';

const invoke = invokeRaw as unknown as ReturnType<typeof vi.fn>;

const baseLecture = {
  id: 'lecture-1',
  course_id: 'course-1',
  title: 'Lecture 1',
  date: '2026-04-25',
  duration: 0,
  status: 'recording' as const,
  created_at: '2026-04-25T00:00:00.000Z',
  updated_at: '2026-04-25T00:00:00.000Z',
};

beforeEach(() => {
  invoke.mockReset();
  asrStartMock.mockReset();
  asrPushAudioMock.mockReset();
  asrStopMock.mockReset();
  getLectureMock.mockReset();
  saveLectureMock.mockReset();
  saveSubtitlesMock.mockReset();

  getLectureMock.mockResolvedValue(baseLecture);
  saveLectureMock.mockResolvedValue(undefined);
  saveSubtitlesMock.mockResolvedValue(undefined);

  asrStartMock.mockImplementation(async () => {
    subtitleStream.emit({
      kind: 'session_started',
      sessionId: 'import-session',
      sampleRate: 16000,
      language: 'en',
    });
  });
  asrPushAudioMock.mockImplementation(async () => {
    subtitleStream.emit({
      kind: 'sentence_committed',
      id: 'seg-1',
      sessionId: 'import-session',
      audioStartSec: 1,
      audioEndSec: 2,
      wallClockMs: 100,
      textEn: 'Hello class.',
      speakerRole: 'unknown',
    });
    subtitleStream.emit({
      kind: 'translation_ready',
      id: 'seg-1',
      sessionId: 'import-session',
      textZh: '各位同學好。',
      provider: 'gemma',
      latencyMs: 10,
    });
  });
  asrStopMock.mockResolvedValue(undefined);

  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'import_video_for_lecture') return 'D:/ClassNoteAI/AppData/videos/lecture-1.mp3';
    if (cmd === 'extract_video_pcm_to_temp') {
      return { pcm_path: 'D:/ClassNoteAI/AppData/temp/import.pcm', sample_count: 5, duration_sec: 0.0003125 };
    }
    if (cmd === 'read_pcm_slice') return [1, 2, 3, 4, 5];
    if (cmd === 'delete_temp_pcm') return null;
    return null;
  });
});

describe('videoImportService.importVideo', () => {
  it('imports a video file through the streaming pipeline and stores video_path', async () => {
    const result = await videoImportService.importVideo('lecture-1', 'D:/input/lecture.mp4');

    expect(result.segmentCount).toBe(1);
    expect(asrStartMock).toHaveBeenCalledTimes(1);
    expect(asrPushAudioMock).toHaveBeenCalledTimes(1);
    expect(saveLectureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        video_path: 'D:/ClassNoteAI/AppData/videos/lecture-1.mp3',
        audio_path: undefined,
        status: 'completed',
      }),
    );
    expect(saveSubtitlesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'seg-1',
        lecture_id: 'lecture-1',
        text_en: 'Hello class.',
        speaker_role: 'unknown',
      }),
    ]);
  });

  it('imports an audio-only file through the streaming pipeline and stores audio_path', async () => {
    const result = await videoImportService.importVideo('lecture-1', 'D:/input/lecture.mp3');

    expect(result.segmentCount).toBe(1);
    expect(asrStartMock).toHaveBeenCalledTimes(1);
    expect(asrPushAudioMock).toHaveBeenCalledTimes(1);
    expect(saveLectureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audio_path: 'D:/ClassNoteAI/AppData/videos/lecture-1.mp3',
        video_path: undefined,
        status: 'completed',
      }),
    );
    expect(saveSubtitlesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'seg-1',
        lecture_id: 'lecture-1',
        text_en: 'Hello class.',
        speaker_role: 'unknown',
        text_zh: '各位同學好。',
      }),
    ]);
  });
});
