export interface TranscriptBoundaryOptions {
  minWords?: number;
  softMinWords?: number;
  preferredMinWords?: number;
  preferredMaxWords?: number;
  lateWords?: number;
  hardMaxWords?: number;
  hardMaxDurationMs?: number;
}

export interface BoundaryCandidate {
  endIndex: number;
  endSec: number;
  wordIndex: number;
  score: number;
  reasons: string[];
  text: string;
}

export interface BoundaryDecision {
  endIndex: number;
  endSec: number;
  score: number;
  forced: boolean;
  candidates: BoundaryCandidate[];
}

interface Token {
  text: string;
  index: number;
  end: number;
}

const DEFAULTS: Required<TranscriptBoundaryOptions> = {
  minWords: 12,
  softMinWords: 30,
  preferredMinWords: 28,
  preferredMaxWords: 42,
  lateWords: 42,
  hardMaxWords: 68,
  hardMaxDurationMs: 30_000,
};

const CLOSED_CLASS_TAIL = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  'to', 'in', 'on', 'for', 'with', 'of', 'at', 'by', 'from', 'into', 'onto',
  'and', 'or', 'but', 'because', 'if', 'so', 'than', 'then',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
]);

const DISCOURSE_STARTERS = new Set([
  'okay', 'ok', 'so', 'now', 'well', 'actually', 'basically',
  'therefore', 'however', 'but', 'then', 'also', 'next',
]);

const BAD_TAIL_PHRASES = [
  /\b(?:you|we|i|they|it|this|that)\s+(?:can|could|will|would|should|is|are|am|was|were)$/i,
  /\b(?:to|in|on|for|with|of|at|by|from)\s+(?:the|a|an|this|that)$/i,
  /\b(?:one|some|kind|sort|part|because)\s+of$/i,
  /\b(?:as|if|so|and|or|but)\s+(?:you|we|i|they|it|this|that)$/i,
];

const STRONG_TERMINATOR = /(?:[.!?]|\u3002|\uFF01|\uFF1F)\s*$/;
const SOFT_PUNCTUATION = /[,;:]\s*$/;

export function findTranscriptBoundary(
  text: string,
  startSec: number,
  audioEndSec: number,
  forceFlush = false,
  options: TranscriptBoundaryOptions = {},
): BoundaryDecision | null {
  const opts = { ...DEFAULTS, ...options };
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  const spanSec = Math.max(0, audioEndSec - startSec);
  const durationMs = spanSec * 1000;
  const shouldSearch =
    forceFlush ||
    tokens.length >= opts.softMinWords ||
    durationMs >= opts.hardMaxDurationMs ||
    tokens.some((token, index) => index + 1 >= 6 && STRONG_TERMINATOR.test(token.text));
  if (!shouldSearch) return null;

  const candidates = rankBoundaryCandidates(text, tokens, startSec, audioEndSec, opts);
  const firstStrong = candidates
    .filter((candidate) => STRONG_TERMINATOR.test(tokens[candidate.wordIndex]?.text ?? ''))
    .sort((a, b) => a.wordIndex - b.wordIndex)[0];
  if (firstStrong) {
    return {
      endIndex: firstStrong.endIndex,
      endSec: firstStrong.endSec,
      score: firstStrong.score,
      forced: false,
      candidates: [firstStrong, ...candidates.filter((candidate) => candidate !== firstStrong).slice(0, 2)],
    };
  }

  const best = candidates[0];
  if (!best) {
    return forceFlush ? forceAtEnd(text, audioEndSec, []) : null;
  }

  const tokenCount = tokens.length;
  const threshold = tokenCount >= opts.lateWords ? 30 : 55;
  const hardDeadline = tokenCount >= opts.hardMaxWords || durationMs >= opts.hardMaxDurationMs;
  if (best.score >= threshold || hardDeadline || forceFlush) {
    return {
      endIndex: best.endIndex,
      endSec: best.endSec,
      score: best.score,
      forced: best.score < threshold && (hardDeadline || forceFlush),
      candidates: candidates.slice(0, 3),
    };
  }

  return null;
}

