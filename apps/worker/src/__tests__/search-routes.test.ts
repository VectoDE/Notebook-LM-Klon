import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type ProblemDetails,
  type SearchResponse,
  quantizeFloat32ToInt8
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { RagRepository } from "../rag-repository.js";
import { queryNotebookVectorSearch, registerSearchRoutes } from "../search-routes.js";

/**
 * Creates in-memory SQLite wrapper mocking D1 with migrations 0001 & 0002.
 */
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

describe("RAG & Hybrid Search API (POST /api/v1/notebooks/:id/search - Issues #18, #99, #100)", () => {
  let mockD1: ReturnType<typeof createMockD1>;
  let coreRepo: CoreRepository;
  let ragRepo: RagRepository;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  const testUserId = "usr_rag_1";
  const testWorkspaceId = "ws_rag_1";
  const testNotebookId = "nb_rag_1";
  const testSourceA = "src_rag_a";
  const testSourceB = "src_rag_b";

  beforeEach(async () => {
    mockD1 = createMockD1();
    coreRepo = new CoreRepository(mockD1.adapter);
    ragRepo = new RagRepository(mockD1.adapter);

    // Seed User, Workspace, Notebook
    const now = Date.now();
    await coreRepo.createUser({
      id: testUserId,
      email: "engineer@example.com",
      display_name: "RAG Engineer",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await coreRepo.createWorkspace({
      id: testWorkspaceId,
      name: "Engineering Workspace",
      owner_id: testUserId,
      created_at: now
    });

    await coreRepo.createNotebook({
      id: testNotebookId,
      workspace_id: testWorkspaceId,
      title: "RAG Knowledge Base",
      emoji: "search",
      created_by: testUserId,
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    // Seed Sources
    await ragRepo.createSource({
      id: testSourceA,
      notebook_id: testNotebookId,
      title: "AI Act & Compliance",
      original_name: "ai-act.pdf",
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

    await ragRepo.createSource({
      id: testSourceB,
      notebook_id: testNotebookId,
      title: "System Architecture",
      original_name: "architecture.md",
      mime_type: "text/markdown",
      source_type: "md",
      byte_size: 2048,
      r2_key: null,
      r2_etag: null,
      status: "ready",
      error_message: null,
      created_at: now,
      updated_at: now
    });

    // Seed Chunks:
    // Chunk 1: Mentions Art. 50 AI Act and RelationFlow (Exact Keyword)
    // Chunk 2: Mentions semantische Vektorsuche und Int8-Quantisierung
    // Chunk 3: Architecture and Cloudflare D1
    // Chunk 4: Long text for snippet test
    await ragRepo.insertChunks([
      {
        id: "chk_1",
        source_id: testSourceA,
        notebook_id: testNotebookId,
        chunk_index: 0,
        page_number: 14,
        start_offset: 100,
        end_offset: 250,
        text: "Art. 50 AI Act regelt Kennzeichnungspflichten für generative KI-Systeme und RelationFlow Integration.",
        token_count: 20,
        created_at: now
      },
      {
        id: "chk_2",
        source_id: testSourceA,
        notebook_id: testNotebookId,
        chunk_index: 1,
        page_number: 15,
        start_offset: 260,
        end_offset: 400,
        text: "Semantische Vektorsuche basiert auf symmetrischer Int8-Quantisierung im Arbeitsspeicher des Durable Objects.",
        token_count: 18,
        created_at: now
      },
      {
        id: "chk_3",
        source_id: testSourceB,
        notebook_id: testNotebookId,
        chunk_index: 0,
        page_number: 1,
        start_offset: 0,
        end_offset: 600,
        text: `Systemarchitektur: Cloudflare D1 speichert alle Dokument-Chunks. ${"A".repeat(400)}`,
        token_count: 100,
        created_at: now
      }
    ]);

    // Seed Vectors (768d unit-like vectors)
    // Query vector will be close to chk_2
    const v1Float = new Float32Array(768).fill(0.01);
    v1Float[0] = 0.9;
    const q1 = quantizeFloat32ToInt8(v1Float);

    const v2Float = new Float32Array(768).fill(0.01);
    v2Float[1] = 0.95; // very high on dimension 1
    const q2 = quantizeFloat32ToInt8(v2Float);

    const v3Float = new Float32Array(768).fill(0.01);
    v3Float[2] = 0.85;
    const q3 = quantizeFloat32ToInt8(v3Float);

    await ragRepo.insertChunkVectors([
      {
        chunk_id: "chk_1",
        notebook_id: testNotebookId,
        model: "text-embedding-3-small",
        dimensions: 768,
        scale: q1.scale,
        min_val: -1,
        max_val: 1,
        vector: new Uint8Array(
          q1.quantized.buffer,
          q1.quantized.byteOffset,
          q1.quantized.byteLength
        ),
        created_at: now
      },
      {
        chunk_id: "chk_2",
        notebook_id: testNotebookId,
        model: "text-embedding-3-small",
        dimensions: 768,
        scale: q2.scale,
        min_val: -1,
        max_val: 1,
        vector: new Uint8Array(
          q2.quantized.buffer,
          q2.quantized.byteOffset,
          q2.quantized.byteLength
        ),
        created_at: now
      },
      {
        chunk_id: "chk_3",
        notebook_id: testNotebookId,
        model: "text-embedding-3-small",
        dimensions: 768,
        scale: q3.scale,
        min_val: -1,
        max_val: 1,
        vector: new Uint8Array(
          q3.quantized.buffer,
          q3.quantized.byteOffset,
          q3.quantized.byteLength
        ),
        created_at: now
      }
    ]);

    // Set up Hono app
    app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerSearchRoutes(app, { ragRepo, coreRepo });
  });

  it("authenticates and validates request body schemas (401, 404, 422, 400)", async () => {
    // 1. Unauthenticated -> 401
    const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerSearchRoutes(unauthApp, { ragRepo, coreRepo });
    const res401 = await unauthApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Test" })
      }
    );
    expect(res401.status).toBe(401);
    const p401 = (await res401.json()) as ProblemDetails;
    expect(p401.code).toBe("UNAUTHORIZED");

    // 2. Notebook not found -> 404
    const res404 = await app.request("http://localhost/api/v1/notebooks/missing_nb/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Test" })
    });
    expect(res404.status).toBe(404);
    const p404 = (await res404.json()) as ProblemDetails;
    expect(p404.code).toBe("NOTEBOOK_NOT_FOUND");

    // 3. User not member or shared -> 404 (IDOR)
    const otherUserApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    otherUserApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: "intruder_user" });
      await next();
    });
    registerSearchRoutes(otherUserApp, { ragRepo, coreRepo });
    const resIdor = await otherUserApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Test" })
      }
    );
    expect(resIdor.status).toBe(404);

    // 4. Invalid JSON body -> 400
    const res400 = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "invalid-json{"
    });
    expect(res400.status).toBe(400);

    // 5. Validation error: empty query or invalid limit -> 422
    const res422 = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "   ", limit: 500 })
    });
    expect(res422.status).toBe(422);
    const p422 = (await res422.json()) as ProblemDetails;
    expect(p422.code).toBe("VALIDATION_ERROR");
  });

  it("performs lexical FTS5 BM25 search for exact keywords and article codes (Sub-Issue #99)", async () => {
    // Search exact law article "Art. 50 AI Act"
    const res = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "Art. 50 AI Act",
        mode: "fts",
        limit: 5
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchResponse;
    expect(body.mode).toBe("fts");
    expect(body.totalResults).toBeGreaterThanOrEqual(1);
    expect(body.results[0]?.chunkId).toBe("chk_1");
    expect(body.results[0]?.sourceTitle).toBe("AI Act & Compliance");
    expect(body.results[0]?.page).toBe(14);
    expect(body.results[0]?.ftsRank).toBe(1);
    expect(body.results[0]?.ftsScore).not.toBeNull();
  });

  it("performs semantic vector search and filter by sourceIds (Sub-Issues #98, #100)", async () => {
    // Query vector targeting dimension 1 (matches chk_2)
    const targetVec = new Array(768).fill(0.01);
    targetVec[1] = 0.99;

    const res = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "Semantische Suche Int8",
        queryVector: targetVec,
        mode: "vector",
        limit: 2
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchResponse;
    expect(body.mode).toBe("vector");
    expect(body.totalResults).toBe(2);
    expect(body.results[0]?.chunkId).toBe("chk_2");
    expect(body.results[0]?.vectorRank).toBe(1);
    expect(body.results[0]?.vectorScore).toBeGreaterThan(0.5);

    // Test source filtering: exclude testSourceA, only testSourceB
    // Also tests snippet truncation (> 300 chars) for chk_4
    const filterRes = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "Semantische Suche Int8",
          queryVector: targetVec,
          mode: "vector",
          limit: 5,
          sourceIds: [testSourceB]
        })
      }
    );
    expect(filterRes.status).toBe(200);
    const filterBody = (await filterRes.json()) as SearchResponse;
    for (const r of filterBody.results) {
      expect(r.sourceId).toBe(testSourceB);
    }
    const truncatedChunk = filterBody.results.find((r) => r.chunkId === "chk_3");
    expect(truncatedChunk).toBeDefined();
    expect(truncatedChunk?.snippet.endsWith("...")).toBe(true);
    expect(truncatedChunk?.snippet.length).toBeLessThanOrEqual(303);

    // Test vector-only search when query has NO queryVector but FTS is NOT run
    // And test pure vector-only result path (mode === 'vector' with queryVector and no FTS)
    // To trigger vector-only result branch (lines 331-358)
    const pureVecRes = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "pure-vector-no-fts-match-xyz123",
          queryVector: targetVec,
          mode: "vector",
          limit: 2
        })
      }
    );
    expect(pureVecRes.status).toBe(200);
    const pureVecBody = (await pureVecRes.json()) as SearchResponse;
    expect(pureVecBody.results).toHaveLength(2);
    expect(pureVecBody.results[0]?.vectorRank).toBe(1);
    expect(pureVecBody.results[0]?.ftsRank).toBeNull();
  });

  it("combines vector and lexical search with Reciprocal Rank Fusion (RRF k=60) (Sub-Issue #99, #100)", async () => {
    // Query that has keyword match on chk_3 ("Systemarchitektur" - in fts only) and semantic similarity on chk_2 (vector)
    // chk_3 has no vector match because targetVec aligns only with dimension 1 (chk_2)
    // Thus chk_3 will appear with vectorRank: null and vectorScore: null in hybrid RRF
    const targetVec = new Array(768).fill(0.01);
    targetVec[1] = 0.99; // strong semantic affinity for chk_2

    const res = await app.request(`http://localhost/api/v1/notebooks/${testNotebookId}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "RelationFlow",
        queryVector: targetVec,
        mode: "hybrid",
        limit: 10
      })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchResponse;
    expect(body.mode).toBe("hybrid");
    expect(body.totalResults).toBeGreaterThanOrEqual(2);

    // Both chk_1 (keyword match on RelationFlow) and chk_2 (vector match) are present in results
    const resultChunkIds = body.results.map((r) => r.chunkId);
    expect(resultChunkIds).toContain("chk_1");
    expect(resultChunkIds).toContain("chk_2");

    // Check that chk_1 has null vectorRank if it wasn't in top vector results, or check ranks
    const c1 = body.results.find((r) => r.chunkId === "chk_1");
    expect(c1).toBeDefined();
    expect(c1?.sourceTitle).toBe("AI Act & Compliance");
    expect(c1?.page).toBe(14);
    expect(c1?.snippet).toContain("Art. 50 AI Act");
    expect(c1?.score).toBeGreaterThan(0);
  });

  it("supports fallback to NotebookDO mock and queryNotebookVectorSearch edge cases", async () => {
    // 1. Mock NotebookDO in env
    const mockDoStub = {
      fetch: async (_req: Request) => {
        return new Response(
          JSON.stringify({
            results: [{ chunkId: "chk_do", sourceId: "src_do", score: 0.98 }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    };
    const mockEnv = {
      NOTEBOOK_DO: {
        idFromName: () => ({ toString: () => "mock-do" }),
        get: () => mockDoStub
      }
    } as unknown as Env;

    const doResults = await queryNotebookVectorSearch(mockEnv, ragRepo, testNotebookId, {
      queryVector: [1, 2, 3],
      limit: 5
    });
    expect(doResults).toHaveLength(1);
    expect(doResults[0]?.chunkId).toBe("chk_do");

    // 2. NotebookDO throws / fails -> graceful fallback to D1
    const failingEnv = {
      NOTEBOOK_DO: {
        idFromName: () => ({ toString: () => "mock-do" }),
        get: () => ({
          fetch: async () => {
            throw new Error("DO network failure");
          }
        })
      }
    } as unknown as Env;

    const fallbackResults = await queryNotebookVectorSearch(failingEnv, ragRepo, testNotebookId, {
      queryVector: new Array(768).fill(0.01),
      limit: 2
    });
    expect(fallbackResults.length).toBeGreaterThan(0);

    // 3. Empty query / missing inputs in queryNotebookVectorSearch
    expect(
      await queryNotebookVectorSearch(undefined, ragRepo, testNotebookId, { limit: 5 })
    ).toEqual([]);

    // 4. Empty notebook with 0 vectors
    expect(
      await queryNotebookVectorSearch(undefined, ragRepo, "empty_notebook", {
        queryVector: [1, 2, 3]
      })
    ).toEqual([]);

    // 5. Test with quantized int8 array option in queryNotebookVectorSearch
    const qRes = await queryNotebookVectorSearch(undefined, ragRepo, testNotebookId, {
      quantized: Array.from(new Int8Array(768).fill(10)),
      scale: 0.01,
      limit: 2
    });
    expect(qRes).toHaveLength(2);

    // 6. Test notebook share authorization branch (user is in notebook_shares)
    await coreRepo.createUser({
      id: "shared_user",
      email: "shared@example.com",
      display_name: "Shared User",
      locale: "de",
      is_guest: 0,
      created_at: Date.now(),
      expires_at: null,
      deleted_at: null
    });
    await mockD1.adapter.run(
      "INSERT INTO notebook_shares (notebook_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      [testNotebookId, "shared_user", "viewer", Date.now()]
    );
    const sharedApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    sharedApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: "shared_user" });
      await next();
    });
    registerSearchRoutes(sharedApp, { ragRepo, coreRepo });
    const sharedRes = await sharedApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Systemarchitektur" })
      }
    );
    expect(sharedRes.status).toBe(200);

    // 7. Test without coreRepo passed
    const noCoreApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    noCoreApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerSearchRoutes(noCoreApp, { ragRepo });
    const noCoreRes = await noCoreApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Cloudflare D1", mode: "fts" })
      }
    );
    expect(noCoreRes.status).toBe(200);

    // 8. FTS error / table missing safe fallback
    const faultyRagRepo = {
      ...ragRepo,
      searchChunksFts: async () => {
        throw new Error("FTS MATCH error");
      }
    } as unknown as RagRepository;
    const faultyApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    faultyApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerSearchRoutes(faultyApp, { ragRepo: faultyRagRepo });
    const faultyRes = await faultyApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Trigger error", mode: "fts" })
      }
    );
    expect(faultyRes.status).toBe(200);
    const faultyBody = (await faultyRes.json()) as SearchResponse;
    expect(faultyBody.results).toEqual([]);
    // 9. DO returns 500 error status (res.ok is false) and DO returns non-array results
    const errorDoEnv = {
      NOTEBOOK_DO: {
        idFromName: () => ({ toString: () => "mock-do" }),
        get: () => ({
          fetch: async () => new Response("Internal Server Error", { status: 500 })
        })
      }
    } as unknown as Env;
    expect(
      await queryNotebookVectorSearch(errorDoEnv, ragRepo, testNotebookId, {
        queryVector: new Array(768).fill(0.01),
        limit: 1
      })
    ).toHaveLength(1);

    const nonArrayDoEnv = {
      NOTEBOOK_DO: {
        idFromName: () => ({ toString: () => "mock-do" }),
        get: () => ({
          fetch: async () =>
            new Response(JSON.stringify({ results: "not-an-array" }), {
              status: 200,
              headers: { "content-type": "application/json" }
            })
        })
      }
    } as unknown as Env;
    expect(
      await queryNotebookVectorSearch(nonArrayDoEnv, ragRepo, testNotebookId, {
        queryVector: new Array(768).fill(0.01),
        limit: 1
      })
    ).toEqual([]);

    // 10. Pass vector as ArrayBuffer rather than Uint8Array to cover cv.vector instanceof check
    const abRagRepo = {
      ...ragRepo,
      getChunkVectorsByNotebook: async (nbId: string) => {
        const rows = await ragRepo.getChunkVectorsByNotebook(nbId);
        return rows.map((r) => ({
          ...r,
          vector: r.vector.buffer.slice(
            r.vector.byteOffset,
            r.vector.byteOffset + r.vector.byteLength
          )
        }));
      }
    } as unknown as RagRepository;
    const abResults = await queryNotebookVectorSearch(undefined, abRagRepo, testNotebookId, {
      queryVector: new Array(768).fill(0.01),
      limit: 1
    });
    expect(abResults).toHaveLength(1);

    // 11. Hybrid search where one item is only in vector and not in FTS (tests r.item.kind branch and missingIds fetch)
    // and hybrid search where a chunk has empty string title (tests "Quelle" fallback)
    // Also insert a chunk without a vector row (chk_no_vec)
    // to test null vectorRank and null vectorScore in hybrid RRF results
    await ragRepo.insertChunks([
      {
        id: "chk_no_vec",
        source_id: testSourceB,
        notebook_id: testNotebookId,
        chunk_index: 2,
        page_number: 99,
        start_offset: 0,
        end_offset: 100,
        text: "Exklusiver Alleiniger Treffer ohne Vektoren.",
        token_count: 10,
        created_at: Date.now()
      }
    ]);

    const edgeVec = new Array(768).fill(0.01);
    edgeVec[1] = 0.99;
    await mockD1.adapter.run("UPDATE sources SET title = '' WHERE id = ?", [testSourceA]);
    const hybridDiffRes = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "Alleiniger",
          queryVector: edgeVec,
          mode: "hybrid",
          limit: 10
        })
      }
    );
    expect(hybridDiffRes.status).toBe(200);
    const hybridDiffBody = (await hybridDiffRes.json()) as SearchResponse;
    expect(hybridDiffBody.results.some((r) => r.sourceTitle === "Quelle")).toBe(true);
    const ftsOnlyMatch = hybridDiffBody.results.find((r) => r.chunkId === "chk_no_vec");
    expect(ftsOnlyMatch).toBeDefined();
    expect(ftsOnlyMatch?.vectorRank).toBeNull();
    expect(ftsOnlyMatch?.vectorScore).toBeNull();

    // 12. Pure FTS search where source_title is empty (tests "Quelle" fallback in FTS mode)
    const ftsNullTitleRes = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "Art. 50 AI Act",
          mode: "fts",
          limit: 5
        })
      }
    );
    expect(ftsNullTitleRes.status).toBe(200);
    const ftsNullBody = (await ftsNullTitleRes.json()) as SearchResponse;
    expect(ftsNullBody.results[0]?.sourceTitle).toBe("Quelle");

    // 13. Pure vector search where source_title is empty (tests "Quelle" fallback in Vector mode)
    const vecNullTitleRes = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "pure-vec-no-fts-match-xyz",
          queryVector: edgeVec,
          mode: "vector",
          limit: 2
        })
      }
    );
    expect(vecNullTitleRes.status).toBe(200);
    const vecNullBody = (await vecNullTitleRes.json()) as SearchResponse;
    expect(vecNullBody.results[0]?.sourceTitle).toBe("Quelle");

    // 14. Query with non-matching special characters causing matchQuery to be empty
    const emptyMatchRes = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "??? !!! @@@ ***",
          mode: "fts",
          limit: 5
        })
      }
    );
    expect(emptyMatchRes.status).toBe(200);
    const emptyMatchBody = (await emptyMatchRes.json()) as SearchResponse;
    expect(emptyMatchBody.results).toEqual([]);

    // 15. Test missing chunk in getChunksByIds during hybrid and vector search
    // (covers if (!chunkData) continue in lines 321 and 350)
    const ghostChunkRagRepo = Object.assign(
      Object.create(Object.getPrototypeOf(ragRepo)),
      ragRepo,
      {
        getChunksByIds: async () => []
      }
    );
    const ghostApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    ghostApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerSearchRoutes(ghostApp, { ragRepo: ghostChunkRagRepo });

    // Ghost in vector-only
    const ghostVecRes = await ghostApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "ghost-vector-only",
          queryVector: edgeVec,
          mode: "vector",
          limit: 2
        })
      }
    );
    expect(ghostVecRes.status).toBe(200);
    const ghostVecBody = (await ghostVecRes.json()) as SearchResponse;
    expect(ghostVecBody.results).toEqual([]);

    // Ghost in hybrid
    const ghostHybridRes = await ghostApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "RelationFlow",
          queryVector: edgeVec,
          mode: "hybrid",
          limit: 10
        })
      }
    );
    expect(ghostHybridRes.status).toBe(200);
  });
});
