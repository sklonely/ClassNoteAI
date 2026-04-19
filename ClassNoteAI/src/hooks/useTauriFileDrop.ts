import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * v0.6.0 — Tauri-native drag-drop hook.
 *
 * We switched `dragDropEnabled` from `false` to `true` in tauri.conf.json
 * so the backend emits `drop` events with real filesystem paths instead
 * of letting the webview's HTML5 drag-drop fire with opaque `File`
 * objects. The motivation is video import: a 500 MB recorded lecture
 * read as `File.arrayBuffer()` → `write_temp_file(Vec<u8>)` would have
 * to JSON-encode ~500 MB of bytes across the Tauri IPC, which is both
 * slow and memory-expensive. Paths avoid it entirely.
 *
 * Because Tauri's drop event is window-global (not per-element) we
 * emulate zone bounds in JS: each registered zone checks whether the
 * drop's physical coordinates map into its DOMRect before claiming the
 * event. Only the topmost zone under the cursor fires its callback.
 *
 * Multiple instances can coexist (e.g. the NotesView root zone plus an
 * open ImportModal on top); z-order is decided by `elementFromPoint`
 * at drop time, which naturally picks the modal when it's mounted.
 */

type DropHandler = (paths: string[]) => void;

interface Options {
    /** Ref to the DOM element that represents the drop zone. Drops
     *  whose cursor position maps outside this element's bounds are
     *  ignored. */
    zoneRef: React.RefObject<HTMLElement | null>;
    /** Called with the list of absolute filesystem paths dropped. */
    onDrop: DropHandler;
    /** Disable the subscription without unmounting the component. */
    enabled?: boolean;
}

export function useTauriFileDrop({ zoneRef, onDrop, enabled = true }: Options) {
    const [isDragging, setIsDragging] = useState(false);
    // Keep latest callbacks in refs so we don't need to re-subscribe on
    // every render — the Tauri event subscription is async and tearing
    // it down per render would miss events during the resubscribe gap.
    const onDropRef = useRef(onDrop);
    const zoneRefRef = useRef(zoneRef);
    onDropRef.current = onDrop;
    zoneRefRef.current = zoneRef;

    useEffect(() => {
        if (!enabled) {
            setIsDragging(false);
            return;
        }

        let unlisten: UnlistenFn | undefined;
        let cancelled = false;

        const isPointInsideZone = (physicalX: number, physicalY: number): boolean => {
            const el = zoneRefRef.current.current;
            if (!el) return false;
            // Convert Tauri's physical position → CSS pixels. devicePixelRatio
            // can change at runtime (user moves window between monitors), so
            // read it fresh each event.
            const dpr = window.devicePixelRatio || 1;
            const cssX = physicalX / dpr;
            const cssY = physicalY / dpr;
            const rect = el.getBoundingClientRect();
            if (cssX < rect.left || cssX > rect.right) return false;
            if (cssY < rect.top || cssY > rect.bottom) return false;
            // `elementFromPoint` respects z-order, so a modal mounted
            // above the lecture view takes precedence — only the
            // topmost zone under the cursor claims the drop.
            const hit = document.elementFromPoint(cssX, cssY);
            return !!hit && (hit === el || el.contains(hit));
        };

        const subscribe = async () => {
            const webview = getCurrentWebview();
            unlisten = await webview.onDragDropEvent((event) => {
                if (cancelled) return;
                const payload = event.payload;
                switch (payload.type) {
                    case 'enter':
                    case 'over': {
                        const inside = isPointInsideZone(payload.position.x, payload.position.y);
                        setIsDragging(inside);
                        break;
                    }
                    case 'leave': {
                        setIsDragging(false);
                        break;
                    }
                    case 'drop': {
                        setIsDragging(false);
                        if (!isPointInsideZone(payload.position.x, payload.position.y)) {
                            return;
                        }
                        const paths = payload.paths ?? [];
                        if (paths.length === 0) return;
                        onDropRef.current(paths);
                        break;
                    }
                }
            });
            if (cancelled && unlisten) unlisten();
        };

        subscribe();

        return () => {
            cancelled = true;
            if (unlisten) unlisten();
        };
    }, [enabled]);

    return { isDragging };
}
