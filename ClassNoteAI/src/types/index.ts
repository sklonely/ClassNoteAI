// 科目類型
export interface Course {
  id: string;
  title: string;
  description?: string;
  keywords?: string; // 全域關鍵詞
  syllabus_info?: SyllabusInfo; // 結構化課程大綱
  created_at: string;
  updated_at: string;
}

export interface SyllabusInfo {
  topic?: string; // 課程主題
  time?: string; // 上課時間
  instructor?: string; // 講師
  office_hours?: string; // 辦公時間
  teaching_assistants?: string; // 助教
  location?: string; // 地點
  grading?: { item: string; percentage: string }[]; // 評分標準 (結構化)
  schedule?: string[]; // 每週進度
}

// 課程相關類型
export interface Lecture {
  id: string;
  course_id: string; // 關聯的科目 ID
  title: string;
  date: string; // ISO 8601
  duration: number; // 秒
  pdf_path?: string;
  keywords?: string; // 領域關鍵詞
  status: "recording" | "completed";
  created_at: string; // ISO 8601 - 必需字段
  updated_at: string; // ISO 8601 - 必需字段
  subtitles?: Subtitle[]; // 可選，用於前端顯示，數據庫中不存儲
  notes?: Note; // 可選，用於前端顯示，數據庫中不存儲
}

// 字幕類型（用於數據庫存儲）
export interface Subtitle {
  id: string;
  lecture_id: string; // 必需字段
  timestamp: number; // 秒
  text_en: string;
  text_zh?: string;
  type: "rough" | "fine"; // 對應後端的 subtitle_type 字段
  confidence?: number;
  created_at: string; // ISO 8601 - 必需字段
}

// 筆記類型
export interface Note {
  lecture_id: string;
  title: string;
  summary?: string; // 課程總結
  sections: Section[];
  qa_records: QARecord[];
  generated_at: string; // ISO 8601
}

export interface Section {
  title: string;
  content: string;
  timestamp: number;
}

export interface QARecord {
  question: string;
  answer: string;
  timestamp: number;
}

// 應用設置類型
export interface AppSettings {
  server: {
    url: string;
    port: number;
    enabled: boolean;
  };
  audio: {
    device_id?: string;
    sample_rate: number;
    chunk_duration: number;
  };
  subtitle: {
    font_size: number;
    font_color: string;
    background_opacity: number;
    position: "bottom" | "top" | "floating";
    display_mode: "en" | "zh" | "both";
  };
  theme: "light" | "dark";
  models?: {
    whisper?: string; // Whisper 模型類型，例如 'base', 'small', 'medium'
    translation?: string; // 翻譯模型名稱，例如 'opus-mt-en-zh-onnx'
  };
  translation?: {
    provider?: 'local' | 'google'; // 翻譯提供商：本地 ONNX 或 Google API
    google_api_key?: string; // Google Cloud Translation API 密鑰
  };
  ollama?: {
    host: string;
    model: string;
    enabled: boolean;
  };
}

// 錄音狀態
export type RecordingStatus = "idle" | "recording" | "paused" | "stopped";

