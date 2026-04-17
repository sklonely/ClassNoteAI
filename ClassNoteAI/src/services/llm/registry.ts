/**
 * Central registry of LLM providers.
 *
 * Callers in the app should go through this registry rather than
 * importing a specific provider class, so that swapping providers
 * (e.g. from GitHub Models to Anthropic direct) is a setting change
 * rather than a code change.
 */

import { AnthropicProvider } from './providers/anthropic';
import { ChatGPTOAuthProvider } from './providers/chatgpt-oauth';
import { GeminiProvider } from './providers/gemini';
import { GitHubModelsProvider } from './providers/github-models';
import { OpenAIProvider } from './providers/openai';
import { LLMProvider, LLMProviderDescriptor } from './types';

const PROVIDERS: Record<string, () => LLMProvider> = {
  'github-models': () => new GitHubModelsProvider(),
  'chatgpt-oauth': () => new ChatGPTOAuthProvider(),
  anthropic: () => new AnthropicProvider(),
  openai: () => new OpenAIProvider(),
  gemini: () => new GeminiProvider(),
};

/** Cached instances so provider state (e.g. cached tokens) sticks around. */
const instances = new Map<string, LLMProvider>();

export function listProviders(): LLMProviderDescriptor[] {
  return Object.keys(PROVIDERS).map((id) => getProvider(id).descriptor);
}

export function getProvider(id: string): LLMProvider {
  let inst = instances.get(id);
  if (!inst) {
    const factory = PROVIDERS[id];
    if (!factory) throw new Error(`Unknown LLM provider: ${id}`);
    inst = factory();
    instances.set(id, inst);
  }
  return inst;
}

/**
 * Returns a provider that's currently configured (has credentials + passes
 * smoke-test), preferring the user's default if set. If none is ready,
 * returns null so callers can show a "set up AI" prompt.
 */
export async function resolveActiveProvider(preferredId?: string): Promise<LLMProvider | null> {
  const order = preferredId
    ? [preferredId, ...Object.keys(PROVIDERS).filter((id) => id !== preferredId)]
    : Object.keys(PROVIDERS);
  for (const id of order) {
    try {
      const p = getProvider(id);
      if (await p.isConfigured()) return p;
    } catch {
      // ignore unknown id in preferred slot
    }
  }
  return null;
}
