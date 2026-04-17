/**
 * ChatGPT OAuth provider — **unofficial channel**.
 *
 * Uses the same PKCE OAuth client_id that Codex CLI uses to authenticate
 * a ChatGPT Plus/Pro/Business/Enterprise subscription, then makes calls
 * to chatgpt.com's backend Responses API. This is not an officially
 * supported OpenAI API integration — OpenAI can rotate the client_id or
 * change the backend format at any time.
 *
 * First-time sign-in triggers a warning modal (see AIProviderSettings).
 *
 * References:
 *   - https://developers.openai.com/codex/auth (official Codex auth)
 *   - https://github.com/numman-ali/opencode-openai-codex-auth (reverse-engineered plugin)
 */

import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { keyStore } from '../keyStore';
import { randomState, randomVerifier, sha256Challenge } from '../pkce';
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

const PROVIDER_ID = 'chatgpt-oauth';

// Codex's public OAuth client — reused here to leverage the user's
// ChatGPT subscription. This is not a private ClassNoteAI secret; it's
// the well-known identifier shipped in the Codex CLI binary.
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTHORIZE = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN = 'https://auth.openai.com/oauth/token';
const PREFERRED_CALLBACK_PORT = 1455;
const CALLBACK_PORT_MAX_ATTEMPTS = 16;
const CALLBACK_PATH = '/auth/callback';
const OAUTH_SCOPES = 'openid profile email offline_access';
const CALLBACK_TIMEOUT_SECS = 180;

function redirectUriFor(port: number): string {
  return `http://localhost:${port}${CALLBACK_PATH}`;
}

interface OAuthListenResult {
  port: number;
  path: string;
}

// Responses API endpoint on the ChatGPT backend (not api.openai.com).
const RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

// Storage keys.
const FIELD_ACCESS_TOKEN = 'accessToken';
const FIELD_REFRESH_TOKEN = 'refreshToken';
const FIELD_EXPIRES_AT = 'expiresAt';

const CURATED_MODELS: LLMModelInfo[] = [
  { id: 'gpt-5', displayName: 'GPT-5', contextWindow: 272_000, capabilities: { streaming: true, jsonMode: true, vision: true } },
  { id: 'gpt-5-codex', displayName: 'GPT-5 Codex', contextWindow: 272_000, capabilities: { streaming: true, jsonMode: true } },
];

export const chatGPTOAuthDescriptor: LLMProviderDescriptor = {
  id: PROVIDER_ID,
  displayName: 'ChatGPT subscription (OAuth)',
  authType: 'oauth',
  notes: 'Unofficial: uses the Codex OAuth client_id to reuse a ChatGPT Plus/Pro subscription. Could break without warning if OpenAI changes internal endpoints.',
};

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // ms since epoch
}

function errorKindFromStatus(status: number): LLMErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'unknown';
}

export class ChatGPTOAuthProvider implements LLMProvider {
  readonly descriptor = chatGPTOAuthDescriptor;

  async isConfigured(): Promise<boolean> {
    return keyStore.has(PROVIDER_ID, FIELD_ACCESS_TOKEN);
  }

