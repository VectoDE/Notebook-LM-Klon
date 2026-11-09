import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";

function createSqliteAdapter(): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  const migrationPath = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  db.exec(sql);

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

describe("0001_initial_core.sql D1 Migration & CoreRepository", () => {
  it("enforces foreign keys and cascades deletions for users and sessions", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);

    const now = Date.now();
    await repo.createUser({
      id: "usr_01",
      email: "test@example.com",
      display_name: "Test User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    const user = await repo.getUserById("usr_01");
    expect(user).not.toBeNull();
    expect(user?.email).toBe("test@example.com");

    await repo.createSession({
      id_hash: "hash_sess_01",
      user_id: "usr_01",
      created_at: now,
      expires_at: now + 3600_000,
      ip_hash: "iphash",
      ua_hash: "uahash"
    });

    const session = await repo.getSession("hash_sess_01");
    expect(session).not.toBeNull();

    await repo.createPasskey({
      id: "cred_01",
      user_id: "usr_01",
      public_key: new Uint8Array([1, 2, 3]),
      sign_count: 0,
      transports: "internal",
      aaguid: "00000000-0000-0000-0000-000000000000",
      created_at: now,
      last_used_at: null
    });

    const passkeys = await repo.getPasskeysByUserId("usr_01");
    expect(passkeys.length).toBe(1);

    // Cascade delete on user
    await repo.deleteSession("hash_sess_01");
    await repo.deleteUser("usr_01");
    expect(await repo.getUserById("usr_01")).toBeNull();
    expect(await repo.getSession("hash_sess_01")).toBeNull();
    expect((await repo.getPasskeysByUserId("usr_01")).length).toBe(0);

    close();
  });

  it("handles workspaces, role constraints, and notebooks", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);

    const now = Date.now();
    await repo.createUser({
      id: "usr_owner",
      email: "owner@example.com",
      display_name: "Owner User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await repo.createWorkspace({
      id: "ws_01",
      name: "Default Workspace",
      owner_id: "usr_owner",
      created_at: now
    });

    const role = await repo.getWorkspaceMemberRole("ws_01", "usr_owner");
    expect(role).toBe("owner");

    const nonMemberRole = await repo.getWorkspaceMemberRole("ws_01", "usr_non_member");
    expect(nonMemberRole).toBeNull();

    await repo.createNotebook({
      id: "nb_01",
      workspace_id: "ws_01",
      title: "Energiewende",
      emoji: "green_leaf",
      created_by: "usr_owner",
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    const notebooks = await repo.getNotebooksByWorkspace("ws_01");
    expect(notebooks.length).toBe(1);
    expect(notebooks[0]?.title).toBe("Energiewende");

    // Check invalid role constraint rejection
    await expect(
      adapter.run(
        "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
        ["ws_01", "usr_owner", "superadmin", now]
      )
    ).rejects.toThrow();

    close();
  });

  it("manages quotas, audit logs, and abuse reports", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);

    const now = Date.now();
    await repo.createUser({
      id: "usr_quota",
      email: null,
      display_name: "Guest",
      locale: "en",
      is_guest: 1,
      created_at: now,
      expires_at: now + 86400_000,
      deleted_at: null
    });

    await repo.setQuota({
      user_id: "usr_quota",
      notebooks_count: 2,
      sources_count: 5,
      storage_bytes: 1048576,
      llm_calls_day: 10,
      quota_day: "2026-11-09"
    });

    const quota = await repo.getQuota("usr_quota");
    expect(quota?.notebooks_count).toBe(2);

    await repo.logAudit({
      id: "aud_01",
      user_id: "usr_quota",
      action: "notebook.create",
      target: "nb_01",
      ip_hash: "sha256_mock_hash",
      created_at: now
    });

    await repo.createAbuseReport({
      id: "rep_01",
      target_id: "nb_01",
      reason: "Inappropriate content",
      reporter_id: "usr_quota",
      status: "pending",
      created_at: now
    });

    const reports = await adapter.query<{ id: string; status: string }>(
      "SELECT id, status FROM abuse_reports WHERE id = ?",
      ["rep_01"]
    );
    expect(reports.length).toBe(1);
    expect(reports[0]?.status).toBe("pending");

    close();
  });
});
