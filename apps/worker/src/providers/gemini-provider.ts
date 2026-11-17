import type {
  LlmChatOptions,
  LlmEmbedOptions,
  LlmJsonOptions,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmStreamChunk,
  ModelTrainingPolicy
} from "@notebook-lm/shared";

export interface GeminiProviderConfig {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly defaultChatModel?: string | undefined;
  readonly defaultEmbedModel?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
}

export const DEFAULT_GEMINI_CHAT_MODEL = "gemini-2.5-flash";
export const DEFAULT_GEMINI_EMBED_MODEL = "gemini-embedding-001";
export const DEFAULT_GEMINI_EMBED_DIMENSIONS = 768;

interface GeminiContentPart {
  text?: string | undefined;
  inlineData?:
    | {
        mimeType: string;
        data: string;
      }
    | undefined;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiContentPart[];
}

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
    role?: string;
  };
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

interface GeminiBatchEmbedContentsResponse {
  embeddings?: Array<{
    values: number[];
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

function createFetchInit(method: string, body: string, signal?: AbortSignal): RequestInit {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    body
  };
  if (signal) {
    init.signal = signal;
  }
  return init;
}

/**
 * Lightweight, native fetch-based Google Gemini Provider (Issue #101).
 * Supports chat, streaming SSE, 768d embeddings and structured JSON output.
 * Fully compatible with Cloudflare Workers, Node.js and Browser environments.
 */
export class GeminiProvider implements LlmProvider {
  readonly id = "google";
  readonly name = "Google Gemini";
  readonly isLocal = false;
  readonly trainingPolicy: ModelTrainingPolicy = "free-tier-trained";

  private readonly apiKey?: string | undefined;
  private readonly baseUrl: string;
  private readonly defaultChatModel: string;
  private readonly defaultEmbedModel: string;
  private readonly fetch: typeof fetch;

  constructor(config: GeminiProviderConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/+$/,
      ""
    );
    this.defaultChatModel = config.defaultChatModel ?? DEFAULT_GEMINI_CHAT_MODEL;
    this.defaultEmbedModel = config.defaultEmbedModel ?? DEFAULT_GEMINI_EMBED_MODEL;
    this.fetch = config.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private resolveApiKey(overrideKey?: string): string {
    const key = overrideKey || this.apiKey;
    if (!key) {
      throw new Error("Gemini API-Key fehlt. Bitte BYOK API-Key uebergeben oder konfigurieren.");
    }
    return key;
  }

  private mapMessages(messages: readonly LlmMessage[]): {
    systemInstruction?: { parts: Array<{ text: string }> };
    contents: GeminiContent[];
  } {
    let systemText = "";
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        let textContent = "";
        if (typeof msg.content === "string") {
          textContent = msg.content;
        } else {
          textContent = msg.content
            .map((p) => p.text)
            .filter((t): t is string => Boolean(t))
            .join("\n");
        }
        systemText = systemText ? `${systemText}\n${textContent}` : textContent;
        continue;
      }

      const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";
      const parts: GeminiContentPart[] = [];

      if (typeof msg.content === "string") {
        parts.push({ text: msg.content });
      } else {
        for (const part of msg.content) {
          if (part.text) {
            parts.push({ text: part.text });
          }
          if (part.inlineData) {
            parts.push({
              inlineData: {
                mimeType: part.inlineData.mimeType,
                data: part.inlineData.data
              }
            });
          }
        }
      }

      contents.push({ role, parts });
    }

