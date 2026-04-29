import { describe, it, expect } from 'vitest';
import {
    extractSectionsFromSummary,
    mergeExtractedSections,
} from '../summaryStructure';

describe('extractSectionsFromSummary', () => {
    it('returns [] for empty / non-string input', () => {
        expect(extractSectionsFromSummary('', 600)).toEqual([]);
        expect(extractSectionsFromSummary(null as unknown as string, 600)).toEqual([]);
    });

    it('returns [] when no ## headings present', () => {
        const md = '# Title\n\nJust body text. No level-2 sections.';
        expect(extractSectionsFromSummary(md, 600)).toEqual([]);
    });

    it('skips H1 — only picks H2 as TOC entries', () => {
        const md = `# 講堂｜完整讀書筆記

## Overview

Lorem.

## Key concepts

Ipsum.`;
        const out = extractSectionsFromSummary(md, 1000);
        expect(out).toHaveLength(2);
        expect(out[0].title).toBe('Overview');
        expect(out[1].title).toBe('Key concepts');
    });

    it('skips H3 and deeper', () => {
        const md = `## Top

### Sub-heading should not appear

#### Even deeper

## Another top`;
        const out = extractSectionsFromSummary(md, 600);
        expect(out.map((s) => s.title)).toEqual(['Top', 'Another top']);
    });

    it('spreads timestamps evenly across duration', () => {
        const md = `## A\n\n## B\n\n## C\n\n## D`;
        const out = extractSectionsFromSummary(md, 1200); // 20 min
        expect(out.map((s) => s.timestamp)).toEqual([0, 300, 600, 900]);
    });

    it('single section gets timestamp 0', () => {
        const md = `## Only one`;
        const out = extractSectionsFromSummary(md, 999);
        expect(out).toHaveLength(1);
        expect(out[0].timestamp).toBe(0);
    });

    it('captures section body in content field', () => {
        const md = `## Section A

Body of A line 1.
Body of A line 2.

## Section B

Body of B.`;
        const out = extractSectionsFromSummary(md, 600);
        expect(out[0].content).toContain('Body of A line 1.');
        expect(out[0].content).toContain('Body of A line 2.');
        expect(out[0].content).not.toContain('Body of B.');
        expect(out[1].content).toBe('Body of B.');
    });

    it('ignores ## inside fenced code blocks', () => {
        const md = `## Real

Some intro.

\`\`\`markdown
## Not a heading — inside code fence
\`\`\`

## Also real`;
        const out = extractSectionsFromSummary(md, 600);
        expect(out).toHaveLength(2);
        expect(out.map((s) => s.title)).toEqual(['Real', 'Also real']);
    });

    it('strips trailing # decorations on headings', () => {
        const md = `## Heading with trailing ##\n`;
        const out = extractSectionsFromSummary(md, 600);
        expect(out[0].title).toBe('Heading with trailing');
    });

    it('handles 0 duration gracefully', () => {
        const md = `## A\n\n## B`;
        const out = extractSectionsFromSummary(md, 0);
        expect(out).toHaveLength(2);
        expect(out.every((s) => s.timestamp === 0)).toBe(true);
    });
});

describe('mergeExtractedSections', () => {
    it('returns extracted when found', () => {
        const md = `## Real heading\n\nBody.`;
        const out = mergeExtractedSections(md, 600, []);
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('Real heading');
    });

    it('returns fallback when no headings', () => {
        const fallback = [{ title: 'old', content: 'x', timestamp: 0 }];
        const out = mergeExtractedSections('No headings.', 600, fallback);
        expect(out).toBe(fallback);
    });

    it('returns fallback when input empty', () => {
        const fallback = [{ title: 'kept', content: '', timestamp: 0 }];
        expect(mergeExtractedSections('', 600, fallback)).toBe(fallback);
    });
});
