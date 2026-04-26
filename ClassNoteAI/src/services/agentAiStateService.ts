import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';

import {
  getProvider,
  listProviders,
  readPreferredProviderId,
  resolveActiveProvider,
} from './llm';

const UPDATE_COMMAND = 'agent_bridge_update_ai_state';

export type AgentAiProviderState = {
  id: string;
  name: string;
  authType: string;
  configured: boolean;
};

export type AgentAiState = {
  schemaVersion: 1;
  type: 'ai_config';
  source: 'renderer-llm';
  capturedAt: string;
  defaultProviderId: string | null;
  activeProviderId: string | null;
  readyForText: boolean;
  readyForVision: boolean;
  providers: AgentAiProviderState[];
};

export async function collectAgentAiState(): Promise<AgentAiState> {
  const defaultProviderId = await readPreferredProviderId();
  const providers = await Promise.all(
    listProviders().map(async (descriptor) => {
      let configured = false;
      try {
        configured = await getProvider(descriptor.id).isConfigured();
      } catch {
        configured = false;
      }
      return {
        id: descriptor.id,
        name: descriptor.displayName,
        authType: descriptor.authType,
        configured,
      };
    }),
  );

  const activeProvider = await resolveActiveProvider(defaultProviderId).catch(() => null);
  const models = activeProvider ? await activeProvider.listModels().catch(() => []) : [];

  return {
    schemaVersion: 1,
    type: 'ai_config',
    source: 'renderer-llm',
    capturedAt: new Date().toISOString(),
    defaultProviderId: defaultProviderId ?? null,
    activeProviderId: activeProvider?.descriptor.id ?? null,
    readyForText: Boolean(activeProvider),
    readyForVision: models.some((model) => model.capabilities?.vision),
    providers,
  };
}

export function useAgentAiStateBridge() {
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const publish = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (disposed) return;
        void collectAgentAiState()
          .then((state) => invoke(UPDATE_COMMAND, { state }))
          .catch(() => undefined);
      }, 100);
    };

    publish();
    const interval = window.setInterval(publish, 10_000);
    window.addEventListener('storage', publish);
    window.addEventListener('focus', publish);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener('storage', publish);
      window.removeEventListener('focus', publish);
    };
  }, []);
}