    return {
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      contents
    };
  }

  private mapFinishReason(raw?: string): "stop" | "max_tokens" | "safety" | "unknown" | undefined {
    if (!raw) return undefined;
    switch (raw) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "max_tokens";
      case "SAFETY":
      case "RECITATION":
        return "safety";
      default:
        return "unknown";
    }
  }

  async chat(messages: readonly LlmMessage[], options?: LlmChatOptions): Promise<LlmResponse> {
    const key = this.resolveApiKey(options?.apiKey);
    const model = options?.model ?? this.defaultChatModel;
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

    const { systemInstruction, contents } = this.mapMessages(messages);

    const generationConfig: Record<string, unknown> = {};
    if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options?.topP !== undefined) generationConfig.topP = options.topP;
    if (options?.maxOutputTokens !== undefined)
      generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (options?.stopSequences && options.stopSequences.length > 0)
      generationConfig.stopSequences = options.stopSequences;

    const payload: Record<string, unknown> = {
      contents
    };
    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }

    const res = await this.fetch(
      url,
      createFetchInit("POST", JSON.stringify(payload), options?.signal)
    );

    if (!res.ok) {
      const errorText = await res.text();
      let msg = errorText;
      try {
        const parsed = JSON.parse(errorText) as GeminiGenerateContentResponse;
        if (parsed.error?.message) {
          msg = parsed.error.message;
        }
      } catch {
        // Fallback to errorText
      }
      throw new Error(`Gemini API Fehler (${res.status}): ${msg}`);
    }

    const data = (await res.json()) as GeminiGenerateContentResponse;
    const firstCandidate = data.candidates?.[0];
    const parts = firstCandidate?.content?.parts;
    let text = "";
    if (parts) {
      for (const p of parts) {
        if (p.text) text += p.text;
      }
    }

    return {
      text,
      model,
      finishReason: this.mapFinishReason(firstCandidate?.finishReason),
      usage: data.usageMetadata
        ? {
            promptTokens: Number(data.usageMetadata.promptTokenCount),
            completionTokens: Number(data.usageMetadata.candidatesTokenCount),
            totalTokens: Number(data.usageMetadata.totalTokenCount)
          }
        : undefined,
      raw: data
    };
  }

  async *chatStream(
    messages: readonly LlmMessage[],
    options?: LlmChatOptions
  ): AsyncIterable<LlmStreamChunk> {
    const key = this.resolveApiKey(options?.apiKey);
    const model = options?.model ?? this.defaultChatModel;
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

    const { systemInstruction, contents } = this.mapMessages(messages);

    const generationConfig: Record<string, unknown> = {};
    if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options?.topP !== undefined) generationConfig.topP = options.topP;
    if (options?.maxOutputTokens !== undefined)
      generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (options?.stopSequences && options.stopSequences.length > 0)
      generationConfig.stopSequences = options.stopSequences;

    const payload: Record<string, unknown> = {
      contents
    };
    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }

    const res = await this.fetch(
      url,
      createFetchInit("POST", JSON.stringify(payload), options?.signal)
    );

    if (!res.ok) {
      const errorText = await res.text();
      let msg = errorText;
      try {
        const parsed = JSON.parse(errorText) as GeminiGenerateContentResponse;
        if (parsed.error?.message) {
          msg = parsed.error.message;
        }
      } catch {
        // Fallback
      }
      throw new Error(`Gemini Stream Fehler (${res.status}): ${msg}`);
    }

    if (!res.body) {
      throw new Error("Gemini Stream Antwort besitzt keinen Body.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lastNewline = buffer.lastIndexOf("\n");
        let chunkText = "";
        if (lastNewline !== -1) {
          chunkText = buffer.slice(0, lastNewline);
          buffer = buffer.slice(lastNewline + 1);
        } else {
          continue;
        }

        const lines = chunkText.split("\n");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const parsed = JSON.parse(jsonStr) as GeminiGenerateContentResponse;
            const candidate = parsed.candidates?.[0];
            const candidateParts = candidate?.content?.parts;
            let delta = "";
            if (candidateParts) {
              for (const p of candidateParts) {
                if (p.text) {
                  delta += p.text;
                } else {
                  // non-text part like inlineData
                }
              }
            }
            const isLastChunk =
              candidate?.finishReason !== undefined && candidate.finishReason !== null;

            yield {
              deltaText: delta,
              model,
              isDone: isLastChunk,
              finishReason: this.mapFinishReason(candidate?.finishReason),
              usage: parsed.usageMetadata
                ? {
                    promptTokens: Number(parsed.usageMetadata.promptTokenCount),
                    completionTokens: Number(parsed.usageMetadata.candidatesTokenCount),
                    totalTokens: Number(parsed.usageMetadata.totalTokenCount)
                  }
                : undefined
            };
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }

      if (buffer.trim().startsWith("data:")) {
        const jsonStr = buffer.trim().slice(5).trim();
        try {
          const parsed = JSON.parse(jsonStr) as GeminiGenerateContentResponse;
          const candidate = parsed.candidates?.[0];
          const candidateParts = candidate?.content?.parts;
          let delta = "";
          if (candidateParts) {
            for (const p of candidateParts) {
              if (p.text) delta += p.text;
            }
          }
          yield {
            deltaText: delta,
            model,
            isDone: true,
            finishReason: this.mapFinishReason(candidate?.finishReason)
          };
        } catch {
          // Ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embed(texts: readonly string[], options?: LlmEmbedOptions): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    const key = this.resolveApiKey(options?.apiKey);
    const model = options?.model ?? this.defaultEmbedModel;
    const outputDimensionality = options?.outputDimensionality ?? DEFAULT_GEMINI_EMBED_DIMENSIONS;

    const url = `${this.baseUrl}/models/${model}:batchEmbedContents?key=${encodeURIComponent(key)}`;
    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality
    }));

    const res = await this.fetch(
      url,
      createFetchInit("POST", JSON.stringify({ requests }), options?.signal)
    );

    if (!res.ok) {
      const errorText = await res.text();
      let msg = errorText;
      try {
        const parsed = JSON.parse(errorText) as GeminiBatchEmbedContentsResponse;
        if (parsed.error?.message) {
          msg = parsed.error.message;
        }
      } catch {
        // Fallback
      }
      throw new Error(`Gemini Embedding Fehler (${res.status}): ${msg}`);
    }

    const data = (await res.json()) as GeminiBatchEmbedContentsResponse;
    if (!data.embeddings || data.embeddings.length === 0) {
      throw new Error("Gemini hat keine Embeddings zurueckgegeben.");
    }

    return data.embeddings.map((emb) => new Float32Array(emb.values));
  }

  async generateJson<T>(
    messages: readonly LlmMessage[],
    schema?: Record<string, unknown>,
    options?: LlmJsonOptions<T>
  ): Promise<T> {
    const key = this.resolveApiKey(options?.apiKey);
    const model = options?.model ?? this.defaultChatModel;
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

    const { systemInstruction, contents } = this.mapMessages(messages);

    const generationConfig: Record<string, unknown> = {
      responseMimeType: "application/json"
    };

    if (schema) {
      generationConfig.responseSchema = schema;
    }
    if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options?.topP !== undefined) generationConfig.topP = options.topP;
    if (options?.maxOutputTokens !== undefined)
      generationConfig.maxOutputTokens = options.maxOutputTokens;

    const payload: Record<string, unknown> = {
      contents,
      generationConfig
    };
    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    const res = await this.fetch(
      url,
      createFetchInit("POST", JSON.stringify(payload), options?.signal)
    );

    if (!res.ok) {
      const errorText = await res.text();
      let msg = errorText;
      try {
        const parsed = JSON.parse(errorText) as GeminiGenerateContentResponse;
        if (parsed.error?.message) {
          msg = parsed.error.message;
        }
      } catch {
        // Fallback
      }
      throw new Error(`Gemini JSON Fehler (${res.status}): ${msg}`);
    }

    const data = (await res.json()) as GeminiGenerateContentResponse;
    const parts = data.candidates?.[0]?.content?.parts;
    let rawText = "";
    if (parts) {
      for (const p of parts) {
        if (p.text) rawText += p.text;
      }
    }

    if (!rawText.trim()) {
      throw new Error("Gemini hat eine leere JSON-Antwort geliefert.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      throw new Error(`Gemini JSON ungueltig: ${(err as Error).message}`);
    }

    if (options?.validator) {
      return options.validator(parsed);
    }

    return parsed as T;
  }

  async probeHealth(
    signal?: AbortSignal
  ): Promise<{ ok: boolean; message?: string; latencyMs: number }> {
    const start = performance.now();
    try {
      if (!this.apiKey) {
        return {
          ok: false,
          message: "Kein API-Key hinterlegt",
          latencyMs: Math.round(performance.now() - start)
        };
      }
      const url = `${this.baseUrl}/models/${this.defaultChatModel}?key=${encodeURIComponent(this.apiKey)}`;
      const init: RequestInit = {};
      if (signal) {
        init.signal = signal;
      }
      const res = await this.fetch(url, init);
      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        return { ok: true, latencyMs };
      }
      return {
        ok: false,
        message: `HTTP ${res.status}: ${res.statusText}`,
        latencyMs
      };
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        latencyMs: Math.round(performance.now() - start)
      };
    }
  }
}
