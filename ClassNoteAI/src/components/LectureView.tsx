import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Pause, Square, FolderOpen, BookOpen, Save, History } from "lucide-react";
import { RecordingStatus, Lecture } from "../types";
import PDFViewer from "./PDFViewer";
import { selectPDFFile } from "../services/fileService";
import DragDropZone from "./DragDropZone";
import { AudioRecorder } from "../services/audioRecorder";
import SubtitleDisplay from "./SubtitleDisplay";
import { transcriptionService } from "../services/transcriptionService";
import { loadModel, checkModelFile } from "../services/whisperService";
import { loadTranslationModelByName, getAvailableTranslationModels } from "../services/translationModelService";
import { storageService } from "../services/storageService";
import { extractKeywordsFromPDF } from "../utils/pdfKeywordExtractor";
import CourseCreationDialog from "./CourseCreationDialog";
import { subtitleService } from "../services/subtitleService";
import { useNavigate } from "react-router-dom";

export default function LectureView() {
  const navigate = useNavigate();
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [volume, setVolume] = useState(0);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [translationModelLoaded, setTranslationModelLoaded] = useState(false);

  // 課程管理狀態
  const [currentLecture, setCurrentLecture] = useState<Lecture | null>(null);
  const [showCourseDialog, setShowCourseDialog] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // 音頻錄製器實例
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  // 追蹤模型是否已經嘗試加載過（防止重複加載）
  const modelsLoadingRef = useRef(false);

  const handleSelectPDF = async () => {
    const result = await selectPDFFile();
    if (result) {
      // 使用讀取的文件數據，而不是路徑
      setPdfData(result.data);
      setPdfPath(null); // 清除路徑，使用 pdfData
    }
  };

  const handleTextExtract = (text: string) => {
    // 從 PDF 文本提取關鍵詞並設置為初始提示
    if (text && text.trim().length > 0) {
      const initialPrompt = extractKeywordsFromPDF(text);
      transcriptionService.setInitialPrompt(initialPrompt);
      console.log('[LectureView] 更新初始提示:', initialPrompt);
    }
  };

  // 檢查是否有需要加載的課程（從 NotesView 跳轉過來）
  useEffect(() => {
    const loadLectureId = sessionStorage.getItem('loadLectureId');
    if (loadLectureId) {
      sessionStorage.removeItem('loadLectureId');
      handleLoadCourse(loadLectureId);
    }
  }, []); // 只在組件掛載時執行一次

  // 檢查並自動加載模型（只在組件掛載時執行一次）
  useEffect(() => {
    // 防止重複執行
    if (modelsLoadingRef.current) {
      return;
    }

    const checkAndLoadModels = async () => {
      // 設置標記，防止重複執行
      modelsLoadingRef.current = true;

      try {
        // 1. 加載 Whisper 模型
        const settings = await storageService.getAppSettings();
        const whisperModel = (settings?.models?.whisper || 'base') as 'tiny' | 'base' | 'small' | 'medium' | 'large'; // 默認使用 base

        const whisperExists = await checkModelFile(whisperModel);
        if (whisperExists && !modelLoaded) {
          console.log('[LectureView] Whisper 模型文件存在，開始加載...', whisperModel);
          try {
            await loadModel(whisperModel);
            setModelLoaded(true);
            console.log('[LectureView] Whisper 模型加載成功');
          } catch (error) {
            console.error('[LectureView] Whisper 模型加載失敗:', error);
            modelsLoadingRef.current = false; // 失敗時重置標記，允許重試
          }
        } else if (!whisperExists) {
          console.log('[LectureView] Whisper 模型文件不存在:', whisperModel);
        }

        // 2. 自動加載翻譯模型（僅在選擇本地翻譯時需要）
        const translationProvider = settings?.translation?.provider || 'local';
        const translationModel = settings?.models?.translation;

        // 只有在選擇本地翻譯時才需要加載模型
        if (translationProvider === 'local' && translationModel && !translationModelLoaded) {
          console.log('[LectureView] 檢查翻譯模型:', translationModel);
          try {
            const availableModels = await getAvailableTranslationModels();
            if (availableModels.includes(translationModel)) {
              console.log('[LectureView] 翻譯模型文件存在，開始自動加載...', translationModel);
              await loadTranslationModelByName(translationModel);
              setTranslationModelLoaded(true);
              console.log('[LectureView] 翻譯模型自動加載成功');
            } else {
              console.log('[LectureView] 翻譯模型文件不存在:', translationModel);
            }
          } catch (error) {
            console.error('[LectureView] 翻譯模型自動加載失敗:', error);
            // 自動加載失敗不影響應用運行
          }
        } else if (translationProvider === 'google') {
          console.log('[LectureView] 使用 Google 翻譯，無需加載本地模型');
        } else if (!translationModel) {
          console.log('[LectureView] 未找到保存的翻譯模型選擇');
        }
      } catch (error) {
        console.error('[LectureView] 模型檢查/加載失敗:', error);
        modelsLoadingRef.current = false; // 失敗時重置標記，允許重試
      }
    };

    checkAndLoadModels();
  }, []); // 空依賴數組，只在組件掛載時執行一次

  const handleFileDrop = async (file: File) => {
    // 拖放診斷已禁用

    // 驗證文件類型
    const fileName = file.name.toLowerCase();
    const isValidPDF = fileName.endsWith('.pdf') || file.type === 'application/pdf' || file.type === '';

    if (!isValidPDF) {
      console.warn("不是 PDF 文件:", file.name, file.type);
      alert('請拖放 PDF 文件');
      return;
    }

    console.log("文件驗證通過，開始處理");

    // 在 Tauri 中，嘗試獲取文件路徑
    // 檢查是否有 path 屬性（Tauri 可能會提供）
    const filePath = (file as any).path;

    if (filePath && typeof filePath === 'string') {
      console.log("使用文件路徑:", filePath);
      // 如果 Tauri 提供了文件路徑，直接使用
      setPdfPath(filePath);
    } else {
      console.log("使用 FileReader 讀取文件");
      // 使用 FileReader 讀取文件並直接傳遞 ArrayBuffer
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          const arrayBuffer = event.target.result as ArrayBuffer;
          console.log("文件讀取成功，文件大小:", arrayBuffer.byteLength, "bytes");

          // 直接使用 ArrayBuffer，避免 blob URL 的問題
          setPdfData(arrayBuffer);
          setPdfPath(null); // 清除 filePath，使用 pdfData
        }
      };
      reader.onerror = (error) => {
        console.error("文件讀取失敗:", error);
        alert('文件讀取失敗，請重試');
      };
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentLoaded = Math.round((e.loaded / e.total) * 100);
          console.log(`文件讀取進度: ${percentLoaded}%`);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // 使用 ref 來追蹤模型加載狀態，避免閉包問題
  const modelLoadedRef = useRef(false);
  useEffect(() => {
    modelLoadedRef.current = modelLoaded;
  }, [modelLoaded]);

  // 初始化音頻錄製器
  useEffect(() => {
    const recorder = new AudioRecorder({
      sampleRate: 48000, // 初始採樣率，後續會轉換為 16kHz
      channelCount: 1, // Mono
    });

    // 設置狀態變化回調
    recorder.onStatusChange((status) => {
      const statusMap: Record<string, RecordingStatus> = {
        idle: 'idle',
        recording: 'recording',
        paused: 'paused',
        stopped: 'stopped',
        error: 'idle', // 錯誤時重置為 idle
      };
      setRecordingStatus(statusMap[status] || 'idle');
    });

    // 設置錯誤回調
    recorder.onError((error) => {
      console.error('[LectureView] 音頻錄製錯誤:', error);
      alert(`錄音錯誤: ${error.message}`);
    });

    // 設置音頻數據回調
    recorder.onChunk((chunk) => {
      // 計算音量（簡單的 RMS）
      const samples = chunk.data;
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const normalized = samples[i] / 32768;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      const volumeDb = 20 * Math.log10(rms + 0.0001); // 避免 log(0)
      const volumePercent = Math.max(0, Math.min(100, (volumeDb + 60) / 60 * 100)); // 映射到 0-100
      setVolume(volumePercent);

      // 如果模型已加載，將音頻塊添加到轉錄服務
      // 使用 ref 來獲取最新的模型加載狀態，避免閉包問題
      if (modelLoadedRef.current) {
        transcriptionService.addAudioChunk(chunk);
      }
    });

    audioRecorderRef.current = recorder;

    // 清理函數
    return () => {
      transcriptionService.stop();
      recorder.destroy();
    };
  }, []); // 只在組件掛載時初始化一次

  // 加載歷史課程
  const handleLoadCourse = async (lectureId: string) => {
    try {
      const lecture = await storageService.getLecture(lectureId);
      if (!lecture) {
        alert('課程不存在');
        return;
      }

      // 設置當前課程
      setCurrentLecture(lecture);

      // 設置轉錄服務的課程 ID
      transcriptionService.setLectureId(lecture.id);

      // 設置初始提示詞（包含關鍵詞）
      if (lecture.keywords) {
        transcriptionService.setInitialPrompt('', lecture.keywords);
        console.log('[LectureView] 設置課程關鍵詞:', lecture.keywords);
      }

      // 加載字幕
      const subtitles = await storageService.getSubtitles(lecture.id);
      console.log(`[LectureView] 加載到 ${subtitles.length} 條字幕`);

      if (subtitles.length > 0) {
        // 清除現有字幕
        subtitleService.clear();

        // 恢復字幕到顯示服務
        subtitles.forEach((sub) => {
          subtitleService.addSegment({
            id: sub.id, // 傳遞 ID
            roughText: sub.text_en,
            roughTranslation: sub.text_zh,
            displayText: sub.text_en,
            displayTranslation: sub.text_zh,
            startTime: sub.timestamp * 1000, // 轉換為毫秒
            endTime: (sub.timestamp + 5) * 1000, // 估算結束時間
            source: sub.type === 'fine' ? 'fine' : 'rough',
            translationSource: sub.text_zh ? (sub.type === 'fine' ? 'fine' : 'rough') : undefined,
            text: sub.text_en,
            translatedText: sub.text_zh,
          });
        });

        console.log('[LectureView] 恢復字幕完成');
      }

      // 如果有 PDF 路徑，嘗試加載（注意：PDF 數據無法從路徑恢復，需要用戶重新選擇）
      if (lecture.pdf_path) {
        setPdfPath(lecture.pdf_path);
        // 注意：PDF 數據無法從路徑恢復，因為我們存儲的是 ArrayBuffer
        // 用戶需要重新選擇 PDF 文件
        console.log('[LectureView] 課程有 PDF 路徑，但需要用戶重新選擇文件:', lecture.pdf_path);
      }

      console.log('[LectureView] 課程加載成功:', lecture.id);
    } catch (error) {
      console.error('[LectureView] 加載課程失敗:', error);
      alert(`加載課程失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 創建新課程
  const handleCreateCourse = async (title: string, keywords: string, pdfData?: ArrayBuffer) => {
    try {
      const now = new Date().toISOString();
      // 創建課程記錄（必須包含所有必需字段）
      const lecture: Lecture = {
        id: crypto.randomUUID(),
        course_id: '', // 獨立課程，無關聯科目
        title,
        date: now,
        duration: 0,
        pdf_path: pdfPath || undefined,
        status: "recording",
        created_at: now,
        updated_at: now,
        keywords: keywords || undefined,
        subtitles: [],
      };

      // 保存課程到數據庫
      await storageService.saveLecture(lecture);

      // 設置當前課程
      setCurrentLecture(lecture);

      // 設置轉錄服務的課程 ID
      transcriptionService.setLectureId(lecture.id);

      // 設置初始提示詞（包含關鍵詞）
      if (lecture.keywords) {
        transcriptionService.setInitialPrompt('', lecture.keywords);
        console.log('[LectureView] 設置課程關鍵詞:', lecture.keywords);
      }

      // 如果有 PDF 數據，設置到狀態
      if (pdfData) {
        setPdfData(pdfData);
      }

      console.log('[LectureView] 課程創建成功:', lecture.id);
      setShowCourseDialog(false);
    } catch (error) {
      console.error('[LectureView] 創建課程失敗:', error);
      alert(`創建課程失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleStartRecording = async () => {
    try {
      if (!audioRecorderRef.current) {
        console.error('[LectureView] 音頻錄製器未初始化');
        return;
      }

      // 檢查模型是否已加載
      if (!modelLoaded) {
        alert('請先在設置頁面加載 Whisper 模型');
        return;
      }

      // 檢查是否有當前課程，如果沒有則顯示創建對話框
      if (!currentLecture) {
        setShowCourseDialog(true);
        return;
      }

      // 清除之前的字幕
      transcriptionService.clear();

      // 設置轉錄服務的課程 ID
      transcriptionService.setLectureId(currentLecture.id);

      // 啟動轉錄服務
      transcriptionService.start();

      await audioRecorderRef.current.start();
      setRecordingStatus("recording");
      setRecordingStartTime(Date.now());
    } catch (error) {
      console.error('[LectureView] 開始錄製失敗:', error);
      if (error instanceof Error) {
        alert(`開始錄製失敗: ${error.message}`);
      }
      setRecordingStatus("idle");
      transcriptionService.stop();
    }
  };

  const handlePauseRecording = () => {
    try {
      if (!audioRecorderRef.current) {
        console.error('[LectureView] 音頻錄製器未初始化');
        return;
      }

      audioRecorderRef.current.pause();
      setRecordingStatus("paused");
    } catch (error) {
      console.error('[LectureView] 暫停錄製失敗:', error);
    }
  };

  const handleResumeRecording = async () => {
    try {
      if (!audioRecorderRef.current) {
        console.error('[LectureView] 音頻錄製器未初始化');
        return;
      }

      await audioRecorderRef.current.resume();
      setRecordingStatus("recording");
    } catch (error) {
      console.error('[LectureView] 恢復錄製失敗:', error);
    }
  };

  // 保存當前課程
  const handleSaveCourse = async () => {
    if (!currentLecture) {
      alert('沒有當前課程可保存');
      return;
    }

    try {
      setSaveStatus('saving');

      // 獲取所有字幕片段
      const segments = subtitleService.getSegments();

      // 計算錄音時長
      const duration = recordingStartTime
        ? Math.floor((Date.now() - recordingStartTime) / 1000)
        : 0;

      // 更新課程（必須包含所有必需字段）
      const updatedLecture: Lecture = {
        ...currentLecture,
        duration,
        status: recordingStatus === "recording" ? "recording" : "completed",
        pdf_path: pdfPath || currentLecture.pdf_path,
        updated_at: new Date().toISOString(), // 更新時間戳
        // subtitles 字段僅用於前端顯示，不需要包含在保存到數據庫的對象中
        // 字幕會單獨保存到 subtitles 表
      };

      // 保存課程到數據庫
      await storageService.saveLecture(updatedLecture);

      // 批量保存字幕
      if (segments.length > 0) {
        const now = new Date().toISOString();
        const subtitles = segments.map(seg => ({
          id: seg.id,
          lecture_id: currentLecture.id,
          timestamp: seg.startTime / 1000,
          text_en: seg.displayText || seg.roughText || '',
          text_zh: seg.displayTranslation || seg.roughTranslation || undefined,
          type: (seg.source === 'fine' ? 'fine' : 'rough') as 'rough' | 'fine',
          confidence: undefined,
          created_at: now, // 設置創建時間
        }));

        await storageService.saveSubtitles(subtitles);
      }

      setCurrentLecture(updatedLecture);
      setSaveStatus('success');
      console.log('[LectureView] 課程保存成功');

      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('[LectureView] 保存課程失敗:', error);
      setSaveStatus('error');
      alert(`保存課程失敗: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleStopRecording = async () => {
    try {
      if (!audioRecorderRef.current) {
        console.error('[LectureView] 音頻錄製器未初始化');
        return;
      }

      // 停止轉錄服務
      transcriptionService.stop();

      await audioRecorderRef.current.stop();
      setRecordingStatus("stopped");
      setVolume(0);

      // 自動保存課程
      if (currentLecture) {
        await handleSaveCourse();
      }

      // 測試用途：保存錄製的音頻
      try {
        const info = audioRecorderRef.current.getRecordingInfo();
        if (info) {
          console.log('[LectureView] 錄製信息:', info);
          await audioRecorderRef.current.saveAsWAV();
          console.log('[LectureView] 音頻文件已保存');
        }
      } catch (saveError) {
        console.error('[LectureView] 保存音頻文件失敗:', saveError);
      }
    } catch (error) {
      console.error('[LectureView] 停止錄製失敗:', error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* 課程創建對話框 */}
      <CourseCreationDialog
        isOpen={showCourseDialog}
        onClose={() => setShowCourseDialog(false)}
        onSubmit={handleCreateCourse}
      />

      {/* 主內容區域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF 查看器區域 */}
        <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700">
          {/* PDF 工具欄 */}
          {(pdfPath || pdfData) && (
            <div className="px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-md">
                  {pdfPath
                    ? (pdfPath.startsWith('blob:') ? '拖放的文件' : pdfPath.split("/").pop())
                    : '已選擇的 PDF 文件'}
                </span>
              </div>
              <button
                onClick={handleSelectPDF}
                className="px-3 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                更換文件
              </button>
            </div>
          )}

          {/* PDF 查看器 */}
          <DragDropZone
            onFileDrop={handleFileDrop}
            className="flex-1 overflow-hidden"
          >
            {pdfPath || pdfData ? (
              <PDFViewer filePath={pdfPath || undefined} pdfData={pdfData || undefined} onTextExtract={handleTextExtract} />
            ) : (
              <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
                <div className="text-center">
                  <FolderOpen size={64} className="mx-auto mb-4 text-gray-400 dark:text-gray-600" />
                  <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">
                    尚未選擇 PDF 文件
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
                    拖放 PDF 文件到此處，或點擊按鈕選擇文件
                  </p>
                  <button
                    onClick={handleSelectPDF}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    選擇 PDF 文件
                  </button>
                </div>
              </div>
            )}
          </DragDropZone>
        </div>

        {/* 右側面板：字幕和 AI 助教 */}
        <div className="w-96 flex flex-col border-l border-gray-200 dark:border-gray-700 relative" style={{ zIndex: 10 }}>
          {/* 字幕顯示區域 - 使用 flex-1 但設置最小高度為 0 確保正確計算 */}
          <div className="flex-1 min-h-0 p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col relative" style={{ zIndex: 10, overflow: 'hidden' }}>
            <h2 className="text-lg font-semibold mb-4 flex-shrink-0">即時字幕</h2>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SubtitleDisplay
                maxLines={5}
                fontSize={16}
                position="bottom"
              />
            </div>
          </div>

          {/* AI 助教面板 - 固定高度 */}
          <div className="h-64 flex-shrink-0 p-4 flex flex-col bg-white dark:bg-slate-800">
            <h2 className="text-lg font-semibold mb-3">AI 助教</h2>
            <div className="flex-1 overflow-auto mb-3 space-y-2">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                對話歷史將顯示在這裡...
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="輸入問題..."
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
              />
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                發送
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 底部控制欄 */}
      <div className="px-6 py-4 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-gray-700">
        {/* 課程信息欄 */}
        <div className="mb-3 flex items-center justify-between gap-3">
          {currentLecture ? (
            <div className="flex-1 flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {currentLecture.title}
                </span>
                {recordingStatus === "recording" && (
                  <span className="px-2 py-1 text-xs bg-red-500 text-white rounded">
                    錄音中
                  </span>
                )}
              </div>
              <button
                onClick={handleSaveCourse}
                disabled={saveStatus === 'saving'}
                className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                <Save size={16} />
                {saveStatus === 'saving' ? '保存中...' : saveStatus === 'success' ? '已保存' : '保存課程'}
              </button>
              <button
                onClick={async () => {
                  if (recordingStatus === 'recording') {
                    if (!confirm('正在錄音中，確定要結束課程嗎？錄音將停止。')) {
                      return;
                    }
                    await handleStopRecording();
                  }

                  // 清理服務狀態
                  transcriptionService.clear();
                  transcriptionService.setLectureId(null);
                  subtitleService.clear();

                  navigate('/notes');
                }}
                className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
              >
                <History size={16} />
                結束課程
              </button>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                尚未創建課程
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate('/notes')}
                  className="flex items-center gap-2 px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                >
                  <History size={16} />
                  歷史課程
                </button>
                <button
                  onClick={() => setShowCourseDialog(true)}
                  className="flex items-center gap-2 px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                >
                  <BookOpen size={16} />
                  新建課程
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {recordingStatus === "idle" ? (
              <button
                onClick={handleStartRecording}
                className="flex items-center gap-2 px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                <Mic size={20} />
                開始錄音
              </button>
            ) : recordingStatus === "recording" ? (
              <>
                <button
                  onClick={handlePauseRecording}
                  className="flex items-center gap-2 px-6 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
                >
                  <Pause size={20} />
                  暫停
                </button>
                <button
                  onClick={handleStopRecording}
                  className="flex items-center gap-2 px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  <Square size={20} />
                  停止
                </button>
              </>
            ) : recordingStatus === "paused" ? (
              <>
                <button
                  onClick={handleResumeRecording}
                  className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  <Mic size={20} />
                  恢復
                </button>
                <button
                  onClick={handleStopRecording}
                  className="flex items-center gap-2 px-6 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  <Square size={20} />
                  停止
                </button>
              </>
            ) : (
              <button
                onClick={handleStartRecording}
                className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <Mic size={20} />
                繼續錄音
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <MicOff size={20} className="text-gray-400" />
            <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${volume}%` }}
              />
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-400">音量</span>
          </div>
        </div>
      </div>
    </div>
  );
}

