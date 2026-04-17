/**
 * OpenAI Platform provider (direct API, pay-per-token).
 *
 * Not a subscription channel — ChatGPT Plus/Pro doesn't grant general API
 * access. Users who want subscription-based access should use either the
 * GitHubModels provider (via Copilot Pro) or the ChatGPTOAuth provider
 * added in a later PR (unofficial channel).
 */

import { keyStore } from '../keyStore';
import {
  completeOpenAICompatible,
  smokeTestOpenAICompatible,
  streamOpenAICompatible,
  type OpenAICompatConfig,
} from '../openai-compat';
import {
  LLMError,
  LLMModelInfo,
  LLMProvider,
  LLMProviderDescriptor,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  LLMTestResult,
} from '../types';

const PROVIDER_ID = 'openai';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const AUTH_FIELD = 'apiKey';

const CURATED_MODELS: LLMModelInfo[] = [
  { id: 'gpt-5.4', displayName: 'GPT-5.4', contextWindow: 272_000, capabilities: { streaming: true, jsonMode: true, vision: true, audio: true } },
  { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini', contextWindow: 272_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'gpt-5.4-nano', displayName: 'GPT-5.4 nano', contextWindow: 272_000, capabilities: { streaming: true, jsonMode: true } },
  { id: 'o3', displayName: 'o3 (reasoning)', contextWindow: 200_000, capabilities: { streaming: true, jsonMode: true } },
  { id: 'o3-mini', displayName: 'o3 mini (reasoning)', contextWindow: 200_000, capabilities: { streaming: true, jsonMode: true } },
];

export const openaiDescriptor: LLMProviderDescriptor = {
  id: PROVIDER_ID,
  displayName: 'OpenAI Platform (API key)',
  authType: 'apiKey',
  notes: 'Pay-per-token API billing. Separate from any ChatGPT Plus/Pro subscription — those don\'t grant API access.',
};

export class OpenAIProvider implements LLMProvider {
  readonly descriptor = openaiDescriptor;

  private config(): OpenAICompatConfig {
    const key = keyStore.get(PROVIDER_ID, AUTH_FIELD);
    if (!key) throw new LLMError('OpenAI API key not configured', 'auth', PROVIDER_ID);
    return {
      endpoint: ENDPOINT,
      providerId: PROVIDER_ID,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
  }

  async isConfigured(): Promise<boolean> {
    return keyStore.has(PROVIDER_ID, AUTH_FIELD);
  }

  async testConnection(): Promise<LLMTestResult> {
    if (!keyStore.has(PROVIDER_ID, AUTH_FIELD)) {
      return { ok: false, message: 'No API key saved.' };
    }
    return smokeTestOpenAICompatible(this.config(), CURATED_MODELS[0].id);
  }

  async listModels(): Promise<LLMModelInfo[]> {
    return CURATED_MODELS;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return completeOpenAICompatible(this.config(), request);
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    yield* streamOpenAICompatible(this.config(), request);
  }
}
