import {
  type EnqueueJobBody,
  type JobBroadcastEvent,
  type JobFilterQuery,
  type JobRecord,
  createProblemDetails,
  dotProductInt8,
  quantizeFloat32ToInt8
} from "@notebook-lm/shared";
import {
  DocSyncError,
  diffFromState,
  fromBase64Url,
  mergeIntoState,
  toBase64Url
} from "./doc-sync.js";

export interface DurableObjectSqlCursor {
  toArray(): Record<string, unknown>[];
}

export interface DurableObjectSqlStorage {
  exec(query: string, ...bindings: unknown[]): DurableObjectSqlCursor;
}

export interface DurableObjectStorageWithAlarm {
  readonly sql: DurableObjectSqlStorage;
  getAlarm(options?: unknown): Promise<number | null>;
  setAlarm(scheduledTime: number | Date, options?: unknown): Promise<void>;
  deleteAlarm(options?: unknown): Promise<void>;
}

export interface SqliteDurableObjectState {
  readonly id: { toString(): string };
  readonly storage: DurableObjectStorageWithAlarm;
  acceptWebSocket(ws: unknown, tags?: string[]): void;
  getWebSockets(tag?: string): unknown[];
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
      );
       CREATE TABLE IF NOT EXISTS notebook_doc (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state BLOB NOT NULL,
        updated_at INTEGER NOT NULL
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
   * Lazily loads quantized vectors for this notebook from D1 into the DO in-memory cache
   * if the cache is currently empty.
   */
  public async ensureVectorsLoaded(): Promise<number> {
    if (this.vectorCache.size > 0) {
      return this.vectorCache.size;
    }

    if (!this.env.DB) {
      return 0;
    }

    const notebookId = this.ctx.id.toString();
    try {
      // Query chunk_vectors joined with chunks for source_id
      const rows = await this.env.DB.prepare(
        `SELECT cv.chunk_id, cv.scale, cv.vector, c.source_id
         FROM chunk_vectors cv
         LEFT JOIN chunks c ON c.id = cv.chunk_id
         WHERE cv.notebook_id = ?`
      )
        .bind(notebookId)
        .all<{
          chunk_id: string;
          scale: number;
          vector: ArrayBuffer | Uint8Array | number[];
          source_id: string | null;
        }>();

      const results = rows.results;
      for (const row of results) {
        let rawBytes: Uint8Array;
        if (row.vector instanceof Uint8Array) {
          rawBytes = row.vector;
        } else if (row.vector instanceof ArrayBuffer) {
          rawBytes = new Uint8Array(row.vector);
        } else if (Array.isArray(row.vector)) {
          rawBytes = new Uint8Array(row.vector);
        } else {
          continue;
        }

        const quantized = new Int8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);

        this.vectorCache.set(row.chunk_id, {
          chunkId: row.chunk_id,
          sourceId: row.source_id ?? undefined,
          quantized,
          scale: row.scale
        });
      }
    } catch {
      // Return currently loaded count if DB query fails
    }

    return this.vectorCache.size;
  }

  /**
   * Ultra-fast in-memory int8 vector similarity search (< 5 ms for 5,000 vectors).
   */
  public searchVectors(
    queryQuantized: Int8Array,
    queryScale: number,
    limit = 10,
    sourceIds?: string[]
  ): Array<{ chunkId: string; sourceId?: string | undefined; score: number }> {
    const allowedSources = sourceIds && sourceIds.length > 0 ? new Set(sourceIds) : null;
    const scored: Array<{ chunkId: string; sourceId?: string | undefined; score: number }> = [];

    for (const entry of this.vectorCache.values()) {
      if (allowedSources && (!entry.sourceId || !allowedSources.has(entry.sourceId))) {
        continue;
      }

      const score = dotProductInt8(queryQuantized, queryScale, entry.quantized, entry.scale);
      scored.push({
        chunkId: entry.chunkId,
        sourceId: entry.sourceId,
        score
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Query vectors in memory for vector search.
   */
  public getCachedVectors(): CachedVectorEntry[] {
    return Array.from(this.vectorCache.values());
  }

  /**
   * Broadcasts a job or notebook event to all active WebSocket connections on this NotebookDO.
   */
  public broadcastEvent(event: JobBroadcastEvent): number {
    const sockets = this.ctx.getWebSockets();
    let delivered = 0;
    const message = JSON.stringify(event);

    for (const socket of sockets) {
      try {
        const ws = socket as { readyState?: number; send(msg: string): void };
        if (ws.readyState === undefined || ws.readyState === 1) {
          ws.send(message);
          delivered++;
        }
      } catch {
        // Socket closed or write error
      }
    }
    return delivered;
  }

  /** Gespeicherter Yjs-Stand des Notebooks (Issue #347), null wenn noch leer. */
  private readDocState(): Uint8Array | null {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec("SELECT state FROM notebook_doc WHERE id = 1")
      .toArray() as { state?: ArrayBuffer | Uint8Array }[];
    const state = rows[0]?.state;
    return state ? new Uint8Array(state) : null;
  }

  /** Spielt ein Yjs-Update ein und liefert den neuen Zustandsvektor. */
  public applyDocUpdate(update: Uint8Array): Uint8Array {
    const merged = mergeIntoState(this.readDocState(), update);
    this.ctx.storage.sql.exec(
      "INSERT INTO notebook_doc (id, state, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
      merged,
      Date.now()
    );
    return diffFromState(merged).stateVector;
  }

  /** Was einem Client mit diesem Zustandsvektor fehlt. */
  public readDocDiff(stateVector?: Uint8Array): { update: Uint8Array; stateVector: Uint8Array } {
    return diffFromState(this.readDocState(), stateVector);
  }

  private docProblem(error: unknown, instance: string): Response {
    const known = error instanceof DocSyncError;
    const status = known ? error.status : 500;
    return Response.json(
      createProblemDetails({
        status,
        title: known
          ? status === 413
            ? "Payload Too Large"
            : "Bad Request"
          : "Internal Server Error",
        detail: known ? error.message : "Notebook-Stand konnte nicht verarbeitet werden.",
        instance,
        code: known ? error.code : "DOC_SYNC_FAILED"
      }),
      { status, headers: { "content-type": "application/problem+json; charset=utf-8" } }
    );
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // GET /doc?sv=…: fehlende Yjs-Änderungen; POST /doc: Yjs-Update einspielen (Issue #347)
    if (url.pathname === "/doc" && (request.method === "GET" || request.method === "POST")) {
      try {
        if (request.method === "GET") {
          const sv = url.searchParams.get("sv");
          const diff = this.readDocDiff(sv ? fromBase64Url(sv) : undefined);
          return Response.json({
            update: toBase64Url(diff.update),
            stateVector: toBase64Url(diff.stateVector)
          });
        }
        const update = new Uint8Array(await request.arrayBuffer());
        return Response.json({ stateVector: toBase64Url(this.applyDocUpdate(update)) });
      } catch (error) {
        return this.docProblem(error, url.pathname);
      }
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const report = this.ping();
      return Response.json(report, {
        status: report.ok ? 200 : 503,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // POST /events/broadcast: broadcasts a job/notebook event to connected WebSockets
    if (request.method === "POST" && url.pathname === "/events/broadcast") {
      try {
        const event = (await request.json()) as JobBroadcastEvent;
        const count = this.broadcastEvent(event);
        return Response.json(
          { success: true, delivered: count },
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" }
          }
        );
      } catch {
        const problem = createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiges JSON beim Senden von Broadcast-Events.",
          instance: url.pathname,
          code: "INVALID_JSON"
        });
        return Response.json(problem, {
          status: 400,
          headers: { "content-type": "application/problem+json; charset=utf-8" }
        });
      }
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
      await this.ensureVectorsLoaded();
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

    // POST /vectors/search: in-memory top-k vector search
    if (request.method === "POST" && url.pathname === "/vectors/search") {
      this.ensureSchema();
      await this.ensureVectorsLoaded();

      try {
        const body = (await request.json()) as {
          queryVector?: number[];
          quantized?: number[];
          scale?: number;
          limit?: number;
          sourceIds?: string[];
        };

        let q: Int8Array;
        let s: number;

        if (body.quantized && body.scale !== undefined) {
          q = new Int8Array(body.quantized);
          s = body.scale;
        } else if (body.queryVector && body.queryVector.length > 0) {
          const floatArr = new Float32Array(body.queryVector);
          const quantizedRes = quantizeFloat32ToInt8(floatArr);
          q = quantizedRes.quantized;
          s = quantizedRes.scale;
        } else {
          const problem = createProblemDetails({
            status: 400,
            title: "Bad Request",
            detail:
              "Entweder 'queryVector' (Float32) oder 'quantized' mit 'scale' (Int8) erforderlich.",
            instance: url.pathname,
            code: "MISSING_QUERY_VECTOR"
          });
          return Response.json(problem, {
            status: 400,
            headers: { "content-type": "application/problem+json; charset=utf-8" }
          });
        }

        const limit = typeof body.limit === "number" ? body.limit : 10;
        const results = this.searchVectors(q, s, limit, body.sourceIds);

        return Response.json(
          {
            results,
            count: results.length,
            totalVectors: this.vectorCache.size
          },
          {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" }
          }
        );
      } catch {
        const problem = createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiges JSON beim Ausführen der Vektorsuche.",
          instance: url.pathname,
          code: "INVALID_JSON"
        });
        return Response.json(problem, {
          status: 400,
          headers: { "content-type": "application/problem+json; charset=utf-8" }
        });
      }
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

export type JobExecutor = (
  job: JobRecord,
  onProgress: (progress: number) => Promise<void>
) => Promise<Record<string, unknown> | null>;

export interface JobRow {
  id: string;
  notebook_id: string;
  kind: string;
  payload: string;
  status: string;
  progress: number;
  attempts: number;
  max_attempts: number;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * JobDO manages background studio synthesis jobs (Audio Overview, Video Overview,
 * Mindmap, Flashcards, Quiz, GDPR export) via SQLite queue and alarm() execution.
 */
export class JobDO {
  protected readonly ctx: SqliteDurableObjectState;
  protected readonly env: Env;
  private initialized = false;
  private customExecutor?: JobExecutor | undefined;

  constructor(ctx: SqliteDurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  public setCustomExecutor(executor?: JobExecutor): void {
    this.customExecutor = executor;
  }

  private ensureSchema(): void {
    if (this.initialized) {
      return;
    }
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS _job_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        progress REAL NOT NULL DEFAULT 0.0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_notebook ON jobs(notebook_id);`
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

  private mapRowToRecord(row: Record<string, unknown>): JobRecord {
    const raw = row as unknown as JobRow;
    const parsedPayload: Record<string, unknown> = JSON.parse(raw.payload);
    const parsedResult: Record<string, unknown> | null = raw.result ? JSON.parse(raw.result) : null;

    return {
      id: raw.id,
      notebookId: raw.notebook_id,
      kind: raw.kind as JobRecord["kind"],
      payload: parsedPayload,
      status: raw.status as JobRecord["status"],
      progress: Number(raw.progress),
      attempts: Number(raw.attempts),
      maxAttempts: Number(raw.max_attempts),
      result: parsedResult,
      error: raw.error ?? null,
      createdAt: Number(raw.created_at),
      updatedAt: Number(raw.updated_at)
    };
  }

  /**
   * Enqueues a new background job into the local SQLite table and sets an alarm.
   */
  public async enqueue(data: EnqueueJobBody): Promise<JobRecord> {
    this.ensureSchema();
    const now = Date.now();
    const id = data.id || crypto.randomUUID();
    const maxAttempts = data.maxAttempts ?? 3;
    const payloadStr = JSON.stringify(data.payload);

    this.ctx.storage.sql.exec(
      `INSERT INTO jobs (id, notebook_id, kind, payload, status, progress, attempts, max_attempts, result, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 0.0, 0, ?, NULL, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload = excluded.payload,
         max_attempts = excluded.max_attempts,
         updated_at = excluded.updated_at`,
      id,
      data.notebookId,
      data.kind,
      payloadStr,
      maxAttempts,
      now,
      now
    );

    // Schedule queue processing immediately or verify alarm
    await this.scheduleAlarmIfNeeded(0);

    return this.getJob(id) as JobRecord;
  }

  /**
   * Retrieves a job by ID.
   */
  public getJob(id: string): JobRecord | null {
    this.ensureSchema();
    const rows = this.ctx.storage.sql.exec("SELECT * FROM jobs WHERE id = ?", id).toArray();
    const firstRow = rows[0];
    if (!firstRow) {
      return null;
    }
    return this.mapRowToRecord(firstRow);
  }

  /**
   * Cancels a queued or running job.
   */
  public async cancel(id: string): Promise<JobRecord | null> {
    this.ensureSchema();
    const now = Date.now();
    const existing = this.getJob(id);
    if (!existing) {
      return null;
    }

    if (existing.status === "completed" || existing.status === "failed") {
      return existing;
    }

    this.ctx.storage.sql.exec(
      "UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ?",
      now,
      id
    );

    return this.getJob(id);
  }

  /**
   * Lists jobs optionally filtered by status, kind, or notebookId.
   */
  public listJobs(filter?: JobFilterQuery): JobRecord[] {
    this.ensureSchema();
    let query = "SELECT * FROM jobs WHERE 1=1";
    const bindings: unknown[] = [];

    if (filter?.status) {
      query += " AND status = ?";
      bindings.push(filter.status);
    }
    if (filter?.kind) {
      query += " AND kind = ?";
      bindings.push(filter.kind);
    }
    if (filter?.notebookId) {
      query += " AND notebook_id = ?";
      bindings.push(filter.notebookId);
    }

    query += " ORDER BY created_at DESC";
    const rows = this.ctx.storage.sql.exec(query, ...bindings).toArray();
    return rows.map((r) => this.mapRowToRecord(r));
  }

  private async scheduleAlarmIfNeeded(delayMs = 0): Promise<void> {
    try {
      const scheduledTime = Date.now() + Math.max(0, delayMs);
      await this.ctx.storage.setAlarm(scheduledTime);
    } catch {
      // Fallback or non-fatal in mock environment
    }
  }

  /**
   * Broadcasts a real-time event via NotebookDO WebSocket connection.
   */
  public async notifyNotebook(event: JobBroadcastEvent): Promise<void> {
    if (!this.env?.NOTEBOOK_DO) {
      return;
    }

    try {
      const doId = this.env.NOTEBOOK_DO.idFromName(event.notebookId);
      const doStub = this.env.NOTEBOOK_DO.get(doId);
      await doStub.fetch("http://internal/events/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event)
      });
    } catch {
      // Non-fatal if broadcast fails
    }
  }

  /**
   * Persists completed result or failed state to D1 if D1 is configured.
   */
  private async syncToD1(job: JobRecord): Promise<void> {
    if (!this.env?.DB) {
      return;
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const userId = typeof job.payload.userId === "string" ? job.payload.userId : "system";
      const title =
        typeof job.payload.title === "string" ? job.payload.title : `Artifact ${job.kind}`;
      // Persist studio artifact
      await this.env.DB.prepare(
        `INSERT INTO artifacts (id, notebook_id, user_id, type, title, content_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content_json = excluded.content_json,
           status = 'ready',
           updated_at = excluded.updated_at`
      )
        .bind(job.id, job.notebookId, userId, job.kind, title, JSON.stringify(job.result), now, now)
        .run();
    } catch {
      // Non-fatal if D1 sync fails
    }
  }

  /**
   * Default execution simulator if no custom executor is set.
   */
  private async executeJobDefault(
    job: JobRecord,
    onProgress: (p: number) => Promise<void>
  ): Promise<Record<string, unknown>> {
    // 10% progress
    await onProgress(10);

    // 50% progress
    await onProgress(50);

    // 100% progress
    await onProgress(100);

    return {
      output: `Generated result for ${job.kind} (${job.id})`,
      kind: job.kind,
      timestamp: Date.now()
    };
  }

  /**
   * Alarm handler: executes queued jobs atomically with exponential backoff & idempotency.
   */
  public async alarm(): Promise<void> {
    this.ensureSchema();

    // Fetch next queued or retrying job
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT * FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at ASC LIMIT 1"
      )
      .toArray();

    const firstRow = rows[0];
    if (!firstRow) {
      return;
    }

    const job = this.mapRowToRecord(firstRow);
    const now = Date.now();
    const nextAttempts = job.attempts + 1;

    // Mark as running
    this.ctx.storage.sql.exec(
      "UPDATE jobs SET status = 'running', attempts = ?, updated_at = ? WHERE id = ?",
      nextAttempts,
      now,
      job.id
    );

    // Broadcast starting progress
    await this.notifyNotebook({
      type: "job_progress",
      jobId: job.id,
      notebookId: job.notebookId,
      kind: job.kind,
      progress: 0,
      status: "running",
      timestamp: now
    });

    const progressCallback = async (p: number) => {
      const pTime = Date.now();
      const clamped = Math.max(0, Math.min(100, Math.round(p)));
      this.ctx.storage.sql.exec(
        "UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?",
        clamped,
        pTime,
        job.id
      );

      await this.notifyNotebook({
        type: "job_progress",
        jobId: job.id,
        notebookId: job.notebookId,
        kind: job.kind,
        progress: clamped,
        status: "running",
        timestamp: pTime
      });
    };

    try {
      const executor = this.customExecutor ?? this.executeJobDefault.bind(this);
      const result = await executor(job, progressCallback);

      const finishTime = Date.now();
      const finalResult = result ?? {};
      const resultStr = JSON.stringify(finalResult);

      this.ctx.storage.sql.exec(
        "UPDATE jobs SET status = 'completed', progress = 100.0, result = ?, error = NULL, updated_at = ? WHERE id = ?",
        resultStr,
        finishTime,
        job.id
      );

      const completedRecord = this.getJob(job.id);
      if (completedRecord) {
        await this.syncToD1(completedRecord);
      }

      await this.notifyNotebook({
        type: "job_completed",
        jobId: job.id,
        notebookId: job.notebookId,
        kind: job.kind,
        result: finalResult,
        timestamp: finishTime
      });
    } catch (err: unknown) {
      const failTime = Date.now();
      const errMsg = err instanceof Error ? err.message : String(err);

      if (nextAttempts < job.maxAttempts) {
        // Exponential backoff: 2^(attempts-1) * 1000ms
        const backoffMs = 2 ** (nextAttempts - 1) * 1000;
        this.ctx.storage.sql.exec(
          "UPDATE jobs SET status = 'queued', error = ?, updated_at = ? WHERE id = ?",
          `Attempt ${nextAttempts} failed: ${errMsg}`,
          failTime,
          job.id
        );
        await this.scheduleAlarmIfNeeded(backoffMs);
      } else {
        // Max attempts reached: mark as failed
        this.ctx.storage.sql.exec(
          "UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
          errMsg,
          failTime,
          job.id
        );

        await this.notifyNotebook({
          type: "job_failed",
          jobId: job.id,
          notebookId: job.notebookId,
          kind: job.kind,
          error: errMsg,
          attempts: nextAttempts,
          timestamp: failTime
        });
      }
    }

    // Check if there are further queued jobs
    const remaining = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS count FROM jobs WHERE status = 'queued'")
      .toArray();
    let count = 0;
    for (const r of remaining) {
      count = Number(r.count);
    }
    if (count > 0) {
      await this.scheduleAlarmIfNeeded(0);
    }
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

    // POST /jobs/enqueue: enqueue new job
    if (
      request.method === "POST" &&
      (url.pathname === "/jobs/enqueue" || url.pathname === "/enqueue")
    ) {
      try {
        const body = (await request.json()) as EnqueueJobBody;
        if (!body.notebookId || !body.kind) {
          const problem = createProblemDetails({
            status: 400,
            title: "Bad Request",
            detail: "Fehlende Felder 'notebookId' oder 'kind' für Job.",
            instance: url.pathname,
            code: "INVALID_JOB_BODY"
          });
          return Response.json(problem, {
            status: 400,
            headers: { "content-type": "application/problem+json; charset=utf-8" }
          });
        }

        const record = await this.enqueue(body);
        return Response.json(record, {
          status: 201,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      } catch {
        const problem = createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiges JSON beim Erstellen eines Jobs.",
          instance: url.pathname,
          code: "INVALID_JSON"
        });
        return Response.json(problem, {
          status: 400,
          headers: { "content-type": "application/problem+json; charset=utf-8" }
        });
      }
    }

    // GET /jobs: list jobs
    if (request.method === "GET" && (url.pathname === "/jobs" || url.pathname === "/")) {
      const status = url.searchParams.get("status") || undefined;
      const kind = url.searchParams.get("kind") || undefined;
      const notebookId = url.searchParams.get("notebookId") || undefined;

      const jobs = this.listJobs({
        status: status as JobRecord["status"] | undefined,
        kind: kind as JobRecord["kind"] | undefined,
        notebookId
      });

      return Response.json(
        { jobs, count: jobs.length },
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        }
      );
    }

    // Dynamic routes: /jobs/:id or /jobs/:id/cancel
    const match = url.pathname.match(/^\/jobs\/([^/]+)(\/cancel)?$/);
    if (match?.[1]) {
      const jobId = match[1];
      const isCancel = Boolean(match[2]);

      if (isCancel && request.method === "POST") {
        const cancelled = await this.cancel(jobId);
        if (!cancelled) {
          const problem = createProblemDetails({
            status: 404,
            title: "Not Found",
            detail: `Job mit ID '${jobId}' wurde nicht gefunden.`,
            instance: url.pathname,
            code: "JOB_NOT_FOUND"
          });
          return Response.json(problem, {
            status: 404,
            headers: { "content-type": "application/problem+json; charset=utf-8" }
          });
        }
        return Response.json(cancelled, {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }

      if (!isCancel && request.method === "GET") {
        const job = this.getJob(jobId);
        if (!job) {
          const problem = createProblemDetails({
            status: 404,
            title: "Not Found",
            detail: `Job mit ID '${jobId}' wurde nicht gefunden.`,
            instance: url.pathname,
            code: "JOB_NOT_FOUND"
          });
          return Response.json(problem, {
            status: 404,
            headers: { "content-type": "application/problem+json; charset=utf-8" }
          });
        }
        return Response.json(job, {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
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
