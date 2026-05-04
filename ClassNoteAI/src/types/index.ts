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
  speaker_role?: "teacher" | "student" | "unknown";
  speaker_id?: string;
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
  /**
   * Representative sentences for this section, extracted by
   * `extract_section_highlights` (centroid-nearest sentences from the
   * section's subtitle body). Optional so legacy notes saved before
   * v0.6.2 still load. When present, the UI renders these as bullets
   * above a collapsed `content` block.
   */
  bullets?: string[];
  /**
   * Range of slide / PDF pages covered by this section, taken from
   * the `page_number` fields of the subtitles it was built from.
   * `null` when the section has no PDF pages (audio-only lecture or
   * pre-PDF-alignment note).
   */
  page_range?: { min: number; max: number } | null;
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
  recording?: {
    consentAcknowledgedAt?: string;
    consentReminderVersion?: number;
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
    /**
     * 翻譯後端：
     *   - `local`  — 本地 CTranslate2 (M2M100-418M)，CPU 即可，技術詞較弱
     *   - `gemma`  — TranslateGemma 4B Q4_K_M LLM via llama-server sidecar，
     *                需要 GPU 與 llama-server 在 8080 port 執行；繁體中文品質
     *                顯著優於 M2M100，CS 技術詞無誤譯（"stack" → 「堆疊」）
     *   - `google` — Google API (官方/非官方)
     */
    provider?: 'local' | 'gemma' | 'google';
    google_api_key?: string; // Google Cloud Translation API 密鑰（僅 google）
    /**
     * llama-server URL（僅 gemma 使用）。預設 `http://127.0.0.1:8080`。
     * 留空使用預設值。
     */
    gemma_endpoint?: string;
    // Spoken language of the lecture. `auto` lets Whisper detect per
    // session; once detected we pass it to M2M100. Introduced in v0.5.1.
    source_language?: 'auto' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'zh-TW' | 'zh-CN';
    target_language?: string; // 目標語言 (e.g. "zh-TW", "en")。v0.5.1 預設 zh-TW。
  };
  /**
   * OCR / slide-text-extraction strategy for RAG indexing (v0.5.2+).
   *
   *   - `auto`  — prefer remote (cloud LLM vision), fall back to pdfjs
   *               text layer
   *   - `remote`— cloud LLM vision only; pdfjs if no LLM configured
   *   - `off`   — skip OCR entirely, always use pdfjs text layer
   *
   * Default is `auto`. Users who care about privacy can switch to
   * `off` from Settings → 資料管理. Historical `local` values from the
   * retired local-OCR path are normalized to `off` on load so upgrades
   * never silently switch a privacy-sensitive user to cloud OCR.
   */
  ocr?: {
    mode?: 'auto' | 'remote' | 'off';
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
  /**
   * Layout for lectures that have both an imported video and an
   * attached PDF/PPT.
   *   - `split` — vertical resizable split on the left panel: video
   *               on top, slides on bottom. Both visible at once.
   *   - `pip`   — slides take the main left panel, video floats as a
   *               draggable / resizable overlay like a Zoom PiP. Less
   *               visual footprint, closer to the "slides are the main
   *               thing, glance at the prof occasionally" workflow.
   * Defaults to `split` (see settings default-fill logic).
   */
  lectureLayout?: {
    videoPdfMode?: 'split' | 'pip';
  };
  /**
   * Experimental / opt-in defaults for the video-import pipeline.
   * These used to live only in the ImportModal's per-import toggles;
   * promoting them to settings lets the user set a preferred default
   * once instead of re-picking for every import. The modal still
   * honours per-import overrides when the user touches the control,
   * so nothing regresses for "I want to change THIS one run".
   */
  experimental?: {
    /** Default model preset for new video imports: `fast` (ggml-base,
     *  ~5× realtime CPU) or `standard` (user's main model, slower but
     *  more accurate). The ImportModal quality selector pre-fills from
     *  this. */
    importSpeed?: 'fast' | 'standard';
    /** Default value of the "AI 精修字幕" checkbox in ImportModal.
     *  Off by default because a 70-min lecture is ~130 k tokens of
     *  LLM usage; users who have plentiful tokens can flip it on once
     *  and forget it. */
    importAiRefine?: boolean;
    /** Refinement intensity. Controls how aggressively the LLM
     *  rewrites the rough CT2 translation:
     *    - `off`    : no LLM call (same as `importAiRefine: false`)
     *    - `light`  : mid-tier model (GPT-4o-mini / Haiku / Gemini
     *                 Flash), batched per 5-min section, grammar +
     *                 term fixes only. ~14 calls / 70-min lecture,
     *                 ~15k tokens. Fits free-tier Gemini easily.
     *    - `deep`   : upper-mid model (Mistral Large 2 / Claude
     *                 Sonnet / Llama 3.3 70B), batched per section,
     *                 full rewrite with cross-subtitle consistency.
     *                 ~14 calls, ~50k tokens. Shows a cost estimate
     *                 in the UI before running.
     *  The old `importAiRefine: true` maps to `deep`. */
    refineIntensity?: 'off' | 'light' | 'deep';
    /** Which LLM provider to prefer for refinement. `auto` picks
     *  the first configured provider in this order: user's
     *  ChatGPT Plus OAuth (already signed in? use it — the app
     *  reuses Codex CLI's OAuth client) → GitHub Models /
     *  Copilot OAuth → Gemini free tier → Groq free tier → Mistral Experiment
     *  → user-provided raw key. The OAuth paths come first
     *  because they're what most of our users already have signed
     *  in (Copilot Pro = $10/mo, ChatGPT Plus = $20/mo are both
     *  common). Pinning a specific value bypasses the chain. */
    refineProvider?:
        | 'auto'
        | 'chatgpt-oauth'
        | 'github-models'
        | 'gemini'
        | 'groq'
        | 'mistral'
        | 'openrouter'
        | 'user-key';
    /** Whisper GPU backend preference. `auto` picks the first available
     *  at runtime (Phase 2+); the other values let power users pin a
     *  specific backend. Ignored in Phase 1 builds where no GPU features
     *  are compiled in. */
    asrBackend?: 'auto' | 'cuda' | 'metal' | 'vulkan' | 'cpu';
  };
  /**
   * Release channel preference for the updater.
   *   - `stable` — only stable tags (vX.Y.Z). Uses the Tauri updater
   *                plugin's default endpoint from tauri.conf.json,
   *                which maps to GitHub's /releases/latest/ alias and
   *                skips prereleases.
   *   - `beta`   — stable + `*-beta*` prereleases. Uses GitHub API to
   *                find the newest matching release; download bypasses
   *                the plugin (runtime endpoint override not supported)
   *                and opens the platform installer for the user to
   *                click through.
   *   - `alpha`  — stable + any prerelease (alpha, beta, rc). Same
   *                GitHub-API + manual-download path as beta.
   * Default is `stable` when unset. The manual path shows the same
   * progress UI as the stable plugin flow; the only visible difference
   * is that the installer window opens instead of auto-restart.
   */
  updates?: {
    channel?: 'stable' | 'beta' | 'alpha';
  };
}

// 錄音狀態
export type RecordingStatus = "idle" | "recording" | "paused" | "stopped";
