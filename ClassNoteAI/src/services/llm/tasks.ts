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
import { readPreferredProviderId } from './providerState';
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

/**
 * Rate-limit tiers as enforced by GitHub Models (and informally by
 * other providers via their pricing). Tasks declare which tier they
 * belong to and `activeProviderAndModel` routes them to the cheapest
 * model that still does the job:
 *
 *   - `low`   = GitHub Models "Low" quota (150 req/day on Copilot Pro).
 *               Simple, high-volume tasks: translation, keyword /
 *               syllabus extraction, subtitle refinement. These don't
 *               need GPT-4.1's reasoning; `gpt-4o-mini` / `gpt-4.1-mini`
 *               produce equivalent results for structured or
 *               short-text work.
 *   - `high`  = GitHub Models "High" quota (50 req/day on Copilot Pro).
 *               Quality-sensitive tasks: the main AI 助教 chat and the
 *               lecture summary. Use the provider's flagship model.
 *
 * Splitting this way preserves the 50-req High pool for the two
 * tasks users actually care about (chat + summary) -- everything
 * else runs out of the separate 150-req Low pool.
 */
type ModelTier = 'low' | 'high';

/**
 * Heuristic classification of a model id into Low/High tier, based
 * on the naming conventions used by OpenAI, Anthropic, and Meta.
 * We can't rely on GitHub's docs to classify individual IDs --
 * only the category bands are documented -- so we match on the
 * substrings providers use to denote "small / fast / cheap":
 *
 *   mini, nano, small, haiku, lite, flash, -8b, 3.5-turbo
 *
 * Everything else (gpt-4.1, gpt-4o, gpt-5, claude-3.5-sonnet,
 * llama-3-70b, ...) falls through to 'high'.
 */
function tierOf(modelId: string): ModelTier {
  const lc = modelId.toLowerCase();
  if (/mini|nano|small|haiku|lite|flash|-8b\b|3\.5[-_]?turbo/.test(lc)) return 'low';
  return 'high';
}

/** Pick the best model in the given tier from the provider's list.
 *  Falls back to the first available model if no match. */
function pickModelForTier(models: { id: string }[], tier: ModelTier): string {
  const match = models.find((m) => tierOf(m.id) === tier);
  return (match ?? models[0]).id;
}

/** Resolve the active provider + the right-tier model, or throw a
 *  friendly error. Tier defaults to 'high' so legacy callers (which
 *  haven't been updated yet) still get the flagship model. */
async function activeProviderAndModel(
  tier: ModelTier = 'high',
): Promise<{ providerId: string; model: string; provider: Awaited<ReturnType<typeof resolveActiveProvider>> }> {
  const provider = await resolveActiveProvider(await readPreferredProviderId());
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
  return { providerId: provider.descriptor.id, model: pickModelForTier(models, tier), provider };
}

export interface SummarizeParams {
  content: string;
  language: 'zh' | 'en';
  pdfContext?: string;
  title?: string;
  /** Optional override of the model id exposed by the provider. */
  model?: string;
}

/** Character threshold above which `summarize` switches from single-
 *  pass to map-reduce. Below this we keep the direct route because a
 *  short transcript summarized in one pass has better cross-section
 *  coherence than anything a reducer can stitch together. Above it,
 *  contexts get long enough that Anthropic's finding about reasoning
 *  quality degrading past ~100k tokens (and lecture transcripts being
 *  mostly filler) tips the tradeoff the other way. 12000 chars
 *  (~3000-4000 English tokens) is a conservative split point that
 *  keeps 20-30 min lectures on the fast single-pass path. */
const SUMMARIZE_MAP_REDUCE_THRESHOLD = 12_000;

/** Target size of a map-phase chunk. ~4000 chars = ~1000 English
 *  tokens = comfortable for any modern model. */
const SECTION_CHUNK_CHARS = 4_000;
/** Kept between adjacent sections so a concept split across a
 *  boundary doesn't get lost. Intentionally small because the whole
 *  set of sections is re-read in the reduce step anyway. */
const SECTION_OVERLAP_CHARS = 200;

/** Max simultaneous map-phase requests. GitHub Models and ChatGPT
 *  OAuth both start returning 429 well below 10 concurrent requests;
 *  a 2-hour transcript at ~4 000 chars per section can produce 25+
 *  sections. Without a limiter we'd fire them all at once and the
 *  whole summarise would fail on the first section that 429s. */
