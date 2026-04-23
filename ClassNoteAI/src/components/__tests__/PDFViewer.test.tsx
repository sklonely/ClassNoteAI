/**
 * PDFViewer smoke tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §PDFViewer):
 *   - Mounts cleanly without pdfData / filePath (empty state, no
 *     pdfjs init, no crash)
 *   - The forwarded ref handle exposes scrollToPage + getCurrentPage
 *
 * Out of scope for this suite (deferred to E2E or future canvas-aware
 * harness): actual page rendering, IntersectionObserver-driven page
 * tracking, zoom interaction. jsdom has no real Canvas + no
 * IntersectionObserver, and pdfjs-dist requires DOMMatrix at module
 * load time. We mock pdfjs entirely so the module loads at all.
 *
 * The auto-follow regression #69 (subtitle page_number drives
 * setCurrentPage) is covered separately by the LectureView integration
 * test (Round 2B), which is where the wiring actually lives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn(() => ({
        promise: Promise.reject(new Error('not used in smoke tests')),
    })),
}));

// IntersectionObserver isn't in jsdom — provide a no-op stub so the
// component's mount-time observer init doesn't throw.
beforeEach(() => {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
        configurable: true,
        writable: true,
        value: vi.fn(() => ({
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
            takeRecords: vi.fn(() => []),
        })),
    });
});

afterEach(() => {
    cleanup();
});

import PDFViewer, { PDFViewerHandle } from '../PDFViewer';

describe('PDFViewer (smoke)', () => {
    it('mounts cleanly with no PDF source provided', () => {
        const { container } = render(<PDFViewer />);
        // Empty state — no canvas, no error spam. Just confirms the
        // component rendered without throwing under jsdom.
        expect(container).toBeTruthy();
    });

    it('exposes scrollToPage + getCurrentPage on the forwarded ref', () => {
        const ref = createRef<PDFViewerHandle>();
        render(<PDFViewer ref={ref} />);
        expect(typeof ref.current?.scrollToPage).toBe('function');
        expect(typeof ref.current?.getCurrentPage).toBe('function');
        // Initial page = 1 by component default.
        expect(ref.current?.getCurrentPage()).toBe(1);
    });

    it('scrollToPage on a non-rendered page is a no-op (does not crash)', () => {
        const onPageChange = vi.fn();
        const ref = createRef<PDFViewerHandle>();
        render(<PDFViewer ref={ref} onPageChange={onPageChange} />);
        // No canvases registered → handle should silently do nothing.
        expect(() => ref.current?.scrollToPage(99)).not.toThrow();
        // Without a rendered canvas the page state stays at the default
        // — assert onPageChange was NOT invoked because the implementation
        // gates on canvas existence.
        expect(onPageChange).not.toHaveBeenCalled();
    });
});
