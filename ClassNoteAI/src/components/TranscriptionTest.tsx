/**
 * 轉錄功能測試組件
 * 用於測試 Whisper 轉錄功能
 */

import { useState, useRef, useEffect } from 'react';
import { AudioRecorder, type AudioChunk } from '../services/audioRecorder';
import { transcribeAudio, loadModel, checkModelFile, type TranscriptionResult } from '../services/whisperService';

export default function TranscriptionTest() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string>('');
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelStatus, setModelStatus] = useState<'checking' | 'not_found' | 'found' | 'loading' | 'loaded'>('checking');
  const [recordedAudio, setRecordedAudio] = useState<Int16Array | null>(null);
  const [sampleRate, setSampleRate] = useState<number>(16000);
  const [initialPrompt, setInitialPrompt] = useState<string>('ClassNote AI, Tauri, React, TypeScript, transcription, lecture');
  
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const recordedChunksRef = useRef<Int16Array[]>([]);

  // 檢查模型狀態
  useEffect(() => {
    checkModel();
  }, []);

  const checkModel = async () => {
    try {
      setModelStatus('checking');
      const exists = await checkModelFile('base');
      if (exists) {
        setModelStatus('found');
      } else {
        setModelStatus('not_found');
      }
    } catch (error) {
      console.error('檢查模型失敗:', error);
      setModelStatus('not_found');
    }
  };

  const handleLoadModel = async () => {
    try {
      setModelStatus('loading');
      setError('');
      await loadModel('base');
      setModelLoaded(true);
      setModelStatus('loaded');
    } catch (error) {
      setModelStatus('found');
      setError(`模型加載失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleStartRecording = async () => {
    try {
      setError('');
      setTranscriptionResult(null);
      recordedChunksRef.current = [];

      const recorder = new AudioRecorder({
        sampleRate: 48000, // 錄製時使用 48kHz
        channelCount: 1,
      });

      recorder.onChunk((chunk: AudioChunk) => {
        // 收集音頻塊（已經是 16kHz, 16-bit, Mono）
        recordedChunksRef.current.push(chunk.data);
      });

      recorder.onStatusChange((status) => {
        console.log('[測試] 錄音狀態:', status);
        if (status === 'recording') {
          setIsRecording(true);
        } else if (status === 'stopped') {
          setIsRecording(false);
        }
      });

      recorder.onError((err: Error) => {
        console.error('[測試] 錄音錯誤:', err);
        setError(`錄音錯誤: ${err.message}`);
        setIsRecording(false);
      });

      await recorder.start();
      audioRecorderRef.current = recorder;
    } catch (error) {
      console.error('[測試] 開始錄音失敗:', error);
      setError(`開始錄音失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleStopRecording = async () => {
    try {
      if (audioRecorderRef.current) {
        await audioRecorderRef.current.stop();
        audioRecorderRef.current.destroy();
        audioRecorderRef.current = null;

        // 合併所有音頻塊
        const totalLength = recordedChunksRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
        const mergedAudio = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of recordedChunksRef.current) {
          mergedAudio.set(chunk, offset);
          offset += chunk.length;
        }

        setRecordedAudio(mergedAudio);
        setSampleRate(16000); // AudioRecorder 已經轉換為 16kHz
      }
    } catch (error) {
      console.error('[測試] 停止錄音失敗:', error);
      setError(`停止錄音失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleTranscribe = async () => {
    if (!recordedAudio || recordedAudio.length === 0) {
      setError('請先錄製音頻');
      return;
    }

    if (!modelLoaded && modelStatus !== 'loaded') {
      setError('請先加載模型');
      return;
    }

    try {
      setIsTranscribing(true);
      setError('');
      setTranscriptionResult(null);

      console.log('[測試] 開始轉錄，音頻長度:', recordedAudio.length, '樣本，採樣率:', sampleRate, 'Hz');
      console.log('[測試] 音頻時長:', (recordedAudio.length / sampleRate).toFixed(2), '秒');
      console.log('[測試] 初始提示:', initialPrompt || '(無)');

      const result = await transcribeAudio(
        recordedAudio,
        sampleRate,
        initialPrompt || undefined
      );

      console.log('[測試] 轉錄結果:', result);
      setTranscriptionResult(result);
    } catch (error) {
      console.error('[測試] 轉錄失敗:', error);
      setError(`轉錄失敗: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleClear = () => {
    setTranscriptionResult(null);
    setRecordedAudio(null);
    recordedChunksRef.current = [];
    setError('');
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          轉錄功能測試
        </h1>

        {/* 模型狀態 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            模型狀態
          </h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${
                modelStatus === 'loaded' ? 'text-green-500' :
                modelStatus === 'found' ? 'text-blue-500' :
                modelStatus === 'loading' ? 'text-yellow-500' :
                'text-gray-500'
              }`}>
                {modelStatus === 'checking' && '檢查中...'}
                {modelStatus === 'not_found' && '模型文件不存在'}
                {modelStatus === 'found' && '模型文件已找到'}
                {modelStatus === 'loading' && '加載中...'}
                {modelStatus === 'loaded' && '✅ 模型已加載'}
              </span>
            </div>
            {modelStatus === 'found' && !modelLoaded && (
              <button
                onClick={handleLoadModel}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
              >
                加載模型
              </button>
            )}
            {modelStatus === 'loading' && (
              <div className="text-sm text-yellow-500">加載中...</div>
            )}
          </div>
        </div>

        {/* 初始提示設置 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            初始提示（可選）
          </h2>
          <input
            type="text"
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            placeholder="輸入專有名詞或術語，用逗號分隔"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            提示：輸入專有名詞可以幫助提高識別準確度，例如 "ClassNote AI, Tauri, React"
          </p>
        </div>

        {/* 錄音控制 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
            錄音控制
          </h2>
          <div className="flex gap-4 items-center">
            {!isRecording ? (
              <button
                onClick={handleStartRecording}
                className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors font-medium"
              >
                🎤 開始錄音
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors font-medium"
              >
                ⏹️ 停止錄音
              </button>
            )}
            {recordedAudio && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                已錄製: {(recordedAudio.length / sampleRate).toFixed(2)} 秒
              </div>
            )}
          </div>
        </div>

        {/* 轉錄控制 */}
        {recordedAudio && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              轉錄控制
            </h2>
            <div className="flex gap-4">
              <button
                onClick={handleTranscribe}
                disabled={isTranscribing || !modelLoaded}
                className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isTranscribing ? '轉錄中...' : '🚀 開始轉錄'}
              </button>
              <button
                onClick={handleClear}
                className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors font-medium"
              >
                清除
              </button>
            </div>
          </div>
        )}

        {/* 錯誤顯示 */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* 轉錄結果 */}
        {transcriptionResult && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              轉錄結果
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  完整文本
                </h3>
                <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">
                  <p className="text-gray-900 dark:text-white whitespace-pre-wrap">
                    {transcriptionResult.text || '(無文本)'}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  統計信息
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">片段數量:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">
                      {transcriptionResult.segments.length}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">轉錄耗時:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">
                      {transcriptionResult.duration_ms}ms
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">檢測語言:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">
                      {transcriptionResult.language || '未知'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">文本長度:</span>
                    <span className="ml-2 font-medium text-gray-900 dark:text-white">
                      {transcriptionResult.text.length} 字符
                    </span>
                  </div>
                </div>
              </div>

              {transcriptionResult.segments.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    時間片段
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {transcriptionResult.segments.map((segment, index) => (
                      <div
                        key={index}
                        className="p-3 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700 text-sm"
                      >
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          [{segment.start_ms}ms - {segment.end_ms}ms]
                        </div>
                        <div className="text-gray-900 dark:text-white">
                          {segment.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

