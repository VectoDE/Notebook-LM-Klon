import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { type CleanupMetrics, type MinimalR2Bucket, runScheduledCleanup } from "../cleanup.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { scheduled } from "../index.js";

function createSqliteAdapter(): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  for (const file of ["0001_initial_core.sql", "0003_webauthn_challenges.sql"]) {
    db.exec(readFileSync(resolve(process.cwd(), "apps/worker/migrations", file), "utf-8"));
  }

  const adapter: DatabaseAdapter = {
    async exec(sqlStr: string): Promise<void> {
      db.exec(sqlStr);
    },
    async query<T>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(sqlStr);
      return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
    },
    async queryOne<T>(sqlStr: string, params: unknown[] = []): Promise<T | null> {
      const stmt = db.prepare(sqlStr);
      const row = stmt.get(...(params as (string | number | bigint | null)[]));
      return (row as T) ?? null;
    },
    async run(sqlStr: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = db.prepare(sqlStr);
      const info = stmt.run(...(params as (string | number | bigint | null)[]));
      return { changes: Number(info.changes) };
    }
  };

  return { adapter, close: () => db.close() };
}

class MockR2Bucket implements MinimalR2Bucket {
  public objects = new Map<string, string>();

  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const prefix = options?.prefix ?? "";
    const matching: Array<{ key: string }> = [];
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        matching.push({ key });
      }
    }
    // Simulate pagination if cursor is requested or 2 items present
    if (!options?.cursor && matching.length > 1) {
      return {
        objects: matching.slice(0, 1),
        truncated: true,
        cursor: "cursor_page_2"
      };
    }
    return {
      objects: options?.cursor ? matching.slice(1) : matching,
      truncated: false
    };
  }

  async delete(keys: string[] | string) {
    const toDelete = Array.isArray(keys) ? keys : [keys];
    for (const k of toDelete) {
      this.objects.delete(k);
    }
  }
}

