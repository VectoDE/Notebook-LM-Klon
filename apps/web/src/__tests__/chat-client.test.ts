import { describe, expect, it } from "vitest";
import {
  ChatApiError,
  type ChatStreamEvent,
  errorKeyForStatus,
  mapCitations,
  parseSseStream,
  streamChat,
  technicalErrorDetail,
  toChatEvent
} from "../chat-client.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    }
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const asFetch = (fn: (url: string, init: RequestInit) => Promise<Response>) =>
  fn as unknown as typeof fetch;

describe("parseSseStream", () => {
  it("parst Events ueber Chunk-Grenzen hinweg", async () => {
    const full = sse("token", { delta: "Hallo" });
    const msgs = await collect(parseSseStream(streamOf([full.slice(0, 9), full.slice(9)])));
    expect(msgs).toEqual([{ event: "token", data: '{"delta":"Hallo"}' }]);
  });

  it("unterstuetzt CRLF, Kommentare und mehrzeilige data-Felder", async () => {
    const raw = ": keepalive\r\nevent: token\r\ndata: a\r\ndata: b\r\n\r\n";
    const msgs = await collect(parseSseStream(streamOf([raw])));
    expect(msgs).toEqual([{ event: "token", data: "a\nb" }]);
  });

  it("verarbeitet einen letzten Block ohne Leerzeile", async () => {
    const msgs = await collect(parseSseStream(streamOf(["event: done\ndata: {}"])));
    expect(msgs).toEqual([{ event: "done", data: "{}" }]);
  });
});

describe("toChatEvent", () => {
  it("mappt alle bekannten Events und ignoriert unbekannte", () => {
    expect(toChatEvent({ event: "token", data: '{"delta":"x","chatId":"c1"}' })).toEqual({
      type: "token",
      delta: "x",
      chatId: "c1"
    });
    expect(toChatEvent({ event: "error", data: '{"error":"kaputt"}' })).toEqual({
      type: "error",
      message: "kaputt"
    });
    expect(toChatEvent({ event: "error", data: "plain" })).toEqual({
      type: "error",
      message: "plain"
    });
    expect(toChatEvent({ event: "ping", data: "{}" })).toBeNull();
    expect(toChatEvent({ event: "token", data: "kein json" })).toBeNull();
  });
});

describe("mapCitations", () => {
  it("legt Zitate an Position index-1 ab und fuellt Luecken", () => {
    const mapped = mapCitations([
      { index: 3, chunkId: "c3", sourceId: "s3", page: 2, quote: "drei" },
      { index: 1, chunkId: "c1", sourceId: "s1" }
    ]);
    expect(mapped).toHaveLength(3);
    expect(mapped[0]?.sourceId).toBe("s1");
    expect(mapped[1]?.sourceId).toBe("src_2");
    expect(mapped[2]).toMatchObject({ sourceId: "s3", chunkId: "c3", page: 2, quote: "drei" });
  });
});

