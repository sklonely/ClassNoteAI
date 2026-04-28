/**
 * safeHtml XSS tests — Phase 7 W5.
 *
 * Backstop: prior regex implementation could be bypassed via
 * `<svg/onload=>`, mixed-case tags, novel scheme tricks, etc.
 * These tests pin the DOMPurify-backed replacement to known XSS
 * payloads so future refactors don't silently regress.
 */

import { describe, it, expect } from 'vitest';
import { safeHtml } from '../safeHtml';

describe('safeHtml', () => {
    it('strips <script>', () => {
        expect(safeHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('<script>');
    });

    it('strips on* event handlers', () => {
        const out = safeHtml('<img src=x onerror=alert(1)>');
        expect(out.toLowerCase()).not.toContain('onerror');
    });

    it('strips <svg> with onload', () => {
        const out = safeHtml('<svg onload=alert(1)></svg>');
        expect(out).toBe('');
    });

    it('strips javascript: URLs', () => {
        const out = safeHtml('<a href="javascript:alert(1)">click</a>');
        expect(out.toLowerCase()).not.toContain('javascript:');
    });

    it('strips data: URLs in href', () => {
        const out = safeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
        expect(out).not.toMatch(/data:.*script/i);
    });

    it('preserves safe links', () => {
        expect(safeHtml('<a href="https://example.com">ok</a>')).toContain('https://example.com');
    });

    it('preserves basic formatting', () => {
        const out = safeHtml('<p>Hello <strong>world</strong></p>');
        expect(out).toContain('<strong>world</strong>');
    });

    it('handles empty input', () => {
        expect(safeHtml('')).toBe('');
        expect(safeHtml(null as unknown as string)).toBe('');
    });

    it('strips <iframe>', () => {
        expect(safeHtml('<iframe src="x"></iframe>')).not.toContain('iframe');
    });

    it('handles mixed-case tags', () => {
        const out = safeHtml('<ScRiPt>alert(1)</ScRiPt>');
        expect(out.toLowerCase()).not.toContain('script');
    });
});
