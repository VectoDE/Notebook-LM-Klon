/**
 * Tests des OpenAI-kompatiblen Adapters gegen einen lokalen Fake-Server (Issue #247).
 *
 * Der Server läuft per node:http auf 127.0.0.1. Der Adapter sieht nur die öffentliche
 * HTTPS-Adresse; die Test-fetch-Funktion leitet erst nach allen Schutzprüfungen auf den
 * lokalen Server um. So laufen Allowlist, SSRF- und DNS-Prüfung genau wie in Produktion.
 */
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "../openai-compatible-provider.js";

const BASE = "https://api.relationflow.example/v1";
const KEY = "rf_test_secret_key_123";
const ALLOW = ["api.relationflow.example"];

interface Recorded {
  method: string;
  path: string;
  auth: string | undefined;
  body: Record<string, unknown> | undefined;
}

let server: Server;
let origin: string;
let recorded: Recorded[] = [];
let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      recorded.push({
        method: req.method ?? "",
        path: req.url ?? "",
        auth: req.headers.authorization,
        body: body ? (JSON.parse(body) as Record<string, unknown>) : undefined
      });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  recorded = [];
});

/** Leitet geprüfte HTTPS-Aufrufe auf den lokalen Fake-Server um. */
const toLocal = (async (url: string | URL | Request, init?: RequestInit) =>
  fetch(String(url).replace("https://api.relationflow.example", origin), init)) as typeof fetch;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function provider(
  overrides: Partial<ConstructorParameters<typeof OpenAiCompatibleProvider>[0]> = {}
) {
  return new OpenAiCompatibleProvider({
    baseUrl: `${BASE}/`,
    apiKey: KEY,
    chatModel: "rf-auto",
    embedModel: "rf-embed",
    allowlist: ALLOW,
    resolver: async () => ["93.184.215.14"],
    fetchFn: toLocal,
    ...overrides
  });
}

describe("OpenAiCompatibleProvider: Chat", () => {
  it("sendet Nachrichten im OpenAI-Format mit Bearer-Schlüssel und liest die Antwort", async () => {
    handler = (_req, res) =>
      json(res, 200, {
        model: "rf-auto-2026",
        choices: [{ message: { content: "Hallo" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
      });
    const p = provider();
    expect(p.id).toBe("custom");
    expect(p.isLocal).toBe(false);
    const out = await p.chat(
      [
        { role: "system", content: "sys" },
        {
          role: "user",
          content: [{ text: "a" }, { inlineData: { mimeType: "x", data: "y" } }, { text: "b" }]
        }
      ],
      { temperature: 0.2, topP: 0.9, maxOutputTokens: 50, stopSequences: ["END"] }
    );
    expect(out).toMatchObject({ text: "Hallo", model: "rf-auto-2026", finishReason: "stop" });
    expect(out.usage).toEqual({ promptTokens: 3, completionTokens: 1, totalTokens: 4 });
    const req = recorded[0] as Recorded;
    expect(req.path).toBe("/v1/chat/completions");
    expect(req.auth).toBe(`Bearer ${KEY}`);
    expect(req.body).toMatchObject({
      model: "rf-auto",
      stream: false,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 50,
      stop: ["END"],
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "a\nb" }
      ]
    });
  });

  it("kommt mit fehlenden Feldern und anderen Abbruchgründen zurecht", async () => {
    const cases: Array<[unknown, string]> = [
      [{ choices: [{ message: { content: null }, finish_reason: "length" }] }, "max_tokens"],
      [{ choices: [{ finish_reason: "content_filter" }], usage: { prompt_tokens: 2 } }, "safety"],
      [{}, "unknown"]
    ];
    for (const [body, reason] of cases) {
      handler = (_req, res) => json(res, 200, body);
      const out = await provider({ apiKey: undefined }).chat([{ role: "user", content: "x" }], {
        model: "m2",
        stopSequences: []
      });
      expect(out.finishReason).toBe(reason);
      expect(out.text).toBe("");
      expect(out.model).toBe("m2");
    }
    expect(recorded[0]?.auth).toBeUndefined();
    expect(recorded[0]?.body).not.toHaveProperty("stop");
    handler = (_req, res) => json(res, 200, { choices: [], usage: { completion_tokens: 2 } });
    const out = await provider().chat([{ role: "user", content: "x" }]);
    expect(out.usage).toEqual({ promptTokens: 0, completionTokens: 2, totalTokens: 2 });
    expect(out.model).toBe("rf-auto");
  });

  it("gibt Fehler ohne Schlüssel weiter und kürzt sie", async () => {
    handler = (_req, res) => json(res, 401, { error: `invalid key ${KEY}` });
    const err = await provider()
      .chat([{ role: "user", content: "x" }])
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("Endpunkt-Fehler (401)");
    expect((err as Error).message).not.toContain(KEY);

    handler = (_req, res) => {
      res.writeHead(500);
      res.end();
    };
    await expect(provider().chat([{ role: "user", content: "x" }])).rejects.toThrow(
      /^Endpunkt-Fehler \(500\)$/
    );
  });

  it("blockiert Endpunkte außerhalb der Allowlist und private DNS-Ziele ohne Netzwerkaufruf", async () => {
    await expect(
      provider({ allowlist: ["other.example"] }).chat([{ role: "user", content: "x" }])
    ).rejects.toThrow("Allowlist");
    await expect(
      provider({ resolver: async () => ["10.0.0.8"] }).chat([{ role: "user", content: "x" }])
    ).rejects.toThrow("DNS-Rebinding");
    expect(recorded).toHaveLength(0);
  });

  it("lehnt Weiterleitungen des Endpunkts ab", async () => {
    handler = (_req, res) => {
      res.writeHead(307, { location: "http://169.254.169.254/latest" });
      res.end();
    };
    await expect(provider().chat([{ role: "user", content: "x" }])).rejects.toThrow(
      "Weiterleitungen"
    );
  });

  it("nimmt ohne fetchFn und Resolver die Standardwerte", () => {
    const p = new OpenAiCompatibleProvider({
      baseUrl: BASE,
      chatModel: "m",
      allowlist: ALLOW,
      name: "RelationFlow"
    });
    expect(p.name).toBe("RelationFlow");
  });
});

describe("OpenAiCompatibleProvider: Stream", () => {
  async function collect(p: OpenAiCompatibleProvider, options = {}) {
    const chunks = [];
    for await (const c of p.chatStream([{ role: "user", content: "x" }], options)) chunks.push(c);
    return chunks;
  }

  it("liest Server-Sent Events bis [DONE]", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(': kommentar\n\ndata: {"model":"rf","choices":[{"delta":{"content":"Hal"}}]}\n\n');
      res.write("data: kaputt\n\ndata: {}\n\n");
      res.write(
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n'
      );
      res.write(
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"zu spät"}}]}\n\n'
      );
      res.end();
    };
    const chunks = await collect(provider(), { signal: new AbortController().signal });
    expect(chunks.map((c) => c.deltaText).join("")).toBe("Hallo");
    expect(chunks[0]?.model).toBe("rf");
    expect(chunks[1]).toMatchObject({ deltaText: "", isDone: false });
    expect(chunks[2]).toMatchObject({ finishReason: "stop", usage: { totalTokens: 2 } });
    expect(chunks.at(-1)).toMatchObject({ isDone: true, finishReason: "stop" });
    expect(recorded[0]?.body).toMatchObject({ stream: true });
  });

  it("meldet ein Ende ohne [DONE] als unbekannt", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"choices":[{"delta":{"content":"a"}}]}\n');
    };
    const chunks = await collect(provider(), { model: "x" });
    expect(chunks.at(-1)).toMatchObject({ isDone: true, finishReason: "unknown", model: "x" });
  });

  it("bricht einen Stream ab, wenn der Endpunkt zu lange schweigt", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
      // danach keine Daten mehr, Verbindung bleibt offen
    };
    await expect(collect(provider({ idleTimeoutMs: 50 }))).rejects.toThrow("zu lange keine Daten");
  });

  it("wirft bei Antwort ohne Body", async () => {
    const noBody = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    await expect(collect(provider({ fetchFn: noBody }))).rejects.toThrow("ohne Inhalt");
  });
});

