// 課程相關類型
export interface Lecture {
  id: string;
  title: string;
  date: string; // ISO 8601
  duration: number; // 秒
  pdf_path?: string;
  status: "recording" | "completed";
  subtitles: Subtitle[];
  notes?: Note;
}

// 字幕類型
export interface Subtitle {
  id: string;
  timestamp: number; // 秒
  text_en: string;
  text_zh?: string;
  type: "rough" | "fine";
  confidence?: number;
}

// 筆記類型
export interface Note {
  lecture_id: string;
  title: string;
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
}

// 錄音狀態
export type RecordingStatus = "idle" | "recording" | "paused" | "stopped";

