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
});
