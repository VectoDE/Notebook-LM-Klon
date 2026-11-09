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

/**
 * NotebookDO manages real-time notebook collaboration (WebSockets),
 * in-memory int8 vector caching, and low-latency dot-product scoring.
 */
export class NotebookDO {
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
      "CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
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
