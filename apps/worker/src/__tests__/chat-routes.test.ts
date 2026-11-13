import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ChatMessagesResponse,
  LlmProvider,
  LlmResponse,
  LlmStreamChunk
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutoRouter } from "../auto-router.js";
import {
  HISTORY_PAGE_DEFAULT,
  HISTORY_PAGE_MAX,
  NO_EVIDENCE_ANSWER,
  decodeHistoryCursor,
  encodeHistoryCursor,
  registerChatRoutes
} from "../chat-routes.js";
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

  const db: unknown = {
    prepare(query: string) {
      let boundParams: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundParams = args;
          return this;
        },
        async first<T = unknown>(col?: string): Promise<T | null> {
          const row = (await adapter.queryOne<Record<string, unknown>>(
            query,
            boundParams
          )) as Record<string, unknown> | null;
          if (!row) return null;
          if (col) return (row[col] as T) ?? null;
          return row as T;
        },
        async all<T = unknown>() {
          const results = await adapter.query<T>(query, boundParams);
          return {
            results,
            success: true,
            meta: {
              changes: 0,
              last_row_id: 0,
              duration: 0,
              rows_read: results.length,
              rows_written: 0
            }
          };
        },
        async run() {
          const res = await adapter.run(query, boundParams);
          return {
            results: [],
            success: true,
            meta: {
              changes: res.changes,
              last_row_id: 0,
              duration: 0,
              rows_read: 0,
              rows_written: res.changes
            }
          };
        }
      };
    }
  };

  return {
    db: db as D1Database,
    adapter,
    close: () => sqlite.close()
  };
}

class MockStreamingProvider implements LlmProvider {
  readonly id = "google";
  readonly name = "Mock Google Gemini";
  readonly isLocal = false;
  readonly trainingPolicy = "free-tier-trained" as const;

  constructor(private readonly chunksToYield: string[] = ["Hallo", " Welt [1]", " [99]"]) {}

  async chat(): Promise<LlmResponse> {
    return {
      text: this.chunksToYield.join(""),
      model: "gemini-2.5-flash"
    };
  }

