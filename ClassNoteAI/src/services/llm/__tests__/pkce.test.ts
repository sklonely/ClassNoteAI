import { describe, expect, it } from 'vitest';
import { randomState, randomVerifier, sha256Challenge } from '../pkce';

describe('PKCE helpers', () => {
    it('randomVerifier is a base64url string with no padding', () => {
        const v = randomVerifier();
        expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
        // 32 bytes → 43 base64url chars
        expect(v.length).toBeGreaterThanOrEqual(42);
        expect(v.length).toBeLessThanOrEqual(44);
    });

    it('two verifiers are different', () => {
        const a = randomVerifier();
        const b = randomVerifier();
        expect(a).not.toBe(b);
    });

    it('sha256Challenge is deterministic for a given verifier', async () => {
        const c1 = await sha256Challenge('test-verifier');
        const c2 = await sha256Challenge('test-verifier');
        expect(c1).toBe(c2);
        expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
        // SHA-256 = 32 bytes → 43 chars without padding
        expect(c1.length).toBe(43);
    });

    it('sha256Challenge is different for different inputs', async () => {
        const a = await sha256Challenge('x');
        const b = await sha256Challenge('y');
        expect(a).not.toBe(b);
    });

    it('randomState returns base64url', () => {
        const s = randomState();
        expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});
