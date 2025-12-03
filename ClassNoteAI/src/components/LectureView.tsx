import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Pause, Square, FolderOpen } from "lucide-react";
import { RecordingStatus } from "../types";
import PDFViewer from "./PDFViewer";
import { selectPDFFile } from "../services/fileService";
import DragDropZone from "./DragDropZone";
import { AudioRecorder } from "../services/audioRecorder";
import SubtitleDisplay from "./SubtitleDisplay";
import { transcriptionService } from "../services/transcriptionService";
import { loadModel, checkModelFile } from "../services/whisperService";
import { extractKeywordsFromPDF } from "../utils/pdfKeywordExtractor";

export default function LectureView() {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [volume, setVolume] = useState(0);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  
  // 音頻錄製器實例
  const audioRecorderRef = useRef<AudioRecorder | null>(null);

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

  // 檢查並加載模型
  useEffect(() => {
    const checkAndLoadModel = async () => {
      try {
        const exists = await checkModelFile('base');
        if (exists && !modelLoaded) {
          console.log('[LectureView] 模型文件存在，開始加載...');
          await loadModel('base');
          setModelLoaded(true);
          console.log('[LectureView] 模型加載成功');
        }
      } catch (error) {
        console.error('[LectureView] 模型檢查/加載失敗:', error);
      }
    };

    checkAndLoadModel();
  }, [modelLoaded]);

  const handleFileDrop = async (file: File) => {
    console.log("=== 文件拖放處理 ===");
    console.log("文件信息:", {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: new Date(file.lastModified).toISOString(),
    });
    
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

      // 清除之前的字幕
      transcriptionService.clear();

      // 啟動轉錄服務
      transcriptionService.start();

      await audioRecorderRef.current.start();
      setRecordingStatus("recording");
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

  const handleStopRecording = async () => {
    try {
      if (!audioRecorderRef.current) {
        console.error('[LectureView] 音頻錄製器未初始化');
        return;
      }

      await audioRecorderRef.current.stop();
      setRecordingStatus("stopped");
      setVolume(0);

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
        <div className="w-96 flex flex-col border-l border-gray-200 dark:border-gray-700">
          {/* 字幕顯示區域 */}
          <div className="flex-1 p-4 border-b border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
            <h2 className="text-lg font-semibold mb-4">即時字幕</h2>
            <SubtitleDisplay 
              maxLines={5}
              fontSize={16}
              position="bottom"
            />
          </div>

          {/* AI 助教面板 */}
          <div className="h-64 p-4 flex flex-col bg-white dark:bg-slate-800">
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

