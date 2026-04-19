/**
 * Shared request/response helpers for OpenAI Chat Completions-compatible
 * endpoints: OpenAI Platform, GitHub Models, Google Gemini's OpenAI
 * compat layer, Azure OpenAI, etc.
 *
 * Providers build the auth headers themselves, then hand off to these
 * helpers for the wire-level work.
 */

import { fetch } from '@tauri-apps/plugin-http';
import { parseSSE } from './sse';
import { LLMError, LLMErrorKind, LLMMessage, LLMRequest, LLMResponse, LLMStreamChunk } from './types';

/**
 * Translate our provider-neutral `LLMMessage` to the Chat Completions
 * wire shape. Plain strings pass through unchanged; multimodal content
 * arrays become `[{type:'text', text}, {type:'image_url', image_url:{url, detail?}}]`.
 *
 * Kept as a pure function so provider authors don't hand-roll the
 * conversion and accidentally diverge. A separate translator lives in
 * `chatgpt-oauth.ts` because the Responses API uses different type
 * names (`input_text` / `input_image`).
 */
export function toOpenAIChatMessage(msg: LLMMessage): Record<string, unknown> {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content };
  }
  const parts = msg.content.map((p) => {
    if (p.type === 'text') {
      return { type: 'text', text: p.text };
    }
    // image
    const image: Record<string, unknown> = { url: p.imageUrl };
    if (p.detail && p.detail !== 'auto') image.detail = p.detail;
    return { type: 'image_url', image_url: image };
  });
  return { role: msg.role, content: parts };
}

export interface OpenAICompatConfig {
  endpoint: string;
  headers: Record<string, string>;
  providerId: string;
  /** Some providers (Gemini) rename/strip fields; lets us rewrite the body at the edge. */
  transformBody?: (body: Record<string, unknown>, request: LLMRequest) => Record<string, unknown>;
}

/**
 * Substrings that appear in 400-status error bodies from the major
 * providers when the real cause is "prompt too long", not a malformed
 * request. Ported from opencode's error.ts OVERFLOW_PATTERNS bank. Keep
 * this list conservative — it's only consulted on HTTP 400 where the
 * body ruling decides between `context_length` and `unknown`.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /context[_ ]length/i,
  /context[_ ]window/i,
  /too many tokens/i,
  /maximum context/i,
  /exceeds the maximum/i,
  /input is too long/i,
  /prompt is too long/i,
  /reduce the length/i,
];

export function errorKindFromStatus(status: number, body?: string): LLMErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 413) return 'unknown'; // payload-too-large: caller sent too much, not a context_length issue
  if (status === 400 && body) {
    for (const re of CONTEXT_OVERFLOW_PATTERNS) {
      if (re.test(body)) return 'context_length';
    }
  }
  if (status >= 500) return 'provider';
  return 'unknown';
}

function buildBody(request: LLMRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(toOpenAIChatMessage),
    stream,
  };
  // OpenAI streaming only emits the `usage` object when the caller
  // explicitly opts in. Without this, `parsed.usage` is always
  // undefined, `chatStream` records no token count, and the UI's
  // "in X out Y tokens" footer either shows 0/0 or falls through
  // to a stale non-stream entry (e.g. the translation call) -- the
  // user sees something like "in 80 out 8" on a 500-word reply.
  if (stream) body.stream_options = { include_usage: true };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

export async function completeOpenAICompatible(
  config: OpenAICompatConfig,
  request: LLMRequest
): Promise<LLMResponse> {
  let body = buildBody(request, false);
  if (config.transformBody) body = config.transformBody(body, request);

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify(body),
    signal: request.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new LLMError(
      `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      errorKindFromStatus(res.status, errText),
      config.providerId
    );
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    model: data.model ?? request.model,
    finishReason: choice?.finish_reason,
    usage: data.usage && {
      inputTokens: data.usage.prompt_tokens ?? 0,
      outputTokens: data.usage.completion_tokens ?? 0,
    },
  };
}

export async function* streamOpenAICompatible(
  config: OpenAICompatConfig,
  request: LLMRequest
): AsyncIterable<LLMStreamChunk> {
  let body = buildBody(request, true);
  if (config.transformBody) body = config.transformBody(body, request);

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: config.headers,
    body: JSON.stringify(body),
    signal: request.signal,
  });

  if (!res.ok || !res.body) {
    const errText = !res.ok ? await res.text().catch(() => '') : '';
    throw new LLMError(
      `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      errorKindFromStatus(res.status, errText),
      config.providerId
    );
  }

  let lastUsage: LLMStreamChunk['usage'];
  let lastFinish: LLMStreamChunk['finishReason'];

  for await (const payload of parseSSE(res.body, request.signal)) {
    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const choice = parsed.choices?.[0];
    const delta = choice?.delta?.content ?? '';
    if (choice?.finish_reason) lastFinish = choice.finish_reason;
    if (parsed.usage) {
      lastUsage = {
        inputTokens: parsed.usage.prompt_tokens ?? 0,
        outputTokens: parsed.usage.completion_tokens ?? 0,
      };
    }
    if (delta) yield { delta, done: false };
  }

  yield { delta: '', done: true, usage: lastUsage, finishReason: lastFinish };
}

/** Smoke-test helper: posts the minimal legal request to check auth. */
export async function smokeTestOpenAICompatible(
  config: OpenAICompatConfig,
  modelId: string
): Promise<{ ok: boolean; message: string }> {
  try {
    let body: Record<string, unknown> = {
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
    };
    if (config.transformBody) {
      body = config.transformBody(body, {
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
      });
    }

    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, message: `Authenticated against ${config.endpoint}` };
    const errText = await res.text().catch(() => '');
    return { ok: false, message: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
