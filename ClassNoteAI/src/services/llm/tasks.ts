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

// cp75.4: pulled out into ./defaultProvider.ts — per-user scoped + no
// longer clobbered by keyStore.clearAll(). Same source-of-truth used by
// AIProviderSettings UI.
import { getDefaultProvider } from './defaultProvider';

function preferredProvider(): string | undefined {
  return getDefaultProvider();
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
  const provider = await resolveActiveProvider(preferredProvider());
  if (!provider) {
    throw new LLMError(
      '尚未設定雲端 AI 提供商，請到「個人頁 → 雲端 AI 助理」設一個。',
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
  /**
   * Optional `AbortSignal` for cancellation. When fired the streaming
   * generator throws a `DOMException('Aborted', 'AbortError')` and the
   * underlying fetch is cancelled (passed through to provider.complete /
   * provider.stream → openai-compat fetch).
   *
   * TODO Sprint 3 W8 caller adoption: ReviewPage retry / regen 應 new
   *   AbortController() on click cancel + pass `signal: ac.signal` 給
   *   `summarizeStream`. Same for `chatStream` from the AI 助教 panel.
   */
  signal?: AbortSignal;
}

/** Throw the standard AbortError when a signal has fired. Centralises the
 *  shape so callers (and tests) can branch on `err.name === 'AbortError'`
 *  consistently. Mirrors what the WHATWG fetch / DOM spec emit on abort. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
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
 *  show "producing section 3/5" style progress.
 *
 *  W7 (Phase 7): when a per-section map call fails, the generator now
 *  yields a `partial-failure` event in addition to the existing inline
 *  placeholder. UI can use this to surface "1/6 段失敗" without parsing
 *  the markdown body. */
export interface SummarizeStreamEvent {
  phase:
    | 'map-start'
    | 'map-section-done'
    | 'partial-failure'
    | 'reduce-start'
    | 'reduce-delta'
    | 'done';
  /** Total number of map sections (emitted on map-start). */
  sectionCount?: number;
  /** 1-based index of the section just completed (map-section-done). */
  sectionIndex?: number;
  /** 0-based index of the section that failed (partial-failure). */
  failedSectionIndex?: number;
  /** Human-readable error message for the failed section
   *  (partial-failure). */
  error?: string;
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
  // Cancel-before-start: if the caller already aborted (e.g. user
  // mashed cancel before the first network round-trip), surface that
  // immediately rather than burning a model lookup.
  throwIfAborted(params.signal);

  const { provider, model: defaultModel, providerId } = await activeProviderAndModel();
  const model = params.model ?? defaultModel;
  const system = buildSummarizeSystemPrompt(params.language);

  throwIfAborted(params.signal);

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
      signal: params.signal,
    })) {
      // Mid-stream abort check: even if fetch's own AbortController
      // cancels the underlying connection, a stream chunk that's
      // already buffered may still be delivered to us by the SSE
      // parser. Drop it on the floor and exit cleanly.
      throwIfAborted(params.signal);
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
  //
  // W7 (Phase 7): each per-section call is wrapped in try/catch and
  // failures collapse to a placeholder + a `failures[]` entry. We yield
  // a `partial-failure` event for each failed section AFTER the
  // concurrency-limited fan-in completes (yielding from inside
  // runWithConcurrency would interleave with parallel work in
  // surprising ways — easier to reason about a flat post-fan-in
  // emission).
  const failures: Array<{ index: number; error: string }> = [];
  const sectionSummaries = await runWithConcurrency(sections, MAP_PHASE_CONCURRENCY, async (section, i) => {
    // Per-section abort check — bail out of in-flight sections without
    // burning more LLM calls. The throw bubbles through Promise.all
    // and out of runWithConcurrency.
    throwIfAborted(params.signal);

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
        signal: params.signal,
      });
      trackUsage(providerId, model, 'summarize', res.usage);
      return res.content;
    } catch (err) {
      // Aborts must propagate, not collapse to placeholders — the
      // user explicitly asked us to stop, so don't keep going on
      // their other sections and don't pretend the call "failed".
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof Error && err.name === 'AbortError') throw err;
      // Section-level failures must NOT blow up the whole summarisation.
      // Returning a placeholder lets the reduce step continue with
      // whatever succeeded — better to have a slightly patchy summary
      // than zero summary for the user.
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[summarizeStream] Section ${i + 1} failed, continuing without it:`, err);
      failures.push({ index: i, error: errMsg });
      return `_[此段摘要失敗 · ${errMsg}]_`;
    }
  });

  // After fan-in: emit per-section progress in deterministic order
  // (the concurrency limiter doesn't preserve issue order otherwise),
  // and surface every map-phase failure as its own event so callers
  // can render "1/N 段失敗" without scanning the markdown body.
  for (let i = 1; i <= sections.length; i++) {
    yield { phase: 'map-section-done', sectionIndex: i, sectionCount: sections.length };
  }
  for (const failure of failures) {
    yield {
      phase: 'partial-failure',
      failedSectionIndex: failure.index,
      sectionCount: sections.length,
      error: failure.error,
    };
  }

  throwIfAborted(params.signal);

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
      signal: params.signal,
    })) {
      throwIfAborted(params.signal);
      if (chunk.delta) {
        fullText += chunk.delta;
        yield { phase: 'reduce-delta', delta: chunk.delta };
      }
      if (chunk.done && chunk.usage) finalUsage = chunk.usage;
    }
  } catch (err) {
    // Aborts win over the graceful-fallback path — a user who pressed
    // cancel does not want us to dump 4000 chars of concatenated
    // section summaries into their note.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof Error && err.name === 'AbortError') throw err;
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

export interface TeachingPerson {
  name: string;
  email?: string;
  office_hours?: string;
}

export interface SyllabusInfo {
  topic?: string;
  /** 2–3 句話的課程簡介 (AI 生成)。 */
  overview?: string;
  /**
   * 上課時間。為了 weekParse 能消費，**請用 24 小時 HH:MM-HH:MM 格式**
   * 配合中文週幾（週一、週三）或英文縮寫（Mon, Wed），例如：
   *   "週一、週三 14:00-15:50"
   *   "Mon, Wed 14:00-15:50"
   */
  time?: string;
  location?: string;
  /** 課程開始日期 (ISO YYYY-MM-DD)。AI 抓得到再填，不亂猜。 */
  start_date?: string;
  /** 課程結束日期 (ISO YYYY-MM-DD)。 */
  end_date?: string;

  // 老師（v0.7：結構化）
  instructor?: string;            // 姓名（純字串，舊欄位；v0.7 仍填以維持顯示）
  instructor_email?: string;
  instructor_office_hours?: string;

  // Legacy: 老師單一 OH 字串（v0.7 推薦用 instructor_office_hours）
  office_hours?: string;

  // 助教（v0.7：結構化）
  teaching_assistants?: string;            // legacy 字串（v0.7 也填，逗號分隔姓名）
  teaching_assistant_list?: TeachingPerson[];
  ta_office_hours?: string;                // 助教共用 OH（個別 TA 沒指定時用）

  grading?: { item: string; percentage: string }[];
  /**
   * 每堂課的主題列表 (Lecture 1, Lecture 2, …)。
   * v0.7 起以 *Lecture* (一次上課) 為單位，**不是「每週」** —
   * 一週可能多堂或無堂。
   *
   * 規則（v0.7+）：
   *   - 若大綱中有明確的 per-lecture 主題列表 → 抽進來。
   *   - 若大綱只列「課程進度大綱」/「Course Calendar」/「Course Summary」
   *     而那實際上是作業 / 月曆事件，**不要把它們當 lecture 主題**。
   *   - 若沒有明確 lecture 主題，留空 — 後續可由前端從 start_date /
   *     end_date / 上課頻率自動產生 "Lecture 1", "Lecture 2", ...
   */
  schedule?: string[];
}

export interface ExtractSyllabusOptions {
  targetLanguage?: 'zh' | 'en';
  /**
   * 已存在的 syllabus 內容（不含 metadata）。傳入後 AI 改成 merge 模式：
   *   - 看得到既有欄位 → 不重複抽
   *   - 只填缺的欄位
   *   - 不覆寫 / 不無中生有
   */
  existing?: Partial<SyllabusInfo> & Record<string, unknown>;
}

export async function extractSyllabus(
  title: string,
  description: string | undefined,
  optionsOrTargetLanguage: ExtractSyllabusOptions | 'zh' | 'en' = {},
): Promise<SyllabusInfo> {
  // Backward-compat: older callers pass a target language string directly.
  const options: ExtractSyllabusOptions =
    typeof optionsOrTargetLanguage === 'string'
      ? { targetLanguage: optionsOrTargetLanguage }
      : optionsOrTargetLanguage;
  const targetLanguage: 'zh' | 'en' = options.targetLanguage ?? 'zh';
  const existing = options.existing && Object.keys(options.existing).length > 0
    ? options.existing
    : undefined;
  // Low tier: structured extraction into a fixed schema; mini models
  // handle this reliably and we keep the High pool available for
  // user-visible work.
  const { provider, model } = await activeProviderAndModel('low');

  // v0.7 schema — see SyllabusInfo above. Structured TA list + separate
  // instructor / TA office hours so the edit page can surface per-person
  // info; explicitly retire the "weekly schedule" framing in favor of
  // per-Lecture items.
  //
  // v0.7+ merge mode: when `existing` is provided, the prompt instructs
  // the model to fill ONLY what's missing — never overwrite existing
  // values, never invent new info. Re-runs are additive.
  const isMerge = !!existing;
  const sys =
    targetLanguage === 'zh'
      ? `從使用者提供的課程大綱抽取結構化資訊並回傳 JSON。

