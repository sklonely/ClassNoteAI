import { invoke } from '@tauri-apps/api/core';
import type { Course, Lecture, Subtitle, Note, AppSettings } from '../types';
import { save, open } from '@tauri-apps/plugin-dialog';
import { authService } from './authService';
import { extractSyllabus } from './llm';
import { toastService } from './toastService';
// Note: pdfService is imported lazily inside generateCourseSyllabusInBackground.
// Eager import pulls in pdfjs-dist at module-load time, which references
// browser-only globals (DOMMatrix). Several vitest suites (consentService,
// ragService.crossLingual, storageService) run under the node environment
// and transitively import storageService — a top-level `import './pdfService'`
// would crash those suites with `ReferenceError: DOMMatrix is not defined`
// before a single test ran.

const COURSE_SYLLABUS_TIMEOUT_MS = 90_000;
const COURSE_SYLLABUS_MIN_DESCRIPTION_LENGTH = 50;
const COURSE_SYLLABUS_STATUS_KEY = '_classnote_status';
const COURSE_SYLLABUS_SOURCE_KEY = '_classnote_source';
const COURSE_SYLLABUS_UPDATED_AT_KEY = '_classnote_updated_at';
const COURSE_SYLLABUS_ERROR_MESSAGE_KEY = '_classnote_error_message';
/**
 * v0.7：保存使用者最初貼進來的原始課綱文字 / PDF 描述。
 * 後續「重新生成」永遠用這份，不用使用者編輯後的 description —
 * 否則每次重跑都拿前次 AI 整理過的版本當輸入，原始細節會慢慢流失。
 */
const COURSE_SYLLABUS_RAW_DESCRIPTION_KEY = '_classnote_raw_description';

/**
 * v0.7：Canvas LMS course_id (per-user 配對結果)。
 *
 * 為何藏在 syllabus_info 裡而不是 Course 的 top-level column？
 * 因為 Rust 端 `storage::Course` struct 還沒這欄位，serde 會把 unknown
 * top-level field 默默丟掉 → 存進去等於沒存。
 * 把它塞在 syllabus_info JSON blob (Rust 那邊型別是 serde_json::Value，
 * 全 JSON 原樣 round-trip) 可以零 Rust 修改達到持久化。
 *
 * 前端讀寫一律走 storageService.{getCourse,listCourses,saveCourse}，這
 * 些函式內部會做 pack/unpack，把 syllabus_info._classnote_canvas_course_id
 * 跟 course.canvas_course_id 雙向同步，呼叫端看到的還是 top-level 欄位。
 */
const COURSE_SYLLABUS_CANVAS_COURSE_ID_KEY = '_classnote_canvas_course_id';

/** Internal metadata keys — never displayed, never sent to AI. */
const COURSE_SYLLABUS_META_KEYS: ReadonlySet<string> = new Set([
  COURSE_SYLLABUS_STATUS_KEY,
  COURSE_SYLLABUS_SOURCE_KEY,
  COURSE_SYLLABUS_UPDATED_AT_KEY,
  COURSE_SYLLABUS_ERROR_MESSAGE_KEY,
  COURSE_SYLLABUS_RAW_DESCRIPTION_KEY,
  COURSE_SYLLABUS_CANVAS_COURSE_ID_KEY,
]);

/** Strip metadata so the resulting object is the AI-relevant content only. */
function stripSyllabusMeta(record: CourseSyllabusRecord | null): CourseSyllabusRecord {
  if (!record) return {};
  const out: CourseSyllabusRecord = {};
  for (const [k, v] of Object.entries(record)) {
    if (!COURSE_SYLLABUS_META_KEYS.has(k)) out[k] = v;
  }
  return out;
}

