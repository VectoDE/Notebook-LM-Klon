import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_EMBED_DIMENSIONS,
  DEFAULT_GEMINI_EMBED_MODEL,
  GeminiProvider
} from "../gemini-provider.js";

describe("GeminiProvider (Issue #101)", () => {
  const dummyApiKey = "AIzaSyDummyKeyForTestingPurposes123456";

  it("initializes with default models and policies", () => {
    const provider = new GeminiProvider({ apiKey: dummyApiKey });
    expect(provider.id).toBe("google");
    expect(provider.name).toBe("Google Gemini");
    expect(provider.isLocal).toBe(false);
    expect(provider.trainingPolicy).toBe("free-tier-trained");
  });

  it("throws error when apiKey is missing", async () => {
    const provider = new GeminiProvider();
    await expect(provider.chat([{ role: "user", content: "Hallo" }])).rejects.toThrow(
      "Gemini API-Key fehlt"
    );
  });

  it("performs chat call with correct body and extracts text and usage", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Antwort auf Deutsch" }],
                role: "model"
              },
              finishReason: "STOP"
            }
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 10,
            totalTokenCount: 25
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const response = await provider.chat(
      [
        { role: "system", content: "Du bist ein hilfreicher Assistent." },
        {
          role: "user",
          content: [
            { text: "Was ist RelationFlow?" },
            { inlineData: { mimeType: "image/png", data: "base64data" } }
          ]
        }
      ],
      {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 1024,
        stopSequences: ["ENDE"]
      }
    );

    expect(capturedUrl).toContain(`models/${DEFAULT_GEMINI_CHAT_MODEL}:generateContent?key=`);
    expect(capturedBody).toHaveProperty("systemInstruction");
    expect(capturedBody).toHaveProperty("contents");
    expect(capturedBody).toHaveProperty("generationConfig");

    expect(response.text).toBe("Antwort auf Deutsch");
    expect(response.model).toBe(DEFAULT_GEMINI_CHAT_MODEL);
    expect(response.finishReason).toBe("stop");
    expect(response.usage).toEqual({
      promptTokens: 15,
      completionTokens: 10,
      totalTokens: 25
    });
  });

  it("handles different finish reasons (max_tokens, safety, unknown)", async () => {
    const reasons = [
      { raw: "MAX_TOKENS", expected: "max_tokens" },
      { raw: "SAFETY", expected: "safety" },
      { raw: "RECITATION", expected: "safety" },
      { raw: "OTHER", expected: "unknown" },
      { raw: undefined, expected: undefined }
    ];

    for (const r of reasons) {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: "part" }] },
                finishReason: r.raw
              }
            ]
          }),
          { status: 200 }
        )
      );

      const provider = new GeminiProvider({
        apiKey: dummyApiKey,
        fetchFn: mockFetch as unknown as typeof fetch
      });
      const res = await provider.chat([{ role: "user", content: "Hi" }]);
      expect(res.finishReason).toBe(r.expected);
    }
  });

  it("handles HTTP error responses gracefully in chat", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: "Resource exhausted: Quota exceeded",
            status: "RESOURCE_EXHAUSTED"
          }
        }),
        { status: 429 }
      )
    );

    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });

    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Gemini API Fehler (429): Resource exhausted"
    );
  });

  it("handles non-JSON HTTP errors in chat", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Gemini API Fehler (502): Bad Gateway"
    );
  });

  it("supports chat streaming via SSE and parses chunks correctly", async () => {
    const sseChunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hallo "},{"inlineData":{"data":"x","mimeType":"image/png"}}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"Welt!"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}\n\n',
      "data:   \n\n",
      ": keepalive comment\n\n",
      "data: [DONE]\n\n"
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const c of sseChunks) {
          controller.enqueue(new TextEncoder().encode(c));
        }
        controller.close();
      }
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const collectedChunks: string[] = [];
    let isDoneSeen = false;

    for await (const chunk of provider.chatStream([{ role: "user", content: "Test" }])) {
      if (chunk.deltaText) collectedChunks.push(chunk.deltaText);
      if (chunk.isDone) isDoneSeen = true;
    }

    expect(collectedChunks.join("")).toBe("Hallo Welt!");
    expect(isDoneSeen).toBe(true);
  });

  it("handles streaming buffer flush on final line", async () => {
    const sseChunk =
      'data: {"candidates":[{"content":{"parts":[{"text":"Letzter Brocken"}]},"finishReason":"STOP"}]}';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseChunk));
        controller.close();
      }
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const collected: string[] = [];
    for await (const chunk of provider.chatStream([{ role: "user", content: "Test" }])) {
      collected.push(chunk.deltaText);
    }
    expect(collected).toContain("Letzter Brocken");
  });

  it("throws on streaming HTTP error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Stream failed" } }), { status: 500 })
      );
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    const streamGen = provider.chatStream([{ role: "user", content: "Test" }]);
    await expect(streamGen[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Gemini Stream Fehler (500)"
    );
  });

  it("throws when streaming response has no body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null
    });
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    const streamGen = provider.chatStream([{ role: "user", content: "Test" }]);
    await expect(streamGen[Symbol.asyncIterator]().next()).rejects.toThrow("keinen Body");
  });

  it("embeds texts with 768 dimensions by default", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          embeddings: [
            { values: new Array(DEFAULT_GEMINI_EMBED_DIMENSIONS).fill(0.123) },
            { values: new Array(DEFAULT_GEMINI_EMBED_DIMENSIONS).fill(-0.456) }
          ]
        }),
        { status: 200 }
      );
    });

    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    const vectors = await provider.embed(["Text 1", "Text 2"]);

    expect(capturedUrl).toContain(`models/${DEFAULT_GEMINI_EMBED_MODEL}:batchEmbedContents`);
    expect(capturedBody).toHaveProperty("requests");
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.length).toBe(DEFAULT_GEMINI_EMBED_DIMENSIONS);
    expect(vectors[1]?.length).toBe(DEFAULT_GEMINI_EMBED_DIMENSIONS);
  });

  it("returns empty array when embedding empty list of texts", async () => {
    const provider = new GeminiProvider({ apiKey: dummyApiKey });
    const res = await provider.embed([]);
    expect(res).toEqual([]);
  });

  it("handles embedding error responses", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Invalid dimension" } }), { status: 400 })
      );
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    await expect(provider.embed(["test"])).rejects.toThrow("Gemini Embedding Fehler (400)");
  });

  it("throws when embedding response has no embeddings array", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    await expect(provider.embed(["test"])).rejects.toThrow("keine Embeddings zurueckgegeben");
  });

  it("generates structured JSON and validates with schema", async () => {
    interface TestResult {
      summary: string;
      confidence: number;
    }

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ summary: "Ergebnis", confidence: 0.98 }) }]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    const result = await provider.generateJson<TestResult>(
      [{ role: "user", content: "Extrahiere Daten" }],
      { type: "OBJECT" },
      {
        validator: (v: unknown) => {
          const obj = v as TestResult;
          if (!obj.summary) throw new Error("Kein summary");
          return obj;
        }
      }
    );

    expect(result.summary).toBe("Ergebnis");
    expect(result.confidence).toBe(0.98);
  });

  it("handles JSON generation error and invalid JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "NOT_JSON" }] } }]
        }),
        { status: 200 }
      )
    );
    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    await expect(provider.generateJson([{ role: "user", content: "Test" }])).rejects.toThrow(
      "Gemini JSON ungueltig"
    );
  });

  it("throws on empty JSON response or HTTP error in generateJson", async () => {
    const mockFetchEmpty = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "   " }] } }] }), {
        status: 200
      })
    );
    const providerEmpty = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetchEmpty as unknown as typeof fetch
    });
    await expect(providerEmpty.generateJson([{ role: "user", content: "Test" }])).rejects.toThrow(
      "leere JSON-Antwort"
    );

    const mockFetchErr = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Quota" } }), { status: 429 })
      );
    const providerErr = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetchErr as unknown as typeof fetch
    });
    await expect(providerErr.generateJson([{ role: "user", content: "Test" }])).rejects.toThrow(
      "Gemini JSON Fehler (429)"
    );
  });

  it("probes health successfully or reports failure", async () => {
    const okFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const p1 = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: okFetch as unknown as typeof fetch
    });
    const probe1 = await p1.probeHealth();
    expect(probe1.ok).toBe(true);

    const noKeyP = new GeminiProvider();
    const probeNoKey = await noKeyP.probeHealth();
    expect(probeNoKey.ok).toBe(false);
    expect(probeNoKey.message).toContain("Kein API-Key");

    const errFetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 403, statusText: "Forbidden" }));
    const pErr = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: errFetch as unknown as typeof fetch
    });
    const probeErr = await pErr.probeHealth();
    expect(probeErr.ok).toBe(false);
    expect(probeErr.message).toContain("403");

    const throwFetch = vi.fn().mockRejectedValue(new Error("Network Down"));
    const pThrow = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: throwFetch as unknown as typeof fetch
    });
    const probeThrow = await pThrow.probeHealth();
    expect(probeThrow.ok).toBe(false);
    expect(probeThrow.message).toBe("Network Down");

    // Probe with custom signal
    const controller = new AbortController();
    const pSignal = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: okFetch as unknown as typeof fetch
    });
    const probeSignal = await pSignal.probeHealth(controller.signal);
    expect(probeSignal.ok).toBe(true);
  });

  it("covers options in generateJson (temperature, topP, maxOutputTokens, signal)", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true }) }] } }]
        }),
        { status: 200 }
      );
    });

    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    const controller = new AbortController();

    const res = await provider.generateJson<{ ok: boolean }>(
      [{ role: "user", content: "Test options" }],
      { type: "OBJECT" },
      {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 50,
        signal: controller.signal
      }
    );

    expect(res.ok).toBe(true);
    expect(capturedBody.generationConfig).toMatchObject({
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 50
    });
  });

  it("handles complex system message and multi-part content in chat and chatStream", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "System acknowledged" }] } }]
        }),
        { status: 200 }
      );
    });

    const provider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockFetch as unknown as typeof fetch
    });
    await provider.chat([
      { role: "system", content: [{ text: "Line 1" }, { text: "Line 2" }] },
      { role: "system", content: "Line 3" },
      { role: "assistant", content: "Prior response" },
      { role: "user", content: "New question" }
    ]);

    expect(capturedBody.systemInstruction).toBeDefined();

    // Now test chatStream with options (temperature, topP, maxOutputTokens, stopSequences)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"Streamed"}]},"finishReason":"STOP"}]}\n\n'
          )
        );
        controller.close();
      }
    });

    let streamCapturedBody: Record<string, unknown> = {};
    const mockStreamFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      streamCapturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(stream, { status: 200 });
    });

    const streamProvider = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockStreamFetch as unknown as typeof fetch
    });

    const chunks: string[] = [];
    for await (const chunk of streamProvider.chatStream(
      [{ role: "user", content: "Stream test" }],
      {
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: 200,
        stopSequences: ["END"]
      }
    )) {
      chunks.push(chunk.deltaText);
    }

    expect(chunks).toContain("Streamed");
    expect(streamCapturedBody.generationConfig).toMatchObject({
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 200,
      stopSequences: ["END"]
    });
    // HTTP errors without error.message
    const mockNoMsg = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ error: { code: 500 } }), { status: 500 })
      );
    const pNoMsg = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockNoMsg as unknown as typeof fetch
    });
    await expect(pNoMsg.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Gemini API Fehler (500)"
    );
    await expect(pNoMsg.embed(["test"])).rejects.toThrow("Gemini Embedding Fehler (500)");
    await expect(pNoMsg.generateJson([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Gemini JSON Fehler (500)"
    );
    const streamNoMsgGen = pNoMsg.chatStream([{ role: "user", content: "Hi" }]);
    await expect(streamNoMsgGen[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Gemini Stream Fehler (500)"
    );

    // System instruction in generateJson and chatStream
    let jsonCapturedBody: Record<string, unknown> = {};
    const mockJsonSys = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      jsonCapturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: '{"result":"ok"}' },
                  { inlineData: { data: "abc", mimeType: "image/png" } }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      );
    });
    const pJsonSys = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockJsonSys as unknown as typeof fetch
    });
    const jsonRes = await pJsonSys.generateJson<{ result: string }>([
      { role: "system", content: "System prompt" },
      { role: "user", content: "User prompt" }
    ]);
    expect(jsonRes.result).toBe("ok");
    expect(jsonCapturedBody.systemInstruction).toBeDefined();

    // Stream with trailer chunk without content/candidateParts and one with parts
    const trailerStream = new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{}}]}\ndata: {"candidates":[{}]}\n'
          )
        );
        c.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"inlineData":{"data":"x","mimeType":"image/png"}},{"text":"Final"}]}}]}'
          )
        );
        c.close();
      }
    });
    const mockTrailer = vi.fn().mockResolvedValue(new Response(trailerStream, { status: 200 }));
    const pTrailer = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockTrailer as unknown as typeof fetch
    });
    const streamCollected: string[] = [];
    for await (const chunk of pTrailer.chatStream([
      { role: "system", content: "System stream" },
      { role: "user", content: "Hi" }
    ])) {
      if (chunk.deltaText) streamCollected.push(chunk.deltaText);
    }
    expect(streamCollected).toContain("Final");

    // Stream where candidate in trailer has NO candidateParts at all
    const trailerNoPartsStream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{}}]}'));
        c.close();
      }
    });
    const pTrailerNoParts = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: vi
        .fn()
        .mockResolvedValue(
          new Response(trailerNoPartsStream, { status: 200 })
        ) as unknown as typeof fetch
    });
    for await (const chunk of pTrailerNoParts.chatStream([{ role: "user", content: "Hi" }])) {
      expect(chunk.deltaText).toBe("");
    }

    // Chat with part without text
    const mockEmptyPart = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "" }, { inlineData: { data: "x", mimeType: "image/png" } }]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    const pEmptyPart = new GeminiProvider({
      apiKey: dummyApiKey,
      fetchFn: mockEmptyPart as unknown as typeof fetch
    });
    const resEmpty = await pEmptyPart.chat([{ role: "user", content: "Hi" }]);
    expect(resEmpty.text).toBe("");
  });
});
