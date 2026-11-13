import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqliteDurableObjectState } from "../durable-objects.js";
import { toSqliteValue } from "./sqlite-d1.js";

/**
 * In-process replacement for Durable Object namespaces on the Node runtime.
 *
 * It runs the real classes (NotebookDO, JobDO) with the contract Cloudflare gives them:
 * - one instance per object id, created on first use and kept in memory,
 * - SQLite storage per object (`<dir>/<hex id>.sqlite`) behind `ctx.storage.sql.exec()`,
 * - alarms persisted in that database and re-armed after a restart (restoreAlarms); a
 *   failing alarm is retried with exponential backoff, at most 6 attempts as on Cloudflare,
 * - requests to one object run one after another (input gate), different objects in parallel.
 *
 * Limits (documented in the README): one process only, no WebSocket hibernation
 * (`getWebSockets()` is always empty, `acceptWebSocket()` throws).
 */

export const ALARM_MAX_RETRIES = 6;
export const ALARM_RETRY_BASE_MS = 2_000;
/** setTimeout cannot wait longer; later alarms re-check when this timer fires. */
const MAX_TIMER_MS = 2 ** 31 - 1;

interface DurableObjectLike {
  fetch(request: Request): Promise<Response>;
  alarm?: () => Promise<void>;
}

export type DurableObjectFactory = (ctx: SqliteDurableObjectState) => DurableObjectLike;

interface NodeObjectId {
  readonly name?: string;
  toString(): string;
  equals(other: { toString(): string }): boolean;
}

interface ObjectSlot {
  instance: DurableObjectLike;
  readonly db: DatabaseSync;
  queue: Promise<unknown>;
  timer: ReturnType<typeof setTimeout> | undefined;
  retries: number;
}

export interface InProcessNamespace extends DurableObjectNamespace {
  /** Re-arms alarms persisted by a previous process. Returns the number of objects re-armed. */
  restoreAlarms(): number;
  /** Stops timers and closes every object database. */
  close(): void;
}

export interface InProcessNamespaceOptions {
  readonly onAlarmError?: (err: unknown, id: string, attempt: number) => void;
}

function makeId(hex: string, name?: string): NodeObjectId {
  return {
    ...(name !== undefined ? { name } : {}),
    toString: () => hex,
    equals: (other) => other.toString() === hex
  };
}

/** True when the SQL text holds more than one statement (ignoring a trailing semicolon). */
function isMultiStatement(query: string): boolean {
  return /;\s*\S/.test(query);
}

