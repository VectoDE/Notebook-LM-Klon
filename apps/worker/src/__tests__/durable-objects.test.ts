import { ProblemDetailsSchema } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import {
  type DurableObjectHealthReport,
  JobDO,
  NotebookDO,
  type SqliteDurableObjectState
} from "../index.js";

function createMockSqliteState(
  id: string,
  emptySelectResult = false
): {
  state: SqliteDurableObjectState;
  executedQueries: string[];
} {
  const executedQueries: string[] = [];
  const state: SqliteDurableObjectState = {
    id: { toString: () => id },
    storage: {
      sql: {
        exec: (query: string) => {
          executedQueries.push(query);
          return {
            toArray: () => (emptySelectResult ? [] : [{ ok: 1 }])
          };
        }
      }
    }
  };
  return { state, executedQueries };
}

describe("SQLite Durable Objects (NotebookDO & JobDO)", () => {
  it("initializes NotebookDO SQLite schema idempotently and responds to /health", async () => {
    const { state, executedQueries } = createMockSqliteState("notebook-do-1");
    const doInstance = new NotebookDO(state, {} as Env);

    const firstPing = doInstance.ping();
    expect(firstPing).toEqual({
      ok: true,
      className: "NotebookDO",
      objectId: "notebook-do-1",
      sqliteReady: true
    });

    const res = await doInstance.fetch(new Request("https://do.internal/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DurableObjectHealthReport;
    expect(body.ok).toBe(true);
    expect(body.className).toBe("NotebookDO");

    // CREATE TABLE should only run once due to idempotency guard
    const createCount = executedQueries.filter((q) => q.startsWith("CREATE TABLE")).length;
    expect(createCount).toBe(1);
  });

  it("returns RFC 9457 404 ProblemDetails for unknown routes on NotebookDO", async () => {
    const { state } = createMockSqliteState("notebook-do-2");
    const doInstance = new NotebookDO(state, {} as Env);

    const res = await doInstance.fetch(new Request("https://do.internal/unknown"));
    expect(res.status).toBe(404);
    const problem = ProblemDetailsSchema.parse(await res.json());
    expect(problem.code).toBe("DO_ROUTE_NOT_FOUND");
  });

  it("initializes JobDO SQLite schema idempotently and responds to /health and unknown routes", async () => {
    const { state, executedQueries } = createMockSqliteState("job-do-1");
    const jobDo = new JobDO(state, {} as Env);

    const firstPing = jobDo.ping();
    expect(firstPing.ok).toBe(true);
    expect(firstPing.className).toBe("JobDO");

    const res = await jobDo.fetch(new Request("https://do.internal/health"));
    expect(res.status).toBe(200);

    const createCount = executedQueries.filter((q) => q.startsWith("CREATE TABLE")).length;
    expect(createCount).toBe(1);

    const notFoundRes = await jobDo.fetch(new Request("https://do.internal/missing"));
    expect(notFoundRes.status).toBe(404);
    const problem = ProblemDetailsSchema.parse(await notFoundRes.json());
    expect(problem.code).toBe("DO_ROUTE_NOT_FOUND");

    // Degraded SQLite health check branch (503) for both DOs
    const degradedNotebook = new NotebookDO(createMockSqliteState("nb-deg", true).state, {} as Env);
    const degNbRes = await degradedNotebook.fetch(new Request("https://do.internal/health"));
    expect(degNbRes.status).toBe(503);

    const degradedJob = new JobDO(createMockSqliteState("job-deg", true).state, {} as Env);
    const degJobRes = await degradedJob.fetch(new Request("https://do.internal/health"));
    expect(degJobRes.status).toBe(503);
  });

  it("handles in-memory int8 vector cache update, query, and invalidation (Sub-Issue #97)", async () => {
    const { state } = createMockSqliteState("notebook-do-vec");
    const doInstance = new NotebookDO(state, {} as Env);

    // Initial cache is empty
    const initRes = await doInstance.fetch(new Request("https://do.internal/vectors"));
    expect(initRes.status).toBe(200);
    const initBody = (await initRes.json()) as { vectors: unknown[]; count: number };
    expect(initBody.count).toBe(0);

    // Update with 2 vectors
    const updateRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vectors: [
            {
              chunkId: "c1",
              sourceId: "src1",
              quantized: [10, -20, 30],
              scale: 0.05
            },
            {
              chunkId: "c2",
              sourceId: "src2",
              quantized: [-5, 15, -25],
              scale: 0.02
            }
          ]
        })
      })
    );
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as {
      success: boolean;
      count: number;
      totalCached: number;
    };
    expect(updateBody.count).toBe(2);
    expect(updateBody.totalCached).toBe(2);

    // Verify GET /vectors returns them
    const getRes = await doInstance.fetch(new Request("https://do.internal/vectors"));
    const getBody = (await getRes.json()) as {
      vectors: Array<{ chunkId: string; length: number }>;
      count: number;
    };
    expect(getBody.count).toBe(2);
    expect(getBody.vectors[0]?.chunkId).toBe("c1");
    expect(getBody.vectors[0]?.length).toBe(3);

    // Invalidate src1 only
    const invalSrc1Res = await doInstance.fetch(
      new Request("https://do.internal/vectors/invalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: "src1" })
      })
    );
    expect(invalSrc1Res.status).toBe(200);
    const invalBody = (await invalSrc1Res.json()) as { remaining: number };
    expect(invalBody.remaining).toBe(1);

    // Invalidate everything
    const invalAllRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/invalidate", {
        method: "POST"
      })
    );
    expect(invalAllRes.status).toBe(200);
    const invalAllBody = (await invalAllRes.json()) as { remaining: number };
    expect(invalAllBody.remaining).toBe(0);

    // Invalidate with malformed JSON body
    const invalBadJsonRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/invalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "bad-json{"
      })
    );
    expect(invalBadJsonRes.status).toBe(200);

    // Invalid JSON handling
    const invalidJsonRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "invalid-json{"
      })
    );
    expect(invalidJsonRes.status).toBe(400);
    const problem = ProblemDetailsSchema.parse(await invalidJsonRes.json());
    expect(problem.code).toBe("INVALID_JSON");
  });

  it("handles lazy-loading from D1 and top-k in-memory vector search with benchmark (Sub-Issue #98)", async () => {
    // 1. Mock D1 database with 5,000 vectors
    const dim = 768;
    const numVectors = 5000;
    const mockDbVectors: Array<{
      chunk_id: string;
      scale: number;
      vector: Uint8Array;
      source_id: string;
    }> = [];

    // Pre-populate 5,000 synthetic 768d vectors
    for (let i = 0; i < numVectors; i++) {
      const qArr = new Int8Array(dim);
      for (let d = 0; d < dim; d++) {
        qArr[d] = ((i + d) % 255) - 127;
      }
      mockDbVectors.push({
        chunk_id: `chunk_${i}`,
        scale: 0.005,
        vector: new Uint8Array(qArr.buffer, qArr.byteOffset, qArr.byteLength),
        source_id: i < 2500 ? "src_A" : "src_B"
      });
    }

    const mockDb: D1Database = {
      prepare: (_sql: string) => ({
        bind: (..._params: unknown[]) => ({
          all: async () => ({
            results: mockDbVectors,
            success: true,
            meta: {
              changes: 0,
              last_row_id: 0,
              duration: 0,
              rows_read: numVectors,
              rows_written: 0
            }
          })
        })
      })
    } as unknown as D1Database;

    const mockEnv = {
      DB: mockDb
    } as unknown as Env;

    const { state } = createMockSqliteState("nb_bench");
    const doInstance = new NotebookDO(state, mockEnv);

    // Initial check: cache empty
    expect(doInstance.getCachedVectors()).toHaveLength(0);

    // Cold-Load from D1 via GET /vectors
    const coldStart = performance.now();
    const getRes = await doInstance.fetch(new Request("https://do.internal/vectors"));
    const coldDuration = performance.now() - coldStart;
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { count: number };
    expect(getBody.count).toBe(5000);
    expect(coldDuration).toBeGreaterThan(0);

    // Warm-Hit: ensureVectorsLoaded returns immediately
    const warmLoaded = await doInstance.ensureVectorsLoaded();
    expect(warmLoaded).toBe(5000);

    // Warm-up search
    doInstance.searchVectors(new Int8Array(dim), 0.01, 10);

    // Test POST /vectors/search with Float32 query vector (Sub-Issue #98)
    const queryVec = new Array(dim).fill(0).map((_, idx) => (idx % 100) / 100);
    const searchStart = performance.now();
    const searchRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queryVector: queryVec,
          limit: 10
        })
      })
    );
    const searchDuration = performance.now() - searchStart;
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as {
      results: Array<{ chunkId: string; score: number }>;
      count: number;
      totalVectors: number;
    };
    expect(searchBody.count).toBe(10);
    expect(searchBody.totalVectors).toBe(5000);
    // Benchmark check: in-memory scoring over 5,000 vectors should execute smoothly in under 1 second even under full coverage instrumentation
    expect(searchDuration).toBeLessThan(1000);

    // Filter by sourceIds: only src_B
    const filterRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          queryVector: queryVec,
          limit: 5,
          sourceIds: ["src_B"]
        })
      })
    );
    expect(filterRes.status).toBe(200);
    const filterBody = (await filterRes.json()) as {
      results: Array<{ chunkId: string; sourceId?: string }>;
    };
    expect(filterBody.results).toHaveLength(5);
    for (const r of filterBody.results) {
      expect(r.sourceId).toBe("src_B");
    }

    // Direct quantized int8 search input (also testing default limit fallback without limit specified)
    const qInt8 = Array.from(new Int8Array(dim).fill(10));
    const int8SearchRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quantized: qInt8,
          scale: 0.01
        })
      })
    );
    expect(int8SearchRes.status).toBe(200);
    const int8Body = (await int8SearchRes.json()) as { count: number };
    expect(int8Body.count).toBe(10);

    // Missing queryVector and quantized -> 400
    const missingRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 5 })
      })
    );
    expect(missingRes.status).toBe(400);

    // Bad JSON body -> 400
    const badJsonRes = await doInstance.fetch(
      new Request("https://do.internal/vectors/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "bad-json{"
      })
    );
    expect(badJsonRes.status).toBe(400);

    // Degraded DB branch: ensureVectorsLoaded when no DB in env
    const noDbDo = new NotebookDO(createMockSqliteState("no_db").state, {} as Env);
    expect(await noDbDo.ensureVectorsLoaded()).toBe(0);

    // Degraded DB branch: DB throws
    const faultyDbDo = new NotebookDO(createMockSqliteState("faulty_db").state, {
      DB: {
        prepare: () => {
          throw new Error("DB connection lost");
        }
      } as unknown as D1Database
    } as Env);
    expect(await faultyDbDo.ensureVectorsLoaded()).toBe(0);

    // Test ArrayBuffer / Array vector formats in ensureVectorsLoaded
    const multiFormatDb: D1Database = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              {
                chunk_id: "chk_ab",
                scale: 0.1,
                vector: new ArrayBuffer(8),
                source_id: null
              },
              {
                chunk_id: "chk_arr",
                scale: 0.1,
                vector: [1, 2, 3, 4],
                source_id: "src_arr"
              },
              {
                chunk_id: "chk_inv",
                scale: 0.1,
                vector: "not-a-vector",
                source_id: null
              }
            ],
            success: true
          })
        })
      })
    } as unknown as D1Database;
    const formatDo = new NotebookDO(createMockSqliteState("format_nb").state, {
      DB: multiFormatDb
    } as Env);
    expect(await formatDo.ensureVectorsLoaded()).toBe(2);
  });
});
