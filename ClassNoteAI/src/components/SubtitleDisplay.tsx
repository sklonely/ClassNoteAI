/**
 * 字幕顯示組件
 * 顯示實時轉錄的字幕
 */

import { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { subtitleService } from '../services/subtitleService';
import type { SubtitleState } from '../types/subtitle';

interface SubtitleDisplayProps {
  maxLines?: number;
  fontSize?: number;
  position?: 'top' | 'bottom' | 'center';
  onSeek?: (timestamp: number) => void;
  currentTime?: number;
  baseTime?: number;
}

export default function SubtitleDisplay({ onSeek, currentTime, baseTime }: SubtitleDisplayProps) {
  const [subtitleState, setSubtitleState] = useState<SubtitleState>(subtitleService.getState());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 訂閱字幕服務
    const unsubscribe = subtitleService.subscribe((state) => {
      setSubtitleState(state);
    });

    return unsubscribe;
  }, []);

  // 自動滾動到底部
  useEffect(() => {
    if (scrollRef.current && !currentTime) { // Only auto-scroll if not reviewing (currentTime implies review/playback) or if strict follow mode (TODO)
      // For now, let's keep auto-scroll behavior basic or maybe disable it if reviewing history?
      // Actually, if we are in review mode, we might want auto-scroll TO the highlighted segment.
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [subtitleState.segments, currentTime]); // Re-run when segments change. CurrentTime might be too frequent?

  // Auto-scroll to current time segment
  useEffect(() => {
    if (currentTime && scrollRef.current) {
      /* TODO: Implement auto-scroll logic
      const activeSegment = subtitleState.segments.find((s, i) => {
        const next = subtitleState.segments[i + 1];
        const start = new Date(s.startTime).getTime();
        // ... implementation needed
        return false;
      });
      */
      // Implementing scroll to active element inside render might be easier by ref
    }
  }, [currentTime]);

  return (
    <div className="relative h-full flex flex-col overflow-hidden" style={{ zIndex: 10 }}>
      {/* 字幕歷史列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-2 p-4 relative"
        style={{ zIndex: 10, minHeight: 0 }}
      >
        {subtitleState.segments.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <p>字幕將顯示在這裡</p>
            <p className="text-sm mt-2">開始錄音後，轉錄結果會實時顯示</p>
          </div>
        ) : (
          subtitleState.segments.map((segment, _index) => {
            // Calculate relative time
            // If baseTime is provided, use it. Otherwise fallback to first segment's time or created_at logic
            const segmentTime = new Date(segment.startTime).getTime();
            const referenceTime = baseTime || (subtitleState.segments[0] ? new Date(subtitleState.segments[0].startTime).getTime() : segmentTime);
            const relativeMs = Math.max(0, segmentTime - referenceTime);

            const minutes = Math.floor(relativeMs / 60000);
            const seconds = Math.floor((relativeMs % 60000) / 1000);
            const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            // Calculate if active
            // Note: We need relative time for audio sync. 
            // segment.startTime is usually absolute timestamp of recording start.
            // We need to know the lecture start time to calculate offset?
            // OR, if audio file is pure recording, its 0:00 matches lecture start?
            // Usually yes.
            // But segment.startTime is "2023-..."
            // We need to store 'relativeStartTime' or invoke a helper.
            // For now, let's assume strict timestamp matching if we had absolute time, 
            // but for AudioPlayer 'currentTime' is seconds from 0.
            // We need to map Audio 'currentTime' (sec) to Segment 'startTime' (Date).
            // This requires knowing the base timestamp of the recording.
            // Let's defer exact highlighting logic and just add the onClick for now.

            return (
              <div
                key={segment.id}
                onClick={() => onSeek?.(relativeMs / 1000)}
                className={`p-3 rounded-lg shadow-sm border relative z-10 cursor-pointer transition-colors
                    ${currentTime ? 'hover:bg-blue-50 dark:hover:bg-blue-900/20' : ''}
                    bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700
                `}
                style={{ zIndex: 10 }}
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {timeString}
                  </span>
                  {segment.language && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {segment.language}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-base font-medium text-gray-900 dark:text-white break-words">
                    {segment.displayText || segment.roughText || segment.text}
                  </p>
                  {segment.displayTranslation && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 break-words">
                      {segment.displayTranslation}
                    </p>
                  )}
                  {segment.fineStatus && segment.fineStatus !== 'completed' && (
                    <div className="text-xs text-blue-500 dark:text-blue-400 mt-1">
                      {segment.fineStatus === 'pending' && '精修中...'}
                      {segment.fineStatus === 'transcribing' && '精轉錄中...'}
                      {segment.fineStatus === 'translating' && '精翻譯中...'}
                      {segment.fineStatus === 'failed' && '精修失敗'}
                    </div>
                  )}
                  {segment.source === 'fine' && (
                    <span className="text-xs text-green-600 dark:text-green-400">✓ 已精修</span>
                  )}
                </div>
              </div>
            );
          })
        )}


        {/* 實時轉錄（不穩定文本） */}
        {subtitleState.currentText && (
          <div className="p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-gray-700 border-dashed relative z-10 animate-pulse">
            <div className="flex items-start justify-between mb-1">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                正在聆聽...
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-base text-gray-600 dark:text-gray-300 italic break-words">
                {subtitleState.currentText}
              </p>
              {subtitleState.currentTranslation && (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic break-words">
                  {subtitleState.currentTranslation}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 狀態指示器 & 控制按鈕 */}
      <div className="absolute top-2 right-2 flex items-center gap-2 z-20">
        {subtitleState.segments.length > 0 && (
          <button
            onClick={async () => {
              try {
                const { confirm } = await import('@tauri-apps/plugin-dialog');
                const confirmed = await confirm(
                  '確定要清除所有字幕記錄嗎？此操作僅清除當前顯示，不會刪除數據庫記錄。',
                  {
                    title: '清除字幕',
                    kind: 'warning',
                    okLabel: '清除',
                    cancelLabel: '取消'
                  }
                );

                if (confirmed) {
                  subtitleService.clear();
                }
              } catch (error) {
                console.error('Dialog error:', error);
                // Fallback if plugin fails
                if (window.confirm('確定要清除所有字幕記錄嗎？')) {
                  subtitleService.clear();
                }
              }
            }}
            className="p-1.5 bg-white/80 dark:bg-slate-700/80 backdrop-blur-sm rounded-md shadow-sm border border-gray-200 dark:border-gray-600 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
            title="清除記錄"
          >
            <Trash2 size={14} />
          </button>
        )}

        {subtitleState.isTranscribing && (
          <div className="px-2 py-1 bg-blue-500 text-white text-xs rounded shadow-sm animate-pulse">
            轉錄中...
          </div>
        )}
      </div>
    </div >
  );
}

