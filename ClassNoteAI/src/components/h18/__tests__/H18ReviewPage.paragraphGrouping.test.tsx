/**
 * groupSubsBySections · cp75.28 unit tests
 *
 * Pinning the contract for the helper extracted from H18ReviewPage in
 * cp75.28. The helper sits directly downstream of the bug we fixed —
 * when sections all carried timestamp=0 (because lecture.duration was
 * stamped as 0 in the stop pipeline), every subtitle bucketed into
 * section 0, producing a "1 段到底" wall of text. See cp75.28 audit
 * notes in commit message.
 *
 * Tests:
 *   1. happy path — N sections + M subs → N buckets, correct slicing
 *   2. degenerate — sections all share timestamp=0 → 1 bucket (this is
 *      the surface that cp75.28 fixes upstream by stamping a real
 *      duration)
 *   3. no sections → 1 pre-section bucket
 *   4. empty input → []
 */

import { describe, it, expect } from 'vitest';
import { groupSubsBySections } from '../groupSubsBySections';
import type { Subtitle, Section } from '../../../types';

describe('groupSubsBySections · cp75.28', () => {
    it('produces N paragraphs when N sections have distinct timestamps', () => {
        const subs: Subtitle[] = [
            {
                id: '1',
                lecture_id: 'L',
                timestamp: 10,
                text_en: 'a',
                type: 'rough',
                created_at: '',
            },
            {
                id: '2',
                lecture_id: 'L',
                timestamp: 50,
                text_en: 'b',
                type: 'rough',
                created_at: '',
            },
            {
                id: '3',
                lecture_id: 'L',
                timestamp: 100,
                text_en: 'c',
                type: 'rough',
                created_at: '',
            },
        ];
        const sections: Section[] = [
            { title: 'A', content: '', timestamp: 0 },
            { title: 'B', content: '', timestamp: 60 },
        ];
        const paras = groupSubsBySections(subs, sections);
        expect(paras).toHaveLength(2);
        expect(paras[0].items).toHaveLength(2); // 10, 50
        expect(paras[1].items).toHaveLength(1); // 100
    });

    it('produces 1 paragraph (degenerate case) when all sections have timestamp=0', () => {
        // Documents the cp75.28 bug surface: WHEN durations are wrong
        // upstream, grouping degenerates. After cp75.28's fix to
        // recordingSessionService.stop, durationSec stamping prevents
        // this case from appearing in the wild — but the helper still
        // honours its mechanical contract here.
        const subs: Subtitle[] = [
            {
                id: '1',
                lecture_id: 'L',
                timestamp: 10,
                text_en: 'a',
                type: 'rough',
                created_at: '',
            },
            {
                id: '2',
                lecture_id: 'L',
                timestamp: 50,
                text_en: 'b',
                type: 'rough',
                created_at: '',
            },
            {
                id: '3',
                lecture_id: 'L',
                timestamp: 100,
                text_en: 'c',
                type: 'rough',
                created_at: '',
            },
        ];
        const sections: Section[] = [
            { title: 'A', content: '', timestamp: 0 },
            { title: 'B', content: '', timestamp: 0 },
            { title: 'C', content: '', timestamp: 0 },
        ];
        const paras = groupSubsBySections(subs, sections);
        expect(paras).toHaveLength(1);
        expect(paras[0].items).toHaveLength(3);
    });

    it('returns single pre-section bucket when sections is empty', () => {
        const subs: Subtitle[] = [
            {
                id: '1',
                lecture_id: 'L',
                timestamp: 10,
                text_en: 'a',
                type: 'rough',
                created_at: '',
            },
        ];
        const paras = groupSubsBySections(subs, []);
        expect(paras).toHaveLength(1);
        expect(paras[0].section).toBeNull();
        expect(paras[0].items).toHaveLength(1);
    });

    it('returns [] when both subs and sections are empty', () => {
        expect(groupSubsBySections([], [])).toEqual([]);
    });
});