JSON 欄位定義：
- topic (string): 課程主題，一句話。
- overview (string): 2-3 句話的課程簡介；總結這堂課要學什麼、適合哪些學生。
- time (string): 上課時間。**請用 24 小時 HH:MM-HH:MM 格式 + 中文週幾或英文 Mon/Tue 縮寫**，例如 "週一、週三 14:00-15:50" 或 "Mon, Wed 14:00-15:50"。**不要用 12 小時 am/pm**。多天用「、」或「,」分隔。
- location (string): 上課地點。
- start_date (string, ISO YYYY-MM-DD): 學期/課程開始日期。**只有大綱明確寫到才填**，不要瞎猜。
- end_date (string, ISO YYYY-MM-DD): 學期/課程結束日期。同上規則。
- instructor (string): 授課老師姓名。
- instructor_email (string): 授課老師 Email。
- instructor_office_hours (string): 授課老師個人 office hours，e.g. "週四 14:00-16:00 / 工程館 502"。
- teaching_assistant_list (array): 助教清單，每位 { name: string, email?: string, office_hours?: string }。即使只有姓名也填進來。
- ta_office_hours (string): 助教**共用** office hours；只有個別助教沒寫自己的 OH 時才用這個。
- grading (array): 評分組成，每項 { item: string, percentage: string }，e.g. {"item":"期中考","percentage":"30%"}。
- schedule (array of string): **每堂課的主題清單**。

