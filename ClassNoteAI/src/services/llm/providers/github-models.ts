/**
 * GitHub Models provider.
 *
 * Uses the user's GitHub Personal Access Token (with `models:read` scope).
 * Quota included with Copilot Pro/Business/Enterprise subscription.
 *
 * Wire format is OpenAI-compatible, so we delegate to the shared helper.
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

export class GitHubModelsProvider implements LLMProvider {
  readonly descriptor = githubModelsDescriptor;

  private config(): OpenAICompatConfig {
    const pat = keyStore.get(PROVIDER_ID, AUTH_FIELD);
    if (!pat) throw new LLMError('GitHub PAT not configured', 'auth', PROVIDER_ID);
    return {
      endpoint: ENDPOINT,
      providerId: PROVIDER_ID,
      headers: {
        Authorization: `Bearer ${pat}`,
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
      return { ok: false, message: 'No PAT saved.' };
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
