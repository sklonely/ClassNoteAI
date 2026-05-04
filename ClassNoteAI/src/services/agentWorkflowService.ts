import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { summarizeStream } from './llm';
import { ragService } from './ragService';
import { storageService } from './storageService';
import { videoImportService, type ImportProgress } from './videoImportService';
import type { Note, Subtitle } from '../types';

const WORKFLOW_EVENT = 'agent-bridge-workflow';
const COMPLETE_COMMAND = 'agent_bridge_complete_workflow';
const PROGRESS_COMMAND = 'agent_bridge_workflow_progress';

type WorkflowStatus = 'ok' | 'failed' | 'unsupported' | 'needs_input';

export type AgentWorkflowRequest = {
  taskId: string;
  workflowId: 'import-media' | 'ocr-index' | 'summarize' | string;
  dryRun?: boolean;
  file?: string | null;
  lectureId?: string | null;
  pdfPath?: string | null;
  transcriptText?: string | null;
  content?: string | null;
  title?: string | null;
  language?: 'zh' | 'en' | 'auto' | string | null;
  forceRefresh?: boolean;
  writeNote?: boolean;
};

export type AgentWorkflowResult = {
  status: WorkflowStatus;
  workflowId: string;
  taskId: string;
  message?: string;
  data?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
};

type WorkflowDeps = {
  importVideo: typeof videoImportService.importVideo;
  indexLectureWithOCR: typeof ragService.indexLectureWithOCR;
  summarizeStream: typeof summarizeStream;
  getLecture: typeof storageService.getLecture;
  getSubtitles: typeof storageService.getSubtitles;
  getNote: typeof storageService.getNote;
  saveNote: typeof storageService.saveNote;
  readBinaryFile: (path: string) => Promise<ArrayBuffer>;
  progress: (taskId: string, message: string, payload?: Record<string, unknown>) => Promise<void>;
};

const defaultDeps: WorkflowDeps = {
  importVideo: videoImportService.importVideo.bind(videoImportService),
  indexLectureWithOCR: ragService.indexLectureWithOCR.bind(ragService),
  summarizeStream,
  getLecture: storageService.getLecture.bind(storageService),
  getSubtitles: storageService.getSubtitles.bind(storageService),
  getNote: storageService.getNote.bind(storageService),
  saveNote: storageService.saveNote.bind(storageService),
  readBinaryFile: async (path: string) => {
    const bytes = await invoke<number[]>('read_binary_file', { path });
    return new Uint8Array(bytes).buffer;
  },
  progress: emitWorkflowProgress,
};

