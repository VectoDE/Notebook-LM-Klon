import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { KeyVault } from "../key-vault.js";
import type { RagRepository } from "../rag-repository.js";
import {
  GEMINI_TTS_MODEL,
  GeminiTtsError,
  type VideoTtsRoutesDependencies,
  createByokGeminiKeyResolver,
  extractTtsAudio,
  pcm16ToWav,
  registerVideoTtsRoutes,
  requestGeminiTts
} from "../video-tts-routes.js";

const DEMO_NB = "nb_demo_cloudflare_architecture";
const PCM = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const WAV = pcm16ToWav(PCM);

function interactionsResponse(data: string) {
  return {
    steps: [
      { type: "user_input", content: [{ type: "text", text: "x" }] },
      { type: "model_output", content: [{ type: "audio", data, mime_type: "audio/wav" }] }
    ]
  };
}

function okFetch(body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200 })
  );
}

function buildApp(deps: VideoTtsRoutesDependencies, user: { id: string } | null = { id: "u1" }) {
  const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
  app.use("*", async (c, next) => {
    if (user) c.set("sessionUser", user);
    await next();
  });
  registerVideoTtsRoutes(app, deps);
  return app;
}

function post(app: ReturnType<typeof buildApp>, notebookId: string, body: unknown) {
  return app.request(
    `/api/v1/notebooks/${notebookId}/video-tts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    },
    {} as Env
  );
}

describe("Video-TTS: WAV und Antwortformat (#241)", () => {
  it("pcm16ToWav schreibt einen gültigen RIFF-Kopf (24 kHz, mono, 16 Bit)", () => {
    const view = new DataView(WAV.buffer);
    expect(String.fromCharCode(...WAV.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...WAV.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(PCM.length);
    expect(WAV.length).toBe(44 + PCM.length);
    expect(new DataView(pcm16ToWav(PCM, 16_000).buffer).getUint32(24, true)).toBe(16_000);
  });

  it("extractTtsAudio: WAV aus Interactions, rohes PCM aus generateContent, sonst null", () => {
    expect(extractTtsAudio(interactionsResponse(b64(WAV)))).toEqual(WAV);
    expect(extractTtsAudio(interactionsResponse(b64(PCM)))).toEqual(WAV);
    expect(
      extractTtsAudio({
        candidates: [{ content: { parts: [{}, { inlineData: { data: b64(PCM) } }] } }]
      })
    ).toEqual(WAV);
    expect(extractTtsAudio({})).toBeNull();
    expect(extractTtsAudio({ steps: [{ type: "model_output" }], candidates: [{}] })).toBeNull();
    expect(
      extractTtsAudio({ steps: [{ type: "model_output", content: [{ type: "text" }] }] })
    ).toBeNull();
  });

  it("requestGeminiTts schickt Modell, Stimme und Schlüssel im Header", async () => {
    const fetchFn = okFetch(interactionsResponse(b64(WAV)));
    const audio = await requestGeminiTts({
      apiKey: "k1",
      text: "Hallo",
      fetchFn,
      url: "https://x.test"
    });
    expect(audio).toEqual(WAV);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.test");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k1");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(GEMINI_TTS_MODEL);
    expect(body.response_format).toEqual({ type: "audio" });
    expect(body.generation_config.speech_config).toEqual([{ voice: "Kore" }]);
    expect(body.input[0].content[0].text).toBe("Hallo");
  });

  it("requestGeminiTts: HTTP-Fehler und leere Antwort werden zu GeminiTtsError", async () => {
    const failing = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(
      requestGeminiTts({ apiKey: "k", text: "a", fetchFn: failing, voice: "Puck" })
    ).rejects.toMatchObject({
      name: "GeminiTtsError",
      status: 403
    });
    await expect(
      requestGeminiTts({ apiKey: "k", text: "a", fetchFn: okFetch({}) })
    ).rejects.toBeInstanceOf(GeminiTtsError);
  });

  it("requestGeminiTts nimmt ohne fetchFn das globale fetch", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(interactionsResponse(b64(WAV))), { status: 200 })
      );
    try {
      await expect(requestGeminiTts({ apiKey: "k", text: "a" })).resolves.toEqual(WAV);
      expect(spy.mock.calls[0]?.[0]).toContain("generativelanguage.googleapis.com");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Video-TTS: Route (#241)", () => {
  it("ohne Sitzung 401", async () => {
    const res = await post(buildApp({}, null), DEMO_NB, { text: "a" });
    expect(res.status).toBe(401);
  });

  it("ungültiges JSON 400, leerer oder zu langer Text 422", async () => {
    const app = buildApp({});
    expect((await post(app, "nb_x", "{oops")).status).toBe(400);
    expect((await post(app, "nb_x", { text: "  " })).status).toBe(422);
    expect((await post(app, "nb_x", { text: "a".repeat(5001) })).status).toBe(422);
    expect((await post(app, "nb_x", { text: "a", lang: "fr" })).status).toBe(422);
  });

  it("ohne Schlüssel: 409 TTS_KEY_MISSING mit verständlicher Erklärung", async () => {
    const res = await post(buildApp({ resolveUserKey: async () => undefined }), "nb_private", {
      text: "Hallo"
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("TTS_KEY_MISSING");
    expect(body.detail).toContain("Gemini-Schlüssel");
  });

  it("Demo-Schlüssel gilt nicht für private Notebooks", async () => {
    const fetchFn = okFetch(interactionsResponse(b64(WAV)));
    const res = await post(buildApp({ demoGeminiKey: "demo", fetchFn }), "nb_private", {
      text: "a"
    });
    expect(res.status).toBe(409);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("eigener Schlüssel (BYOK): WAV mit no-store", async () => {
    const fetchFn = okFetch(interactionsResponse(b64(WAV)));
    const res = await post(
      buildApp({ resolveUserKey: async () => "byok", fetchFn }),
      "nb_private",
      {
        text: "Hallo",
        lang: "en"
      }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WAV);
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("byok");
  });

  it("Demo-Notebook mit Demo-Schlüssel: Ton plus Demo-Hinweis", async () => {
    const fetchFn = okFetch(interactionsResponse(b64(WAV)));
    const res = await post(
      buildApp({
        demoGeminiKey: "demo",
        fetchFn,
        checkDemoRateLimit: async () => ({
          allowed: true,
          limit: 5,
          remaining: 4,
          retryAfterSeconds: 0,
          resetAt: Date.now() + 60_000
        })
      }),
      DEMO_NB,
      { text: "Hallo" }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Demo-Notice")).toContain("Demo-Modus");
    expect(res.headers.get("X-Demo-RateLimit-Remaining")).toBe("4");
  });

  it("Demo-Limit erreicht: 429 mit Retry-After", async () => {
    const res = await post(
      buildApp({
        demoGeminiKey: "demo",
        checkDemoRateLimit: async () => ({
          allowed: false,
          limit: 5,
          remaining: 0,
          retryAfterSeconds: 42,
          resetAt: Date.now() + 42_000,
          reason: "minute"
        })
      }),
      DEMO_NB,
      { text: "Hallo" }
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(((await res.json()) as { code: string }).code).toBe("DEMO_RATE_LIMITED");
  });

  it("Standard-Ratenlimit des Demo-Schlüssels greift ohne eigene Prüffunktion", async () => {
    const fetchFn = okFetch(interactionsResponse(b64(WAV)));
    const app = buildApp({ demoGeminiKey: "demo", fetchFn }, { id: "u_rl_default" });
    const res = await post(app, DEMO_NB, { text: "Hallo" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Demo-RateLimit-Limit")).toBe("5");
  });

  it("Fehler bei Gemini: 502 TTS_FAILED", async () => {
    const failing = vi.fn(async () => new Response("x", { status: 500 }));
    const res = await post(buildApp({ resolveUserKey: async () => "k", fetchFn: failing }), "nb", {
      text: "a"
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("TTS_FAILED");
    expect(body.detail).toContain("HTTP 500");
    const throwing = vi.fn(async () => {
      throw "netz weg";
    });
    const res2 = await post(
      buildApp({ resolveUserKey: async () => "k", fetchFn: throwing }),
      "nb",
      {
        text: "a"
      }
    );
    expect(((await res2.json()) as { detail: string }).detail).toBe("netz weg");
  });

  it("ohne Abhängigkeiten registrierbar", async () => {
    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerVideoTtsRoutes(app);
    const res = await app.request("/api/v1/notebooks/nb/video-tts", { method: "POST" }, {} as Env);
    expect(res.status).toBe(401);
  });
});

describe("Video-TTS: BYOK-Schlüssel lesen (#241)", () => {
  const repo = (row: unknown) =>
    ({ getProviderKey: vi.fn(async () => row) }) as unknown as RagRepository;

  it("ohne Tresor, ohne gespeicherten Schlüssel oder bei Fehler: undefined", async () => {
    expect(
      await createByokGeminiKeyResolver(repo({ encrypted_key: "x" }), undefined)("u")
    ).toBeUndefined();
    const vault = { decrypt: vi.fn() } as unknown as KeyVault;
    expect(await createByokGeminiKeyResolver(repo(null), vault)("u")).toBeUndefined();
    // Kaputter Datensatz: Deserialisieren wirft
    expect(
      await createByokGeminiKeyResolver(repo({ encrypted_key: "kaputt" }), vault)("u")
    ).toBeUndefined();
  });

  it("entschlüsselt den Google-Schlüssel des Kontos", async () => {
    const payload = JSON.stringify({ version: 1, iv: "aXY=", ciphertext: "Y3Q=" });
    const decrypt = vi.fn(async () => "AIza-test");
    const resolver = createByokGeminiKeyResolver(repo({ encrypted_key: payload }), {
      decrypt
    } as unknown as KeyVault);
    expect(await resolver("u7")).toBe("AIza-test");
    expect(decrypt).toHaveBeenCalledWith(expect.anything(), { userId: "u7", provider: "google" });
  });
});