關於 schedule（重要）：
- 只有當大綱裡有**明確的 per-lecture 主題列表**時才填（例如「Lecture 1: HCI 簡介」/「W1: 什麼是 UI」）。
- **不要**把這些當 lecture 主題：作業列表（Assignment 1, Project Part 2 …）、Canvas 的 Course Summary（那通常是月曆事件 / 作業 due date）、考試日期、活動。
- 若 Week N 明確列了多個小主題，可以拆成多個 Lecture 條目；否則一週一條也行。
- **大綱沒列 lecture 主題就不要填 schedule**。前端會用 start_date / end_date / 上課頻率自動產出 "Lecture 1, Lecture 2, ..." 占位。
- **每條 entry 若大綱寫得出對應日期，請在開頭加 (MM/DD) 前綴**，例：'(04/15) Backpropagation' 或 '(04/15) 反向傳播'。沒對應日期就直接寫主題，不要瞎猜日期。前端會用這個前綴判斷哪些 lecture 已經過期 / 哪些還沒上。

通則（最重要）：
- 不要瞎猜、不要無中生有 — 大綱沒明說的東西**永遠別填**，欄位省略即可。
- email / OH 抽不到就不要填。
${
  isMerge
    ? `\n本次為「補缺模式」，下面是已經存在的欄位：
${JSON.stringify(existing, null, 2)}

規則：
- 已經有非空值的欄位**完全不要動**（不要回傳該欄位）。
- 只回傳目前是空 / 缺的欄位。
- 如果原始大綱本來就沒寫到該欄位，**直接省略**，不要硬補。
- 不要把已經有的內容「改寫得更好」— 使用者編輯過的東西要尊重。`
    : ''
}`
      : `Extract structured syllabus info from the user's course description. Return JSON.

