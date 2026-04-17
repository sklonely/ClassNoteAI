/**
 * LLM Provider abstraction.
 *
 * All providers convert to/from this OpenAI-compatible shape so the rest
 * of the app never has to branch on which backend is in use.
 */

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  /** Provider-specific model id, e.g. `gpt-5.4`, `claude-4.6-sonnet`. */
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider to return structured JSON. Not every provider supports this; a provider may ignore it. */
  jsonMode?: boolean;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'other';
  usage?: LLMUsage;
}

export interface LLMStreamChunk {
  /** Incremental text delta. */
  delta: string;
  /** Only present on the final chunk. */
  done: boolean;
  /** Only present on the final chunk. */
  usage?: LLMUsage;
  finishReason?: LLMResponse['finishReason'];
}

/** How the provider authenticates. */
export type LLMAuthType = 'pat' | 'apiKey' | 'oauth';

/** Describes one model the provider exposes. */
export interface LLMModelInfo {
  id: string;
  displayName: string;
  contextWindow?: number;
  capabilities?: {
    streaming?: boolean;
    jsonMode?: boolean;
    vision?: boolean;
    audio?: boolean;
  };
}

/** Provider-level descriptor used by the UI and registry. */
export interface LLMProviderDescriptor {
  id: string;
  displayName: string;
  authType: LLMAuthType;
  /** Short human-readable caveats (e.g. "uses Copilot Pro quota", "unofficial channel"). */
  notes?: string;
}

export interface LLMProvider {
  readonly descriptor: LLMProviderDescriptor;

  /** Returns true once credentials exist and a smoke-test has passed. */
  isConfigured(): Promise<boolean>;

  /** Called after the user enters credentials; should verify them against the provider. */
  testConnection(): Promise<LLMTestResult>;

  /** The models this provider currently exposes. May hit the network. */
  listModels(): Promise<LLMModelInfo[]>;

  /** Single-shot completion. */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /** Streaming completion. */
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

export interface LLMTestResult {
  ok: boolean;
  /** Human-readable detail — error message or success summary. */
  message: string;
}

/** Errors from providers should use this class so callers can branch. */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly kind: LLMErrorKind,
    public readonly providerId?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export type LLMErrorKind =
  | 'auth'           // 401/403 — credentials invalid
  | 'rate_limit'     // 429
  | 'quota'          // subscription quota exceeded
  | 'context_length' // input too long for model
  | 'network'        // fetch/timeout
  | 'provider'       // 5xx or malformed response
  | 'cancelled'      // AbortSignal fired
  | 'unknown';
