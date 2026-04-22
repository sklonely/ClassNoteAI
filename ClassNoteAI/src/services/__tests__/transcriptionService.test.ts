import { describe, expect, it } from 'vitest';
import {
  normalizeCommittedText,
  shouldSkipDuplicateCommit,
} from '../transcriptionService';

describe('transcriptionService commit dedup', () => {
  it('suppresses a replay of the same text from the same audio snapshot', () => {
    expect(
      shouldSkipDuplicateCommit(
        normalizeCommittedText('OK I understand'),
        {
          normalizedText: 'OK I understand',
          sampleCountAtCommit: 16_000,
        },
        16_000,
      ),
    ).toBe(true);
  });

  it('allows the same text after new audio has arrived', () => {
    expect(
      shouldSkipDuplicateCommit(
        normalizeCommittedText('OK'),
        {
          normalizedText: 'OK',
          sampleCountAtCommit: 16_000,
        },
        19_200,
      ),
    ).toBe(false);
  });

  it('normalizes whitespace before dedup checks', () => {
    expect(normalizeCommittedText('  OK   OK moving on  ')).toBe('OK OK moving on');
  });

  it('never suppresses when there is no previous commit snapshot', () => {
    expect(
      shouldSkipDuplicateCommit(normalizeCommittedText('對'), null, 8_000),
    ).toBe(false);
  });
});
