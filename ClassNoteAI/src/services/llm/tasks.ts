/**
 * High-level LLM tasks used across the app: summarisation, syllabus
 * extraction, keyword extraction, Q&A chat. Everything routes through
 * `resolveActiveProvider()` so the user's configured provider
 * (GitHub Models PAT or ChatGPT subscription OAuth in v0.5.2) transparently
 * powers all of them.
 *
 * Replaces the pre-v0.5.0 taskService + ClassNoteServer round-trip.
 */

import { resolveActiveProvider } from './registry';
import type { LLMMessage } from './types';
import { LLMError } from './types';
import { usageTracker, type UsageTask } from './usageTracker';

/**
 * Record token usage from a provider response so the UI can render
 * per-call hints and per-day aggregates. A no-op if the provider
 * didn't populate usage (rare — ChatGPT OAuth and GitHub Models
 * both return it in the streaming completion / chat response
 * respectively).
 */
function trackUsage(
  providerId: string,
  model: string,
  task: UsageTask,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  segments?: number,
) {
  if (!usage) return;
  usageTracker.record({
    providerId,
    model,
    task,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    segments,
  });
}

const DEFAULT_PROVIDER_KEY = 'llm.defaultProvider';

function preferredProvider(): string | undefined {
  return localStorage.getItem(DEFAULT_PROVIDER_KEY) || undefined;
}

/** Resolve the active provider + default model, or throw a friendly error. */
async function activeProviderAndModel(): Promise<{ providerId: string; model: string; provider: Awaited<ReturnType<typeof resolveActiveProvider>> }> {
  const provider = await resolveActiveProvider(preferredProvider());
  if (!provider) {
    throw new LLMError(
      'No AI provider configured. Open Settings → AI 增強 to set one up.',
      'auth'
    );
  }
  const models = await provider.listModels();
  if (!models.length) {
    throw new LLMError('Active provider returned no models.', 'provider', provider.descriptor.id);
  }
  return { providerId: provider.descriptor.id, model: models[0].id, provider };
}

export interface SummarizeParams {
  content: string;
  language: 'zh' | 'en';
  pdfContext?: string;
  title?: string;
  /** Optional override of the model id exposed by the provider. */
  model?: string;
}

export async function summarize(params: SummarizeParams): Promise<string> {
  const { provider, model: defaultModel } = await activeProviderAndModel();
  const model = params.model ?? defaultModel;

  const languageLine =
    params.language === 'zh'
      ? '以繁體中文輸出。使用 Markdown（# 標題、項目符號、程式碼區塊）。'
      : 'Respond in English. Use Markdown (# headings, bullet points, code fences).';

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `You are a teaching assistant that produces high-quality study notes from a lecture transcript. ${languageLine}\nSections to include: overview, key concepts, worked examples, questions to review. Skip fluff.`,
    },
  ];
  if (params.pdfContext) {
    messages.push({
      role: 'user',
      content: `Slides / PDF excerpts for context:\n\n${params.pdfContext}`,
    });
  }
  messages.push({
    role: 'user',
    content: `Lecture transcript${params.title ? ` (${params.title})` : ''}:\n\n${params.content}`,
  });

  const res = await provider!.complete({
    model,
    messages,
    temperature: 0.3,
    maxTokens: 4096,
  });
  trackUsage(provider!.descriptor.id, model, 'summarize', res.usage);
  return res.content;
}

