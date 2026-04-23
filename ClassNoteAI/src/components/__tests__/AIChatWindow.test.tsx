/**
 * AIChatWindow smoke tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §AIChatWindow):
 *   - missing lectureId in URL → renders the friendly placeholder
 *     instead of mounting the AIChatPanel (which would crash without
 *     a lectureId)
 *   - mounts cleanly with valid lectureId param
 *   - applies dark/light theme override based on URL ?theme= param
 *   - body min-width override is applied on mount and restored on
 *     unmount (regression for the alpha.7 detached-window scrolling
 *     bug — index.css min-width: 1200px was forcing horizontal
 *     overflow on the 480x700 detached webview)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// AIChatPanel is the heavy guts; stub it so we test the wrapper's
// own contracts (URL parsing, body style override) in isolation.
vi.mock('../AIChatPanel', () => ({
    default: (props: { lectureId: string; displayMode?: string }) => (
        <div
            data-testid="ai-chat-panel-stub"
            data-lecture-id={props.lectureId}
            data-display-mode={props.displayMode}
        />
    ),
}));

vi.mock('../../services/storageService', () => ({
    storageService: {
        getAppSettings: vi.fn(() => Promise.resolve(null)),
    },
}));

import AIChatWindow from '../AIChatWindow';

function setLocationSearch(search: string) {
    Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { ...window.location, search },
    });
}

beforeEach(() => {
    setLocationSearch('?lectureId=lec-1');
    document.body.style.minWidth = '1200px';
    document.body.style.minHeight = '700px';
});

afterEach(() => {
    cleanup();
    setLocationSearch('');
});

describe('AIChatWindow', () => {
    it('renders friendly placeholder when lectureId query param is missing', () => {
        setLocationSearch(''); // no lectureId
        render(<AIChatWindow />);
        expect(screen.getByText(/缺少 lectureId/)).toBeInTheDocument();
        // Panel must NOT mount without a lectureId.
        expect(screen.queryByTestId('ai-chat-panel-stub')).not.toBeInTheDocument();
    });

    it('mounts AIChatPanel with the URL-provided lectureId in detached mode', () => {
        setLocationSearch('?lectureId=lec-XYZ');
        render(<AIChatWindow />);
        const panel = screen.getByTestId('ai-chat-panel-stub');
        expect(panel.getAttribute('data-lecture-id')).toBe('lec-XYZ');
        expect(panel.getAttribute('data-display-mode')).toBe('detached');
    });

    it('overrides body min-width to 0 on mount (alpha.7 detached-window scroll fix)', () => {
        render(<AIChatWindow />);
        // jsdom serializes the value as '0' (no unit) when set to '0';
        // browsers do the same for unit-less zero. Match either.
        expect(['0', '0px']).toContain(document.body.style.minWidth);
        expect(['0', '0px']).toContain(document.body.style.minHeight);
    });

    it('restores body min-width on unmount', () => {
        const { unmount } = render(<AIChatWindow />);
        expect(['0', '0px']).toContain(document.body.style.minWidth);
        unmount();
        expect(document.body.style.minWidth).toBe('1200px');
        expect(document.body.style.minHeight).toBe('700px');
    });
});
