import { describe, expect, it } from 'vitest';
import {
  normalizeCommittedText,
  shouldSkipDuplicateCommit,
  isCommittableSentenceEnd,
  isGoodCommitBoundary,
  countSpokenWords,
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

// Phase 4 of speech-pipeline-v0.6.5 (#71). The multi-signal commit
// gate. Word count AND duration are floors in addition to the Phase 0
// punctuation-and-not-filler check — so tiny "Yes." / "Okay?" fragments
// are no longer committed alone (they stay in the buffer to accumulate
// enough context for the M2M100 translation path).

describe('countSpokenWords', () => {
  it('counts whitespace-separated tokens with letters/numbers', () => {
    expect(countSpokenWords('the quick brown fox')).toBe(4);
    expect(countSpokenWords('one two three four five six')).toBe(6);
  });

  it('returns 0 for empty and whitespace-only', () => {
    expect(countSpokenWords('')).toBe(0);
    expect(countSpokenWords('   ')).toBe(0);
    expect(countSpokenWords('\n\t')).toBe(0);
  });

  it('ignores pure-punctuation tokens', () => {
    expect(countSpokenWords('hello , world .')).toBe(2);
  });

  it('falls back to CJK character count on Chinese text', () => {
    // "我們 今天 要講 梯度下降" — whitespace tokens < 3 because the string
    // might arrive as 我們今天要講梯度下降 without spaces. CJK fallback
    // should catch it.
    expect(countSpokenWords('我們今天要講梯度下降')).toBe(10);
  });
});

describe('isGoodCommitBoundary — Phase 4 multi-signal gate (#71)', () => {
  it('passes on a full sentence with adequate words and duration', () => {
    expect(
      isGoodCommitBoundary('We will use gradient descent to optimise.', {
        durationMs: 2500,
      }),
    ).toBe(true);
  });

  it('rejects short clean segments even with punctuation', () => {
    // "Yes." ends cleanly but is a single-word fragment; committing it
    // alone fragments the translation context. Phase 4 holds.
    expect(isGoodCommitBoundary('Yes.', { durationMs: 1500 })).toBe(false);
    expect(isGoodCommitBoundary('Okay?', { durationMs: 1500 })).toBe(false);
    expect(isGoodCommitBoundary('看看.', { durationMs: 1500 })).toBe(false);
  });

  it('rejects long-text segments that are too brief in duration', () => {
    // Might look like 6 words, but Whisper's timing says <1 s audio —
    // almost certainly a misheard burst or cough. Hold.
    expect(
      isGoodCommitBoundary('one two three four five six.', { durationMs: 400 }),
    ).toBe(false);
  });

  it('rejects filler endings regardless of length / duration', () => {
    // Phase 0 gate must still fire — `um.` at the end is a filler.
    expect(
      isGoodCommitBoundary('I think the main point was, um.', {
        durationMs: 3000,
      }),
    ).toBe(false);
  });

  it('rejects non-terminated text', () => {
    expect(
      isGoodCommitBoundary('this sentence has no end', {
        durationMs: 2500,
      }),
    ).toBe(false);
  });

  it('honours per-call threshold overrides', () => {
    // Lower min-words to 2 for a Q&A chunk path — "Yes absolutely."
    // then passes while the default would still reject.
    expect(
      isGoodCommitBoundary('Yes absolutely.', {
        durationMs: 1500,
        minWords: 2,
      }),
    ).toBe(true);
  });

  it('accepts substantive Chinese text at default thresholds', () => {
    // 10 CJK chars, enough duration, ends in 。
    expect(
      isGoodCommitBoundary('我們今天要講梯度下降演算法。', {
        durationMs: 2500,
      }),
    ).toBe(true);
  });
});
