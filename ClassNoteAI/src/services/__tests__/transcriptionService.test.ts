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

  // Regression #31 extension — the new dedup heuristic must NOT block
  // a different text emitted from the same audio snapshot. Pre-#31 the
  // dedup was a tail-suffix string match that occasionally suppressed
  // legitimate transcriptions that happened to share a prefix with the
  // last committed text.
  it('always passes through different text even if audio snapshot is unchanged', () => {
    expect(
      shouldSkipDuplicateCommit(
        normalizeCommittedText('totally different sentence'),
        {
          normalizedText: 'OK I understand',
          sampleCountAtCommit: 16_000,
        },
        16_000,
      ),
    ).toBe(false);
  });

  // Pure normalize coverage extras: the helper must collapse interior
  // runs of whitespace AND trim leading / trailing whitespace, otherwise
  // the dedup snapshot's `normalizedText` won't match a fresh commit
  // even when the rendered text is identical to the user.
  it('normalizes empty / whitespace-only inputs to empty string', () => {
    expect(normalizeCommittedText('')).toBe('');
    expect(normalizeCommittedText('   ')).toBe('');
    expect(normalizeCommittedText('\n\t  \r\n')).toBe('');
  });
});
