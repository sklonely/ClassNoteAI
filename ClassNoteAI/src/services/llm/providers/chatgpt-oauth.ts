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

const PROVIDER_ID = 'chatgpt-oauth';

// Codex's public OAuth client — reused here to leverage the user's
// ChatGPT subscription. This is not a private ClassNoteAI secret; it's
// the well-known identifier shipped in the Codex CLI binary.
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTHORIZE = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN = 'https://auth.openai.com/oauth/token';
const PREFERRED_CALLBACK_PORT = 1455;
const CALLBACK_PORT_MAX_ATTEMPTS = 10;
const CALLBACK_PATH = '/auth/callback';
const OAUTH_SCOPES = 'openid profile email offline_access';
const CALLBACK_TIMEOUT_SECS = 300;

function redirectUriFor(port: number): string {
  return `http://localhost:${port}${CALLBACK_PATH}`;
}

interface OAuthCallback {
  code: string;
  state: string;
}

// Responses API endpoint on the ChatGPT backend (not api.openai.com).
const RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

// Model catalog — the server requires a `client_version` query param.
// Any well-formed version string is accepted; Codex CLI sends its crate
// version so we send a placeholder here.
const MODELS_ENDPOINT = 'https://chatgpt.com/backend-api/codex/models';
const CLIENT_VERSION = '0.1.0';

// The Responses endpoint rejects POSTs missing `instructions`. If the
// caller didn't pass a system message we fall back to this minimal prompt
// so the request validates. Callers who want control should pass a real
// system message.
const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant.';

// Storage keys.
const FIELD_ACCESS_TOKEN = 'accessToken';
const FIELD_REFRESH_TOKEN = 'refreshToken';
const FIELD_EXPIRES_AT = 'expiresAt';

