import { useState } from "react";
import { Mic, MicOff, Pause, Square, FolderOpen } from "lucide-react";
import { RecordingStatus } from "../types";
import PDFViewer from "./PDFViewer";
import { selectPDFFile } from "../services/fileService";

export default function LectureView() {
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [volume] = useState(0);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [, setCurrentPageText] = useState<string>("");

  const handleSelectPDF = async () => {
    const path = await selectPDFFile();
    if (path) {
      setPdfPath(path);
    }
  };

  const handleTextExtract = (text: string) => {
    setCurrentPageText(text);
    // 這裡可以將文本用於 AI 助教的上下文
  };

  const handleStartRecording = () => {
    setRecordingStatus("recording");
    // TODO: 實現錄音邏輯
  };

  const handlePauseRecording = () => {
    setRecordingStatus("paused");
    // TODO: 實現暫停邏輯
  };

  const handleStopRecording = () => {
    setRecordingStatus("stopped");
    // TODO: 實現停止邏輯
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* 主內容區域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF 查看器區域 */}
        <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700">
          {/* PDF 工具欄 */}
          {pdfPath && (
            <div className="px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-md">
                  {pdfPath.split("/").pop()}
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
          <div className="flex-1 overflow-hidden">
            {pdfPath ? (
              <PDFViewer filePath={pdfPath} onTextExtract={handleTextExtract} />
            ) : (
              <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
                <div className="text-center">
                  <FolderOpen size={64} className="mx-auto mb-4 text-gray-400 dark:text-gray-600" />
                  <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">尚未選擇 PDF 文件</p>
                  <button
                    onClick={handleSelectPDF}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    選擇 PDF 文件
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右側面板：字幕和 AI 助教 */}
        <div className="w-96 flex flex-col border-l border-gray-200 dark:border-gray-700">
          {/* 字幕顯示區域 */}
          <div className="flex-1 p-4 border-b border-gray-200 dark:border-gray-700 overflow-auto">
            <h2 className="text-lg font-semibold mb-4">即時字幕</h2>
            <div className="space-y-3">
              <div className="p-3 bg-white dark:bg-slate-800 rounded-lg">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">00:15</div>
                <div className="text-base font-medium mb-1">Hello, welcome to the class.</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">你好，歡迎來到課堂。</div>
              </div>
              <div className="p-3 bg-white dark:bg-slate-800 rounded-lg">
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">00:20</div>
                <div className="text-base font-medium mb-1">Today we will learn about...</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">今天我們將學習...</div>
              </div>
            </div>
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