const MAP_PHASE_CONCURRENCY = 3;

/** Tiny promise-concurrency limiter. Kept inline because pulling in
 *  `p-limit` would add a dep we use in one place. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildSummarizeSystemPrompt(language: 'zh' | 'en'): string {
  const languageLine =
    language === 'zh'
      ? '以繁體中文輸出。使用 Markdown（# 標題、項目符號、程式碼區塊）。'
      : 'Respond in English. Use Markdown (# headings, bullet points, code fences).';
  return (
    `You are a teaching assistant that produces high-quality study notes ` +
    `from a lecture transcript. ${languageLine}\n` +
    `Sections to include: overview, key concepts, worked examples, questions ` +
    `to review. Skip fluff.`
  );
}

/** Split a long transcript into map-phase sections on sentence boundaries
 *  when possible, falling back to raw character slicing. Each section
 *  overlaps the previous by SECTION_OVERLAP_CHARS so content straddling
 *  a boundary isn't lost. */
export function chunkForSummarization(text: string): string[] {
  if (text.length <= SECTION_CHUNK_CHARS) return [text];
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const targetEnd = Math.min(cursor + SECTION_CHUNK_CHARS, text.length);
    // Prefer ending on a sentence boundary within the last 400 chars of
    // the target window so the reducer sees coherent passages.
    let end = targetEnd;
    if (targetEnd < text.length) {
      const windowStart = Math.max(cursor, targetEnd - 400);
      const candidates = [
        text.lastIndexOf('. ', targetEnd),
        text.lastIndexOf('。', targetEnd),
        text.lastIndexOf('\n', targetEnd),
        text.lastIndexOf('! ', targetEnd),
        text.lastIndexOf('? ', targetEnd),
        text.lastIndexOf('！', targetEnd),
        text.lastIndexOf('？', targetEnd),
      ].filter((i) => i > windowStart);
      if (candidates.length > 0) {
        end = Math.max(...candidates) + 1;
      }
    }
    out.push(text.slice(cursor, end).trim());
    if (end >= text.length) break;
    cursor = Math.max(end - SECTION_OVERLAP_CHARS, cursor + 1);
  }
  return out.filter((s) => s.length > 0);
}

export async function summarize(params: SummarizeParams): Promise<string> {
  // Collect whatever the streaming version yields. Keeps the original
  // call-site (NotesView.handleGenerateSummary) working while new
  // call-sites can opt into the streamed generator for live progress.
  let out = '';
  for await (const delta of summarizeStream(params)) {
    if (delta.delta) out += delta.delta;
    else if (delta.phase === 'done' && delta.fullText) out = delta.fullText;
  }
  return out;
}

/** Progress event shape for `summarizeStream`. Callers subscribe to
 *  `delta` for streaming markdown output; `phase` changes let the UI
 *  show "producing section 3/5" style progress. */
export interface SummarizeStreamEvent {
  phase: 'map-start' | 'map-section-done' | 'reduce-start' | 'reduce-delta' | 'done';
  /** Total number of map sections (emitted on map-start). */
  sectionCount?: number;
  /** 1-based index of the section just completed (map-section-done). */
  sectionIndex?: number;
  /** Token delta to append to the running output (reduce-delta). */
  delta?: string;
  /** Full assembled text (emitted on done — useful for callers that
   *  only want the final string without accumulating deltas). */
  fullText?: string;
}

/**
 * Summarize a lecture. Short transcripts take the single-pass route;
 * long ones go map-reduce (per-section summaries in parallel, then a
 * streaming reducer combines them into the final note).
 *
 * The generator emits progress events so NotesView can render "正在
 * 摘要第 3/5 段..." style feedback instead of freezing for 30-60s on
 * a 90-minute class — the existing single-shot `summarize()` did
 * exactly that.
 */
