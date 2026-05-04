import { forwardRef, useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import s from './VideoPiP.module.css';

/**
 * v0.6.0 — "picture-in-picture" floating video for lectures that have
 * both an imported video and an attached PDF. The slides are the main
 * thing (big centred PDF); the video is a draggable overlay users can
 * park wherever it doesn't cover what they're reading.
 *
 * Deliberately simple: no resize handle in the initial cut (fixed
 * 360×203 16:9), no boundary clamping (users can drag it fully off
 * screen if they really want to — unlikely in practice). Position is
 * not persisted across reloads; it resets to the top-right corner of
 * the container each mount, which is the most common "not in the way"
 * spot for a centered PDF.
 *
 * The media ref is forwarded to the parent so the existing playback
 * wiring (timeupdate, seek, subtitle sync) keeps working unchanged —
 * this component only owns the positioning, not the playback model.
 */

interface Props {
    src: string;
    onTimeUpdate: React.ReactEventHandler<HTMLVideoElement>;
    onLoadedMetadata: React.ReactEventHandler<HTMLVideoElement>;
    onEnded: () => void;
}

const VideoPiP = forwardRef<HTMLVideoElement, Props>(
    ({ src, onTimeUpdate, onLoadedMetadata, onEnded }, ref) => {
        const [pos, setPos] = useState({ x: 16, y: 16 });
        const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
        const containerRef = useRef<HTMLDivElement>(null);

        useEffect(() => {
            const onMove = (e: MouseEvent) => {
                if (!dragState.current) return;
                const dx = e.clientX - dragState.current.startX;
                const dy = e.clientY - dragState.current.startY;
                setPos({
                    x: dragState.current.origX + dx,
                    y: dragState.current.origY + dy,
                });
            };
            const onUp = () => {
                dragState.current = null;
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            return () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
        }, []);

        const beginDrag = (e: React.MouseEvent) => {
            dragState.current = {
                startX: e.clientX,
                startY: e.clientY,
                origX: pos.x,
                origY: pos.y,
            };
            e.preventDefault();
        };

        return (
            <div
                ref={containerRef}
                className={s.shell}
                style={{
                    top: pos.y,
                    right: pos.x < 0 ? undefined : pos.x,
                    left: pos.x < 0 ? Math.abs(pos.x) : undefined,
                }}
            >
                <div
                    onMouseDown={beginDrag}
                    className={s.handle}
                    title="拖動"
                >
                    <GripVertical size={10} />
                    <span>DRAG</span>
                </div>
                <video
                    ref={ref}
                    src={src}
                    onTimeUpdate={onTimeUpdate}
                    onLoadedMetadata={onLoadedMetadata}
                    onEnded={onEnded}
                    controls
                    className={s.video}
                />
            </div>
        );
    },
);

VideoPiP.displayName = 'VideoPiP';

export default VideoPiP;
