import { describe, expect, it } from 'vitest';
import {
  normalizeCommittedText,
  shouldSkipDuplicateCommit,
  isCommittableSentenceEnd,
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

// Phase 0 of speech-pipeline-v0.6.5 (#71). Whisper sometimes emits a
// trailing period after disfluency tokens; the previous regex treated
// every "." as a sentence end and the smart-split chopped clauses in
// half. The helper now refuses to commit at filler endings so the
// chunker waits for a real sentence boundary.
describe('isCommittableSentenceEnd — filler-aware sentence end (#71)', () => {
  it('accepts proper sentence endings', () => {
    expect(isCommittableSentenceEnd('We will use gradient descent.')).toBe(true);
    expect(isCommittableSentenceEnd('Why is that?')).toBe(true);
    expect(isCommittableSentenceEnd('看一下這張圖。')).toBe(true);
    expect(isCommittableSentenceEnd('真的嗎？')).toBe(true);
  });

  it('rejects non-terminated text', () => {
    expect(isCommittableSentenceEnd('this is incomplete')).toBe(false);
    expect(isCommittableSentenceEnd('上半句沒講完')).toBe(false);
  });

  it('rejects English filler tails masquerading as sentence ends', () => {
    expect(isCommittableSentenceEnd('I think, um.')).toBe(false);
    expect(isCommittableSentenceEnd('and so, you know.')).toBe(false);
    expect(isCommittableSentenceEnd('uhh.')).toBe(false);
    expect(isCommittableSentenceEnd('I mean.')).toBe(false);
    expect(isCommittableSentenceEnd('well.')).toBe(false);
  });

  it('still accepts substantive content that contains a filler word earlier', () => {
    // "you know" appearing mid-sentence is fine — only trailing fillers block.
    expect(isCommittableSentenceEnd('you know what I mean by that.')).toBe(true);
  });
});
