import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AudioInterjectResponse,
  LlmProvider,
  LlmResponse,
  LlmStreamChunk
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { registerAudioRoutes } from "../audio-routes.js";
import { AutoRouter } from "../auto-router.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { KeyVault } from "../key-vault.js";
import { RagRepository } from "../rag-repository.js";

function createMockD1(): { db: D1Database; adapter: DatabaseAdapter; close: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  const migration1 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql"),
    "utf-8"
  );
  sqlite.exec(migration1);
  const migration2 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql"),
    "utf-8"
  );
  sqlite.exec(migration2);

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

  const db: D1Database = {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T = unknown>(col?: string): Promise<T | null> {
              const res = await adapter.queryOne<Record<string, unknown>>(query, params);
              if (!res) return null;
              if (col) return (res[col] as T) ?? null;
              return res as T;
            },
            async all<T = unknown>() {
              const results = await adapter.query<T>(query, params);
              return {
                results,
                success: true,
                meta: { changes: 0, last_row_id: 0, duration: 0, rows_read: 0, rows_written: 0 }
              };
            },
            async run() {
              const r = await adapter.run(query, params);
              return {
                results: [],
                success: true,
                meta: {
                  changes: r.changes,
                  last_row_id: 0,
                  duration: 0,
                  rows_read: 0,
                  rows_written: r.changes
                }
              };
            }
          };
        },
        async first<T = unknown>(col?: string): Promise<T | null> {
          const res = await adapter.queryOne<Record<string, unknown>>(query);
          if (!res) return null;
          if (col) return (res[col] as T) ?? null;
          return res as T;
        },
        async all<T = unknown>() {
          const results = await adapter.query<T>(query);
          return {
            results,
            success: true,
            meta: { changes: 0, last_row_id: 0, duration: 0, rows_read: 0, rows_written: 0 }
          };
        },
        async run() {
          const r = await adapter.run(query);
          return {
            results: [],
            success: true,
            meta: {
              changes: r.changes,
              last_row_id: 0,
              duration: 0,
              rows_read: 0,
              rows_written: r.changes
            }
          };
        }
      } as unknown as D1PreparedStatement;
    }
  } as unknown as D1Database;

  return { db, adapter, close: () => sqlite.close() };
}

class MockStreamingProvider implements LlmProvider {
  public readonly id = "google";
  public readonly name = "Mock Google Provider";
  public readonly isLocal = false;
  public readonly trainingPolicy = "free-tier-trained" as const;
  public textToStream =
    "Dr. Maria Weber: Das ist eine exzellente Frage! Laut Quelle [1] ist die DSGVO-Loeschung verbindlich.\nThomas Koch: Genau, wir garantieren das technisch ueber tombstones.";

  async chat(): Promise<LlmResponse> {
    return {
      text: this.textToStream,
      model: "mock-gemini"
    };
  }

  async *chatStream(): AsyncIterable<LlmStreamChunk> {
    const parts = this.textToStream.split(" ");
    for (let i = 0; i < parts.length; i++) {
      yield {
        deltaText: (i === 0 ? "" : " ") + parts[i],
        model: "mock-gemini",
        isDone: false
      };
    }
  }

  async embed(): Promise<Float32Array[]> {
    return [new Float32Array(768).fill(0.1)];
  }

  async generateJson<T>(): Promise<T> {
    return {} as T;
  }
}

