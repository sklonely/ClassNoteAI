/**
 * 字幕顯示組件
 * 顯示實時轉錄的字幕
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { subtitleService } from '../services/subtitleService';
import type { SubtitleState } from '../types/subtitle';

interface SubtitleDisplayProps {
  maxLines?: number;
  fontSize?: number;
  position?: 'top' | 'bottom' | 'center';
  onSeek?: (timestamp: number) => void;
  /** Current media playhead in seconds (video.currentTime). When
   *  present, the component highlights + auto-scrolls to the
   *  segment currently under playback. */
  currentTime?: number;
  /** Absolute epoch ms of lecture start. We subtract it from each
   *  segment's startTime (also epoch ms) to get the relative
   *  playback offset. Without this, segments from live recording
   *  (which store Date.now() at capture) would display as absolute
   *  2026-ish timestamps instead of "02:13". */
  baseTime?: number;
}

export default function SubtitleDisplay({ onSeek, currentTime, baseTime }: SubtitleDisplayProps) {
  const [subtitleState, setSubtitleState] = useState<SubtitleState>(subtitleService.getState());
  const scrollRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    // 訂閱字幕服務
    const unsubscribe = subtitleService.subscribe((state) => {
      setSubtitleState(state);
    });

    return unsubscribe;
  }, []);

  /** Active segment index — the LATEST segment whose relative start
   *  time is ≤ currentTime. Binary-searchable but linear is fine for
   *  the ~1000 segments a lecture has. Recomputed only when currentTime
   *  or segment list changes. */
  const activeIdx = useMemo(() => {
    if (currentTime === undefined || currentTime === null) return -1;
    const segs = subtitleState.segments;
    if (segs.length === 0) return -1;
    // Lecture-relative seconds for each segment.
    const refEpochMs =
      baseTime !== undefined
        ? baseTime
        : segs[0]
          ? segs[0].startTime
          : 0;
    let last = -1;
    for (let i = 0; i < segs.length; i++) {
      const relSec = Math.max(0, (segs[i].startTime - refEpochMs) / 1000);
      if (relSec <= currentTime) last = i;
      else break; // segments are monotonic-increasing in time
    }
    return last;
  }, [currentTime, subtitleState.segments, baseTime]);

  // While recording (no currentTime), pin view to the latest segment.
  useEffect(() => {
    if (scrollRef.current && currentTime === undefined) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [subtitleState.segments.length, currentTime]);

  // During playback, keep the active segment in view. Scrolls the
  // active row into the middle of the container so the user always
  // sees ~3 segments of context. We avoid smooth scroll during rapid
  // seek (the browser naturally coalesces instant-scroll updates).
  useEffect(() => {
    if (activeIdx < 0) return;
    const seg = subtitleState.segments[activeIdx];
    if (!seg) return;
    const el = segmentRefs.current.get(seg.id);
    const container = scrollRef.current;
    if (!el || !container) return;
    const elTop = el.offsetTop;
    const elHeight = el.offsetHeight;
    const containerHeight = container.clientHeight;
    // Only scroll if the active row is outside the visible window,
    // and aim for "roughly centred" rather than pinned to the top.
    const desiredTop = elTop - containerHeight / 2 + elHeight / 2;
    const currentScroll = container.scrollTop;
    if (Math.abs(desiredTop - currentScroll) > containerHeight / 3) {
      container.scrollTo({ top: Math.max(0, desiredTop), behavior: 'smooth' });
    }
  }, [activeIdx, subtitleState.segments]);

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
          subtitleState.segments.map((segment, index) => {
            // Relative playback offset. `baseTime` is the epoch ms of
            // the lecture start; `segment.startTime` is the epoch ms
            // recorded/saved at capture time. Subtracting gives the
            // offset inside the media file. Fallback: when no baseTime
            // is provided (e.g. live recording without a stored
            // created_at), anchor to the first segment.
            const refEpochMs =
              baseTime !== undefined
                ? baseTime
                : subtitleState.segments[0]
                  ? subtitleState.segments[0].startTime
                  : segment.startTime;
            const relativeMs = Math.max(0, segment.startTime - refEpochMs);

            // MM:SS.cc — centiseconds precision. Whisper.cpp's native
            // timing grid is 10 ms (centiseconds) so two digits after
            // the decimal fully reflect what the model actually knows;
            // showing a third millisecond digit would just be `0` all
            // the time. Live-recording segments store Date.now() so
            // they can theoretically be ms-precise, but rounding down
            // to centiseconds for display keeps the format uniform
            // between both paths.
            const minutes = Math.floor(relativeMs / 60000);
            const seconds = Math.floor((relativeMs % 60000) / 1000);
            const centis = Math.floor((relativeMs % 1000) / 10);
            const timeString =
                `${minutes.toString().padStart(2, '0')}:` +
                `${seconds.toString().padStart(2, '0')}.` +
                `${centis.toString().padStart(2, '0')}`;

            const isActive = index === activeIdx;

            return (
              <div
                key={segment.id}
                ref={(el) => {
                  if (el) segmentRefs.current.set(segment.id, el);
                  else segmentRefs.current.delete(segment.id);
                }}
                onClick={() => onSeek?.(relativeMs / 1000)}
                className={`p-3 rounded-lg shadow-sm border relative z-10 cursor-pointer transition-colors
                    ${isActive
                      ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 ring-2 ring-blue-400 dark:ring-blue-600'
                      : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20'}
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
                  <p className="text-base font-medium text-gray-900 dark:text-white wrap-break-word">
                    {segment.displayText || segment.roughText || segment.text}
                  </p>
                  {segment.displayTranslation && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 wrap-break-word">
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
                    <span className="text-xs text-green-600 dark:text-green-400">
                      ✓ 已精修
                      {segment.fineUsage && (
                        <span className="ml-1.5 text-gray-400 dark:text-gray-500 font-normal">
                          · in {segment.fineUsage.inputTokens} · out {segment.fineUsage.outputTokens}
                        </span>
                      )}
                    </span>
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
              <p className="text-base text-gray-600 dark:text-gray-300 italic wrap-break-word">
                {subtitleState.currentText}
              </p>
              {subtitleState.currentTranslation && (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic wrap-break-word">
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

