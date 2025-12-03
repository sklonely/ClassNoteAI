/**
 * 字幕相關類型定義
 */

export interface SubtitleSegment {
  id: string;
  
  // 粗層（本地）
  roughText: string;           // 粗轉錄文本（英文）
  roughTranslation?: string;   // 粗翻譯文本（中文）
  roughConfidence?: number;     // 粗轉錄置信度（0-1）
  
  // 精層（遠程，可選）
  fineText?: string;            // 精轉錄文本（英文）
  fineTranslation?: string;     // 精翻譯文本（中文）
  fineConfidence?: number;       // 精轉錄置信度（0-1）
  
  // 顯示邏輯
  displayText: string;          // 當前顯示的英文（roughText 或 fineText）
  displayTranslation?: string;  // 當前顯示的中文（roughTranslation 或 fineTranslation）
  
  // 元數據
  startTime: number; // 毫秒
  endTime: number; // 毫秒
  language?: string; // 檢測到的語言
  source: 'rough' | 'fine';     // 當前顯示的來源
  translationSource?: 'rough' | 'fine'; // 當前翻譯的來源
  
  // 精層狀態
  fineStatus?: 'pending' | 'transcribing' | 'translating' | 'completed' | 'failed';
  
  // 向後兼容（保留舊字段）
  text?: string; // 已廢棄，使用 displayText
  translatedText?: string; // 已廢棄，使用 displayTranslation
  confidence?: number; // 已廢棄，使用 roughConfidence 或 fineConfidence
}

export interface SubtitleState {
  segments: SubtitleSegment[];
  currentText: string; // 當前顯示的文本（英文）
  currentTranslation?: string; // 當前顯示的翻譯（中文）
  isRecording: boolean;
  isTranscribing: boolean;
  lastUpdateTime: number;
}

export type SubtitleDisplayMode = 'current' | 'history' | 'both';

export interface SubtitleDisplayConfig {
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  position: 'top' | 'bottom' | 'center';
  maxLines: number;
  fadeDuration: number; // 毫秒
}

