import { createProblemDetails } from "@notebook-lm/shared";

export interface DurableObjectSqlCursor {
  toArray(): Record<string, unknown>[];
}

export interface DurableObjectSqlStorage {
  exec(query: string, ...bindings: unknown[]): DurableObjectSqlCursor;
}

export interface SqliteDurableObjectState {
  readonly id: { toString(): string };
  readonly storage: {
    readonly sql: DurableObjectSqlStorage;
  };
}

export interface DurableObjectHealthReport {
  readonly ok: boolean;
  readonly className: "NotebookDO" | "JobDO";
  readonly objectId: string;
  readonly sqliteReady: boolean;
}

export interface CachedVectorEntry {
  readonly chunkId: string;
  readonly sourceId?: string | undefined;
  readonly quantized: Int8Array;
  readonly scale: number;
}

/**
 * NotebookDO manages real-time notebook collaboration (WebSockets),
 * in-memory int8 vector caching, and low-latency dot-product scoring.
 */
export class NotebookDO {
  protected readonly ctx: SqliteDurableObjectState;
  protected readonly env: Env;
  private initialized = false;
  private vectorCache: Map<string, CachedVectorEntry> = new Map();

  constructor(ctx: SqliteDurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  private ensureSchema(): void {
    if (this.initialized) {
      return;
    }
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS do_vectors (
        chunk_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        scale REAL NOT NULL,
        vector BLOB NOT NULL
      );`
    );
    this.initialized = true;
  }

  public ping(): DurableObjectHealthReport {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec("SELECT 1 AS ok").toArray();
    return {
      ok: rows.length === 1,
      className: "NotebookDO",
      objectId: this.ctx.id.toString(),
      sqliteReady: rows.length === 1
    };
  }

  /**
   * Invalidate or update vector cache entries.
   */
  public invalidateVectorCache(sourceId?: string): void {
    if (sourceId) {
      for (const [chunkId, entry] of this.vectorCache.entries()) {
        if (entry.sourceId === sourceId) {
          this.vectorCache.delete(chunkId);
        }
      }
    } else {
      this.vectorCache.clear();
    }
  }

  /**
   * Put vectors directly into the DO memory / local cache.
   */
  public updateVectors(entries: CachedVectorEntry[]): void {
    for (const entry of entries) {
      this.vectorCache.set(entry.chunkId, entry);
    }
  }

  /**
   * Query vectors in memory for vector search.
   */
  public getCachedVectors(): CachedVectorEntry[] {
    return Array.from(this.vectorCache.values());
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const report = this.ping();
      return Response.json(report, {
        status: report.ok ? 200 : 503,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // POST /vectors/update: bulk update or add vectors to in-memory cache
    if (request.method === "POST" && url.pathname === "/vectors/update") {
      this.ensureSchema();
      try {
        const body = (await request.json()) as {
          vectors: Array<{
            chunkId: string;
            sourceId?: string;
            quantized: number[];
            scale: number;
          }>;
        };

        const vectorsList = body.vectors;
        const entries: CachedVectorEntry[] = vectorsList.map((v) => ({
          chunkId: v.chunkId,
          sourceId: v.sourceId,
          quantized: new Int8Array(v.quantized),
          scale: v.scale
        }));

        this.updateVectors(entries);

        return Response.json(
          { success: true, count: entries.length, totalCached: this.vectorCache.size },
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" }
          }
        );
      } catch {
        const problem = createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiges JSON beim Aktualisieren des Vektor-Caches.",
          instance: url.pathname,
          code: "INVALID_JSON"
        });
        return Response.json(problem, {
          status: 400,
          headers: { "content-type": "application/problem+json; charset=utf-8" }
        });
      }
    }

    // POST /vectors/invalidate: invalidate vector cache for a given source or whole notebook
    if (request.method === "POST" && url.pathname === "/vectors/invalidate") {
      this.ensureSchema();
      let sourceId: string | undefined;
      try {
        const body = (await request.json()) as { sourceId?: string };
        sourceId = body.sourceId;
      } catch {
        // Body optional
      }
      this.invalidateVectorCache(sourceId);
      return Response.json(
        { success: true, invalidatedSourceId: sourceId ?? null, remaining: this.vectorCache.size },
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }

    // GET /vectors: retrieve current in-memory cached vectors (for search or debugging)
    if (request.method === "GET" && url.pathname === "/vectors") {
      this.ensureSchema();
      const vectors = this.getCachedVectors().map((v) => ({
        chunkId: v.chunkId,
        sourceId: v.sourceId,
        scale: v.scale,
        length: v.quantized.length
      }));
      return Response.json(
        { vectors, count: vectors.length },
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }

    const problem = createProblemDetails({
      status: 404,
      title: "Not Found",
      detail: `NotebookDO route '${url.pathname}' not found.`,
      instance: url.pathname,
      code: "DO_ROUTE_NOT_FOUND"
    });
    return Response.json(problem, {
      status: 404,
      headers: { "content-type": "application/problem+json; charset=utf-8" }
    });
  }
}

/**
 * JobDO manages background studio synthesis jobs (Audio Overview, Video Overview,
 * Mindmap, Flashcards, Quiz, GDPR export) via SQLite queue and alarm() execution.
 */
export class JobDO {
  protected readonly ctx: SqliteDurableObjectState;
  protected readonly env: Env;
  private initialized = false;

  constructor(ctx: SqliteDurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  private ensureSchema(): void {
    if (this.initialized) {
      return;
    }
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS _job_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );
    this.initialized = true;
  }

  public ping(): DurableObjectHealthReport {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec("SELECT 1 AS ok").toArray();
    return {
      ok: rows.length === 1,
      className: "JobDO",
      objectId: this.ctx.id.toString(),
      sqliteReady: rows.length === 1
    };
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const report = this.ping();
      return Response.json(report, {
        status: report.ok ? 200 : 503,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const problem = createProblemDetails({
      status: 404,
      title: "Not Found",
      detail: `JobDO route '${url.pathname}' not found.`,
      instance: url.pathname,
      code: "DO_ROUTE_NOT_FOUND"
    });
    return Response.json(problem, {
      status: 404,
      headers: { "content-type": "application/problem+json; charset=utf-8" }
    });
  }
}
