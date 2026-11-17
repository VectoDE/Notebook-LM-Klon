import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  chunkText,
  type LlmProvider,
  type LlmResponse,
  type LlmStreamChunk
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1DatabaseAdapter } from "@/db/d1-adapter.js";
import { createNodeEnv, runSqliteMigrations } from "@/node-server.js";
import { CoreRepository } from "@/repositories/core-repository.js";
import { RagRepository } from "@/repositories/rag-repository.js";
import { registerChatRoutes } from "@/routes/chat-routes.js";
import { registerChunkIngestionRoutes } from "@/routes/chunk-ingestion.js";
import { registerSearchRoutes } from "@/routes/search-routes.js";
import { registerSourcesUploadRoutes } from "@/routes/sources-upload.js";
import { AutoRouter } from "@/services/auto-router.js";

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
      json("POST", {
        message: "Durch welche Stadt fließt die Elbe? Dresden?",
        sourceIds: [sourceId]
      })
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

  describe("mit Workers AI (Binding gemockt): semantische Suche ohne gemeinsame Wörter", () => {
    /** Ein Thema je Dimension: Sachsen/Dresden → 0, Rhein/Köln → 1, sonst 2. */
    function topicVector(text: string): number[] {
      const v = new Array<number>(768).fill(0);
      if (/Dresden|Sachsen/.test(text)) v[0] = 1;
      else if (/Rhein|Köln|Nordrhein/.test(text)) v[1] = 1;
      else v[2] = 1;
      return v;
    }

    let aiCalls: string[][];
    beforeEach(async () => {
      const { resetEmbeddingCircuit } = await import("@/services/embeddings.js");
      resetEmbeddingCircuit();
      aiCalls = [];
      (env as unknown as { AI: unknown }).AI = {
        run: async (_model: string, inputs: { input: string[] }) => {
          aiCalls.push(inputs.input);
          return {
            data: inputs.input.map((t, index) => ({ index, embedding: topicVector(t) })),
            usage: { total_tokens: inputs.input.length * 10 }
          };
        }
      };
    });

    it("Upload speichert Vektoren, Suche und Chat finden die Quelle per Bedeutung", async () => {
      const elbe = await uploadTxt("elbe.txt", "Die Elbe fließt durch Dresden.");
      const rhein = await uploadTxt("rhein.txt", "Der Rhein fließt durch Köln.");
      expect(aiCalls[0]).toEqual(["title: elbe.txt | text: Die Elbe fließt durch Dresden."]);

      const stored = sqlite
        .prepare("SELECT model, dimensions FROM chunk_vectors ORDER BY chunk_id")
        .all();
      expect(stored).toEqual([
        { model: "@cf/google/embeddinggemma-2", dimensions: 768 },
        { model: "@cf/google/embeddinggemma-2", dimensions: 768 }
      ]);

      // "Landeshauptstadt Sachsens" steht in keiner Quelle: FTS findet nichts, der Vektor schon.
      const search = await call(
        "/api/v1/notebooks/nb_a/search",
        json("POST", { query: "Landeshauptstadt Sachsens", mode: "hybrid" })
      );
      const body = (await search.json()) as {
        results: Array<{ sourceId: string; vectorRank: number | null }>;
      };
      expect(body.results[0]).toMatchObject({ sourceId: elbe, vectorRank: 1 });

      const chat = await call(
        "/api/v1/notebooks/nb_a/chat",
        json("POST", { message: "Landeshauptstadt Sachsens?" })
      );
      const events = parseSse(await chat.text());
      const citations = events.find((e) => e.event === "citations")?.data as {
        citations: Array<{ sourceId: string }>;
      };
      expect(citations.citations[0]?.sourceId).toBe(elbe);
      expect(aiCalls.at(-1)).toEqual(["task: search result | query: Landeshauptstadt Sachsens?"]);
      // Mit Quellenauswahl bleibt die Vektorsuche auf die gewählte Quelle beschränkt
      const scoped = await call(
        "/api/v1/notebooks/nb_a/chat",
        json("POST", { message: "Landeshauptstadt Sachsens?", sourceIds: [rhein] })
      );
      const scopedEvents = parseSse(await scoped.text());
      const scopedCitations = scopedEvents.find((e) => e.event === "citations")?.data as {
        citations: Array<{ sourceId: string }>;
      };
      expect(scopedCitations.citations.every((c) => c.sourceId === rhein)).toBe(true);

      const usage = sqlite.prepare("SELECT scope, tokens FROM ai_embedding_usage").all();
      expect(usage).toEqual([{ scope: "global", tokens: 50 }]);
    });

    it("fällt Workers AI aus, bleibt es beim Volltext und der Upload gelingt trotzdem", async () => {
      (env as unknown as { AI: unknown }).AI = {
        run: async () => {
          throw new Error("4006: daily free allocation exceeded");
        }
      };
      await uploadTxt("elbe.txt", "Die Elbe fließt durch Dresden.");
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM chunk_vectors").get()).toEqual({ n: 0 });

      const fts = await call(
        "/api/v1/notebooks/nb_a/search",
        json("POST", { query: "Dresden", mode: "hybrid" })
      );
      const body = (await fts.json()) as { results: Array<{ ftsRank: number | null }> };
      expect(body.results[0]?.ftsRank).toBe(1);
    });
  });
});