describe("OpenAiCompatibleProvider: Embeddings und JSON", () => {
  it("liefert Embeddings in Eingabereihenfolge", async () => {
    handler = (_req, res) =>
      json(res, 200, {
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] }
        ]
      });
    const out = await provider().embed(["a", "b"], { outputDimensionality: 2 });
    expect(Array.from(out[0] as Float32Array)).toEqual([expect.closeTo(0.1), expect.closeTo(0.2)]);
    expect(recorded[0]?.path).toBe("/v1/embeddings");
    expect(recorded[0]?.body).toEqual({ model: "rf-embed", input: ["a", "b"], dimensions: 2 });
  });

  it("behandelt leere Eingaben, fehlendes Modell und falsche Anzahl", async () => {
    expect(await provider().embed([])).toEqual([]);
    await expect(provider({ embedModel: undefined }).embed(["a"])).rejects.toThrow(
      "kein Embedding-Modell"
    );
    handler = (_req, res) => json(res, 200, {});
    await expect(provider().embed(["a"], { model: "m", apiKey: "k" })).rejects.toThrow(
      "unerwartete Zahl"
    );
    handler = (_req, res) => json(res, 200, { data: [{ embedding: [1] }, { embedding: [2] }] });
    expect(await provider().embed(["a", "b"])).toHaveLength(2);
  });

  it("erzeugt JSON mit response_format und optionalem Validator", async () => {
    handler = (_req, res) => json(res, 200, { choices: [{ message: { content: '{"a":1}' } }] });
    expect(await provider().generateJson([{ role: "user", content: "x" }])).toEqual({ a: 1 });
    expect(recorded[0]?.body).toMatchObject({ response_format: { type: "json_object" } });
    const validated = await provider().generateJson([{ role: "user", content: "x" }], undefined, {
      validator: (v) => ({ ok: (v as { a: number }).a === 1 })
    });
    expect(validated).toEqual({ ok: true });
    handler = (_req, res) => json(res, 200, {});
    await expect(provider().generateJson([{ role: "user", content: "x" }])).rejects.toThrow(
      "kein gültiges JSON"
    );
  });
});

describe("OpenAiCompatibleProvider: Verbindungstest", () => {
  it("meldet Erfolg mit Modellliste", async () => {
    handler = (_req, res) => json(res, 200, { data: [{ id: "rf-auto" }, { id: 7 }, {}] });
    const out = await provider().probeHealth(new AbortController().signal);
    expect(out.ok).toBe(true);
    expect(out.models).toEqual(["rf-auto"]);
    expect(recorded[0]).toMatchObject({ method: "GET", path: "/v1/models" });
  });

  it("toleriert eine Antwort ohne JSON", async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.end("kein json");
    };
    expect((await provider().probeHealth()).models).toEqual([]);
  });

  it("meldet Fehler ohne Schlüssel im Text", async () => {
    handler = (_req, res) => json(res, 403, { error: `key ${KEY} gesperrt` });
    const out = await provider().probeHealth();
    expect(out.ok).toBe(false);
    expect(out.message).toContain("403");
    expect(out.message).not.toContain(KEY);
  });
});
