/**
 * SubtitleDisplay regression tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §SubtitleDisplay):
 *   - empty list renders the placeholder copy (or nothing crash-y)
 *   - rough-only segment renders English + (optional) translation
 *   - in-place upgrade rough → fine: same key, content changes,
 *     no DOM remount (the headline visual contract — flicker here
 *     is what users notice during a live lecture)
 *   - active-segment highlight when currentTime falls in a segment
 *   - onSeek fires with correct relative seconds when a segment is clicked
 *   - currentText (live partial) shown below the committed segments
 *
 * Stack: vitest + testing-library/react. subtitleService is mocked so
 * we own the state stream.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubtitleSegment, SubtitleState } from '../../types/subtitle';

const subscribers: Array<(state: SubtitleState) => void> = [];
let currentState: SubtitleState = {
    segments: [],
    currentText: '',
    currentTranslation: '',
    isRecording: false,
    isTranscribing: false,
    lastUpdateTime: 0,
};

vi.mock('../../services/subtitleService', () => ({
    subtitleService: {
        getState: () => currentState,
        subscribe: (cb: (s: SubtitleState) => void) => {
            subscribers.push(cb);
            return () => {
                const i = subscribers.indexOf(cb);
                if (i >= 0) subscribers.splice(i, 1);
            };
        },
    },
}));

import SubtitleDisplay from '../SubtitleDisplay';

function setState(next: Partial<SubtitleState>) {
    currentState = { ...currentState, ...next };
    // Clone subscribers so unsub-during-notify is safe.
    [...subscribers].forEach((cb) => cb(currentState));
}

function makeSegment(overrides: Partial<SubtitleSegment> = {}): SubtitleSegment {
    return {
        id: overrides.id ?? `seg-${Math.random()}`,
        roughText: overrides.roughText ?? 'rough english',
        roughTranslation: overrides.roughTranslation,
        displayText: overrides.displayText ?? overrides.roughText ?? 'rough english',
        displayTranslation: overrides.displayTranslation ?? overrides.roughTranslation,
        startTime: overrides.startTime ?? 0,
        endTime: overrides.endTime ?? 1000,
        source: overrides.source ?? 'rough',
        ...overrides,
    } as SubtitleSegment;
}

beforeEach(() => {
    currentState = {
        segments: [],
        currentText: '',
        currentTranslation: '',
        isRecording: false,
    isTranscribing: false,
    lastUpdateTime: 0,
    };
    subscribers.length = 0;
});

afterEach(() => {
    cleanup();
});

describe('SubtitleDisplay', () => {
    it('renders without crash when there are no segments', () => {
        render(<SubtitleDisplay />);
        // Placeholder copy varies; we just ensure the component mounted.
        // Could check for a "尚無字幕" or similar but the exact wording
        // isn't critical here. Asserting the act of rendering completes.
        expect(document.body).toBeTruthy();
    });

    it('renders a rough segment with both English and Chinese lines', async () => {
        render(<SubtitleDisplay baseTime={0} />);
        await act(async () => {
            setState({
                segments: [
                    makeSegment({
                        id: 's1',
                        displayText: 'Today we will cover Newton\'s laws',
                        displayTranslation: '今天我們會學習牛頓定律',
                        startTime: 0,
                        endTime: 3000,
                    }),
                ],
            });
        });
        expect(screen.getByText("Today we will cover Newton's laws")).toBeInTheDocument();
        expect(screen.getByText('今天我們會學習牛頓定律')).toBeInTheDocument();
    });

    it('upgrades rough → fine in place: same DOM node, text changes, no remount', async () => {
        // Render with a rough segment; capture its DOM node.
        render(<SubtitleDisplay baseTime={0} />);
        await act(async () => {
            setState({
                segments: [
                    makeSegment({
                        id: 'stable-id',
                        displayText: 'rough version',
                        startTime: 0,
                    }),
                ],
            });
        });
        const roughNode = screen.getByText('rough version');
        // Walk up to the row container (the click target).
        const rowBefore = roughNode.closest('div[class*="rounded-lg"]')!;
        expect(rowBefore).toBeTruthy();

        // Now upgrade the SAME segment (id stable, displayText flips to fine).
        await act(async () => {
            setState({
                segments: [
                    makeSegment({
                        id: 'stable-id',
                        displayText: 'fine version with corrected punctuation.',
                        startTime: 0,
                        source: 'fine',
                        fineStatus: 'completed',
                    }),
                ],
            });
        });
        // The new text should be present.
        const fineNode = screen.getByText('fine version with corrected punctuation.');
        const rowAfter = fineNode.closest('div[class*="rounded-lg"]')!;
        // The row container is the same DOM node — React's reconciler
        // kept it mounted because the key (segment.id) didn't change.
        expect(rowAfter).toBe(rowBefore);
        // The "已精修" badge should appear on the upgraded segment.
        expect(screen.getByText(/已精修/)).toBeInTheDocument();
        // Old text should be gone.
        expect(screen.queryByText('rough version')).not.toBeInTheDocument();
    });

    it('highlights the active segment when currentTime falls inside it', async () => {
        const baseTime = 1_000_000_000_000; // arbitrary epoch ms
        render(<SubtitleDisplay baseTime={baseTime} currentTime={5} />);
        await act(async () => {
            setState({
                segments: [
                    makeSegment({
                        id: 'a',
                        displayText: 'first',
                        startTime: baseTime + 0,
                    }),
                    makeSegment({
                        id: 'b',
                        displayText: 'second (active)',
                        startTime: baseTime + 4000,
                    }),
                    makeSegment({
                        id: 'c',
                        displayText: 'third',
                        startTime: baseTime + 10000,
                    }),
                ],
            });
        });
        const active = screen.getByText('second (active)').closest('div[class*="rounded-lg"]') as HTMLElement;
        // Active class applies the blue ring; assert via classList substring.
        expect(active.className).toMatch(/ring-2/);
        const inactive = screen.getByText('first').closest('div[class*="rounded-lg"]') as HTMLElement;
        expect(inactive.className).not.toMatch(/ring-2/);
    });

    it('clicking a segment fires onSeek with the relative-seconds offset', async () => {
        const onSeek = vi.fn();
        const baseTime = 1_000_000_000_000;
        const user = userEvent.setup();
        render(<SubtitleDisplay onSeek={onSeek} baseTime={baseTime} />);
        await act(async () => {
            setState({
                segments: [
                    makeSegment({
                        id: 'x',
                        displayText: 'click me',
                        startTime: baseTime + 7500,
                    }),
                ],
            });
        });
        await user.click(screen.getByText('click me'));
        // 7500 ms → 7.5 s
        expect(onSeek).toHaveBeenCalledWith(7.5);
    });

    it('renders the live currentText placeholder when streaming', async () => {
        render(<SubtitleDisplay />);
        await act(async () => {
            setState({
                currentText: 'partial transcription in progress',
                currentTranslation: '正在翻譯中...',
            });
        });
        expect(screen.getByText('正在聆聽...')).toBeInTheDocument();
        expect(screen.getByText('partial transcription in progress')).toBeInTheDocument();
        expect(screen.getByText('正在翻譯中...')).toBeInTheDocument();
    });

    it('renders the in-flight fine status badge when status is pending/transcribing/translating', async () => {
        render(<SubtitleDisplay />);
        await act(async () => {
            setState({
                segments: [
                    makeSegment({
                        id: 'pending',
                        displayText: 'still rough',
                        source: 'rough',
                        fineStatus: 'pending',
                    }),
                ],
            });
        });
        expect(screen.getByText('精修中...')).toBeInTheDocument();
    });
});
