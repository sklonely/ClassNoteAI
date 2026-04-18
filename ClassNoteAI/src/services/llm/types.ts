/**
 * LLM Provider abstraction.
 *
 * All providers convert to/from this OpenAI-compatible shape so the rest
 * of the app never has to branch on which backend is in use.
 */

export type LLMRole = 'system' | 'user' | 'assistant';

/**
 * Multimodal content parts. Kept provider-neutral — each provider
 * translates these into its own wire format:
 *   - GitHub Models (Chat Completions): `{type:'text'}` / `{type:'image_url', image_url:{url}}`
 *   - ChatGPT OAuth (Codex Responses API): `{type:'input_text'}` / `{type:'input_image', image_url: <url>}`
 *   - Assistant replies come back as `output_text` in Responses API, plain string in Chat Completions.
 */
export interface LLMTextPart {
  type: 'text';
  text: string;
}

export interface LLMImagePart {
  type: 'image';
  /** Data URL (`data:image/png;base64,...`) or publicly fetchable http(s) URL.
   *  Providers will pass it through to the model as a vision input. */
  imageUrl: string;
  /** Many vision APIs support a `low` / `high` detail hint to trade tokens
   *  vs resolution. Default is `auto` (provider decides). */
  detail?: 'low' | 'high' | 'auto';
}

export type LLMContentPart = LLMTextPart | LLMImagePart;

export interface LLMMessage {
  role: LLMRole;
  /** Plain string (legacy / single-text messages) or an array of content
   *  parts (multimodal). Providers that don't support vision will reject
   *  image parts at the wire-format translation layer. */
  content: string | LLMContentPart[];
}

/** Returns true if the message contains any image part — useful for
 *  providers to decide whether the chosen model supports vision. */
export function messageHasImage(msg: LLMMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some((p) => p.type === 'image');
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
