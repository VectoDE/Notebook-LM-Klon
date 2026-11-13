import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * D1 compatible adapter on the built-in `node:sqlite` module (no native build, no extra
 * dependency). Behaviour follows Cloudflare D1 where the app depends on it:
 * - `batch()` is atomic (one transaction, rollback on the first error),
 * - `meta.changes` is correct for every statement, including DML with RETURNING,
 * - `undefined` is rejected like D1 does (`D1_TYPE_ERROR`), booleans become 0/1.
 */

type Row = Record<string, unknown>;

interface D1Meta {
  changes: number;
  last_row_id: number;
  duration: number;
  rows_read: number;
  rows_written: number;
  changed_db: boolean;
  size_after: number;
}

interface D1Result<T> {
  results: T[];
  success: true;
  meta: D1Meta;
}

/** Internal synchronous executor, used by batch() so a batch runs without yielding. */
const RUN_ALL_SYNC = Symbol("runAllSync");

interface NodeD1Statement {
  bind: (...params: unknown[]) => NodeD1Statement;
  first: <T = unknown>(colName?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<D1Result<T>>;
  run: <T = unknown>() => Promise<D1Result<T>>;
  raw: <T = unknown[]>(options?: { columnNames?: boolean }) => Promise<T[]>;
  [RUN_ALL_SYNC]: () => D1Result<unknown>;
}

export class D1TypeError extends TypeError {
  constructor(message: string) {
    super(`D1_TYPE_ERROR: ${message}`);
    this.name = "D1TypeError";
  }
}

/** Converts a bound value the same way D1 does, or throws D1_TYPE_ERROR. */
export function toSqliteValue(value: unknown): SQLInputValue {
  if (value === null) {
    return null;
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "bigint":
      return value;
    case "boolean":
      return value ? 1 : 0;
    case "undefined":
      throw new D1TypeError("Type 'undefined' not supported for value 'undefined'");
    default:
      break;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new D1TypeError(`Type '${typeof value}' not supported for value '${String(value)}'`);
}

function totalChanges(db: DatabaseSync): number {
  const row = db.prepare("SELECT total_changes() AS c").get() as { c: number };
  return Number(row.c);
}

function lastRowId(db: DatabaseSync): number {
  const row = db.prepare("SELECT last_insert_rowid() AS r").get() as { r: number };
  return Number(row.r);
}

function createStatement(
  db: DatabaseSync,
  query: string,
  params: SQLInputValue[]
): NodeD1Statement {
  // Prepare eagerly so syntax errors surface at prepare() time, as with D1.
  const stmt = db.prepare(query);

  const runAllSync = (): D1Result<unknown> => {
    const started = performance.now();
    const before = totalChanges(db);
    const rows = stmt.all(...params) as Row[];
    const changes = totalChanges(db) - before;
    return {
      results: rows,
      success: true,
      meta: {
        changes,
        last_row_id: changes > 0 ? lastRowId(db) : 0,
        duration: performance.now() - started,
        rows_read: rows.length,
        rows_written: changes,
        changed_db: changes > 0,
        size_after: 0
      }
    };
  };

  const statement: NodeD1Statement = {
    bind: (...values: unknown[]) => createStatement(db, query, values.map(toSqliteValue)),
    first: async <T = unknown>(colName?: string): Promise<T | null> => {
      const row = stmt.get(...params) as Row | undefined;
      if (!row) {
        return null;
      }
      if (colName !== undefined) {
        return (row[colName] as T | undefined) ?? null;
      }
      return row as T;
    },
    all: async <T = unknown>() => runAllSync() as D1Result<T>,
    run: async <T = unknown>() => runAllSync() as D1Result<T>,
    raw: async <T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> => {
      const rows = stmt.all(...params) as Row[];
      const values = rows.map((row) => Object.values(row)) as T[];
      if (options?.columnNames) {
        const names = stmt.columns().map((column) => column.name) as T;
        return [names, ...values];
      }
      return values;
    },
    [RUN_ALL_SYNC]: runAllSync
  };
  return statement;
}

let savepointCounter = 0;

/**
 * Runs `work` atomically. Uses BEGIN/COMMIT at top level and a SAVEPOINT when a
 * transaction is already open, so nested calls stay correct. `isTransaction` reads the
 * real SQLite state (sqlite3_get_autocommit), so transactions opened elsewhere count too.
 */
export function runInTransaction<T>(db: DatabaseSync, work: () => T): T {
  const nested = db.isTransaction;
  savepointCounter += 1;
  const savepoint = `nlk_sp_${savepointCounter}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (err) {
    db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : "ROLLBACK");
    throw err;
  }
}

export function createSqliteD1Adapter(db: DatabaseSync): D1Database {
  return {
    prepare: (query: string) => createStatement(db, query, []),
    exec: async (sqlStr: string) => {
      const started = performance.now();
      db.exec(sqlStr);
      const count = sqlStr.split(";").filter((part) => part.trim().length > 0).length;
      return { count, duration: performance.now() - started };
    },
    batch: async (statements: NodeD1Statement[]) =>
      runInTransaction(db, () => statements.map((statement) => statement[RUN_ALL_SYNC]())),
    dump: async () => {
      throw new Error("dump() wird auf der Node-Laufzeit nicht unterstützt. Backup: siehe README.");
    }
  } as unknown as D1Database;
}

/**
 * Opens (and creates) the SQLite file with the settings the app relies on:
 * WAL for concurrent readers, foreign keys enforced like D1, and a busy timeout so a
 * short lock (backup, second process) does not fail requests immediately.
 */
export function openNodeDatabase(filePath: string): DatabaseSync {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
  return db;
}

/** Name of the bookkeeping table, identical to the one Wrangler uses for D1. */
export const MIGRATIONS_TABLE = "d1_migrations";

/**
 * Applies every `*.sql` file in `migrationsDir` once, in file-name order, each in its own
 * transaction, and records it in `d1_migrations` (same table name and columns as Wrangler).
 * Returns the names applied in this call.
 */
export function runSqliteMigrations(db: DatabaseSync, migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );`
  );
  const applied = new Set(
    (db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const appliedNow: string[] = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    runInTransaction(db, () => {
      db.exec(sql);
      db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`).run(file);
    });
    appliedNow.push(file);
  }
  return appliedNow;
}