export async function extractKeywords(text: string, max = 20): Promise<string[]> {
  const { provider, model } = await activeProviderAndModel();
  const res = await provider!.complete({
    model,
    messages: [
      {
        role: 'system',
        content: `Extract up to ${max} unique technical keywords or named entities from the user's text. Output JSON only: {"keywords": ["term1", "term2", ...]}. No commentary.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0,
    jsonMode: true,
    maxTokens: 1024,
  });
  trackUsage(provider!.descriptor.id, model, 'keywords', res.usage);
  try {
    const parsed = JSON.parse(res.content);
    if (Array.isArray(parsed?.keywords)) {
      return parsed.keywords.filter((k: unknown): k is string => typeof k === 'string');
    }
  } catch {
    // fall through
  }
  // Fallback: naive line-split in case the model ignored jsonMode.
  return res.content
    .split(/[\n,]/)
    .map((s) => s.replace(/^[-*\d.]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

export interface SyllabusInfo {
  topic?: string;
  time?: string;
  instructor?: string;
  office_hours?: string;
  teaching_assistants?: string;
  location?: string;
  grading?: { item: string; percentage: string }[];
  schedule?: string[];
}

export async function extractSyllabus(
  title: string,
  description: string | undefined,
  targetLanguage: 'zh' | 'en' = 'zh'
): Promise<SyllabusInfo> {
  const { provider, model } = await activeProviderAndModel();
  const sys =
    targetLanguage === 'zh'
      ? '從使用者提供的課程描述中抽取結構化資訊並回傳 JSON。欄位：topic, time, instructor, office_hours, teaching_assistants, location, grading（陣列，每項 {item, percentage}）, schedule（陣列，每項為一週進度字串）。找不到的欄位省略。'
      : 'Extract structured syllabus info from the user\'s course description. Return JSON with fields: topic, time, instructor, office_hours, teaching_assistants, location, grading (array of {item, percentage}), schedule (array of week strings). Omit fields you can\'t determine.';

  const res = await provider!.complete({
    model,
    messages: [
      { role: 'system', content: sys },
      {
        role: 'user',
        content: `Course title: ${title}\n\n${description ?? '(no additional description provided)'}`,
      },
    ],
    temperature: 0.1,
    jsonMode: true,
    maxTokens: 2048,
  });
  trackUsage(provider!.descriptor.id, model, 'syllabus', res.usage);
  try {
    return JSON.parse(res.content) as SyllabusInfo;
  } catch {
    return {};
  }
}

export async function chat(messages: LLMMessage[]): Promise<string> {
  const { provider, model } = await activeProviderAndModel();
  const res = await provider!.complete({
    model,
    messages,
    temperature: 0.3,
    maxTokens: 2048,
  });
  trackUsage(provider!.descriptor.id, model, 'chat', res.usage);
  return res.content;
}

/**
 * Fine-refinement of streaming ASR segments.
 *
 * Input: a batch of rough English transcription segments (as emitted by
 * whisper.cpp) with stable ids. The LLM uses the surrounding context
 * to (a) fix plausible ASR errors, and (b) produce a natural Chinese
 * translation for each segment.
 *
 * Output preserves 1:1 ordering with input — one refinement per input id.
 * On parse failure we return an empty array so the caller falls back to
 * the rough pass.
 */
export interface RoughSegment {
  id: string;
  text: string;
}

export interface FineRefinement {
  id: string;
  en: string;
  zh: string;
}

export async function refineTranscripts(batch: RoughSegment[]): Promise<FineRefinement[]> {
  if (!batch.length) return [];
  const { provider, model } = await activeProviderAndModel();

  const numbered = batch.map((s, i) => `[${i + 1} id=${s.id}] ${s.text}`).join('\n');
  const systemPrompt =
    '你正在精修即時語音辨識的輸出。使用者會貼上若干條「粗糙」英文段落，它們可能有辨識錯誤或不自然的斷句。' +
    '你的任務是：\n' +
    '(1) 用語意上下文修正 ASR 錯誤（保留原意，不臆測未說出的內容）；\n' +
    '(2) 產出自然流暢的繁體中文翻譯。\n' +
    '必須回傳 JSON：{"refinements": [{"id": "<原 id>", "en": "<修正後英文>", "zh": "<翻譯>"} ...]}。\n' +
    '一條輸入對應一條輸出，順序與 id 必須與輸入一致。不要加額外說明。';

  const res = await provider!.complete({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: numbered },
    ],
    temperature: 0.2,
    jsonMode: true,
    maxTokens: Math.min(8192, 512 * batch.length),
  });
  trackUsage(provider!.descriptor.id, model, 'fineRefine', res.usage, batch.length);

  try {
    const parsed = JSON.parse(res.content);
    if (Array.isArray(parsed?.refinements)) {
      return parsed.refinements.filter(
        (r: any): r is FineRefinement =>
          r && typeof r.id === 'string' && typeof r.en === 'string' && typeof r.zh === 'string'
      );
    }
  } catch {
    // fall through
  }
  return [];
}

/** Stream a chat response token-by-token. Caller receives incremental deltas. */
export async function* chatStream(messages: LLMMessage[]): AsyncGenerator<string, void, void> {
  const { provider, model } = await activeProviderAndModel();
  let finalUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  for await (const chunk of provider!.stream({
    model,
    messages,
    temperature: 0.3,
    maxTokens: 2048,
  })) {
    if (chunk.delta) yield chunk.delta;
    if (chunk.done && chunk.usage) {
      finalUsage = chunk.usage;
    }
  }
  trackUsage(provider!.descriptor.id, model, 'chatStream', finalUsage);
}
