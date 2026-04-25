// Boundary policy for the v2 streaming pipeline. Originally lived as
// inline helpers + tests in `transcriptionService.test.ts` (#71); the
// logic moved into `SentenceAccumulator` during the v2 refactor and
// the tests now target `isSentenceBoundary` / `countSpokenWords`
// directly so production code and tests share one definition.
//
// What we're guarding (the product invariants):
//
//  - Don't commit when the only "sentence end" is actually a filler
//    tail. ASR backends (Whisper, Parakeet) frequently glue a `.`
//    onto `um` / `uh` / `you know` / `well` etc. Committing those to
//    the translation pipeline produces garbage like "我想，嗯。" with
//    no real content. Hold the buffer until a substantive boundary.
//  - Don't commit single-word "Yes." / "Okay?" fragments. Translation
//    quality cliffs without ≥3 words of context.
//  - Don't commit physically-impossible bursts — 6 words spanning
//    400 ms is an ASR hallucination from a cough or click, not real
//    speech. Hold.
//  - DO commit at proper sentence ends (English `.?!`, CJK `。？！`)
//    once the substance / duration thresholds are met.

import { describe, expect, it } from 'vitest';
import {
  SentenceAccumulator,
  countSpokenWords,
  isSentenceBoundary,
} from '../streaming/sentenceAccumulator';

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

  it('falls back to CJK character count on Chinese text without spaces', () => {
    // Whitespace tokenisation gives 1 token for an unspaced CJK string;
    // we count characters instead so the boundary policy treats long
    // Chinese sentences as substantive.
    expect(countSpokenWords('我們今天要講梯度下降')).toBe(10);
  });
});

describe('isSentenceBoundary — terminator detection', () => {
  it('accepts proper sentence endings', () => {
    expect(isSentenceBoundary('We will use gradient descent.', 2500)).toBe(true);
    expect(isSentenceBoundary('Why is that exactly?', 2500)).toBe(true);
    expect(isSentenceBoundary('看一下這張投影片的內容。', 2500)).toBe(true);
    expect(isSentenceBoundary('真的嗎？我不太確定。', 2500)).toBe(true);
  });

  it('rejects non-terminated text', () => {
    expect(isSentenceBoundary('this sentence has no end', 2500)).toBe(false);
    expect(isSentenceBoundary('上半句沒講完', 2500)).toBe(false);
  });
});

describe('isSentenceBoundary — filler-aware (#71)', () => {
  it('rejects English filler tails masquerading as sentence ends', () => {
    expect(isSentenceBoundary('I think, um.', 3000)).toBe(false);
    expect(isSentenceBoundary('and so, you know.', 3000)).toBe(false);
    expect(isSentenceBoundary('I mean.', 3000)).toBe(false);
    expect(isSentenceBoundary('well.', 3000)).toBe(false);
  });

  it('rejects bare disfluency tokens', () => {
    // Single-token disfluencies are caught by the abbreviation set
    // because the period-suffixed form ("uh.", "um.", etc.) is listed
    // there alongside Mr. / e.g. / vs.
    expect(isSentenceBoundary('uh.', 3000)).toBe(false);
    expect(isSentenceBoundary('um.', 3000)).toBe(false);
  });

  it('still accepts substantive content that contains a filler word earlier', () => {
    // "you know" mid-sentence is fine — only the trailing filler blocks.
    expect(isSentenceBoundary('you know what I mean by that.', 2500)).toBe(true);
  });
});

