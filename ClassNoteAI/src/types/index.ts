// 科目類型
export interface Course {
  id: string;
  user_id: string; // Add user_id
  title: string;
  description?: string;
  keywords?: string; // 全域關鍵詞
  syllabus_info?: SyllabusInfo; // 結構化課程大綱
  /**
   * Canvas LMS 課程 ID（純數字字串，如 `"2042524"`，**不含** `course_` 前綴）。
   * Pairing wizard 寫入這欄位後，後續抓 RSS 不再做模糊匹配，所有 Canvas
   * 來源的 announcements / calendar events 一律靠這個 ID 路由。
   * 沒配對過的課程此欄為 undefined。
   */
  canvas_course_id?: string;
  created_at: string;
  updated_at?: string;
  is_deleted?: boolean; // Soft Delete
}

/**
 * 教學人員 — 老師或助教共用 schema。
 * v0.7.0 新增；舊 syllabus_info 仍可只用 instructor / teaching_assistants 字串。
 */
export interface TeachingPerson {
  name: string;
  email?: string;
  /** 個人 office hours（可跟 syllabus 的 instructor/ta_office_hours 重複，個別覆寫優先）。 */
  office_hours?: string;
}

export interface SyllabusInfo {
  topic?: string; // 課程主題（一句話）
  /** 2-3 句話的課程簡介 (AI 生成)。 */
  overview?: string;
  /**
   * 上課時間。為了 weekParse / Home 排堂能消費，請用 24 小時
   * HH:MM-HH:MM 格式 + 中文週幾或英文 Mon/Tue 縮寫。
   * 例如：「週一、週三 14:00-15:50」、"Mon, Wed 14:00-15:50"。
   */
  time?: string;
  location?: string; // 地點
  /** 課程開始日期 (ISO YYYY-MM-DD)。AI 抓得到再填，不亂猜；給前端自動產生 Lecture 1/2/3 用。 */
  start_date?: string;
  /** 課程結束日期 (ISO YYYY-MM-DD)。 */
  end_date?: string;

  /** Legacy: 講師姓名字串。新欄位 instructor_person 優先。 */
  instructor?: string;
  instructor_email?: string;
  /** 老師的 office hours（與 TA 分開）。 */
  instructor_office_hours?: string;

  /** Legacy: 老師的辦公時間（v0.6 之前的欄位）。新版用 instructor_office_hours。 */
  office_hours?: string;

  /** Legacy: 助教名稱（逗號 / 頓號 / "/" 分隔字串）。 */
  teaching_assistants?: string;
  /** v0.7：結構化助教清單，每位含名稱 / Email / 個人 office hours。 */
  teaching_assistant_list?: TeachingPerson[];
  /** TA 共用 office hours（沒填的 TA 沿用這個）。 */
  ta_office_hours?: string;

  /**
   * Canvas 公告 RSS feed URL（**per-course**）。
   *
   * 注意：Canvas 的 Calendar RSS 是 **per-user 全域**（一個 URL 包含
   * 所有課程的事件 / 截止日），那條存在 `AppSettings.integrations.canvas.calendar_rss`。
   * 本欄只放這門課自己的 announcements feed。
   */
  canvas_announcements_rss?: string;

  grading?: { item: string; percentage: string }[]; // 評分標準 (結構化)

