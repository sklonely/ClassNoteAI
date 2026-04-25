import { describe, expect, it } from 'vitest';
import {
  findTranscriptBoundary,
  segmentTranscriptForEval,
} from '../streaming/transcriptSegmenter';

describe('findTranscriptBoundary', () => {
  it('does not cut at an incomplete right edge like "you can"', () => {
    const text = [
      'right to the left end i can append left okay that is because it is doubly linked list',
      'so i can pen four so that brings 468 okay so basically it is a linked list',
      'it is actually doubly linked list implementing a double ended queue so that is called deck',
      'but of course if you only need to use this classical queue you can still use a deck',
    ].join(' ');

    const decision = findTranscriptBoundary(text, 0, 26, false);
    expect(decision).toBeTruthy();
    const segment = text.slice(0, decision!.endIndex);
    expect(segment).not.toMatch(/\byou can$/i);
    expect(segment).not.toMatch(/\bto the$/i);
  });

  it('uses strong punctuation before soft semantic scoring', () => {
    const text = 'We will use a queue for graph traversal. Now we can compare it with stack traversal';
    const decision = findTranscriptBoundary(text, 0, 8, false);
    expect(text.slice(0, decision!.endIndex)).toBe('We will use a queue for graph traversal.');
  });

  it('force flushes long unpunctuated text before translator-hostile chunks', () => {
    const text = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
    const decision = findTranscriptBoundary(text, 0, 32, false);
    expect(decision).toBeTruthy();
    const words = text.slice(0, decision!.endIndex).split(/\s+/);
    expect(words.length).toBeGreaterThanOrEqual(28);
    expect(words.length).toBeLessThanOrEqual(68);
  });
});

describe('segmentTranscriptForEval', () => {
  it('keeps evaluated chunks in a translation-friendly range', () => {
    const text = Array.from({ length: 180 }, (_, i) => {
      if (i === 44) return 'okay';
      if (i === 89) return 'now';
      return `word${i}`;
    }).join(' ');

    const segments = segmentTranscriptForEval(text);
    const lengths = segments.map((segment) => segment.split(/\s+/).length);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(68);
    expect(segments.length).toBeGreaterThan(2);
  });
});