describe('isSentenceBoundary — multi-signal gate (#71)', () => {
  it('rejects short clean segments even with punctuation', () => {
    // "Yes." ends cleanly but is single-word; would fragment translation
    // context. Hold for more.
    expect(isSentenceBoundary('Yes.', 1500)).toBe(false);
    expect(isSentenceBoundary('Okay?', 1500)).toBe(false);
    // Two CJK chars ⇒ below the 3-char default; the CJK-fallback
    // branch in countSpokenWords keeps short Chinese fragments out too.
    expect(isSentenceBoundary('看看.', 1500)).toBe(false);
  });

  it('rejects long-text segments that are too brief in duration', () => {
    // Looks like 6 spoken words, but the audio window is <1 s — that's
    // a misheard noise burst, not real speech. Hold.
    expect(isSentenceBoundary('one two three four five six.', 400)).toBe(false);
  });

  it('rejects filler endings regardless of word count or duration', () => {
    // Long enough text + duration; should still hold because the
    // terminating phrase is a filler.
    expect(
      isSentenceBoundary('I think the main point was, um.', 3000),
    ).toBe(false);
  });

  it('honours per-call threshold overrides', () => {
    // Q&A path can lower min-words so short responses go through.
    expect(
      isSentenceBoundary('Yes absolutely.', 1500, { minWords: 2 }),
    ).toBe(true);
  });

  it('accepts substantive Chinese text at default thresholds', () => {
    // 13 CJK chars, ≥800 ms, ends in 。
    expect(isSentenceBoundary('我們今天要講梯度下降演算法。', 2500)).toBe(true);
  });

  it('rejects abbreviation-suffixed words that look like sentence ends', () => {
    // "Mr." / "e.g." / "vs." would otherwise pass the terminator regex
    // and falsely commit mid-sentence.
    expect(isSentenceBoundary('Discussion led by Mr.', 2500)).toBe(false);
    expect(isSentenceBoundary('see for example e.g.', 2500)).toBe(false);
  });
});

// Hard-cap fallback. Cover the regression spotted by the 2026-04-25
// full_pipeline_eval against 我的影片.mp4 — Parakeet on real lecture
// speech produced one "sentence" spanning 53 minutes / 7000 words
// because it never emitted a punctuation terminator the proper
// boundary check accepted. The hard cap forces a break so the
// translator gets clause-sized chunks instead of paragraph dumps.
describe('isSentenceBoundary — hard-cap fallback (#R-eval)', () => {
  const longUnpunctuated = Array(80).fill('lecture').join(' '); // 80 words, no terminator

  it('emits when buffer exceeds 60 words even without a terminator', () => {
    expect(isSentenceBoundary(longUnpunctuated, 5000)).toBe(true);
  });

  it('emits when span duration exceeds 30s with at least minWords', () => {
    expect(isSentenceBoundary('we kept going on and on without stopping', 31_000)).toBe(true);
  });

  it('does not force-emit at 30s when only 1-2 words have arrived', () => {
    // A long silence with one stray word shouldn't synthesise a
    // boundary out of nothing.
    expect(isSentenceBoundary('hmm', 35_000)).toBe(false);
  });

  it('respects per-call hardMaxWords override', () => {
    const text = Array(20).fill('word').join(' ');
    expect(isSentenceBoundary(text, 5000)).toBe(false); // under default 60
    expect(isSentenceBoundary(text, 5000, { hardMaxWords: 15 })).toBe(true);
  });

  it('proper boundary still wins when both proper-end and hard-cap conditions apply', () => {
    // A perfectly punctuated 80-word sentence: should fire on the
    // proper path, not the hard-cap path. Behaviourally indistinguishable
    // for callers — both return true — but the test pins the priority
    // so future logging (e.g. emit type) wires up cleanly.
    const punctuated = Array(80).fill('word').join(' ') + '.';
    expect(isSentenceBoundary(punctuated, 5000)).toBe(true);
  });
});

describe('SentenceAccumulator — hard-cap forces emission on long unpunctuated runs', () => {
  it('emits a chunk every ~60 words even with no terminators', () => {
    const acc = new SentenceAccumulator({ hardMaxDurationMs: 1_000_000 });
    const sentences: string[] = [];
    for (let i = 0; i < 130; i++) {
      const word = {
        text: `word${i}`,
        start: i * 0.1,
        end: i * 0.1 + 0.1,
        is_final: true,
      };
      for (const s of acc.push(word)) sentences.push(s.text);
    }
    // 130 words / 60-word cap → at least 2 emissions during the stream.
    expect(sentences.length).toBeGreaterThanOrEqual(2);
  });

  it('emits on the duration cap when words trickle slowly past 30s', () => {
    const acc = new SentenceAccumulator({ hardMaxWords: 1000 });
    const sentences: string[] = [];
    // 5 words spread across 32 seconds (one every 8 s) — too few for
    // proper boundary (no terminator) but enough span (last word at
    // 32 s ≥ 30 s cap) and ≥ 3 words for the duration cap to fire.
    for (let i = 0; i < 5; i++) {
      const word = {
        text: `tick${i}`,
        start: i * 8,
        end: i * 8 + 0.1,
        is_final: true,
      };
      for (const s of acc.push(word)) sentences.push(s.text);
    }
    expect(sentences.length).toBeGreaterThanOrEqual(1);
  });
});
