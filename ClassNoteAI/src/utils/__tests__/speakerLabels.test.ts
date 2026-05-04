import { describe, expect, it } from 'vitest';
import { buildSpeakerLabel } from '../speakerLabels';

describe('buildSpeakerLabel', () => {
  it('labels teacher speech directly', () => {
    expect(buildSpeakerLabel('teacher')?.text).toBe('Teacher');
  });

  it('keeps student identity when a speaker id exists', () => {
    expect(buildSpeakerLabel('student', 'speaker-2')?.text).toBe('Student 2');
    expect(buildSpeakerLabel('student', 's_a')?.text).toBe('Student A');
  });

  it('hides completely unknown speakers but shows unknown speaker ids', () => {
    expect(buildSpeakerLabel('unknown')).toBeNull();
    expect(buildSpeakerLabel('unknown', 'speaker-0')?.text).toBe('Speaker 0');
  });
});
