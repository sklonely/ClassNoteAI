/**
 * pdfKeywordExtractor regression tests.
 *
 * Pure functions used to seed Whisper's `initial_prompt` from PDF text
 * extracts. Dead-simple inputs/outputs; the value is in locking the
 * three layered extraction strategies (proper nouns, tech allowlist,
 * high-frequency words, academic allowlist) so a future refactor that
 * "simplifies" one layer doesn't silently degrade transcription
 * accuracy on technical lectures.
 */

import { describe, it, expect } from 'vitest';
import {
    extractKeywords,
    generateInitialPrompt,
    extractKeywordsFromPDF,
} from '../pdfKeywordExtractor';

describe('extractKeywords', () => {
    it('returns empty array for empty input', () => {
        expect(extractKeywords('')).toEqual([]);
    });

    it('extracts proper nouns (Capitalized Words)', () => {
        // NOTE: the proper-noun regex greedily merges adjacent
        // Capitalized words — "Today John" becomes ONE match instead
        // of two. That's a quality nit (Whisper would prefer the
        // separate names) but locking the current behaviour as-is.
        // Use a sentence where the names are NOT sentence-leading so
        // the merge doesn't trip.
        const out = extractKeywords('We saw newton and einstein, then Newton and Einstein returned.');
        expect(out).toContain('Newton');
        expect(out).toContain('Einstein');
    });

    it('extracts multi-word proper nouns', () => {
        const out = extractKeywords('Read the New York Times article about San Francisco.');
        expect(out).toContain('New York Times');
        expect(out).toContain('San Francisco');
    });

    it('matches tech allowlist case-insensitively', () => {
        const out = extractKeywords('We use api, react, and PYTHON.');
        // Allowlist matches return the matched text (preserving the
        // original casing of the source).
        const lowered = out.map((k) => k.toLowerCase());
        expect(lowered).toContain('api');
        expect(lowered).toContain('react');
        expect(lowered).toContain('python');
    });

    it('extracts high-frequency words (≥3 occurrences, length ≥4)', () => {
        const text = 'physics physics physics is fun. quantum quantum quantum mechanics.';
        const out = extractKeywords(text);
        expect(out).toContain('physics');
        expect(out).toContain('quantum');
        // Words appearing only twice should NOT appear via the
        // frequency layer (mechanics appears once, "is"/"fun" too short).
        expect(out).not.toContain('mechanics');
    });

    it('does NOT include short high-frequency words (length < 4)', () => {
        const text = 'cat cat cat cat cat dog dog dog dog dog';
        const out = extractKeywords(text);
        expect(out).not.toContain('cat');
        expect(out).not.toContain('dog');
    });

    it('extracts academic terms case-insensitively → returns lowercase', () => {
        const out = extractKeywords('The Algorithm uses an Interface and a Class.');
        // Academic terms specifically lowercase the matched text.
        expect(out).toContain('algorithm');
        expect(out).toContain('interface');
        expect(out).toContain('class');
    });

    it('caps the keyword set at 30 entries', () => {
        // 100 distinct capitalized words → only 30 should survive.
        const text = Array.from({ length: 100 }, (_, i) => `Word${i}`).join(' ');
        const out = extractKeywords(text);
        expect(out.length).toBeLessThanOrEqual(30);
    });

    it('proper-noun + academic-term layers can BOTH emit the same word in different cases', () => {
        // "Algorithm" matches the proper-noun regex AS "Algorithm" AND
        // matches the academic regex AS "algorithm" (lowercased). Set
        // dedup happens by exact key, so both casings end up in output.
        // This is current behaviour — flagging as a quality nit but
        // locking it so a future "fix" is a deliberate decision.
        const out = extractKeywords('Algorithm. Algorithm. Algorithm.');
        const both = out.filter((k) => k.toLowerCase() === 'algorithm');
        expect(both).toContain('Algorithm');
        expect(both).toContain('algorithm');
    });
});

describe('generateInitialPrompt', () => {
    it('always prefixes the lecture-context base terms', () => {
        const prompt = generateInitialPrompt([]);
        for (const base of ['transcription', 'lecture', 'class', 'student', 'professor']) {
            expect(prompt).toContain(base);
        }
    });

    it('appends user keywords after the base terms', () => {
        const prompt = generateInitialPrompt(['Newton', 'quantum mechanics']);
        expect(prompt).toContain('Newton');
        expect(prompt).toContain('quantum mechanics');
    });

    it('joins with comma + space (whisper expects natural-language prompt)', () => {
        const prompt = generateInitialPrompt(['Foo', 'Bar']);
        expect(prompt.endsWith('Foo, Bar')).toBe(true);
    });
});

describe('extractKeywordsFromPDF (integration)', () => {
    it('end-to-end: PDF text → keyword string suitable for Whisper initial_prompt', () => {
        const pdfText =
            'Lecture 3: Newton\'s Laws of Motion. Newton discovered ' +
            'gravity. The algorithm for orbital mechanics uses calculus.';
        const prompt = extractKeywordsFromPDF(pdfText);
        // Base terms always present
        expect(prompt).toContain('lecture');
        // Proper noun extracted
        expect(prompt).toContain('Newton');
        // Academic term lowercased
        expect(prompt).toContain('algorithm');
    });

    it('empty input still returns the base terms (so Whisper has lecture context)', () => {
        const prompt = extractKeywordsFromPDF('');
        expect(prompt).toContain('transcription');
        expect(prompt).toContain('lecture');
    });
});
