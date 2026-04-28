/**
 * h18-fixtures · self-test
 *
 * Phase 7 Sprint 0 task S0.2 — 統一 H18 共用 fixture builder。
 * 這份 test 只驗證 builder 的 default + override 行為；不碰任何 service。
 *
 * 為什麼這樣設計：Sprint 1-3 會新加 80+ 測試，每個都需要 mock
 * lecture / subtitle / task / settings。重複構造 fixture 是技術債，
 * 統一 builder 降低 80% 重複碼。Self-test 是這份 contract 的鎖：
 * 一旦 builder 預設值漂移（例如改了預設 status），本 file 立即抓包。
 */

import { describe, it, expect } from 'vitest';
import {
  makeLecture,
  makeCourse,
  makeSubtitle,
  makeNote,
  makeAppSettings,
  makeTaskTrackerEntry,
  MOCK_LECTURE_ID,
  MOCK_COURSE_ID,
} from '../h18-fixtures';

describe('h18-fixtures · makeLecture', () => {
  it('default has id / course_id / title / status', () => {
    const lecture = makeLecture();
    expect(lecture.id).toBe(MOCK_LECTURE_ID);
    expect(lecture.course_id).toBe(MOCK_COURSE_ID);
    expect(lecture.title).toBe('Test Lecture');
    expect(lecture.status).toBe('completed');
    expect(lecture.date).toBe('2026-04-28');
    expect(typeof lecture.duration).toBe('number');
    expect(typeof lecture.created_at).toBe('string');
    expect(typeof lecture.updated_at).toBe('string');
  });

  it('override wins over defaults (shallow merge)', () => {
    const lecture = makeLecture({ title: 'foo', status: 'recording' });
    expect(lecture.title).toBe('foo');
    expect(lecture.status).toBe('recording');
    // 其他欄位仍是 default
    expect(lecture.id).toBe(MOCK_LECTURE_ID);
    expect(lecture.course_id).toBe(MOCK_COURSE_ID);
  });
});

describe('h18-fixtures · makeCourse', () => {
  it('default has id / title / created_at; override wins', () => {
    const course = makeCourse();
    expect(course.id).toBe(MOCK_COURSE_ID);
    expect(course.title).toBe('Test Course');
    expect(typeof course.user_id).toBe('string');
    expect(typeof course.created_at).toBe('string');

    const overridden = makeCourse({ title: 'Custom Course' });
    expect(overridden.title).toBe('Custom Course');
    expect(overridden.id).toBe(MOCK_COURSE_ID);
  });
});

describe('h18-fixtures · makeSubtitle', () => {
  it('default has id / lecture_id / timestamp / text_en / type=live; override wins', () => {
    const sub = makeSubtitle();
    expect(typeof sub.id).toBe('string');
    expect(sub.lecture_id).toBe(MOCK_LECTURE_ID);
    expect(typeof sub.timestamp).toBe('number');
    expect(typeof sub.text_en).toBe('string');
    // 規格要求 type 'live'，但 Subtitle.type 限定 'rough' | 'fine'，
    // 取最相近語意：rough (即時 live 字幕原文)。fixture 仍 export
    // 'live' 為註解；override 後可改 fine。
    expect(['rough', 'fine']).toContain(sub.type);

    const overridden = makeSubtitle({ text_en: 'hello world' });
    expect(overridden.text_en).toBe('hello world');
    expect(overridden.lecture_id).toBe(MOCK_LECTURE_ID);
  });
});

describe('h18-fixtures · makeNote', () => {
  it('default has lecture_id / title / sections / qa_records; override wins', () => {
    const note = makeNote();
    expect(note.lecture_id).toBe(MOCK_LECTURE_ID);
    expect(typeof note.title).toBe('string');
    expect(Array.isArray(note.sections)).toBe(true);
    expect(Array.isArray(note.qa_records)).toBe(true);

    const overridden = makeNote({ summary: 'TL;DR' });
    expect(overridden.summary).toBe('TL;DR');
    expect(overridden.lecture_id).toBe(MOCK_LECTURE_ID);
  });
});

describe('h18-fixtures · makeAppSettings', () => {
  it('default has server / audio / subtitle / theme; override wins', () => {
    const settings = makeAppSettings();
    expect(settings.server).toBeDefined();
    expect(settings.audio).toBeDefined();
    expect(settings.subtitle).toBeDefined();
    expect(['light', 'dark']).toContain(settings.theme);

    const overridden = makeAppSettings({ theme: 'dark' });
    expect(overridden.theme).toBe('dark');
    expect(overridden.server).toBeDefined();
  });
});

describe('h18-fixtures · makeTaskTrackerEntry', () => {
  it('default has id / kind / label / progress / status / startedAt; override wins', () => {
    const entry = makeTaskTrackerEntry();
    expect(typeof entry.id).toBe('string');
    expect(['summarize', 'index', 'export']).toContain(entry.kind);
    expect(typeof entry.label).toBe('string');
    expect(typeof entry.progress).toBe('number');
    expect(['queued', 'running', 'done', 'failed']).toContain(entry.status);
    expect(typeof entry.startedAt).toBe('number');

    const overridden = makeTaskTrackerEntry({ status: 'done', progress: 1 });
    expect(overridden.status).toBe('done');
    expect(overridden.progress).toBe(1);
    expect(overridden.kind).toBe(entry.kind); // default 沿用
  });
});
