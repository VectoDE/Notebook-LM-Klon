import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteDurableObjectState } from "../durable-objects.js";
import {
  ALARM_MAX_RETRIES,
  ALARM_RETRY_BASE_MS,
  type DurableObjectFactory,
  type InProcessNamespace,
  createInProcessNamespace
} from "../node/do-namespace.js";

let dir = "";
const open: InProcessNamespace[] = [];

function namespace(factory: DurableObjectFactory, onAlarmError = vi.fn()): InProcessNamespace {
  const ns = createInProcessNamespace("TestDO", dir, factory, { onAlarmError });
  open.push(ns);
  return ns;
}

/** Test object: records requests, exposes ctx, alarm behaviour configurable per test. */
function recorder(alarm?: (ctx: SqliteDurableObjectState) => Promise<void>) {
  const contexts: SqliteDurableObjectState[] = [];
  const calls: string[] = [];
  const factory: DurableObjectFactory = (ctx) => {
    contexts.push(ctx);
    return {
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        calls.push(`${request.method} ${url.pathname}`);
        if (url.pathname === "/slow") {
          await new Promise((r) => setTimeout(r, 30));
        }
        if (url.pathname === "/fail") {
          throw new Error("boom");
        }
        return new Response(ctx.id.toString());
      },
      ...(alarm ? { alarm: () => alarm(ctx) } : {})
    };
  };
  return { factory, contexts, calls };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nlk-do-"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const ns of open.splice(0)) {
    ns.close();
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("in-process Durable Object namespace (#330)", () => {
  it("derives stable ids per class and name, and validates idFromString", () => {
    const ns = namespace(recorder().factory);
    const a = ns.idFromName("nb_1");
    expect(a.toString()).toMatch(/^[0-9a-f]{64}$/);
    expect(a.name).toBe("nb_1");
    expect(a.equals(ns.idFromName("nb_1"))).toBe(true);
    expect(a.equals(ns.idFromName("nb_2"))).toBe(false);
    const other = createInProcessNamespace("OtherDO", dir, recorder().factory);
    open.push(other);
    expect(other.idFromName("nb_1").toString()).not.toBe(a.toString());

    const unique = ns.newUniqueId();
    expect(unique.toString()).toMatch(/^[0-9a-f]{64}$/);
    expect(unique.name).toBeUndefined();
    expect(ns.idFromString(a.toString()).equals(a)).toBe(true);
    expect(() => ns.idFromString("../etc")).toThrow(TypeError);
  });

  it("creates one instance per object, keeps it, and stores its data in a file per object", async () => {
    const r = recorder();
    const ns = namespace(r.factory);
    const id = ns.idFromName("nb_1");
    const stub = ns.get(id);
    expect(stub.id).toBe(id);
    expect(await (await stub.fetch("http://do/a")).text()).toBe(id.toString());
    await ns.get(ns.idFromName("nb_1")).fetch(new Request("http://do/b", { method: "POST" }));
    await ns.get(ns.idFromName("nb_2")).fetch(new URL("http://do/c"));
    expect(r.contexts).toHaveLength(2);
    expect(r.calls).toEqual(["GET /a", "POST /b", "GET /c"]);
    expect(existsSync(join(dir, `${id.toString()}.sqlite`))).toBe(true);
  });

  it("runs requests to one object one after another (input gate), errors do not block", async () => {
    const r = recorder();
    const ns = namespace(r.factory);
    const stub = ns.get(ns.idFromName("nb_1"));
    const slow = stub.fetch("http://do/slow");
    const failing = stub.fetch("http://do/fail");
    const fast = stub.fetch("http://do/fast");
    await slow;
    await expect(failing).rejects.toThrow("boom");
    await fast;
    expect(r.calls).toEqual(["GET /slow", "GET /fail", "GET /fast"]);
  });

  it("offers SQL storage with bindings and multi-statement scripts", async () => {
    const r = recorder();
    const ns = namespace(r.factory);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/init");
    const sql = r.contexts[0]?.storage.sql;
    expect(
      sql?.exec("CREATE TABLE t (id INTEGER, flag INTEGER); CREATE INDEX t_id ON t(id);").toArray()
    ).toEqual([]);
    sql?.exec("INSERT INTO t (id, flag) VALUES (?, ?)", 1, true);
    expect(sql?.exec("SELECT id, flag FROM t WHERE id = ?;", 1).toArray()).toEqual([
      { id: 1, flag: 1 }
    ]);
    expect(() => sql?.exec("SELECT ?", undefined)).toThrow();
  });

  it("has no WebSocket hibernation on Node", async () => {
    const r = recorder();
    const ns = namespace(r.factory);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/x");
    const ctx = r.contexts[0] as SqliteDurableObjectState;
    expect(ctx.getWebSockets()).toEqual([]);
    expect(() => ctx.acceptWebSocket({} as WebSocket)).toThrow(/WebSockets/);
  });

  it("lets a constructor use storage right away", async () => {
    const ns = namespace((ctx) => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS boot (x INTEGER)");
      return { fetch: async () => new Response("ok") };
    });
    expect(await (await ns.get(ns.idFromName("a")).fetch("http://do/")).text()).toBe("ok");
  });

  it("stores, reads, fires and deletes alarms", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const fired: number[] = [];
    const r = recorder(async () => {
      fired.push(Date.now());
    });
    const ns = namespace(r.factory);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/x");
    const storage = (r.contexts[0] as SqliteDurableObjectState).storage;

    await storage.setAlarm(new Date(1_005_000));
    expect(await storage.getAlarm()).toBe(1_005_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fired).toEqual([1_005_000]);
    expect(await storage.getAlarm()).toBeNull();

    await storage.setAlarm(1_010_000);
    await storage.deleteAlarm();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fired).toHaveLength(1);
  });

  it("re-checks alarms beyond the setTimeout limit and skips alarms removed meanwhile", async () => {
    vi.useFakeTimers({ now: 0 });
    const fired = vi.fn(async () => {});
    const r = recorder(fired);
    const ns = namespace(r.factory);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/x");
    const ctx = r.contexts[0] as SqliteDurableObjectState;

    const far = 2 ** 31 + 1_000;
    await ctx.storage.setAlarm(far);
    await vi.advanceTimersByTimeAsync(2 ** 31 - 1);
    expect(fired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(fired).toHaveBeenCalledOnce();

    await ctx.storage.setAlarm(Date.now() + 100);
    ctx.storage.sql.exec("DELETE FROM _nlk_alarm");
    await vi.advanceTimersByTimeAsync(200);
    expect(fired).toHaveBeenCalledOnce();
  });

  it("retries a failing alarm with exponential backoff, at most 6 attempts", async () => {
    vi.useFakeTimers({ now: 0 });
    const onAlarmError = vi.fn();
    const r = recorder(async () => {
      throw new Error("alarm failed");
    });
    const ns = namespace(r.factory, onAlarmError);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/x");
    const storage = (r.contexts[0] as SqliteDurableObjectState).storage;

    await storage.setAlarm(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(onAlarmError).toHaveBeenCalledTimes(1);
    expect(await storage.getAlarm()).toBe(ALARM_RETRY_BASE_MS);
    await vi.advanceTimersByTimeAsync(ALARM_RETRY_BASE_MS);
    expect(onAlarmError).toHaveBeenCalledTimes(2);
    expect(await storage.getAlarm()).toBe(ALARM_RETRY_BASE_MS * 3);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(onAlarmError).toHaveBeenCalledTimes(ALARM_MAX_RETRIES);
    expect(onAlarmError).toHaveBeenLastCalledWith(
      expect.any(Error),
      expect.stringMatching(/^[0-9a-f]{64}$/),
      ALARM_MAX_RETRIES
    );
    expect(await storage.getAlarm()).toBeNull();
  });

  it("resets the retry counter after a successful run", async () => {
    vi.useFakeTimers({ now: 0 });
    let failures = 1;
    const onAlarmError = vi.fn();
    const r = recorder(async () => {
      if (failures-- > 0) throw new Error("once");
    });
    const ns = namespace(r.factory, onAlarmError);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/x");
    const storage = (r.contexts[0] as SqliteDurableObjectState).storage;
    await storage.setAlarm(0);
    await vi.advanceTimersByTimeAsync(ALARM_RETRY_BASE_MS);
    failures = 1;
    await storage.setAlarm(Date.now());
    await vi.advanceTimersByTimeAsync(0);
    expect(onAlarmError.mock.calls.map((c) => c[2])).toEqual([1, 1]);
  });

  it("keeps an alarm the failing handler set itself instead of retrying", async () => {
    vi.useFakeTimers({ now: 0 });
    const onAlarmError = vi.fn();
    const r = recorder(async (ctx) => {
      await ctx.storage.setAlarm(50_000);
      throw new Error("after reschedule");
    });
    const ns = namespace(r.factory, onAlarmError);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/x");
    const storage = (r.contexts[0] as SqliteDurableObjectState).storage;
    await storage.setAlarm(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(onAlarmError).toHaveBeenCalledTimes(1);
    expect(await storage.getAlarm()).toBe(50_000);
  });

  it("does not retry when the namespace closes while an alarm runs", async () => {
    let release: () => void = () => {};
    const onAlarmError = vi.fn();
    const r = recorder(
      () =>
        new Promise<void>((_, reject) => {
          release = () => reject(new Error("late"));
        })
    );
    const ns = namespace(r.factory, onAlarmError);
    await ns.get(ns.idFromName("nb_1")).fetch("http://do/x");
    await (r.contexts[0] as SqliteDurableObjectState).storage.setAlarm(Date.now());
    await new Promise((res) => setTimeout(res, 20));
    ns.close();
    release();
    await new Promise((res) => setTimeout(res, 0));
    expect(onAlarmError).toHaveBeenCalledOnce();
  });

  it("re-arms persisted alarms after a restart and runs objects without alarm() handler", async () => {
    const before = recorder(async () => {});
    const first = namespace(before.factory);
    await first.get(first.idFromName("pending")).fetch("http://do/x");
    await first.get(first.idFromName("idle")).fetch("http://do/x");
    await (before.contexts[0] as SqliteDurableObjectState).storage.setAlarm(Date.now() + 20);
    first.close();
    writeFileSync(join(dir, "notes.txt"), "not an object");

    const fired = vi.fn(async () => {});
    const after = recorder(fired);
    const second = namespace(after.factory);
    expect(second.restoreAlarms()).toBe(1);
    await vi.waitFor(() => expect(fired).toHaveBeenCalledOnce(), { timeout: 2_000 });

    // An object class without alarm(): the alarm passes without error.
    const plain = namespace((ctx) => ({
      fetch: async () => {
        await ctx.storage.setAlarm(Date.now());
        return new Response("set");
      }
    }));
    await plain.get(plain.idFromName("p")).fetch("http://do/");
    await new Promise((res) => setTimeout(res, 20));
  });

  it("refuses requests after close and logs alarm errors to the console by default", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ns = createInProcessNamespace("TestDO", dir, (ctx) => ({
        fetch: async () => {
          await ctx.storage.setAlarm(Date.now());
          return new Response("ok");
        },
        alarm: async () => {
          throw new Error("x");
        }
      }));
      await ns.get(ns.idFromName("a")).fetch("http://do/");
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(expect.stringContaining('"event":"do_alarm_failed"'))
      );
      ns.close();
      await expect(ns.get(ns.idFromName("b")).fetch("http://do/")).rejects.toThrow(
        /Namespace ist geschlossen/
      );
    } finally {
      error.mockRestore();
    }
  });
});
