/**
 * safeHtml — Phase 7 W5
 *
 * Render Canvas-sourced HTML (announcement / event description) safely.
 *
 * Allow basic formatting + links; strip everything that can execute JS or
 * load remote resources sketchy enough to be a tracking pixel.
 *
 * Replaces earlier regex-based sanitizer (Phase 7 W5) — regex was bypassable
 * via `<svg/onload=>`, mixed-case tags, etc. Now backed by isomorphic-dompurify
 * (DOMPurify), the industry-standard HTML sanitizer.
 */

import DOMPurify from 'isomorphic-dompurify';

export function safeHtml(html: string): string {
    if (typeof html !== 'string' || html.length === 0) return '';
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
            'a', 'b', 'i', 'em', 'strong', 'u', 'br', 'p', 'span',
            'ul', 'ol', 'li', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'blockquote', 'pre', 'code',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
        // Block javascript: / data: URIs (allow http(s)/mailto/tel + relative).
        ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
        // Unify link target + rel.
        ADD_ATTR: ['target', 'rel'],
        ADD_TAGS: [],
        // DOMPurify already strips script/style by default; explicit for safety.
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur'],
    });
}
