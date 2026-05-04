/**
 * H18ContextMenu tests · Phase 7 Sprint 3 Round 1 (S3b-1)
 *
 * Generic context-menu base component used by 3b (text menu / lecture menu).
 *
 * Specs covered:
 *   1. mount + items render → all items in DOM
 *   2. role="menu" + items role="menuitem"
 *   3. click item → onClick + onClose called
 *   4. disabled item click → no-op
 *   5. Esc → onClose
 *   6. click outside → onClose
 *   7. submenu item click → 不關 menu，submenu 開
 *   8. submenu hover → submenu 顯示
 *   9. ArrowDown / Up → activeIndex 移動
 *   10. Enter on active item → onClick fires
 *   11. ariaLabel applied
 *   12. position adjusts when overflow viewport
 *   + danger / shortcut / icon visual props render
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { H18ContextMenu, type H18ContextMenuItem } from '../H18ContextMenu';

function makeItems(): H18ContextMenuItem[] {
    return [
        { id: 'edit', label: '編輯', shortcut: '⌘E', onClick: vi.fn() },
        { id: 'rename', label: '重新命名', onClick: vi.fn() },
        { id: 'delete', label: '刪除', danger: true, onClick: vi.fn() },
    ];
}

beforeEach(() => {
    // Stable viewport for position tests
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 1024,
    });
    Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 768,
    });
});

describe('H18ContextMenu', () => {
    it('renders all items', () => {
        const items = makeItems();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );
        expect(screen.getByText('編輯')).toBeInTheDocument();
        expect(screen.getByText('重新命名')).toBeInTheDocument();
        expect(screen.getByText('刪除')).toBeInTheDocument();
    });

    it('uses role="menu" + items role="menuitem"', () => {
        const items = makeItems();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );
        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    });

    it('applies ariaLabel when provided', () => {
        const items = makeItems();
        render(
            <H18ContextMenu
                items={items}
                x={10}
                y={10}
                onClose={vi.fn()}
                ariaLabel="課堂選項"
            />,
        );
        expect(screen.getByRole('menu', { name: '課堂選項' })).toBeInTheDocument();
    });

    it('falls back to default aria-label "選項" if not provided', () => {
        const items = makeItems();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );
        expect(screen.getByRole('menu', { name: '選項' })).toBeInTheDocument();
    });

    it('clicking an item calls onClick and onClose', () => {
        const items = makeItems();
        const onClose = vi.fn();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        fireEvent.click(screen.getByText('編輯'));

        expect(items[0].onClick).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking a disabled item is a no-op', () => {
        const onClick = vi.fn();
        const onClose = vi.fn();
        const items: H18ContextMenuItem[] = [
            { id: 'a', label: 'A (disabled)', disabled: true, onClick },
            { id: 'b', label: 'B', onClick: vi.fn() },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        fireEvent.click(screen.getByText('A (disabled)'));

        expect(onClick).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('marks disabled items with aria-disabled', () => {
        const items: H18ContextMenuItem[] = [
            { id: 'a', label: 'A', disabled: true },
            { id: 'b', label: 'B' },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );
        const itemA = screen.getByText('A').closest('[role="menuitem"]');
        const itemB = screen.getByText('B').closest('[role="menuitem"]');
        expect(itemA).toHaveAttribute('aria-disabled', 'true');
        expect(itemB).toHaveAttribute('aria-disabled', 'false');
    });

    it('Esc keydown calls onClose', () => {
        const items = makeItems();
        const onClose = vi.fn();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('mousedown outside menu calls onClose', () => {
        const items = makeItems();
        const onClose = vi.fn();
        render(
            <div>
                <button>outside</button>
                <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />
            </div>,
        );

        fireEvent.mouseDown(screen.getByText('outside'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('mousedown inside menu does NOT call onClose', () => {
        const items = makeItems();
        const onClose = vi.fn();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        fireEvent.mouseDown(screen.getByText('編輯'));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('clicking a submenu parent does NOT close menu, opens submenu', () => {
        const onLeafClick = vi.fn();
        const onClose = vi.fn();
        const items: H18ContextMenuItem[] = [
            {
                id: 'move',
                label: '移動到其他課程',
                submenu: [
                    { id: 'c1', label: 'ML', onClick: onLeafClick },
                    { id: 'c2', label: 'Bio', onClick: vi.fn() },
                ],
            },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        fireEvent.click(screen.getByText('移動到其他課程'));

        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByText('ML')).toBeInTheDocument();
        expect(screen.getByText('Bio')).toBeInTheDocument();
    });

    it('hovering a submenu parent opens its submenu', () => {
        const items: H18ContextMenuItem[] = [
            {
                id: 'move',
                label: '移動到其他課程',
                submenu: [{ id: 'c1', label: 'ML' }],
            },
            { id: 'delete', label: '刪除', danger: true },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );

        // submenu not yet visible
        expect(screen.queryByText('ML')).toBeNull();

        fireEvent.mouseEnter(screen.getByText('移動到其他課程'));

        expect(screen.getByText('ML')).toBeInTheDocument();
    });

    it('submenu parent items get aria-haspopup="menu"', () => {
        const items: H18ContextMenuItem[] = [
            {
                id: 'move',
                label: '移動',
                submenu: [{ id: 'c1', label: 'ML' }],
            },
            { id: 'delete', label: '刪除' },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );

        const move = screen.getByText('移動').closest('[role="menuitem"]');
        const del = screen.getByText('刪除').closest('[role="menuitem"]');
        expect(move).toHaveAttribute('aria-haspopup', 'menu');
        expect(del).not.toHaveAttribute('aria-haspopup');
    });

    it('ArrowDown moves activeIndex forward and Enter triggers onClick', () => {
        const items = makeItems();
        const onClose = vi.fn();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        // Active starts at 0 ('編輯')
        // ArrowDown → 1 (重新命名)
        fireEvent.keyDown(document, { key: 'ArrowDown' });
        // ArrowDown → 2 (刪除)
        fireEvent.keyDown(document, { key: 'ArrowDown' });
        // ArrowDown clamps at 2
        fireEvent.keyDown(document, { key: 'ArrowDown' });
        // Enter → fires items[2].onClick (刪除)
        fireEvent.keyDown(document, { key: 'Enter' });

        expect(items[0].onClick).not.toHaveBeenCalled();
        expect(items[1].onClick).not.toHaveBeenCalled();
        expect(items[2].onClick).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ArrowUp moves activeIndex backward and clamps at 0', () => {
        const items = makeItems();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );

        // start at 0 → ArrowUp → still 0
        fireEvent.keyDown(document, { key: 'ArrowUp' });
        // ArrowDown → 1
        fireEvent.keyDown(document, { key: 'ArrowDown' });
        // ArrowDown → 2
        fireEvent.keyDown(document, { key: 'ArrowDown' });
        // ArrowUp → 1
        fireEvent.keyDown(document, { key: 'ArrowUp' });
        // Enter → fires items[1] (重新命名)
        fireEvent.keyDown(document, { key: 'Enter' });

        expect(items[1].onClick).toHaveBeenCalledTimes(1);
        expect(items[0].onClick).not.toHaveBeenCalled();
        expect(items[2].onClick).not.toHaveBeenCalled();
    });

    it('Enter on disabled active item is a no-op', () => {
        const onClick = vi.fn();
        const onClose = vi.fn();
        const items: H18ContextMenuItem[] = [
            { id: 'a', label: 'A', disabled: true, onClick },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        fireEvent.keyDown(document, { key: 'Enter' });

        expect(onClick).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders shortcut display text when provided', () => {
        const items: H18ContextMenuItem[] = [
            { id: 'a', label: '搜尋', shortcut: '⌘K' },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );
        expect(screen.getByText('⌘K')).toBeInTheDocument();
    });

    it('renders icon when provided', () => {
        const items: H18ContextMenuItem[] = [
            {
                id: 'a',
                label: 'edit',
                icon: <svg data-testid="icon-edit" />,
            },
        ];
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );
        expect(screen.getByTestId('icon-edit')).toBeInTheDocument();
    });

    it('clamps position back into viewport when x/y overflows', () => {
        // Mock getBoundingClientRect for ul
        const proto = HTMLElement.prototype;
        const orig = proto.getBoundingClientRect;
        proto.getBoundingClientRect = function () {
            return {
                width: 220,
                height: 180,
                left: 0,
                top: 0,
                right: 220,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            } as DOMRect;
        };

        try {
            const items = makeItems();
            // window inner is 1024x768 (set in beforeEach)
            // x=9999 should be clamped to inner - width - 8 = 1024 - 220 - 8 = 796
            // y=9999 should be clamped to 768 - 180 - 8 = 580
            render(
                <H18ContextMenu
                    items={items}
                    x={9999}
                    y={9999}
                    onClose={vi.fn()}
                />,
            );

            const menu = screen.getByRole('menu') as HTMLElement;
            // After useLayoutEffect, position should be re-set
            expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(796);
            expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(580);
            expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(0);
            expect(parseFloat(menu.style.top)).toBeGreaterThanOrEqual(0);
        } finally {
            proto.getBoundingClientRect = orig;
        }
    });

    it('respects fully-in-viewport position without clamping', () => {
        const proto = HTMLElement.prototype;
        const orig = proto.getBoundingClientRect;
        proto.getBoundingClientRect = function () {
            return {
                width: 220,
                height: 180,
                left: 0,
                top: 0,
                right: 220,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            } as DOMRect;
        };
        try {
            const items = makeItems();
            render(
                <H18ContextMenu
                    items={items}
                    x={100}
                    y={120}
                    onClose={vi.fn()}
                />,
            );
            const menu = screen.getByRole('menu') as HTMLElement;
            expect(menu.style.left).toBe('100px');
            expect(menu.style.top).toBe('120px');
        } finally {
            proto.getBoundingClientRect = orig;
        }
    });

    it('cleans up document listeners on unmount', () => {
        const items = makeItems();
        const onClose = vi.fn();
        const { unmount } = render(
            <H18ContextMenu items={items} x={10} y={10} onClose={onClose} />,
        );

        unmount();

        // After unmount, Esc + outside click should not fire onClose
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.mouseDown(document.body);

        expect(onClose).not.toHaveBeenCalled();
    });

    it('mouseEnter on a non-submenu item updates activeIndex (Enter then fires its onClick)', () => {
        const items = makeItems();
        render(
            <H18ContextMenu items={items} x={10} y={10} onClose={vi.fn()} />,
        );

        // Hover the third item — should set active to 2
        act(() => {
            fireEvent.mouseEnter(screen.getByText('刪除'));
        });
        // Now Enter fires the third item
        fireEvent.keyDown(document, { key: 'Enter' });
        expect(items[2].onClick).toHaveBeenCalledTimes(1);
        expect(items[0].onClick).not.toHaveBeenCalled();
    });
});
