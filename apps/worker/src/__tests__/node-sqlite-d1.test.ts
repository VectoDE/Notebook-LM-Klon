import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  D1TypeError,
  MIGRATIONS_TABLE,
  createSqliteD1Adapter,
  openNodeDatabase,
  runInTransaction,
  runSqliteMigrations,
  toSqliteValue
} from "../node/sqlite-d1.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nlk-sqlite-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function memoryD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, flag INTEGER, data BLOB);"
  );
  return { db, d1: createSqliteD1Adapter(db) };
}

describe("toSqliteValue (D1 type rules)", () => {
  it("passes through null, strings, numbers, bigints and Uint8Array", () => {
    const bytes = new Uint8Array([1, 2]);
    expect(toSqliteValue(null)).toBeNull();
    expect(toSqliteValue("a")).toBe("a");
    expect(toSqliteValue(1.5)).toBe(1.5);
    expect(toSqliteValue(2n)).toBe(2n);
    expect(toSqliteValue(bytes)).toBe(bytes);
  });

  it("maps booleans to 0/1 and binary views to Uint8Array", () => {
    expect(toSqliteValue(true)).toBe(1);
    expect(toSqliteValue(false)).toBe(0);
    expect(toSqliteValue(new Uint8Array([7]).buffer)).toEqual(new Uint8Array([7]));
    const view = new DataView(new Uint8Array([9, 8, 7]).buffer, 1, 2);
    expect(toSqliteValue(view)).toEqual(new Uint8Array([8, 7]));
  });

  it("rejects undefined and objects with D1_TYPE_ERROR", () => {
    expect(() => toSqliteValue(undefined)).toThrow(D1TypeError);
    expect(() => toSqliteValue(undefined)).toThrow(/D1_TYPE_ERROR: Type 'undefined'/);
    expect(() => toSqliteValue({ a: 1 })).toThrow(/D1_TYPE_ERROR: Type 'object'/);
    expect(() => toSqliteValue(Symbol("s"))).toThrow(D1TypeError);
  });
});

describe("createSqliteD1Adapter", () => {
  it("reports changes and last_row_id for run(), also for DML with RETURNING via all()", async () => {
    const { db, d1 } = memoryD1();
    const run = await d1.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").bind("a", true).run();
    expect(run.meta).toMatchObject({
      changes: 1,
      last_row_id: 1,
      rows_written: 1,
      changed_db: true
    });
    expect(run.success).toBe(true);

    const returning = await d1
      .prepare("INSERT INTO t (name) VALUES (?) RETURNING id")
      .bind("b")
      .all<{ id: number }>();
    expect(returning.results).toEqual([{ id: 2 }]);
    expect(returning.meta.changes).toBe(1);
    expect(returning.meta.last_row_id).toBe(2);

    const select = await d1.prepare("SELECT name, flag FROM t ORDER BY id").all();
    expect(select.results).toEqual([
      { name: "a", flag: 1 },
      { name: "b", flag: null }
    ]);
    expect(select.meta).toMatchObject({
      changes: 0,
      last_row_id: 0,
      rows_read: 2,
      changed_db: false
    });
    db.close();
  });

  it("supports first(), first(column), raw() and raw({ columnNames })", async () => {
    const { db, d1 } = memoryD1();
    await d1.prepare("INSERT INTO t (name) VALUES ('x')").run();
    expect(await d1.prepare("SELECT name FROM t").first()).toEqual({ name: "x" });
    expect(await d1.prepare("SELECT name FROM t").first("name")).toBe("x");
    expect(await d1.prepare("SELECT name FROM t").first("missing")).toBeNull();
    expect(await d1.prepare("SELECT name FROM t WHERE name = ?").bind("no").first()).toBeNull();
    expect(await d1.prepare("SELECT id, name FROM t").raw()).toEqual([[1, "x"]]);
    expect(await d1.prepare("SELECT id, name FROM t").raw({ columnNames: true })).toEqual([
      ["id", "name"],
      [1, "x"]
    ]);
    db.close();
  });

  it("throws D1_TYPE_ERROR when undefined is bound", () => {
    const { db, d1 } = memoryD1();
    expect(() => d1.prepare("SELECT ?").bind(undefined)).toThrow(/D1_TYPE_ERROR/);
    db.close();
  });

  it("runs batch() atomically: all statements commit together", async () => {
    const { db, d1 } = memoryD1();
    const results = await d1.batch([
      d1.prepare("INSERT INTO t (name) VALUES (?)").bind("one"),
      d1.prepare("INSERT INTO t (name) VALUES (?)").bind("two"),
      d1.prepare("SELECT COUNT(*) AS n FROM t")
    ]);
    expect(results.map((r) => r.meta.changes)).toEqual([1, 1, 0]);
    expect(results[2]?.results).toEqual([{ n: 2 }]);
    db.close();
  });

  it("rolls back the whole batch() when one statement fails", async () => {
    const { db, d1 } = memoryD1();
    await expect(
      d1.batch([
        d1.prepare("INSERT INTO t (name) VALUES (?)").bind("dup"),
        d1.prepare("INSERT INTO t (name) VALUES (?)").bind("dup")
      ])
    ).rejects.toThrow(/UNIQUE/);
    expect(await d1.prepare("SELECT COUNT(*) AS n FROM t").first("n")).toBe(0);
    db.close();
  });

  it("exec() runs several statements and counts them; dump() is refused with a pointer to backups", async () => {
    const { db, d1 } = memoryD1();
    const res = await d1.exec(
      "INSERT INTO t (name) VALUES ('a'); INSERT INTO t (name) VALUES ('b');"
    );
    expect(res.count).toBe(2);
    expect(res.duration).toBeGreaterThanOrEqual(0);
    await expect(d1.dump()).rejects.toThrow(/README/);
    db.close();
  });
});

