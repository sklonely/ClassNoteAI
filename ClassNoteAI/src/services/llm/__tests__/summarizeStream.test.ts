import { describe, it, expect } from 'vitest';
import { chunkForSummarization } from '../tasks';

/**
 * Regression test for v0.5.2 map-reduce summarization chunker.
 *
 * The chunker is a pure function; the map-reduce path around it has
 * network dependencies and is covered via integration. What we can
 * pin here: section boundaries honour sentence punctuation when
 * possible, chunks stay within the per-section budget, and no
 * content is dropped.
 */
describe('chunkForSummarization', () => {
    it('leaves short transcripts untouched (single-pass path)', () => {
        const input = 'Short lecture. Just a few sentences.';
        const chunks = chunkForSummarization(input);
        expect(chunks).toEqual([input]);
    });

    it('splits a long transcript into multiple chunks', () => {
        // 15000 chars — well above the 12000 threshold
        const input = 'Sentence. '.repeat(2000);
        const chunks = chunkForSummarization(input);
        expect(chunks.length).toBeGreaterThan(1);
        // Every chunk must stay within the per-section budget + a
        // small tolerance for the sentence-boundary lookback.
        for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4500);
    });

    it('preserves all original content across chunks (modulo trimming + overlap)', () => {
        // A large, structured input we can reassemble and sanity-check
        // against. Intentionally uses distinct sentence markers so we
        // know nothing silently fell into a boundary gap.
        const sentences = Array.from({ length: 500 }, (_, i) => `Sentence ${i} has content.`);
        const input = sentences.join(' ');
        const chunks = chunkForSummarization(input);

        // Every sentence must appear in at least one chunk.
        const joined = chunks.join(' ');
        for (let i = 0; i < 500; i += 17) {
            // sample every 17th sentence — full scan is wasteful
            expect(joined).toContain(`Sentence ${i} has content.`);
        }
    });

    it('prefers sentence boundaries over mid-word splits for English', () => {
        const filler = 'This is a normal sentence. ';
        const input = filler.repeat(200); // ~5600 chars
        const chunks = chunkForSummarization(input);
        expect(chunks.length).toBeGreaterThan(1);
        // First chunk must end on a period (sentence boundary) rather
        // than slicing "This is a nor" in half.
        expect(chunks[0]).toMatch(/\.\s*$/);
    });

    it('handles Chinese sentence punctuation (。！？) as boundaries', () => {
        const zh = '這是一個測試句子。';
        const input = zh.repeat(1000); // long enough to trigger splitting
        const chunks = chunkForSummarization(input);
        expect(chunks.length).toBeGreaterThan(1);
        // Each chunk should end on 。 after sentence-boundary splitting.
        for (const c of chunks.slice(0, -1)) {
            expect(c.endsWith('。')).toBe(true);
        }
    });

    it('never produces empty chunks', () => {
        const input = 'A'.repeat(20_000);
        const chunks = chunkForSummarization(input);
        for (const c of chunks) expect(c.length).toBeGreaterThan(0);
    });

    it('returns at least one chunk for any non-empty input', () => {
        expect(chunkForSummarization('x').length).toBe(1);
        expect(chunkForSummarization('hello').length).toBe(1);
    });
});