describe("streamChat", () => {
  it("sendet den korrekten Request und liefert typisierte Events", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = asFetch(async (url, init) => {
      captured = { url, init };
      return new Response(
        streamOf([
          sse("token", { delta: "Antwort ", chatId: "chat_1" }),
          sse("token", { delta: "[1]", chatId: "chat_1" }),
          sse("citations", {
            chatId: "chat_1",
            citations: [{ index: 1, chunkId: "k1", sourceId: "s1", sourceTitle: "T" }],
            validIndices: [1],
            hallucinatedIndices: []
          }),
          sse("metadata", {
            aiGenerated: true,
            provider: "google",
            model: "gemini-2.5-flash",
            timestamp: "2026-01-01T00:00:00.000Z"
          }),
          sse("done", { chatId: "chat_1", messageId: "m" })
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    });

    const events: ChatStreamEvent[] = await collect(
      streamChat({
        notebookId: "nb 1",
        message: "Frage",
        chatId: "chat_1",
        model: "gemini-2.5-flash",
        sourceIds: ["s1"],
        fetchImpl
      })
    );

    expect(captured?.url).toBe("/api/v1/notebooks/nb%201/chat");
    expect(captured?.init.method).toBe("POST");
    expect(JSON.parse(String(captured?.init.body))).toEqual({
      message: "Frage",
      chatId: "chat_1",
      model: "gemini-2.5-flash",
      sourceIds: ["s1"]
    });
    expect(events.map((e) => e.type)).toEqual(["token", "token", "citations", "metadata", "done"]);
    const cit = events[2];
    expect(cit?.type === "citations" && cit.citations[0]?.sourceId).toBe("s1");
  });

  it("wirft ChatApiError mit Problem Details (RFC 9457)", async () => {
    const fetchImpl = asFetch(
      async () =>
        new Response(
          JSON.stringify({
            type: "about:blank",
            title: "Not Found",
            status: 404,
            detail: "Notebook 'x' wurde nicht gefunden.",
            code: "NOTEBOOK_NOT_FOUND"
          }),
          { status: 404, headers: { "content-type": "application/problem+json" } }
        )
    );

    const err = await collect(streamChat({ notebookId: "x", message: "m", fetchImpl })).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ChatApiError);
    expect(err).toMatchObject({
      status: 404,
      code: "NOTEBOOK_NOT_FOUND",
      message: "Notebook 'x' wurde nicht gefunden."
    });
  });

  it("faellt bei Nicht-JSON-Fehlern auf einen Standardtext zurueck", async () => {
    const fetchImpl = asFetch(async () => new Response("boom", { status: 502 }));
    const err = await collect(streamChat({ notebookId: "x", message: "m", fetchImpl })).catch(
      (e: unknown) => e
    );
    expect(err).toMatchObject({ status: 502, message: "Anfrage fehlgeschlagen (HTTP 502)." });
  });

  it("meldet Netzwerkfehler als ChatApiError", async () => {
    const fetchImpl = asFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await collect(streamChat({ notebookId: "x", message: "m", fetchImpl })).catch(
      (e: unknown) => e
    );
    expect(err).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("reicht AbortError unveraendert durch", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchImpl = asFetch(async (_u, init) => {
      if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return new Response("");
    });
    const err = await collect(
      streamChat({ notebookId: "x", message: "m", fetchImpl, signal: ac.signal })
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("liefert Stream-Fehler-Events als error-Event", async () => {
    const fetchImpl = asFetch(
      async () =>
        new Response(streamOf([sse("error", { error: "Provider down", chatId: "c" })]), {
          status: 200
        })
    );
    const events = await collect(streamChat({ notebookId: "x", message: "m", fetchImpl }));
    expect(events).toEqual([{ type: "error", message: "Provider down" }]);
  });
});

describe("Fehlertexte in Klartext (Issue #315)", () => {
  it("ordnet Statuscodes einem Hinweis im Sprachkatalog zu", () => {
    expect(errorKeyForStatus(0)).toBe("errorNetwork");
    expect(errorKeyForStatus(401)).toBe("errorAuth");
    expect(errorKeyForStatus(403)).toBe("errorAuth");
    expect(errorKeyForStatus(404)).toBe("errorNotFound");
    expect(errorKeyForStatus(429)).toBe("errorRateLimit");
    expect(errorKeyForStatus(502)).toBe("errorServer");
    expect(errorKeyForStatus(400)).toBe("errorGeneric");
  });

  it("führt den Statuscode nur als technische Angabe, ohne Doppelung", () => {
    expect(technicalErrorDetail(404, "Anfrage fehlgeschlagen (HTTP 404).")).toBe("HTTP 404");
    expect(technicalErrorDetail(409, "Notebook gesperrt")).toBe("HTTP 409 · Notebook gesperrt");
    expect(technicalErrorDetail(0, "Netzwerkfehler")).toBe("Netzwerkfehler");
  });
});
