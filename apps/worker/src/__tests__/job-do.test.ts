import { DatabaseSync } from "node:sqlite";
import { type JobRecord, ProblemDetailsSchema } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import { JobDO, type JobExecutor, NotebookDO, type SqliteDurableObjectState } from "../index.js";

function createRealSqliteState(id: string): {
  state: SqliteDurableObjectState;
  db: DatabaseSync;
  alarmsSet: number[];
  alarmsDeleted: number;
} {
  const db = new DatabaseSync(":memory:");
  const alarmsSet: number[] = [];
  let alarmsDeleted = 0;
  const webSockets: unknown[] = [];

  const state: SqliteDurableObjectState = {
    id: { toString: () => id },
    storage: {
      sql: {
        exec: (sql: string, ...bindings: unknown[]) => {
          const trimmed = sql.trim().toUpperCase();
          if (
            trimmed.startsWith("SELECT") ||
            trimmed.startsWith("PRAGMA") ||
            trimmed.startsWith("WITH")
          ) {
            try {
              const stmt = db.prepare(sql);
              const rows = stmt.all(
                ...(bindings as (string | number | bigint | null | Uint8Array)[])
              );
              return { toArray: () => rows as Record<string, unknown>[] };
            } catch {
              return { toArray: () => [] };
            }
          } else {
            try {
              if (bindings.length > 0) {
                const stmt = db.prepare(sql);
                stmt.run(...(bindings as (string | number | bigint | null | Uint8Array)[]));
              } else {
                db.exec(sql);
              }
            } catch {
              // Ignore table creation or execution syntax errors in tests if any
            }
            return { toArray: () => [] };
          }
        }
      },
      setAlarm: async (scheduledTime: number | Date) => {
        const time = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
        alarmsSet.push(time);
      },
      deleteAlarm: async () => {
        alarmsDeleted++;
      },
      getAlarm: async () =>
        alarmsSet.length > 0 ? (alarmsSet[alarmsSet.length - 1] ?? null) : null
    },
    acceptWebSocket: (ws: unknown) => {
      webSockets.push(ws);
    },
    getWebSockets: () => webSockets
  };

  return { state, db, alarmsSet, alarmsDeleted };
}

