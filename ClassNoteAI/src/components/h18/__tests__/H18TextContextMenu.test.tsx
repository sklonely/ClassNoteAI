/**
 * H18TextContextMenu tests · Phase 7 Sprint 3 Round 2 (S3b-2)
 *
 * Specs covered:
 *   1. mounts + renders 5 items (剪下 / 複製 / 貼上 / sep / 全選)
 *   2. no selection (input) → 剪下 / 複製 disabled
 *   3. selection in input → 剪下 / 複製 enabled
 *   4. clipboard empty → 貼上 disabled
 *   5. clipboard non-empty + editable → 貼上 enabled
 *   6. 剪下 click → execCommand('cut')
 *   7. 複製 click → execCommand('copy')
 *   8. 貼上 click → target.focus() + execCommand('paste')
 *   9. 全選 in input → input.select()
 *   10. 全選 in contentEditable → execCommand('selectAll')
 *   11. shortcut labels render (Mod+X / ⌘X)
 *   12. non-editable target with selection → 剪下 disabled, 複製 enabled
 *   13. ariaLabel is "文字操作"
 *   14. menu closes after a leaf click (onClose called)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { H18TextContextMenu } from '../H18TextContextMenu';

/** Build an input with optional selection range. */
function makeInput({
    value = '',
    selStart = 0,
    selEnd = 0,
}: { value?: string; selStart?: number; selEnd?: number } = {}): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = value;
    document.body.appendChild(el);
    // jsdom respects setSelectionRange on text inputs.
    el.setSelectionRange(selStart, selEnd);
    return el;
}

function makeTextarea({
    value = '',
    selStart = 0,
    selEnd = 0,
}: { value?: string; selStart?: number; selEnd?: number } = {}): HTMLTextAreaElement {
    const el = document.createElement('textarea');
    el.value = value;
    document.body.appendChild(el);
    el.setSelectionRange(selStart, selEnd);
    return el;
}

function makeContentEditable(): HTMLElement {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.textContent = 'editable text';
    document.body.appendChild(el);
    return el;
}

function makeStaticDiv(): HTMLElement {
    const el = document.createElement('div');
    el.textContent = 'static text';
    document.body.appendChild(el);
    return el;
}

/** Find a menuitem by its visible label. */
function getItem(label: string): HTMLElement {
    return screen.getByText(label).closest('[role="menuitem"]') as HTMLElement;
}

let execCommandSpy: ReturnType<typeof vi.fn>;
let clipboardReadText: ReturnType<typeof vi.fn>;

beforeEach(() => {
    execCommandSpy = vi.fn(() => true);
    document.execCommand = execCommandSpy as unknown as typeof document.execCommand;

    clipboardReadText = vi.fn(() => Promise.resolve('clipboard-text'));
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: clipboardReadText },
    });
});

afterEach(() => {
    // tidy any leftover floating elements from makeInput etc.
    document.body.innerHTML = '';
});

