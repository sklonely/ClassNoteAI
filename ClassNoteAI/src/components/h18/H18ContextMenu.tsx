/**
 * H18ContextMenu · Phase 7 Sprint 3 Round 1 (S3b-1)
 *
 * Generic context-menu base component used by 3b text menu / lecture menu /
 * any future right-click context menu in H18.
 *
 * Behaviour aligns with `docs/design/h18-deep/H18-MODAL-CONVENTIONS.md`:
 *   - role="menu" + items role="menuitem" (§6)
 *   - Esc closes (§3); outside click closes (§5)
 *   - z-index: var(--h18-z-popover) (§2)
 *   - Animation: open uses base + spring; here we use a small fadeIn
 *     using fast + ease-out token for snappy menu feel.
 *   - Submenu inherits same z-index, stacked by DOM order (§2).
 *
 * Position is clamped into viewport so the menu never falls off the edge.
 *
 * Keyboard:
 *   - ArrowUp / ArrowDown — move active item
 *   - Enter — invoke active item's onClick (no-op if disabled)
 *   - Escape — close
 *
 * Submenu strategy: items with `submenu` open on hover or click. They do
 * NOT close the parent menu; clicking an item inside a submenu (a leaf)
 * closes the whole tree by calling onClose on the parent.
 */

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import styles from './H18ContextMenu.module.css';

export interface H18ContextMenuItem {
    id: string;
    label: string;
    icon?: ReactNode;
    /** Display-only hint (e.g. '⌘K'). Does NOT bind a real shortcut. */
    shortcut?: string;
    /** Render in red (e.g. delete). */
    danger?: boolean;
    /** When true, click + Enter become no-ops and visual is dimmed. */
    disabled?: boolean;
    /** When present, this item opens a submenu instead of firing onClick. */
    submenu?: H18ContextMenuItem[];
    onClick?: () => void;
}

export interface H18ContextMenuProps {
    items: H18ContextMenuItem[];
    /** Position in viewport coords (e.g. from contextmenu event clientX/Y). */
    x: number;
    y: number;
    /** Called when menu requests close (Esc / leaf click / outside click). */
    onClose: () => void;
    /** Optional aria-label for the menu container. Defaults to '選項'. */
    ariaLabel?: string;
}

/** Approximate width used to anchor the submenu while waiting for layout. */
const SUBMENU_X_OFFSET = 200;
const SUBMENU_ROW_HEIGHT = 32;

export function H18ContextMenu({
    items,
    x,
    y,
    onClose,
    ariaLabel,
}: H18ContextMenuProps) {
    const ref = useRef<HTMLUListElement>(null);
    const [submenuId, setSubmenuId] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [pos, setPos] = useState({ x, y });

    // Esc + arrow-keys + Enter
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
                const item = items[activeIndex];
                if (!item || item.disabled) return;
                if (item.submenu) {
                    setSubmenuId(item.id);
                    return;
                }
                item.onClick?.();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [items, activeIndex, onClose]);

    // Outside click → close
    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            if (!ref.current) return;
            if (!ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [onClose]);

    // Adjust position to stay inside viewport
    useLayoutEffect(() => {
        if (!ref.current) return;
        const r = ref.current.getBoundingClientRect();
        let nx = x;
        let ny = y;
        if (x + r.width > window.innerWidth - 8) {
            nx = window.innerWidth - r.width - 8;
        }
        if (y + r.height > window.innerHeight - 8) {
            ny = window.innerHeight - r.height - 8;
        }
        setPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
    }, [x, y]);

    return (
        <ul
            ref={ref}
            className={styles.menu}
            role="menu"
            aria-label={ariaLabel ?? '選項'}
            style={{ left: pos.x, top: pos.y }}
        >
            {items.map((item, i) => {
                const classNames = [styles.item];
                if (item.danger) classNames.push(styles.danger);
                if (item.disabled) classNames.push(styles.disabled);
                if (i === activeIndex) classNames.push(styles.active);

                return (
                    <li
                        key={item.id}
                        role="menuitem"
                        aria-disabled={item.disabled ? 'true' : 'false'}
                        {...(item.submenu ? { 'aria-haspopup': 'menu' } : {})}
                        className={classNames.join(' ')}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (item.disabled) return;
                            if (item.submenu) {
                                setSubmenuId(item.id);
                                return;
                            }
                            item.onClick?.();
                            onClose();
                        }}
                        onMouseEnter={() => {
                            setActiveIndex(i);
                            if (item.submenu) {
                                setSubmenuId(item.id);
                            } else {
                                // closing submenu when hovering a leaf is
                                // intentional UX (parallel to native menus)
                                setSubmenuId(null);
                            }
                        }}
                    >
                        {item.icon ? (
                            <span className={styles.icon}>{item.icon}</span>
                        ) : null}
                        <span className={styles.label}>{item.label}</span>
                        {item.shortcut ? (
                            <kbd className={styles.shortcut}>
                                {item.shortcut}
                            </kbd>
                        ) : null}
                        {item.submenu ? (
                            <span className={styles.chevron} aria-hidden="true">
                                ▸
                            </span>
                        ) : null}

                        {submenuId === item.id &&
                            item.submenu &&
                            item.submenu.length > 0 && (
                                <H18ContextMenu
                                    items={item.submenu}
                                    x={pos.x + SUBMENU_X_OFFSET}
                                    y={pos.y + i * SUBMENU_ROW_HEIGHT}
                                    onClose={onClose}
                                    ariaLabel={`${item.label} 子選項`}
                                />
                            )}
                    </li>
                );
            })}
        </ul>
    );
}

export default H18ContextMenu;
