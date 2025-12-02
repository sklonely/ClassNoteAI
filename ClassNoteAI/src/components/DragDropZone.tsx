import { useState, useRef, useCallback, useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { logDragEvent, testDragDropSupport } from "../utils/dragDropDebug";

interface DragDropZoneProps {
  onFileDrop: (file: File) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * 拖放區域組件
 * 提供統一的拖放處理邏輯
 */
export default function DragDropZone({ onFileDrop, children, className = "" }: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // 檢查瀏覽器支持
  useEffect(() => {
    testDragDropSupport();
    console.log('[拖放診斷] DragDropZone 組件已掛載');
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    logDragEvent('dragEnter', e);
    
    dragCounter.current++;
    console.log(`[拖放診斷] dragEnter - counter: ${dragCounter.current}`);
    
    // 檢查是否包含文件
    const hasFiles = e.dataTransfer.types.includes('Files') || 
                     e.dataTransfer.types.includes('application/x-moz-file') ||
                     Array.from(e.dataTransfer.types).some(t => t.includes('file'));
    
    if (hasFiles) {
      setIsDragging(true);
      e.dataTransfer.dropEffect = 'copy';
      console.log('[拖放診斷] 設置拖放狀態為 true');
    } else {
      console.log('[拖放診斷] 未檢測到文件類型');
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    logDragEvent('dragLeave', e);
    
    dragCounter.current--;
    console.log(`[拖放診斷] dragLeave - counter: ${dragCounter.current}`);
    
    // 只有當完全離開拖放區域時才取消拖放狀態
    if (dragCounter.current === 0) {
      setIsDragging(false);
      console.log('[拖放診斷] 設置拖放狀態為 false');
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 設置拖放效果
    const hasFiles = e.dataTransfer.types.includes('Files') || 
                     e.dataTransfer.types.includes('application/x-moz-file') ||
                     Array.from(e.dataTransfer.types).some(t => t.includes('file'));
    
    if (hasFiles) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    logDragEvent('drop', e);
    
    setIsDragging(false);
    dragCounter.current = 0;

    console.log("=== 拖放事件觸發 ===");
    console.log("dataTransfer.types:", Array.from(e.dataTransfer.types));
    console.log("dataTransfer.files.length:", e.dataTransfer.files.length);
    console.log("dataTransfer.items.length:", e.dataTransfer.items.length);

    // 方法1: 直接從 files 獲取
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      console.log("方法1: 從 files 獲取");
      const file = files[0];
      console.log("文件信息:", {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      });
      onFileDrop(file);
      return;
    }

    // 方法2: 從 items 獲取文件
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      console.log("方法2: 從 items 獲取");
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`Item ${i}:`, {
          kind: item.kind,
          type: item.type,
        });

        if (item.kind === 'file') {
          // 嘗試直接獲取文件
          const file = item.getAsFile();
          if (file) {
            console.log("從 item.getAsFile() 獲取文件:", file.name);
            onFileDrop(file);
            return;
          }

          // 嘗試使用 webkitGetAsEntry (Chrome/Safari)
          const entry = (item as any).webkitGetAsEntry?.();
          if (entry) {
            console.log("Entry 類型:", entry.isFile ? "file" : "directory");
            if (entry.isFile) {
              entry.file((file: File) => {
                console.log("從 webkitGetAsEntry 獲取文件:", file.name);
                onFileDrop(file);
              });
              return;
            }
          }
        }
      }
    }

    console.warn("無法從拖放事件中獲取文件");
  }, [onFileDrop]);

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 dark:bg-blue-900/50 border-2 border-blue-500 border-dashed z-50 pointer-events-none">
          <div className="text-center">
            <FolderOpen size={64} className="mx-auto mb-4 text-blue-500 animate-bounce" />
            <p className="text-lg text-blue-600 dark:text-blue-400 font-semibold">
              放開以打開 PDF 文件
            </p>
            <p className="text-sm text-blue-500 dark:text-blue-400 mt-2">
              拖放 PDF 文件到此處
            </p>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

