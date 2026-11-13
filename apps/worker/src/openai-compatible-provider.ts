/**
 * Generischer Adapter für OpenAI-kompatible Endpunkte (BYOM, Issue #247).
 *
 * Gedacht für RelationFlow und andere Dienste, die `/chat/completions`, `/embeddings` und
 * `/models` im OpenAI-Format anbieten. Jeder Netzwerkaufruf läuft über `guardedEndpointFetch`
 * (HTTPS, Allowlist, SSRF- und DNS-Rebinding-Schutz, keine Weiterleitungen).
 *
 * Der API-Schlüssel wird nur im Authorization-Header gesendet und aus jedem Fehlertext entfernt.
 */

import type {
  LlmChatOptions,
  LlmEmbedOptions,
  LlmJsonOptions,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmStreamChunk,
  LlmTokenUsage,
  ModelTrainingPolicy
} from "@notebook-lm/shared";
import {
  type GuardedFetchOptions,
  type HostResolver,
  createDohResolver,
  guardedEndpointFetch,
  redactSecret
} from "./endpoint-guard.js";

export interface OpenAiCompatibleConfig {
  readonly baseUrl: string;
  readonly apiKey?: string | undefined;
  readonly chatModel: string;
  readonly embedModel?: string | undefined;
  readonly allowlist: readonly string[];
  readonly resolver?: HostResolver | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  /** Längste Pause zwischen zwei Stream-Teilen, danach Abbruch (Standard 60 s). */
  readonly idleTimeoutMs?: number | undefined;
  readonly name?: string | undefined;
}

export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

interface OpenAiChoice {
  readonly message?: { readonly content?: string | null };
  readonly delta?: { readonly content?: string | null };
  readonly finish_reason?: string | null;
}

interface OpenAiChatBody {
  readonly model?: string;
  readonly choices?: readonly OpenAiChoice[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

function mapFinishReason(reason: string | null | undefined): LlmResponse["finishReason"] {
  if (reason === "stop") return "stop";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "safety";
  return "unknown";
}

function mapUsage(usage: OpenAiChatBody["usage"]): LlmTokenUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens
  };
}

