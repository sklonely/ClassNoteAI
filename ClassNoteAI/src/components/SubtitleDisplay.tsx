/**
 * 字幕顯示組件
 * 顯示實時轉錄的字幕
 */

import { useState, useEffect, useRef } from 'react';
import { subtitleService } from '../services/subtitleService';
import type { SubtitleState } from '../types/subtitle';

interface SubtitleDisplayProps {
  maxLines?: number;
  fontSize?: number;
  position?: 'top' | 'bottom' | 'center';
}

export default function SubtitleDisplay(_props: SubtitleDisplayProps) {
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [subtitleState.segments]);

  return (
    <div className="relative h-full flex flex-col">
      {/* 字幕歷史列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-2 p-4"
      >
        {subtitleState.segments.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <p>字幕將顯示在這裡</p>
            <p className="text-sm mt-2">開始錄音後，轉錄結果會實時顯示</p>
          </div>
        ) : (
          subtitleState.segments.map((segment) => {
            const startTime = new Date(segment.startTime);
            const timeString = `${startTime.getMinutes().toString().padStart(2, '0')}:${startTime.getSeconds().toString().padStart(2, '0')}`;

            return (
              <div
                key={segment.id}
                className="p-3 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
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
                  <p className="text-base font-medium text-gray-900 dark:text-white">
                    {segment.displayText || segment.roughText || segment.text}
                  </p>
                  {segment.displayTranslation && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
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
      </div>

      {/* 狀態指示器 */}
      {subtitleState.isTranscribing && (
        <div className="absolute top-2 right-2 px-2 py-1 bg-blue-500 text-white text-xs rounded">
          轉錄中...
        </div>
      )}
    </div>
  );
}

