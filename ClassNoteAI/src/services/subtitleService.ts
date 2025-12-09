/**
 * 字幕服務
 * 管理字幕數據和狀態
 */

import { SubtitleSegment, SubtitleState } from '../types/subtitle';

class SubtitleService {
  private segments: SubtitleSegment[] = [];
  private currentText: string = '';
  private currentTranslation?: string = '';
  private listeners: Set<(state: SubtitleState) => void> = new Set();
  private lectureId: string | null = null; // 用於資料庫同步

  /**
   * 設置 lectureId 以啟用資料庫同步
   */
  setLectureId(id: string | null): void {
    this.lectureId = id;
    console.log('[SubtitleService] 設置 lectureId:', id);
  }

  /**
   * 獲取當前 lectureId
   */
  getLectureId(): string | null {
    return this.lectureId;
  }

  /**
   * 添加字幕片段
   */
  addSegment(segment: Omit<SubtitleSegment, 'id'> & { id?: string }): void {
    // 確保必要字段存在
    const newSegment: SubtitleSegment = {
      ...segment,
      id: segment.id || `subtitle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      // 設置顯示文本（優先使用 displayText，否則使用 roughText）
      displayText: segment.displayText || segment.roughText || segment.text || '',
      displayTranslation: segment.displayTranslation || segment.roughTranslation || segment.translatedText,
      // 設置來源（默認為 rough）
      source: segment.source || 'rough',
      translationSource: segment.translationSource || (segment.roughTranslation ? 'rough' : undefined),
      // 向後兼容
      text: segment.displayText || segment.roughText || segment.text,
      translatedText: segment.displayTranslation || segment.roughTranslation || segment.translatedText,
    };

    this.segments.push(newSegment);
    // 注意：不要在這裡設置 currentText/currentTranslation
    // currentText 只用於顯示「正在轉錄中」的臨時文本，提交後應該清空
    this.currentText = '';
    this.currentTranslation = undefined;
    this.notifyListeners();
  }

  /**
   * 更新字幕片段
   */
  updateSegment(segmentId: string, updates: Partial<SubtitleSegment>): void {
    const index = this.segments.findIndex(s => s.id === segmentId);
    if (index === -1) {
      console.warn(`[SubtitleService] 找不到字幕片段: ${segmentId}`);
      return;
    }

    const segment = this.segments[index];

    // 更新字段
    const updatedSegment: SubtitleSegment = {
      ...segment,
      ...updates,
      // 自動更新顯示文本
      displayText: updates.fineText || updates.displayText || segment.displayText || segment.roughText,
      displayTranslation: updates.fineTranslation || updates.displayTranslation || segment.displayTranslation || segment.roughTranslation,
      // 更新來源
      source: updates.fineText ? 'fine' : (updates.source || segment.source),
      translationSource: updates.fineTranslation ? 'fine' : (updates.translationSource || segment.translationSource),
      // 向後兼容
      text: updates.fineText || updates.displayText || segment.displayText,
      translatedText: updates.fineTranslation || updates.displayTranslation || segment.displayTranslation,
    };

    this.segments[index] = updatedSegment;

    // 如果是當前顯示的片段，更新當前文本
    if (segment.id === this.segments[this.segments.length - 1]?.id) {
      this.currentText = updatedSegment.displayText;
    }

    this.notifyListeners();
  }

  /**
   * 刪除字幕片段
   */
  async deleteSegment(segmentId: string): Promise<void> {
    const index = this.segments.findIndex(s => s.id === segmentId);
    if (index === -1) {
      console.warn(`[SubtitleService] 找不到字幕片段: ${segmentId}`);
      return;
    }

    // 從記憶體移除
    this.segments.splice(index, 1);
    this.notifyListeners();

    // 同步到資料庫
    if (this.lectureId) {
      try {
        const { storageService } = await import('./storageService');
        await storageService.deleteSubtitle(segmentId);
        console.log('[SubtitleService] 已從資料庫刪除字幕:', segmentId);
      } catch (error) {
        console.error('[SubtitleService] 刪除字幕失敗:', error);
      }
    }
  }

  /**
   * 更新當前字幕文本
   */
  updateCurrentText(text: string, translation?: string): void {
    this.currentText = text;
    this.currentTranslation = translation;
    this.notifyListeners();
  }

  /**
   * 獲取當前狀態
   */
  getState(): SubtitleState {
    return {
      segments: [...this.segments],
      currentText: this.currentText,
      currentTranslation: this.currentTranslation,
      isRecording: false, // 由外部設置
      isTranscribing: false, // 由外部設置
      lastUpdateTime: Date.now(),
    };
  }

  /**
   * 獲取當前字幕文本
   */
  getCurrentText(): string {
    return this.currentText;
  }

  /**
   * 獲取所有片段
   */
  getSegments(): SubtitleSegment[] {
    return [...this.segments];
  }

  /**
   * 清除所有字幕
   */
  clear(): void {
    this.segments = [];
    this.currentText = '';
    this.currentTranslation = undefined;
    this.lectureId = null;
    this.notifyListeners();
  }

  /**
   * 訂閱狀態變化
   */
  subscribe(listener: (state: SubtitleState) => void): () => void {
    this.listeners.add(listener);
    // 立即通知一次當前狀態
    listener(this.getState());

    // 返回取消訂閱函數
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 通知所有監聽器
   */
  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[SubtitleService] 監聽器錯誤:', error);
      }
    });
  }

  /**
   * 設置錄音狀態
   */
  setRecording(_isRecording: boolean): void {
    // 這裡可以擴展狀態管理
    this.notifyListeners();
  }

  /**
   * 設置轉錄狀態
   */
  setTranscribing(_isTranscribing: boolean): void {
    // 這裡可以擴展狀態管理
    this.notifyListeners();
  }
}

// 導出單例
export const subtitleService = new SubtitleService();