export async function* summarizeStream(
  params: SummarizeParams,
): AsyncGenerator<SummarizeStreamEvent, void, void> {
  const { provider, model: defaultModel, providerId } = await activeProviderAndModel();
  const model = params.model ?? defaultModel;
  const system = buildSummarizeSystemPrompt(params.language);

  // Short path: single streaming call, no map step.
  if (params.content.length <= SUMMARIZE_MAP_REDUCE_THRESHOLD) {
    const messages: LLMMessage[] = [{ role: 'system', content: system }];
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
    yield { phase: 'reduce-start' };
    let fullText = '';
    let finalUsage: { inputTokens?: number; outputTokens?: number } | undefined;
    for await (const chunk of provider!.stream({
      model,
      messages,
      temperature: 0.3,
      maxTokens: 4096,
    })) {
      if (chunk.delta) {
        fullText += chunk.delta;
        yield { phase: 'reduce-delta', delta: chunk.delta };
      }
      if (chunk.done && chunk.usage) finalUsage = chunk.usage;
    }
    trackUsage(providerId, model, 'summarize', finalUsage);
    yield { phase: 'done', fullText };
    return;
  }

  // Long path: map-reduce.
  const sections = chunkForSummarization(params.content);
  yield { phase: 'map-start', sectionCount: sections.length };

  // MAP phase — each section gets a tight per-section summary. Limited
  // to MAP_PHASE_CONCURRENCY parallel requests so we don't trip over
  // provider rate limits on long lectures (previously: unbounded
  // Promise.all would fire 25+ concurrent requests for a 2-hour class
  // and 429 on the first one to queue).
  const sectionSummaries = await runWithConcurrency(sections, MAP_PHASE_CONCURRENCY, async (section, i) => {
    const sectionMessages: LLMMessage[] = [
      {
        role: 'system',
        content:
          `You are producing a compact study-note section from part of a lecture ` +
          `transcript. Output markdown only — no preamble, no framing like "In this ` +
          `section...". Focus on: key concepts, formulas / definitions if present, ` +
          `and one example if the passage gives one. ${params.language === 'zh' ? '以繁體中文。' : 'In English.'}`,
      },
      {
        role: 'user',
        content: `Section ${i + 1} of ${sections.length}:\n\n${section}`,
      },
    ];
    try {
      const res = await provider!.complete({
        model,
        messages: sectionMessages,
        temperature: 0.2,
        maxTokens: 1024,
      });
      trackUsage(providerId, model, 'summarize', res.usage);
      return res.content;
    } catch (err) {
      // Section-level failures must NOT blow up the whole summarisation.
      // Returning a placeholder lets the reduce step continue with
      // whatever succeeded — better to have a slightly patchy summary
      // than zero summary for the user.
      console.warn(`[summarizeStream] Section ${i + 1} failed, continuing without it:`, err);
      return `_[此段落摘要失敗：${err instanceof Error ? err.message : String(err)}]_`;
    }
  });

  // Report progress after concurrent map fan-in completes. The earlier
  // serial version emitted per-section progress; the concurrency-limited
  // version can't easily preserve original order without extra
  // bookkeeping, so we emit one batch-done event instead.
  for (let i = 1; i <= sections.length; i++) {
    yield { phase: 'map-section-done', sectionIndex: i, sectionCount: sections.length };
  }

  // REDUCE phase — stitch section summaries into a coherent study note,
  // streamed so the UI can render tokens as they arrive.
  //
  // Fallback on reduce failure: if the reducer crashes after we've spent
  // N LLM calls on section summaries, throwing them all away is wasteful.
  // We return the concatenated sections as a best-effort result so the
  // user at least sees the raw per-section notes.
  yield { phase: 'reduce-start', sectionCount: sections.length };

  const reduceMessages: LLMMessage[] = [
    { role: 'system', content: system },
  ];
  if (params.pdfContext) {
    reduceMessages.push({
      role: 'user',
      content: `Slides / PDF excerpts:\n\n${params.pdfContext.slice(0, 6000)}`,
    });
  }
  reduceMessages.push({
    role: 'user',
    content:
      `Combine these ${sections.length} per-section notes into one coherent study ` +
      `note for the full lecture${params.title ? ` "${params.title}"` : ''}. ` +
      `De-duplicate, impose a consistent section structure (overview, key concepts, ` +
      `examples, review questions), and keep every concrete detail. Do NOT mention ` +
      `that the input was split into sections.\n\n` +
      sectionSummaries.map((s, i) => `--- Section ${i + 1} ---\n${s}`).join('\n\n'),
  });

  let fullText = '';
  let finalUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    for await (const chunk of provider!.stream({
      model,
      messages: reduceMessages,
      temperature: 0.3,
      maxTokens: 4096,
    })) {
      if (chunk.delta) {
        fullText += chunk.delta;
        yield { phase: 'reduce-delta', delta: chunk.delta };
      }
      if (chunk.done && chunk.usage) finalUsage = chunk.usage;
    }
  } catch (err) {
    console.warn('[summarizeStream] Reduce failed, falling back to concatenated section summaries:', err);
    const header = params.language === 'zh'
      ? `> ⚠ 整合步驟失敗，以下為分段摘要直接串接（原因：${err instanceof Error ? err.message : String(err)}）\n\n`
      : `> ⚠ Reduce step failed; showing raw section summaries. Reason: ${err instanceof Error ? err.message : String(err)}\n\n`;
    const concatenated =
      header +
      sectionSummaries.map((s, i) => `## Section ${i + 1}\n\n${s}`).join('\n\n');
    // Emit the fallback as a single delta so the UI still renders it.
    yield { phase: 'reduce-delta', delta: concatenated };
    fullText = concatenated;
  }
  trackUsage(providerId, model, 'summarize', finalUsage);
  yield { phase: 'done', fullText };
}

