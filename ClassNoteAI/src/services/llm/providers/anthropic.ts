/**
 * Anthropic direct API provider.
 *
 * Uses a user-supplied API key (sk-ant-...) from the Anthropic console.
 * Pay-per-token, not subscription. Offered as an alternative for users
 * who want the latest Claude capabilities without going through GitHub
 * Models' curation lag.
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

const PROVIDER_ID = 'anthropic';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const AUTH_FIELD = 'apiKey';
const ANTHROPIC_VERSION = '2023-06-01';

const CURATED_MODELS: LLMModelInfo[] = [
  { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', contextWindow: 1_000_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', contextWindow: 200_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', contextWindow: 200_000, capabilities: { streaming: true } },
];

export const anthropicDescriptor: LLMProviderDescriptor = {
  id: PROVIDER_ID,
  displayName: 'Anthropic (direct API)',
  authType: 'apiKey',
  notes: 'Requires an API key from console.anthropic.com. Pay-per-token — separate from any Claude Pro subscription.',
};

function errorKindFromStatus(status: number): LLMErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'unknown';
}

/**
 * Split messages into Anthropic's schema: a top-level `system` string +
 * an alternating user/assistant array. If there are multiple system
 * messages they get concatenated with blank lines — this isn't lossless
 * but matches what the Anthropic SDK does.
 */
function toAnthropicFormat(request: LLMRequest): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const systems: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of request.messages) {
    if (m.role === 'system') {
      systems.push(m.content);
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  return {
    system: systems.length ? systems.join('\n\n') : undefined,
    messages,
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly descriptor = anthropicDescriptor;

  private apiKey(): string | null {
    return keyStore.get(PROVIDER_ID, AUTH_FIELD);
  }

  async isConfigured(): Promise<boolean> {
    return keyStore.has(PROVIDER_ID, AUTH_FIELD);
  }

  async testConnection(): Promise<LLMTestResult> {
    const key = this.apiKey();
    if (!key) return { ok: false, message: 'No API key saved.' };

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: this.buildHeaders(key),
        body: JSON.stringify({
          model: CURATED_MODELS[0].id,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
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
    const key = this.requireKey();
    const { system, messages } = toAnthropicFormat(request);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: this.buildHeaders(key),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new LLMError(`HTTP ${res.status}: ${errText.slice(0, 200)}`, errorKindFromStatus(res.status), PROVIDER_ID);
    }

    const data = await res.json();
    const textBlocks = Array.isArray(data.content) ? data.content.filter((b: any) => b.type === 'text') : [];
    return {
      content: textBlocks.map((b: any) => b.text).join(''),
      model: data.model ?? request.model,
      finishReason: mapFinishReason(data.stop_reason),
      usage: data.usage && {
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
      },
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const key = this.requireKey();
    const { system, messages } = toAnthropicFormat(request);

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: this.buildHeaders(key),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      const errText = !res.ok ? await res.text().catch(() => '') : '';
      throw new LLMError(`HTTP ${res.status}: ${errText.slice(0, 200)}`, errorKindFromStatus(res.status), PROVIDER_ID);
    }

    let lastUsage: LLMStreamChunk['usage'];
    let lastFinish: LLMStreamChunk['finishReason'];
    let inputTokens = 0;

    for await (const payload of parseSSE(res.body, request.signal)) {
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }

      // Anthropic event types: message_start, content_block_delta, message_delta, message_stop
      if (parsed.type === 'message_start') {
        inputTokens = parsed.message?.usage?.input_tokens ?? 0;
      } else if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
        yield { delta: parsed.delta.text ?? '', done: false };
      } else if (parsed.type === 'message_delta') {
        if (parsed.usage) {
          lastUsage = {
            inputTokens,
            outputTokens: parsed.usage.output_tokens ?? 0,
          };
        }
        if (parsed.delta?.stop_reason) lastFinish = mapFinishReason(parsed.delta.stop_reason);
      }
    }

    yield { delta: '', done: true, usage: lastUsage, finishReason: lastFinish };
  }

  // ---------- helpers ----------

  private requireKey(): string {
    const key = this.apiKey();
    if (!key) throw new LLMError('Anthropic API key not configured', 'auth', PROVIDER_ID);
    return key;
  }

  private buildHeaders(key: string): Record<string, string> {
    return {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }
}

function mapFinishReason(reason: string | null | undefined): LLMResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    default:
      return reason ? 'other' : undefined;
  }
}
