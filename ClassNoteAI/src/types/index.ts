// 科目類型
export interface Course {
  id: string;
  user_id: string; // Add user_id
  title: string;
  description?: string;
  keywords?: string; // 全域關鍵詞
  syllabus_info?: SyllabusInfo; // 結構化課程大綱
  created_at: string;
  updated_at?: string;
  is_deleted?: boolean; // Soft Delete
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
  audio_path?: string;
  audio_hash?: string;
  /** v0.6.0: path to an imported video file (under {app_data}/videos/).
   *  When present, Notes Review mode renders a <video> player and the
   *  transcript + RAG index are derived from the video's audio track. */
  video_path?: string;
  subtitles?: Subtitle[]; // 可選，用於前端顯示，數據庫中不存儲
  notes?: Note; // 可選，用於前端顯示，數據庫中不存儲
  is_deleted?: boolean; // Soft Delete
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
  is_deleted?: boolean; // Soft Delete
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
    // Spoken language of the lecture. `auto` lets Whisper detect per
    // session; once detected we pass it to M2M100. Introduced in v0.5.1.
    source_language?: 'auto' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'zh-TW' | 'zh-CN';
    target_language?: string; // 目標語言 (e.g. "zh-TW", "en")。v0.5.1 預設 zh-TW。
  };
  /**
   * @deprecated Remnant of the pre-v0.5.0 Ollama-backed setup. Only the
   * optional `host` field is still consulted (by `ocrService.ts` — if a
   * user has a local deepseek-ocr running, RAG indexing will use it).
   * All other sub-fields are unread. Kept in the type so existing users'
   * persisted JSON doesn't produce `unknown-key` warnings on migration.
   */
  ollama?: {
    host?: string;
    model?: string;
    enabled?: boolean;
    aiModels?: {
      embedding?: string;
      light?: string;
      standard?: string;
      heavy?: string;
    };
  };
  /**
   * OCR / slide-text-extraction strategy for RAG indexing (v0.5.2+).
   *
   *   - `auto`  — prefer remote (cloud LLM vision), fall back to local
   *               Ollama deepseek-ocr, fall back to pdfjs text layer
   *   - `remote`— cloud LLM vision only; pdfjs if no LLM configured
   *   - `local` — Ollama deepseek-ocr only; pdfjs if Ollama not running
   *   - `off`   — skip OCR entirely, always use pdfjs text layer
   *
   * Default is `auto`. Users who care about privacy can switch to
   * `local` or `off` from Settings → 資料管理. Users who don't have
   * Ollama (~99% of installs) get remote OCR for the first time in
   * v0.5.2; previously they silently got pdfjs-only.
   */
  ocr?: {
    mode?: 'auto' | 'remote' | 'local' | 'off';
  };
  /**
   * AI 助教 (RAG chat) window mode.
   *   - `floating` — draggable/resizable panel overlaying the notes
   *                  view. Default for backwards-compat with v0.5.x.
   *   - `sidebar`  — docked column to the right of the notes, no
   *                  drag/resize, follows app layout.
   *   - `detached` — separate OS window. Useful on multi-monitor setups
   *                  so the chat stays visible while the lecture video
   *                  plays full-screen.
   */
  aiTutor?: {
    displayMode?: 'floating' | 'sidebar' | 'detached';
  };
  sync?: {
    username: string;
    deviceId?: string;
    deviceName?: string;
    autoSync: boolean;
    lastSyncTime?: string;
  };
}

// 錄音狀態
export type RecordingStatus = "idle" | "recording" | "paused" | "stopped";