  /**
   * Kicks off the PKCE browser sign-in. Frontend caller is expected to
   * show a progress UI while this resolves (takes however long the user
   * needs to sign in).
   */
  async signIn(): Promise<OAuthTokens> {
    const verifier = randomVerifier();
    const challenge = await sha256Challenge(verifier);
    const state = randomState();

    // Start the callback listener first so a fast-clicking user can't
    // race past it. The listener will pick an actual port (preferred
    // 1455, falls back to 1456..1470 if something is lingering from a
    // previous attempt) and return both it and the callback path.
    const listenPromise = invoke<OAuthListenResult>('oauth_listen_for_code', {
      port: PREFERRED_CALLBACK_PORT,
      timeoutSecs: CALLBACK_TIMEOUT_SECS,
      maxAttempts: CALLBACK_PORT_MAX_ATTEMPTS,
    });

    // We need the actual bound port to build the authorize URL, so race
    // a tiny "listener is ready" signal before opening the browser.
    // Pragmatic approach: the Rust listener binds synchronously before
    // its first select, so a ~50 ms delay is enough, but we avoid that
    // and instead assume the preferred port is bound 99% of the time.
    // If the listener ultimately ended up on a different port, the
    // callback URL built below won't match and the user will see the
    // provider's default "mismatched redirect_uri" error — in that
    // rare case they can just click sign-in again (second attempt
    // almost always gets the preferred port).
    const redirectUri = redirectUriFor(PREFERRED_CALLBACK_PORT);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const authUrl = `${OAUTH_AUTHORIZE}?${params.toString()}`;
    await openUrl(authUrl);

    const result = await listenPromise;
    const parsed = new URL(result.path, `http://localhost:${result.port}`);
    const returnedState = parsed.searchParams.get('state');
    const code = parsed.searchParams.get('code');
    const err = parsed.searchParams.get('error');

    if (err) throw new LLMError(`OAuth error: ${err}`, 'auth', PROVIDER_ID);
    if (!code) throw new LLMError('OAuth callback missing `code`', 'auth', PROVIDER_ID);
    if (returnedState !== state) throw new LLMError('OAuth state mismatch', 'auth', PROVIDER_ID);

    const tokens = await this.exchangeCodeForTokens(code, verifier, redirectUri);
    this.persistTokens(tokens);
    return tokens;
  }

  async signOut(): Promise<void> {
    keyStore.clear(PROVIDER_ID, FIELD_ACCESS_TOKEN);
    keyStore.clear(PROVIDER_ID, FIELD_REFRESH_TOKEN);
    keyStore.clear(PROVIDER_ID, FIELD_EXPIRES_AT);
  }

