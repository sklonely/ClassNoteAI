/**
 * H18 共用 test fixtures · Phase 7 Sprint 0 task S0.2
 *
 * Sprint 1-3 會新加 80+ 測試，每個都需要 mock lecture / subtitle /
 * task / settings。這份統一 builder 降低 80% 重複碼：
 *
 *   - 預設值「合法」(passes basic schema check)
 *   - 用 `{ ...defaults, ...overrides }` 淺合併
 *   - 不引新 dep，不 import 任何 service（只引 type）
 *   - 不在 fixture 內 mock 任何 service — 那是 setup.ts / test 個別的事
 *
 * 引用方式：
 *   import { makeLecture, makeCourse } from '../../test/h18-fixtures';
 *   const l = makeLecture({ title: '線性代數 W3' });
 *
 * TaskTrackerEntry 在 Sprint 2 寫 taskTrackerService 時會把 type
 * 拉進 src/types。在那之前先用本 file 的 minimal interface 占位。
 */

import type {
  Course,
  Lecture,
  Subtitle,
  Note,
  AppSettings,
} from '../types';

// ─────────────────────────────────────────────────────────────────────
// 常數 — 多個 builder 要交叉引用 (e.g. subtitle.lecture_id 對 lecture.id)
// ─────────────────────────────────────────────────────────────────────

export const MOCK_LECTURE_ID = 'lecture-test-1';
export const MOCK_COURSE_ID = 'course-test-1';
export const MOCK_USER_ID = 'user-test-1';

/** 2026-04-28 00:00:00 UTC ms — 對應規格的 started_at_ms 「今天某時」 */
export const MOCK_STARTED_AT_MS = 1714291200000;

/** Lecture / Note / Subtitle 等共用的 ISO timestamp */
export const MOCK_ISO_TIMESTAMP = '2026-04-28T00:00:00.000Z';

// ─────────────────────────────────────────────────────────────────────
// TaskTrackerEntry — minimal interface，Sprint 2 拉進 src/types
// ─────────────────────────────────────────────────────────────────────

export interface TaskTrackerEntry {
  id: string;
  kind: 'summarize' | 'index' | 'export';
  label: string;
  lectureId?: string;
  progress: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  startedAt: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────
// builders
// ─────────────────────────────────────────────────────────────────────

export function makeCourse(overrides?: Partial<Course>): Course {
  const defaults: Course = {
    id: MOCK_COURSE_ID,
    user_id: MOCK_USER_ID,
    title: 'Test Course',
    description: undefined,
    keywords: undefined,
    syllabus_info: undefined,
    canvas_course_id: undefined,
    created_at: MOCK_ISO_TIMESTAMP,
    updated_at: MOCK_ISO_TIMESTAMP,
    is_deleted: false,
  };
  return { ...defaults, ...overrides };
}

export function makeLecture(overrides?: Partial<Lecture>): Lecture {
  const defaults: Lecture = {
    id: MOCK_LECTURE_ID,
    course_id: MOCK_COURSE_ID,
    title: 'Test Lecture',
    date: '2026-04-28',
    duration: 0,
    pdf_path: undefined,
    keywords: undefined,
    status: 'completed',
    created_at: MOCK_ISO_TIMESTAMP,
    updated_at: MOCK_ISO_TIMESTAMP,
    audio_path: undefined,
    audio_hash: undefined,
    video_path: undefined,
    subtitles: undefined,
    notes: undefined,
    is_deleted: false,
  };
  return { ...defaults, ...overrides };
}

export function makeSubtitle(overrides?: Partial<Subtitle>): Subtitle {
  const defaults: Subtitle = {
    id: 'subtitle-test-1',
    lecture_id: MOCK_LECTURE_ID,
    timestamp: 0,
    text_en: 'This is a test subtitle.',
    text_zh: '這是一個測試字幕。',
    // Phase 7 cp74.1 two-axis schema:
    //   type   = tier ('rough' | 'fine')
    //   source = provenance ('live' | 'imported' | 'edited')
    type: 'rough',
    source: 'live',
    fine_text: undefined,
    fine_translation: undefined,
    fine_confidence: undefined,
    confidence: undefined,
    created_at: MOCK_ISO_TIMESTAMP,
  };
  return { ...defaults, ...overrides };
}

export function makeNote(overrides?: Partial<Note>): Note {
  const defaults: Note = {
    lecture_id: MOCK_LECTURE_ID,
    title: 'Test Note',
    summary: undefined,
    sections: [],
    qa_records: [],
    generated_at: MOCK_ISO_TIMESTAMP,
    is_deleted: false,
  };
  return { ...defaults, ...overrides };
}

export function makeAppSettings(overrides?: Partial<AppSettings>): AppSettings {
  const defaults: AppSettings = {
    server: {
      url: 'http://localhost',
      port: 8080,
      enabled: false,
    },
    audio: {
      device_id: undefined,
      sample_rate: 16000,
      chunk_duration: 2,
      auto_switch_detection: true,
    },
    subtitle: {
      font_size: 18,
      font_color: '#FFFFFF',
      background_opacity: 0.8,
      position: 'bottom',
      display_mode: 'both',
    },
    theme: 'light',
    appearance: {
      themeMode: 'light',
      density: 'comfortable',
      fontSize: 'normal',
      layout: 'A',
      recordingLayout: 'A',
      toastStyle: 'card',
    },
  };
  return { ...defaults, ...overrides };
}

export function makeTaskTrackerEntry(
  overrides?: Partial<TaskTrackerEntry>,
): TaskTrackerEntry {
  const defaults: TaskTrackerEntry = {
    id: 'task-test-1',
    kind: 'summarize',
    label: 'Test summarize task',
    lectureId: MOCK_LECTURE_ID,
    progress: 0,
    status: 'queued',
    startedAt: MOCK_STARTED_AT_MS,
    error: undefined,
  };
  return { ...defaults, ...overrides };
}
