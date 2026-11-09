import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { RagRepository } from "../rag-repository.js";
import { registerUrlImportRoutes } from "../url-importer.js";

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
        async first<T = unknown>(): Promise<T | null> {
          return adapter.queryOne<T>(query, boundParams);
        },
        async all<T = unknown>(): Promise<{ results: T[] }> {
          const results = await adapter.query<T>(query, boundParams);
          return { results };
        },
        async run(): Promise<{ meta: { changes: number } }> {
          const res = await adapter.run(query, boundParams);
          return { meta: { changes: res.changes } };
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

/**
 * Creates in-memory Mock R2 Bucket.
 */
function createMockR2(): R2Bucket {
  const store = new Map<
    string,
    {
      data: Uint8Array;
      httpMetadata?: Record<string, string> | undefined;
      customMetadata?: Record<string, string> | undefined;
    }
  >();

  return {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | ReadableStream | string | null,
      options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }
    ): Promise<R2Object> {
      let data: Uint8Array;
      if (typeof value === "string") {
        data = new TextEncoder().encode(value);
      } else if (value instanceof Uint8Array) {
        data = value;
      } else if (value instanceof ArrayBuffer) {
        data = new Uint8Array(value);
      } else {
        data = new Uint8Array();
      }

      store.set(key, {
        data,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata
      });

      return {
        key,
        size: data.length,
        etag: `mock-etag-${data.length}`,
        uploaded: new Date(),
        version: "1",
        httpMetadata: options?.httpMetadata
      } as unknown as R2Object;
    },

    async get(key: string): Promise<R2ObjectBody | null> {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.data.length,
        etag: `mock-etag-${entry.data.length}`,
        uploaded: new Date(),
        version: "1",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(entry.data);
            controller.close();
          }
        }),
        arrayBuffer: async () => entry.data.buffer
      } as unknown as R2ObjectBody;
    }
  } as unknown as R2Bucket;
}

