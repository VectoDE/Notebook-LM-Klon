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

export interface OllamaProviderConfig {
  readonly baseUrl?: string | undefined;
  readonly defaultChatModel?: string | undefined;
  readonly defaultEmbedModel?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
}

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_CHAT_MODEL = "llama3";
export const DEFAULT_OLLAMA_EMBED_MODEL = "nomic-embed-text";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[] | undefined;
}

interface OllamaChatResponse {
  model?: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface OllamaEmbeddingsResponse {
  embedding?: number[];
  error?: string;
}

interface OllamaEmbedApiResponse {
  embeddings?: number[][];
  error?: string;
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
 * Local browser & server Ollama adapter (Issue #102).
 * Communicates directly with localhost:11434 or tunnel endpoint.
 * Marked as air-gapped-local privacy mode (zero cloud data transfer).
 */
export class OllamaLocalProvider implements LlmProvider {
  readonly id = "ollama";
  readonly name = "Ollama (Lokal & Air-Gapped)";
  readonly isLocal = true;
  readonly trainingPolicy: ModelTrainingPolicy = "air-gapped-local";

  private readonly baseUrl: string;
  private readonly defaultChatModel: string;
  private readonly defaultEmbedModel: string;
  private readonly fetch: typeof fetch;

  constructor(config: OllamaProviderConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
    this.defaultChatModel = config.defaultChatModel ?? DEFAULT_OLLAMA_CHAT_MODEL;
    this.defaultEmbedModel = config.defaultEmbedModel ?? DEFAULT_OLLAMA_EMBED_MODEL;
    this.fetch = config.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private mapMessages(messages: readonly LlmMessage[]): OllamaMessage[] {
    return messages.map((m) => {
      if (typeof m.content === "string") {
        return {
          role: m.role,
          content: m.content
        };
      }

      const textParts: string[] = [];
      const images: string[] = [];

      for (const p of m.content) {
        if (p.text) {
          textParts.push(p.text);
        }
        if (p.inlineData) {
          images.push(p.inlineData.data);
        }
      }

      const resMsg: OllamaMessage = {
        role: m.role,
        content: textParts.join("\n")
      };
      if (images.length > 0) {
        resMsg.images = images;
      }
      return resMsg;
    });
  }

  private enhanceFetchError(err: unknown): Error {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (
      errorMsg.includes("Failed to fetch") ||
      errorMsg.includes("ECONNREFUSED") ||
      errorMsg.includes("fetch failed")
    ) {
      return new Error(
        `Ollama nicht erreichbar unter ${this.baseUrl}. Bitte stelle sicher, dass Ollama laeuft ('ollama serve') und CORS erlaubt ist (OLLAMA_ORIGINS="*").`
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  async chat(messages: readonly LlmMessage[], options?: LlmChatOptions): Promise<LlmResponse> {
    const model = options?.model ?? this.defaultChatModel;
    const url = `${this.baseUrl}/api/chat`;

    const mappedMessages = this.mapMessages(messages);
    const ollamaOptions: Record<string, unknown> = {};
    if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
    if (options?.topP !== undefined) ollamaOptions.top_p = options.topP;
    if (options?.maxOutputTokens !== undefined) ollamaOptions.num_predict = options.maxOutputTokens;
    if (options?.stopSequences && options.stopSequences.length > 0)
      ollamaOptions.stop = options.stopSequences;

    const payload: Record<string, unknown> = {
      model,
      messages: mappedMessages,
      stream: false,
      ...(Object.keys(ollamaOptions).length > 0 ? { options: ollamaOptions } : {})
    };

    let res: Response;
    try {
      res = await this.fetch(
        url,
        createFetchInit("POST", JSON.stringify(payload), options?.signal)
      );
    } catch (err) {
      throw this.enhanceFetchError(err);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API Fehler (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (data.error) {
      throw new Error(`Ollama API Fehler: ${data.error}`);
    }

    const usage =
      data.prompt_eval_count !== undefined
        ? {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count || 0,
            totalTokens: data.prompt_eval_count + (data.eval_count || 0)
          }
        : undefined;

    let finishReason: "stop" | "unknown" = "unknown";
    if (data.done_reason === "stop") {
      finishReason = "stop";
    } else if (data.done) {
      finishReason = "stop";
    }

    return {
      text: data.message ? data.message.content : "",
      model: data.model ? data.model : model,
      finishReason,
      usage,
      raw: data
    };
  }

  async *chatStream(
    messages: readonly LlmMessage[],
    options?: LlmChatOptions
  ): AsyncIterable<LlmStreamChunk> {
    const model = options?.model ?? this.defaultChatModel;
    const url = `${this.baseUrl}/api/chat`;

    const mappedMessages = this.mapMessages(messages);
    const ollamaOptions: Record<string, unknown> = {};
    if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
    if (options?.topP !== undefined) ollamaOptions.top_p = options.topP;
    if (options?.maxOutputTokens !== undefined) ollamaOptions.num_predict = options.maxOutputTokens;
    if (options?.stopSequences && options.stopSequences.length > 0)
      ollamaOptions.stop = options.stopSequences;

    const payload: Record<string, unknown> = {
      model,
      messages: mappedMessages,
      stream: true,
      ...(Object.keys(ollamaOptions).length > 0 ? { options: ollamaOptions } : {})
    };

    let res: Response;
    try {
      res = await this.fetch(
        url,
        createFetchInit("POST", JSON.stringify(payload), options?.signal)
      );
    } catch (err) {
      throw this.enhanceFetchError(err);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama Stream Fehler (${res.status}): ${errText}`);
    }

    if (!res.body) {
      throw new Error("Ollama Stream Antwort besitzt keinen Body.");
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
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as OllamaChatResponse;
            if (parsed.error) {
              throw new Error(`Ollama Stream Fehler: ${parsed.error}`);
            }

            const streamUsage =
              parsed.done && parsed.prompt_eval_count !== undefined
                ? {
                    promptTokens: parsed.prompt_eval_count,
                    completionTokens: parsed.eval_count || 0,
                    totalTokens: parsed.prompt_eval_count + (parsed.eval_count || 0)
                  }
                : undefined;

            yield {
              deltaText: parsed.message ? parsed.message.content : "",
              model: parsed.model ? parsed.model : model,
              isDone: parsed.done,
              finishReason: parsed.done ? "stop" : undefined,
              usage: streamUsage
            };
          } catch (err) {
            if ((err as Error).message.startsWith("Ollama Stream Fehler:")) {
              throw err;
            }
            // Ignore incomplete JSON chunks
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as OllamaChatResponse;
          yield {
            deltaText: parsed.message ? parsed.message.content : "",
            model: parsed.model ? parsed.model : model,
            isDone: parsed.done,
            finishReason: parsed.done ? "stop" : undefined
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

    const model = options?.model ?? this.defaultEmbedModel;

    // First try the newer /api/embed batch endpoint
    try {
      const batchUrl = `${this.baseUrl}/api/embed`;
      const res = await this.fetch(
        batchUrl,
        createFetchInit("POST", JSON.stringify({ model, input: texts }), options?.signal)
      );

      if (res.ok) {
        const data = (await res.json()) as OllamaEmbedApiResponse;
        if (data.embeddings && data.embeddings.length > 0) {
          return data.embeddings.map((v) => new Float32Array(v));
        }
      }
    } catch {
      // Fallback to /api/embeddings sequential
    }

    // Fallback: sequential /api/embeddings for legacy Ollama versions
    const results: Float32Array[] = [];
    for (const text of texts) {
      const url = `${this.baseUrl}/api/embeddings`;
      let res: Response;
      try {
        res = await this.fetch(
          url,
          createFetchInit("POST", JSON.stringify({ model, prompt: text }), options?.signal)
        );
      } catch (err) {
        throw this.enhanceFetchError(err);
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ollama Embedding Fehler (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as OllamaEmbeddingsResponse;
      if (!data.embedding || data.embedding.length === 0) {
        throw new Error("Ollama hat kein Embedding zurueckgegeben.");
      }

      results.push(new Float32Array(data.embedding));
    }

    return results;
  }

  async generateJson<T>(
    messages: readonly LlmMessage[],
    schema?: Record<string, unknown>,
    options?: LlmJsonOptions<T>
  ): Promise<T> {
    const model = options?.model ?? this.defaultChatModel;
    const url = `${this.baseUrl}/api/chat`;

    const mappedMessages = this.mapMessages(messages);
    const ollamaOptions: Record<string, unknown> = {};
    if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
    if (options?.topP !== undefined) ollamaOptions.top_p = options.topP;
    if (options?.maxOutputTokens !== undefined) ollamaOptions.num_predict = options.maxOutputTokens;

    const payload: Record<string, unknown> = {
      model,
      messages: mappedMessages,
      format: schema ?? "json",
      stream: false,
      ...(Object.keys(ollamaOptions).length > 0 ? { options: ollamaOptions } : {})
    };

    let res: Response;
    try {
      res = await this.fetch(
        url,
        createFetchInit("POST", JSON.stringify(payload), options?.signal)
      );
    } catch (err) {
      throw this.enhanceFetchError(err);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama JSON Fehler (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const rawText = data.message ? data.message.content : "";

    if (!rawText.trim()) {
      throw new Error("Ollama hat eine leere JSON-Antwort geliefert.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      throw new Error(`Ollama JSON ungueltig: ${(err as Error).message}`);
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
      const url = `${this.baseUrl}/api/tags`;
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
