/**
 * Central registry of LLM providers.
 *
 * Callers in the app should go through this registry rather than
 * importing a specific provider class, so that swapping providers
 * (e.g. from GitHub Models to Anthropic direct) is a setting change
 * rather than a code change.
 */

import { ChatGPTOAuthProvider } from './providers/chatgpt-oauth';
import { GitHubModelsProvider } from './providers/github-models';
import { LLMProvider, LLMProviderDescriptor } from './types';

// v0.5.2 ships only the two providers we've actually verified end-to-end:
// GitHub Models (Copilot subscription PAT) and ChatGPT OAuth (Codex flow).
// Anthropic / OpenAI / Gemini API-key providers exist in git history and
// are re-addable when each is independently verified — removing them from
// the picker keeps us from silently shipping broken options. See README /
// CHANGELOG for the re-add roadmap.
const PROVIDERS: Record<string, () => LLMProvider> = {
  'github-models': () => new GitHubModelsProvider(),
  'chatgpt-oauth': () => new ChatGPTOAuthProvider(),
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
