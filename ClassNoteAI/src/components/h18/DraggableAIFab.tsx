/**
 * DraggableAIFab · v0.7.0 H18
 *
 * 可拖拽的 ✦ AI 助教浮動按鈕。
 *
 * 規則：
 *  - 拖拽中即時跟手（free position）
 *  - 放開時吸附最近邊（左 / 右），Y 軸保持不變但 clamp 在合理範圍
 *  - Position 存 localStorage 跨 session
 *  - 拖拽距離 < 4px 視為 click（開 AI dock）
 *  - 鍵盤 Enter/Space 也是 click
 *  - PointerEvents 直接處理（mouse + touch + pen 統一）
 */

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
} from 'react';
import s from './DraggableAIFab.module.css';

const STORAGE_KEY = 'h18-fab-pos-v1';
const FAB_SIZE = 44;
const EDGE_GAP = 20;
const TOP_CLAMP = 60;
const BOTTOM_CLAMP = 80;
const CLICK_THRESHOLD_PX = 4;

type Side = 'left' | 'right';

interface FabPos {
    side: Side;
    /** Top in px from viewport top. */
    top: number;
}

function loadPos(): FabPos {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            if ((p.side === 'left' || p.side === 'right') && typeof p.top === 'number') {
                return p;
            }
        }
    } catch {
        /* swallow */
    }
    // Default: right edge, around the lower-third of viewport
    const defaultTop = typeof window !== 'undefined'
        ? Math.max(TOP_CLAMP, window.innerHeight - 80 - FAB_SIZE)
        : 600;
    return { side: 'right', top: defaultTop };
}

function savePos(pos: FabPos) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
        /* swallow */
    }
}

function clampTop(top: number): number {
    if (typeof window === 'undefined') return top;
    const max = window.innerHeight - BOTTOM_CLAMP - FAB_SIZE;
    return Math.min(Math.max(TOP_CLAMP, top), Math.max(TOP_CLAMP, max));
}

export interface DraggableAIFabProps {
    onClick: () => void;
    /** Recording page lifts FAB up to clear the transport bar. */
    recording?: boolean;
}

export default function DraggableAIFab({
    onClick,
    recording = false,
}: DraggableAIFabProps) {
    const [pos, setPos] = useState<FabPos>(loadPos);
    const [drag, setDrag] = useState<{
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
        liveLeft: number;
        liveTop: number;
        moved: boolean;
    } | null>(null);
    const btnRef = useRef<HTMLButtonElement | null>(null);

    // Re-clamp top on viewport resize so FAB doesn't fall off
    useEffect(() => {
        const onResize = () => {
            setPos((cur) => {
                const next = { ...cur, top: clampTop(cur.top) };
                if (next.top !== cur.top) savePos(next);
                return next;
            });
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        if (!btnRef.current) return;
        // Capture so we still get move/up events outside the button
        btnRef.current.setPointerCapture(e.pointerId);
        const rect = btnRef.current.getBoundingClientRect();
        setDrag({
            startX: e.clientX,
            startY: e.clientY,
            offsetX: e.clientX - rect.left,
            offsetY: e.clientY - rect.top,
            liveLeft: rect.left,
            liveTop: rect.top,
            moved: false,
        });
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        setDrag((cur) => {
            if (!cur) return cur;
            const dx = e.clientX - cur.startX;
            const dy = e.clientY - cur.startY;
            const moved =
                cur.moved ||
                Math.abs(dx) > CLICK_THRESHOLD_PX ||
                Math.abs(dy) > CLICK_THRESHOLD_PX;
            return {
                ...cur,
                liveLeft: e.clientX - cur.offsetX,
                liveTop: e.clientY - cur.offsetY,
                moved,
            };
        });
    }, []);

    const onPointerUp = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            if (btnRef.current?.hasPointerCapture(e.pointerId)) {
                btnRef.current.releasePointerCapture(e.pointerId);
            }
            setDrag((cur) => {
                if (!cur) return null;
                if (!cur.moved) {
                    // Treated as click
                    queueMicrotask(onClick);
                    return null;
                }
                // Snap to nearest edge based on center X
                const centerX = cur.liveLeft + FAB_SIZE / 2;
                const side: Side =
                    centerX < window.innerWidth / 2 ? 'left' : 'right';
                const finalTop = clampTop(cur.liveTop);
                const next: FabPos = { side, top: finalTop };
                savePos(next);
                setPos(next);
                return null;
            });
        },
        [onClick],
    );

    const onPointerCancel = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            if (btnRef.current?.hasPointerCapture(e.pointerId)) {
                btnRef.current.releasePointerCapture(e.pointerId);
            }
            setDrag(null);
        },
        [],
    );

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLButtonElement>) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
            }
        },
        [onClick],
    );

    // Style: during drag use live position; otherwise snapped position
    const recordingLift = recording ? 4 : 0; // tiny extra lift when recording (only when at default bottom)
    const baseTop = clampTop(pos.top - recordingLift);
    const style: CSSProperties = drag
        ? {
              left: drag.liveLeft,
              top: drag.liveTop,
              right: 'auto',
              bottom: 'auto',
          }
        : pos.side === 'left'
          ? {
                left: EDGE_GAP,
                top: baseTop,
                right: 'auto',
                bottom: 'auto',
            }
          : {
                right: EDGE_GAP,
                top: baseTop,
                left: 'auto',
                bottom: 'auto',
            };

    // Snap preview during drag — show which edge we'll snap to
    let snapPreview = '';
    if (drag) {
        const centerX = drag.liveLeft + FAB_SIZE / 2;
        snapPreview =
            centerX < window.innerWidth / 2
                ? s.snapPreviewLeft
                : s.snapPreviewRight;
    }

    return (
        <button
            ref={btnRef}
            type="button"
            className={`${s.fab} ${drag ? s.fabDragging : s.fabIdle} ${snapPreview}`}
            style={style}
            title="拖拽移動 / 點擊問 AI (⌘J)"
            aria-label="AI 助教 (可拖拽)"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
        >
            ✦
        </button>
    );
}
