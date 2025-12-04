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
  const zoneRef = useRef<HTMLDivElement>(null);

  // 檢查瀏覽器支持並添加全局事件監聽器
  useEffect(() => {
    testDragDropSupport();
    // 拖放診斷已禁用
    
    const zoneElement = zoneRef.current;
    if (!zoneElement) {
      return;
    }
    
    // 全局拖放事件處理器 - 在 document 層級捕獲所有事件
    const handleGlobalDragEnter = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      const isInZone = target.closest('[data-testid="drag-drop-zone"]');
      
      if (isInZone) {
        e.preventDefault();
        e.stopPropagation();
        // 拖放診斷已禁用
        
        dragCounter.current++;
        
        const types = Array.from(e.dataTransfer?.types || []);
        
        if (types.length > 0 || (e.dataTransfer?.files && e.dataTransfer.files.length > 0)) {
          setIsDragging(true);
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
          }
        } else {
          // 即使沒有類型，也嘗試設置（可能是某些瀏覽器的特殊情況）
          setIsDragging(true);
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
          }
        }
      }
    };
    
    const handleGlobalDragOver = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      const isInZone = target.closest('[data-testid="drag-drop-zone"]');
      
      if (isInZone) {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
        // 確保拖放狀態已設置
        setIsDragging(prev => {
          if (!prev && dragCounter.current > 0) {
            return true;
          }
          return prev;
        });
      }
    };
    
    const handleGlobalDragLeave = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      const isInZone = target.closest('[data-testid="drag-drop-zone"]');
      const relatedTarget = e.relatedTarget as HTMLElement;
      const isLeavingZone = !relatedTarget || !relatedTarget.closest('[data-testid="drag-drop-zone"]');
      
      if (isInZone && isLeavingZone) {
        e.preventDefault();
        e.stopPropagation();
        // 拖放診斷已禁用
        dragCounter.current--;
        if (dragCounter.current <= 0) {
          dragCounter.current = 0;
          setIsDragging(false);
        }
      }
    };
    
    const handleGlobalDrop = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      const isInZone = target.closest('[data-testid="drag-drop-zone"]');
      
      if (isInZone) {
        e.preventDefault();
        e.stopPropagation();
        // 拖放診斷已禁用
        setIsDragging(false);
        dragCounter.current = 0;
        
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0];
          onFileDrop(file);
        }
      }
    };
    
    // 在 document 上添加全局事件監聽器（捕獲階段）
    document.addEventListener('dragenter', handleGlobalDragEnter, true);
    document.addEventListener('dragover', handleGlobalDragOver, true);
    document.addEventListener('dragleave', handleGlobalDragLeave, true);
    document.addEventListener('drop', handleGlobalDrop, true);
    
    // 同時在 window 上添加（確保捕獲所有事件）
    window.addEventListener('dragenter', handleGlobalDragEnter, true);
    window.addEventListener('dragover', handleGlobalDragOver, true);
    window.addEventListener('dragleave', handleGlobalDragLeave, true);
    window.addEventListener('drop', handleGlobalDrop, true);
    
    return () => {
      document.removeEventListener('dragenter', handleGlobalDragEnter, true);
      document.removeEventListener('dragover', handleGlobalDragOver, true);
      document.removeEventListener('dragleave', handleGlobalDragLeave, true);
      document.removeEventListener('drop', handleGlobalDrop, true);
      window.removeEventListener('dragenter', handleGlobalDragEnter, true);
      window.removeEventListener('dragover', handleGlobalDragOver, true);
      window.removeEventListener('dragleave', handleGlobalDragLeave, true);
      window.removeEventListener('drop', handleGlobalDrop, true);
    };
  }, [onFileDrop]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 拖放診斷已禁用
    logDragEvent('dragEnter', e);
    
    dragCounter.current++;
    
    // 檢查是否包含文件 - 更寬鬆的檢查
    const types = Array.from(e.dataTransfer.types);
    
    // 對於從文件系統拖放的文件，通常會有 'Files' 類型
    // 但某些瀏覽器可能使用其他類型，所以我們更寬鬆地檢查
    const hasFiles = types.includes('Files') || 
                     types.includes('application/x-moz-file') ||
                     types.some(t => t.toLowerCase().includes('file')) ||
                     types.length > 0; // 如果有任何類型，也嘗試處理（可能是文件）
    
    // 只要有類型，就設置為拖放狀態（更寬鬆的策略）
    if (types.length > 0) {
      setIsDragging(true);
      e.dataTransfer.dropEffect = 'copy';
    } else if (hasFiles) {
      setIsDragging(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 拖放診斷已禁用
    logDragEvent('dragLeave', e);
    
    dragCounter.current--;
    
    // 只有當完全離開拖放區域時才取消拖放狀態
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 設置拖放效果 - 在 dragOver 中必須設置 dropEffect
    const types = Array.from(e.dataTransfer.types);
    const hasFiles = types.includes('Files') || 
                     types.includes('application/x-moz-file') ||
                     types.some(t => t.toLowerCase().includes('file')) ||
                     types.length > 0;
    
    if (hasFiles || types.length > 0) {
      e.dataTransfer.dropEffect = 'copy';
      // 確保拖放狀態已設置（使用函數式更新避免依賴）
      setIsDragging(prev => {
        if (!prev && dragCounter.current > 0) {
          return true;
        }
        return prev;
      });
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 拖放診斷已禁用
    logDragEvent('drop', e);
    
    setIsDragging(false);
    dragCounter.current = 0;

    // 方法1: 直接從 files 獲取
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      onFileDrop(file);
      return;
    }

    // 方法2: 從 items 獲取文件
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.kind === 'file') {
          // 嘗試直接獲取文件
          const file = item.getAsFile();
          if (file) {
            onFileDrop(file);
            return;
          }

          // 嘗試使用 webkitGetAsEntry (Chrome/Safari)
          const entry = (item as any).webkitGetAsEntry?.();
          if (entry) {
            if (entry.isFile) {
              entry.file((file: File) => {
                onFileDrop(file);
              });
              return;
            }
          }
        }
      }
    }
  }, [onFileDrop]);

  return (
    <div
      ref={zoneRef}
      className={`relative ${className}`}
      style={{ minHeight: '100%', width: '100%', position: 'relative' }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="drag-drop-zone"
    >
      {isDragging && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-blue-50/90 dark:bg-blue-900/50 border-4 border-blue-500 border-dashed z-[60] pointer-events-none"
          style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 60
          }}
        >
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