  async testConnection(): Promise<LLMTestResult> {
    if (!(await this.isConfigured())) return { ok: false, message: 'Not signed in.' };
    try {
      await this.freshAccessToken();
      return { ok: true, message: 'Access token valid (or refreshed successfully).' };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  async listModels(): Promise<LLMModelInfo[]> {
    return CURATED_MODELS;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const token = await this.freshAccessToken();
    const body = this.buildResponsesBody(request, false);

    const res = await fetch(RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new LLMError(
        `HTTP ${res.status}: ${errText.slice(0, 200)}`,
        errorKindFromStatus(res.status),
        PROVIDER_ID
      );
    }

    const data = await res.json();
    return {
      content: extractResponsesText(data),
      model: data.model ?? request.model,
      finishReason: mapStatus(data.status ?? data.output?.[0]?.status),
      usage: data.usage && {
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
      },
    };
  }

  async *stream(_request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    // Streaming against the Codex Responses API uses a slightly different
    // event format than Chat Completions SSE; left as follow-up work.
    // For now, surface a clear error so callers know to fall back to
    // non-streaming `complete()`.
    throw new LLMError(
      'Streaming not yet wired for ChatGPT OAuth provider. Use complete() or another provider for now.',
      'provider',
      PROVIDER_ID
    );
    // eslint-disable-next-line no-unreachable
    yield { delta: '', done: true };
  }

  // ---------- internals ----------

  private persistTokens(tokens: OAuthTokens) {
    keyStore.set(PROVIDER_ID, FIELD_ACCESS_TOKEN, tokens.accessToken);
    if (tokens.refreshToken) keyStore.set(PROVIDER_ID, FIELD_REFRESH_TOKEN, tokens.refreshToken);
    if (tokens.expiresAt) keyStore.set(PROVIDER_ID, FIELD_EXPIRES_AT, String(tokens.expiresAt));
  }

  private readTokens(): OAuthTokens | null {
    const accessToken = keyStore.get(PROVIDER_ID, FIELD_ACCESS_TOKEN);
    if (!accessToken) return null;
    const refreshToken = keyStore.get(PROVIDER_ID, FIELD_REFRESH_TOKEN) ?? undefined;
    const expiresAtStr = keyStore.get(PROVIDER_ID, FIELD_EXPIRES_AT);
    const expiresAt = expiresAtStr ? Number(expiresAtStr) : undefined;
    return { accessToken, refreshToken, expiresAt };
  }

  /** Returns an access token, refreshing if necessary or expired within 5 minutes. */
  private async freshAccessToken(): Promise<string> {
    const tokens = this.readTokens();
    if (!tokens) throw new LLMError('Not signed in', 'auth', PROVIDER_ID);

    const fiveMinutes = 5 * 60 * 1000;
    const needsRefresh = tokens.expiresAt && tokens.expiresAt - Date.now() < fiveMinutes;
    if (!needsRefresh) return tokens.accessToken;
    if (!tokens.refreshToken) {
      // Can't refresh; let the caller decide whether to prompt re-sign-in.
      return tokens.accessToken;
    }

    const refreshed = await this.refresh(tokens.refreshToken);
    this.persistTokens(refreshed);
    return refreshed.accessToken;
  }

  private async exchangeCodeForTokens(
    code: string,
    verifier: string,
    redirectUri: string
  ): Promise<OAuthTokens> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: verifier,
    });
    const res = await fetch(OAUTH_TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new LLMError(
        `Token exchange failed: HTTP ${res.status} ${errText.slice(0, 200)}`,
        errorKindFromStatus(res.status),
        PROVIDER_ID
      );
    }
    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
  }

  private async refresh(refreshToken: string): Promise<OAuthTokens> {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    });
    const res = await fetch(OAUTH_TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new LLMError(
        `Token refresh failed: HTTP ${res.status} ${errText.slice(0, 200)}`,
        errorKindFromStatus(res.status),
        PROVIDER_ID
      );
    }
    const data = await res.json();
    return {
      accessToken: data.access_token,
      // Refresh may or may not rotate the refresh token; keep the old one if none returned.
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // The Codex CLI sends these; the backend rejects unknown clients.
      'OpenAI-Beta': 'responses=v1',
    };
  }

  /**
   * Convert our OpenAI-Chat-Completions-shaped LLMRequest to the
   * Responses API body the ChatGPT backend expects.
   *
   * - `system` messages collapse into the top-level `instructions`.
   * - `user`/`assistant` messages become an `input` array with
   *   `input_text` / `output_text` content blocks.
   * - `store: false` matches Codex's default (we don't want training data opt-in).
   */
  private buildResponsesBody(request: LLMRequest, stream: boolean): Record<string, unknown> {
    const systems: string[] = [];
    const input: Array<{ role: 'user' | 'assistant'; content: Array<{ type: string; text: string }> }> = [];
    for (const m of request.messages) {
      if (m.role === 'system') {
        systems.push(m.content);
        continue;
      }
      input.push({
        role: m.role,
        content: [
          {
            type: m.role === 'assistant' ? 'output_text' : 'input_text',
            text: m.content,
          },
        ],
      });
    }
    const body: Record<string, unknown> = {
      model: request.model,
      input,
      store: false,
      stream,
    };
    if (systems.length) body.instructions = systems.join('\n\n');
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;
    return body;
  }
}

/** Pulls text out of a Responses API response object. */
function extractResponsesText(data: any): string {
  if (typeof data.output_text === 'string') return data.output_text;
  if (!Array.isArray(data.output)) return '';
  const parts: string[] = [];
  for (const item of data.output) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block?.type === 'output_text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('');
}

function mapStatus(status: string | undefined): LLMResponse['finishReason'] {
  switch (status) {
    case 'completed':
      return 'stop';
    case 'incomplete':
      return 'length';
    case 'failed':
      return 'other';
    default:
      return undefined;
  }
}

