/**
 * GitHub Models provider.
 *
 * Uses the user's GitHub Personal Access Token (with `models:read` scope)
 * or a Copilot Pro/Business/Enterprise subscription to call the
 * OpenAI-compatible inference endpoint at https://models.github.ai.
 *
 * Model catalog is a curated subset — GitHub Models hosts dozens of
 * models but only a handful are useful for transcription refinement.
 */

import { fetch } from '@tauri-apps/plugin-http';
import { keyStore } from '../keyStore';
import { parseSSE } from '../sse';
import {
  LLMError,
  LLMErrorKind,
  LLMModelInfo,
  LLMProvider,
  LLMProviderDescriptor,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMTestResult,
} from '../types';

const PROVIDER_ID = 'github-models';
const ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const AUTH_FIELD = 'pat';

const CURATED_MODELS: LLMModelInfo[] = [
  { id: 'openai/gpt-5.4', displayName: 'GPT-5.4 (OpenAI)', contextWindow: 272_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'openai/gpt-5.4-mini', displayName: 'GPT-5.4 mini (OpenAI)', contextWindow: 272_000, capabilities: { streaming: true, jsonMode: true } },
  { id: 'anthropic/claude-4.6-sonnet', displayName: 'Claude 4.6 Sonnet (Anthropic)', contextWindow: 200_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'anthropic/claude-opus-4.7', displayName: 'Claude Opus 4.7 (Anthropic)', contextWindow: 1_000_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'meta/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B Instruct (Meta)', contextWindow: 128_000, capabilities: { streaming: true } },
  { id: 'xai/grok-3', displayName: 'Grok 3 (xAI)', contextWindow: 131_072, capabilities: { streaming: true } },
];

export const githubModelsDescriptor: LLMProviderDescriptor = {
  id: PROVIDER_ID,
  displayName: 'GitHub Models',
  authType: 'pat',
  notes: 'Uses your GitHub PAT (scope: models:read). Quota included with Copilot Pro/Business/Enterprise subscription.',
};

function errorKindFromStatus(status: number): LLMErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'unknown';
}

export class GitHubModelsProvider implements LLMProvider {
  readonly descriptor = githubModelsDescriptor;

  private pat(): string | null {
    return keyStore.get(PROVIDER_ID, AUTH_FIELD);
  }

  async isConfigured(): Promise<boolean> {
    return keyStore.has(PROVIDER_ID, AUTH_FIELD);
  }

  async testConnection(): Promise<LLMTestResult> {
    const pat = this.pat();
    if (!pat) return { ok: false, message: 'No PAT saved.' };

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: this.buildHeaders(pat),
        body: JSON.stringify({
          model: CURATED_MODELS[0].id,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      if (res.ok) return { ok: true, message: `Authenticated against ${ENDPOINT}` };
      const body = await res.text();
      return { ok: false, message: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  async listModels(): Promise<LLMModelInfo[]> {
    return CURATED_MODELS;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const pat = this.requirePat();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: this.buildHeaders(pat),
      body: JSON.stringify(this.buildBody(request, false)),
      signal: request.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new LLMError(`HTTP ${res.status}: ${body.slice(0, 200)}`, errorKindFromStatus(res.status), PROVIDER_ID);
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

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const pat = this.requirePat();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: this.buildHeaders(pat),
      body: JSON.stringify(this.buildBody(request, true)),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      const body = !res.ok ? await res.text().catch(() => '') : '';
      throw new LLMError(`HTTP ${res.status}: ${body.slice(0, 200)}`, errorKindFromStatus(res.status), PROVIDER_ID);
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

  // ---------- helpers ----------

  private requirePat(): string {
    const pat = this.pat();
    if (!pat) throw new LLMError('GitHub PAT not configured', 'auth', PROVIDER_ID);
    return pat;
  }

  private buildHeaders(pat: string): Record<string, string> {
    return {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private buildBody(request: LLMRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.jsonMode) body.response_format = { type: 'json_object' };
    return body;
  }
}