  /**
   * 每堂課的主題列表 (Lecture 1, Lecture 2, …)。
   * v0.6 命名為「每週進度」，v0.7 起改稱「Lecture」— 因為一週可能多堂或無堂。
   * 欄位名為相容 DB 維持 schedule。
   */
  schedule?: string[];
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
  /**
   * v0.7.0 Phase 7 Sprint 2 (V14) — extended with `'stopping'` and
   * `'failed'` so the stop pipeline can publish intermediate / error
   * states without falsely flipping back to `'recording'` or claiming
   * `'completed'` when finalize fell over.
   *
   *   - `recording` — actively capturing (singleton owns mic + ASR)
   *   - `stopping`  — finalize 6-step pipeline in progress (sync drain
   *                   + audio finalize + subtitles save phase)
   *   - `completed` — pipeline finished cleanly; review is safe to open
   *   - `failed`    — pipeline crashed mid-way; recording was best-
   *                   effort preserved but summary / index may need a
   *                   manual retry. ReviewPage shows a hero banner.
   *
   * Existing `'recording'` and `'completed'` checks stay valid; adding
   * to the union doesn't narrow them.
   */
  status: "recording" | "stopping" | "completed" | "failed";
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
//
// Phase 7 cp74.1 — two-axis schema:
//   - `type` (a.k.a. `subtitle_type` server-side): tier — 'rough' | 'fine'.
//     `fine` indicates an LLM-refined replacement; `rough` is the live ASR
//     / Gemma output.
//   - `source`: provenance — 'live' | 'imported' | 'edited'.
//     'live' = recordingSessionService stop pipeline,
//     'imported' = subtitleImportService (SRT / VTT / plain text),
//     'edited' = manual edit by user.
//
// `fine_text` / `fine_translation` carry the LLM-refined English / Chinese
// versions of the same line WITHOUT overwriting the rough originals.
// `text_en` / `text_zh` always hold the rough-tier text once both layers
// exist; UI display logic prefers `fine_*` when present.
export interface Subtitle {
  id: string;
  lecture_id: string; // 必需字段
  timestamp: number; // 秒
  text_en: string;
  text_zh?: string;
  type: "rough" | "fine"; // 對應後端的 subtitle_type 字段（修訂等級）
  source?: "live" | "imported" | "edited"; // 來源 — Phase 7 cp74.1
  fine_text?: string;            // LLM-refined English
  fine_translation?: string;     // LLM-refined Chinese
  fine_confidence?: number;
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
  /**
   * cp75.32 — auto-extracted homework / due dates / "remember to do X" items
   * the lecturer assigned to students. Generated alongside the summary at
   * stop-time (recordingSessionService.runBackgroundSummary) and on Review
   * page regenerate. Optional so legacy notes saved before cp75.32 still load.
   */
  action_items?: ActionItem[];
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
  /**
   * cp75.32 — Bloom's Revised Taxonomy level. Optional metadata so future
   * UI can filter / colour-code questions by cognitive level. Not required
   * by any current renderer, so legacy QARecords without it still display.
   */
  level?: 'recall' | 'comprehend' | 'apply' | 'analyze' | 'synthesize' | 'evaluate';
}

/**
 * cp75.32 — concrete TODO / homework / deadline item the lecturer assigned
 * to students. Auto-extracted by `extractActionItems` from the lecture
 * transcript at stop-time. UI surface lands in cp75.33+; the schema lives
 * here now so the persistence + generation pipelines can write to it.
 */
export interface ActionItem {
  /** What the student needs to do, ≤ 80 chars (truncated by the parser). */
  description: string;
  /**
   * ISO YYYY-MM-DD if the model could parse a deadline from the lecture
   * (e.g. "next Wednesday" → resolved to a date); null when the lecturer
   * assigned the work without a stated deadline.
   */
  due_date?: string | null;
  /** When in the lecture this was mentioned (relative seconds from start). */
  mentioned_at_timestamp: number;
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
    /** Watch for unplugged headset / muted device mid-recording and
     *  prompt user to re-pick. Default true. Off = recordingDeviceMonitor
     *  doesn't subscribe. */
    auto_switch_detection?: boolean;
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
  /**
   * v0.7.0 H18 UI 大改新增的外觀偏好。對應 ProfilePage 介面與顯示
   * sub-pane 內 5 項 tweaks。
   *
   * 跟 legacy `theme` 並存：
   *   - 舊 user 升級時 normalizeAppSettings 會自動填 default 並把
   *     legacy `theme` migrate 到 `appearance.themeMode`
   *   - 元件層 (v0.7.0+) 一律讀 appearance.*；legacy `theme` 留給
   *     舊 codepath 直到 Phase 5 全部 port 完才 deprecate
   */
  appearance?: {
    /** 主題模式 — system 跟系統 prefers-color-scheme 自動切 */
    themeMode?: 'light' | 'dark' | 'system';
    /** 密度 — comfortable=舒適 (預設大間距) / compact=緊密 (一屏裝更多) */
    density?: 'comfortable' | 'compact';
    /** 全應用基準字級 */
    fontSize?: 'small' | 'normal' | 'large';
    /** 主頁佈局: A=預設 (週曆+inbox+preview三欄) / B=Inbox 為主 /
     *  C=行事曆為主 */
    layout?: 'A' | 'B' | 'C';
    /** 錄音頁佈局: A=雙欄 (slide+subtitle) / B=字幕專注 / C=影片. */
    recordingLayout?: 'A' | 'B' | 'C';
    /** Toast 風格: card=卡片 (預設) / typewriter=打字機 mono 風 */
    toastStyle?: 'card' | 'typewriter';
  };
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
    /**
     * cp75.12 — Which TranslateGemma variant to use when the provider
     * is `gemma`. Sidecar startup uses this to pick the model file.
     * Defaults to `'4b'` for backward compat with pre-multi-variant
     * installs. UI: PTranslate's per-variant ModelCard list.
     */
    gemma_variant?: '4b' | '12b' | '27b';
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
    /** Local transcription model variant — Parakeet INT8 (default,
     *  smaller / faster) vs FP32 (more accurate, larger). */
    parakeetVariant?: 'int8' | 'fp32';
    /** Frontend logging verbosity. Echoes `console.*` and (if Tauri
     *  exposes a setter later) the Rust tracing subscriber level. */
    logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
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
    /** Auto-download new versions in background (default true on first run). */
    autoDownload?: boolean;
    /** Install downloaded update automatically on app close (default false). */
    autoInstall?: boolean;
  };
  /**
   * v0.7.0 Phase 7 Sprint 1 (S1.0) — 全域鍵盤快捷鍵綁定。
   * 每個值是 H18 自家 combo 字串（`Mod` token = ⌘ on macOS / Ctrl on
   * Windows+Linux；其他 modifier 用 `Shift` / `Alt`；末段是 key 名）。
   *
   * 任何欄位省略 → 落回 keymapService 的 default：
   *   search:        Mod+K
   *   toggleAiDock:  Mod+J
   *   newCourse:     Mod+N
   *   goHome:        Mod+H
   *   goProfile:     Mod+Comma
   *   toggleTheme:   Mod+Backslash
   *   floatingNotes: Mod+Shift+N
   *
   * 使用者透過 PKeyboard sub-pane 改寫此欄；Sprint 3 會接這個 wiring。
   */
  shortcuts?: Partial<{
    search: string;
    toggleAiDock: string;
    newCourse: string;
    goHome: string;
    goProfile: string;
    toggleTheme: string;
    floatingNotes: string;
  }>;
  /**
   * 第三方平台整合（v0.7.x+）。
   * Canvas 等 LMS 整合的全域設定放這裡，跟個別 course 綁的（例如某課
   * 的公告 RSS）區隔開。
   */
  integrations?: {
    canvas?: {
      /**
       * Canvas Calendar RSS feed URL（**per-user 全域**，一條 URL 含
       * 帳號底下所有課程的事件 / 截止日）。Canvas → Calendar 右下角
       * 「Calendar Feed」可取得。
       *
       * App 抓回來後依 calendar event 的 context_code / 課程標題比對
       * 各 course，分到對應課程的「待辦 / 提醒」區塊。
       */
      calendar_rss?: string;
      /**
       * 配對 wizard 內被使用者標記「忽略此課」的 Canvas course_id 清單。
       * - 不會出現在 rail 的虛擬課程占位
       * - 不會在 wizard 重跑時又跳出來要求配對
       * 整合頁可顯示已忽略列表 + 取消忽略按鈕。
       */
      ignored_course_ids?: string[];
    };
  };
}

// 錄音狀態
export type RecordingStatus = "idle" | "recording" | "paused" | "stopped";
