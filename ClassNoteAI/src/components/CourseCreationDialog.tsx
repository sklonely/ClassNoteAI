import { useState, useEffect, useRef } from "react";
import { X, BookOpen, FileText, Cpu, Loader2 } from "lucide-react";
import { selectPDFFile } from "../services/fileService";
import { pdfService } from "../services/pdfService";
import { extractKeywords as llmExtractKeywords } from "../services/llm";

interface CourseCreationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (title: string, keywords: string, pdfData?: ArrayBuffer, description?: string, shouldClose?: boolean) => Promise<string | void | undefined>;
  initialTitle?: string;
  initialKeywords?: string;
  initialPdfPath?: string;
  initialDescription?: string;
  existingContext?: string;
  mode?: 'create' | 'edit';
  /**
   * What entity this dialog edits. When set to 'lecture', the dialog
   * swaps labels to lecture-scoped copy and hides the PDF/outline
   * section (that's handled separately by the lecture view's own
   * Select PDF button). Default 'course' preserves pre-existing
   * behavior for the course list / edit flows.
   */
  entity?: 'course' | 'lecture';
}

export default function CourseCreationDialog({
  onClose,
  onSubmit,
  initialTitle = "",
  initialKeywords = "",
  initialDescription = "",
  existingContext,
  mode = 'create',
  isOpen,
  entity = 'course',
}: CourseCreationDialogProps) {
  const isLecture = entity === 'lecture';
  const labels = {
    titleField: isLecture ? '課堂標題' : '課程標題',
    heading: isLecture
      ? (mode === 'create' ? '新增課堂' : '編輯課堂')
      : (mode === 'create' ? '創建新課程' : '編輯課程'),
    submit: isLecture
      ? (mode === 'create' ? '建立課堂' : '保存更改')
      : (mode === 'create' ? '創建課程' : '保存更改'),
    titleEmptyAlert: isLecture ? '請輸入課堂標題' : '請輸入課程標題',
  };
  if (!isOpen) return null;

  // ... existing state ...
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

  // Sync prompts to state when they change (e.g. when opening edit mode)
  useEffect(() => {
    setTitle(initialTitle);
    setKeywords(initialKeywords);
    setDescription(initialDescription);
    setPdfData(null); // Reset PDF on open/mode change? Or should we keep?
    // If editing, we might want to keep existing context if passed, but usually we just reset for new course.
    // For edit mode, we sync.
  }, [initialTitle, initialKeywords, initialDescription, mode, isOpen]);

  // Reset internal state when dialog opens/closes significantly
  useEffect(() => {
    if (isOpen) {
      // Reset additional state if needed
    }
  }, [isOpen]);

  const handleSelectPDF = async () => {
    setIsLoading(true);
    try {
      const selected = await selectPDFFile();
      if (selected) {
        const name = selected.path.split(/[/\\]/).pop() || "document.pdf";
        setPdfFileName(name);
        setPdfData(selected.data);
      }
    } catch (error) {
      console.error("Failed to select PDF:", error);
      alert("無法讀取 PDF 文件");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateKeywords = async () => {
    // 1. Validate Input
    if (!title.trim()) {
      alert(labels.titleEmptyAlert);
      return;
    }
    if (!pdfData && !existingContext && !description.trim()) {
      alert("請先選擇 PDF 文件、輸入課程大綱或確保課程有筆記內容");
      return;
    }

    setIsGeneratingKeywords(true);
    try {
      // Extract the text we'll feed into keyword extraction. Earlier
      // this was gated on `contextTab`: if the user was looking at the
      // PDF tab with no new PDF chosen, we wouldn't fall back to the
      // description they'd already typed (or that was loaded from the
      // course's saved 課程大綱). Users hit "沒有可用的文本內容" even
      // on courses whose description panel was clearly populated. Now
      // we walk every source in priority order regardless of tab:
      //   1. Newly-picked PDF (most specific / freshest)
      //   2. Description textarea (what user typed OR initialDescription)
      //   3. existingContext prop (e.g. aggregated lecture notes passed in)
      let text = '';
      if (pdfData) {
        text = await pdfService.extractText(pdfData);
      }
      if (!text?.trim() && description.trim()) {
        text = description;
      }
      if (!text?.trim() && existingContext) {
        text = existingContext;
      }
      if (!text?.trim()) throw new Error('沒有可用的文本內容');

      // 3. Auto-save current field state so unsaved edits don't vanish
      //    when the background keyword-extraction task runs. In create
      //    mode, onSubmit returns a fresh course id; in edit mode the
      //    caller just returns void since the course already exists.
      //    Previously we required a string id and failed edit-mode
      //    outright -- the extracted keywords are merged back into
      //    state regardless, so the id is only needed for the create
      //    path's draft-tracking.
      const courseId = await onSubmit(title.trim(), keywords.trim(), pdfData || undefined, description.trim(), false);
      if (mode === 'create' && (!courseId || typeof courseId !== 'string')) {
        throw new Error("無法保存課程草稿，無法啟動後台任務");
      }

      // 4. Extract keywords via the user's configured LLM provider.
      //    Surface failures to the user instead of logging to console
      //    only -- users hit rate-limits (HTTP 429) and saw nothing
      //    but a stopped spinner with no explanation.
      llmExtractKeywords(text)
        .then((extracted) => {
          setKeywords((prev) => {
            const current = prev ? prev.split(',').map((k) => k.trim()).filter(Boolean) : [];
            const merged = [...new Set([...current, ...extracted])];
            return merged.join(', ');
          });
        })
        .catch((err) => {
          console.error('Keyword extraction failed:', err);
          const msg = err instanceof Error ? err.message : String(err);
          // Trim noisy HTTP body to the first informative line.
          const short = msg.length > 160 ? msg.slice(0, 160) + '…' : msg;
          alert(`AI 生成關鍵詞失敗：${short}`);
        })
        .finally(() => setIsGeneratingKeywords(false));

      alert('關鍵詞生成已在後台啟動！完成後會自動填入。');

    } catch (error) {
      console.error("生成關鍵詞失敗:", error);
      alert(`生成關鍵詞失敗: ${error instanceof Error ? error.message : String(error)}`);
      setIsGeneratingKeywords(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      alert(labels.titleEmptyAlert);
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
            <h2 className="text-xl font-semibold">{labels.heading}</h2>
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
              {labels.titleField} <span className="text-red-500">*</span>
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
              {!isLecture && (
                <button
                  onClick={handleGenerateKeywords}
                  disabled={(!pdfData && !existingContext && !description.trim()) || isGeneratingKeywords}
                  className="px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  title="從 PDF 或課程大綱生成關鍵詞"
                >
                  {isGeneratingKeywords ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Cpu className="w-4 h-4" />
                  )}
                  <span className="text-sm whitespace-nowrap">AI 生成</span>
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              提供關鍵詞有助於提高專有名詞的轉錄準確度
            </p>
          </div>

          {/* Course-materials section: PDF + syllabus outline. Only
              shown when editing a course (entity === 'course'). For
              lecture editing, the lecture already has its own Select
              PDF button in the main view, and the course's keywords
              generation is not applicable here -- so we hide this
              entire section to keep the lecture-edit dialog minimal. */}
          {!isLecture && (
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
          )}
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
              labels.submit
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