export async function extractKeywords(text: string, max = 20): Promise<string[]> {
  // Low tier: keyword extraction is a pure structured-JSON task; a
  // mini-class model handles it fine and keeps the High quota
  // reserved for the chat + summary flows the user actually sees.
  const { provider, model } = await activeProviderAndModel('low');
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
  // Low tier: structured extraction into a fixed schema; mini models
  // handle this reliably and we keep the High pool available for
  // user-visible work.
  const { provider, model } = await activeProviderAndModel('low');
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
 * Translate a free-form query into the target language for cross-lingual
 * retrieval. Designed specifically for the RAG query path: our lecture
 * content is (mostly) English, but users frequently phrase questions in
 * Chinese. A purely multilingual embedder loses ~20 points on MTEB
 * English retrieval vs a dedicated English embedder — so instead of
 * lowering embedding quality, we normalise the query to English first
 * and keep the retrieval side monolingual.
 *
 * The original query is still passed to the final answering LLM, so the
 * user sees Chinese answers and the translation is invisible.
 *
 * Contract: returns the translated string on success; on any failure
 * (no provider, API error, non-sensical output) we return the original
 * query so retrieval degrades gracefully rather than breaking.
 *
 * Usage is recorded under task='chat' to keep the usage surface simple —
 * translation round-trips are small (~100 in / ~100 out) so they don't
 * materially change totals.
 */
export async function translateForRetrieval(
  query: string,
  targetLang: 'en' | 'zh' = 'en',
): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return query;
  try {
    // Low tier: translating a ~20-char query is the canonical cheap
    // task. Using flagship models here (previous behavior) burned
    // through the High pool -- every CJK question doubled as a High
    // request before the real chat even fired.
    const { provider, model, providerId } = await activeProviderAndModel('low');
    const targetName = targetLang === 'en' ? 'English' : 'Traditional Chinese';
    const res = await provider!.complete({
      model,
      messages: [
        {
          role: 'system',
          content:
            `You are a translation layer for a retrieval system. Translate the user's query into ${targetName}. ` +
            'Output ONLY the translation — no quotes, no explanation, no "Translation:" prefix. ' +
            'Preserve technical terms and named entities exactly. ' +
            'If the query is already in the target language, return it unchanged.',
        },
        { role: 'user', content: trimmed },
      ],
      temperature: 0,
      maxTokens: 256,
    });
    // Track as 'translate' (a small helper call), NOT 'chat' -- the
    // UI's AI 助教 token counter shows `usageTracker.latest('chat'/'chatStream')`,
    // and tagging translation as 'chat' polluted that reading with
    // the tiny ~80/8 token count of the Chinese→English translation.
    trackUsage(providerId, model, 'translate', res.usage);
    const out = res.content.trim();
    return out.length > 0 ? out : query;
  } catch (err) {
    // Graceful degradation: if translation fails, use the raw query.
    // Retrieval quality drops but the user still gets an answer.
    console.warn('[translateForRetrieval] fallback to raw query:', err);
    return query;
  }
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
  // Low tier: subtitle refinement fires continuously during live
  // recording -- can easily reach dozens of calls per lecture.
  // High-quota would exhaust in minutes. A mini model produces
  // acceptable ASR cleanup + translation quality.
  const { provider, model } = await activeProviderAndModel('low');

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
