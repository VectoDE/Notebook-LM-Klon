import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type LlmProvider,
  type LlmResponse,
  type LlmStreamChunk,
  chunkText
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoRouter } from "../auto-router.js";
import { registerChatRoutes } from "../chat-routes.js";
import { registerChunkIngestionRoutes } from "../chunk-ingestion.js";
import { CoreRepository } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import { RagRepository } from "../rag-repository.js";
import { registerSearchRoutes } from "../search-routes.js";
import { registerSourcesUploadRoutes } from "../sources-upload.js";

/**
 * P6 Ende-zu-Ende auf Worker-Seite: genau die Anfragen, die der Upload-Client der Oberfläche
 * schickt (Init, PUT, complete, Chunks aus chunkText wie im Ingest-Worker), danach findet die
 * Suche die Quelle und der Chat zitiert sie.
 */

class CitingProvider implements LlmProvider {
  readonly id = "google";
  readonly name = "Zitierender Testanbieter";
  readonly isLocal = false;
  readonly trainingPolicy = "free-tier-trained" as const;
  async chat(): Promise<LlmResponse> {
    return { text: "", model: "test-model" };
  }
  async *chatStream(): AsyncIterable<LlmStreamChunk> {
    yield { deltaText: "Die Elbe fließt durch Dresden [1].", model: "test-model", isDone: false };
  }
  async embed(): Promise<Float32Array[]> {
    return [];
  }
  async generateJson<T>(): Promise<T> {
    return {} as T;
  }
}

function createR2Mock(): R2Bucket {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (key: string, value: BodyInit) => {
      const data = new Uint8Array(await new Response(value).arrayBuffer());
      store.set(key, data);
      return { key, etag: `"${data.byteLength}"` };
    },
    get: async (key: string) => {
      const data = store.get(key);
      if (!data) return null;
      return { key, arrayBuffer: async () => data.slice().buffer, body: new Response(data).body };
    },
    delete: async (key: string) => {
      store.delete(key);
    }
  } as unknown as R2Bucket;
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(text: string): SseEvent[] {
  return text
    .split(/\n\n/)
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) as Record<string, unknown> } : null;
    })
    .filter((e): e is SseEvent => e !== null);
}

describe("P6: eigene Quelle hochladen, indexieren, suchen, im Chat zitieren", () => {
  let sqlite: DatabaseSync;
  let dataDir: string;
  let closeEnv: () => void;
  let env: Env;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "p6-upload-"));
    sqlite = new DatabaseSync(":memory:");
    runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
    const handle = createNodeEnv({ db: sqlite, dataDir, sessionSaltSecret: "test-only-p6" });
    closeEnv = handle.close;
    env = Object.assign(handle.env, { MEDIA: createR2Mock() }) as Env;

    const coreRepo = new CoreRepository(createD1DatabaseAdapter(env.DB));
    const ragRepo = new RagRepository(createD1DatabaseAdapter(env.DB));
    const now = Date.now();
    await coreRepo.createUser({
      id: "alice",
      email: "alice@example.test",
      display_name: "alice",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });
    await coreRepo.createWorkspace({ id: "ws_a", name: "A", owner_id: "alice", created_at: now });
    await coreRepo.createNotebook({
      id: "nb_a",
      workspace_id: "ws_a",
      title: "Notebook A",
      emoji: "book",
      created_by: "alice",
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    const autoRouter = new AutoRouter();
    autoRouter.registerProvider(new CitingProvider());
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "alice" });
      await next();
    });
    registerSourcesUploadRoutes(app, { coreRepo, ragRepo });
    registerChunkIngestionRoutes(app, { ragRepo, coreRepo });
    registerSearchRoutes(app, { ragRepo, coreRepo });
    registerChatRoutes(app, { ragRepo, coreRepo, autoRouter });
  });

  afterEach(() => {
    closeEnv();
    sqlite.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = (path: string, init: RequestInit = {}) =>
    Promise.resolve(app.request(`http://localhost${path}`, init, env));
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  async function uploadTxt(filename: string, text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const init = await call(
      "/api/v1/notebooks/nb_a/sources",
      json("POST", { filename, mimeType: "text/plain", byteSize: bytes.byteLength })
    );
    expect(init.status).toBe(201);
    const { sourceId, mode, uploadUrl } = (await init.json()) as {
      sourceId: string;
      mode: string;
      uploadUrl: string;
    };
    expect(mode).toBe("worker-upload");

    const put = await call(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain", "content-length": String(bytes.byteLength) },
      body: bytes
    });
    expect(put.status).toBe(200);
    const complete = await call(`/api/v1/sources/${sourceId}/upload/complete`, { method: "POST" });
    expect(complete.status).toBe(200);

    const chunks = chunkText({ text }).map((c) => ({
      chunkIndex: c.chunkIndex,
      text: c.text,
      tokenCount: c.tokenCount,
      pageNumber: c.pageNumber ?? null,
      startOffset: c.startOffset,
      endOffset: c.endOffset
    }));
    const ingest = await call(
      `/api/v1/sources/${sourceId}/chunks`,
      json("POST", { chunks, markReady: true })
    );
    expect(ingest.status).toBe(200);
    expect(await ingest.json()).toMatchObject({ chunksIngested: chunks.length, status: "ready" });
    return sourceId;
  }

  it("die hochgeladene TXT-Quelle wird gefunden und im Chat mit Zitat belegt", async () => {
    const sourceId = await uploadTxt(
      "elbe.txt",
      "Die Elbe fließt durch Dresden und mündet bei Cuxhaven in die Nordsee."
    );

    const search = await call(
      "/api/v1/notebooks/nb_a/search",
      json("POST", { query: "Dresden", mode: "fts" })
    );
    expect(search.status).toBe(200);
    const found = JSON.stringify(await search.json());
    expect(found).toContain(sourceId);
    expect(found).toContain("Cuxhaven");

    const chat = await call(
      "/api/v1/notebooks/nb_a/chat",
      json("POST", { message: "Durch welche Stadt fließt die Elbe? Dresden?", sourceIds: [sourceId] })
    );
    expect(chat.status).toBe(200);
    const events = parseSse(await chat.text());
    const citations = events.find((e) => e.event === "citations")?.data as {
      citations: Array<{ index: number; sourceId: string; sourceTitle: string }>;
      validIndices: number[];
    };
    expect(citations.validIndices).toEqual([1]);
    expect(citations.citations[0]).toMatchObject({
      index: 1,
      sourceId,
      sourceTitle: "elbe.txt"
    });
  });

  it("ohne Auswahl der neuen Quelle antwortet der Chat ehrlich ohne Beleg", async () => {
    await uploadTxt("elbe.txt", "Die Elbe fließt durch Dresden.");
    const other = await uploadTxt("rhein.txt", "Der Rhein fließt durch Köln.");

    const chat = await call(
      "/api/v1/notebooks/nb_a/chat",
      json("POST", { message: "Dresden", sourceIds: [other] })
    );
    const events = parseSse(await chat.text());
    expect(events.find((e) => e.event === "done")?.data).toMatchObject({ noEvidence: true });
  });
});
