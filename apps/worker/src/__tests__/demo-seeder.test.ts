/**
 * Unit & Integration Tests for Demo Datasets, Seeder & Demo Gemini Key Guard.
 * Implements Issue #21 and Sub-Issues #107, #108, #109.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CLOUDFLARE_ARCH_DEMO_NOTEBOOK,
  CLOUDFLARE_ARCH_NOTEBOOK_ID,
  RELATIONFLOW_DEMO_NOTEBOOK,
  RELATIONFLOW_NOTEBOOK_ID,
  cosineSimilarityFloat32,
  generateDeterministicEmbedding
} from "@notebook-lm/shared";
import { type Context, Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import {
  DEMO_DISCLAIMER_TEXT,
  DEMO_HEADER_DISCLAIMER_KEY,
  DEMO_RATE_LIMIT_PER_DAY,
  type DemoRateLimitResult,
  attachDemoHeaders,
  checkDemoKeyRateLimit,
  resolveDemoGeminiKey
} from "../demo-key-guard.js";
import { registerDemoRoutes } from "../demo-routes.js";
import { DEMO_WORKSPACE_ID, seedDemoNotebooks } from "../demo-seeder.js";
import { RagRepository } from "../rag-repository.js";
import { clearRateLimitMemory } from "../rate-limiter.js";

function createFullSqliteAdapter(): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  const m1Path = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
  const m2Path = resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql");

  db.exec(readFileSync(m1Path, "utf-8"));
  db.exec(readFileSync(m2Path, "utf-8"));

  const adapter: DatabaseAdapter = {
    async exec(sqlStr: string): Promise<void> {
      db.exec(sqlStr);
    },
    async query<T>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(sqlStr);
      return stmt.all(...(params as (string | number | bigint | null | Uint8Array)[])) as T[];
    },
    async queryOne<T>(sqlStr: string, params: unknown[] = []): Promise<T | null> {
      const stmt = db.prepare(sqlStr);
      const row = stmt.get(...(params as (string | number | bigint | null | Uint8Array)[]));
      return (row as T) ?? null;
    },
    async run(sqlStr: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = db.prepare(sqlStr);
      const info = stmt.run(...(params as (string | number | bigint | null | Uint8Array)[]));
      return { changes: Number(info.changes) };
    }
  };

  return { adapter, close: () => db.close() };
}

describe("Demo Dataset: RelationFlow & KI im Mittelstand (Sub-Issue #107)", () => {
  it("defines comprehensive sources, pre-chunked segments, and valid chunk character ranges", () => {
    expect(RELATIONFLOW_DEMO_NOTEBOOK.id).toBe(RELATIONFLOW_NOTEBOOK_ID);
    expect(RELATIONFLOW_DEMO_NOTEBOOK.sources.length).toBe(4);

    for (const source of RELATIONFLOW_DEMO_NOTEBOOK.sources) {
      expect(source.chunks.length).toBeGreaterThanOrEqual(2);
      for (const chunk of source.chunks) {
        expect(chunk.text.length).toBeGreaterThan(50);
        expect(chunk.tokenCount).toBeGreaterThan(10);
        if (chunk.startOffset != null && chunk.endOffset != null) {
          expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
        }
      }
    }
  });

  it("verifies that all citations in the chat reference existing chunks and contain accurate quotes", () => {
    const chunkMap = new Map<string, string>();
    for (const source of RELATIONFLOW_DEMO_NOTEBOOK.sources) {
      for (const chk of source.chunks) {
        chunkMap.set(chk.id, chk.text);
      }
    }

    expect(RELATIONFLOW_DEMO_NOTEBOOK.chats.length).toBeGreaterThan(0);
    for (const chat of RELATIONFLOW_DEMO_NOTEBOOK.chats) {
      for (const msg of chat.messages) {
        if (msg.citations && msg.citations.length > 0) {
          for (const cite of msg.citations) {
            const chunkText = chunkMap.get(cite.chunkId);
            expect(chunkText, `Missing chunkId ${cite.chunkId}`).toBeDefined();
            if (cite.quote) {
              expect(
                chunkText?.includes(cite.quote.slice(0, 30)),
                `Quote '${cite.quote}' not found in chunk ${cite.chunkId}`
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it("includes all 6 studio artifacts with ready status and structured JSON", () => {
    const expectedTypes = ["audio", "video", "mindmap", "flashcards", "quiz", "briefing"];
    const foundTypes = RELATIONFLOW_DEMO_NOTEBOOK.artifacts.map((a) => a.type);
    for (const type of expectedTypes) {
      expect(foundTypes).toContain(type);
    }

    for (const artifact of RELATIONFLOW_DEMO_NOTEBOOK.artifacts) {
      expect(artifact.status).toBe("ready");
      const parsed = JSON.parse(artifact.contentJson) as Record<string, unknown>;
      expect(typeof parsed).toBe("object");
    }

    expect(RELATIONFLOW_DEMO_NOTEBOOK.notes.length).toBeGreaterThan(0);
  });
});

describe("Demo Dataset: Cloudflare Edge Architecture (Sub-Issue #108)", () => {
  it("defines 4 technical architecture sources with valid offsets", () => {
    expect(CLOUDFLARE_ARCH_DEMO_NOTEBOOK.id).toBe(CLOUDFLARE_ARCH_NOTEBOOK_ID);
    expect(CLOUDFLARE_ARCH_DEMO_NOTEBOOK.sources.length).toBe(4);

    for (const source of CLOUDFLARE_ARCH_DEMO_NOTEBOOK.sources) {
      expect(source.chunks.length).toBeGreaterThanOrEqual(2);
      for (const chunk of source.chunks) {
        expect(chunk.text.length).toBeGreaterThan(40);
      }
    }
  });

  it("verifies all citations reference valid chunks in the cloudflare demo notebook", () => {
    const chunkMap = new Map<string, string>();
    for (const source of CLOUDFLARE_ARCH_DEMO_NOTEBOOK.sources) {
      for (const chk of source.chunks) {
        chunkMap.set(chk.id, chk.text);
      }
    }

    for (const chat of CLOUDFLARE_ARCH_DEMO_NOTEBOOK.chats) {
      for (const msg of chat.messages) {
        if (msg.citations) {
          for (const cite of msg.citations) {
            expect(chunkMap.has(cite.chunkId)).toBe(true);
          }
        }
      }
    }
  });

  it("contains all 6 studio artifacts for the technical architecture notebook", () => {
    const types = CLOUDFLARE_ARCH_DEMO_NOTEBOOK.artifacts.map((a) => a.type);
    expect(types).toContain("audio");
    expect(types).toContain("video");
    expect(types).toContain("mindmap");
    expect(types).toContain("flashcards");
    expect(types).toContain("quiz");
    expect(types).toContain("briefing");
  });
});

describe("Deterministic Vector Generator & Quantization", () => {
  it("generates deterministic 768-dimensional normalized unit vectors with semantic clustering", () => {
    const vec1 = generateDeterministicEmbedding("Datenschutz und DSGVO im Betrieb");
    const vec2 = generateDeterministicEmbedding("Datenschutz und DSGVO im Betrieb");
    const vecDifferent = generateDeterministicEmbedding("Quantenphysik und schwarze Löcher");

    expect(vec1.length).toBe(768);
    expect(vec2.length).toBe(768);
    expect(Array.from(vec1)).toEqual(Array.from(vec2));

    const simIdentical = cosineSimilarityFloat32(vec1, vec2);
    expect(simIdentical).toBeCloseTo(1.0, 4);

    const simDifferent = cosineSimilarityFloat32(vec1, vecDifferent);
    expect(simDifferent).toBeLessThan(simIdentical);

    // Empty text fallback
    const vecEmpty = generateDeterministicEmbedding("");
    expect(vecEmpty.length).toBe(768);
  });
});

describe("Idempotent D1 Demo Seeder & Hybrid Search Verification (Sub-Issue #109)", () => {
  it("idempotently seeds notebooks, chunks, int8 vectors, and enables hybrid search", async () => {
    const { adapter, close } = createFullSqliteAdapter();
    const _coreRepo = new CoreRepository(adapter);
    const ragRepo = new RagRepository(adapter);

    // First seed with targetUserId and grantAccessRole undefined (defaults to "viewer")
    const metrics1 = await seedDemoNotebooks(adapter, {
      targetUserId: "usr_guest_alice"
    });

    expect(metrics1.seededWorkspaces).toBe(1);
    expect(metrics1.seededNotebooks).toBe(2);
    expect(metrics1.seededSources).toBe(8);
    expect(metrics1.seededChunks).toBeGreaterThan(15);
    expect(metrics1.seededVectors).toBe(metrics1.seededChunks);
    expect(metrics1.seededChats).toBe(2);
    expect(metrics1.seededArtifacts).toBe(12);

    // Second run must be completely idempotent (0 newly seeded items), testing explicit role
    const metrics2 = await seedDemoNotebooks(adapter, {
      targetUserId: "usr_guest_alice",
      grantAccessRole: "editor"
    });

    expect(metrics2.seededWorkspaces).toBe(0);
    expect(metrics2.seededNotebooks).toBe(0);
    expect(metrics2.seededSources).toBe(0);
    expect(metrics2.seededChunks).toBe(0);
    expect(metrics2.seededVectors).toBe(0);
    expect(metrics2.seededArtifacts).toBe(0);

    // Verify hybrid search works over seeded demo data
    const ftsResults = await ragRepo.searchChunksFts(RELATIONFLOW_NOTEBOOK_ID, "DSGVO");
    expect(ftsResults.length).toBeGreaterThan(0);
    expect(ftsResults[0]?.text).toContain("DSGVO");

    // Verify vectors were stored and retrieved
    const vectors = await ragRepo.getChunkVectorsByNotebook(RELATIONFLOW_NOTEBOOK_ID);
    expect(vectors.length).toBeGreaterThan(0);
    expect(vectors[0]?.dimensions).toBe(768);
    expect(vectors[0]?.vector).toBeInstanceOf(Uint8Array);

    close();
  });

  it("handles seeder gracefully when only core migrations are applied", async () => {
    const db = new DatabaseSync(":memory:");
    const m1Path = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
    db.exec(readFileSync(m1Path, "utf-8"));

    const adapter: DatabaseAdapter = {
      async exec(sqlStr: string): Promise<void> {
        db.exec(sqlStr);
      },
      async query<T>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
        const stmt = db.prepare(sqlStr);
        return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
      },
      async queryOne<T>(sqlStr: string, params: unknown[] = []): Promise<T | null> {
        const stmt = db.prepare(sqlStr);
        const row = stmt.get(...(params as (string | number | bigint | null)[]));
        return (row as T) ?? null;
      },
      async run(sqlStr: string, params: unknown[] = []): Promise<{ changes: number }> {
        const stmt = db.prepare(sqlStr);
        const info = stmt.run(...(params as (string | number | bigint | null)[]));
        return { changes: Number(info.changes) };
      }
    };

    const metrics = await seedDemoNotebooks(adapter);
    expect(metrics.seededSources).toBe(0);
    expect(metrics.seededChunks).toBe(0);
    db.close();
  });
});

describe("Demo Gemini Key Guard & Rate Limiter (Sub-Issue #109)", () => {
  it("resolves demo key ONLY for demo notebooks when no user key is present", () => {
    // 1. Demo notebook without user key -> uses demo key with disclaimer
    const resDemo = resolveDemoGeminiKey({
      notebookId: RELATIONFLOW_NOTEBOOK_ID,
      hasUserKey: false,
      demoApiKey: "AIzaSyTestDemoKey12345"
    });
    expect(resDemo.useDemoKey).toBe(true);
    expect(resDemo.apiKey).toBe("AIzaSyTestDemoKey12345");
    expect(resDemo.warningHeader).toBe(DEMO_DISCLAIMER_TEXT);

    // 2. Demo notebook with user BYOK key -> does NOT use demo key
    const resWithUserKey = resolveDemoGeminiKey({
      notebookId: RELATIONFLOW_NOTEBOOK_ID,
      hasUserKey: true,
      demoApiKey: "AIzaSyTestDemoKey12345"
    });
    expect(resWithUserKey.useDemoKey).toBe(false);
    expect(resWithUserKey.apiKey).toBeNull();

    // 3. Private notebook without user key -> strictly forbids demo key!
    const resPrivate = resolveDemoGeminiKey({
      notebookId: "nb_private_user_secrets",
      hasUserKey: false,
      demoApiKey: "AIzaSyTestDemoKey12345"
    });
    expect(resPrivate.useDemoKey).toBe(false);
    expect(resPrivate.apiKey).toBeNull();
    expect(resPrivate.isDemoNotebook).toBe(false);

    // 4. Missing demo key in env
    const resMissing = resolveDemoGeminiKey({
      notebookId: RELATIONFLOW_NOTEBOOK_ID,
      hasUserKey: false,
      demoApiKey: undefined
    });
    expect(resMissing.useDemoKey).toBe(false);
  });

  it("enforces dual-window rate limit (5 req/min and 20 req/day)", async () => {
    clearRateLimitMemory();
    const app = new Hono();

    let checkResult: DemoRateLimitResult | undefined;
    app.get("/test-limit", async (c) => {
      checkResult = await checkDemoKeyRateLimit(c);
      attachDemoHeaders(c, checkResult);
      return c.json({ allowed: checkResult.allowed });
    });

    // Make 5 requests within window -> allowed
    for (let i = 0; i < 5; i++) {
      const res = await app.request("https://test.local/test-limit", {
        headers: { "cf-connecting-ip": "198.51.100.1" }
      });
      expect(res.status).toBe(200);
      expect(checkResult?.allowed).toBe(true);
      expect(res.headers.get(DEMO_HEADER_DISCLAIMER_KEY)).toBe(DEMO_DISCLAIMER_TEXT);
    }

    // 6th request within minute -> blocked by minute limit
    const resBlocked = await app.request("https://test.local/test-limit", {
      headers: { "cf-connecting-ip": "198.51.100.1" }
    });
    expect(resBlocked.status).toBe(200);
    expect(checkResult?.allowed).toBe(false);
    expect(checkResult?.reason).toBe("minute");

    // Test daily limit branch
    clearRateLimitMemory();
    const dayCheckMock = {
      allowed: false,
      limit: DEMO_RATE_LIMIT_PER_DAY.limit,
      remaining: 0,
      retryAfterSeconds: 3600,
      resetAt: Date.now() + 3600000,
      reason: "day" as const
    };
    const cMock = {
      req: {
        header: (_name: string) => "198.51.100.2"
      },
      get: (_key: string) => undefined,
      header: (_name: string, _val: string) => {}
    } as unknown as Context;
    attachDemoHeaders(cMock, dayCheckMock);
    attachDemoHeaders(cMock); // Test branch without rateLimit param

    // Call checkDemoKeyRateLimit when day limit exceeded
    // By passing a custom mock db returning count > 20 for day window
    const mockDbDayExceeded = {
      prepare: () => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            const key = String(params[0]);
            if (key.includes("min")) return { count: 1, window_start: 0 };
            return { count: 99, window_start: 0 };
          }
        })
      })
    } as unknown as D1Database;

    clearRateLimitMemory();
    const dayResExceeded = await checkDemoKeyRateLimit(cMock, mockDbDayExceeded);
    expect(dayResExceeded.allowed).toBe(false);
    expect(dayResExceeded.reason).toBe("day");

    clearRateLimitMemory();
  });
});

describe("Demo Routes API (/api/v1/demo/*)", () => {
  it("serves GET /api/v1/demo/info with disclaimer and notebook catalog", async () => {
    const { adapter, close } = createFullSqliteAdapter();
    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerDemoRoutes(app, { db: adapter, demoGeminiKey: "AIzaDemoKey12345" });

    const res = await app.request("https://test.local/api/v1/demo/info");
    expect(res.status).toBe(200);
    expect(res.headers.get(DEMO_HEADER_DISCLAIMER_KEY)).toBe(DEMO_DISCLAIMER_TEXT);

    const body = (await res.json()) as {
      workspaceId: string;
      hasDemoKey: boolean;
      notebooks: Array<{ id: string; title: string }>;
    };

    expect(body.workspaceId).toBe(DEMO_WORKSPACE_ID);
    expect(body.hasDemoKey).toBe(true);
    expect(body.notebooks.length).toBe(2);

    close();
  });

  it("serves POST /api/v1/demo/seed to trigger idempotent seeding", async () => {
    const { adapter, close } = createFullSqliteAdapter();
    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();

    // Mock session user
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "usr_alice" });
      await next();
    });

    registerDemoRoutes(app, { db: adapter });

    const seedRes = await app.request("https://test.local/api/v1/demo/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "editor" })
    });

    expect(seedRes.status).toBe(200);
    expect(seedRes.headers.get(DEMO_HEADER_DISCLAIMER_KEY)).toBe(DEMO_DISCLAIMER_TEXT);
    const body = (await seedRes.json()) as {
      success: boolean;
      metrics: { seededNotebooks: number };
    };
    expect(body.success).toBe(true);
    expect(body.metrics.seededNotebooks).toBe(2);

    // Second run
    const seedRes2 = await app.request("https://test.local/api/v1/demo/seed", {
      method: "POST"
    });
    expect(seedRes2.status).toBe(200);
    const body2 = (await seedRes2.json()) as {
      success: boolean;
      metrics: { seededNotebooks: number };
    };
    expect(body2.metrics.seededNotebooks).toBe(0);

    // Test with pre-existing user in targetUserId
    await adapter.run(
      "INSERT OR IGNORE INTO users (id, email, display_name, locale, is_guest, created_at, expires_at, deleted_at) VALUES ('usr_existing_bob', 'bob@test.local', 'Bob', 'de', 0, 1000, NULL, NULL)"
    );
    await seedDemoNotebooks(adapter, {
      targetUserId: "usr_existing_bob",
      grantAccessRole: "editor"
    });

    close();
  });

  it("returns 500 when database adapter is missing in POST /api/v1/demo/seed", async () => {
    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerDemoRoutes(app, { db: undefined });

    const res = await app.request("https://test.local/api/v1/demo/seed", {
      method: "POST"
    });
    expect(res.status).toBe(500);
  });
});