describe("runInTransaction", () => {
  it("nests with savepoints: an inner failure rolls back only the inner part", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE n (v TEXT)");
    runInTransaction(db, () => {
      db.exec("INSERT INTO n VALUES ('outer')");
      expect(() =>
        runInTransaction(db, () => {
          db.exec("INSERT INTO n VALUES ('inner')");
          throw new Error("inner failed");
        })
      ).toThrow("inner failed");
      runInTransaction(db, () => db.exec("INSERT INTO n VALUES ('inner-ok')"));
    });
    expect(db.prepare("SELECT v FROM n ORDER BY rowid").all()).toEqual([
      { v: "outer" },
      { v: "inner-ok" }
    ]);
    expect(db.isTransaction).toBe(false);
    db.close();
  });
});

describe("openNodeDatabase", () => {
  it("creates the folder and enables WAL, foreign keys and a busy timeout", () => {
    const file = join(dir, "nested", "app.sqlite");
    const db = openNodeDatabase(file);
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    db.exec(
      "CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (p INTEGER REFERENCES p(id));"
    );
    expect(() => db.exec("INSERT INTO c VALUES (42)")).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("accepts :memory: without touching the file system", () => {
    const db = openNodeDatabase(":memory:");
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });
});

describe("runSqliteMigrations", () => {
  it("returns [] when the folder does not exist", () => {
    const db = new DatabaseSync(":memory:");
    expect(runSqliteMigrations(db, join(dir, "missing"))).toEqual([]);
    db.close();
  });

  it("applies each file once, in order, and records it in d1_migrations", () => {
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    writeFileSync(join(migrations, "0002_b.sql"), "ALTER TABLE a ADD COLUMN extra TEXT;");
    writeFileSync(join(migrations, "0001_a.sql"), "CREATE TABLE a (id INTEGER);");
    writeFileSync(join(migrations, "notes.txt"), "ignored");
    const db = new DatabaseSync(":memory:");

    expect(runSqliteMigrations(db, migrations)).toEqual(["0001_a.sql", "0002_b.sql"]);
    // A second start must not re-run ALTER TABLE (it would fail with "duplicate column").
    expect(runSqliteMigrations(db, migrations)).toEqual([]);
    expect(
      db
        .prepare(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id`)
        .all()
        .map((r) => r.name)
    ).toEqual(["0001_a.sql", "0002_b.sql"]);
    db.close();
  });

  it("rolls back a failing migration completely and does not record it", () => {
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    writeFileSync(
      join(migrations, "0001_bad.sql"),
      "CREATE TABLE ok (id INTEGER); SELECT * FROM nope;"
    );
    const db = new DatabaseSync(":memory:");
    expect(() => runSqliteMigrations(db, migrations)).toThrow(/no such table/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeUndefined();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${MIGRATIONS_TABLE}`).get()).toEqual({ n: 0 });
    db.close();
  });

  it("applies the real project migrations on a WAL database with foreign keys", () => {
    const db = openNodeDatabase(join(dir, "real.sqlite"));
    const applied = runSqliteMigrations(db, resolve(process.cwd(), "apps/worker/migrations"));
    expect(applied.length).toBeGreaterThanOrEqual(2);
    expect(applied[0]).toBe("0001_initial_core.sql");
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });
});