export async function runAgentWorkflow(
  request: AgentWorkflowRequest,
  deps: WorkflowDeps = defaultDeps,
): Promise<AgentWorkflowResult> {
  const base = {
    workflowId: request.workflowId,
    taskId: request.taskId,
  };

  try {
    if (!request.taskId) {
      return { ...base, taskId: '', status: 'needs_input', message: 'workflow request requires taskId' };
    }

    if (request.dryRun) {
      return {
        ...base,
        status: 'ok',
        message: 'dry-run workflow accepted',
        data: {
          dryRun: true,
          acceptedInputs: publicInputs(request),
        },
      };
    }

    if (request.workflowId === 'import-media') {
      return importMediaWorkflow(request, deps);
    }
    if (request.workflowId === 'ocr-index') {
      return ocrIndexWorkflow(request, deps);
    }
    if (request.workflowId === 'summarize') {
      return summarizeWorkflow(request, deps);
    }

    return {
      ...base,
      status: 'unsupported',
      message: `Unsupported workflow: ${request.workflowId}`,
    };
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function useAgentWorkflowBridge() {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<AgentWorkflowRequest>(WORKFLOW_EVENT, async (event) => {
      const request = event.payload;
      const result = await runAgentWorkflow(request);
      if (!request?.taskId) return;
      await invoke(COMPLETE_COMMAND, {
        taskId: request.taskId,
        result,
      }).catch(() => undefined);
    }).then((dispose) => {
      unlisten = dispose;
    }).catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);
}

async function importMediaWorkflow(
  request: AgentWorkflowRequest,
  deps: WorkflowDeps,
): Promise<AgentWorkflowResult> {
  const base = { workflowId: request.workflowId, taskId: request.taskId };
  if (!request.lectureId) {
    return { ...base, status: 'needs_input', message: 'import-media requires --lecture-id' };
  }
  if (!request.file) {
    return { ...base, status: 'needs_input', message: 'import-media requires --file' };
  }

  await deps.progress(request.taskId, 'Importing media', { stage: 'starting' });
  const result = await deps.importVideo(request.lectureId, request.file, {
    language: request.language === 'auto' ? 'auto' : request.language ?? undefined,
    onProgress: (progress) => {
      void deps.progress(request.taskId, progress.message, importProgressPayload(progress));
    },
  });

  return {
    ...base,
    status: 'ok',
    message: 'media import completed',
    data: result,
    artifacts: [{ type: 'media', path: result.videoPath }],
  };
}

async function ocrIndexWorkflow(
  request: AgentWorkflowRequest,
  deps: WorkflowDeps,
): Promise<AgentWorkflowResult> {
  const base = { workflowId: request.workflowId, taskId: request.taskId };
  if (!request.lectureId) {
    return { ...base, status: 'needs_input', message: 'ocr-index requires --lecture-id' };
  }

  await deps.progress(request.taskId, 'Preparing OCR index input', {
    pdfPath: request.pdfPath ?? null,
  });
  const pdfData = request.pdfPath ? await deps.readBinaryFile(request.pdfPath) : null;
  const transcriptText = request.transcriptText ?? await transcriptForLecture(request.lectureId, deps);
  const result = await deps.indexLectureWithOCR(
    request.lectureId,
    pdfData,
    transcriptText,
    (progress) => {
      void deps.progress(request.taskId, progress.message, {
        stage: progress.stage,
        current: progress.current,
        total: progress.total,
      });
    },
    Boolean(request.forceRefresh),
  );

  return {
    ...base,
    status: result.success ? 'ok' : 'failed',
    message: result.success ? 'OCR index completed' : 'OCR index failed',
    data: result,
  };
}

async function summarizeWorkflow(
  request: AgentWorkflowRequest,
  deps: WorkflowDeps,
): Promise<AgentWorkflowResult> {
  const base = { workflowId: request.workflowId, taskId: request.taskId };
  const language = request.language === 'en' ? 'en' : 'zh';
  const content = request.content ?? (
    request.lectureId ? await transcriptOrNoteText(request.lectureId, deps) : ''
  );

  if (!content.trim()) {
    return {
      ...base,
      status: 'needs_input',
      message: 'summarize requires --content or a lecture with subtitles/notes',
    };
  }

  const title = request.title ?? (request.lectureId ? (await deps.getLecture(request.lectureId))?.title : undefined);
  await deps.progress(request.taskId, 'Generating summary', {
    contentChars: content.length,
    language,
  });

  let summary = '';
  for await (const event of deps.summarizeStream({
    content,
    language,
    title: title ?? undefined,
  })) {
    if (event.phase === 'reduce-delta' && event.delta) {
      summary += event.delta;
    }
    if (event.phase === 'done') {
      summary = event.fullText ?? summary;
    }
    await deps.progress(request.taskId, `summary ${event.phase}`, {
      phase: event.phase,
      sectionCount: event.sectionCount,
      sectionIndex: event.sectionIndex,
      summaryChars: summary.length,
    });
  }

  if (request.lectureId && request.writeNote !== false) {
    const existing = await deps.getNote(request.lectureId);
    const note: Note = existing ?? {
      lecture_id: request.lectureId,
      title: title ?? 'Lecture Summary',
      sections: [],
      qa_records: [],
      generated_at: new Date().toISOString(),
    };
    await deps.saveNote({
      ...note,
      summary,
      generated_at: new Date().toISOString(),
    });
  }

  return {
    ...base,
    status: 'ok',
    message: 'summary completed',
    data: {
      summary,
      summaryChars: summary.length,
      wroteNote: Boolean(request.lectureId && request.writeNote !== false),
    },
  };
}

async function transcriptOrNoteText(lectureId: string, deps: WorkflowDeps): Promise<string> {
  const transcript = await transcriptForLecture(lectureId, deps);
  if (transcript.trim()) return transcript;

  const note = await deps.getNote(lectureId);
  return note?.sections.map((section) => section.content).join('\n\n') ?? '';
}

async function transcriptForLecture(lectureId: string, deps: WorkflowDeps): Promise<string> {
  const subtitles = await deps.getSubtitles(lectureId);
  return subtitlesToText(subtitles);
}

function subtitlesToText(subtitles: Subtitle[]): string {
  return subtitles
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((subtitle) => subtitle.text_en || subtitle.text_zh || '')
    .filter((text) => text.trim().length > 0)
    .join('\n');
}

async function emitWorkflowProgress(
  taskId: string,
  message: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await invoke(PROGRESS_COMMAND, {
    taskId,
    message,
    payload,
  }).catch(() => undefined);
}

function importProgressPayload(progress: ImportProgress): Record<string, unknown> {
  return {
    stage: progress.stage,
    videoPath: progress.videoPath,
    transcribed: progress.transcribed,
    translated: progress.translated,
    total: progress.total,
    subtitlesChanged: progress.subtitlesChanged,
  };
}

function publicInputs(request: AgentWorkflowRequest): Record<string, unknown> {
  return {
    file: request.file ?? null,
    lectureId: request.lectureId ?? null,
    pdfPath: request.pdfPath ?? null,
    hasTranscriptText: Boolean(request.transcriptText),
    hasContent: Boolean(request.content),
    language: request.language ?? null,
    forceRefresh: Boolean(request.forceRefresh),
    writeNote: request.writeNote ?? null,
  };
}
