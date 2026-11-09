import type { DatabaseAdapter } from "./core-repository.js";

export function createD1DatabaseAdapter(db: D1Database): DatabaseAdapter {
  return {
    exec: async (sqlStr: string) => {
      await db.exec(sqlStr);
    },
    query: async <T>(sqlStr: string, params: unknown[] = []) => {
      const res = await db
        .prepare(sqlStr)
        .bind(...params)
        .all<T>();
      return res.results;
    },
    queryOne: async <T>(sqlStr: string, params: unknown[] = []) => {
      const row = await db
        .prepare(sqlStr)
        .bind(...params)
        .first<T>();
      return row ?? null;
    },
    run: async (sqlStr: string, params: unknown[] = []) => {
      const res = await db
        .prepare(sqlStr)
        .bind(...params)
        .run();
      return { changes: Number(res.meta.changes) };
    }
  };
}
