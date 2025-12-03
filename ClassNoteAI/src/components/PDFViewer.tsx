import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ZoomIn, ZoomOut, Maximize2, FileText } from "lucide-react";

// 設置 PDF.js worker
// 使用 Vite 的靜態資源導入
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PDFViewerProps {
  filePath?: string;
  pdfData?: ArrayBuffer;
  onTextExtract?: (text: string) => void;
}

export default function PDFViewer({ filePath, pdfData, onTextExtract }: PDFViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // 加載 PDF 文檔
  useEffect(() => {
    // 優先使用 pdfData（ArrayBuffer），如果沒有則使用 filePath
    if (!pdfData && !filePath) {
      setPdfDoc(null);
      setCurrentPage(1);
      setTotalPages(0);
      return;
    }

    const loadPDF = async () => {
      setLoading(true);
      setError(null);
      try {
        let loadingTask;
        
        // 優先使用直接傳遞的 ArrayBuffer
        if (pdfData) {
          console.log("[PDFViewer] 使用直接傳遞的 ArrayBuffer，大小:", pdfData.byteLength);
          // 創建一個完全獨立的 ArrayBuffer 副本，確保可以被正確序列化
          const sourceArray = new Uint8Array(pdfData);
          const newArrayBuffer = new ArrayBuffer(sourceArray.length);
          const newArray = new Uint8Array(newArrayBuffer);
          newArray.set(sourceArray);
          console.log("[PDFViewer] 創建獨立的 ArrayBuffer 副本，大小:", newArrayBuffer.byteLength);
          loadingTask = pdfjsLib.getDocument({
            data: newArrayBuffer,
          });
        } else if (filePath) {
          console.log("[PDFViewer] 開始加載 PDF，路徑:", filePath);
          
          if (filePath.startsWith('blob:')) {
            // 對於 blob URL，使用 fetch 獲取數據
            console.log("[PDFViewer] 檢測到 blob URL，開始獲取數據");
            try {
              const response = await fetch(filePath);
              
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              
              const arrayBuffer = await response.arrayBuffer();
              console.log("[PDFViewer] 獲取到 ArrayBuffer，大小:", arrayBuffer.byteLength);
              
              loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
              });
            } catch (fetchError) {
              console.error("[PDFViewer] Fetch blob URL 失敗:", fetchError);
              // 如果 fetch 失敗，嘗試直接使用 blob URL
              console.log("[PDFViewer] 嘗試直接使用 blob URL");
              loadingTask = pdfjsLib.getDocument(filePath);
            }
          } else if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            // 對於 HTTP URL，直接使用
            loadingTask = pdfjsLib.getDocument(filePath);
          } else {
            // 對於本地文件路徑，使用 file:// 前綴（如果需要）
            loadingTask = pdfjsLib.getDocument({
              url: filePath,
              withCredentials: false,
            });
          }
        }
        
        if (!loadingTask) {
          throw new Error("無法創建 PDF 加載任務");
        }
        
        const pdf = await loadingTask.promise;
        console.log("[PDFViewer] PDF 加載成功，頁數:", pdf.numPages);
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
      } catch (err) {
        console.error("PDF 加載失敗:", err);
        setError(err instanceof Error ? err.message : "PDF 加載失敗");
        setPdfDoc(null);
      } finally {
        setLoading(false);
      }
    };

    loadPDF();

    // 清理 blob URL（如果使用）
    return () => {
      if (filePath && filePath.startsWith('blob:')) {
        URL.revokeObjectURL(filePath);
      }
    };
  }, [filePath, pdfData]);

  // 渲染所有頁面（連續滾動模式）
  useEffect(() => {
    if (!pdfDoc || totalPages === 0) return;

    // 使用標記來追蹤渲染任務，避免重複渲染
    let isRendering = false;
    const renderTasks = new Map<number, Promise<void>>();

    const renderPage = async (pageNum: number) => {
      const canvas = canvasRefs.current.get(pageNum);
      if (!canvas) {
        console.warn(`[PDFViewer] Canvas for page ${pageNum} not found`);
        return;
      }

      // 如果已經有渲染任務在進行，等待它完成
      if (renderTasks.has(pageNum)) {
        await renderTasks.get(pageNum);
        return;
      }

      const renderPromise = (async () => {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const context = canvas.getContext("2d");
          if (!context) {
            console.warn(`[PDFViewer] Cannot get context for page ${pageNum}`);
            return;
          }

          // 清理 canvas
          context.clearRect(0, 0, canvas.width, canvas.height);

          const viewport = page.getViewport({ scale });
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport,
            canvas: canvas,
          };

          await page.render(renderContext).promise;

          // 提取第一頁文本（用於 AI 助教上下文）
          if (pageNum === 1 && onTextExtract) {
            const textContent = await page.getTextContent();
            const text = textContent.items
              .map((item: any) => item.str)
              .join(" ");
            onTextExtract(text);
          }
        } catch (err) {
          console.error(`[PDFViewer] 頁面 ${pageNum} 渲染失敗:`, err);
          // 不設置全局錯誤，只記錄單個頁面的錯誤
        } finally {
          renderTasks.delete(pageNum);
        }
      })();

      renderTasks.set(pageNum, renderPromise);
      return renderPromise;
    };

    const renderAllPages = async () => {
      if (isRendering) {
        console.log("[PDFViewer] 渲染已進行中，跳過");
        return;
      }

      isRendering = true;
      try {
        // 檢查所有 canvas 是否都已創建
        const allCanvasesReady = Array.from({ length: totalPages }, (_, i) => i + 1)
          .every(pageNum => canvasRefs.current.has(pageNum));

        if (!allCanvasesReady) {
          console.log("[PDFViewer] 等待所有 canvas 創建...");
          setTimeout(() => {
            isRendering = false;
            renderAllPages();
          }, 100);
          return;
        }

        // 並行渲染所有頁面
        const renderPromises = Array.from({ length: totalPages }, (_, i) => i + 1)
          .map(pageNum => renderPage(pageNum));

        await Promise.all(renderPromises);
        console.log("[PDFViewer] 所有頁面渲染完成");
      } catch (err) {
        console.error("[PDFViewer] 渲染過程出錯:", err);
      } finally {
        isRendering = false;
      }
    };

    // 等待 DOM 更新後再渲染
    const timeoutId = setTimeout(() => {
      renderAllPages();
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      // 取消所有進行中的渲染任務
      renderTasks.clear();
    };
  }, [pdfDoc, totalPages, scale, onTextExtract]);

  // 上一頁
  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // 下一頁
  const goToNextPage = () => {
    if (pdfDoc && currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };


  // 縮放
  const zoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const fitToWidth = () => {
    if (containerRef.current && pdfDoc) {
      const containerWidth = containerRef.current.clientWidth - 64; // 減去 padding
      pdfDoc.getPage(1).then((page) => {
        const viewport = page.getViewport({ scale: 1 });
        const newScale = containerWidth / viewport.width;
        setScale(Math.min(newScale, 3));
      });
    }
  };

  // 處理滾輪縮放
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    }
  };

  // 處理鍵盤快捷鍵
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPreviousPage();
          break;
        case "ArrowRight":
          e.preventDefault();
          goToNextPage();
          break;
        case "+":
        case "=":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomIn();
          }
          break;
        case "-":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomOut();
          }
          break;
        case "0":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            fitToWidth();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, totalPages]);

  if (!filePath && !pdfData) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <FileText size={48} className="mx-auto mb-4 opacity-50" />
          <p className="text-lg mb-2">PDF 查看器</p>
          <p className="text-sm">請選擇或拖放 PDF 文件</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">加載 PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
        <div className="text-center text-red-500">
          <p className="text-lg mb-2">錯誤</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // 設置 canvas ref
  const setCanvasRef = (pageNum: number) => (el: HTMLCanvasElement | null) => {
    if (el) {
      canvasRefs.current.set(pageNum, el);
    } else {
      canvasRefs.current.delete(pageNum);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-gray-50 dark:bg-gray-900"
      style={{ pointerEvents: 'auto' }}
    >
      {/* PDF 內容區域 - 連續滾動 */}
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden p-4"
        onWheel={handleWheel}
      >
        <div className="flex flex-col items-center gap-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
            <div key={pageNum} className="flex justify-center">
              <canvas
                ref={setCanvasRef(pageNum)}
                className="shadow-lg bg-white dark:bg-gray-800"
                style={{ maxWidth: "100%", display: "block" }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* PDF 控制欄 - 只保留縮放控制 */}
      <div className="px-4 py-2 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between sticky bottom-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            共 {totalPages} 頁
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="縮小 (Ctrl+-)"
          >
            <ZoomOut size={18} />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[60px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="放大 (Ctrl++)"
          >
            <ZoomIn size={18} />
          </button>
          <button
            onClick={fitToWidth}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="適應寬度 (Ctrl+0)"
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

