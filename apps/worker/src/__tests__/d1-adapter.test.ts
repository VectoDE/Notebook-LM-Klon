import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";

describe("createD1DatabaseAdapter", () => {
  it("wraps D1-like interface to match DatabaseAdapter contract", async () => {
    const db = new DatabaseSync(":memory:");
    const migrationPath = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
    const sql = readFileSync(migrationPath, "utf-8");
    db.exec(sql);

    const mockD1 = {
      exec: async (sqlStr: string) => {
        db.exec(sqlStr);
      },
      prepare: (sqlStr: string) => ({
        bind: (...params: unknown[]) => ({
          all: async <T>() => {
            const stmt = db.prepare(sqlStr);
            const results = stmt.all(...(params as (string | number | bigint | null)[])) as T[];
            return { results };
          },
          first: async <T>() => {
            const stmt = db.prepare(sqlStr);
            const row = stmt.get(...(params as (string | number | bigint | null)[]));
            return (row as T) ?? null;
          },
          run: async () => {
            const stmt = db.prepare(sqlStr);
            const info = stmt.run(...(params as (string | number | bigint | null)[]));
            return { meta: { changes: Number(info.changes) } };
          }
        })
      })
    } as unknown as D1Database;

    const adapter: DatabaseAdapter = createD1DatabaseAdapter(mockD1);

    await adapter.exec("CREATE TABLE IF NOT EXISTS probe (id TEXT PRIMARY KEY);");
    const runRes = await adapter.run("INSERT INTO probe (id) VALUES (?)", ["probe_1"]);
    expect(runRes.changes).toBe(1);

    const oneRes = await adapter.queryOne<{ id: string }>("SELECT id FROM probe WHERE id = ?", [
      "probe_1"
    ]);
    expect(oneRes?.id).toBe("probe_1");

    const noneRes = await adapter.queryOne<{ id: string }>("SELECT id FROM probe WHERE id = ?", [
      "nonexistent"
    ]);
    expect(noneRes).toBeNull();

    const allRes = await adapter.query<{ id: string }>("SELECT id FROM probe");
    expect(allRes.length).toBe(1);

    db.close();
  });
});