Schema:
- topic (string): One-line course theme.
- overview (string): 2-3 sentence summary.
- time (string): Class meeting time. **Use 24-hour HH:MM-HH:MM format with Chinese weekday (週一/週三) or English abbrev (Mon, Wed)**, e.g. "Mon, Wed 14:00-15:50". **No 12-hour am/pm**.
- location (string).
- start_date (ISO YYYY-MM-DD): Course start date. ONLY if explicitly stated; don't guess.
- end_date (ISO YYYY-MM-DD): Course end date. Same rule.
- instructor (string).
- instructor_email (string).
- instructor_office_hours (string).
- teaching_assistant_list (array of { name, email?, office_hours? }).
- ta_office_hours (string): SHARED TA OH only.
- grading (array of { item, percentage }).
- schedule (array of string): Per-LECTURE topic list.

About schedule (IMPORTANT):
- Fill ONLY when the syllabus explicitly lists per-lecture topics ("Lecture 1: …" / "W1: Intro to HCI").
- DO NOT treat as lecture topics: assignment lists, Canvas "Course Summary" (which is usually due-dates), exam dates, course-meta events.
- Leave empty when the syllabus has no per-lecture topic list — the frontend will auto-generate "Lecture 1, Lecture 2, ..." placeholders from start_date / end_date / meeting frequency.
- **If the syllabus pairs each lecture with a specific date, prefix the entry with (MM/DD)**, e.g. '(04/15) Backpropagation'. Skip the prefix when the date isn't stated. The frontend uses this to mark past-but-not-recorded lectures.

