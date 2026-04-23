/**
 * DragDropZone regression tests.
 *
 * Coverage targets (from regression-test-checklist.md, Phase 1
 * §DragDropZone):
 *   - children render unconditionally
 *   - drop overlay is shown only while isDragging
 *   - overlayLabel + overlayHint props customize the overlay copy
 *   - the disabled-while-loading contract: when `enabled={false}`,
 *     useTauriFileDrop receives the `enabled` flag and should NOT
 *     accept drops. We test the prop forwarding contract; the actual
 *     event-bus subscription is the hook's concern (its own tests).
 *
 * useTauriFileDrop is mocked so we can drive `isDragging` deterministically
 * without needing the Tauri webview event bus that jsdom can't simulate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const useTauriFileDropMock = vi.fn();
vi.mock('../../hooks/useTauriFileDrop', () => ({
    useTauriFileDrop: (opts: unknown) => useTauriFileDropMock(opts),
}));

import DragDropZone from '../DragDropZone';

beforeEach(() => {
    useTauriFileDropMock.mockReset();
    useTauriFileDropMock.mockReturnValue({ isDragging: false });
});

afterEach(() => {
    cleanup();
});

describe('DragDropZone', () => {
    it('renders children unconditionally', () => {
        render(
            <DragDropZone onFileDrop={vi.fn()}>
                <div data-testid="payload">child content</div>
            </DragDropZone>,
        );
        expect(screen.getByTestId('payload')).toBeInTheDocument();
    });

    it('does NOT render the overlay when isDragging is false', () => {
        useTauriFileDropMock.mockReturnValue({ isDragging: false });
        render(
            <DragDropZone onFileDrop={vi.fn()}>
                <div>child</div>
            </DragDropZone>,
        );
        expect(screen.queryByText('放開以匯入檔案')).not.toBeInTheDocument();
    });

    it('renders overlay with default copy when isDragging flips to true', () => {
        useTauriFileDropMock.mockReturnValue({ isDragging: true });
        render(
            <DragDropZone onFileDrop={vi.fn()}>
                <div>child</div>
            </DragDropZone>,
        );
        expect(screen.getByText('放開以匯入檔案')).toBeInTheDocument();
        expect(screen.getByText('支援影片、PDF、PPT、Word')).toBeInTheDocument();
    });

    it('honours overlayLabel + overlayHint props', () => {
        useTauriFileDropMock.mockReturnValue({ isDragging: true });
        render(
            <DragDropZone
                onFileDrop={vi.fn()}
                overlayLabel="拖放 PDF 到這裡"
                overlayHint="鬆開以上傳課程 syllabus PDF"
            >
                <div>child</div>
            </DragDropZone>,
        );
        expect(screen.getByText('拖放 PDF 到這裡')).toBeInTheDocument();
        expect(screen.getByText('鬆開以上傳課程 syllabus PDF')).toBeInTheDocument();
    });

    it('forwards onFileDrop + enabled flag to the underlying hook', () => {
        const onFileDrop = vi.fn();
        render(
            <DragDropZone onFileDrop={onFileDrop} enabled={false}>
                <div>child</div>
            </DragDropZone>,
        );
        expect(useTauriFileDropMock).toHaveBeenCalledWith(
            expect.objectContaining({
                onDrop: onFileDrop,
                enabled: false,
            }),
        );
    });

    it('defaults `enabled` to true when prop is omitted', () => {
        render(
            <DragDropZone onFileDrop={vi.fn()}>
                <div>child</div>
            </DragDropZone>,
        );
        const args = useTauriFileDropMock.mock.calls[0][0];
        expect(args.enabled).toBe(true);
    });
});