describe("URL Import Route - POST /api/v1/notebooks/:id/sources/url", () => {
  let mockD1: ReturnType<typeof createMockD1>;
  let mockR2: R2Bucket;
  let coreRepo: CoreRepository;
  let ragRepo: RagRepository;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  const testUserId = "usr_url_tester";
  const testWorkspaceId = "ws_url_tester";
  const testNotebookId = "nb_url_tester";

  beforeEach(async () => {
    mockD1 = createMockD1();
    mockR2 = createMockR2();
    coreRepo = new CoreRepository(mockD1.adapter);
    ragRepo = new RagRepository(mockD1.adapter);

    // Seed test user, workspace and notebook
    await coreRepo.createUser({
      id: testUserId,
      email: "tester@example.com",
      display_name: "Tester",
      locale: "de",
      is_guest: 0,
      created_at: Date.now(),
      expires_at: null,
      deleted_at: null
    });

    await coreRepo.createWorkspace({
      id: testWorkspaceId,
      name: "Default Workspace",
      owner_id: testUserId,
      created_at: Date.now()
    });

    await coreRepo.createNotebook({
      id: testNotebookId,
      workspace_id: testWorkspaceId,
      title: "Test Notebook",
      emoji: "notebook",
      created_by: testUserId,
      created_at: Date.now(),
      updated_at: Date.now(),
      expires_at: null
    });

    app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();

    // Mock env and sessionUser middleware
    app.use("*", async (c, next) => {
      c.env = {
        DB: mockD1.db,
        MEDIA: mockR2,
        APP_PROFILE: "demo"
      } as unknown as Env;
      c.set("sessionUser", { id: testUserId });
      await next();
    });
  });

  it("returns 401 when sessionUser is missing", async () => {
    const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    unauthApp.use("*", async (c, next) => {
      c.env = { DB: mockD1.db, MEDIA: mockR2 } as unknown as Env;
      await next();
    });
    registerUrlImportRoutes(unauthApp, { ragRepo });

    const res = await unauthApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" })
      }
    );

    expect(res.status).toBe(401);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 when body is invalid JSON", async () => {
    registerUrlImportRoutes(app, { ragRepo });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "invalid-json{"
      }
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("INVALID_JSON");
  });

  it("returns 400 when URL validation fails", async () => {
    registerUrlImportRoutes(app, { ragRepo });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "not-a-valid-url" })
      }
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; errors: Array<{ field: string }> };
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.errors[0]?.field).toBe("url");
  });

  it("blocks SSRF targets and returns 403", async () => {
    registerUrlImportRoutes(app, { ragRepo });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1:8080/admin" })
      }
    );

    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("SSRF_DETECTED");
  });

  it("handles oversized content and returns 413", async () => {
    const mockFetch = async () =>
      new Response("large", {
        status: 200,
        headers: { "content-length": "20971520" }
      });

    registerUrlImportRoutes(app, {
      ragRepo,
      fetchOptions: {
        customFetch: mockFetch as typeof fetch,
        maxByteSize: 10 * 1024 * 1024
      }
    });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/oversized" })
      }
    );

    expect(res.status).toBe(413);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("handles empty extracted content and returns 422", async () => {
    const mockFetch = async () =>
      new Response("<html><body><script>alert(1)</script></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });

    registerUrlImportRoutes(app, {
      ragRepo,
      fetchOptions: { customFetch: mockFetch as typeof fetch }
    });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/empty" })
      }
    );

    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("EMPTY_CONTENT");
  });

  it("handles network failure / bad gateway and returns 502", async () => {
    const mockFetch = async () => {
      throw new Error("DNS lookup failed");
    };

    registerUrlImportRoutes(app, {
      ragRepo,
      fetchOptions: { customFetch: mockFetch as typeof fetch }
    });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/fail" })
      }
    );

    expect(res.status).toBe(502);
    const json = (await res.json()) as { code: string; detail: string };
    expect(json.code).toBe("FETCH_FAILED");
    expect(json.detail).toContain("DNS lookup failed");
  });

  it("successfully imports a standard web article, cleans HTML, creates chunks and stores in D1/R2", async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Article Title</title>
        </head>
        <body>
          <header><nav><a href="/">Home</a></nav></header>
          <div class="ad-container">Buy now</div>
          <article>
            <h1>Main Headline</h1>
            <p>This is the first paragraph of meaningful article content for the RAG index.</p>
            <p>This is the second paragraph providing more context and detailed analysis.</p>
          </article>
          <footer>Footer text</footer>
        </body>
      </html>
    `;

    const mockFetch = async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });

    registerUrlImportRoutes(app, {
      ragRepo,
      fetchOptions: { customFetch: mockFetch as typeof fetch }
    });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/good-article" })
      }
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      sourceId: string;
      notebookId: string;
      title: string;
      sourceType: string;
      byteSize: number;
      chunksCount: number;
      status: string;
    };

    expect(json.status).toBe("ready");
    expect(json.title).toBe("Test Article Title");
    expect(json.sourceType).toBe("url");
    expect(json.chunksCount).toBeGreaterThan(0);

    // Verify source persisted in D1
    const sourceInDb = await ragRepo.getSourceById(json.sourceId);
    expect(sourceInDb).not.toBeNull();
    expect(sourceInDb?.title).toBe("Test Article Title");
    expect(sourceInDb?.source_type).toBe("url");
    expect(sourceInDb?.status).toBe("ready");

    // Verify chunks persisted in D1
    const chunksInDb = await ragRepo.getChunksBySource(json.sourceId);
    expect(chunksInDb.length).toBe(json.chunksCount);
    expect(chunksInDb[0]?.text).toContain("Main Headline");

    // Verify file saved in R2
    const fileInR2 = await mockR2.get(sourceInDb?.r2_key ?? "");
    expect(fileInR2).not.toBeNull();
  });

  it("successfully detects and imports a public Google Doc via exportUrl", async () => {
    const docId = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
    const googleDocUrl = `https://docs.google.com/document/d/${docId}/edit`;
    const expectedExportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
    const docText = "This is a public Google Docs plain text export with important notes.";

    let requestedUrl = "";
    const mockFetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(docText, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    };

    registerUrlImportRoutes(app, {
      ragRepo,
      fetchOptions: { customFetch: mockFetch as typeof fetch }
    });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: googleDocUrl })
      }
    );

    expect(res.status).toBe(201);
    expect(requestedUrl).toBe(expectedExportUrl);

    const json = (await res.json()) as {
      sourceId: string;
      title: string;
      sourceType: string;
      chunksCount: number;
    };

    expect(json.sourceType).toBe("gdoc");
    expect(json.title).toContain("Google Doc");

    const sourceInDb = await ragRepo.getSourceById(json.sourceId);
    expect(sourceInDb?.source_type).toBe("gdoc");
  });

  it("handles when MEDIA R2 binding is absent", async () => {
    const noMediaApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    noMediaApp.use("*", async (c, next) => {
      c.env = {
        DB: mockD1.db,
        APP_PROFILE: "demo"
      } as unknown as Env;
      c.set("sessionUser", { id: testUserId });
      await next();
    });

    const mockFetch = async () =>
      new Response("<h1>No R2 Content</h1><p>Body</p>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });

    registerUrlImportRoutes(noMediaApp, {
      ragRepo,
      fetchOptions: { customFetch: mockFetch as typeof fetch }
    });

    const res = await noMediaApp.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/no-r2" })
      }
    );

    expect(res.status).toBe(201);
  });

  it("enforces user source quota and returns 403 when exceeded", async () => {
    // Fill quota to limit (15 sources in demo mode)
    const today = new Date().toISOString().slice(0, 10);
    await mockD1.db
      .prepare(
        "INSERT OR REPLACE INTO quotas (user_id, notebooks_count, sources_count, storage_bytes, llm_calls_day, quota_day) VALUES (?, 1, 15, 1000, 0, ?)"
      )
      .bind(testUserId, today)
      .run();

    const mockFetch = async () =>
      new Response("Content", {
        status: 200,
        headers: { "content-type": "text/plain" }
      });

    registerUrlImportRoutes(app, {
      ragRepo,
      fetchOptions: { customFetch: mockFetch as typeof fetch }
    });

    const res = await app.request(
      `http://localhost/api/v1/notebooks/${testNotebookId}/sources/url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/quota-test" })
      }
    );

    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("QUOTA_MAX_SOURCES_PER_NOTEBOOK_EXCEEDED");
  });
});
