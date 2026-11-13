import type { CitationLocation } from "./workspace-types.js";

export interface SseMessage {
  readonly event: string;
  readonly data: string;
}

export interface ChatCitationPayload {
  readonly index: number;
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceTitle?: string | undefined;
  readonly page?: number | null | undefined;
  readonly startOffset?: number | null | undefined;
  readonly endOffset?: number | null | undefined;
  readonly quote?: string | undefined;
}

export interface ChatAiMetadata {
  readonly aiGenerated: boolean;
  readonly provider: string;
  readonly model: string;
  readonly timestamp: string;
  readonly latencyMs?: number | undefined;
}

export type ChatStreamEvent =
  | { readonly type: "token"; readonly delta: string; readonly chatId?: string | undefined }
  | {
      readonly type: "citations";
      readonly citations: readonly ChatCitationPayload[];
      readonly validIndices: readonly number[];
      readonly hallucinatedIndices: readonly number[];
    }
  | { readonly type: "metadata"; readonly metadata: ChatAiMetadata }
  | { readonly type: "done"; readonly chatId?: string | undefined }
  | { readonly type: "error"; readonly message: string };

/** Fehler aus einer RFC-9457-Antwort (application/problem+json) oder einem Netzwerkfehler. */
export class ChatApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Schlüssel im Sprachkatalog für eine verständliche Fehlermeldung mit Handlungshinweis
 * (WCAG 3.3.3, Issue #315). Der Statuscode erscheint nur als technische Angabe.
 */
export function errorKeyForStatus(status: number): string {
  if (status === 0) return "errorNetwork";
  if (status === 401 || status === 403) return "errorAuth";
  if (status === 404) return "errorNotFound";
  if (status === 429) return "errorRateLimit";
  if (status >= 500) return "errorServer";
  return "errorGeneric";
}

/** Technische Angabe zum Fehler: Statuscode und Text des Servers, ohne Doppelungen. */
export function technicalErrorDetail(status: number, message: string): string {
  if (status <= 0) return message;
  return message.includes(`HTTP ${status}`) ? `HTTP ${status}` : `HTTP ${status} · ${message}`;
}

/**
 * Parst einen SSE-Byte-Stream (WHATWG-Format). Behandelt CRLF/LF/CR,
 * mehrzeilige data-Felder, Kommentare und Nachrichten ueber Chunk-Grenzen hinweg.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const msg = parseSseBlock(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        if (msg) yield msg;
        sep = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode().replace(/\r\n?/g, "\n");
    const rest = parseSseBlock(buffer.trimEnd());
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): SseMessage | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Wandelt eine rohe SSE-Nachricht in ein typisiertes Event. Unbekannte Events werden ignoriert. */
export function toChatEvent(msg: SseMessage): ChatStreamEvent | null {
  const json = safeJson(msg.data);
  if (!json) {
    return msg.event === "error" ? { type: "error", message: msg.data } : null;
  }
  switch (msg.event) {
    case "token":
      return {
        type: "token",
        delta: typeof json.delta === "string" ? json.delta : "",
        chatId: typeof json.chatId === "string" ? json.chatId : undefined
      };
    case "citations":
      return {
        type: "citations",
        citations: Array.isArray(json.citations) ? (json.citations as ChatCitationPayload[]) : [],
        validIndices: Array.isArray(json.validIndices) ? (json.validIndices as number[]) : [],
        hallucinatedIndices: Array.isArray(json.hallucinatedIndices)
          ? (json.hallucinatedIndices as number[])
          : []
      };
    case "metadata":
      return { type: "metadata", metadata: json as unknown as ChatAiMetadata };
    case "done":
      return { type: "done", chatId: typeof json.chatId === "string" ? json.chatId : undefined };
    case "error":
      return {
        type: "error",
        message: typeof json.error === "string" ? json.error : "Unbekannter Fehler"
      };
    default:
      return null;
  }
}

/** Ordnet Zitate ihrem [n]-Index zu (Position n-1), damit ChatPanel citations[n-1] nutzen kann. */
export function mapCitations(citations: readonly ChatCitationPayload[]): CitationLocation[] {
  const result: CitationLocation[] = [];
  for (const c of citations) {
    if (!Number.isInteger(c.index) || c.index < 1) continue;
    result[c.index - 1] = {
      sourceId: c.sourceId,
      chunkId: c.chunkId,
      quote: c.quote,
      page: c.page ?? null,
      startOffset: c.startOffset ?? null,
      endOffset: c.endOffset ?? null
    };
  }
  // Luecken (nicht zitierte Indizes) durch Platzhalter ersetzen, damit kein Array-Loch entsteht.
  for (let i = 0; i < result.length; i++) {
    if (!result[i]) result[i] = { sourceId: `src_${i + 1}`, quote: `Zitat [${i + 1}]` };
  }
  return result;
}

async function readProblem(res: Response): Promise<ChatApiError> {
  let detail = `Anfrage fehlgeschlagen (HTTP ${res.status}).`;
  let code: string | undefined;
  try {
    const problem = (await res.json()) as Record<string, unknown>;
    if (typeof problem.detail === "string") detail = problem.detail;
    else if (typeof problem.title === "string") detail = problem.title;
    if (typeof problem.code === "string") code = problem.code;
  } catch {
    // Kein JSON-Body: Standardtext verwenden.
  }
  return new ChatApiError(detail, res.status, code);
}

export interface StreamChatOptions {
  readonly notebookId: string;
  readonly message: string;
  readonly chatId?: string | undefined;
  readonly model?: string | undefined;
  readonly sourceIds?: readonly string[] | undefined;
  /** Sprache der Oberfläche (Text der ehrlichen Nichtantwort, Issue #243). */
  readonly language?: "de" | "en" | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * Sendet eine Chat-Anfrage und liefert die SSE-Events als typisierten Stream.
 * Wirft ChatApiError bei HTTP-Fehlern (Problem Details) und Netzwerkfehlern.
 * Abbruch ueber signal wirft einen AbortError (unveraendert durchgereicht).
 */
export async function* streamChat(options: StreamChatOptions): AsyncGenerator<ChatStreamEvent> {
  const doFetch = options.fetchImpl ?? fetch;
  const payload: Record<string, unknown> = { message: options.message };
  if (options.chatId) payload.chatId = options.chatId;
  if (options.model) payload.model = options.model;
  if (options.sourceIds && options.sourceIds.length > 0) payload.sourceIds = options.sourceIds;
  if (options.language) payload.language = options.language;

  let res: Response;
  try {
    res = await doFetch(`/api/v1/notebooks/${encodeURIComponent(options.notebookId)}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
      ...(options.signal ? { signal: options.signal } : {})
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ChatApiError("Netzwerkfehler: Der Server ist nicht erreichbar.", 0, "NETWORK_ERROR");
  }

  if (!res.ok) throw await readProblem(res);
  if (!res.body) throw new ChatApiError("Leere Antwort vom Server.", res.status, "EMPTY_BODY");

  for await (const msg of parseSseStream(res.body)) {
    const event = toChatEvent(msg);
    if (event) yield event;
  }
}

/** Eine Nachricht des gespeicherten Verlaufs (GET /api/v1/chats/:id/messages). */
export interface ChatHistoryItem {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly citations?: readonly ChatCitationPayload[] | null | undefined;
  readonly aiGenerated?: boolean | undefined;
  readonly createdAt?: number | undefined;
}

export interface FetchChatHistoryOptions {
  readonly chatId: string;
  /** Nachrichten je Seite (Server: 1 bis 200). */
  readonly pageSize?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * Lädt den ganzen Verlauf eines Chats, Seite für Seite über den Cursor, ohne Gesamtgrenze
 * (Issue #243). Ergebnis in zeitlicher Reihenfolge, älteste zuerst.
 */
export async function fetchChatHistory(
  options: FetchChatHistoryOptions
): Promise<ChatHistoryItem[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? 100;
  const pages: ChatHistoryItem[][] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) query.set("before", cursor);
    const url = `/api/v1/chats/${encodeURIComponent(options.chatId)}/messages?${query}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
        ...(options.signal ? { signal: options.signal } : {})
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ChatApiError(
        "Netzwerkfehler: Der Server ist nicht erreichbar.",
        0,
        "NETWORK_ERROR"
      );
    }
    if (!res.ok) throw await readProblem(res);
    const body = (await res.json()) as {
      readonly messages?: unknown;
      readonly nextCursor?: unknown;
    };
    if (!Array.isArray(body.messages)) {
      throw new ChatApiError("Unerwartete Antwort vom Server.", res.status, "INVALID_BODY");
    }
    pages.unshift(body.messages as ChatHistoryItem[]);
    cursor = typeof body.nextCursor === "string" && body.nextCursor ? body.nextCursor : null;
  } while (cursor);
  return pages.flat();
}
