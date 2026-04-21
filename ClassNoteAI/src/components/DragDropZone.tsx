import { useRef } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTauriFileDrop } from '../hooks/useTauriFileDrop';

interface DragDropZoneProps {
    /** Called once per drop with the absolute filesystem paths Tauri reported. */
    onFileDrop: (paths: string[]) => void;
    children: React.ReactNode;
    className?: string;
    /** Toggle the subscription without unmounting (e.g. disable
     *  lecture-level drops while an import modal is open). */
    enabled?: boolean;
    /** Hint shown in the drop overlay. */
    overlayLabel?: string;
    /** Secondary line below the overlay label. */
    overlayHint?: string;
}

/**
 * v0.6.0 refactor: drag-drop now rides on Tauri's native window event
 * (see useTauriFileDrop). We deleted the HTML5 listeners that the
 * original implementation used because `dragDropEnabled` in
 * tauri.conf.json is now `true` — the webview's own drag events no
 * longer fire. The props shape changed from `File` to `paths: string[]`
 * since the native event carries filesystem paths, not File handles.
 */
export default function DragDropZone({
    onFileDrop,
    children,
    className = '',
    enabled = true,
    overlayLabel = '放開以匯入檔案',
    overlayHint = '支援影片、PDF、PPT、Word',
}: DragDropZoneProps) {
    const zoneRef = useRef<HTMLDivElement>(null);
    const { isDragging } = useTauriFileDrop({
        zoneRef,
        onDrop: onFileDrop,
        enabled,
    });

    return (
        <div
            ref={zoneRef}
            className={`relative ${className}`}
            style={{ minHeight: '100%', width: '100%' }}
            data-testid="drag-drop-zone"
        >
            {isDragging && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-blue-50/90 dark:bg-blue-900/50 border-4 border-blue-500 border-dashed z-60 pointer-events-none"
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 60,
                    }}
                >
                    <div className="text-center">
                        <FolderOpen
                            size={64}
                            className="mx-auto mb-4 text-blue-500 animate-bounce"
                        />
                        <p className="text-lg text-blue-600 dark:text-blue-400 font-semibold">
                            {overlayLabel}
                        </p>
                        <p className="text-sm text-blue-500 dark:text-blue-400 mt-2">
                            {overlayHint}
                        </p>
                    </div>
                </div>
            )}
            {children}
        </div>
    );
}
