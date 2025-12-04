import { useState, useEffect, useRef } from "react";
import { X, BookOpen, FileText } from "lucide-react";
import { selectPDFFile, readPDFFile } from "../services/fileService";
import { ollamaService } from "../services/ollamaService";
import { pdfService } from "../services/pdfService";
import { Cpu, Loader2 } from "lucide-react";

interface CourseCreationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (title: string, keywords: string, pdfData?: ArrayBuffer, description?: string) => Promise<void> | void;
  initialTitle?: string;
  initialKeywords?: string;
  initialPdfPath?: string;
  initialDescription?: string;
  existingContext?: string;
  mode?: 'create' | 'edit';
}

export default function CourseCreationDialog({
  isOpen,
  onClose,
  onSubmit,
  initialTitle = "",
  initialKeywords = "",
  initialPdfPath,
  initialDescription = "",
  existingContext,
  mode = 'create',
}: CourseCreationDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [keywords, setKeywords] = useState(initialKeywords);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string>("");
  const [description, setDescription] = useState(initialDescription);
  const [contextTab, setContextTab] = useState<'pdf' | 'text'>('pdf');

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isComposingRef = useRef(false);


  const [isGeneratingKeywords, setIsGeneratingKeywords] = useState(false);

  // 當 isOpen 或 initialValues 改變時重置或更新狀態
  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setKeywords(initialKeywords);
      setPdfData(null);
      setPdfFileName("");
      setDescription(initialDescription);
      setIsSubmitting(false);
      // 如果有初始描述但沒有 PDF，默認顯示文本標籤
      if (initialDescription && !initialPdfPath) {
        setContextTab('text');
      } else {
        setContextTab('pdf');
      }

      // 如果是編輯模式且有 PDF 路徑，嘗試自動加載
      if (mode === 'edit' && initialPdfPath) {
        const loadPdf = async () => {
          setIsLoading(true);
          try {
            const result = await readPDFFile(initialPdfPath);
            if (result) {
              setPdfData(result.data);
              const fileName = result.path.split("/").pop() || "已加載 PDF";
              setPdfFileName(fileName);
            }
          } catch (error) {
            console.error("自動加載 PDF 失敗:", error);
          } finally {
            setIsLoading(false);
          }
        };
        loadPdf();
      }
    }
  }, [isOpen, initialTitle, initialKeywords, initialPdfPath, initialDescription, mode]);

  if (!isOpen) return null;

  const handleSelectPDF = async () => {
    try {
      setIsLoading(true);
      const result = await selectPDFFile();
      if (result) {
        setPdfData(result.data);
        // 從路徑提取文件名
        const fileName = result.path ? result.path.split("/").pop() || "已選擇 PDF" : "已選擇 PDF";
        setPdfFileName(fileName);
      }
    } catch (error) {
      console.error("選擇 PDF 失敗:", error);
      alert("選擇 PDF 失敗，請重試");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateKeywords = async () => {
    if (!pdfData && !existingContext && !description.trim()) {
      alert("請先選擇 PDF 文件、輸入課程大綱或確保課程有筆記內容");
      return;
    }

    setIsGeneratingKeywords(true);
    try {
      let text = "";

      if (contextTab === 'pdf' && pdfData) {
        // 1. 優先使用 PDF 文本
        text = await pdfService.extractText(pdfData);
        if (!text || text.trim().length === 0) {
          throw new Error("無法從 PDF 中提取文本");
        }
      } else if (contextTab === 'text' && description.trim()) {
        // 2. 使用課程大綱
        text = description;
      } else if (existingContext) {
        // 3. 使用現有筆記內容
        text = existingContext;
      }

      if (!text) {
        throw new Error("沒有可用的文本內容用於生成關鍵詞");
      }

      // 4. 使用 Ollama 生成關鍵詞
      console.log('[CourseCreationDialog] Generating keywords from text length:', text.length);
      const extractedKeywords = await ollamaService.extractKeywords(text);
      console.log('[CourseCreationDialog] Extracted keywords:', extractedKeywords);

      if (extractedKeywords.length > 0) {
        // 合併現有關鍵詞
        const currentKeywords = keywords ? keywords.split(',').map(k => k.trim()).filter(k => k) : [];
        const newKeywords = [...new Set([...currentKeywords, ...extractedKeywords])];
        console.log('[CourseCreationDialog] New keywords list:', newKeywords);
        setKeywords(newKeywords.join(', '));
      } else {
        console.warn('[CourseCreationDialog] No keywords extracted');
        alert("未能生成關鍵詞，請檢查 Ollama 服務是否正常");
      }
    } catch (error) {
      console.error("生成關鍵詞失敗:", error);
      alert(`生成關鍵詞失敗: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsGeneratingKeywords(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      alert("請輸入課程標題");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(title.trim(), keywords.trim(), pdfData || undefined, description.trim());

      // 重置表單 (雖然 useEffect 會處理，但為了安全起見)
      if (mode === 'create') {
        setTitle("");
        setKeywords("");
        setPdfData(null);
        setPdfFileName("");
        setDescription("");
      }
    } catch (error) {
      console.error("提交失敗:", error);
      alert("保存失敗，請重試");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    // 僅在創建模式下清空，編輯模式下保留狀態直到下次打開重置
    if (mode === 'create') {
      setTitle("");
      setKeywords("");
      setPdfData(null);
      setPdfFileName("");
      setDescription("");
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        {/* 標題欄 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-semibold">{mode === 'create' ? '創建新課程' : '編輯課程'}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 表單內容 */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              課程標題 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：機器學習基礎 - 第1課"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { isComposingRef.current = false; }}
              onKeyDown={(e) => {
                // 防止中文輸入法組字時的 ENTER 鍵觸發提交
                // 1. 檢查 isComposingRef (手動狀態)
                // 2. 檢查 e.nativeEvent.isComposing (原生狀態)
                // 3. 檢查 keyCode 229 (IME 處理中)
                if (e.key === "Enter" &&
                  !isComposingRef.current &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229 &&
                  title.trim()) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              領域關鍵詞 (可選，可手動編輯)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="例如：React, TypeScript, API (用逗號分隔)"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={handleGenerateKeywords}
                disabled={(!pdfData && !existingContext && !description.trim()) || isGeneratingKeywords}
                className="px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="從 PDF 或課程大綱生成關鍵詞 (需 Ollama)"
              >
                {isGeneratingKeywords ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Cpu className="w-4 h-4" />
                )}
                <span className="text-sm whitespace-nowrap">AI 生成</span>
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              提供關鍵詞有助於提高專有名詞的轉錄準確度
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              課程資料 (用於生成關鍵詞)
            </label>

            {/* 標籤頁切換 */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-3">
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${contextTab === 'pdf'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                onClick={() => setContextTab('pdf')}
              >
                PDF 文件
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${contextTab === 'text'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                onClick={() => setContextTab('text')}
              >
                課程大綱
              </button>
            </div>

            {contextTab === 'pdf' ? (
              <div className="space-y-2">
                <button
                  onClick={handleSelectPDF}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors disabled:opacity-50 bg-gray-50 dark:bg-gray-800/50"
                >
                  <FileText className="w-6 h-6 text-gray-400" />
                  <span className="text-gray-600 dark:text-gray-300">
                    {isLoading ? "加載中..." : pdfFileName || "點擊選擇 PDF 文件"}
                  </span>
                </button>
                {pdfFileName && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                    已選擇: {pdfFileName}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="在此輸入課程大綱、教學計劃或任何相關文本內容..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[120px] resize-none"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  輸入的文本將用於幫助 AI 更好地理解課程內容並生成關鍵詞
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 操作按鈕 */}
        <div className="flex gap-3 p-4 border-t border-gray-200 dark:border-gray-700 sticky bottom-0 bg-white dark:bg-slate-800">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || isLoading || isSubmitting}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>處理中...</span>
              </>
            ) : (
              mode === 'create' ? '創建課程' : '保存更改'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