describe("audio-routes integration tests (Sub-Issue #116)", () => {
  let mockD1: ReturnType<typeof createMockD1>;
  let ragRepo: RagRepository;
  let coreRepo: CoreRepository;
  let keyVault: KeyVault;
  let autoRouter: AutoRouter;
  let mockProvider: MockStreamingProvider;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  const testUserId = "usr_audio_tester";
  const testWorkspaceId = "ws_audio_tester";
  const testNotebookId = "nb_audio_101";
  const testSourceId = "src_audio_01";
  const testChunkId = "chk_audio_01";

  beforeEach(async () => {
    mockD1 = createMockD1();
    ragRepo = new RagRepository(mockD1.adapter);
    coreRepo = new CoreRepository(mockD1.adapter);
    keyVault = new KeyVault({
      keks: {
        1: "test-vault-secret-key-32-chars!!"
      },
      currentVersion: 1
    });
    mockProvider = new MockStreamingProvider();

    autoRouter = new AutoRouter();
    autoRouter.registerProvider(mockProvider);

    const now = Date.now();
    await coreRepo.createUser({
      id: testUserId,
      email: "audio@test.de",
      display_name: "Audio Tester",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await coreRepo.createWorkspace({
      id: testWorkspaceId,
      name: "Audio Workspace",
      owner_id: testUserId,
      created_at: now
    });

    await coreRepo.createNotebook({
      id: testNotebookId,
      workspace_id: testWorkspaceId,
      title: "Audio Notebook",
      emoji: "audio",
      created_by: testUserId,
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    await ragRepo.createSource({
      id: testSourceId,
      notebook_id: testNotebookId,
      title: "DSGVO Leitfaden Mittelstand",
      original_name: "dsgvo.pdf",
      mime_type: "application/pdf",
      source_type: "pdf",
      byte_size: 1024,
      r2_key: null,
      r2_etag: null,
      status: "ready",
      error_message: null,
      created_at: now,
      updated_at: now
    });

    await ragRepo.insertChunks([
      {
        id: testChunkId,
        source_id: testSourceId,
        notebook_id: testNotebookId,
        chunk_index: 0,
        page_number: 1,
        start_offset: 0,
        end_offset: 120,
        text: "Gemaess Art. 17 DSGVO haben betroffene Personen das Recht auf Loeschung ihrer personenbezogenen Daten.",
        token_count: 25,
        created_at: now
      }
    ]);

    app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });

    registerAudioRoutes(app, {
      ragRepo,
      coreRepo,
      autoRouter,
      keyVault
    });
  });

  it("successfully responds to live interjection with grounded two-speaker dialogue", async () => {
    const res = await app.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userQuestion: "DSGVO Loeschung",
        currentTimeMs: 34500,
        podcastContext: "Vorher sprachen wir ueber Cloudflare R2 Speicherung.",
        sourceIds: [testSourceId],
        voiceMode: "dialogue"
      })
    });

    if (res.status !== 200) {
      const errBody = await res.json();
      console.error("Test failure response body:", errBody);
    }

    expect(res.status).toBe(200);
    const data = (await res.json()) as AudioInterjectResponse;
    expect(data.notebookId).toBe(testNotebookId);
    expect(data.question).toBe("DSGVO Loeschung");
    expect(data.currentTimeMs).toBe(34500);
    expect(data.turns).toHaveLength(2);
    expect(data.turns[0]?.speaker).toBe("host1");
    expect(data.turns[0]?.speakerName).toBe("Dr. Maria Weber");
    expect(data.turns[1]?.speaker).toBe("host2");
    expect(data.turns[1]?.speakerName).toBe("Thomas Koch");

    expect(data.citations).toHaveLength(1);
    expect(data.citations[0]?.index).toBe(1);
    expect(data.citations[0]?.sourceTitle).toBe("DSGVO Leitfaden Mittelstand");

    expect(data.speechSynthesis.mode).toBe("dialogue");
    expect(data.speechSynthesis.cues).toHaveLength(2);
    expect(data.speechSynthesis.cues[0]?.voiceName).toBe("de-DE-Neural2-F");
    expect(data.speechSynthesis.cues[1]?.voiceName).toBe("de-DE-Neural2-B");

    expect(data.aiMetadata.aiGenerated).toBe(true);
    expect(data.aiMetadata.provider).toBe("google");
  });

  it("returns 401 when user is not authenticated", async () => {
    const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerAudioRoutes(unauthApp, { ragRepo, coreRepo, autoRouter });

    const res = await unauthApp.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userQuestion: "Test?" })
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 when notebook does not exist or user has no access", async () => {
    const res = await app.request("/api/v1/notebooks/nb_non_existent/audio-interject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userQuestion: "Test?" })
    });
    expect(res.status).toBe(404);

    const strangerApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    strangerApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: "usr_intruder" });
      await next();
    });
    registerAudioRoutes(strangerApp, { ragRepo, coreRepo, autoRouter });

    const strangerRes = await strangerApp.request(
      `/api/v1/notebooks/${testNotebookId}/audio-interject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userQuestion: "Test?" })
      }
    );
    expect(strangerRes.status).toBe(404);
  });

  it("returns 400 on invalid JSON or 422 on validation error", async () => {
    const resBadJson = await app.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "INVALID_JSON_BODY"
    });
    expect(resBadJson.status).toBe(400);

    const resEmptyQuestion = await app.request(
      `/api/v1/notebooks/${testNotebookId}/audio-interject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userQuestion: "   " })
      }
    );
    expect(resEmptyQuestion.status).toBe(422);
  });

  it("handles provider unavailability and LLM generation error gracefully", async () => {
    // 1. Provider unavailable
    const emptyRouter = new AutoRouter();
    emptyRouter.getProvider = () => undefined;
    const noProvApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    noProvApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerAudioRoutes(noProvApp, {
      ragRepo,
      coreRepo,
      autoRouter: emptyRouter
    });

    const resNoProv = await noProvApp.request(
      `/api/v1/notebooks/${testNotebookId}/audio-interject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userQuestion: "Test?" })
      }
    );
    expect(resNoProv.status).toBe(503);

    // 2. Provider throws error during generation
    const failingRouter = new AutoRouter();
    failingRouter.registerProvider({
      id: "google",
      name: "Failing Google",
      isLocal: false,
      trainingPolicy: "free-tier-trained",
      chat: async () => {
        throw new Error("Quota exceeded");
      },
      // biome-ignore lint/correctness/useYield: mock generator throws error
      chatStream: async function* () {
        throw new Error("Quota exceeded");
      },
      embed: async () => [new Float32Array(768)],
      generateJson: async <T>() => ({}) as T
    });

    const failingApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    failingApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerAudioRoutes(failingApp, { ragRepo, coreRepo, autoRouter: failingRouter });

    const resFail = await failingApp.request(
      `/api/v1/notebooks/${testNotebookId}/audio-interject`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userQuestion: "Test?" })
      }
    );
    expect(resFail.status).toBe(502);
  });

  it("supports BYOK decrypted key from KeyVault if present", async () => {
    const now = Date.now();
    const encryptedPayload = await keyVault.encrypt("AIzaCustomBYOKKey123456", {
      userId: testUserId,
      provider: "google"
    });
    await ragRepo.setProviderKey({
      id: "pkey_01",
      user_id: testUserId,
      provider: "google",
      encrypted_key: JSON.stringify(encryptedPayload),
      key_version: 1,
      last4: "3456",
      created_at: now,
      updated_at: now
    });

    const res = await app.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userQuestion: "Wie wird verschluesselt?",
        currentTimeMs: 12000
      })
    });
    expect(res.status).toBe(200);
  });

  it("handles notebook share role (viewer/editor) access", async () => {
    const sharedUserId = "usr_shared_audio";
    const now = Date.now();
    await coreRepo.createUser({
      id: sharedUserId,
      email: "shared@test.de",
      display_name: "Shared User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await mockD1.adapter.run(
      "INSERT INTO notebook_shares (notebook_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      [testNotebookId, sharedUserId, "viewer", now]
    );

    const sharedApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    sharedApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: sharedUserId });
      await next();
    });
    registerAudioRoutes(sharedApp, { ragRepo, coreRepo, autoRouter });

    const res = await sharedApp.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userQuestion: "Frage vom Viewer?" })
    });
    expect(res.status).toBe(200);
  });

  it("handles no coreRepo dependency gracefully", async () => {
    const noCoreApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    noCoreApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerAudioRoutes(noCoreApp, { ragRepo, autoRouter });

    const res = await noCoreApp.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userQuestion: "Frage ohne CoreRepo?" })
    });
    expect(res.status).toBe(200);
  });

  it("handles vector search returning chunks in audio-interject", async () => {
    const mockVecEnv = {
      NOTEBOOK_DO: {
        idFromName: () => ({}),
        get: () => ({
          fetch: async () => ({
            ok: true,
            json: async () => ({
              results: [{ chunkId: testChunkId, score: 0.98 }]
            })
          })
        })
      }
    };

    const vecApp = new Hono<{
      Bindings: Env;
      Variables: { sessionUser?: { id: string } };
    }>();
    vecApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      (c.env as unknown as { NOTEBOOK_DO: unknown }) = mockVecEnv;
      await next();
    });
    registerAudioRoutes(vecApp, { ragRepo, coreRepo, autoRouter });

    const res = await vecApp.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userQuestion: "Frage mit Vector Suchergebnis",
        sourceIds: [testSourceId]
      })
    });
    expect(res.status).toBe(200);
  });

  it("handles default autoRouter creation with defaultGeminiKey and ollamaBaseUrl", async () => {
    const defaultApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    defaultApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });

    registerAudioRoutes(defaultApp, {
      ragRepo,
      defaultGeminiKey: "AIzaTestKeyDefault",
      ollamaBaseUrl: "http://127.0.0.1:11434"
    });

    expect(defaultApp).toBeDefined();
  });

  it("handles chunk without sourceTitle (falls back to Quelle)", async () => {
    const emptyTitleSourceId = "src_audio_no_title";
    const chunkNoTitleId = "chk_audio_no_title";
    const now = Date.now();
    await ragRepo.createSource({
      id: emptyTitleSourceId,
      notebook_id: testNotebookId,
      title: "",
      original_name: "empty.txt",
      mime_type: "text/plain",
      source_type: "txt",
      byte_size: 100,
      r2_key: null,
      r2_etag: null,
      status: "ready",
      error_message: null,
      created_at: now,
      updated_at: now
    });
    await ragRepo.insertChunks([
      {
        id: chunkNoTitleId,
        source_id: emptyTitleSourceId,
        notebook_id: testNotebookId,
        chunk_index: 0,
        text: "AudioChunk ohne Titel fuer Fallback.",
        token_count: 8,
        page_number: 1,
        start_offset: 0,
        end_offset: 35,
        created_at: now
      }
    ]);

    const res = await app.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userQuestion: "AudioChunk",
        sourceIds: [emptyTitleSourceId]
      })
    });
    expect(res.status).toBe(200);
  });

  it("handles LLM generation failure with non-Error exception", async () => {
    const throwingProvider: LlmProvider = {
      id: "google",
      name: "Throwing String Provider",
      isLocal: false,
      trainingPolicy: "free-tier-trained" as const,
      async chat() {
        throw "String Exception";
      },
      // biome-ignore lint/correctness/useYield: deliberately throws non-Error
      async *chatStream() {
        throw "String Exception";
      },
      async embed() {
        return [new Float32Array(768)];
      },
      async generateJson<T>() {
        return {} as T;
      }
    };

    const failRouter = new AutoRouter();
    failRouter.registerProvider(throwingProvider);

    const failApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    failApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerAudioRoutes(failApp, { ragRepo, coreRepo, autoRouter: failRouter });

    const res = await failApp.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userQuestion: "Wie schlaegt das fehl?"
      })
    });
    expect(res.status).toBe(502);
    const json = (await res.json()) as { code: string; detail: string };
    expect(json.code).toBe("LLM_GENERATION_FAILED");
    expect(json.detail).toContain("String Exception");
  });

  it("handles empty search matchQuery when question has only punctuation", async () => {
    const res = await app.request(`/api/v1/notebooks/${testNotebookId}/audio-interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userQuestion: "???"
      })
    });
    expect(res.status).toBe(200);
  });
});
