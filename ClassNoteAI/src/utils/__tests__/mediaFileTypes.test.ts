import { describe, expect, it } from 'vitest';
import {
  getFileExtension,
  isAudioOnlyMediaPath,
  isSupportedMediaPath,
  mediaDialogExtensions,
} from '../mediaFileTypes';

describe('mediaFileTypes', () => {
  it('recognizes supported video and audio files case-insensitively', () => {
    expect(isSupportedMediaPath('D:/lecture/intro.MP4')).toBe(true);
    expect(isSupportedMediaPath('D:/lecture/audio.m4a')).toBe(true);
    expect(isAudioOnlyMediaPath('D:/lecture/audio.m4a')).toBe(true);
    expect(isAudioOnlyMediaPath('D:/lecture/intro.MP4')).toBe(false);
  });

  it('does not treat raw PCM sidecars as importable media', () => {
    expect(getFileExtension('D:/ClassNoteAI/audio/in-progress/lecture.pcm')).toBe('pcm');
    expect(isSupportedMediaPath('D:/ClassNoteAI/audio/in-progress/lecture.pcm')).toBe(false);
    expect(isAudioOnlyMediaPath('D:/ClassNoteAI/temp_pcm/import.pcm')).toBe(false);
    expect(mediaDialogExtensions()).not.toContain('pcm');
  });
});
