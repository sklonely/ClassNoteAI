/**
 * Word stream → complete sentence detector.
 *
 * Sits between the ASR backend (which emits per-word events) and the
 * translation pipeline (which wants whole sentences). Replaces the v1
 * `isGoodCommitBoundary` + 3-strategy commit logic from the legacy
 * transcriptionService.
 *
 * Input: a stream of word events with `is_final` flags. The accumulator
 * only acts on `is_final=true` words — speculative ones are forwarded
 * separately so the UI can show a draft tail.
 *
 * Output: complete sentences, emitted as soon as a strong sentence
 * boundary appears in the confirmed-word buffer.
 *
 * Boundary rules (PySBD-equivalent):
 *   1. Word ends in `.` `?` `!` `。` `？` `！`
 *   2. The word with the terminator isn't a known abbreviation
 *      (`Mr.`, `Dr.`, `e.g.`, `i.e.`, `vs.`)
 *   3. The buffered sentence has ≥3 words (avoids "Yes." being committed
 *      mid-thought; lecture context wants more substance)
 *   4. The sentence has spanned ≥800ms (filler-only utterances tend to
 *      be shorter — "uh." "you know." get suppressed)
 */

import type { WordEvent } from './asrPipeline';

const TERMINATORS = /[.?!。？！]\s*$/;
const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.',
  'e.g.', 'i.e.', 'etc.', 'vs.', 'cf.', 'al.',
  'inc.', 'ltd.', 'co.', 'corp.',
  // ASR-emitted disfluencies that often pick up a period from Whisper / Parakeet
  'um.', 'uh.', 'er.', 'ah.', 'oh.',
]);
const FILLER_TAIL = /(?:^|[\s,])(?:um+|uh+|er+|ah+|oh+|you know|i mean|so+|well)[.?!]\s*$/i;
const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;

const DEFAULT_MIN_WORDS = 3;
const DEFAULT_MIN_DURATION_MS = 800;

// Hard caps that fire **without** a proper sentence terminator. Real
// lecture audio routinely produces 30+ s stretches with no punctuation
// Parakeet picks up — observed in our 70 min eval where one "sentence"
// spanned 53 minutes / 7000+ words and crashed TranslateGemma's
// context window. A coarse 60-word / 30-second forced break is
// strictly better: translation gets a clause-sized chunk it can
// actually handle, and the user sees subtitles flowing instead of a
// paragraph dump at the end.
const DEFAULT_HARD_MAX_WORDS = 60;
const DEFAULT_HARD_MAX_DURATION_MS = 30_000;

export interface BoundaryOptions {
  /** Minimum spoken words to qualify as a substantive sentence. */
  minWords?: number;
  /** Minimum span duration in milliseconds. */
  minDurationMs?: number;
  /**
   * Hard cap on words — emit even without a terminator once the buffer
   * exceeds this. Defaults to 60. Pass `Infinity` to disable (e.g.
   * scripted-input tests where you trust punctuation).
   */
  hardMaxWords?: number;
  /**
   * Hard cap on span duration — emit even without a terminator once
   * the buffer's span exceeds this many ms. Defaults to 30 000 (30 s).
   * Pass `Infinity` to disable.
   */
  hardMaxDurationMs?: number;
}

/**
 * Count *spoken* tokens in `text` — ignores tokens that are pure
 * punctuation (so `"hello , world ."` is 2, not 4). Falls back to
 * counting CJK characters when the whitespace tokenisation undershoots
 * 3 (Chinese is often emitted without word boundaries).
 */
export function countSpokenWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const tokens = t.split(/\s+/).filter((tok) => tok.length > 0 && !PUNCT_ONLY.test(tok));
  if (tokens.length >= 3) return tokens.length;
  const cjk = (t.match(/[一-龥]/g) || []).length;
  return cjk > 0 ? cjk : tokens.length;
}

/**
 * Pure-function form of `SentenceAccumulator.isBoundary`. Used both by
 * the accumulator itself (after joining its WordEvent buffer) and by
 * unit tests that want to assert boundary policy without constructing
 * WordEvent fixtures.
 *
 * Returns `true` (proper sentence boundary) when:
 *   1. `text` ends in `.` `?` `!` `。` `？` `！`
 *   2. The terminating word isn't a known abbreviation (`Mr.`, `e.g.`, `vs.`)
 *   3. The text doesn't end with a filler word + terminator
 *      (`I think, um.`, `well.`)
 *   4. There are at least `minWords` spoken words (default 3)
 *   5. Span duration is at least `minDurationMs` (default 800)
 *
 * Returns `true` (forced break) when proper checks fail BUT the buffer
 * has grown past the hard caps — `hardMaxWords` (default 60) or
 * `hardMaxDurationMs` (default 30 000). Without this fallback, real
 * lecture audio that goes 30+ seconds between Parakeet-emitted
 * terminators buffers indefinitely; one mega-block then either
 * exceeds the translator's context window or arrives at session end
 * as a 7 000-word lump. Better to commit a 60-word chunk without a
 * period than to lose the whole stretch.
 *
 * The hard cap is gated on the proper checks failing first, so
 * legitimate punctuation is preferred whenever it appears.
 */