describe("JobDO SQLite queue, alarm execution, retries & live status (Issues #22, #110, #111, #112)", () => {
  it("enqueues a job, verifies SQLite storage, schema idempotency, and schedules alarm (Issue #110)", async () => {
    const { state, alarmsSet } = createRealSqliteState("job-do-test-1");
    const jobDo = new JobDO(state, {} as Env);

    // Initial ping
    const ping = jobDo.ping();
    expect(ping.ok).toBe(true);
    expect(ping.className).toBe("JobDO");

    // Enqueue job via method
    const enqueued = await jobDo.enqueue({
      id: "job-abc-1",
      notebookId: "nb-100",
      kind: "audio_overview",
      payload: { voice: "natural" },
      maxAttempts: 3
    });

    expect(enqueued.id).toBe("job-abc-1");
    expect(enqueued.status).toBe("queued");
    expect(enqueued.progress).toBe(0);
    expect(enqueued.attempts).toBe(0);
    expect(enqueued.kind).toBe("audio_overview");
    expect(enqueued.payload).toEqual({ voice: "natural" });
    expect(alarmsSet.length).toBeGreaterThan(0);

    // Idempotent re-enqueue with same ID updates payload and attempts
    const updated = await jobDo.enqueue({
      id: "job-abc-1",
      notebookId: "nb-100",
      kind: "audio_overview",
      payload: { voice: "studio" },
      maxAttempts: 4
    });
    expect(updated.payload).toEqual({ voice: "studio" });
    expect(updated.maxAttempts).toBe(4);

    // Query job
    const queried = jobDo.getJob("job-abc-1");
    expect(queried).not.toBeNull();
    expect(queried?.id).toBe("job-abc-1");

    // Query non-existent job
    expect(jobDo.getJob("non-existent")).toBeNull();

    // List jobs
    const list = jobDo.listJobs();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe("job-abc-1");

    // Filter by kind
    expect(jobDo.listJobs({ kind: "flashcards" })).toHaveLength(0);
    expect(jobDo.listJobs({ kind: "audio_overview" })).toHaveLength(1);
    expect(jobDo.listJobs({ status: "queued" })).toHaveLength(1);
    expect(jobDo.listJobs({ status: "completed" })).toHaveLength(0);
    expect(jobDo.listJobs({ notebookId: "nb-100" })).toHaveLength(1);
    expect(jobDo.listJobs({ notebookId: "nb-other" })).toHaveLength(0);
  });

  it("handles JobDO HTTP endpoints: enqueue, get status, list, cancel, and 404/400 validation", async () => {
    const { state } = createRealSqliteState("job-do-http");
    const jobDo = new JobDO(state, {} as Env);

    // POST /jobs/enqueue with valid body
    const postRes = await jobDo.fetch(
      new Request("http://internal/jobs/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notebookId: "nb-http-1",
          kind: "mindmap",
          payload: { depth: 3 }
        })
      })
    );
    expect(postRes.status).toBe(201);
    const createdJob = (await postRes.json()) as JobRecord;
    expect(createdJob.notebookId).toBe("nb-http-1");
    expect(createdJob.kind).toBe("mindmap");

    // GET /jobs/:id
    const getRes = await jobDo.fetch(new Request(`http://internal/jobs/${createdJob.id}`));
    expect(getRes.status).toBe(200);
    const fetchedJob = (await getRes.json()) as JobRecord;
    expect(fetchedJob.id).toBe(createdJob.id);

    // GET /jobs/:id non-existent -> 404
    const get404 = await jobDo.fetch(new Request("http://internal/jobs/missing-id"));
    expect(get404.status).toBe(404);

    // GET /jobs list
    const listRes = await jobDo.fetch(
      new Request("http://internal/jobs?kind=mindmap&status=queued&notebookId=nb-http-1")
    );
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { jobs: JobRecord[]; count: number };
    expect(listData.count).toBe(1);

    // POST /jobs/:id/cancel
    const cancelRes = await jobDo.fetch(
      new Request(`http://internal/jobs/${createdJob.id}/cancel`, { method: "POST" })
    );
    expect(cancelRes.status).toBe(200);
    const cancelledJob = (await cancelRes.json()) as JobRecord;
    expect(cancelledJob.status).toBe("cancelled");

    // Cancel non-existent -> 404
    const cancel404 = await jobDo.fetch(
      new Request("http://internal/jobs/missing-id/cancel", { method: "POST" })
    );
    expect(cancel404.status).toBe(404);

    // Invalid JSON body on enqueue
    const badJsonRes = await jobDo.fetch(
      new Request("http://internal/jobs/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "invalid-json"
      })
    );
    expect(badJsonRes.status).toBe(400);

    // Missing required fields on enqueue
    const missingFieldsRes = await jobDo.fetch(
      new Request("http://internal/jobs/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: {} })
      })
    );
    expect(missingFieldsRes.status).toBe(400);
  });

  it("processes queue with alarm(), reports progress, handles success and D1 artifact sync (Issue #111)", async () => {
    const { state } = createRealSqliteState("job-do-alarm-succ");

    // Mock D1 database to verify sync
    const d1PreparedStatements: Array<{ query: string; params: unknown[] }> = [];
    const mockDb: D1Database = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          run: async () => {
            d1PreparedStatements.push({ query: sql, params });
            return {
              results: [],
              success: true,
              meta: { changes: 1, last_row_id: 1, duration: 0, rows_read: 0, rows_written: 1 }
            };
          }
        })
      })
    } as unknown as D1Database;

    const mockEnv = {
      DB: mockDb,
      NOTEBOOK_DO: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async () => new Response(JSON.stringify({ success: true, delivered: 1 }))
        })
      }
    } as unknown as Env;

    const jobDo = new JobDO(state, mockEnv);

    // Enqueue 2 jobs
    const job1 = await jobDo.enqueue({
      id: "alarm-job-1",
      notebookId: "nb-alarm-1",
      kind: "flashcards",
      payload: { userId: "usr_alice", title: "Key Concepts" },
      maxAttempts: 3
    });

    const job2 = await jobDo.enqueue({
      id: "alarm-job-2",
      notebookId: "nb-alarm-1",
      kind: "quiz",
      payload: { userId: "usr_alice", title: "Test Quiz" },
      maxAttempts: 3
    });

    expect(job1.status).toBe("queued");
    expect(job2.status).toBe("queued");

    // Run alarm() for first job
    await jobDo.alarm();

    const job1After = jobDo.getJob("alarm-job-1");
    expect(job1After?.status).toBe("completed");
    expect(job1After?.progress).toBe(100);
    expect(job1After?.result).not.toBeNull();
    expect(job1After?.attempts).toBe(1);

    // D1 should have received sync query
    expect(d1PreparedStatements.length).toBe(1);
    expect(d1PreparedStatements[0]?.query).toContain("INSERT INTO artifacts");
    expect(d1PreparedStatements[0]?.params[0]).toBe("alarm-job-1");

    // Cancelling a completed job returns the completed job without reverting
    const reCancel = await jobDo.cancel("alarm-job-1");
    expect(reCancel?.status).toBe("completed");

    // Second job is still queued, run alarm() again
    await jobDo.alarm();
    const job2After = jobDo.getJob("alarm-job-2");
    expect(job2After?.status).toBe("completed");

    // Alarm on empty queue does nothing
    await expect(jobDo.alarm()).resolves.toBeUndefined();
  });

  it("handles transient errors with exponential backoff retries and final failure (Issue #111)", async () => {
    const { state, alarmsSet } = createRealSqliteState("job-do-retry");
    const jobDo = new JobDO(state, {} as Env);

    let attemptsCount = 0;
    const failingExecutor: JobExecutor = async (_job, onProgress) => {
      attemptsCount++;
      await onProgress(25);
      if (attemptsCount <= 2) {
        throw new Error(`Transient API rate limit (attempt ${attemptsCount})`);
      }
      throw new Error("Permanent fatal error");
    };

    jobDo.setCustomExecutor(failingExecutor);

    await jobDo.enqueue({
      id: "retry-job-1",
      notebookId: "nb-retry",
      kind: "gdpr_export",
      payload: {},
      maxAttempts: 3
    });

    // Attempt 1 -> transient fail, re-queued with backoff
    await jobDo.alarm();
    let job = jobDo.getJob("retry-job-1");
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(1);
    expect(job?.error).toContain("Attempt 1 failed: Transient API rate limit");
    expect(alarmsSet.length).toBeGreaterThan(0);

    // Attempt 2 -> transient fail, re-queued with backoff
    await jobDo.alarm();
    job = jobDo.getJob("retry-job-1");
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(2);
    expect(job?.error).toContain("Attempt 2 failed: Transient API rate limit");

    // Attempt 3 -> max attempts reached, marked as failed
    await jobDo.alarm();
    job = jobDo.getJob("retry-job-1");
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(3);
    expect(job?.error).toBe("Permanent fatal error");

    // Cancelling a failed job returns it unchanged
    const cancelRes = await jobDo.cancel("retry-job-1");
    expect(cancelRes?.status).toBe("failed");
  });

  it("broadcasts live progress and completion events to NotebookDO WebSocket clients (Issue #112)", async () => {
    const { state: nbState } = createRealSqliteState("nb-ws-1");
    const notebookDo = new NotebookDO(nbState, {} as Env);

    const receivedMessages: string[] = [];
    const mockWs = {
      readyState: 1,
      send: (msg: string) => {
        receivedMessages.push(msg);
      }
    };

    nbState.acceptWebSocket?.(mockWs);

    // Send broadcast event to NotebookDO via HTTP
    const broadcastRes = await notebookDo.fetch(
      new Request("http://internal/events/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "job_progress",
          jobId: "job-ws-1",
          notebookId: "nb-ws-1",
          kind: "video_overview",
          progress: 50,
          status: "running",
          timestamp: Date.now()
        })
      })
    );
    expect(broadcastRes.status).toBe(200);
    const body = (await broadcastRes.json()) as { delivered: number };
    expect(body.delivered).toBe(1);
    expect(receivedMessages.length).toBe(1);
    expect(receivedMessages[0]).toContain("job_progress");

    // Invalid event broadcast -> 400
    const badRes = await notebookDo.fetch(
      new Request("http://internal/events/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "bad-json"
      })
    );
    expect(badRes.status).toBe(400);
    const problem = ProblemDetailsSchema.parse(await badRes.json());
    expect(problem.code).toBe("INVALID_JSON");
  });

  it("handles JobDO without DB binding when completing job (syncToD1 no-op branch)", async () => {
    const { state } = createRealSqliteState("job-do-no-db");
    const jobDo = new JobDO(state, {} as Env);

    await jobDo.enqueue({
      id: "no-db-job",
      notebookId: "nb-1",
      kind: "briefing",
      payload: {},
      maxAttempts: 3
    });

    await jobDo.alarm();
    const job = jobDo.getJob("no-db-job");
    expect(job?.status).toBe("completed");

    // HTTP GET /jobs without filter queries
    const listRes = await jobDo.fetch(new Request("http://internal/jobs"));
    expect(listRes.status).toBe(200);

    // HTTP GET / with fallback path
    const rootRes = await jobDo.fetch(new Request("http://internal/"));
    expect(rootRes.status).toBe(200);

    // notifyNotebook when NOTEBOOK_DO throws
    const faultyEnv = {
      NOTEBOOK_DO: {
        idFromName: () => {
          throw new Error("NotebookDO network down");
        }
      }
    } as unknown as Env;
    const faultyDo = new JobDO(state, faultyEnv);
    await expect(
      faultyDo.notifyNotebook({
        type: "job_progress",
        jobId: "j1",
        notebookId: "nb1",
        kind: "audio_overview",
        progress: 10,
        status: "running",
        timestamp: Date.now()
      })
    ).resolves.toBeUndefined();

    // Alarm execution with non-Error string rejection in executor
    const stringRejectDo = new JobDO(state, {} as Env);
    stringRejectDo.setCustomExecutor(async () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing non-error throw
      throw "Raw string error rejection" as any;
    });
    await stringRejectDo.enqueue({
      id: "string-err-job",
      notebookId: "nb-1",
      kind: "quiz",
      payload: {},
      maxAttempts: 1
    });
    await stringRejectDo.alarm();
    const strErrJob = stringRejectDo.getJob("string-err-job");
    expect(strErrJob?.status).toBe("failed");
    expect(strErrJob?.error).toBe("Raw string error rejection");

    // Enqueue 2 jobs and process one to trigger count > 0 remaining alarm scheduling
    const multiJobDo = new JobDO(state, {} as Env);
    await multiJobDo.enqueue({
      id: "multi-1",
      notebookId: "nb-1",
      kind: "quiz",
      payload: {},
      maxAttempts: 3
    });
    await multiJobDo.enqueue({
      id: "multi-2",
      notebookId: "nb-1",
      kind: "quiz",
      payload: {},
      maxAttempts: 3
    });
    await multiJobDo.alarm();

    // GET /jobs/:id with invalid method (e.g. DELETE -> DO_ROUTE_NOT_FOUND)
    const invalidMethodRes = await multiJobDo.fetch(
      new Request("http://internal/jobs/multi-1", { method: "DELETE" })
    );
    expect(invalidMethodRes.status).toBe(404);

    // Test NotebookDO broadcast with non-open (readyState !== 1) socket
    const { state: nbState } = createRealSqliteState("nb-ws-state");
    const nbDo = new NotebookDO(nbState, {} as Env);
    const mockClosedWs = { readyState: 2, send: () => {} };
    nbState.acceptWebSocket?.(mockClosedWs);
    const deliveredClosed = nbDo.broadcastEvent({
      type: "job_progress",
      jobId: "j-ws-closed",
      notebookId: "nb-ws-state",
      kind: "quiz",
      progress: 50,
      status: "running",
      timestamp: Date.now()
    });
    expect(deliveredClosed).toBe(0);

    // Test JobDO D1 sync with non-string payload fields and null executor result
    const d1Calls: unknown[] = [];
    const mockDbEnv = {
      DB: {
        prepare: () => ({
          bind: (...args: unknown[]) => {
            d1Calls.push(args);
            return {
              run: async () => ({})
            };
          }
        })
      }
    } as unknown as Env;

    const nullResultDo = new JobDO(state, mockDbEnv);
    nullResultDo.setCustomExecutor(async () => null);
    await nullResultDo.enqueue({
      id: "null-res-job",
      notebookId: "nb-1",
      kind: "quiz",
      payload: { userId: 12345, title: true } as unknown as Record<string, unknown>,
      maxAttempts: 3
    });
    await nullResultDo.alarm();
    expect(d1Calls.length).toBeGreaterThan(0);
    const lastD1Call = d1Calls[d1Calls.length - 1] as unknown[];
    expect(lastD1Call[2]).toBe("system");
    expect(lastD1Call[4]).toBe("Artifact quiz");
  });
});
