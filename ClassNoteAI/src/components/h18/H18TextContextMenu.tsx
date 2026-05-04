/**
 * H18TextContextMenu · Phase 7 Sprint 3 Round 2 (S3b-2)
 *
 * Right-click context menu shown when the user right-clicks an
 * `<input>`, `<textarea>` or `contenteditable` surface anywhere in the
 * H18 shell. Mounts via the global contextmenu listener wired up in
 * H18DeepApp; the listener instantiates this component with the live
 * target reference + viewport coords.
 *
 * Items (always 5, fixed order to match native text-edit menus):
 *   剪下 / 複製 / 貼上 / ─separator / 全選
 *
 * Disable rules:
 *   - 剪下：!editable || !hasSelection
 *   - 複製：!hasSelection
 *   - 貼上：!editable || clipboardEmpty (clipboard probed once on mount)
 *   - 全選：always enabled
 *
 * "editable" means the target is a real input/textarea OR has
 * `isContentEditable === true`. We can copy from non-editable text
 * surfaces (selection only), but cut/paste need an editable target.
 *
 * We use `document.execCommand` for the actual cut/copy/paste — yes,
 * spec'd as deprecated, but every shipping browser + Tauri webview
 * still supports it, and the alternative (navigator.clipboard +
 * setSelectionRange + manual splice) is significantly more code for
 * zero user-visible difference. If/when execCommand actually
 * disappears, swap the bodies of these onClicks; the menu shape
 * doesn't need to change.
 *
 * Clipboard-empty detection is best-effort:
 *   - reads navigator.clipboard.readText() on mount (async)
 *   - if rejected (no permission, no clipboard) → assume empty
 *     (safer to over-disable than to silently do nothing on click)
 *   - this is racy: if the user copies text into another app, opens
 *     this menu, and the clipboard probe resolved before the copy,
 *     paste shows disabled. Acceptable — they can right-click again.
 */

import { useEffect, useState } from 'react';
import { H18ContextMenu, type H18ContextMenuItem } from './H18ContextMenu';
import { formatComboLabel } from '../../utils/kbd';

export interface H18TextContextMenuProps {
    x: number;
    y: number;
    target: HTMLInputElement | HTMLTextAreaElement | HTMLElement;
    onClose: () => void;
}

export function H18TextContextMenu({
    x,
    y,
    target,
    onClose,
}: H18TextContextMenuProps) {
    const isInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
    const isContentEditable = (target as HTMLElement).isContentEditable === true;
    const editable = isInput || isContentEditable;

    const hasSelection = (() => {
        if (isInput) {
            const el = target as HTMLInputElement | HTMLTextAreaElement;
            return el.selectionStart !== el.selectionEnd;
        }
        const sel = window.getSelection();
        return !!sel && sel.toString().length > 0;
    })();

    const [clipboardEmpty, setClipboardEmpty] = useState(false);

    useEffect(() => {
        // Best-effort clipboard probe. Browsers without clipboard access
        // (or w/o user activation) will reject — treat as empty so paste
        // is disabled rather than ghost-firing.
        let cancelled = false;
        const cb =
            typeof navigator !== 'undefined' && navigator.clipboard
                ? navigator.clipboard
                : null;
        if (!cb || typeof cb.readText !== 'function') {
            setClipboardEmpty(true);
            return;
        }
        cb.readText()
            .then((text) => {
                if (cancelled) return;
                setClipboardEmpty(!text);
            })
            .catch(() => {
                if (cancelled) return;
                setClipboardEmpty(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const items: H18ContextMenuItem[] = [
        {
            id: 'cut',
            label: '剪下',
            shortcut: formatComboLabel('Mod+X'),
            disabled: !editable || !hasSelection,
            onClick: () => {
                document.execCommand('cut');
            },
        },
        {
            id: 'copy',
            label: '複製',
            shortcut: formatComboLabel('Mod+C'),
            disabled: !hasSelection,
            onClick: () => {
                document.execCommand('copy');
            },
        },
        {
            id: 'paste',
            label: '貼上',
            shortcut: formatComboLabel('Mod+V'),
            disabled: !editable || clipboardEmpty,
            onClick: () => {
                target.focus();
                document.execCommand('paste');
            },
        },
        // Visual separator. H18ContextMenu has no separator role yet;
        // we render it as a disabled item with a dash so it shows up but
        // can't be activated. Keyboard nav still steps over it (treated
        // as disabled in Enter handler).
        { id: 'sep', label: '─', disabled: true },
        {
            id: 'selectAll',
            label: '全選',
            shortcut: formatComboLabel('Mod+A'),
            onClick: () => {
                if (isInput) {
                    (target as HTMLInputElement | HTMLTextAreaElement).select();
                } else {
                    document.execCommand('selectAll');
                }
            },
        },
    ];

    return (
        <H18ContextMenu
            items={items}
            x={x}
            y={y}
            onClose={onClose}
            ariaLabel="文字操作"
        />
    );
}

export default H18TextContextMenu;