describe('H18TextContextMenu', () => {
    it('renders 5 items in fixed order', async () => {
        const target = makeInput();
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );

        // Wait for the clipboard probe so paste enable-state settles.
        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        expect(screen.getByText('剪下')).toBeInTheDocument();
        expect(screen.getByText('複製')).toBeInTheDocument();
        expect(screen.getByText('貼上')).toBeInTheDocument();
        expect(screen.getByText('─')).toBeInTheDocument();
        expect(screen.getByText('全選')).toBeInTheDocument();

        expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    });

    it('input with no selection → 剪下 / 複製 disabled, 全選 enabled', async () => {
        const target = makeInput({ value: 'hi', selStart: 0, selEnd: 0 });
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );

        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        expect(getItem('剪下')).toHaveAttribute('aria-disabled', 'true');
        expect(getItem('複製')).toHaveAttribute('aria-disabled', 'true');
        expect(getItem('全選')).toHaveAttribute('aria-disabled', 'false');
    });

    it('input with selection → 剪下 / 複製 / 貼上 / 全選 all enabled (clipboard non-empty)', async () => {
        const target = makeInput({ value: 'hello', selStart: 0, selEnd: 5 });
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );

        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());
        // Wait for paste to flip enabled now that probe resolved with text
        await waitFor(() =>
            expect(getItem('貼上')).toHaveAttribute('aria-disabled', 'false'),
        );

        expect(getItem('剪下')).toHaveAttribute('aria-disabled', 'false');
        expect(getItem('複製')).toHaveAttribute('aria-disabled', 'false');
        expect(getItem('全選')).toHaveAttribute('aria-disabled', 'false');
    });

    it('clipboard empty → 貼上 disabled even if editable', async () => {
        clipboardReadText.mockResolvedValueOnce('');
        const target = makeInput({ value: 'a', selStart: 0, selEnd: 1 });
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );

        await waitFor(() =>
            expect(getItem('貼上')).toHaveAttribute('aria-disabled', 'true'),
        );
    });

    it('clipboard read rejects → 貼上 disabled', async () => {
        clipboardReadText.mockRejectedValueOnce(new Error('no permission'));
        const target = makeInput({ value: 'a', selStart: 0, selEnd: 1 });
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );

        await waitFor(() =>
            expect(getItem('貼上')).toHaveAttribute('aria-disabled', 'true'),
        );
    });

    it('剪下 click invokes execCommand("cut")', async () => {
        const target = makeInput({ value: 'abc', selStart: 0, selEnd: 3 });
        const onClose = vi.fn();
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={onClose}
            />,
        );
        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        fireEvent.click(screen.getByText('剪下'));

        expect(execCommandSpy).toHaveBeenCalledWith('cut');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('複製 click invokes execCommand("copy")', async () => {
        const target = makeInput({ value: 'abc', selStart: 0, selEnd: 3 });
        const onClose = vi.fn();
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={onClose}
            />,
        );
        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        fireEvent.click(screen.getByText('複製'));

        expect(execCommandSpy).toHaveBeenCalledWith('copy');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('貼上 click focuses the target and invokes execCommand("paste")', async () => {
        const target = makeInput({ value: 'abc', selStart: 1, selEnd: 1 });
        const focusSpy = vi.spyOn(target, 'focus');
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(getItem('貼上')).toHaveAttribute('aria-disabled', 'false'),
        );

        fireEvent.click(screen.getByText('貼上'));

        expect(focusSpy).toHaveBeenCalled();
        expect(execCommandSpy).toHaveBeenCalledWith('paste');
    });

    it('全選 in input → input.select()', async () => {
        const target = makeInput({ value: 'abc' });
        const selectSpy = vi.spyOn(target, 'select');
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );
        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        fireEvent.click(screen.getByText('全選'));

        expect(selectSpy).toHaveBeenCalledTimes(1);
        // execCommand should NOT be called for input.select() path
        expect(execCommandSpy).not.toHaveBeenCalledWith('selectAll');
    });

    it('全選 in textarea → textarea.select()', async () => {
        const target = makeTextarea({ value: 'multi\nline' });
        const selectSpy = vi.spyOn(target, 'select');
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );
        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        fireEvent.click(screen.getByText('全選'));

        expect(selectSpy).toHaveBeenCalledTimes(1);
    });

    it('全選 in contentEditable → execCommand("selectAll")', async () => {
        const target = makeContentEditable();
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );
        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        fireEvent.click(screen.getByText('全選'));

        expect(execCommandSpy).toHaveBeenCalledWith('selectAll');
    });

    it('non-editable target → 剪下 / 貼上 disabled even with selection', async () => {
        const target = makeStaticDiv();
        // Simulate window selection over the static text
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);

        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );
        await waitFor(() => expect(clipboardReadText).toHaveBeenCalled());

        // editable=false → 剪下 / 貼上 disabled
        expect(getItem('剪下')).toHaveAttribute('aria-disabled', 'true');
        expect(getItem('貼上')).toHaveAttribute('aria-disabled', 'true');
        // 複製 should be enabled (we have a window selection)
        expect(getItem('複製')).toHaveAttribute('aria-disabled', 'false');
    });

    it('renders the menu with ariaLabel "文字操作"', async () => {
        const target = makeInput();
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );
        expect(
            screen.getByRole('menu', { name: '文字操作' }),
        ).toBeInTheDocument();
    });

    it('renders shortcut labels for each non-separator item', async () => {
        const target = makeInput({ value: 'a', selStart: 0, selEnd: 1 });
        render(
            <H18TextContextMenu
                x={10}
                y={10}
                target={target}
                onClose={vi.fn()}
            />,
        );

        // formatComboLabel('Mod+X') will produce '⌘X' on mac or 'Ctrl+X' otherwise.
        // Match either spelling — we don't care which path tests are running on.
        const cutItem = getItem('剪下');
        const cutShortcut = cutItem.querySelector('kbd');
        expect(cutShortcut?.textContent).toMatch(/X/);

        const copyItem = getItem('複製');
        expect(copyItem.querySelector('kbd')?.textContent).toMatch(/C/);

        const pasteItem = getItem('貼上');
        expect(pasteItem.querySelector('kbd')?.textContent).toMatch(/V/);

        const selectAllItem = getItem('全選');
        expect(selectAllItem.querySelector('kbd')?.textContent).toMatch(/A/);
    });
});
