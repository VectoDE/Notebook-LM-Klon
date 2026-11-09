import type { SourceRow } from "@notebook-lm/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { notifyNotebookDO, registerChunkIngestionRoutes } from "../chunk-ingestion.js";
import { RagRepository } from "../rag-repository.js";

// Helper to create in-memory database mock supporting exec, run, query, queryOne and batch
function createMockDb(): {
  db: {
    exec: (sql: string) => Promise<void>;
    run: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    queryOne: <T>(sql: string, params?: unknown[]) => Promise<T | null>;
    prepare: (sql: string) => {
      bind: (...params: unknown[]) => {
        all: () => Promise<{ results: unknown[]; meta: { changes: number } }>;
      };
    };
    batch: (stmts: Array<{ all: () => Promise<unknown> }>) => Promise<unknown[]>;
  };
  sources: Map<string, SourceRow>;
  chunks: Map<string, { id: string; source_id: string; text: string }>;
  vectors: Map<string, { chunk_id: string; scale: number; vector: Uint8Array }>;
  executedBatchCount: number;
} {
  const sources = new Map<string, SourceRow>();
  const chunks = new Map<string, { id: string; source_id: string; text: string }>();
  const vectors = new Map<string, { chunk_id: string; scale: number; vector: Uint8Array }>();
  let executedBatchCount = 0;

  const db = {
    exec: async () => {},
    run: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("DELETE FROM sources")) {
        const id = params[0] as string;
        sources.delete(id);
        for (const [cId, chunk] of chunks.entries()) {
          if (chunk.source_id === id) {
            chunks.delete(cId);
            vectors.delete(cId);
          }
        }
        return { changes: 1 };
      }
      if (sql.includes("UPDATE sources SET status = ?")) {
        const status = params[0] as SourceRow["status"];
        const errMsg = params[1] as string | null;
        const id = params[3] as string;
        const s = sources.get(id);
        if (s) {
          sources.set(id, { ...s, status, error_message: errMsg });
        }
        return { changes: 1 };
      }
      return { changes: 1 };
    },
    query: async <T>() => [] as T[],
    queryOne: async <T>(sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM sources WHERE id = ?")) {
        const id = params[0] as string;
        return (sources.get(id) as T) ?? null;
      }
      return null;
    },
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => {
          if (sql.includes("INSERT OR REPLACE INTO chunks")) {
            const chunkId = params[0] as string;
            const sourceId = params[1] as string;
            const text = params[7] as string;
            chunks.set(chunkId, { id: chunkId, source_id: sourceId, text });
          } else if (sql.includes("INSERT OR REPLACE INTO chunk_vectors")) {
            const chunkId = params[0] as string;
            const scale = params[4] as number;
            const blob = params[7] as Uint8Array;
            vectors.set(chunkId, { chunk_id: chunkId, scale, vector: blob });
          }
          return { results: [], meta: { changes: 1 } };
        }
      })
    }),
    batch: async (stmts: Array<{ all: () => Promise<unknown> }>) => {
      executedBatchCount++;
      const results = [];
      for (const st of stmts) {
        results.push(await st.all());
      }
      return results;
    }
  };

  return {
    db,
    sources,
    chunks,
    vectors,
    get executedBatchCount() {
      return executedBatchCount;
    }
  };
}

