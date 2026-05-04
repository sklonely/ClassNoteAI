import { describe, expect, it, vi } from 'vitest';

vi.mock('../videoImportService', () => ({
  videoImportService: { importVideo: vi.fn() },
}));

vi.mock('../ragService', () => ({
  ragService: { indexLectureWithOCR: vi.fn() },
}));

vi.mock('../storageService', () => ({
  storageService: {
    getLecture: vi.fn(),
    getSubtitles: vi.fn(),
    getNote: vi.fn(),
    saveNote: vi.fn(),
  },
}));

vi.mock('../llm', () => ({
  summarizeStream: vi.fn(),
}));

import {
  runAgentWorkflow,
  type AgentWorkflowRequest,
} from '../agentWorkflowService';

function deps(overrides: Partial<Parameters<typeof runAgentWorkflow>[1]> = {}) {
  return {
    importVideo: vi.fn(),
    indexLectureWithOCR: vi.fn(),
    summarizeStream: vi.fn(),
    getLecture: vi.fn(),
    getSubtitles: vi.fn(),
    getNote: vi.fn(),
    saveNote: vi.fn(),
    readBinaryFile: vi.fn(),
    progress: vi.fn(),
    ...overrides,
  } as NonNullable<Parameters<typeof runAgentWorkflow>[1]>;
}

async function* summaryEvents() {
  yield { phase: 'reduce-start' as const };
  yield { phase: 'reduce-delta' as const, delta: 'Summary' };
  yield { phase: 'done' as const, fullText: 'Summary' };
}

describe('agentWorkflowService', () => {
  it('accepts workflow dry-runs without touching app services', async () => {
    const d = deps();

    const result = await runAgentWorkflow({
      taskId: 'task-1',
      workflowId: 'import-media',
      dryRun: true,
      lectureId: 'lecture-1',
      file: 'D:/class.mp4',
    }, d);

    expect(result.status).toBe('ok');
    expect(result.data?.dryRun).toBe(true);
    expect(d.importVideo).not.toHaveBeenCalled();
  });

  it('imports media through the existing video import service', async () => {
    const d = deps({
      importVideo: vi.fn(async (_lectureId, _file, options) => {
        options.onProgress?.({ stage: 'transcribing', message: 'working', transcribed: 1 });
        return { videoPath: 'D:/stored/class.mp4', segmentCount: 2, durationMs: 3000 };
      }),
    });

    const result = await runAgentWorkflow({
      taskId: 'task-2',
      workflowId: 'import-media',
      lectureId: 'lecture-1',
      file: 'D:/class.mp4',
      language: 'auto',
    }, d);

    expect(result.status).toBe('ok');
    expect(d.importVideo).toHaveBeenCalledWith('lecture-1', 'D:/class.mp4', expect.objectContaining({
      language: 'auto',
    }));
    expect(d.progress).toHaveBeenCalledWith('task-2', 'working', expect.objectContaining({
      stage: 'transcribing',
    }));
  });

  it('indexes OCR from a PDF path and lecture subtitles', async () => {
    const d = deps({
      readBinaryFile: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
      getSubtitles: vi.fn(async () => [
        { id: 's1', lecture_id: 'lecture-1', timestamp: 2, text_en: 'second', type: 'rough' as const, created_at: '' },
        { id: 's0', lecture_id: 'lecture-1', timestamp: 1, text_en: 'first', type: 'rough' as const, created_at: '' },
      ]),
      indexLectureWithOCR: vi.fn(async () => ({ chunksCount: 4, success: true })),
    });

    const result = await runAgentWorkflow({
      taskId: 'task-3',
      workflowId: 'ocr-index',
      lectureId: 'lecture-1',
      pdfPath: 'D:/slides.pdf',
      forceRefresh: true,
    }, d);

    expect(result.status).toBe('ok');
    expect(d.readBinaryFile).toHaveBeenCalledWith('D:/slides.pdf');
    expect(d.indexLectureWithOCR).toHaveBeenCalledWith(
      'lecture-1',
      expect.any(ArrayBuffer),
      'first\nsecond',
      expect.any(Function),
      true,
    );
  });

  it('summarizes supplied content and can persist the lecture note', async () => {
    const d = deps({
      summarizeStream: vi.fn(() => summaryEvents()),
      getLecture: vi.fn(async () => ({
        id: 'lecture-1',
        course_id: 'course-1',
        title: 'Queues',
        date: '2026-04-26',
        duration: 0,
        status: 'completed' as const,
        created_at: '2026-04-26T00:00:00.000Z',
        updated_at: '2026-04-26T00:00:00.000Z',
      })),
      getNote: vi.fn(async () => null),
      saveNote: vi.fn(async () => undefined),
    });

    const request: AgentWorkflowRequest = {
      taskId: 'task-4',
      workflowId: 'summarize',
      lectureId: 'lecture-1',
      content: 'Queues use FIFO ordering.',
      language: 'en',
    };
    const result = await runAgentWorkflow(request, d);

    expect(result.status).toBe('ok');
    expect(result.data?.summary).toBe('Summary');
    expect(d.summarizeStream).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Queues use FIFO ordering.',
      language: 'en',
      title: 'Queues',
    }));
    expect(d.saveNote).toHaveBeenCalledWith(expect.objectContaining({
      lecture_id: 'lecture-1',
      summary: 'Summary',
    }));
  });
});