// Last-ditch fallback if the dynamic catalog fetch fails (network, expired
// token, endpoint rotated, etc.). `gpt-5.2` is the only model Codex+ChatGPT
// accounts can hit as of 2026-04; listing it alone here makes the picker
// not-empty in the degraded case.
const CURATED_MODELS: LLMModelInfo[] = [
  {
    id: 'gpt-5.2',
    displayName: 'gpt-5.2',
    contextWindow: 272_000,
    capabilities: { streaming: true, vision: true },
  },
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

function errorKindFromStatus(status: number, body?: string): LLMErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  // ChatGPT backend returns 404 (not 429) when the account's quota is
  // exhausted — observed field names `usage_limit_reached`,
  // `usage_not_included`. Promote these to `rate_limit` so UI shows the
  // right message instead of "endpoint not found".
  if (status === 404 && body && /usage_limit|usage_not_included|quota/i.test(body)) {
    return 'rate_limit';
  }
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

    const port = await invoke<number>('oauth_bind_port', {
      preferredPort: PREFERRED_CALLBACK_PORT,
      maxAttempts: CALLBACK_PORT_MAX_ATTEMPTS,
    });
    const redirectUri = redirectUriFor(port);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Codex-flow query params (mirror the official Codex CLI). Without
      // these the login page may silently fall back to a buggier older
      // flow that doesn't include org selection / simplified prompts.
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
    });
    const authUrl = `${OAUTH_AUTHORIZE}?${params.toString()}`;
    await openUrl(authUrl);

    const result = await invoke<OAuthCallback>('oauth_wait_for_code', {
      timeoutSecs: CALLBACK_TIMEOUT_SECS,
    });
    if (!result.code) throw new LLMError('OAuth callback missing `code`', 'auth', PROVIDER_ID);
    if (result.state !== state) throw new LLMError('OAuth state mismatch', 'auth', PROVIDER_ID);

    const tokens = await this.exchangeCodeForTokens(result.code, verifier, redirectUri);
    this.persistTokens(tokens);
    return tokens;
  }

  async signOut(): Promise<void> {
    keyStore.clear(PROVIDER_ID, FIELD_ACCESS_TOKEN);
    keyStore.clear(PROVIDER_ID, FIELD_REFRESH_TOKEN);
    keyStore.clear(PROVIDER_ID, FIELD_EXPIRES_AT);
  }

  /**
   * Abort an in-flight `signIn()` — tells the Rust callback listener to
   * stop waiting. The pending `signIn()` promise rejects shortly after
   * with `'OAuth sign-in cancelled.'`, which the caller can surface as
   * a friendly message.
   */
  async cancelSignIn(): Promise<void> {
    try {
      await invoke('oauth_cancel');
    } catch (err) {
      console.warn('[ChatGPTOAuth] cancel failed:', err);
    }
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

  /**
   * Pulls the live list of ChatGPT-subscription-accessible models from
   * `/backend-api/codex/models`. The server filters by account tier, so
   * a Plus user gets a different list than a Pro / Enterprise user.
   * Falls back to the single-entry `CURATED_MODELS` if the endpoint is
   * unreachable (offline, token expired, etc.) so the picker isn't empty.
   */
  async listModels(): Promise<LLMModelInfo[]> {
    const token = await this.freshAccessToken().catch(() => null);
    if (!token) return CURATED_MODELS;
    try {
      const url = `${MODELS_ENDPOINT}?client_version=${encodeURIComponent(CLIENT_VERSION)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return CURATED_MODELS;
      const data = (await res.json()) as { models?: Array<Record<string, unknown>> };
      if (!Array.isArray(data.models) || data.models.length === 0) return CURATED_MODELS;
      return data.models.map((m) => {
        const modalities = (m.input_modalities as string[] | undefined) ?? [];
        return {
          id: (m.slug as string) ?? 'unknown',
          displayName: (m.display_name as string) ?? (m.slug as string) ?? 'unknown',
          contextWindow: (m.context_window as number | undefined),
          capabilities: {
            streaming: true,
            vision: modalities.includes('image'),
          },
        };
      });
    } catch {
      return CURATED_MODELS;
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // The Codex Responses endpoint ONLY accepts stream=true. We honor
    // that server-side requirement by always streaming, and — for
    // non-streaming callers — aggregate deltas ourselves.
    let text = '';
    let lastChunk: LLMStreamChunk | undefined;
    for await (const chunk of this.stream(request)) {
      if (chunk.delta) text += chunk.delta;
      if (chunk.done) lastChunk = chunk;
    }
    return {
      content: text,
      model: request.model,
      finishReason: lastChunk?.finishReason,
      usage: lastChunk?.usage,
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const token = await this.freshAccessToken();
    const body = this.buildResponsesBody(request, true);

    const res = await fetch(RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: {
        ...this.authHeaders(token),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok || !res.body) {
      const errText = !res.ok ? await res.text().catch(() => '') : '';
      throw new LLMError(
        `HTTP ${res.status}: ${errText.slice(0, 200)}`,
        errorKindFromStatus(res.status, errText),
        PROVIDER_ID,
      );
    }

    let usage: LLMStreamChunk['usage'];
    let finishReason: LLMStreamChunk['finishReason'];

    for await (const payload of parseSSE(res.body, request.signal)) {
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      // Responses-API event envelope format:
      //   - response.output_text.delta  → { delta: "...text..." }
      //   - response.completed          → { response: { usage, status, ... } }
      // Other events (response.created / response.content_part.added /
      // response.output_text.done / ...) are informational.
      switch (parsed.type) {
        case 'response.output_text.delta':
          if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
            yield { delta: parsed.delta, done: false };
          }
          break;
        case 'response.completed': {
          const r = parsed.response;
          if (r?.usage) {
            usage = {
              inputTokens: r.usage.input_tokens ?? 0,
              outputTokens: r.usage.output_tokens ?? 0,
            };
          }
          finishReason = mapStatus(r?.status);
          break;
        }
        case 'response.failed':
        case 'error':
          throw new LLMError(
            `Stream error: ${JSON.stringify(parsed).slice(0, 200)}`,
            'provider',
            PROVIDER_ID,
          );
      }
    }

    yield { delta: '', done: true, usage, finishReason };
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
        errorKindFromStatus(res.status, errText),
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
        errorKindFromStatus(res.status, errText),
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
      // `originator` identifies us to the backend as a Codex-family caller
      // so feature-gates match the official CLI.
      'OpenAI-Beta': 'responses=v1',
      originator: 'codex_cli_rs',
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
    // Responses API content parts have a different type union than
    // Chat Completions: `input_text` / `input_image` for user messages,
    // `output_text` for assistant turns. See
    // https://platform.openai.com/docs/api-reference/responses
    type ResponsesPart =
      | { type: 'input_text'; text: string }
      | { type: 'output_text'; text: string }
      | { type: 'input_image'; image_url: string; detail?: 'low' | 'high' | 'auto' };
    const input: Array<{ role: 'user' | 'assistant'; content: ResponsesPart[] }> = [];
    for (const m of request.messages) {
      // System messages collapse into top-level `instructions` — they
      // don't support multipart content in the Responses API, and
      // passing images to a system role would be meaningless anyway.
      if (m.role === 'system') {
        const text = typeof m.content === 'string'
          ? m.content
          : m.content
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('\n');
        systems.push(text);
        continue;
      }
      const parts: ResponsesPart[] = [];
      if (typeof m.content === 'string') {
        parts.push({
          type: m.role === 'assistant' ? 'output_text' : 'input_text',
          text: m.content,
        });
      } else {
        for (const p of m.content) {
          if (p.type === 'text') {
            parts.push({
              type: m.role === 'assistant' ? 'output_text' : 'input_text',
              text: p.text,
            });
          } else {
            // Responses API takes image_url as a string (not {url:...}).
            const part: ResponsesPart = { type: 'input_image', image_url: p.imageUrl };
            if (p.detail && p.detail !== 'auto') part.detail = p.detail;
            parts.push(part);
          }
        }
      }
      input.push({ role: m.role, content: parts });
    }
    const body: Record<string, unknown> = {
      model: request.model,
      input,
      store: false,
      stream,
      // Server rejects requests missing `instructions` (400 "Instructions
      // are required"). If no system message was supplied we fall back to
      // a minimal neutral prompt so validation passes.
      instructions: systems.length ? systems.join('\n\n') : DEFAULT_INSTRUCTIONS,
      // Reasoning-capable Codex models (gpt-5.2 etc.) need encrypted
      // reasoning state included in stateless mode (store=false). Sending
      // this always is cheap on non-reasoning paths and matches what the
      // official Codex CLI ships.
      include: ['reasoning.encrypted_content'],
    };
    // Responses API uses `text.format`, not Chat Completions'
    // `response_format`. When the caller asked for jsonMode, force the
    // model to emit a valid top-level JSON object instead of prose — this
    // makes extractSyllabus / future JSON tasks robust against the model
    // drifting into markdown code fences.
    if (request.jsonMode) {
      body.text = { format: { type: 'json_object' } };
    }
    // NOTE: Codex's Responses backend rejects several parameters the
    // public Responses API accepts (observed 2026-04: `max_output_tokens`
    // → 400, `temperature` → 400 on gpt-5.2). The account-tier-filtered
    // model set seems to hard-code most inference params server-side,
    // leaving us effectively read-only on sampling. Don't add these back
    // without re-probing — start with the minimum required body.
    return body;
  }
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