export function createInProcessNamespace(
  className: string,
  dir: string,
  factory: DurableObjectFactory,
  options: InProcessNamespaceOptions = {}
): InProcessNamespace {
  mkdirSync(dir, { recursive: true });
  const slots = new Map<string, ObjectSlot>();
  let closed = false;
  const onAlarmError =
    options.onAlarmError ??
    ((err: unknown, id: string, attempt: number) =>
      console.error(
        JSON.stringify({ event: "do_alarm_failed", className, id, attempt, error: String(err) })
      ));

  /** Runs `task` after every earlier task of the same object (input gate). */
  const serialize = <T>(slot: ObjectSlot, task: () => Promise<T>): Promise<T> => {
    const run = slot.queue.then(task, task);
    slot.queue = run.catch(() => undefined);
    return run;
  };

  const readAlarm = (db: DatabaseSync): number | null => {
    const row = db.prepare("SELECT scheduled_at FROM _nlk_alarm WHERE id = 1").get() as
      | { scheduled_at: number }
      | undefined;
    return row ? Number(row.scheduled_at) : null;
  };

  const writeAlarm = (db: DatabaseSync, at: number): void => {
    db.prepare("INSERT OR REPLACE INTO _nlk_alarm (id, scheduled_at) VALUES (1, ?)").run(at);
  };

  const scheduleTimer = (hex: string, slot: ObjectSlot, at: number): void => {
    clearTimeout(slot.timer);
    const delay = Math.min(Math.max(0, at - Date.now()), MAX_TIMER_MS);
    slot.timer = setTimeout(() => {
      slot.timer = undefined;
      void fireAlarm(hex, slot);
    }, delay);
    slot.timer.unref();
  };

  // close() clears every timer, so this only runs while the namespace is open.
  const fireAlarm = async (hex: string, slot: ObjectSlot): Promise<void> => {
    const at = readAlarm(slot.db);
    if (at === null) {
      return;
    }
    if (at > Date.now()) {
      scheduleTimer(hex, slot, at);
      return;
    }
    // As on Cloudflare the alarm is cleared before the handler runs; the handler may set a new one.
    slot.db.prepare("DELETE FROM _nlk_alarm WHERE id = 1").run();
    try {
      await serialize(slot, async () => slot.instance.alarm?.());
      slot.retries = 0;
    } catch (err) {
      slot.retries += 1;
      onAlarmError(err, hex, slot.retries);
      if (!closed && slot.retries < ALARM_MAX_RETRIES && readAlarm(slot.db) === null) {
        const retryAt = Date.now() + ALARM_RETRY_BASE_MS * 2 ** (slot.retries - 1);
        writeAlarm(slot.db, retryAt);
        scheduleTimer(hex, slot, retryAt);
      } else {
        slot.retries = 0;
      }
    }
  };

  const openSlot = (hex: string): ObjectSlot => {
    const existing = slots.get(hex);
    if (existing) {
      return existing;
    }
    if (closed) {
      throw new Error(`${className}: Namespace ist geschlossen.`);
    }
    const db = new DatabaseSync(join(dir, `${hex}.sqlite`));
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.exec(
      "CREATE TABLE IF NOT EXISTS _nlk_alarm (id INTEGER PRIMARY KEY CHECK (id = 1), scheduled_at INTEGER NOT NULL);"
    );
    const slot: ObjectSlot = {
      instance: undefined as unknown as DurableObjectLike,
      db,
      queue: Promise.resolve(),
      timer: undefined,
      retries: 0
    };
    // Registered before the instance exists, so a constructor may already use storage.
    slots.set(hex, slot);

    const ctx: SqliteDurableObjectState = {
      id: makeId(hex),
      storage: {
        sql: {
          exec: (query: string, ...bindings: unknown[]) => {
            if (bindings.length === 0 && isMultiStatement(query)) {
              // Several statements (e.g. schema setup) run as one script, like on Cloudflare.
              db.exec(query);
              return { toArray: () => [] };
            }
            const params = bindings.map(toSqliteValue) as SQLInputValue[];
            const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
            return { toArray: () => rows };
          }
        },
        getAlarm: async () => readAlarm(db),
        setAlarm: async (scheduledTime: number | Date) => {
          const at = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
          writeAlarm(db, at);
          scheduleTimer(hex, slot, at);
        },
        deleteAlarm: async () => {
          db.prepare("DELETE FROM _nlk_alarm WHERE id = 1").run();
          clearTimeout(slot.timer);
          slot.timer = undefined;
        }
      },
      acceptWebSocket: () => {
        throw new Error("WebSockets werden auf der Node-Laufzeit nicht unterstützt.");
      },
      getWebSockets: () => []
    };
    slot.instance = factory(ctx);
    return slot;
  };

  const hexFromName = (name: string): string =>
    createHash("sha256").update(`${className}:${name}`).digest("hex");

  const namespace = {
    idFromName: (name: string) => makeId(hexFromName(name), name),
    newUniqueId: () => makeId(randomBytes(32).toString("hex")),
    idFromString: (hex: string) => {
      if (!/^[0-9a-f]{64}$/.test(hex)) {
        throw new TypeError(`Ungültige Durable-Object-ID: '${hex}'.`);
      }
      return makeId(hex);
    },
    get: (id: { toString(): string }) => {
      const hex = id.toString();
      return {
        id,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          const slot = openSlot(hex);
          return serialize(slot, () => slot.instance.fetch(request));
        }
      };
    },
    restoreAlarms: () => {
      let restored = 0;
      for (const file of readdirSync(dir)) {
        const hex = /^([0-9a-f]{64})\.sqlite$/.exec(file)?.[1];
        if (hex === undefined) {
          continue;
        }
        const slot = openSlot(hex);
        const at = readAlarm(slot.db);
        if (at !== null) {
          scheduleTimer(hex, slot, at);
          restored += 1;
        }
      }
      return restored;
    },
    close: () => {
      closed = true;
      for (const slot of slots.values()) {
        clearTimeout(slot.timer);
        slot.db.close();
      }
      slots.clear();
    }
  };
  return namespace as unknown as InProcessNamespace;
}
