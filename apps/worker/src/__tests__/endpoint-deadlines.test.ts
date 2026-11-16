/**
 * Fristen für eigene Endpunkte (Issue #247): Die Gesamtfrist gilt auch für das Lesen des
 * Bodys, Streams haben zusätzlich zum Leerlauf-Limit eine Höchstdauer. Ein langsamer Server
 * kann den Worker so nicht festhalten.
 */
import { describe, expect, it } from "vitest";
import {
  abortReason,
  deadlineSignal,
  endpointKeyBinding,
  readBodyLimited,
  readUntilAborted
} from "../endpoint-guard.js";
import { OpenAiCompatibleProvider } from "../openai-compatible-provider.js";

const BASE = "https://api.relationflow.example/v1";

/** Body, der sofort einen Teil liefert und danach nie endet; merkt sich den Abbruch. */
function stalledBody(first = '{"data":'): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(first));
    },
    cancel() {
      cancelled = true;
    }
  });
  return { stream, cancelled: () => cancelled };
}

function stalledFetch(first?: string): { fetchFn: typeof fetch; cancelled: () => boolean } {
  const bodies: Array<() => boolean> = [];
  const fetchFn = (async () => {
    const body = stalledBody(first);
    bodies.push(body.cancelled);
    return new Response(body.stream, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, cancelled: () => bodies.length > 0 && bodies.every((c) => c()) };
}

function provider(
  fetchFn: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof OpenAiCompatibleProvider>[0]> = {}
) {
  return new OpenAiCompatibleProvider({
    baseUrl: BASE,
    apiKey: "rf_test_secret_key_123",
    chatModel: "rf-auto",
    embedModel: "rf-embed",
    allowlist: [],
    resolver: async () => ["93.184.215.14"],
    fetchFn,
    ...overrides
  });
}

describe("endpoint-guard: Fristen beim Lesen", () => {
  it("bricht das Body-Lesen ab, wenn die Frist abläuft, und schließt den Reader", async () => {
    const body = stalledBody("abc");
    const deadline = deadlineSignal(20);
    await expect(
      readBodyLimited(new Response(body.stream), 100, "throw", deadline.signal)
    ).rejects.toThrow("Zeitüberschreitung");
    deadline.clear();
    expect(body.cancelled()).toBe(true);
  });

  it("wirft sofort bei bereits abgebrochenem Signal", async () => {
    const body = stalledBody("abc");
    const controller = new AbortController();
    controller.abort(new Error("vom Aufrufer abgebrochen"));
    await expect(
      readBodyLimited(new Response(body.stream), 100, "throw", controller.signal)
    ).rejects.toThrow("vom Aufrufer abgebrochen");
    expect(body.cancelled()).toBe(true);
  });

  it("liest mit Signal normal zu Ende, wenn die Frist reicht", async () => {
    const deadline = deadlineSignal(5_000);
    expect(await readBodyLimited(new Response("fertig"), 100, "throw", deadline.signal)).toBe(
      "fertig"
    );
    deadline.clear();
    const reader = new Response("x").body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    expect((await readUntilAborted(reader, undefined)).done).toBe(false);
  });

  it("verbindet die Frist mit einem Signal des Aufrufers", async () => {
    const outer = new AbortController();
    const deadline = deadlineSignal(60_000, outer.signal);
    expect(deadline.signal.aborted).toBe(false);
    outer.abort(new Error("Abbruch"));
    expect(deadline.signal.aborted).toBe(true);
    deadline.clear();
  });

  it("macht aus einem beliebigen Abbruchgrund einen Fehler", () => {
    const controller = new AbortController();
    controller.abort("kein Error-Objekt");
    expect(abortReason(controller.signal).name).toBe("TimeoutError");
    const own = new Error("eigener Grund");
    const other = new AbortController();
    other.abort(own);
    expect(abortReason(other.signal)).toBe(own);
  });

  it("bindet Schlüssel an Schema, Host und Port", () => {
    expect(endpointKeyBinding("https://api.relationflow.example/v1")).toBe(
      "https://api.relationflow.example"
    );
    expect(endpointKeyBinding("https://api.relationflow.example:8443/v1")).toBe(
      "https://api.relationflow.example:8443"
    );
  });
});

describe("OpenAI-kompatibler Endpunkt: Gesamtfristen", () => {
  it("chat, embed und generateJson brechen bei langsamem Body nach der Frist ab", async () => {
    for (const call of [
      (p: OpenAiCompatibleProvider) => p.chat([{ role: "user", content: "hi" }]),
      (p: OpenAiCompatibleProvider) => p.embed(["a"]),
      (p: OpenAiCompatibleProvider) => p.generateJson([{ role: "user", content: "hi" }])
    ]) {
      const slow = stalledFetch();
      await expect(call(provider(slow.fetchFn, { timeoutMs: 30 }))).rejects.toThrow(
        "Zeitüberschreitung"
      );
      expect(slow.cancelled()).toBe(true);
    }
  });

  it("Fehlertexte werden ebenfalls nur innerhalb der Frist gelesen", async () => {
    const fetchFn = (async () =>
      new Response(stalledBody("boom").stream, { status: 500 })) as unknown as typeof fetch;
    await expect(
      provider(fetchFn, { timeoutMs: 30 }).chat([{ role: "user", content: "hi" }])
    ).rejects.toThrow("Zeitüberschreitung");
  });

  it("Verbindungstest meldet die Zeitüberschreitung als fehlgeschlagenen Test", async () => {
    const slow = stalledFetch();
    const result = await provider(slow.fetchFn, { timeoutMs: 30 }).probeHealth();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Zeitüberschreitung");
    expect(slow.cancelled()).toBe(true);
  });

  it("Stream: Höchstdauer greift, obwohl regelmäßig Daten kommen", async () => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const fetchFn = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            timer = setInterval(() => {
              controller.enqueue(
                new TextEncoder().encode('data: {"choices":[{"delta":{"content":"."}}]}\n')
              );
            }, 5);
          },
          cancel() {
            cancelled = true;
            clearInterval(timer);
          }
        }),
        { status: 200 }
      )) as unknown as typeof fetch;

    const chunks: string[] = [];
    const run = async () => {
      for await (const chunk of provider(fetchFn, {
        maxStreamDurationMs: 60,
        idleTimeoutMs: 1_000
      }).chatStream([{ role: "user", content: "hi" }])) {
        chunks.push(chunk.deltaText);
      }
    };
    await expect(run()).rejects.toThrow("Zeitüberschreitung");
    clearInterval(timer);
    expect(cancelled).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("Stream: Fehler vor dem ersten Teil räumt die Frist auf", async () => {
    const failing = (async () => {
      throw new Error("Netz weg");
    }) as unknown as typeof fetch;
    const run = async () => {
      for await (const _ of provider(failing).chatStream([{ role: "user", content: "hi" }])) {
        // nichts
      }
    };
    await expect(run()).rejects.toThrow("Netz weg");
  });
});