  async *chatStream(): AsyncIterable<LlmStreamChunk> {
    for (const chunk of this.chunksToYield) {
      yield {
        deltaText: chunk,
        model: "gemini-2.5-flash",
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

describe("Chat Routes & SSE Streaming (POST /api/v1/notebooks/:id/chat & GET /api/v1/chats/:id/messages)", () => {
  let mockD1: ReturnType<typeof createMockD1>;
  let coreRepo: CoreRepository;
  let ragRepo: RagRepository;
  let autoRouter: AutoRouter;
  let keyVault: KeyVault;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  const testUserId = "usr_chat_1";
  const testWorkspaceId = "ws_chat_1";
  const testNotebookId = "nb_chat_1";

  beforeEach(async () => {
    mockD1 = createMockD1();
    coreRepo = new CoreRepository(mockD1.adapter);
    ragRepo = new RagRepository(mockD1.adapter);
    autoRouter = new AutoRouter();
    autoRouter.registerProvider(new MockStreamingProvider());

    keyVault = new KeyVault({
      keks: {
        1: "0123456789012345678901234567890123456789012345678901234567890123"
      }
    });

    const now = Date.now();
    await coreRepo.createUser({
      id: testUserId,
      email: "chat@example.com",
      display_name: "Chat Tester",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await coreRepo.createWorkspace({
      id: testWorkspaceId,
      name: "Chat Workspace",
      owner_id: testUserId,
      created_at: now
    });

    await coreRepo.createNotebook({
      id: testNotebookId,
      workspace_id: testWorkspaceId,
      title: "Chat Test Notebook",
      emoji: "chat",
      created_by: testUserId,
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    await ragRepo.createSource({
      id: "src_1",
      notebook_id: testNotebookId,
      title: "Datenschutzrichtlinie",
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
        id: "chk_1",
        source_id: "src_1",
        notebook_id: testNotebookId,
        chunk_index: 0,
        page_number: 1,
        start_offset: 0,
        end_offset: 100,
        text: "Die DSGVO schützt personenbezogene Daten.",
        token_count: 10,
        created_at: now
      }
    ]);

    app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });

    registerChatRoutes(app, {
      ragRepo,
      coreRepo,
      autoRouter,
      keyVault
    });
  });

  it("handles authentication check for chat endpoints", async () => {
    const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerChatRoutes(unauthApp, { ragRepo, coreRepo, autoRouter });

    const postRes = await unauthApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Hallo" })
      }
    );
    expect(postRes.status).toBe(401);

    const getRes = await unauthApp.request("http://localhost/api/v1/chats/chat_123/messages");
    expect(getRes.status).toBe(401);
  });

  it("handles non-existent notebook (404)", async () => {
    const res = await app.request("http://localhost/api/v1/notebooks/nb_non_existent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Hallo" })
    });
    expect(res.status).toBe(404);
  });

  it("handles invalid json and validation error (400, 422)", async () => {
    const badJsonRes = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "invalid-json"
      }
    );
    expect(badJsonRes.status).toBe(400);

    const valRes = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "" }) // empty message
    });
    expect(valRes.status).toBe(422);
  });

  it("streams chat response via SSE with verified citations and AI Act metadata", async () => {
    const res = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "DSGVO",
        maxChunks: 5
      })
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: token");
    expect(text).toContain("event: citations");
    expect(text).toContain("event: metadata");
    expect(text).toContain("event: done");

    // Verify AI Act metadata
    expect(text).toContain('"aiGenerated":true');
    expect(text).toContain('"provider":"google"');
    expect(text).toContain('"model":"gemini-2.5-flash"');

    // Verify verified citation [1] is present and hallucinated [99] filtered
    expect(text).toContain('"validIndices":[1]');
    expect(text).toContain('"hallucinatedIndices":[99]');

    // Check message persistence
    const chats = await ragRepo.getChatsByNotebook(testNotebookId);
    expect(chats.length).toBe(1);
    const chatId = chats[0]?.id as string;

    const messages = await ragRepo.getMessagesByChat(chatId);
    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("DSGVO");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.ai_generated).toBe(1);

    // Retrieve via GET /api/v1/chats/:id/messages
    const getRes = await app.request(`http://localhost/api/v1/chats/${chatId}/messages`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as ChatMessagesResponse;
    expect(getBody.chatId).toBe(chatId);
    expect(getBody.messages.length).toBe(2);
    expect(getBody.messages[1]?.aiGenerated).toBe(true);
    expect(getBody.messages[1]?.citations?.length).toBe(1);
  });

  it("handles shared notebook member access and BYOK key in vault", async () => {
    const sharedUserId = "usr_shared_member";
    const now = Date.now();
    await coreRepo.createUser({
      id: sharedUserId,
      email: "shared@example.com",
      display_name: "Shared User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    // Add share
    await mockD1.adapter.run(
      "INSERT INTO notebook_shares (notebook_id, user_id, invite_email_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
      [testNotebookId, sharedUserId, null, "editor", now]
    );

    // Save BYOK key for user
    const encryptedKey = await keyVault.encrypt("AIzaCustomSecretKey123", {
      userId: sharedUserId,
      provider: "google"
    });
    await ragRepo.setProviderKey({
      id: "pk_shared",
      user_id: sharedUserId,
      provider: "google",
      encrypted_key: JSON.stringify(encryptedKey),
      key_version: 1,
      last4: "e123",
      created_at: now,
      updated_at: now
    });

    const sharedApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    sharedApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: sharedUserId });
      await next();
    });
    registerChatRoutes(sharedApp, {
      ragRepo,
      coreRepo,
      autoRouter,
      keyVault
    });

    const res = await sharedApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "DSGVO Frage", sourceIds: ["src_1"] })
      }
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: done");
  });

  it("handles forbidden notebook when user has no role or share (404)", async () => {
    const strangerId = "usr_stranger";
    const now = Date.now();
    await coreRepo.createUser({
      id: strangerId,
      email: "stranger@example.com",
      display_name: "Stranger",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    const strangerApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    strangerApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: strangerId });
      await next();
    });
    registerChatRoutes(strangerApp, {
      ragRepo,
      coreRepo,
      autoRouter
    });

    const res = await strangerApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Hallo" })
      }
    );
    expect(res.status).toBe(404);
  });

  it("handles no coreRepo dependency gracefully", async () => {
    const noCoreApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    noCoreApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerChatRoutes(noCoreApp, {
      ragRepo,
      autoRouter
    });

    const res = await noCoreApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "DSGVO" })
      }
    );
    expect(res.status).toBe(200);
    await res.text();
  });

  it("handles invalid json in message citations and tokenUsage in GET /api/v1/chats/:id/messages", async () => {
    const corruptedChatId = "chat_corrupted";
    const now = Date.now();
    await ragRepo.createChat({
      id: corruptedChatId,
      notebook_id: testNotebookId,
      user_id: testUserId,
      title: "Corrupted JSON chat",
      model_used: "gemini-2.5-flash",
      created_at: now,
      updated_at: now
    });

    await ragRepo.createMessage({
      id: "msg_corrupted",
      chat_id: corruptedChatId,
      role: "assistant",
      content: "Antwort mit kaputtem JSON",
      citations_json: "{not valid json",
      latency_ms: 100,
      token_usage_json: "{not valid json either",
      ai_generated: 1,
      created_at: now
    });

    const res = await app.request(`http://localhost/api/v1/chats/${corruptedChatId}/messages`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as ChatMessagesResponse;
    expect(data.messages[0]?.citations).toBeNull();
    expect(data.messages[0]?.tokenUsage).toBeNull();
  });

  it("handles vector search returning items in chat routes", async () => {
    const mockVecEnv = {
      NOTEBOOK_DO: {
        idFromName: () => ({}),
        get: () => ({
          fetch: async () => ({
            ok: true,
            json: async () => ({
              results: [{ chunkId: "chk_1", score: 0.95 }]
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
    registerChatRoutes(vecApp, {
      ragRepo,
      coreRepo,
      autoRouter
    });

    const res = await vecApp.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "DSGVO" })
    });
    expect(res.status).toBe(200);
    await res.text();
  });

  it("handles corrupted BYOK key in vault fallback", async () => {
    await ragRepo.setProviderKey({
      id: "pk_corrupted",
      user_id: testUserId,
      provider: "google",
      encrypted_key: "{not valid encrypted payload",
      key_version: 1,
      last4: "9999",
      created_at: Date.now(),
      updated_at: Date.now()
    });

    const res = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "DSGVO" })
    });
    expect(res.status).toBe(200);
    await res.text();
  });

  it("handles default autoRouter creation with defaultGeminiKey and ollamaBaseUrl", async () => {
    const defaultApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    defaultApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });

    registerChatRoutes(defaultApp, {
      ragRepo,
      defaultGeminiKey: "AIzaTestKeyDefault",
      ollamaBaseUrl: "http://127.0.0.1:11434"
    });

    expect(defaultApp).toBeDefined();
  });

  it("handles conversation continuation with non-existent chatId (creates new chat) and existing chat", async () => {
    const customChatId = "chat_brand_new_custom";
    const res = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Neue Frage mit vorgegebener ID",
        chatId: customChatId
      })
    });

    expect(res.status).toBe(200);
    await res.text();
    const chat = await ragRepo.getChatById(customChatId);
    expect(chat).not.toBeNull();
    expect(chat?.id).toBe(customChatId);

    // Call again with same chatId now that it exists (hits line 192 updateChatTimestamp)
    const resAgain = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Folgefrage",
        chatId: customChatId
      })
    });
    expect(resAgain.status).toBe(200);
    await resAgain.text();
  });

  it("returns 404 for unknown chat in GET /api/v1/chats/:id/messages", async () => {
    const res = await app.request("http://localhost/api/v1/chats/chat_unknown/messages");
    expect(res.status).toBe(404);
  });

  it("handles unauthorized access to another user's chat", async () => {
    const otherUserId = "usr_other_1";
    const otherWorkspaceId = "ws_other_1";
    const otherNotebookId = "nb_other_1";
    const now = Date.now();

    await coreRepo.createUser({
      id: otherUserId,
      email: "other@example.com",
      display_name: "Other User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await coreRepo.createWorkspace({
      id: otherWorkspaceId,
      name: "Other Workspace",
      owner_id: otherUserId,
      created_at: now
    });

    await coreRepo.createNotebook({
      id: otherNotebookId,
      workspace_id: otherWorkspaceId,
      title: "Other Notebook",
      emoji: "book",
      created_by: otherUserId,
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    const otherChatId = "chat_other_user";
    await ragRepo.createChat({
      id: otherChatId,
      notebook_id: otherNotebookId,
      user_id: otherUserId,
      title: "Other User Chat",
      model_used: "gemini-2.5-flash",
      created_at: now,
      updated_at: now
    });

    const res = await app.request(`http://localhost/api/v1/chats/${otherChatId}/messages`);
    expect(res.status).toBe(404);
  });

  it("handles stream error gracefully with SSE error event", async () => {
    const failingRouter = new AutoRouter();
    failingRouter.registerProvider({
      id: "google",
      name: "Failing Provider",
      isLocal: false,
      trainingPolicy: "free-tier-trained",
      chat: async () => {
        throw new Error("Chat failed");
      },
      chatStream: async function* () {
        yield* [];
        throw new Error("Provider Stream Explosion");
      },
      embed: async () => [],
      generateJson: async <T>() => ({}) as unknown as T
    });

    const failingApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    failingApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });

    registerChatRoutes(failingApp, {
      ragRepo,
      coreRepo,
      autoRouter: failingRouter
    });

    const res = await failingApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "DSGVO" })
      }
    );

    expect(res.status).toBe(200);
    const sseText = await res.text();
    expect(sseText).toContain("event: error");
    expect(sseText).toContain("Provider Stream Explosion");
  });

  it("returns 503 when no active provider is registered", async () => {
    const emptyRouter = new AutoRouter();
    // Override getProvider to return undefined even if registered
    emptyRouter.getProvider = () => undefined;
    const emptyApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    emptyApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });

    registerChatRoutes(emptyApp, {
      ragRepo,
      coreRepo,
      autoRouter: emptyRouter
    });

    const res = await emptyApp.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "DSGVO" })
    });

    expect(res.status).toBe(503);
  });

  it("handles default maxChunks, chunks with empty title, and collaborator accessing messages", async () => {
    const emptyTitleSourceId = "src_emptytitle";
    const chunkNoTitleId = "chk_emptytitle";
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
        text: "DefaultZweigTest Inhalt ohne Titel.",
        token_count: 8,
        page_number: 1,
        start_offset: 0,
        end_offset: 35,
        created_at: now
      }
    ]);

    // 2. Chat request searching for the empty title chunk
    // (triggers sourceTitle fallback on line 259)
    const emptyTitleApp = new Hono<{
      Bindings: Env;
      Variables: { sessionUser?: { id: string } };
    }>();
    emptyTitleApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerChatRoutes(emptyTitleApp, {
      ragRepo,
      coreRepo,
      autoRouter
    });

    const resEmptyTitle = await emptyTitleApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "DefaultZweigTest", sourceIds: [emptyTitleSourceId] })
      }
    );
    expect(resEmptyTitle.status).toBe(200);
    const emptyTitleText = await resEmptyTitle.text();
    expect(emptyTitleText).toContain("event: done");

    // 3. Chat request with message containing only punctuation/stop words so matchQuery.length === 0
    const noMatchApp = new Hono<{
      Bindings: Env;
      Variables: { sessionUser?: { id: string } };
    }>();
    noMatchApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerChatRoutes(noMatchApp, {
      ragRepo,
      coreRepo,
      autoRouter
    });

    const resNoMatch = await noMatchApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "???" })
      }
    );
    expect(resNoMatch.status).toBe(200);
    const noMatchText = await resNoMatch.text();
    expect(noMatchText).toContain("event: done");

    // 3. Test collaborator calling GET /api/v1/chats/:id/messages
    // Create a chat owned by testUserId in testNotebookId
    const chatForCollabId = "chat_collab_test";
    await ragRepo.createChat({
      id: chatForCollabId,
      notebook_id: testNotebookId,
      user_id: testUserId,
      title: "Owner Chat",
      model_used: "gemini-1.5-flash",
      created_at: now,
      updated_at: now
    });

    const collabUserId = "usr_collaborator_test";
    await coreRepo.createUser({
      id: collabUserId,
      email: "collab@example.com",
      display_name: "Collaborator",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });
    await mockD1.adapter.run(
      "INSERT INTO notebook_shares (notebook_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      [testNotebookId, collabUserId, "viewer", now]
    );

    const collabApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    collabApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: collabUserId });
      await next();
    });
    registerChatRoutes(collabApp, {
      ragRepo,
      coreRepo,
      autoRouter
    });

    // chatForCollabId belongs to testUserId, but collabUserId is a collaborator on testNotebookId!
    const resCollab = await collabApp.request(
      `http://localhost/api/v1/chats/${chatForCollabId}/messages`
    );
    expect(resCollab.status).toBe(200);
    const json = (await resCollab.json()) as { messages: unknown[] };
    expect(json.messages).toBeDefined();
  });

  describe("Issue #243: Abbruch, ehrliche Nichtantwort, paginierter Verlauf", () => {
    /** Provider, der nach dem ersten Token wartet, bis der Client abbricht. */
    function abortAwareRouter(mode: "keeps-yielding" | "throws-on-abort") {
      const seen: { signal?: AbortSignal | undefined } = {};
      const router = new AutoRouter();
      router.registerProvider({
        id: "google",
        name: "Abbruch-Provider",
        isLocal: false,
        trainingPolicy: "free-tier-trained",
        chat: async () => ({ text: "", model: "gemini-2.5-flash" }),
        chatStream: async function* (_messages, options) {
          seen.signal = options?.signal;
          yield { deltaText: "Erster Teil", model: "gemini-2.5-flash", isDone: false };
          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted) resolve();
            options?.signal?.addEventListener("abort", () => resolve());
          });
          if (mode === "throws-on-abort") throw new DOMException("aborted", "AbortError");
          yield { deltaText: " zweiter Teil", model: "gemini-2.5-flash", isDone: false };
        },
        embed: async () => [],
        generateJson: async <T>() => ({}) as unknown as T
      });
      const abortApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
      abortApp.use("*", async (c, next) => {
        c.set("sessionUser", { id: testUserId });
        await next();
      });
      registerChatRoutes(abortApp, { ragRepo, coreRepo, autoRouter: router });
      return { abortApp, seen };
    }

    for (const mode of ["keeps-yielding", "throws-on-abort"] as const) {
      it(`Abbruch durch den Client bricht auch die Modellanfrage ab (${mode})`, async () => {
        const { abortApp, seen } = abortAwareRouter(mode);
        const res = await abortApp.request(
          `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: "DSGVO", chatId: `chat_abort_${mode}` })
          }
        );
        expect(res.status).toBe(200);
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain("Erster Teil");
        await reader.cancel();

        await vi.waitFor(() => expect(seen.signal?.aborted).toBe(true));
        // Abgebrochene Antworten werden nicht gespeichert, die Frage bleibt im Verlauf
        await new Promise((resolve) => setTimeout(resolve, 20));
        const stored = await ragRepo.getMessagesByChat(`chat_abort_${mode}`);
        expect(stored.map((m) => m.role)).toEqual(["user"]);
      });
    }

    it("antwortet ehrlich 'nicht in den Quellen', wenn kein Beleg passt, ohne Modellaufruf", async () => {
      let called = false;
      const spyRouter = new AutoRouter();
      spyRouter.registerProvider({
        id: "google",
        name: "Spion",
        isLocal: false,
        trainingPolicy: "free-tier-trained",
        chat: async () => ({ text: "", model: "m" }),
        chatStream: async function* () {
          called = true;
          yield { deltaText: "erfunden", model: "m", isDone: false };
        },
        embed: async () => [],
        generateJson: async <T>() => ({}) as unknown as T
      });
      const spyApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
      spyApp.use("*", async (c, next) => {
        c.set("sessionUser", { id: testUserId });
        await next();
      });
      registerChatRoutes(spyApp, { ragRepo, coreRepo, autoRouter: spyRouter });

      // Frage ohne Beleg in den Quellen (Deutsch, Standard)
      const res = await spyApp.request(`http://localhost/api/v1/notebooks/${testNotebookId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Wie hoch ist der Mount Everest?", chatId: "chat_none" })
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(JSON.stringify(NO_EVIDENCE_ANSWER.de).slice(1, -1));
      expect(text).toContain('"validIndices":[]');
      expect(text).toContain('"noEvidence":true');
      expect(text).not.toContain("event: metadata");
      expect(called).toBe(false);
      const stored = await ragRepo.getMessagesByChat("chat_none");
      expect(stored[1]?.content).toBe(NO_EVIDENCE_ANSWER.de);
      expect(stored[1]?.ai_generated).toBe(0);

      // Englische Oberfläche: englische Antwort
      const resEn = await spyApp.request(
        `http://localhost/api/v1/notebooks/${testNotebookId}/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Mount Everest height?", language: "en" })
        }
      );
      const textEn = await resEn.text();
      expect(textEn).toContain("I can't find anything about this in the selected sources.");
      expect(called).toBe(false);
    });

    it("lädt den Verlauf seitenweise ohne Gesamtgrenze (Keyset-Cursor)", async () => {
      const chatId = "chat_paged";
      const now = Date.now();
      await ragRepo.createChat({
        id: chatId,
        notebook_id: testNotebookId,
        user_id: testUserId,
        title: "Langer Verlauf",
        model_used: "auto",
        created_at: now,
        updated_at: now
      });
      const total = 250;
      for (let i = 0; i < total; i += 1) {
        await ragRepo.createMessage({
          id: `msg_${String(i).padStart(4, "0")}`,
          chat_id: chatId,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Nachricht ${i}`,
          citations_json: null,
          latency_ms: null,
          token_usage_json: null,
          ai_generated: i % 2,
          // Je zwei Nachrichten mit gleichem Zeitstempel: Cursor muss über die id trennen
          created_at: now + Math.floor(i / 2)
        });
      }

      const collected: string[] = [];
      let cursor: string | null | undefined;
      let pages = 0;
      do {
        const query = cursor ? `?limit=40&before=${encodeURIComponent(cursor)}` : "?limit=40";
        const res = await app.request(`http://localhost/api/v1/chats/${chatId}/messages${query}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as ChatMessagesResponse;
        expect(body.messages.length).toBeLessThanOrEqual(40);
        collected.unshift(...body.messages.map((m) => m.content));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(7);
      expect(collected).toHaveLength(total);
      expect(collected[0]).toBe("Nachricht 0");
      expect(collected[total - 1]).toBe(`Nachricht ${total - 1}`);
      expect(new Set(collected).size).toBe(total);

      // Ohne Parameter: die neuesten 100, älterer Rest per Cursor
      const first = await app.request(`http://localhost/api/v1/chats/${chatId}/messages`);
      const firstBody = (await first.json()) as ChatMessagesResponse;
      expect(firstBody.messages).toHaveLength(HISTORY_PAGE_DEFAULT);
      expect(firstBody.messages.at(-1)?.content).toBe(`Nachricht ${total - 1}`);
      expect(firstBody.nextCursor).toBe(
        encodeHistoryCursor({ created_at: now + 75, id: "msg_0150" })
      );
    });

    it("weist ungültige Seitenparameter mit 422 ab", async () => {
      const chatId = "chat_param";
      await ragRepo.createChat({
        id: chatId,
        notebook_id: testNotebookId,
        user_id: testUserId,
        title: "Parameter",
        model_used: "auto",
        created_at: 1,
        updated_at: 1
      });
      for (const query of [
        "limit=0",
        `limit=${HISTORY_PAGE_MAX + 1}`,
        "limit=abc",
        "limit=2.5",
        "before=kaputt"
      ]) {
        const res = await app.request(`http://localhost/api/v1/chats/${chatId}/messages?${query}`);
        expect(res.status, query).toBe(422);
      }
    });

    it("Cursor: Kodieren und Prüfen", () => {
      expect(encodeHistoryCursor({ created_at: 5, id: "msg_a" })).toBe("5~msg_a");
      expect(decodeHistoryCursor("5~msg_a")).toEqual({ createdAt: 5, id: "msg_a" });
      expect(decodeHistoryCursor("5~msg~b")).toEqual({ createdAt: 5, id: "msg~b" });
      expect(decodeHistoryCursor("ohne-trenner")).toBeNull();
      expect(decodeHistoryCursor("~msg_a")).toBeNull();
      expect(decodeHistoryCursor("x~msg_a")).toBeNull();
      expect(decodeHistoryCursor("-1~msg_a")).toBeNull();
      expect(decodeHistoryCursor("5~")).toBeNull();
    });
  });
});
