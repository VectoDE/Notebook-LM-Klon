import { ProblemDetailsSchema } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import {
  type DurableObjectHealthReport,
  JobDO,
  NotebookDO,
  type SqliteDurableObjectState
} from "../index.js";

function createMockSqliteState(id: string): {
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
            toArray: () => [{ ok: 1 }]
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
  });
});