function getPreservedRawDescription(info: Course['syllabus_info']): string | undefined {
  const record = toCourseSyllabusRecord(info);
  const v = record?.[COURSE_SYLLABUS_RAW_DESCRIPTION_KEY];
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

/**
 * Recover `canvas_course_id` from syllabus_info metadata. Defence-in-depth
 * fallback for legacy rows that were saved before the Rust top-level column
 * existed. The v0.7.x migration in `database.rs` auto-promotes those rows
 * on first launch, so this is mostly inert; we keep it for imports / manual
 * data juggling that bypass the Rust migration.
 */
function unpackCanvasCourseId(course: Course): Course {
  if (course.canvas_course_id) return course;
  const record = toCourseSyllabusRecord(course.syllabus_info);
  const v = record?.[COURSE_SYLLABUS_CANVAS_COURSE_ID_KEY];
  if (typeof v === 'string' && v.trim().length > 0) {
    return { ...course, canvas_course_id: v.trim() };
  }
  return course;
}
const COURSE_SYLLABUS_CONTENT_KEYS = [
  'topic',
  'overview',
  'time',
  'start_date',
  'end_date',
  'instructor',
  'instructor_email',
  'instructor_office_hours',
  'office_hours',
  'teaching_assistants',
  'teaching_assistant_list',
  'ta_office_hours',
  'location',
  'grading',
  'schedule',
] as const;

type CourseSyllabusLifecycle = 'idle' | 'generating' | 'failed' | 'ready';
type CourseSyllabusSource = 'pdf' | 'description' | 'pdf+description';
type CourseSyllabusRecord = Record<string, unknown>;

function normalizeAppSettings(settings: AppSettings | (AppSettings & Record<string, unknown>)): AppSettings {
  const normalized = { ...settings } as AppSettings & Record<string, unknown>;
  const rawOcrMode = normalized.ocr?.mode as string | undefined;
  const rawRefineProvider = normalized.experimental?.refineProvider as string | undefined;

  if (rawOcrMode === 'local') {
    normalized.ocr = {
      ...normalized.ocr,
      mode: 'off',
    };
  }

  if (rawRefineProvider === 'ollama') {
    normalized.experimental = {
      ...normalized.experimental,
      refineProvider: 'auto',
    };
  }

  // v0.7.0 H18: 確保 appearance 物件存在且 5 個欄位都有 default。
  // 舊 user 升級時 settings.appearance === undefined → 全填 default。
  // 已有 appearance 但缺某欄位 → 補該欄位。已有的不蓋。
  // legacy `theme` field 只在 appearance.themeMode 缺時 migrate 過去。
  //
  // cp75.4 — spread the existing object first so new appearance fields
  // (recordingLayout, future additions) survive normalize. The previous
  // version listed only 5 fields by name; H18RecordingPage was already
  // writing settings.appearance.recordingLayout but every save round-
  // tripped through normalize would silently drop it → user's layout
  // toggle reverted to default A on every reload.
  const existingAppearance = normalized.appearance ?? {};
  normalized.appearance = {
    ...existingAppearance,
    themeMode: existingAppearance.themeMode ?? normalized.theme ?? 'light',
    density: existingAppearance.density ?? 'comfortable',
    fontSize: existingAppearance.fontSize ?? 'normal',
    layout: existingAppearance.layout ?? 'A',
    toastStyle: existingAppearance.toastStyle ?? 'card',
  };

  delete normalized.ollama;
  delete normalized.sync;
  return normalized;
}

// Test-only export — 讓 vitest 直接驗 normalize 邏輯，不必走 Tauri invoke
// path。命名加 ForTest 避免被當成 public API 誤用。
export const normalizeAppSettingsForTest = normalizeAppSettings;

function joinAppPath(baseDir: string, ...parts: string[]): string {
  const separator = baseDir.includes('\\') ? '\\' : '/';
  const normalizedBase = baseDir.replace(/[\\/]+$/, '');
  const normalizedParts = parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ''));
  return [normalizedBase, ...normalizedParts].join(separator);
}

function toCourseSyllabusRecord(info: Course['syllabus_info']): CourseSyllabusRecord | null {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  return info as CourseSyllabusRecord;
}