General rules (MOST IMPORTANT):
- Don't guess. If the syllabus doesn't explicitly state something, OMIT the field. Never invent.
- Don't fill emails / OH that aren't written.
${
  isMerge
    ? `\nThis is a MERGE pass. Existing fields:
${JSON.stringify(existing, null, 2)}

Rules:
- DO NOT modify fields that already have non-empty values — don't even include them in your response.
- Return ONLY fields currently empty / missing.
- If the source genuinely doesn't say, OMIT — don't backfill blindly.
- Respect the user's edits.`
    : ''
}`;

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
    maxTokens: 4096,
  });
  trackUsage(provider!.descriptor.id, model, 'syllabus', res.usage);
  try {
    const parsed = JSON.parse(res.content) as SyllabusInfo;
    return normaliseSyllabus(parsed, existing as SyllabusInfo | undefined);
  } catch {
    return {};
  }
}

/**
 * Defensive post-processing on the raw AI JSON:
 *   - in merge mode: existing non-empty values win over AI output
 *     (defense-in-depth: the prompt already tells the model not to
 *     return existing fields, but the model might re-emit them anyway)
 *   - back-fill legacy `instructor` / `teaching_assistants` / `office_hours`
 *     strings from the new structured fields, so existing displays
 *     (CourseDetailPage etc.) that read the old shape keep working.
 *   - drop empty TA list entries.
 */
function normaliseSyllabus(s: SyllabusInfo, existing?: SyllabusInfo): SyllabusInfo {
  const out: SyllabusInfo = { ...s };

  // ─── Merge guard ────────────────────────────────────────────
  if (existing) {
    function isFilled(v: unknown): boolean {
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim().length > 0;
      return v != null;
    }
    for (const [k, v] of Object.entries(existing)) {
      if (isFilled(v)) {
        // Force existing value to win — never let AI overwrite.
        (out as Record<string, unknown>)[k] = v;
      }
    }
  }

  // ─── TA list cleanup ────────────────────────────────────────
  if (Array.isArray(out.teaching_assistant_list)) {
    const cleaned = out.teaching_assistant_list
      .filter((t) => t && typeof t.name === 'string' && t.name.trim().length > 0)
      .map((t) => ({
        name: t.name.trim(),
        email: typeof t.email === 'string' && t.email.trim() ? t.email.trim() : undefined,
        office_hours:
          typeof t.office_hours === 'string' && t.office_hours.trim()
            ? t.office_hours.trim()
            : undefined,
      }));
    out.teaching_assistant_list = cleaned.length > 0 ? cleaned : undefined;
  }

  // ─── Legacy back-fills ──────────────────────────────────────
  // teaching_assistants (joined names) when only the structured list is set
  if (!out.teaching_assistants && out.teaching_assistant_list) {
    out.teaching_assistants = out.teaching_assistant_list
      .map((t) => t.name)
      .filter((n) => n && n.length > 0)
      .join('、');
    if (!out.teaching_assistants) delete out.teaching_assistants;
  }

  // office_hours <- instructor_office_hours
  if (!out.office_hours && out.instructor_office_hours) {
    out.office_hours = out.instructor_office_hours;
  }

  return out;
}

export async function chat(
  messages: LLMMessage[],
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  // TODO Sprint 3 W8 caller adoption: callers (AI 助教 panel, etc.) 應
  //   new AbortController() on mount + pass `signal: ac.signal` so a
  //   user navigating away mid-request actually cancels HTTP, not just
  //   hides the spinner.
  throwIfAborted(options.signal);
  const { provider, model } = await activeProviderAndModel();
  throwIfAborted(options.signal);
  const res = await provider!.complete({
    model,
    messages,
    temperature: 0.3,
    maxTokens: 2048,
    signal: options.signal,
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

/** Stream a chat response token-by-token. Caller receives incremental deltas.
 *
 * TODO Sprint 3 W8 caller adoption: ReviewPage retry / regen 應 new
 *   AbortController() on click cancel + pass `signal: ac.signal` 給
 *   `chatStream`. The AI 助教 chat panel should do the same on
 *   navigation-away.
 */
export async function* chatStream(
  messages: LLMMessage[],
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<string, void, void> {
  throwIfAborted(options.signal);
  const { provider, model } = await activeProviderAndModel();
  throwIfAborted(options.signal);
  let finalUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  for await (const chunk of provider!.stream({
    model,
    messages,
    temperature: 0.3,
    maxTokens: 2048,
    signal: options.signal,
  })) {
    throwIfAborted(options.signal);
    if (chunk.delta) yield chunk.delta;
    if (chunk.done && chunk.usage) {
      finalUsage = chunk.usage;
    }
  }
  trackUsage(provider!.descriptor.id, model, 'chatStream', finalUsage);
}
