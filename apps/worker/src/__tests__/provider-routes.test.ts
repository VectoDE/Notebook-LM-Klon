import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoRouter } from "../auto-router.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { GeminiProvider } from "../gemini-provider.js";
import type { OllamaLocalProvider } from "../ollama-provider.js";
import { createProviderRoutes, registerProviderRoutes } from "../provider-routes.js";
import { RagRepository } from "../rag-repository.js";

function createMockD1(): { adapter: DatabaseAdapter; close: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  const m1 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql"),
    "utf-8"
  );
  sqlite.exec(m1);
  const m2 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql"),
    "utf-8"
  );
  sqlite.exec(m2);

  const adapter: DatabaseAdapter = {
    async query<T>(query: string, params: unknown[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(query);
      return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
    },
    async queryOne<T>(query: string, params: unknown[] = []): Promise<T | null> {
      const stmt = sqlite.prepare(query);
      const row = stmt.get(...(params as (string | number | bigint | null)[]));
      return (row as T) ?? null;
    },
    async run(query: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = sqlite.prepare(query);
      const result = stmt.run(...(params as (string | number | bigint | null)[]));
      return { changes: Number(result.changes) };
    },
    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    }
  };

  return { adapter, close: () => sqlite.close() };
}

describe("Provider Routes & GET /api/v1/providers (Issue #103)", () => {
  let adapter: DatabaseAdapter;
  let closeDb: () => void;
  let coreRepo: CoreRepository;
  let ragRepo: RagRepository;
  let autoRouter: AutoRouter;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  beforeEach(() => {
    const db = createMockD1();
    adapter = db.adapter;
    closeDb = db.close;
    coreRepo = new CoreRepository(adapter);
    ragRepo = new RagRepository(adapter);
    autoRouter = new AutoRouter();

    app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
  });

  afterEach(() => {
    closeDb();
  });

  it("registers routes and serves GET /api/v1/providers without session", async () => {
    registerProviderRoutes(app, { autoRouter });

    const res = await app.request("/api/v1/providers", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{ id: string; configured: boolean }>;
      autoDecisionDefault: { provider: string; model: string };
    };

    expect(body.providers.length).toBeGreaterThanOrEqual(2);
    expect(body.autoDecisionDefault.provider).toBe("google");
    expect(body.autoDecisionDefault.model).toBe("gemini-2.5-flash");
  });

  it("serves GET /api/v1/providers with user configured keys from RagRepository", async () => {
    await coreRepo.createUser({
      id: "usr_bob",
      email: "bob@example.com",
      display_name: "Bob",
      locale: "de",
      is_guest: 0,
      created_at: 1000,
      expires_at: null,
      deleted_at: null
    });

    await ragRepo.setProviderKey({
      id: "pk_1",
      user_id: "usr_bob",
      provider: "anthropic",
      encrypted_key: "enc_key",
      key_version: 1,
      last4: "1234",
      created_at: 1000,
      updated_at: 1000
    });

    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "usr_bob" });
      await next();
    });

    registerProviderRoutes(app, { autoRouter, ragRepo });

    const res = await app.request("/api/v1/providers", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      providers: Array<{ id: string; configured: boolean }>;
    };

    const anthropicEntry = body.providers.find((p) => p.id === "anthropic");
    expect(anthropicEntry?.configured).toBe(true);
  });

  it("evaluates POST /api/v1/providers/route with task and privacy options", async () => {
    registerProviderRoutes(app, { autoRouter });

    // 1. Privacy mode -> Ollama
    const resPrivacy = await app.request("/api/v1/providers/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privacyMode: true })
    });
    expect(resPrivacy.status).toBe(200);
    const bodyPrivacy = (await resPrivacy.json()) as { provider: string; isLocal: boolean };
    expect(bodyPrivacy.provider).toBe("ollama");
    expect(bodyPrivacy.isLocal).toBe(true);

    // 2. TTS task -> Gemini
    const resTts = await app.request("/api/v1/providers/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "tts" })
    });
    expect(resTts.status).toBe(200);
    const bodyTts = (await resTts.json()) as { provider: string; model: string };
    expect(bodyTts.provider).toBe("google");

    // 3. Empty request body fallback
    const resEmpty = await app.request("/api/v1/providers/route", {
      method: "POST"
    });
    expect(resEmpty.status).toBe(200);

    // 4. Detailed parameters with estimatedTokens and preferredModel
    const resTokens = await app.request("/api/v1/providers/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estimatedTokens: 1_500_000,
        preferredModel: "gemini-2.5-pro",
        availableKeys: ["google"]
      })
    });
    expect(resTokens.status).toBe(200);
    const bodyTokens = (await resTokens.json()) as { provider: string; model: string };
    expect(bodyTokens.provider).toBe("google");
    expect(bodyTokens.model).toBe("gemini-2.5-pro");
  });

  it("evaluates POST /api/v1/providers/route reading active keys from DB for sessionUser", async () => {
    await coreRepo.createUser({
      id: "usr_alice",
      email: "alice@example.com",
      display_name: "Alice",
      locale: "de",
      is_guest: 0,
      created_at: 2000,
      expires_at: null,
      deleted_at: null
    });

    await ragRepo.setProviderKey({
      id: "pk_2",
      user_id: "usr_alice",
      provider: "anthropic",
      encrypted_key: "enc_claude",
      key_version: 1,
      last4: "sonn",
      created_at: 2000,
      updated_at: 2000
    });

    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "usr_alice" });
      await next();
    });

    registerProviderRoutes(app, { autoRouter, ragRepo });

    const resCoding = await app.request("/api/v1/providers/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "coding" })
    });
    expect(resCoding.status).toBe(200);
    const bodyCoding = (await resCoding.json()) as { provider: string; model: string };
    expect(bodyCoding.provider).toBe("anthropic");
    expect(bodyCoding.model).toBe("claude-3-7-sonnet");
  });

  it("probes Ollama via GET /api/v1/providers/ollama/probe", async () => {
    const mockProbe = vi.fn().mockResolvedValue({ ok: true, latencyMs: 14 });
    const mockOllama = {
      id: "ollama",
      name: "Ollama",
      isLocal: true,
      trainingPolicy: "air-gapped-local",
      probeHealth: mockProbe
    } as unknown as OllamaLocalProvider;

    const routerWithGoogle = new AutoRouter();
    routerWithGoogle.registerProvider(new GeminiProvider({ apiKey: "AIzaTestKey" }));
    routerWithGoogle.registerProvider(mockOllama);
    registerProviderRoutes(app, { autoRouter: routerWithGoogle });

    const res = await app.request("/api/v1/providers/ollama/probe", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; latencyMs: number };
    expect(body.ok).toBe(true);
    expect(body.latencyMs).toBe(14);
  });

  it("handles Ollama probe when provider reports failure (e.g. 503)", async () => {
    const mockProbeFail = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Ollama down", latencyMs: 25 });
    const mockOllamaFail = {
      id: "ollama",
      name: "Ollama",
      isLocal: true,
      trainingPolicy: "air-gapped-local",
      probeHealth: mockProbeFail
    } as unknown as OllamaLocalProvider;

    const routerFail = new AutoRouter();
    routerFail.registerProvider(mockOllamaFail);
    const failApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerProviderRoutes(failApp, { autoRouter: routerFail });

    const res = await failApp.request("/api/v1/providers/ollama/probe", { method: "GET" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBe("Ollama down");
  });

  it("initializes default Gemini and Ollama providers with configured key and baseUrl", async () => {
    const customApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerProviderRoutes(customApp, {
      defaultGeminiKey: "AIzaCustomTestKey",
      ollamaBaseUrl: "http://custom-ollama:11434"
    });

    const res = await customApp.request("/api/v1/providers", { method: "GET" });
    expect(res.status).toBe(200);

    // Also test with empty dependencies to cover default empty initialization
    const bareApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerProviderRoutes(bareApp);
    const resBare = await bareApp.request("/api/v1/providers", { method: "GET" });
    expect(resBare.status).toBe(200);
  });

  it("handles Ollama probe when provider is missing or fails", async () => {
    const emptyRouter = new AutoRouter();
    // Register fake dummy that has no probeHealth
    emptyRouter.registerProvider({
      id: "ollama",
      name: "Ollama",
      isLocal: true,
      trainingPolicy: "air-gapped-local",
      chat: vi.fn(),
      chatStream: vi.fn(),
      embed: vi.fn(),
      generateJson: vi.fn()
    });

    const brokenApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    const routes = createProviderRoutes({ autoRouter: emptyRouter });
    brokenApp.route("/api/v1", routes);

    const res503 = await brokenApp.request("/api/v1/providers/ollama/probe", { method: "GET" });
    expect(res503.status).toBe(503);
  });
});