describe("Batch Chunk Ingestion & Vector Ingestion API (Sub-Issues #96, #97)", () => {
  it("rejects unauthorized requests with 401 ProblemDetails", async () => {
    const mock = createMockDb();
    const ragRepo = new RagRepository(mock.db);

    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerChunkIngestionRoutes(app, { ragRepo });

    const res = await app.request("/api/v1/sources/src_123/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chunks: [] })
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");

    const delRes = await app.request("/api/v1/sources/src_123", {
      method: "DELETE"
    });
    expect(delRes.status).toBe(401);
  });

  it("returns 404 when source does not exist", async () => {
    const mock = createMockDb();
    const ragRepo = new RagRepository(mock.db);

    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "user_test" });
      await next();
    });
    registerChunkIngestionRoutes(app, { ragRepo });

    const res = await app.request("/api/v1/sources/non_existent_src/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chunks: [{ chunkIndex: 0, text: "Sample chunk" }]
      })
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("SOURCE_NOT_FOUND");

    const delRes = await app.request("/api/v1/sources/non_existent_src", {
      method: "DELETE"
    });
    expect(delRes.status).toBe(404);
  });

  it("validates request payload (invalid JSON & Zod schema validation errors)", async () => {
    const mock = createMockDb();
    mock.sources.set("src_valid", {
      id: "src_valid",
      notebook_id: "nb_1",
      title: "Doc 1",
      original_name: "doc.txt",
      mime_type: "text/plain",
      source_type: "txt",
      byte_size: 100,
      r2_key: null,
      r2_etag: null,
      status: "uploading",
      error_message: null,
      created_at: 1000,
      updated_at: 1000
    });

    const ragRepo = new RagRepository(mock.db);
    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "user_test" });
      await next();
    });
    registerChunkIngestionRoutes(app, { ragRepo });

    // Invalid JSON
    const resBadJson = await app.request("/api/v1/sources/src_valid/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json{{"
    });
    expect(resBadJson.status).toBe(400);
    const bodyBadJson = (await resBadJson.json()) as { code: string };
    expect(bodyBadJson.code).toBe("INVALID_JSON");

    // Empty chunks array
    const resEmpty = await app.request("/api/v1/sources/src_valid/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chunks: [] })
    });
    expect(resEmpty.status).toBe(400);
    const bodyEmpty = (await resEmpty.json()) as { code: string; errors: Array<{ field: string }> };
    expect(bodyEmpty.code).toBe("VALIDATION_ERROR");
  });

  it("ingests 200 chunks + 768d int8 vectors in batches into D1 and marks source ready (Sub-Issue #96)", async () => {
    const mock = createMockDb();
    mock.sources.set("src_large", {
      id: "src_large",
      notebook_id: "nb_large",
      title: "Large Manual",
      original_name: "manual.pdf",
      mime_type: "application/pdf",
      source_type: "pdf",
      byte_size: 50000,
      r2_key: "manual.pdf",
      r2_etag: "etag-1",
      status: "uploading",
      error_message: null,
      created_at: 2000,
      updated_at: 2000
    });

    const ragRepo = new RagRepository(mock.db);

    // Mock DO stub to record vector update notifications
    const notifiedUpdates: Array<{ sourceId?: string | undefined; count?: number | undefined }> =
      [];
    const mockEnv = {
      DB: mock.db as unknown as D1Database,
      MEDIA: {
        delete: async () => {}
      } as unknown as R2Bucket,
      NOTEBOOK_DO: {
        idFromName: (name: string) => ({ name }),
        get: () => ({
          fetch: async (reqInfo: RequestInfo | URL, init?: RequestInit) => {
            const req = reqInfo instanceof Request ? reqInfo : new Request(reqInfo, init);
            const json = (await req.json()) as { vectors?: unknown[]; sourceId?: string };
            notifiedUpdates.push({
              sourceId: json.sourceId,
              count: json.vectors?.length
            });
            return new Response(JSON.stringify({ success: true }));
          }
        })
      } as unknown as DurableObjectNamespace
    } as unknown as Env;

    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "user_test" });
      c.env = mockEnv;
      await next();
    });
    registerChunkIngestionRoutes(app, { ragRepo, d1Database: mockEnv.DB });

    // Generate 200 chunks with 768d vectors (mix of raw float32 and pre-quantized int8)
    const chunksPayload = [];
    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        // Raw Float32
        const f32 = new Float32Array(768);
        f32[0] = 0.5;
        f32[1] = -0.5;
        chunksPayload.push({
          chunkIndex: i,
          text: `Paragraph content chunk index ${i} discussing RAG architecture.`,
          vector: {
            float32: Array.from(f32)
          }
        });
      } else {
        // Pre-quantized int8
        const qArr = new Array(768).fill(0);
        qArr[0] = 64;
        qArr[1] = -64;
        if (i === 1) {
          // Provide an inverted vector where first entry is negative and second is positive
          // so that both minVal < v and maxVal > v branches are exercised
          qArr[0] = -120;
          qArr[1] = 120;
        }
        chunksPayload.push({
          chunkIndex: i,
          text: `Paragraph content chunk index ${i} with prequantized int8 vector.`,
          vector: {
            quantized: qArr,
            scale: 0.0078
          }
        });
      }
    }

    const res = await app.request("/api/v1/sources/src_large/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chunks: chunksPayload,
        model: "text-embedding-3-small",
        markReady: true
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      chunksIngested: number;
      vectorsIngested: number;
      status: string;
    };
    expect(body.success).toBe(true);
    expect(body.chunksIngested).toBe(200);
    expect(body.vectorsIngested).toBe(200);
    expect(body.status).toBe("ready");

    // Verify all 200 chunks & vectors stored in DB
    expect(mock.chunks.size).toBe(200);
    expect(mock.vectors.size).toBe(200);

    // D1 batches must have run with statements chunked by D1_STATEMENT_BATCH_LIMIT (200 chunks + 200 vectors = 400 statements / 50 = 8 batches)
    expect(mock.executedBatchCount).toBe(8);

    // Verify source status updated to 'ready'
    const updatedSource = mock.sources.get("src_large");
    expect(updatedSource?.status).toBe("ready");

    // Verify NotebookDO notification was triggered
    expect(notifiedUpdates.length).toBe(1);
    expect(notifiedUpdates[0]?.sourceId).toBe("src_large");
    expect(notifiedUpdates[0]?.count).toBe(200);
  });

  it("handles source deletion and invalidates NotebookDO vector cache (Sub-Issue #97)", async () => {
    const mock = createMockDb();
    mock.sources.set("src_to_delete", {
      id: "src_to_delete",
      notebook_id: "nb_del",
      title: "Doc to delete",
      original_name: "doc.txt",
      mime_type: "text/plain",
      source_type: "txt",
      byte_size: 120,
      r2_key: "r2_key_src_to_delete",
      r2_etag: "etag",
      status: "ready",
      error_message: null,
      created_at: 100,
      updated_at: 100
    });

    // Populate a chunk
    mock.chunks.set("chunk_del_1", {
      id: "chunk_del_1",
      source_id: "src_to_delete",
      text: "Text to be wiped"
    });

    const ragRepo = new RagRepository(mock.db);

    let deletedR2Key: string | null = null;
    let invalidatedSource: string | null = null;

    const mockEnv = {
      DB: mock.db as unknown as D1Database,
      MEDIA: {
        delete: async (k: string) => {
          deletedR2Key = k;
        }
      } as unknown as R2Bucket,
      NOTEBOOK_DO: {
        idFromName: (name: string) => ({ name }),
        get: () => ({
          fetch: async (reqInfo: RequestInfo | URL, init?: RequestInit) => {
            const req = reqInfo instanceof Request ? reqInfo : new Request(reqInfo, init);
            const json = (await req.json()) as { sourceId?: string };
            invalidatedSource = json.sourceId ?? null;
            return new Response(JSON.stringify({ success: true }));
          }
        })
      } as unknown as DurableObjectNamespace
    } as unknown as Env;

    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "user_test" });
      c.env = mockEnv;
      await next();
    });
    registerChunkIngestionRoutes(app, { ragRepo });

    const delRes = await app.request("/api/v1/sources/src_to_delete", {
      method: "DELETE"
    });

    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { success: boolean; deletedSourceId: string };
    expect(delBody.success).toBe(true);
    expect(delBody.deletedSourceId).toBe("src_to_delete");

    // Source & chunks removed from DB
    expect(mock.sources.has("src_to_delete")).toBe(false);
    expect(mock.chunks.has("chunk_del_1")).toBe(false);

    // Media file deleted from R2
    expect(deletedR2Key).toBe("r2_key_src_to_delete");

    // NotebookDO notified to invalidate
    expect(invalidatedSource).toBe("src_to_delete");

    // R2 error resilience during deletion
    const errorEnv = {
      DB: mock.db as unknown as D1Database,
      MEDIA: {
        delete: async () => {
          throw new Error("R2 connection reset");
        }
      } as unknown as R2Bucket
    } as unknown as Env;

    mock.sources.set("src_r2_err", {
      id: "src_r2_err",
      notebook_id: "nb_r2_err",
      title: "Doc with R2 error",
      original_name: "doc.txt",
      mime_type: "text/plain",
      source_type: "txt",
      byte_size: 10,
      r2_key: "key_r2_err",
      r2_etag: "etag",
      status: "ready",
      error_message: null,
      created_at: 100,
      updated_at: 100
    });

    const errApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    errApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: "user_test" });
      c.env = errorEnv;
      await next();
    });
    registerChunkIngestionRoutes(errApp, { ragRepo });

    const errDelRes = await errApp.request("/api/v1/sources/src_r2_err", { method: "DELETE" });
    expect(errDelRes.status).toBe(200);

    // Also test source with no r2_key
    mock.sources.set("src_no_r2", {
      id: "src_no_r2",
      notebook_id: "nb_no_r2",
      title: "Doc without R2 key",
      original_name: "doc.txt",
      mime_type: "text/plain",
      source_type: "txt",
      byte_size: 10,
      r2_key: null,
      r2_etag: null,
      status: "ready",
      error_message: null,
      created_at: 100,
      updated_at: 100
    });
    const noR2DelRes = await errApp.request("/api/v1/sources/src_no_r2", { method: "DELETE" });
    expect(noR2DelRes.status).toBe(200);
  });

  it("handles fallback execution when D1 batch is not available and handles DO notification failures gracefully", async () => {
    // Database without d1Database.batch, using sequential run fallback
    const runQueries: string[] = [];
    const fallbackDb = {
      exec: async () => {},
      run: async (sql: string) => {
        runQueries.push(sql);
        return { changes: 1 };
      },
      query: async <T>() => [] as T[],
      queryOne: async <T>(sql: string) => {
        if (sql.includes("FROM sources")) {
          return {
            id: "src_seq",
            notebook_id: "nb_seq",
            status: "processing"
          } as T;
        }
        return null;
      }
    };
    const ragRepo = new RagRepository(fallbackDb);

    // Failing DO stub
    const failingEnv = {
      DB: {} as unknown as D1Database,
      NOTEBOOK_DO: {
        idFromName: () => ({ name: "failing" }),
        get: () => ({
          fetch: async () => {
            throw new Error("DO connection timeout");
          }
        })
      } as unknown as DurableObjectNamespace
    } as unknown as Env;

    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "user_test" });
      c.env = failingEnv;
      await next();
    });
    registerChunkIngestionRoutes(app, { ragRepo, d1Database: undefined });

    const res = await app.request("/api/v1/sources/src_seq/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chunks: [{ chunkIndex: 0, text: "Chunk without vector" }],
        markReady: false
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; vectorsIngested: number };
    expect(body.success).toBe(true);
    expect(body.vectorsIngested).toBe(0);
    expect(runQueries.length).toBeGreaterThan(0);

    // Test notifyNotebookDO edge cases: no NOTEBOOK_DO in env
    await expect(notifyNotebookDO(undefined, "nb_test", "invalidate")).resolves.toBeUndefined();

    // Test notifyNotebookDO with and without payload
    const dummyStub = {
      fetch: async () => new Response(JSON.stringify({ ok: true }))
    };
    const dummyEnv = {
      NOTEBOOK_DO: {
        idFromName: () => ({ name: "d" }),
        get: () => dummyStub
      }
    } as unknown as Env;

    await expect(
      notifyNotebookDO(dummyEnv, "nb_test", "update", undefined)
    ).resolves.toBeUndefined();
    await expect(
      notifyNotebookDO(dummyEnv, "nb_test", "invalidate", { sourceId: "s" })
    ).resolves.toBeUndefined();
  });
});