function flattenContent(content: LlmMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => part.text ?? "")
    .filter((text) => text.length > 0)
    .join("\n");
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = "custom";
  readonly name: string;
  readonly isLocal = false;
  // Datenverwendung hängt vom Betreiber des Endpunkts ab; konservativ wie Free-Tier einstufen.
  readonly trainingPolicy: ModelTrainingPolicy = "free-tier-trained";

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly chatModel: string;
  private readonly embedModel: string | undefined;
  private readonly guard: GuardedFetchOptions;
  private readonly idleTimeoutMs: number;

  constructor(config: OpenAiCompatibleConfig) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.chatModel = config.chatModel;
    this.embedModel = config.embedModel;
    this.name = config.name ?? "Eigener Endpunkt (OpenAI-kompatibel)";
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    const fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.guard = {
      allowlist: config.allowlist,
      resolver: config.resolver ?? createDohResolver(fetchFn),
      fetchFn,
      timeoutMs: config.timeoutMs
    };
  }

  private headers(apiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return headers;
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    body: unknown,
    apiKey: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<Response> {
    const init: RequestInit = { method, headers: this.headers(apiKey) };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal) init.signal = signal;

    let res: Response;
    try {
      res = await guardedEndpointFetch(`${this.baseUrl}${path}`, init, this.guard);
    } catch (err) {
      throw new Error(redactSecret((err as Error).message, apiKey));
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Endpunkt-Fehler (${res.status})${text ? `: ${redactSecret(text, apiKey)}` : ""}`
      );
    }
    return res;
  }

  /** Liest den nächsten Stream-Teil; bricht ab, wenn der Endpunkt zu lange schweigt. */
  private async readWithIdleLimit(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("Endpunkt-Stream: zu lange keine Daten, abgebrochen.");
        // Erst ablehnen, dann die Verbindung schließen; Fehler beim Abbrechen sind hier egal.
        reject(error);
        void Promise.allSettled([reader.cancel(error)]);
      }, this.idleTimeoutMs);
    });
    try {
      return await Promise.race([reader.read(), idle]);
    } finally {
      clearTimeout(timer);
    }
  }

  private chatPayload(
    messages: readonly LlmMessage[],
    options: LlmChatOptions | undefined,
    stream: boolean
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: options?.model ?? this.chatModel,
      messages: messages.map((m) => ({ role: m.role, content: flattenContent(m.content) })),
      stream
    };
    if (options?.temperature !== undefined) payload.temperature = options.temperature;
    if (options?.topP !== undefined) payload.top_p = options.topP;
    if (options?.maxOutputTokens !== undefined) payload.max_tokens = options.maxOutputTokens;
    if (options?.stopSequences && options.stopSequences.length > 0) {
      payload.stop = options.stopSequences;
    }
    return payload;
  }

  async chat(messages: readonly LlmMessage[], options?: LlmChatOptions): Promise<LlmResponse> {
    const apiKey = options?.apiKey ?? this.apiKey;
    const res = await this.request(
      "/chat/completions",
      "POST",
      this.chatPayload(messages, options, false),
      apiKey,
      options?.signal
    );
    const data = (await res.json()) as OpenAiChatBody;
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      model: data.model ?? options?.model ?? this.chatModel,
      finishReason: mapFinishReason(choice?.finish_reason),
      usage: mapUsage(data.usage)
    };
  }

  async *chatStream(
    messages: readonly LlmMessage[],
    options?: LlmChatOptions
  ): AsyncIterable<LlmStreamChunk> {
    const apiKey = options?.apiKey ?? this.apiKey;
    const model = options?.model ?? this.chatModel;
    const res = await this.request(
      "/chat/completions",
      "POST",
      this.chatPayload(messages, options, true),
      apiKey,
      options?.signal
    );
    if (!res.body) {
      throw new Error("Endpunkt-Stream ohne Inhalt.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finished = false;

    try {
      while (!finished) {
        const { value, done } = await this.readWithIdleLimit(reader);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");

          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            finished = true;
            yield { deltaText: "", model, isDone: true, finishReason: "stop" };
            break;
          }
          let parsed: OpenAiChatBody;
          try {
            parsed = JSON.parse(data) as OpenAiChatBody;
          } catch {
            continue;
          }
          const choice = parsed.choices?.[0];
          const reason = choice?.finish_reason;
          yield {
            deltaText: choice?.delta?.content ?? "",
            model: parsed.model ?? model,
            isDone: false,
            finishReason: reason ? mapFinishReason(reason) : undefined,
            usage: mapUsage(parsed.usage)
          };
        }
      }
      if (!finished) {
        yield { deltaText: "", model, isDone: true, finishReason: "unknown" };
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embed(texts: readonly string[], options?: LlmEmbedOptions): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const model = options?.model ?? this.embedModel;
    if (!model) {
      throw new Error("Für diesen Endpunkt ist kein Embedding-Modell hinterlegt.");
    }
    const body: Record<string, unknown> = { model, input: texts };
    if (options?.outputDimensionality !== undefined) {
      body.dimensions = options.outputDimensionality;
    }
    const res = await this.request(
      "/embeddings",
      "POST",
      body,
      options?.apiKey ?? this.apiKey,
      options?.signal
    );
    const data = (await res.json()) as { data?: Array<{ index?: number; embedding: number[] }> };
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== texts.length) {
      throw new Error("Endpunkt lieferte eine unerwartete Zahl an Embeddings.");
    }
    return rows.map((row) => new Float32Array(row.embedding));
  }

  async generateJson<T>(
    messages: readonly LlmMessage[],
    _schema?: Record<string, unknown>,
    options?: LlmJsonOptions<T>
  ): Promise<T> {
    const apiKey = options?.apiKey ?? this.apiKey;
    const payload = {
      ...this.chatPayload(messages, options, false),
      response_format: { type: "json_object" }
    };
    const res = await this.request("/chat/completions", "POST", payload, apiKey, options?.signal);
    const data = (await res.json()) as OpenAiChatBody;
    const raw = data.choices?.[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Endpunkt lieferte kein gültiges JSON.");
    }
    return options?.validator ? options.validator(parsed) : (parsed as T);
  }

  /** Verbindungstest: `GET /models` prüft Erreichbarkeit und Schlüssel ohne Token-Kosten. */
  async probeHealth(
    signal?: AbortSignal
  ): Promise<{ ok: boolean; message?: string; latencyMs: number; models?: string[] }> {
    const start = performance.now();
    try {
      const res = await this.request("/models", "GET", undefined, this.apiKey, signal);
      const data = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> };
      const models = (data.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string")
        .slice(0, 50);
      return { ok: true, latencyMs: Math.round(performance.now() - start), models };
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message,
        latencyMs: Math.round(performance.now() - start)
      };
    }
  }
}
