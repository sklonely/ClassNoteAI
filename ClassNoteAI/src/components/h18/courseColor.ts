/**
 * Deterministic course color from id — H18 rail course chips need a
 * gradient background, prototype hard-codes per-course but we don't
 * have a color column. Hash to a fixed palette so the same course
 * always gets the same chip color.
 *
 * Palette pulled from H18 prototype V3_COURSES sample colors so the
 * vibe matches: warm reds / oranges / amber / sage / dusty blue.
 */

const PALETTE = [
    '#c44a24', // ML — warm red
    '#9a4f1d', // English — amber
    '#5a7a3e', // Bio — sage
    '#3a6f8c', // Stats — dusty blue
    '#7a3f6e', // History — plum
    '#b56a18', // Algorithms — burnt orange
    '#4a6f4a', // Linear Algebra — moss
    '#94572a', // Physics — bronze
];

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

export function courseColor(id: string): string {
    return PALETTE[hashString(id) % PALETTE.length];
}

/** Short code for rail chip (max 3 chars). Prefer keywords first
 *  alpha-numeric run, fall back to first 2 chars of title. */
export function courseShort(title: string, keywords?: string): string {
    const src = (keywords || title || '').trim();
    if (!src) return '?';
    // Pull first 1-3 alphanumerics, prefer uppercase letters
    const run = src.match(/[A-Za-z0-9]{1,3}/);
    if (run) return run[0].slice(0, 3).toUpperCase();
    // fallback: first 2 chars of title (works for CJK)
    return title.slice(0, 2);
}
