import { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, FileText } from "lucide-react";

// 設置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface PDFViewerProps {
  filePath?: string;
  onTextExtract?: (text: string) => void;
}

export default function PDFViewer({ filePath, onTextExtract }: PDFViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 加載 PDF 文檔
  useEffect(() => {
    if (!filePath) {
      setPdfDoc(null);
      setCurrentPage(1);
      setTotalPages(0);
      return;
    }

    const loadPDF = async () => {
      setLoading(true);
      setError(null);
      try {
        // 支持文件路徑和 blob URL
        let loadingTask;
        if (filePath.startsWith('blob:') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
          // 對於 blob URL 或 HTTP URL，直接使用
          loadingTask = pdfjsLib.getDocument(filePath);
        } else {
          // 對於本地文件路徑，使用 file:// 前綴（如果需要）
          loadingTask = pdfjsLib.getDocument({
            url: filePath,
            withCredentials: false,
          });
        }
        const pdf = await loadingTask.promise;
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
  }, [filePath]);

  // 渲染當前頁面
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        const viewport = page.getViewport({ scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas: canvas,
        };

        await page.render(renderContext).promise;

        // 提取當前頁面文本
        if (onTextExtract) {
          const textContent = await page.getTextContent();
          const text = textContent.items
            .map((item: any) => item.str)
            .join(" ");
          onTextExtract(text);
        }
      } catch (err) {
        console.error("頁面渲染失敗:", err);
        setError("頁面渲染失敗");
      }
    };

    renderPage();
  }, [pdfDoc, currentPage, scale, onTextExtract]);

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

  // 跳轉到指定頁面
  const goToPage = (page: number) => {
    if (pdfDoc && page >= 1 && page <= totalPages) {
      setCurrentPage(page);
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
      pdfDoc.getPage(currentPage).then((page) => {
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

  if (!filePath) {
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

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-auto"
      onWheel={handleWheel}
    >
      {/* PDF 內容區域 */}
      <div className="flex-1 p-4 overflow-auto">
        <div className="flex justify-center">
          <canvas
            ref={canvasRef}
            className="shadow-lg bg-white dark:bg-gray-800"
            style={{ maxWidth: "100%" }}
          />
        </div>
      </div>

      {/* PDF 控制欄 */}
      <div className="px-4 py-2 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between sticky bottom-0">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage <= 1}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="上一頁 (←)"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
              className="w-16 px-2 py-1 text-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              / {totalPages}
            </span>
          </div>
          <button
            onClick={goToNextPage}
            disabled={currentPage >= totalPages}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="下一頁 (→)"
          >
            <ChevronRight size={20} />
          </button>
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

