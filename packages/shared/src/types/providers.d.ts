/**
 * Model capabilities and training policies for LLM providers.
 */
export type ModelTrainingPolicy = "zero-retention" | "free-tier-trained" | "air-gapped-local";

export interface ModelCapability {
  readonly id: string;
  readonly name: string;
  readonly provider: "google" | "ollama" | "openai" | "anthropic";
  readonly contextWindow: number;
  readonly supportsStreaming: boolean;
  readonly supportsEmbedding: boolean;
  readonly supportsJson: boolean;
  readonly supportsVision: boolean;
  readonly supportsAudio: boolean;
  readonly isLocal: boolean;
  readonly trainingPolicy: ModelTrainingPolicy;
  readonly defaultEmbeddingDimensions?: number | undefined;
}

export type LlmMessageRole = "system" | "user" | "assistant";

export interface LlmMessagePart {
  readonly text?: string | undefined;
  readonly inlineData?:
    | {
        readonly mimeType: string;
        readonly data: string; // Base64
      }
    | undefined;
}

export interface LlmMessage {
  readonly role: LlmMessageRole;
  readonly content: string | readonly LlmMessagePart[];
}

export interface LlmChatOptions {
  readonly model?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly temperature?: number | undefined;
  readonly topP?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly stopSequences?: readonly string[] | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface LlmEmbedOptions {
  readonly model?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly outputDimensionality?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface LlmJsonOptions<T = unknown> extends LlmChatOptions {
  readonly schema?: Record<string, unknown> | undefined;
  readonly schemaName?: string | undefined;
  readonly validator?: ((value: unknown) => T) | undefined;
}

export interface LlmTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface LlmResponse {
  readonly text: string;
  readonly model: string;
  readonly finishReason?: "stop" | "max_tokens" | "safety" | "unknown" | undefined;
  readonly usage?: LlmTokenUsage | undefined;
  readonly raw?: unknown;
}

export interface LlmStreamChunk {
  readonly deltaText: string;
  readonly model: string;
  readonly isDone: boolean;
  readonly finishReason?: "stop" | "max_tokens" | "safety" | "unknown" | undefined;
  readonly usage?: LlmTokenUsage | undefined;
}

/**
 * Universal LlmProvider abstraction (Issue #19, #101, #102).
 * Works across Cloudflare Workers, Node.js and Browser runtimes.
 */
export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;
  readonly trainingPolicy: ModelTrainingPolicy;

  chat(messages: readonly LlmMessage[], options?: LlmChatOptions): Promise<LlmResponse>;
  chatStream(
    messages: readonly LlmMessage[],
    options?: LlmChatOptions
  ): AsyncIterable<LlmStreamChunk>;
  embed(texts: readonly string[], options?: LlmEmbedOptions): Promise<Float32Array[]>;
  generateJson<T>(
    messages: readonly LlmMessage[],
    schema?: Record<string, unknown>,
    options?: LlmJsonOptions<T>
  ): Promise<T>;
  probeHealth?(signal?: AbortSignal): Promise<{ ok: boolean; message?: string; latencyMs: number }>;
}

/**
 * Routing request options for Auto-Router (Issue #19, #103).
 */
export type LlmTaskType = "chat" | "tts" | "coding" | "embedding" | "analysis";

export interface RouteModelRequest {
  readonly privacyMode?: boolean | undefined;
  readonly task?: LlmTaskType | undefined;
  readonly estimatedTokens?: number | undefined;
  readonly availableKeys?: readonly string[] | undefined; // ['google', 'openai', 'anthropic']
  readonly forceLocal?: boolean | undefined;
  readonly preferredModel?: string | undefined;
}

export interface RouteModelDecision {
  readonly provider: "google" | "ollama" | "openai" | "anthropic";
  readonly model: string;
  readonly reasoning: string;
  readonly isLocal: boolean;
  readonly trainingPolicy: ModelTrainingPolicy;
}

export interface ProviderCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly isLocal: boolean;
  readonly trainingPolicy: ModelTrainingPolicy;
  readonly models: readonly ModelCapability[];
  readonly configured: boolean;
}

export interface ProvidersListResponse {
  readonly providers: readonly ProviderCatalogEntry[];
  readonly autoDecisionDefault: RouteModelDecision;
}