export function isSentenceBoundary(
  text: string,
  durationMs: number,
  opts: BoundaryOptions = {},
): boolean {
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;
  const minDurationMs = opts.minDurationMs ?? DEFAULT_MIN_DURATION_MS;
  const hardMaxWords = opts.hardMaxWords ?? DEFAULT_HARD_MAX_WORDS;
  const hardMaxDurationMs = opts.hardMaxDurationMs ?? DEFAULT_HARD_MAX_DURATION_MS;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Proper boundary path: terminator + abbrev/filler/length/duration.
  const properOk =
    TERMINATORS.test(trimmed) &&
    !ABBREVIATIONS.has((trimmed.split(/\s+/).pop() ?? '').toLowerCase()) &&
    !FILLER_TAIL.test(trimmed) &&
    countSpokenWords(trimmed) >= minWords &&
    durationMs >= minDurationMs;
  if (properOk) return true;

  // Hard-cap fallback. Either condition alone triggers — runaway
  // duration without enough words still indicates the speaker has
  // moved on, and a wall of text without enough span still indicates
  // chunked-fast utterance worth breaking.
  const wordCount = countSpokenWords(trimmed);
  if (wordCount >= hardMaxWords) return true;
  if (durationMs >= hardMaxDurationMs && wordCount >= minWords) return true;

  return false;
}

export interface AccumulatorOptions {
  /** Minimum words to count a buffered span as a "real" sentence. */
  minWords?: number;
  /** Minimum span duration in milliseconds. */
  minDurationMs?: number;
  /** Hard cap — emit even without terminator when buffer exceeds this. */
  hardMaxWords?: number;
  /** Hard cap — emit even without terminator when buffer span exceeds this. */
  hardMaxDurationMs?: number;
}

export interface CompleteSentence {
  /** Full text, joined by single spaces. */
  text: string;
  /** Timestamp (seconds since session start) of the first word. */
  startSec: number;
  /** Timestamp of the last word's end. */
  endSec: number;
  /** All confirmed words that made up this sentence. */
  words: WordEvent[];
}

export class SentenceAccumulator {
  private confirmed: WordEvent[] = [];
  private opts: Required<AccumulatorOptions>;

  constructor(opts: AccumulatorOptions = {}) {
    this.opts = {
      minWords: opts.minWords ?? DEFAULT_MIN_WORDS,
      minDurationMs: opts.minDurationMs ?? DEFAULT_MIN_DURATION_MS,
      hardMaxWords: opts.hardMaxWords ?? DEFAULT_HARD_MAX_WORDS,
      hardMaxDurationMs: opts.hardMaxDurationMs ?? DEFAULT_HARD_MAX_DURATION_MS,
    };
  }

  /**
   * Push one confirmed word. Returns the list of complete sentences
   * that became finalized as a result (usually 0 or 1; can be more if
   * the ASR backend batched multiple is_final events).
   */
  push(word: WordEvent): CompleteSentence[] {
    if (!word.is_final) return [];
    this.confirmed.push(word);
    return this.drain();
  }

  /**
   * End-of-stream flush. Force-emits whatever's left in the buffer as
   * one final sentence even if it doesn't meet the boundary rules
   * (otherwise trailing thoughts at the end of a recording get lost).
   */
  flush(): CompleteSentence[] {
    if (this.confirmed.length === 0) return [];
    const out = this.makeSentence(this.confirmed);
    this.confirmed = [];
    return out ? [out] : [];
  }

  /**
   * Number of words currently buffered (not yet emitted as a sentence).
   * Useful for UI to show "still listening…".
   */
  get bufferedWordCount(): number {
    return this.confirmed.length;
  }

  /**
   * Text currently buffered but not committed yet. Used for live
   * captions so the user sees ASR activity before a sentence boundary
   * is strong enough to translate.
   */
  get bufferedText(): string {
    return this.confirmed.map((w) => w.text).join(' ');
  }

  /**
   * Reset state — used when the user starts a new recording session.
   */
  reset(): void {
    this.confirmed = [];
  }

  private drain(): CompleteSentence[] {
    const out: CompleteSentence[] = [];
    let cursor = 0;
    for (let i = 0; i < this.confirmed.length; i++) {
      if (!this.isBoundary(this.confirmed.slice(cursor, i + 1))) continue;
      const slice = this.confirmed.slice(cursor, i + 1);
      const sent = this.makeSentence(slice);
      if (sent) {
        out.push(sent);
        cursor = i + 1;
      }
    }
    if (cursor > 0) {
      this.confirmed = this.confirmed.slice(cursor);
    }
    return out;
  }

  private isBoundary(span: WordEvent[]): boolean {
    if (span.length === 0) return false;
    const text = span.map((w) => w.text).join(' ');
    const durationMs = (span[span.length - 1].end - span[0].start) * 1000;
    return isSentenceBoundary(text, durationMs, this.opts);
  }

  private makeSentence(words: WordEvent[]): CompleteSentence | null {
    if (words.length === 0) return null;
    return {
      text: words.map((w) => w.text).join(' '),
      startSec: words[0].start,
      endSec: words[words.length - 1].end,
      words,
    };
  }
}