function hasCourseSyllabusContent(info: Course['syllabus_info']): boolean {
  const record = toCourseSyllabusRecord(info);
  if (!record) return false;
  return COURSE_SYLLABUS_CONTENT_KEYS.some((key) => {
    const value = record[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return value != null;
  });
}

function getCourseSyllabusSource(hasPdf: boolean, hasDescription: boolean): CourseSyllabusSource {
  if (hasPdf && hasDescription) return 'pdf+description';
  if (hasPdf) return 'pdf';
  return 'description';
}

function buildGeneratingCourseSyllabusInfo(
  existing: Course['syllabus_info'],
  source: CourseSyllabusSource,
  rawDescriptionToPreserve?: string,
): CourseSyllabusRecord {
  const now = new Date().toISOString();
  const existingRecord = toCourseSyllabusRecord(existing);
  // Always preserve all existing fields (content + metadata) — we don't
  // discard user-edited values just because the syllabus is regenerating.
  const preserved: CourseSyllabusRecord = existingRecord ? { ...existingRecord } : {};
  delete preserved[COURSE_SYLLABUS_ERROR_MESSAGE_KEY];

  // Lock in the raw description on first AI run so future regenerations
  // operate on the original input, not a previously-cleaned version.
  const alreadyPreservedRaw = preserved[COURSE_SYLLABUS_RAW_DESCRIPTION_KEY];
  const hasPreservedRaw =
    typeof alreadyPreservedRaw === 'string' && alreadyPreservedRaw.trim().length > 0;
  if (!hasPreservedRaw && rawDescriptionToPreserve && rawDescriptionToPreserve.trim().length > 0) {
    preserved[COURSE_SYLLABUS_RAW_DESCRIPTION_KEY] = rawDescriptionToPreserve;
  }

  return {
    ...preserved,
    [COURSE_SYLLABUS_STATUS_KEY]: 'generating',
    [COURSE_SYLLABUS_SOURCE_KEY]: source,
    [COURSE_SYLLABUS_UPDATED_AT_KEY]: now,
  };
}

function buildFailedCourseSyllabusInfo(
  message: string,
  source: CourseSyllabusSource,
): CourseSyllabusRecord {
  return {
    [COURSE_SYLLABUS_STATUS_KEY]: 'failed',
    [COURSE_SYLLABUS_SOURCE_KEY]: source,
    [COURSE_SYLLABUS_UPDATED_AT_KEY]: new Date().toISOString(),
    [COURSE_SYLLABUS_ERROR_MESSAGE_KEY]: message,
  };
}

/**
 * Build the ready-state syllabus record by merging AI output with the
 * previously persisted record — important for regeneration (we don't
 * overwrite user-edited fields) and for preserving the raw description
 * metadata across saves.
 *
 * Merge rule per content field: if the existing value is non-empty
 * (string with text, or non-empty array), keep it; otherwise take the
 * AI output. Metadata keys (status / raw description / etc.) are
 * always carried through from the existing record.
 */
function buildReadyCourseSyllabusInfo(
  info: Record<string, unknown>,
  source: CourseSyllabusSource,
  existing?: Course['syllabus_info'],
): CourseSyllabusRecord {
  const existingRecord = toCourseSyllabusRecord(existing) ?? {};

  function isFilled(v: unknown): boolean {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim().length > 0;
    return v != null;
  }

  // Start from existing content (so user edits survive), then layer AI
  // output ONLY where the existing field is empty.
  const merged: CourseSyllabusRecord = { ...existingRecord };
  for (const [k, v] of Object.entries(info)) {
    if (COURSE_SYLLABUS_META_KEYS.has(k)) continue; // never let AI write metadata
    if (!isFilled(merged[k])) {
      merged[k] = v;
    }
  }

  // Stamp with fresh metadata
  merged[COURSE_SYLLABUS_STATUS_KEY] = 'ready';
  merged[COURSE_SYLLABUS_SOURCE_KEY] = source;
  merged[COURSE_SYLLABUS_UPDATED_AT_KEY] = new Date().toISOString();
  delete merged[COURSE_SYLLABUS_ERROR_MESSAGE_KEY];

  return merged;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getCourseSyllabusState(info: Course['syllabus_info']): CourseSyllabusLifecycle {
  const record = toCourseSyllabusRecord(info);
  if (!record) return 'idle';
  const explicit = record[COURSE_SYLLABUS_STATUS_KEY];
  if (explicit === 'generating' || explicit === 'failed' || explicit === 'ready') {
    return explicit;
  }
  return hasCourseSyllabusContent(info) ? 'ready' : 'idle';
}

export function getCourseSyllabusFailureReason(info: Course['syllabus_info']): string | undefined {
  const record = toCourseSyllabusRecord(info);
  const message = record?.[COURSE_SYLLABUS_ERROR_MESSAGE_KEY];
  return typeof message === 'string' && message.trim() ? message : undefined;
}

/**
 * 數據存儲服務
 * 封裝所有與數據庫相關的 Tauri Commands
 */
class StorageService {
  private async getCourseTargetLanguage(): Promise<'zh' | 'en'> {
    const settings = await this.getAppSettings();
    return settings?.translation?.target_language?.startsWith('en') ? 'en' : 'zh';
  }

  async getCourseSyllabusPdfPath(courseId: string): Promise<string> {
    const appDataDir = await invoke<string>('get_app_data_dir');
    return joinAppPath(appDataDir, 'courses', courseId, 'syllabus.pdf');
  }

  async saveCourseSyllabusPdf(courseId: string, pdfData: ArrayBuffer): Promise<string> {
    // Guard against pathological uploads. 50 MB is generous for a syllabus
    // (typical is 50 KB – 5 MB); anything above this is almost certainly a
    // wrong-file drop, and `Array.from(new Uint8Array(...))` would OOM the
    // webview long before reaching the Tauri IPC boundary.
    const MAX_PDF_BYTES = 50 * 1024 * 1024;
    if (pdfData.byteLength > MAX_PDF_BYTES) {
      throw new Error(`課綱 PDF 過大（${(pdfData.byteLength / 1024 / 1024).toFixed(1)} MB），上限為 50 MB`);
    }
    const path = await this.getCourseSyllabusPdfPath(courseId);
    await invoke('write_binary_file', {
      path,
      data: Array.from(new Uint8Array(pdfData)),
    });
    return path;
  }

  async getCourseSyllabusPdfData(courseId: string): Promise<ArrayBuffer | null> {
    const path = await this.getCourseSyllabusPdfPath(courseId);
    try {
      const data = await invoke<number[]>('read_binary_file', { path });
      return new Uint8Array(data).buffer;
    } catch {
      return null;
    }
  }

  private async generateCourseSyllabusInBackground(
    course: Course,
    options: {
      pdfData?: ArrayBuffer;
      source: CourseSyllabusSource;
    },
  ): Promise<void> {
    try {
      // Source-of-truth for AI input: prefer the locked-in raw description
      // captured on the FIRST run, falling back to the current course
      // description (only used on first run, before raw is locked).
      const preservedRaw = getPreservedRawDescription(course.syllabus_info);
      const description =
        preservedRaw?.trim() ?? course.description?.trim() ?? '';
      let pdfData = options.pdfData ?? null;
      if (!pdfData) {
        pdfData = await this.getCourseSyllabusPdfData(course.id);
      }

      let pdfText = '';
      if (pdfData) {
        const { pdfService } = await import('./pdfService');
        // Bump from the 5-page default — course syllabi often run 10–20 pages
        // (weekly schedule + grading rubric + reading list). Capping at 5
        // truncated the schedule table on most real syllabi we tested.
        pdfText = await pdfService.extractText(pdfData, 20);
      }

      const hasDescription = description.length > 0;
      const hasPdf = pdfText.trim().length > 0;
      if (!hasDescription && !hasPdf) {
        throw new Error('沒有可用的課程 PDF 或課程描述可供生成大綱');
      }

      const targetLanguage = await this.getCourseTargetLanguage();
      const promptParts: string[] = [];
      if (hasDescription) {
        promptParts.push(description);
      }
      if (hasPdf) {
        promptParts.push(`PDF syllabus content:\n${pdfText}`);
      }

      // Hand the AI the existing (non-meta) syllabus content too — it
      // uses this to (a) avoid overwriting user-edited fields and (b)
      // focus on the ones still empty.
      const existingForMerge = stripSyllabusMeta(
        toCourseSyllabusRecord(course.syllabus_info),
      );

      const syllabus = await withTimeout(
        extractSyllabus(course.title, promptParts.join('\n\n'), {
          targetLanguage,
          existing: existingForMerge,
        }),
        COURSE_SYLLABUS_TIMEOUT_MS,
        '課程大綱生成逾時（90 秒）',
      );

      if (!syllabus || Object.keys(syllabus).length === 0) {
        throw new Error('AI 未返回可用的課程大綱資料');
      }

      const refreshedCourse = (await this.getCourse(course.id)) ?? course;
      await this.saveCourse({
        ...refreshedCourse,
        syllabus_info: buildReadyCourseSyllabusInfo(
          syllabus as Record<string, unknown>,
          getCourseSyllabusSource(hasPdf, hasDescription),
          refreshedCourse.syllabus_info,
        ),
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      const message = getErrorMessage(error);
      const refreshedCourse = (await this.getCourse(course.id)) ?? course;
      await this.saveCourse({
        ...refreshedCourse,
        syllabus_info: buildFailedCourseSyllabusInfo(message, options.source),
        updated_at: new Date().toISOString(),
      });
      // Best-effort: route fixable error toasts to the right settings tab.
      // Most syllabus failures are AI-provider related — no key, expired
      // OAuth, rate limit. Hot-link straight there. Otherwise jump into the
      // course edit page so the user can press 「⟳ 重新生成」 again.
      const isProviderIssue = /provider|AI 提供商|尚未設定|configured|auth|401|403/i.test(
        message,
      );
      toastService.error(
        '課程大綱生成失敗',
        message,
        isProviderIssue
          ? {
              navRequest: { kind: 'profile', tab: 'cloud' },
              label: '前往 AI 設定',
            }
          : {
              navRequest: { kind: 'course-edit', courseId: course.id },
              label: '重新生成',
            },
      );
    }
  }

  async saveCourseWithSyllabus(
    course: Course,
    options: {
      pdfData?: ArrayBuffer;
      triggerSyllabusGeneration?: boolean;
      forceRegenerate?: boolean;
    } = {},
  ): Promise<void> {
    const description = course.description?.trim() ?? '';
    const hasLongDescription = description.length >= COURSE_SYLLABUS_MIN_DESCRIPTION_LENGTH;
    const shouldGenerate =
      options.forceRegenerate ||
      !!options.pdfData ||
      (!!options.triggerSyllabusGeneration && hasLongDescription);

    if (options.pdfData) {
      await this.saveCourseSyllabusPdf(course.id, options.pdfData);
    }

    const source = getCourseSyllabusSource(
      !!options.pdfData || !!options.forceRegenerate,
      description.length > 0,
    );
    const courseToSave = shouldGenerate
      ? {
        ...course,
        syllabus_info: buildGeneratingCourseSyllabusInfo(
          course.syllabus_info,
          source,
          // First run only: lock in the user's original description so
          // every future regeneration uses the same source text.
          course.description ?? undefined,
        ),
        updated_at: new Date().toISOString(),
      }
      : course;

    await this.saveCourse(courseToSave);

    if (!shouldGenerate) return;
    void this.generateCourseSyllabusInBackground(courseToSave, {
      pdfData: options.pdfData,
      source,
    });
  }

  async retryCourseSyllabusGeneration(courseId: string): Promise<void> {
    const course = await this.getCourse(courseId);
    if (!course) {
      throw new Error(`找不到課程：${courseId}`);
    }
    await this.saveCourseWithSyllabus(course, { forceRegenerate: true });
  }
  /**
   * 保存科目
   */
  async saveCourse(course: Course): Promise<void> {
    const currentUser = authService.getUser()?.username || 'default_user';
    // Rust schema now has a top-level canvas_course_id column (v0.7.x
    // migration). We send the field directly; no need to pack it into
    // syllabus_info anymore. Reads still tolerate the legacy stash via
    // unpackCanvasCourseId() below.
    const courseToSave = {
      ...course,
      user_id: currentUser,
      is_deleted: course.is_deleted ?? false,
    };
    // cp75.34 — pass userId for the Rust-side ownership verify on update.
    await invoke('save_course', { course: courseToSave, userId: currentUser });
    // Broadcast so any open CourseDetailView / CourseListView / Home rail /
    // Home calendar that's already mounted can refetch.
    //   - `classnote-course-updated` (with detail.courseId) → page-level
    //     listeners that only care about a specific course (e.g.
    //     CourseEditPage waits for its own course to finish AI gen).
    //   - `classnote-courses-changed` → list-level listeners that need
    //     to re-pull the full course list (rail chips, weekly calendar,
    //     home preview, global search index).
    // Both are dispatched on every save so neither side gets stale.
    window.dispatchEvent(
      new CustomEvent('classnote-course-updated', { detail: { courseId: course.id } }),
    );
    window.dispatchEvent(new CustomEvent('classnote-courses-changed'));
  }

  /**
   * 獲取科目
   */
  async getCourse(id: string): Promise<Course | null> {
    const c = await invoke<Course | null>('get_course', { id });
    return c ? unpackCanvasCourseId(c) : null;
  }

  /**
   * 列出所有科目
   */
  async listCourses(): Promise<Course[]> {
    const currentUser = authService.getUser()?.username || 'default_user';
    const list = await invoke<Course[]>('list_courses', { userId: currentUser });
    return list.map(unpackCanvasCourseId);
  }

  /**
   * Recover courses stuck in `syllabus_info._classnote_status='generating'`.
   *
   * The background syllabus task is fire-and-forget (`void`): if the user
   * closes the app (or the process crashes) between the "generating" write
   * and the "ready"/"failed" write, the DB stays stuck on "generating" and
   * CourseDetailView shows a perpetual spinner. There is no in-flight task
   * to ever resolve it on next launch.
   *
   * Call this once on startup. For each course whose lifecycle is still
   * "generating" and whose `_classnote_updated_at` is older than
   * `staleAfterMs` (default 10 min — the real task has a 90 s timeout so
   * anything beyond that is a leftover from a prior session), flip it to
   * "failed" with a recovery hint. User can then hit "重試生成" to kick
   * off a fresh run.
   */
  async recoverStaleGeneratingSyllabuses(staleAfterMs: number = 10 * 60 * 1000): Promise<void> {
    const courses = await this.listCourses();
    const now = Date.now();
    for (const course of courses) {
      const info = course.syllabus_info as Record<string, unknown> | undefined;
      if (!info || info._classnote_status !== 'generating') continue;
      const updatedAtRaw = info._classnote_updated_at;
      const updatedAtMs = typeof updatedAtRaw === 'string' ? Date.parse(updatedAtRaw) : NaN;
      // If timestamp is missing or unparseable we still recover — the
      // alternative is leaving the spinner forever.
      if (!Number.isNaN(updatedAtMs) && now - updatedAtMs < staleAfterMs) continue;
      const recoveredInfo: Record<string, unknown> = {
        ...info,
        _classnote_status: 'failed',
        _classnote_updated_at: new Date().toISOString(),
        _classnote_error_message: '上次生成中斷（可能是 app 被關閉），請點擊重試。',
      };
      try {
        await this.saveCourse({
          ...course,
          syllabus_info: recoveredInfo as Course['syllabus_info'],
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        console.warn(`[storageService] 恢復課程 ${course.id} 的生成狀態失敗：`, error);
      }
    }
  }

  /**
   * 刪除科目（cp75.6: 傳 userId 給 Rust 端做 ownership check）
   */
  async deleteCourse(id: string): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('delete_course', { id, userId });
  }

  /**
   * 列出特定科目的所有課堂
   */
  async listLecturesByCourse(courseId: string): Promise<Lecture[]> {
    const currentUser = authService.getUser()?.username || 'default_user';
    return await invoke<Lecture[]>('list_lectures_by_course', { courseId, userId: currentUser });
  }

  /**
   * 保存課程
   */
  async saveLecture(lecture: Lecture): Promise<void> {
    const currentUser = authService.getUser()?.username || 'default_user';
    // Ensure lecture has is_deleted
    const lectureToSave = { ...lecture, is_deleted: lecture.is_deleted ?? false };
    await invoke('save_lecture', { lecture: lectureToSave, userId: currentUser });
  }

  /**
   * 獲取課程
   */
  async getLecture(id: string): Promise<Lecture | null> {
    return await invoke<Lecture | null>('get_lecture', { id });
  }

  /**
   * 列出所有課程
   */
  async listLectures(): Promise<Lecture[]> {
    const currentUser = authService.getUser()?.username || 'default_user';
    return await invoke<Lecture[]>('list_lectures', { userId: currentUser });
  }

  /**
   * 刪除課堂（cp75.6: 傳 userId 給 Rust 端做 ownership check）
   */
  async deleteLecture(id: string): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('delete_lecture', { id, userId });
  }

  /**
   * 更新課程狀態（cp75.34: 傳 userId 給 Rust 端做 ownership check）
   */
  async updateLectureStatus(id: string, status: 'recording' | 'completed'): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('update_lecture_status', { id, status, userId });
  }

  /**
   * 保存字幕（cp75.21: 傳 userId 給 Rust 端做 ownership check）
   */
  async saveSubtitle(subtitle: Subtitle): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('save_subtitle', { subtitle, userId });
  }

  /**
   * 批量保存字幕（cp75.21: 傳 userId 給 Rust 端做 ownership check）
   */
  async saveSubtitles(subtitles: Subtitle[]): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('save_subtitles', { subtitles, userId });
  }

  /**
   * 獲取課程的所有字幕
   */
  async getSubtitles(lectureId: string): Promise<Subtitle[]> {
    return await invoke<Subtitle[]>('get_subtitles', { lectureId });
  }

  /**
   * 刪除單條字幕（cp75.21: 傳 userId 給 Rust 端做 ownership check）
   */
  async deleteSubtitle(id: string): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('delete_subtitle', { id, userId });
  }

  /**
   * 保存設置
   *
   * cp75.3: forwards the current user's id so the Rust side can scope
   * the row to that user. Before this, the v8 schema migration added
   * `settings.user_id` column but the SQL queries ignored it — every
   * user shared one row per key. Now per-user.
   */
  async saveSetting(key: string, value: string): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('save_setting', { key, value, userId });
  }

  /**
   * 獲取設置
   *
   * cp75.3: same as saveSetting — passes userId so the Rust side returns
   * the row for the current user instead of any (which would silently
   * leak account A's settings to account B).
   */
  async getSetting(key: string): Promise<string | null> {
    const userId = authService.getUser()?.username || 'default_user';
    return await invoke<string | null>('get_setting', { key, userId });
  }

  /**
   * 獲取所有設置（only the current user's, not the global table dump）.
   *
   * cp75.4 fix — `get_all_settings` Tauri command returns the entire
   * settings table. Since cp75.3 stores keys as `<userId>::<originalKey>`,
   * raw SELECT returned every user's entries. Filter here so callers
   * (notably `exportAllData`) only see the active user.
   *
   * Returns a `{ originalKey: value }` map (the userId prefix stripped).
   */
  async getAllSettings(): Promise<Record<string, string>> {
    const settings = await invoke<Array<{ key: string; value: string }>>('get_all_settings');
    const userId = authService.getUser()?.username || 'default_user';
    const scopedPrefix = `${userId}::`;
    const result: Record<string, string> = {};
    settings.forEach(({ key, value }) => {
      // cp75.3 scoped keys: keep only this user's, strip the prefix.
      if (key.startsWith(scopedPrefix)) {
        result[key.slice(scopedPrefix.length)] = value;
        return;
      }
      // Legacy bare keys (pre-cp75.3) are owned by 'default_user' per the
      // v8 migration default. Surface them only when the active user IS
      // default_user, otherwise they'd leak into another account's export.
      if (!key.includes('::') && userId === 'default_user') {
        result[key] = value;
      }
    });
    return result;
  }

  /**
   * 保存應用設置（將整個設置對象序列化保存）
   */
  async saveAppSettings(settings: AppSettings): Promise<void> {
    const settingsJson = JSON.stringify(normalizeAppSettings(settings));
    await this.saveSetting('app_settings', settingsJson);
  }

  /**
   * 獲取應用設置
   */
  async getAppSettings(): Promise<AppSettings | null> {
    const settingsJson = await this.getSetting('app_settings');
    if (!settingsJson) {
      return null;
    }
    try {
      return normalizeAppSettings(JSON.parse(settingsJson) as AppSettings & Record<string, unknown>);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn('[StorageService] Failed to parse JSON for app_settings; returning null');
        return null;
      }
      throw error;
    }
  }

  /**
   * 保存單個設置項（便捷方法）
   */
  async saveSettingValue<T>(key: string, value: T): Promise<void> {
    const valueJson = JSON.stringify(value);
    await this.saveSetting(key, valueJson);
  }

  /**
   * 獲取單個設置項（便捷方法）
   */
  async getSettingValue<T>(key: string): Promise<T | null> {
    const valueJson = await this.getSetting(key);
    if (!valueJson) {
      return null;
    }
    try {
      return JSON.parse(valueJson) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn(`[StorageService] Failed to parse JSON for setting ${key}; returning null`);
        return null;
      }
      throw error;
    }
  }

  /**
   * 導出所有數據（JSON 格式）
   */
  async exportAllData(): Promise<string> {
    try {
      const lectures = await this.listLectures();

      // 為每個課程獲取字幕和筆記
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        lectures: await Promise.all(
          lectures.map(async (lecture) => {
            const subtitles = await this.getSubtitles(lecture.id);
            const note = await this.getNote(lecture.id);
            return {
              ...lecture,
              subtitles,
              note: note || undefined,
            };
          })
        ),
        settings: await this.getAllSettings(),
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('導出數據失敗:', error);
      throw new Error('導出數據失敗');
    }
  }

  /**
   * 導入數據（JSON 格式）
   */
  async importData(jsonData: string): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    try {
      let data = null;
      try {
        data = JSON.parse(jsonData);
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.warn('[StorageService] Failed to parse JSON for importData payload; returning null');
        } else {
          throw error;
        }
      }

      // 驗證數據格式
      if (!data?.lectures || !Array.isArray(data.lectures)) {
        throw new Error('無效的數據格式：缺少 lectures 數組');
      }

      // 導入課程
      for (const lecture of data.lectures) {
        try {
          // 確保所有必需字段都存在
          const now = new Date().toISOString();
          const lectureToSave: Lecture = {
            id: lecture.id || crypto.randomUUID(),
            course_id: lecture.course_id || 'default-course', // 暫時使用默認值，實際遷移時會處理
            title: lecture.title || '未命名課程',
            date: lecture.date || now,
            duration: lecture.duration || 0,
            pdf_path: lecture.pdf_path,
            status: lecture.status || 'completed',
            created_at: lecture.created_at || now, // 如果沒有，使用當前時間
            updated_at: lecture.updated_at || now, // 如果沒有，使用當前時間
            // subtitles 和 notes 不需要包含在保存對象中，會單獨保存
          };

          // 保存課程
          await this.saveLecture(lectureToSave);

          // 保存字幕
          if (lecture.subtitles && Array.isArray(lecture.subtitles)) {
            await this.saveSubtitles(lecture.subtitles);
          }

          // 保存筆記
          if (lecture.note) {
            // Note 類型在數據庫中存儲為 JSON 字符串（content 字段）
            // 如果導入的數據中 note 是對象，需要轉換為 JSON
            let noteContent: string;
            let noteTitle: string;
            let noteGeneratedAt: string;

            if (typeof lecture.note === 'object') {
              // 如果是完整的 Note 對象
              if ('sections' in lecture.note || 'qa_records' in lecture.note) {
                // 標準 Note 格式
                noteContent = JSON.stringify({
                  summary: (lecture.note as Note).summary,
                  sections: (lecture.note as Note).sections || [],
                  qa_records: (lecture.note as Note).qa_records || [],
                });
                noteTitle = (lecture.note as Note).title || lecture.title;
                noteGeneratedAt = (lecture.note as Note).generated_at || new Date().toISOString();
              } else if ('content' in lecture.note) {
                // 數據庫格式的 Note（content 是 JSON 字符串）
                noteContent = typeof (lecture.note as any).content === 'string'
                  ? (lecture.note as any).content
                  : JSON.stringify((lecture.note as any).content);
                noteTitle = (lecture.note as any).title || lecture.title;
                noteGeneratedAt = (lecture.note as any).generated_at || new Date().toISOString();
              } else {
                // 其他格式，嘗試序列化
                noteContent = JSON.stringify(lecture.note);
                noteTitle = lecture.title;
                noteGeneratedAt = new Date().toISOString();
              }
            } else if (typeof lecture.note === 'string') {
              // 如果已經是 JSON 字符串（不太可能，但處理一下）
              noteContent = lecture.note;
              noteTitle = lecture.title;
              noteGeneratedAt = new Date().toISOString();
            } else {
              // 其他情況
              noteContent = JSON.stringify(lecture.note);
              noteTitle = lecture.title;
              noteGeneratedAt = new Date().toISOString();
            }

            // 使用數據庫格式的 Note（content 是 JSON 字符串）
            const noteToSave = {
              lecture_id: lecture.id,
              title: noteTitle,
              content: noteContent,
              generated_at: noteGeneratedAt,
            };
            await this.saveNote(noteToSave as any);
          }

          imported++;
        } catch (error) {
          const errorMsg = `導入課程 ${lecture.id} 失敗: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      // 導入設置（可選）
      if (data.settings && typeof data.settings === 'object') {
        for (const [key, value] of Object.entries(data.settings) as [string, string][]) {
          try {
            await this.saveSetting(key, String(value));
          } catch (error) {
            const errorMsg = `導入設置 ${key} 失敗: ${error instanceof Error ? error.message : String(error)}`;
            errors.push(errorMsg);
            console.error(errorMsg);
          }
        }
      }

      return { imported, errors };
    } catch (error) {
      throw new Error(`導入數據失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 保存筆記
   * 注意：前端 Note 使用 sections/qa_records/summary，需要轉換為數據庫格式 (content JSON 字符串)
   */
  async saveNote(note: Note): Promise<void> {
    console.log('[StorageService] Attempting to save note for lecture:', note.lecture_id);

    // ===== FIX: Pre-check that lecture exists to prevent FK constraint errors =====
    const lectureExists = await this.getLecture(note.lecture_id);
    console.log('[StorageService] Lecture exists check result:', !!lectureExists, lectureExists?.id, lectureExists?.course_id);

    if (!lectureExists) {
      console.error('[StorageService] Cannot save note - lecture does not exist:', note.lecture_id);
      throw new Error(`無法保存筆記：講座不存在 (${note.lecture_id})`);
    }
    // =============================================================================

    // 將前端格式轉換為數據庫格式
    const dbNote = {
      lecture_id: note.lecture_id,
      title: note.title,
      content: JSON.stringify({
        summary: note.summary,
        sections: note.sections,
        qa_records: note.qa_records,
      }),
      generated_at: note.generated_at,
      is_deleted: note.is_deleted ?? false,
    };

    try {
      // cp75.34 — userId for the Rust-side lecture-ownership verify.
      const userId = authService.getUser()?.username || 'default_user';
      await invoke('save_note', { note: dbNote, userId });
      console.log('[StorageService] Note saved successfully');
    } catch (error) {
      console.error('[StorageService] Rust save_note failed:', error);
      throw new Error(`保存筆記失敗: ${error}`);
    }
  }

  /**
   * 獲取筆記
   * 注意：數據庫返回的 Note 的 content 是 JSON 字符串，需要轉換為前端格式
   */
  async getNote(lectureId: string): Promise<Note | null> {
    const dbNote = await invoke<{ lecture_id: string; title: string; content: string; generated_at: string } | null>('get_note', { lectureId });
    if (!dbNote) {
      return null;
    }

    // 將 content JSON 字符串轉換為 Note 格式
    try {
      const content = JSON.parse(dbNote.content);
      return {
        lecture_id: dbNote.lecture_id,
        title: dbNote.title,
        summary: content.summary,
        sections: content.sections || [],
        qa_records: content.qa_records || [],
        generated_at: dbNote.generated_at,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn(`[StorageService] Failed to parse JSON for note ${lectureId}; returning null`);
        return null;
      }
      throw error;
    }
  }

  /**
   * 保存對話歷史
   * 使用 settings 表儲存，key 為 chat_history_{lectureId}
   */
  async saveChatHistory(lectureId: string, messages: Array<{ id: string; role: string; content: string; timestamp: string }>): Promise<void> {
    const key = `chat_history_${lectureId}`;
    await this.saveSetting(key, JSON.stringify(messages));
  }

  /**
   * 獲取對話歷史
   */
  async getChatHistory(lectureId: string): Promise<Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string }>> {
    const key = `chat_history_${lectureId}`;
    const data = await this.getSetting(key);
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.warn(`[StorageService] Failed to parse JSON for chat history ${key}; returning []`);
        return [];
      }
      throw error;
    }
  }

  /**
   * 導出數據到文件
   */
  async exportDataToFile(): Promise<void> {
    try {
      const jsonData = await this.exportAllData();

      const filePath = await save({
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
        defaultPath: `classnoteai-export-${new Date().toISOString().split('T')[0]}.json`,
        title: '導出數據',
      });

      if (filePath) {
        // 使用 Tauri Command 寫入文件
        await invoke('write_text_file', { path: filePath, contents: jsonData });
      }
    } catch (error) {
      console.error('導出文件失敗:', error);
      throw new Error('導出文件失敗');
    }
  }

  /**
   * 從文件導入數據
   */
  async importDataFromFile(): Promise<{ imported: number; errors: string[] }> {
    try {
      const filePath = await open({
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
        title: '選擇導入文件',
      });

      if (!filePath || typeof filePath !== 'string') {
        throw new Error('未選擇文件');
      }

      // 使用 Tauri Command 讀取文件
      const jsonData = await invoke<string>('read_text_file', { path: filePath });
      return await this.importData(jsonData);
    } catch (error) {
      console.error('導入文件失敗:', error);
      throw new Error(`導入文件失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * 保存 OCR 結果
   * key: ocr_result_{lectureId}_{pageNumber}
   */
  async saveOCRResult(lectureId: string, pageNumber: number, text: string): Promise<void> {
    const key = `ocr_result_${lectureId}_${pageNumber}`;
    await this.saveSetting(key, text);
  }

  /**
   * 獲取 OCR 結果
   */
  async getOCRResult(lectureId: string, pageNumber: number): Promise<string | null> {
    const key = `ocr_result_${lectureId}_${pageNumber}`;
    return await this.getSetting(key);
  }

  // ========== Trash Bin Methods ==========

  /**
   * 列出已刪除的課程
   */
  async listDeletedCourses(): Promise<Course[]> {
    const currentUser = authService.getUser()?.username || 'default_user';
    return await invoke<Course[]>('list_deleted_courses', { userId: currentUser });
  }

  /**
   * 列出已刪除的課堂
   */
  async listDeletedLectures(): Promise<Lecture[]> {
    const currentUser = authService.getUser()?.username || 'default_user';
    return await invoke<Lecture[]>('list_deleted_lectures', { userId: currentUser });
  }

  /**
   * 還原已刪除的課程（cp75.6 ownership check）
   */
  async restoreCourse(id: string): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('restore_course', { id, userId });
  }

  /**
   * 還原已刪除的課堂（cp75.6 ownership check）
   */
  async restoreLecture(id: string): Promise<void> {
    const userId = authService.getUser()?.username || 'default_user';
    await invoke('restore_lecture', { id, userId });
  }

  /**
   * 永久刪除課程
   */
  async purgeCourse(id: string): Promise<void> {
    await invoke('purge_course', { id });
  }

  /**
   * 永久刪除課堂
   */
  async purgeLecture(id: string): Promise<void> {
    await invoke('purge_lecture', { id });
  }
}

export const storageService = new StorageService();
