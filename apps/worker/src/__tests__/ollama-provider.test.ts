import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  OllamaLocalProvider
} from "../ollama-provider.js";

describe("OllamaLocalProvider (Issue #102)", () => {
  it("initializes with local defaults and air-gapped policy", () => {
    const provider = new OllamaLocalProvider();
    expect(provider.id).toBe("ollama");
    expect(provider.isLocal).toBe(true);
    expect(provider.trainingPolicy).toBe("air-gapped-local");
    expect(provider.name).toContain("Air-Gapped");
  });

  it("handles basic chat and options correctly", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "llama3",
          message: { role: "assistant", content: "Lokale Antwort" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 12,
          eval_count: 8
        }),
        { status: 200 }
      );
    });

    const provider = new OllamaLocalProvider({ fetchFn: mockFetch as unknown as typeof fetch });
    const res = await provider.chat(
      [
        { role: "system", content: "Lokaler Prompt" },
        {
          role: "user",
          content: [
            { text: "Frage an Ollama" },
            { inlineData: { mimeType: "image/jpeg", data: "imgdata" } }
          ]
        }
      ],
      {
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 256,
        stopSequences: ["STOP"]
      }
    );

    expect(capturedUrl).toBe(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`);
    expect(capturedBody.model).toBe(DEFAULT_OLLAMA_CHAT_MODEL);
    expect(capturedBody.stream).toBe(false);
    expect(capturedBody).toHaveProperty("options");
    expect(res.text).toBe("Lokale Antwort");
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20
    });

    // Chat with done: true but no done_reason
    const mockDoneOnly = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ model: "llama3", message: { content: "Done" }, done: true }),
          { status: 200 }
        )
      );
    const pDoneOnly = new OllamaLocalProvider({ fetchFn: mockDoneOnly as unknown as typeof fetch });
    const resDone = await pDoneOnly.chat([{ role: "user", content: "Hi" }]);
    expect(resDone.finishReason).toBe("stop");

    // Chat with neither done_reason === 'stop' nor done: true
    const mockUnknown = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ model: "llama3", message: { content: "Unknown" }, done: false }),
          { status: 200 }
        )
      );
    const pUnknown = new OllamaLocalProvider({ fetchFn: mockUnknown as unknown as typeof fetch });
    const resUnknown = await pUnknown.chat([{ role: "user", content: "Hi" }]);
    expect(resUnknown.finishReason).toBe("unknown");

    // Chat with response without model or message
    const mockNoModel = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ done: false }), { status: 200 }));
    const pNoModel = new OllamaLocalProvider({ fetchFn: mockNoModel as unknown as typeof fetch });
    const resNoModel = await pNoModel.chat([{ role: "user", content: "Hi" }]);
    expect(resNoModel.model).toBe("llama3");
    expect(resNoModel.text).toBe("");

    // Chat without prompt_eval_count (no usage)
    const mockNoUsage = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ model: "llama3", message: { content: "No usage" }, done: true }),
          { status: 200 }
        )
      );
    const pNoUsage = new OllamaLocalProvider({ fetchFn: mockNoUsage as unknown as typeof fetch });
    const resNoUsage = await pNoUsage.chat([{ role: "user", content: "Hi" }]);
    expect(resNoUsage.usage).toBeUndefined();

    // Chat with prompt_eval_count but no eval_count
    const mockPromptOnly = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "llama3",
          message: { content: "Prompt only" },
          done: true,
          prompt_eval_count: 5
        }),
        { status: 200 }
      )
    );
    const pPromptOnly = new OllamaLocalProvider({
      fetchFn: mockPromptOnly as unknown as typeof fetch
    });
    const resPrompt = await pPromptOnly.chat([{ role: "user", content: "Hi" }]);
    expect(resPrompt.usage?.completionTokens).toBe(0);
    expect(resPrompt.usage?.totalTokens).toBe(5);
  });

  it("provides helpful CORS and connection error message on ECONNREFUSED", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("fetch failed: ECONNREFUSED 127.0.0.1:11434"));
    const provider = new OllamaLocalProvider({ fetchFn: mockFetch as unknown as typeof fetch });

    await expect(provider.chat([{ role: "user", content: "Test" }])).rejects.toThrow(
      "Ollama nicht erreichbar unter http://localhost:11434"
    );
  });

  it("handles HTTP error status codes and error payloads in chat", async () => {
    const mockFetchStatus = vi
      .fn()
      .mockResolvedValue(new Response("Model not found", { status: 404 }));
    const providerStatus = new OllamaLocalProvider({
      fetchFn: mockFetchStatus as unknown as typeof fetch
    });
    await expect(providerStatus.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Ollama API Fehler (404)"
    );

    const mockFetchPayload = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Context limit exceeded" }), { status: 200 })
      );
    const providerPayload = new OllamaLocalProvider({
      fetchFn: mockFetchPayload as unknown as typeof fetch
    });
    await expect(providerPayload.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Ollama API Fehler: Context limit exceeded"
    );
  });

  it("streams NDJSON chunks and parses usage at completion", async () => {
    const ndjsonChunks = [
      '{"model":"llama3","message":{"role":"assistant","content":"Teil 1"},"done":false}\n',
      '{"model":"llama3","message":{"role":"assistant","content":" Teil 2"},"done":true,"prompt_eval_count":10,"eval_count":5}\n'
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const c of ndjsonChunks) {
          controller.enqueue(new TextEncoder().encode(c));
        }
        controller.close();
      }
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const provider = new OllamaLocalProvider({ fetchFn: mockFetch as unknown as typeof fetch });

    const collected: string[] = [];
    let isDone = false;

    for await (const chunk of provider.chatStream([{ role: "user", content: "Hi" }])) {
      if (chunk.deltaText) collected.push(chunk.deltaText);
      if (chunk.isDone) isDone = true;
    }

    expect(collected.join("")).toBe("Teil 1 Teil 2");
    expect(isDone).toBe(true);
  });

  it("handles streaming error in NDJSON line or missing body", async () => {
    const errorNdjson = '{"error":"GPU Out of memory"}\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(errorNdjson));
        controller.close();
      }
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const provider = new OllamaLocalProvider({ fetchFn: mockFetch as unknown as typeof fetch });
    const gen = provider.chatStream([{ role: "user", content: "Hi" }]);
    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Ollama Stream Fehler: GPU Out of memory"
    );

    // Streaming with malformed JSON chunk followed by valid chunk
    const malformedStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'not-valid-json\n{"model":"llama3","message":{"content":"Recovered"},"done":true}\n'
          )
        );
        controller.close();
      }
    });
    const pMalformed = new OllamaLocalProvider({
      fetchFn: vi
        .fn()
        .mockResolvedValue(
          new Response(malformedStream, { status: 200 })
        ) as unknown as typeof fetch
    });
    const malformedChunks: string[] = [];
    for await (const chunk of pMalformed.chatStream([{ role: "user", content: "Hi" }])) {
      if (chunk.deltaText) malformedChunks.push(chunk.deltaText);
    }
    expect(malformedChunks).toContain("Recovered");

    const noBodyFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: null });
    const pNoBody = new OllamaLocalProvider({ fetchFn: noBodyFetch as unknown as typeof fetch });
    const genNoBody = pNoBody.chatStream([{ role: "user", content: "Hi" }]);
    await expect(genNoBody[Symbol.asyncIterator]().next()).rejects.toThrow("keinen Body");

    // Network error on chatStream
    const netErrFetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const pNetErr = new OllamaLocalProvider({ fetchFn: netErrFetch as unknown as typeof fetch });
    const genNetErr = pNetErr.chatStream([{ role: "user", content: "Hi" }]);
    await expect(genNetErr[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Ollama nicht erreichbar"
    );

    // HTTP error on chatStream
    const httpErrFetch = vi
      .fn()
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));
    const pHttpErr = new OllamaLocalProvider({ fetchFn: httpErrFetch as unknown as typeof fetch });
    const genHttpErr = pHttpErr.chatStream([{ role: "user", content: "Hi" }]);
    await expect(genHttpErr[Symbol.asyncIterator]().next()).rejects.toThrow(
      "Ollama Stream Fehler (503)"
    );
  });

  it("embeds texts using batch /api/embed and falls back to /api/embeddings", async () => {
    // 1. Successful batch embed
    const mockBatchFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          embeddings: [new Array(768).fill(0.1), new Array(768).fill(0.2)]
        }),
        { status: 200 }
      )
    );
    const pBatch = new OllamaLocalProvider({ fetchFn: mockBatchFetch as unknown as typeof fetch });
    const vectors = await pBatch.embed(["text1", "text2"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.length).toBe(768);

    // 2. Empty texts
    expect(await pBatch.embed([])).toEqual([]);

    // 3. Fallback when batch fails (e.g. 404 on legacy Ollama)
    let callIndex = 0;
    const mockFallbackFetch = vi.fn().mockImplementation(async (url: string) => {
      callIndex++;
      if (url.includes("/api/embed") && !url.includes("/api/embeddings")) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(JSON.stringify({ embedding: new Array(768).fill(0.9) }), { status: 200 });
    });

    const pFallback = new OllamaLocalProvider({
      fetchFn: mockFallbackFetch as unknown as typeof fetch
    });
    const fallbackVectors = await pFallback.embed(["fallback text"]);
    expect(fallbackVectors).toHaveLength(1);
    expect(fallbackVectors[0]?.[0]).toBeCloseTo(0.9);
    expect(callIndex).toBe(2);
  });

  it("handles errors during embedding fallback", async () => {
    const mockFailFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/embed") && !url.includes("/api/embeddings")) {
        return new Response("Not found", { status: 404 });
      }
      return new Response("Internal Server Error", { status: 500 });
    });

    const pFail = new OllamaLocalProvider({ fetchFn: mockFailFetch as unknown as typeof fetch });
    await expect(pFail.embed(["fail"])).rejects.toThrow("Ollama Embedding Fehler (500)");

    // Network error during fallback fetch
    const mockNetFail = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/embed") && !url.includes("/api/embeddings")) {
        return new Response("Not found", { status: 404 });
      }
      throw new Error("fetch failed");
    });
    const pNetFail = new OllamaLocalProvider({ fetchFn: mockNetFail as unknown as typeof fetch });
    await expect(pNetFail.embed(["fail"])).rejects.toThrow("Ollama nicht erreichbar");

    const mockEmptyEmb = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/embed") && !url.includes("/api/embeddings")) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const pEmpty = new OllamaLocalProvider({ fetchFn: mockEmptyEmb as unknown as typeof fetch });
    await expect(pEmpty.embed(["fail"])).rejects.toThrow("kein Embedding zurueckgegeben");
  });

  it("generates structured JSON with schema or format", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({ item: "Test", count: 3 })
          }
        }),
        { status: 200 }
      )
    );

    const provider = new OllamaLocalProvider({ fetchFn: mockFetch as unknown as typeof fetch });
    const res = await provider.generateJson<{ item: string; count: number }>(
      [{ role: "user", content: "Gib JSON" }],
      { type: "object" },
      {
        validator: (v) => v as { item: string; count: number }
      }
    );

    expect(res.item).toBe("Test");
    expect(res.count).toBe(3);
  });

  it("throws on invalid or empty JSON in generateJson", async () => {
    const mockEmpty = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: { content: "  " } }), { status: 200 })
      );
    const pEmpty = new OllamaLocalProvider({ fetchFn: mockEmpty as unknown as typeof fetch });
    await expect(pEmpty.generateJson([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "leere JSON-Antwort"
    );

    const mockBadJson = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: { content: "not-json" } }), { status: 200 })
      );
    const pBad = new OllamaLocalProvider({ fetchFn: mockBadJson as unknown as typeof fetch });
    await expect(pBad.generateJson([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Ollama JSON ungueltig"
    );

    const mockErr = vi.fn().mockResolvedValue(new Response("Bad Request", { status: 400 }));
    const pErr = new OllamaLocalProvider({ fetchFn: mockErr as unknown as typeof fetch });
    await expect(pErr.generateJson([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Ollama JSON Fehler (400)"
    );
  });

  it("probes health via /api/tags successfully or reports error", async () => {
    const okFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }));
    const pOk = new OllamaLocalProvider({ fetchFn: okFetch as unknown as typeof fetch });
    const probeOk = await pOk.probeHealth();
    expect(probeOk.ok).toBe(true);
    expect(probeOk.latencyMs).toBeGreaterThanOrEqual(0);

    const errFetch = vi
      .fn()
      .mockResolvedValue(
        new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" })
      );
    const pErr = new OllamaLocalProvider({ fetchFn: errFetch as unknown as typeof fetch });
    const probeErr = await pErr.probeHealth();
    expect(probeErr.ok).toBe(false);
    expect(probeErr.message).toContain("503");

    const throwFetch = vi.fn().mockRejectedValue(new Error("Network connection down"));
    const pThrow = new OllamaLocalProvider({ fetchFn: throwFetch as unknown as typeof fetch });
    const probeThrow = await pThrow.probeHealth();
    expect(probeThrow.ok).toBe(false);
    expect(probeThrow.message).toBe("Network connection down");
  });

  it("handles empty stream chunks and unexpected error objects in enhanceFetchError", async () => {
    // String error instead of Error instance in enhanceFetchError
    const mockStringThrow = vi.fn().mockRejectedValue("Generic string failure");
    const pString = new OllamaLocalProvider({
      fetchFn: mockStringThrow as unknown as typeof fetch
    });
    await expect(pString.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Generic string failure"
    );

    // Stream with blank lines and trailing buffer flush
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("\n\n"));
        controller.enqueue(
          new TextEncoder().encode(
            '{"model":"llama3","message":{"role":"assistant","content":"Trailing"},"done":true}'
          )
        );
        controller.close();
      }
    });

    const mockStreamFetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const pStream = new OllamaLocalProvider({
      fetchFn: mockStreamFetch as unknown as typeof fetch
    });

    const chunks: string[] = [];
    for await (const chunk of pStream.chatStream([{ role: "user", content: "Hi" }])) {
      chunks.push(chunk.deltaText);
    }
    expect(chunks).toContain("Trailing");
  });

  it("covers generateJson options (temperature, topP, maxOutputTokens) and probeHealth with signal", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          message: { content: JSON.stringify({ ok: true }) }
        }),
        { status: 200 }
      );
    });

    const provider = new OllamaLocalProvider({ fetchFn: mockFetch as unknown as typeof fetch });
    const controller = new AbortController();

    const res = await provider.generateJson<{ ok: boolean }>(
      [{ role: "user", content: "Hi" }],
      undefined,
      {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 64,
        signal: controller.signal
      }
    );

    expect(res.ok).toBe(true);
    expect(capturedBody.options).toMatchObject({
      temperature: 0.2,
      top_p: 0.8,
      num_predict: 64
    });

    // Probe with signal
    const probe = await provider.probeHealth(controller.signal);
    expect(probe.ok).toBe(true);

    // Network error in generateJson
    const mockThrow = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const pThrow = new OllamaLocalProvider({ fetchFn: mockThrow as unknown as typeof fetch });
    await expect(pThrow.generateJson([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Ollama nicht erreichbar"
    );

    // Non-Error exception in enhanceFetchError
    const mockStringThrow = vi.fn().mockRejectedValue("string exception");
    const pStringThrow = new OllamaLocalProvider({
      fetchFn: mockStringThrow as unknown as typeof fetch
    });
    await expect(pStringThrow.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "string exception"
    );

    // Standard Error exception not matching ECONNREFUSED
    const mockGenericError = vi
      .fn()
      .mockRejectedValue(new Error("Generic failure without connection keywords"));
    const pGenericError = new OllamaLocalProvider({
      fetchFn: mockGenericError as unknown as typeof fetch
    });
    await expect(pGenericError.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "Generic failure without connection keywords"
    );

    // Message without images (mapMessages images.length === 0 branch)
    const mockNoImg = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.messages).toEqual([{ role: "user", content: "Text only message" }]);
      return new Response(
        JSON.stringify({ model: "llama3", message: { content: "OK" }, done: true }),
        { status: 200 }
      );
    });
    const pNoImg = new OllamaLocalProvider({ fetchFn: mockNoImg as unknown as typeof fetch });
    await pNoImg.chat([{ role: "user", content: [{ text: "Text only message" }] }]);

    // Stream chunk with parsed.eval_count missing, and chunk without message/model
    const streamSpecial = new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            '{"done":false}\n{"model":"llama3","done":true,"prompt_eval_count":7}\n'
          )
        );
        c.close();
      }
    });
    const pSpecialStream = new OllamaLocalProvider({
      fetchFn: vi
        .fn()
        .mockResolvedValue(new Response(streamSpecial, { status: 200 })) as unknown as typeof fetch
    });
    const specialChunks: string[] = [];
    for await (const chunk of pSpecialStream.chatStream([{ role: "user", content: "Hi" }])) {
      specialChunks.push(chunk.deltaText);
    }
    expect(specialChunks).toEqual(["", ""]);

    // Stream trailer chunk without model/message/done
    const streamTrailerSpecial = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"done":false}'));
        c.close();
      }
    });
    const pTrailerSpecial = new OllamaLocalProvider({
      fetchFn: vi
        .fn()
        .mockResolvedValue(
          new Response(streamTrailerSpecial, { status: 200 })
        ) as unknown as typeof fetch
    });
    for await (const chunk of pTrailerSpecial.chatStream([{ role: "user", content: "Hi" }])) {
      expect(chunk.finishReason).toBeUndefined();
      expect(chunk.model).toBe("llama3");
    }

    // Embeddings where data.embeddings is empty array
    let embedCallCount = 0;
    const pEmptyBatchEmbed = new OllamaLocalProvider({
      fetchFn: vi.fn().mockImplementation(async (url: string) => {
        embedCallCount++;
        if (url.endsWith("/api/embed")) {
          return new Response(JSON.stringify({ embeddings: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 });
      }) as unknown as typeof fetch
    });
    const emptyBatchRes = await pEmptyBatchEmbed.embed(["test"]);
    expect(emptyBatchRes.length).toBe(1);
    expect(embedCallCount).toBe(2);

    // generateJson where data.message is undefined
    const pNoMsgJson = new OllamaLocalProvider({
      fetchFn: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({}), { status: 200 })
        ) as unknown as typeof fetch
    });
    await expect(pNoMsgJson.generateJson([{ role: "user", content: "Hi" }])).rejects.toThrow(
      "leere JSON-Antwort"
    );
    const streamFetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                '{"model":"llama3","message":{"role":"assistant","content":"Done"},"done":true}\n'
              )
            );
            c.close();
          }
        }),
        { status: 200 }
      )
    );
    const pChatStream = new OllamaLocalProvider({
      fetchFn: streamFetch as unknown as typeof fetch
    });
    let streamOptsCaptured: Record<string, unknown> = {};
    streamFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      streamOptsCaptured = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                '{"model":"llama3","message":{"role":"assistant","content":"Done"},"done":true}\n'
              )
            );
            c.close();
          }
        }),
        { status: 200 }
      );
    });

    for await (const chunk of pChatStream.chatStream([{ role: "user", content: "Hi" }], {
      temperature: 0.1,
      topP: 0.7,
      maxOutputTokens: 128,
      stopSequences: ["STOP"]
    })) {
      expect(chunk.deltaText).toBe("Done");
    }
    expect(streamOptsCaptured.options).toMatchObject({
      temperature: 0.1,
      top_p: 0.7,
      num_predict: 128,
      stop: ["STOP"]
    });
  });
});