describe("Scheduled Cron Cleanup (Sub-Issues #74, #75, #76)", () => {
  it("cleans up expired guests, sessions, magic links and R2 objects while preserving active ones (#74, #75)", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const mockR2 = new MockR2Bucket();

    const t0 = 1700000000000;
    const now = t0 + 25 * 3600 * 1000; // 25 hours later

    // 1. Expired guest
    const expiredGuestId = "usr_guest_expired";
    await repo.createUser({
      id: expiredGuestId,
      email: null,
      display_name: "Abgelaufener Gast",
      locale: "de",
      is_guest: 1,
      created_at: t0,
      expires_at: t0 + 24 * 3600 * 1000, // expired 1 hour ago
      deleted_at: null
    });
    const expiredWsId = "ws_guest_expired";
    await repo.createWorkspace({
      id: expiredWsId,
      name: "Gast Workspace",
      owner_id: expiredGuestId,
      created_at: t0
    });
    const expiredNbId = "nb_guest_expired";
    await repo.createNotebook({
      id: expiredNbId,
      workspace_id: expiredWsId,
      title: "Gast Notizbuch",
      emoji: "",
      created_by: expiredGuestId,
      created_at: t0,
      updated_at: t0,
      expires_at: null
    });

    // Seed R2 files for expired guest
    mockR2.objects.set(`users/${expiredGuestId}/avatar.png`, "data");
    mockR2.objects.set(`notebooks/${expiredNbId}/source_1.pdf`, "data");

    // 2. Active guest
    const activeGuestId = "usr_guest_active";
    await repo.createUser({
      id: activeGuestId,
      email: null,
      display_name: "Aktiver Gast",
      locale: "de",
      is_guest: 1,
      created_at: now - 3600 * 1000,
      expires_at: now + 23 * 3600 * 1000, // expires in 23 hours
      deleted_at: null
    });
    const activeWsId = "ws_guest_active";
    await repo.createWorkspace({
      id: activeWsId,
      name: "Aktiver Workspace",
      owner_id: activeGuestId,
      created_at: now
    });
    const activeNbId = "nb_guest_active";
    await repo.createNotebook({
      id: activeNbId,
      workspace_id: activeWsId,
      title: "Aktives Notizbuch",
      emoji: "",
      created_by: activeGuestId,
      created_at: now,
      updated_at: now,
      expires_at: null
    });
    mockR2.objects.set(`users/${activeGuestId}/avatar.png`, "active-data");
    mockR2.objects.set(`notebooks/${activeNbId}/source_1.pdf`, "active-data");

    // 3. Permanent user with expired demo notebook
    const permUserId = "usr_permanent";
    await repo.createUser({
      id: permUserId,
      email: "perm@example.com",
      display_name: "Dauergast",
      locale: "de",
      is_guest: 0,
      created_at: t0,
      expires_at: null,
      deleted_at: null
    });
    const permWsId = "ws_perm";
    await repo.createWorkspace({
      id: permWsId,
      name: "Perm Workspace",
      owner_id: permUserId,
      created_at: t0
    });
    const expiredDemoNbId = "nb_expired_demo";
    await repo.createNotebook({
      id: expiredDemoNbId,
      workspace_id: permWsId,
      title: "Abgelaufenes Demo Notizbuch",
      emoji: "",
      created_by: permUserId,
      created_at: t0,
      updated_at: t0,
      expires_at: t0 + 1000 // expired long ago
    });
    mockR2.objects.set(`notebooks/${expiredDemoNbId}/doc.pdf`, "demo-data");

    // 4. Expired and active sessions
    await repo.createSession({
      id_hash: "sess_expired_hash",
      user_id: activeGuestId,
      created_at: t0,
      expires_at: now - 1000,
      ip_hash: null,
      ua_hash: null
    });
    await repo.createSession({
      id_hash: "sess_active_hash",
      user_id: activeGuestId,
      created_at: now,
      expires_at: now + 3600 * 1000,
      ip_hash: null,
      ua_hash: null
    });

    // 5. Expired and active magic links
    await adapter.run(
      "INSERT INTO magic_links (token_hash, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)",
      ["ml_expired", "test@example.com", t0, now - 500, null]
    );
    await adapter.run(
      "INSERT INTO magic_links (token_hash, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)",
      ["ml_active", "test@example.com", now, now + 15 * 60 * 1000, null]
    );

    // 6. Expired (also exactly at expiry) and active WebAuthn challenges
    const insertChallenge = (key: string, expiresAt: number) =>
      adapter.run(
        "INSERT INTO webauthn_challenges (challenge_key, challenge, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        [key, `c_${key}`, null, t0, expiresAt]
      );
    await insertChallenge("login:old", now - 1);
    await insertChallenge("login:edge", now);
    await insertChallenge("login:fresh", now + 60_000);

    // Run scheduled cleanup
    const metrics: CleanupMetrics = await runScheduledCleanup({
      db: adapter,
      mediaBucket: mockR2,
      now
    });

    // Verify metrics
    expect(metrics.deletedGuests).toBe(1);
    expect(metrics.deletedNotebooks).toBe(2); // 1 guest notebook + 1 expired demo notebook
    expect(metrics.deletedSessions).toBe(1);
    expect(metrics.deletedMagicLinks).toBe(1);
    expect(metrics.deletedChallenges).toBe(2);
    expect(
      await adapter.query<{ challenge_key: string }>(
        "SELECT challenge_key FROM webauthn_challenges"
      )
    ).toEqual([{ challenge_key: "login:fresh" }]);
    expect(metrics.deletedR2Objects).toBe(3); // 2 from expired guest + 1 from demo notebook

    // Verify DB states
    expect(await repo.getUserById(expiredGuestId)).toBeNull();
    expect(await repo.getNotebookById(expiredNbId)).toBeNull();
    expect(await repo.getUserById(activeGuestId)).not.toBeNull();
    expect(await repo.getNotebookById(activeNbId)).not.toBeNull();
    expect(await repo.getNotebookById(expiredDemoNbId)).toBeNull();
    expect(await repo.getUserById(permUserId)).not.toBeNull();

    // Verify R2 states
    expect(mockR2.objects.has(`users/${expiredGuestId}/avatar.png`)).toBe(false);
    expect(mockR2.objects.has(`notebooks/${expiredNbId}/source_1.pdf`)).toBe(false);
    expect(mockR2.objects.has(`notebooks/${expiredDemoNbId}/doc.pdf`)).toBe(false);
    expect(mockR2.objects.has(`users/${activeGuestId}/avatar.png`)).toBe(true);
    expect(mockR2.objects.has(`notebooks/${activeNbId}/source_1.pdf`)).toBe(true);

    close();
  });

  it("handles empty database and handles missing media bucket gracefully", async () => {
    const { adapter, close } = createSqliteAdapter();
    const metrics = await runScheduledCleanup({
      db: adapter,
      mediaBucket: null,
      now: Date.now()
    });

    expect(metrics.deletedGuests).toBe(0);
    expect(metrics.deletedSessions).toBe(0);
    expect(metrics.deletedMagicLinks).toBe(0);
    expect(metrics.deletedChallenges).toBe(0);
    expect(metrics.deletedNotebooks).toBe(0);
    expect(metrics.deletedR2Objects).toBe(0);
    expect(metrics.durationMs).toBeGreaterThanOrEqual(0);

    close();
  });

  it("handles scheduled cleanup with media bucket for standalone expired demo notebook", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const mockR2 = new MockR2Bucket();
    const now = Date.now();

    await repo.createUser({
      id: "usr_perm_owner",
      email: "perm@example.com",
      display_name: "Perm Owner",
      locale: "de",
      is_guest: 0,
      created_at: now - 86400_000 * 50,
      expires_at: null,
      deleted_at: null
    });

    await repo.createWorkspace({
      id: "ws_perm_demo",
      name: "Perm Workspace",
      owner_id: "usr_perm_owner",
      created_at: now - 86400_000 * 50
    });

    const expiredNbId = "nb_standalone_expired_demo";
    await repo.createNotebook({
      id: expiredNbId,
      workspace_id: "ws_perm_demo",
      title: "Expired Standalone Demo",
      emoji: "demo",
      created_by: "usr_perm_owner",
      created_at: now - 86400_000 * 35,
      updated_at: now - 86400_000 * 35,
      expires_at: now - 1000
    });

    mockR2.objects.set(`notebooks/${expiredNbId}/doc.pdf`, "content");

    const metrics = await runScheduledCleanup({
      db: adapter,
      mediaBucket: mockR2,
      now
    });

    expect(metrics.deletedGuests).toBe(0);
    expect(metrics.deletedNotebooks).toBe(1);
    expect(metrics.deletedR2Objects).toBe(1);
    expect(mockR2.objects.has(`notebooks/${expiredNbId}/doc.pdf`)).toBe(false);

    close();
  });

  it("handles scheduled cleanup without media bucket for expired guests and notebooks", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const now = Date.now();

    await repo.createUser({
      id: "usr_guest_no_media",
      email: null,
      display_name: "Guest No Media",
      locale: "de",
      is_guest: 1,
      created_at: now - 86400_000 * 2,
      expires_at: now - 1000,
      deleted_at: null
    });

    await repo.createWorkspace({
      id: "ws_guest_no_media",
      name: "Workspace No Media",
      owner_id: "usr_guest_no_media",
      created_at: now - 86400_000 * 2
    });

    await repo.createUser({
      id: "usr_perm_no_media",
      email: "perm_no_media@example.com",
      display_name: "Perm No Media",
      locale: "de",
      is_guest: 0,
      created_at: now - 86400_000 * 10,
      expires_at: null,
      deleted_at: null
    });

    await repo.createWorkspace({
      id: "ws_perm_no_media",
      name: "Perm Workspace No Media",
      owner_id: "usr_perm_no_media",
      created_at: now - 86400_000 * 10
    });

    await repo.createNotebook({
      id: "nb_demo_no_media",
      workspace_id: "ws_perm_no_media",
      title: "Demo No Media",
      emoji: "demo",
      created_by: "usr_perm_no_media",
      created_at: now - 86400_000 * 35,
      updated_at: now - 86400_000 * 35,
      expires_at: now - 1000
    });

    const metrics = await runScheduledCleanup({
      db: adapter,
      mediaBucket: null,
      now
    });

    expect(metrics.deletedGuests).toBe(1);
    expect(metrics.deletedNotebooks).toBe(1);
    expect(metrics.deletedR2Objects).toBe(0);

    close();
  });

  it("handles empty R2 list result when purging prefix", async () => {
    const mockR2Empty: MinimalR2Bucket = {
      list: async () => ({
        objects: [],
        truncated: false
      }),
      delete: async () => {}
    };

    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const now = Date.now();

    await repo.createUser({
      id: "usr_guest_empty_r2",
      email: null,
      display_name: "Guest Empty R2",
      locale: "de",
      is_guest: 1,
      created_at: now - 86400_000 * 2,
      expires_at: now - 1000,
      deleted_at: null
    });

    const metrics = await runScheduledCleanup({
      db: adapter,
      mediaBucket: mockR2Empty,
      now
    });

    expect(metrics.deletedGuests).toBe(1);
    expect(metrics.deletedR2Objects).toBe(0);

    close();
  });

  it("handles pagination when purging R2 prefix with cursor", async () => {
    let callCount = 0;
    const mockR2WithCursor: MinimalR2Bucket = {
      list: async (opts) => {
        callCount++;
        if (callCount === 1) {
          expect(opts?.cursor).toBeUndefined();
          return {
            objects: [{ key: "users/usr_guest_paginated/doc1.pdf" }],
            truncated: true,
            cursor: "cursor_page_2"
          };
        }
        expect(opts?.cursor).toBe("cursor_page_2");
        return {
          objects: [{ key: "users/usr_guest_paginated/doc2.pdf" }],
          truncated: false
        };
      },
      delete: async () => {}
    };

    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const now = Date.now();

    await repo.createUser({
      id: "usr_guest_paginated",
      email: null,
      display_name: "Paginated Guest",
      locale: "de",
      is_guest: 1,
      created_at: now - 86400_000 * 2,
      expires_at: now - 1000,
      deleted_at: null
    });

    const metrics = await runScheduledCleanup({
      db: adapter,
      mediaBucket: mockR2WithCursor,
      now
    });

    expect(metrics.deletedGuests).toBe(1);
    expect(metrics.deletedR2Objects).toBe(2);
    expect(callCount).toBe(2);

    close();
  });

  it("handles scheduled execution without MEDIA binding", async () => {
    const { adapter, close } = createSqliteAdapter();
    const d1DatabaseMock = {
      exec: async (sql: string) => {
        await adapter.exec(sql);
      },
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          all: async <T>() => ({ results: await adapter.query<T>(sql, params) }),
          first: async <T>() => await adapter.queryOne<T>(sql, params),
          run: async () => {
            const res = await adapter.run(sql, params);
            return { meta: { changes: res.changes } };
          }
        })
      })
    };

    const mockEnvNoMedia = {
      DB: d1DatabaseMock as unknown as D1Database
    } as Env;

    const waitUntilPromises: Promise<unknown>[] = [];
    const mockCtx = {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
      passThroughOnException: () => {}
    } as unknown as ExecutionContext;

    const mockController = {
      scheduledTime: Date.now(),
      cron: "0 * * * *",
      noRetry: () => {}
    } as unknown as ScheduledController;

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await scheduled(mockController, mockEnvNoMedia, mockCtx);
    await Promise.all(waitUntilPromises);

    expect(infoSpy).toHaveBeenCalled();
    infoSpy.mockRestore();
    close();
  });

  it("wires worker scheduled() handler and logs structured audit event (#76)", async () => {
    const { adapter, close } = createSqliteAdapter();
    const mockR2 = new MockR2Bucket();

    const d1DatabaseMock = {
      exec: async (sql: string) => {
        await adapter.exec(sql);
      },
      prepare: (sql: string) => {
        return {
          bind: (...params: unknown[]) => ({
            all: async <T>() => ({ results: await adapter.query<T>(sql, params) }),
            first: async <T>() => await adapter.queryOne<T>(sql, params),
            run: async () => {
              const res = await adapter.run(sql, params);
              return { meta: { changes: res.changes } };
            }
          })
        };
      }
    };

    const mockEnv = {
      DB: d1DatabaseMock as unknown as D1Database,
      MEDIA: mockR2 as unknown as R2Bucket
    } as Env;

    const waitUntilPromises: Promise<unknown>[] = [];
    const mockCtx = {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p);
      },
      passThroughOnException: () => {}
    } as unknown as ExecutionContext;

    const mockController = {
      scheduledTime: Date.now(),
      cron: "0 * * * *",
      noRetry: () => {}
    } as unknown as ScheduledController;

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await scheduled(mockController, mockEnv, mockCtx);
    await Promise.all(waitUntilPromises);

    expect(infoSpy).toHaveBeenCalled();
    const loggedCall = infoSpy.mock.calls[0]?.[0];
    expect(typeof loggedCall).toBe("string");
    const parsed = JSON.parse(loggedCall as string) as {
      event: string;
      metrics: CleanupMetrics;
    };
    expect(parsed.event).toBe("scheduled_cleanup_completed");
    expect(parsed.metrics).toBeDefined();

    // Verify adapter exercises queryOne and exec paths directly
    const defaultExport = (await import("../index.js")).default;
    expect(defaultExport.fetch).toBeDefined();
    expect(defaultExport.scheduled).toBeDefined();

    infoSpy.mockRestore();
    close();
  });
});
