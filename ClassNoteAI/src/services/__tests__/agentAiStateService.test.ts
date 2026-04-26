import { describe, expect, it, vi } from 'vitest';

const githubProvider = {
  descriptor: { id: 'github-models' },
  isConfigured: vi.fn(async () => true),
  listModels: vi.fn(async () => [
    { id: 'text-model', displayName: 'Text', capabilities: { streaming: true } },
  ]),
};
const chatgptProvider = {
  descriptor: { id: 'chatgpt-oauth' },
  isConfigured: vi.fn(async () => false),
  listModels: vi.fn(async () => []),
};

vi.mock('../llm', () => ({
  listProviders: vi.fn(() => [
    { id: 'github-models', displayName: 'GitHub Models', authType: 'pat' },
    { id: 'chatgpt-oauth', displayName: 'ChatGPT', authType: 'oauth' },
  ]),
  getProvider: vi.fn((id: string) => (id === 'github-models' ? githubProvider : chatgptProvider)),
  readPreferredProviderId: vi.fn(async () => 'github-models'),
  resolveActiveProvider: vi.fn(async () => githubProvider),
}));

import { collectAgentAiState } from '../agentAiStateService';

describe('agentAiStateService', () => {
  it('reports provider readiness without exposing credentials', async () => {
    const state = await collectAgentAiState();

    expect(state.type).toBe('ai_config');
    expect(state.defaultProviderId).toBe('github-models');
    expect(state.activeProviderId).toBe('github-models');
    expect(state.readyForText).toBe(true);
    expect(state.readyForVision).toBe(false);
    expect(state.providers).toEqual([
      { id: 'github-models', name: 'GitHub Models', authType: 'pat', configured: true },
      { id: 'chatgpt-oauth', name: 'ChatGPT', authType: 'oauth', configured: false },
    ]);
    expect(JSON.stringify(state)).not.toContain('token');
  });
});
