/**
 * GitHub Models provider.
 *
 * Uses the user's GitHub Personal Access Token (with `models:read` scope).
 * Quota included with Copilot Pro/Business/Enterprise subscription.
 *
 * Wire format for chat completions is OpenAI-compatible, so we delegate
 * to the shared helper. Model discovery goes through the native GitHub
 * catalog endpoint so we always pick up the latest published ids
 * instead of shipping a stale hardcoded list.
 */

import { fetch } from '@tauri-apps/plugin-http';
import { keyStore } from '../keyStore';
import {
  completeOpenAICompatible,
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
const INFERENCE_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const CATALOG_ENDPOINT = 'https://models.github.ai/catalog/models';
const API_VERSION = '2026-03-10';
const AUTH_FIELD = 'pat';

/**
 * Safe fallback set if the catalog API is unreachable (offline, 5xx,
 * expired PAT). These IDs are verified as of April 2026; the dynamic
 * catalog is still the preferred source.
 */
const FALLBACK_MODELS: LLMModelInfo[] = [
  {
    id: 'openai/gpt-4.1',
    displayName: 'GPT-4.1 (OpenAI)',
    contextWindow: 1_000_000,
    capabilities: { streaming: true, jsonMode: true, vision: true },
  },
  {
    id: 'openai/gpt-4.1-mini',
    displayName: 'GPT-4.1 mini (OpenAI)',
    contextWindow: 1_000_000,
    capabilities: { streaming: true, jsonMode: true },
  },
  {
    id: 'openai/gpt-4o',
    displayName: 'GPT-4o (OpenAI)',
    contextWindow: 128_000,
    capabilities: { streaming: true, jsonMode: true, vision: true },
  },
  {
    id: 'openai/gpt-4o-mini',
    displayName: 'GPT-4o mini (OpenAI)',
    contextWindow: 128_000,
    capabilities: { streaming: true, jsonMode: true },
  },
];

export const githubModelsDescriptor: LLMProviderDescriptor = {
  id: PROVIDER_ID,
  displayName: 'GitHub Models',
  authType: 'pat',
  notes:
    'Uses your GitHub PAT (scope: models:read). Quota included with Copilot Pro/Business/Enterprise subscription.',
};

interface CatalogRow {
  id: string;
  name?: string;
  publisher?: string;
  capabilities?: string[];
  limits?: { max_input_tokens?: number; max_output_tokens?: number };
}

function mapCatalogRow(row: CatalogRow): LLMModelInfo {
  const streaming = row.capabilities?.includes('streaming') ?? true;
  const jsonMode = row.capabilities?.includes('structured-outputs') ?? undefined;
  const vision = row.capabilities?.some((c) => c.toLowerCase().includes('vision')) ?? undefined;
  const contextWindow = row.limits?.max_input_tokens;
  const displayName =
    row.name ? `${row.name}${row.publisher ? ` (${row.publisher})` : ''}` : row.id;
  return {
    id: row.id,
    displayName,
    contextWindow,
    capabilities: { streaming, jsonMode, vision },
  };
}

export class GitHubModelsProvider implements LLMProvider {
  readonly descriptor = githubModelsDescriptor;

  private cachedModels: LLMModelInfo[] | null = null;
  private cachedAt = 0;
  /** Re-fetch the catalog at most once per hour per process. */
  private static readonly CATALOG_TTL_MS = 60 * 60 * 1000;

  private config(): OpenAICompatConfig {
    const pat = keyStore.get(PROVIDER_ID, AUTH_FIELD);
    if (!pat) throw new LLMError('GitHub PAT not configured', 'auth', PROVIDER_ID);
    return {
      endpoint: INFERENCE_ENDPOINT,
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

  /**
   * Light-weight connection check: hit the catalog endpoint with the
   * user's PAT. Verifies both "PAT is valid" and "models:read scope is
   * granted" without consuming any inference quota.
   */
  async testConnection(): Promise<LLMTestResult> {
    const pat = keyStore.get(PROVIDER_ID, AUTH_FIELD);
    if (!pat) return { ok: false, message: 'No PAT saved.' };

    try {
      const res = await fetch(CATALOG_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
        },
      });
      if (res.ok) {
        const models = (await res.json()) as CatalogRow[];
        return {
          ok: true,
          message: `OK. ${models.length} model(s) available.`,
        };
      }
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message: `PAT rejected (HTTP ${res.status}). Check that the token has the models:read scope.`,
        };
      }
      return { ok: false, message: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, message: `Network error: ${String(err)}` };
    }
  }

  /**
   * Pull the current catalog from GitHub Models. Falls back to the
   * hardcoded FALLBACK_MODELS if the endpoint is unreachable, so the UI
   * never ends up with an empty model picker.
   */
  async listModels(): Promise<LLMModelInfo[]> {
    if (this.cachedModels && Date.now() - this.cachedAt < GitHubModelsProvider.CATALOG_TTL_MS) {
      return this.cachedModels;
    }

    const pat = keyStore.get(PROVIDER_ID, AUTH_FIELD);
    if (!pat) return FALLBACK_MODELS;

    try {
      const res = await fetch(CATALOG_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
        },
      });
      if (!res.ok) {
        console.warn('[GitHubModels] catalog fetch failed, falling back:', res.status);
        return FALLBACK_MODELS;
      }
      const rows = (await res.json()) as CatalogRow[];
      if (!Array.isArray(rows) || rows.length === 0) return FALLBACK_MODELS;

      const models = rows.map(mapCatalogRow);
      this.cachedModels = models;
      this.cachedAt = Date.now();
      return models;
    } catch (err) {
      console.warn('[GitHubModels] catalog unreachable, falling back:', err);
      return FALLBACK_MODELS;
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    try {
      return await completeOpenAICompatible(this.config(), request);
    } catch (err) {
      throw rewriteNoAccess(err, request.model);
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    try {
      yield* streamOpenAICompatible(this.config(), request);
    } catch (err) {
      throw rewriteNoAccess(err, request.model);
    }
  }
}

/**
 * Turn the raw `HTTP 403: {"error":{"code":"no_access",...}}` from the
 * inference endpoint into something a user can act on. The token is
 * usually fine (catalog reads work); what's missing is one of several
 * account-level enrollments. We observed this on 2026-04 while verifying
 * the provider end-to-end: catalog returned 43 models, every inference
 * call returned no_access until the account was enrolled in GitHub
 * Models via marketplace + Copilot settings.
 */
function rewriteNoAccess(err: unknown, modelId: string): unknown {
  if (!(err instanceof LLMError)) return err;
  if (err.kind !== 'auth') return err;
  if (!/no_access/i.test(err.message) && !/403/.test(err.message)) return err;
  return new LLMError(
    `GitHub 帳號尚未啟用 Models inference（model: ${modelId}）。請依序確認：\n` +
      `1. 到 https://github.com/settings/copilot 看最上方是否顯示 Copilot Free / Pro 為 active\n` +
      `2. 到 https://github.com/marketplace/models 點進任一模型的 Playground 並互動過一次（自動接受 ToS）\n` +
      `3. 若你在 organization 下，Org Owner 需在 Org Settings → Copilot → Models 開啟 inference\n\n` +
      `診斷指令（CLI）： gh models run openai/gpt-4o-mini "hi"\n` +
      `—— 若 CLI 也回 no_access，代表是帳號 entitlement 問題，跟此 app 無關。`,
    'auth',
    PROVIDER_ID,
  );
}
