/**
 * Google Gemini provider.
 *
 * Uses Gemini's OpenAI-compatible endpoint so we can reuse the shared
 * OpenAI-compat helpers. Auth is a Bearer API key obtained from AI
 * Studio (aistudio.google.com). Pay-per-token; Gemini Advanced
 * subscription (via Google One) does NOT grant API access.
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

const PROVIDER_ID = 'gemini';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const AUTH_FIELD = 'apiKey';

const CURATED_MODELS: LLMModelInfo[] = [
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 2_000_000, capabilities: { streaming: true, jsonMode: true, vision: true, audio: true } },
  { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextWindow: 1_000_000, capabilities: { streaming: true, jsonMode: true, vision: true, audio: true } },
  { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1_000_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash Lite', contextWindow: 1_000_000, capabilities: { streaming: true } },
];

export const geminiDescriptor: LLMProviderDescriptor = {
  id: PROVIDER_ID,
  displayName: 'Google Gemini (API key)',
  authType: 'apiKey',
  notes: 'API key from aistudio.google.com. Gemini Advanced / Google One subscriptions don\'t grant API access.',
};

export class GeminiProvider implements LLMProvider {
  readonly descriptor = geminiDescriptor;

  private config(): OpenAICompatConfig {
    const key = keyStore.get(PROVIDER_ID, AUTH_FIELD);
    if (!key) throw new LLMError('Gemini API key not configured', 'auth', PROVIDER_ID);
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