export function segmentTranscriptForEval(
  text: string,
  options: TranscriptBoundaryOptions = {},
): string[] {
  const out: string[] = [];
  let remaining = text.trim();
  let startSec = 0;
  let endSec = Math.max(1, countWords(text) * 0.42);

  while (remaining) {
    const decision = findTranscriptBoundary(remaining, startSec, endSec, true, options);
    if (!decision) {
      out.push(remaining.trim());
      break;
    }
    out.push(remaining.slice(0, decision.endIndex).trim());
    remaining = remaining.slice(decision.endIndex).trim();
    startSec = decision.endSec;
    endSec = startSec + Math.max(1, countWords(remaining) * 0.42);
  }

  return out.filter(Boolean);
}

export function rankBoundaryCandidates(
  text: string,
  tokens: Token[],
  startSec: number,
  audioEndSec: number,
  opts: Required<TranscriptBoundaryOptions> = DEFAULTS,
): BoundaryCandidate[] {
  const spanSec = Math.max(0, audioEndSec - startSec);
  const to = Math.min(tokens.length - 1, opts.hardMaxWords - 1);
  const scored: BoundaryCandidate[] = [];

  for (let i = 0; i <= to; i++) {
    const wordCount = i + 1;
    if (wordCount < opts.minWords && !STRONG_TERMINATOR.test(tokens[i].text)) continue;

    const token = tokens[i];
    const endIndex = token.end;
    const endSec = startSec + spanSec * (wordCount / tokens.length);
    const candidateText = text.slice(0, endIndex);
    const { score, reasons } = scoreBoundary(tokens, i, opts);

    scored.push({
      endIndex,
      endSec,
      wordIndex: i,
      score,
      reasons,
      text: candidateText,
    });
  }

  return scored.sort((a, b) => b.score - a.score);
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function scoreBoundary(
  tokens: Token[],
  i: number,
  opts: Required<TranscriptBoundaryOptions>,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const left = normalizeToken(tokens[i]?.text ?? '');
  const right = normalizeToken(tokens[i + 1]?.text ?? '');
  const prev = normalizeToken(tokens[i - 1]?.text ?? '');
  const wordCount = i + 1;

  const add = (value: number, reason: string) => {
    score += value;
    reasons.push(`${value > 0 ? '+' : ''}${value}:${reason}`);
  };

  if (STRONG_TERMINATOR.test(tokens[i].text)) add(120, 'strong-punctuation');
  else if (SOFT_PUNCTUATION.test(tokens[i].text)) add(45, 'soft-punctuation');

  if (DISCOURSE_STARTERS.has(right)) add(25, `next-discourse:${right}`);
  if (left === 'fact' && prev === 'in') add(20, 'phrase:in-fact');
  if (left === 'example' && prev === 'for') add(20, 'phrase:for-example');
  if (['and', 'but', 'because', 'then', 'so'].includes(right)) add(15, `next-connector:${right}`);

  if (wordCount >= opts.preferredMinWords && wordCount <= opts.preferredMaxWords) {
    add(25 + Math.min(20, wordCount - opts.preferredMinWords), 'preferred-length');
  } else if (wordCount < opts.preferredMinWords) {
    add(-25, 'short-before-preferred');
  } else {
    add(-Math.min(35, (wordCount - opts.preferredMaxWords) * 2), 'past-preferred-length');
  }
  if (wordCount >= opts.lateWords) add(Math.min(20, wordCount - opts.lateWords), 'late-pressure');

  if (CLOSED_CLASS_TAIL.has(left)) add(-55, `incomplete-tail:${left}`);
  else if (looksLikeContentTail(left)) add(12, 'content-tail');

  const lastTwo = `${prev} ${left}`.trim();
  if (BAD_TAIL_PHRASES.some((pattern) => pattern.test(lastTwo))) {
    add(-70, `bad-tail-phrase:${lastTwo}`);
  }

  const remaining = tokens.length - wordCount;
  if (remaining > 0 && remaining < 5) add(-35, 'tiny-remainder');

  return { score, reasons };
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function looksLikeContentTail(token: string): boolean {
  return /^[a-z0-9][a-z0-9'.-]*$/i.test(token) && !CLOSED_CLASS_TAIL.has(token);
}

function forceAtEnd(
  text: string,
  audioEndSec: number,
  candidates: BoundaryCandidate[],
): BoundaryDecision {
  return {
    endIndex: text.length,
    endSec: audioEndSec,
    score: -Infinity,
    forced: true,
    candidates,
  };
}
