import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BatchStatement,
  D1_MAX_BOUND_IDS,
  type MinimalR2Bucket,
  createNotebookStatePurger,
  drainPendingR2,
  purgeUsers,
  runScheduledCleanup
} from "../cleanup.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";

class MemoryBucket implements MinimalR2Bucket {
  readonly objects = new Map<string, string>();
  failDeletes = false;

  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? "";
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    return { objects: keys.map((key) => ({ key })), truncated: false };
  }

  async delete(keys: string[] | string): Promise<void> {
    if (this.failDeletes) {
      throw new Error("R2 nicht erreichbar");
    }
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }
}

/** Wirft, sobald eine Anfrage mehr als 100 Parameter bindet (Grenze von Cloudflare D1). */
function enforceD1ParamLimit(inner: DatabaseAdapter): DatabaseAdapter {
  const check = (params: unknown[] | undefined): void => {
    if ((params?.length ?? 0) > 100) {
      throw new Error(`D1: too many bound parameters (${params?.length})`);
    }
  };
  return {
    exec: (sql) => inner.exec(sql),
    query: <T>(sql: string, params?: unknown[]) => {
      check(params);
      return inner.query<T>(sql, params);
    },
    queryOne: <T>(sql: string, params?: unknown[]) => {
      check(params);
      return inner.queryOne<T>(sql, params);
    },
    run: (sql, params) => {
      check(params);
      return inner.run(sql, params);
    },
    execBatch: async (statements) => {
      for (const statement of statements) {
        check(statement.params);
      }
      await inner.execBatch?.(statements);
    }
  };
}

interface Fixture {
  sqlite: DatabaseSync;
  db: DatabaseAdapter;
  repo: CoreRepository;
  bucket: MemoryBucket;
  dataDir: string;
  now: number;
}

function count(fx: Fixture, sql: string, ...params: (string | number)[]): number {
  return Number((fx.sqlite.prepare(sql).get(...params) as { n: number }).n);
}

async function seedUser(fx: Fixture, id: string, isGuest = 0): Promise<void> {
  await fx.repo.createUser({
    id,
    email: isGuest ? null : `${id}@example.test`,
    display_name: id,
    locale: "de",
    is_guest: isGuest,
    created_at: fx.now,
    expires_at: isGuest ? fx.now - 1 : null,
    deleted_at: null
  });
}

async function seedWorkspace(fx: Fixture, id: string, owner: string): Promise<void> {
  await fx.repo.createWorkspace({ id, name: id, owner_id: owner, created_at: fx.now });
}

async function seedMember(
  fx: Fixture,
  workspace: string,
  user: string,
  role: "owner" | "editor" | "viewer",
  createdAt: number
): Promise<void> {
  await fx.db.run(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    [workspace, user, role, createdAt]
  );
}

async function seedNotebook(
  fx: Fixture,
  id: string,
  workspace: string,
  createdBy: string
): Promise<void> {
  await fx.repo.createNotebook({
    id,
    workspace_id: workspace,
    title: id,
    emoji: "",
    created_by: createdBy,
    created_at: fx.now,
    updated_at: fx.now,
    expires_at: null
  });
}

async function createFixture(): Promise<Fixture> {
  const dataDir = mkdtempSync(join(tmpdir(), "account-purge-"));
  const sqlite = new DatabaseSync(":memory:");
  runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
  const { env } = createNodeEnv({ db: sqlite, dataDir, sessionSaltSecret: "test-salt-purge" });
  const db = enforceD1ParamLimit(createD1DatabaseAdapter(env.DB));
  return {
    sqlite,
    db,
    repo: new CoreRepository(db),
    bucket: new MemoryBucket(),
    dataDir,
    now: 1_700_000_000_000
  };
}

describe("purgeUsers: Übergabe und Anonymisierung (F361, F365)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await createFixture();
  });

  afterEach(() => {
    fx.sqlite.close();
    rmSync(fx.dataDir, { recursive: true, force: true });
  });

  it("legt das Platzhalterkonto per Migration an und sperrt die Anmeldung damit", async () => {
    const row = fx.sqlite.prepare("SELECT * FROM users WHERE id = 'user_deleted'").get() as {
      email: string | null;
      deleted_at: number | null;
      is_guest: number;
    };
    expect(row.email).toBeNull();
    expect(row.deleted_at).not.toBeNull();
    expect(row.is_guest).toBe(0);
    expect(await fx.repo.getUserById("user_deleted")).toBeNull();
  });

  it("übergibt einen eigenen Arbeitsbereich an das am längsten beteiligte Admin-Mitglied", async () => {
    for (const id of ["alice", "carol", "dave", "erin"]) {
      await seedUser(fx, id);
    }
    await seedWorkspace(fx, "ws_a", "alice");
    await seedMember(fx, "ws_a", "carol", "editor", fx.now + 1);
    await seedMember(fx, "ws_a", "erin", "owner", fx.now + 20);
    await seedMember(fx, "ws_a", "dave", "owner", fx.now + 10);
    await seedNotebook(fx, "nb_alice", "ws_a", "alice");
    await seedNotebook(fx, "nb_carol", "ws_a", "carol");
    fx.bucket.objects.set("notebooks/nb_alice/s.txt", "x");

    const res = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(res).toMatchObject({
      deletedUsers: 1,
      deletedNotebooks: 0,
      transferredWorkspaces: 1,
      pendingR2Prefixes: 0
    });
    const ws = fx.sqlite.prepare("SELECT owner_id FROM workspaces WHERE id = 'ws_a'").get() as {
      owner_id: string;
    };
    expect(ws.owner_id).toBe("dave");
    // Notebooks bleiben, auch die der gelöschten Person, deren Eigentümer wechselt
    expect(fx.sqlite.prepare("SELECT id, created_by FROM notebooks ORDER BY id").all()).toEqual([
      { id: "nb_alice", created_by: "dave" },
      { id: "nb_carol", created_by: "carol" }
    ]);
    // Die Dateien der übergebenen Notebooks bleiben erhalten
    expect(fx.bucket.objects.has("notebooks/nb_alice/s.txt")).toBe(true);
    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE id = 'alice'")).toBe(0);
  });

  it("übergibt an das älteste Mitglied, wenn es keinen weiteren Admin gibt", async () => {
    for (const id of ["alice", "carol", "dave"]) {
      await seedUser(fx, id);
    }
    await seedWorkspace(fx, "ws_a", "alice");
    await seedMember(fx, "ws_a", "dave", "viewer", fx.now + 50);
    await seedMember(fx, "ws_a", "carol", "editor", fx.now + 5);

    await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    const ws = fx.sqlite.prepare("SELECT owner_id FROM workspaces WHERE id = 'ws_a'").get() as {
      owner_id: string;
    };
    expect(ws.owner_id).toBe("carol");
    const role = fx.sqlite
      .prepare(
        "SELECT role FROM workspace_members WHERE workspace_id = 'ws_a' AND user_id = 'carol'"
      )
      .get() as { role: string };
    expect(role.role).toBe("owner");
  });

  it("löscht nur Arbeitsbereiche ohne weitere Mitglieder samt Notebooks und Dateien", async () => {
    await seedUser(fx, "alice");
    await seedWorkspace(fx, "ws_a", "alice");
    await seedNotebook(fx, "nb_alice", "ws_a", "alice");
    fx.bucket.objects.set("notebooks/nb_alice/s.txt", "x");
    fx.bucket.objects.set("users/alice/avatar.png", "x");

    const res = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(res).toMatchObject({
      deletedNotebooks: 1,
      deletedR2Objects: 2,
      transferredWorkspaces: 0
    });
    expect(count(fx, "SELECT COUNT(*) AS n FROM workspaces")).toBe(0);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notebooks")).toBe(0);
    expect(fx.bucket.objects.size).toBe(0);
    expect(count(fx, "SELECT COUNT(*) AS n FROM pending_r2_purge")).toBe(0);
  });

  it("überspringt gelöschte Mitglieder und die zugleich gelöschten Konten bei der Übergabe", async () => {
    for (const id of ["alice", "bob", "carol"]) {
      await seedUser(fx, id);
    }
    await seedWorkspace(fx, "ws_a", "alice");
    await seedMember(fx, "ws_a", "bob", "owner", fx.now + 1);
    await seedMember(fx, "ws_a", "carol", "editor", fx.now + 2);

    // bob wird im selben Lauf gelöscht, also erbt carol
    await purgeUsers(fx.db, fx.bucket, ["alice", "bob"], fx.now);

    const ws = fx.sqlite.prepare("SELECT owner_id FROM workspaces WHERE id = 'ws_a'").get() as {
      owner_id: string;
    };
    expect(ws.owner_id).toBe("carol");
  });

  it("hängt Notebooks in fremden Arbeitsbereichen um und anonymisiert Autorfelder", async () => {
    await seedUser(fx, "alice");
    await seedUser(fx, "bob");
    await seedWorkspace(fx, "ws_b", "bob");
    await seedMember(fx, "ws_b", "alice", "editor", fx.now + 1);
    await seedNotebook(fx, "nb_bob", "ws_b", "bob");
    await seedNotebook(fx, "nb_alice_in_bob", "ws_b", "alice");
    for (const nb of ["nb_bob", "nb_alice_in_bob"]) {
      await fx.db.run(
        "INSERT INTO notes (id, notebook_id, user_id, title, created_at, updated_at) VALUES (?, ?, 'alice', 'n', ?, ?)",
        [`note_${nb}`, nb, fx.now, fx.now]
      );
      await fx.db.run(
        "INSERT INTO chats (id, notebook_id, user_id, title, model_used, created_at, updated_at) VALUES (?, ?, 'alice', 'c', 'm', ?, ?)",
        [`chat_${nb}`, nb, fx.now, fx.now]
      );
      await fx.db.run(
        "INSERT INTO artifacts (id, notebook_id, user_id, type, title, created_at, updated_at) VALUES (?, ?, 'alice', 'summary', 'a', ?, ?)",
        [`art_${nb}`, nb, fx.now, fx.now]
      );
      await fx.db.run(
        `INSERT INTO comments (id, notebook_id, target_type, target_id, author_id, body, created_at, updated_at)
         VALUES (?, ?, 'note', ?, 'alice', 'Hallo', ?, ?)`,
        [`cm_${nb}`, nb, `note_${nb}`, fx.now, fx.now]
      );
    }
    fx.bucket.objects.set("notebooks/nb_alice_in_bob/s.txt", "x");

    const res = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(res.deletedNotebooks).toBe(0);
    expect(fx.sqlite.prepare("SELECT id, created_by FROM notebooks ORDER BY id").all()).toEqual([
      { id: "nb_alice_in_bob", created_by: "bob" },
      { id: "nb_bob", created_by: "bob" }
    ]);
    for (const [table, column] of [
      ["notes", "user_id"],
      ["chats", "user_id"],
      ["artifacts", "user_id"],
      ["comments", "author_id"]
    ]) {
      expect(count(fx, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = 'alice'`), table).toBe(
        0
      );
      expect(
        count(fx, `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = 'user_deleted'`),
        table
      ).toBe(2);
    }
    expect(fx.bucket.objects.has("notebooks/nb_alice_in_bob/s.txt")).toBe(true);
  });

  it("entfernt Reste in audit_log, magic_links, rate_limits und ai_embedding_usage", async () => {
    await seedUser(fx, "alice");
    await seedUser(fx, "bob");
    await seedUser(fx, "g_1", 1);
    const insertAudit = (id: string, user: string, target: string) =>
      fx.db.run(
        "INSERT INTO audit_log (id, user_id, action, target, ip_hash, created_at) VALUES (?, ?, 'auth.login', ?, 'h', ?)",
        [id, user, target, fx.now]
      );
    await insertAudit("a1", "alice", "user:alice");
    await insertAudit("a2", "bob", "user:bob");
    await fx.db.run(
      "INSERT INTO magic_links (token_hash, email, created_at, expires_at) VALUES ('t1', 'alice@example.test', ?, ?)",
      [fx.now, fx.now + 1000]
    );
    await fx.db.run(
      "INSERT INTO magic_links (token_hash, email, created_at, expires_at) VALUES ('t2', 'bob@example.test', ?, ?)",
      [fx.now, fx.now + 1000]
    );
    for (const bucket of [
      "rl:api:usr:alice",
      "rl:auth:usr:alice",
      "rl:api:usr:bob",
      "rl:api:ip:1.2.3.4"
    ]) {
      await fx.db.run("INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)", [
        bucket,
        fx.now
      ]);
    }
    await fx.db.run(
      "INSERT INTO ai_embedding_usage (day, scope, tokens) VALUES ('2026-11-15', 'guest:g_1', 5)"
    );
    await fx.db.run(
      "INSERT INTO ai_embedding_usage (day, scope, tokens) VALUES ('2026-11-15', 'global', 5)"
    );

    await purgeUsers(fx.db, fx.bucket, ["alice", "g_1"], fx.now);

    expect(
      fx.sqlite.prepare("SELECT id, user_id, target FROM audit_log ORDER BY id").all()
    ).toEqual([
      { id: "a1", user_id: null, target: "user:deleted" },
      { id: "a2", user_id: "bob", target: "user:bob" }
    ]);
    expect(fx.sqlite.prepare("SELECT token_hash FROM magic_links").all()).toEqual([
      { token_hash: "t2" }
    ]);
    expect(fx.sqlite.prepare("SELECT bucket FROM rate_limits ORDER BY bucket").all()).toEqual([
      { bucket: "rl:api:ip:1.2.3.4" },
      { bucket: "rl:api:usr:bob" }
    ]);
    expect(fx.sqlite.prepare("SELECT scope FROM ai_embedding_usage").all()).toEqual([
      { scope: "global" }
    ]);
  });

  it("verarbeitet mehr als 50 IDs in Blöcken, ohne die D1-Grenze von 100 Parametern zu reißen", async () => {
    const userCount = 130;
    const ids = Array.from({ length: userCount }, (_, i) => `u${i}`);
    await seedUser(fx, "keeper");
    await seedWorkspace(fx, "ws_keeper", "keeper");
    for (const id of ids) {
      await seedUser(fx, id, 1);
      await seedWorkspace(fx, `ws_${id}`, id);
      await seedNotebook(fx, `nb_${id}`, `ws_${id}`, id);
      // Je Person ein Notebook im fremden Bereich, das erhalten bleiben muss
      await seedNotebook(fx, `nbk_${id}`, "ws_keeper", id);
    }
    expect(userCount).toBeGreaterThan(D1_MAX_BOUND_IDS * 2);

    const res = await purgeUsers(fx.db, fx.bucket, ids, fx.now);

    expect(res.deletedUsers).toBe(userCount);
    expect(res.deletedNotebooks).toBe(userCount);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notebooks WHERE created_by = 'keeper'")).toBe(
      userCount
    );
    expect(count(fx, "SELECT COUNT(*) AS n FROM notebooks")).toBe(userCount);
    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE is_guest = 1")).toBe(0);
  });

  it("verarbeitet eine Person mit mehr als 100 eigenen Arbeitsbereichen und Notebooks", async () => {
    await seedUser(fx, "alice");
    for (let i = 0; i < 120; i += 1) {
      await seedWorkspace(fx, `ws_${i}`, "alice");
      await seedNotebook(fx, `nb_${i}`, `ws_${i}`, "alice");
      fx.bucket.objects.set(`notebooks/nb_${i}/s.txt`, "x");
    }

    const res = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(res.deletedNotebooks).toBe(120);
    expect(res.deletedR2Objects).toBe(120);
    expect(fx.bucket.objects.size).toBe(0);
    expect(count(fx, "SELECT COUNT(*) AS n FROM workspaces")).toBe(0);
  });
});

describe("purgeUsers: Teilfehler und Nachlauf", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await createFixture();
    await seedUser(fx, "alice");
    await seedUser(fx, "bob");
    await seedWorkspace(fx, "ws_a", "alice");
    await seedNotebook(fx, "nb_alice", "ws_a", "alice");
    await seedWorkspace(fx, "ws_b", "bob");
    await seedNotebook(fx, "nb_alice_in_bob", "ws_b", "alice");
    await fx.db.run(
      "INSERT INTO notes (id, notebook_id, user_id, title, created_at, updated_at) VALUES ('n1', 'nb_alice_in_bob', 'alice', 'n', ?, ?)",
      [fx.now, fx.now]
    );
    fx.bucket.objects.set("notebooks/nb_alice/s.txt", "x");
    fx.bucket.objects.set("users/alice/avatar.png", "x");
  });

  afterEach(() => {
    fx.sqlite.close();
    rmSync(fx.dataDir, { recursive: true, force: true });
  });

  it("lässt bei einem D1-Fehler mitten im Batch nichts zurück und rührt R2 nicht an", async () => {
    const failing: DatabaseAdapter = {
      ...fx.db,
      execBatch: async (statements: BatchStatement[]) => {
        // Letzte Anweisung kaputt: der echte Batch muss alles zurückrollen
        await fx.db.execBatch?.([
          ...statements,
          { sql: "INSERT INTO gibt_es_nicht VALUES (1)", params: [] }
        ]);
      }
    };

    await expect(purgeUsers(failing, fx.bucket, ["alice"], fx.now)).rejects.toThrow();

    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE id = 'alice'")).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM workspaces WHERE id = 'ws_a'")).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notebooks")).toBe(2);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notes WHERE user_id = 'alice'")).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM pending_r2_purge")).toBe(0);
    expect(fx.bucket.objects.size).toBe(2);
  });

  it("merkt R2-Präfixe vor, wenn R2 nach der D1-Löschung fehlschlägt, und der Cron räumt sie auf", async () => {
    fx.bucket.failDeletes = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(res.deletedUsers).toBe(1);
    expect(res.pendingR2Prefixes).toBe(2);
    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE id = 'alice'")).toBe(0);
    expect(fx.sqlite.prepare("SELECT prefix FROM pending_r2_purge ORDER BY prefix").all()).toEqual([
      { prefix: "notebooks/nb_alice/" },
      { prefix: "users/alice/" }
    ]);
    expect(fx.bucket.objects.size).toBe(2);

    fx.bucket.failDeletes = false;
    const metrics = await runScheduledCleanup({
      db: fx.db,
      mediaBucket: fx.bucket,
      now: fx.now
    });

    expect(metrics.failedSteps).toBe(0);
    expect(metrics.deletedR2Objects).toBe(2);
    expect(fx.bucket.objects.size).toBe(0);
    expect(count(fx, "SELECT COUNT(*) AS n FROM pending_r2_purge")).toBe(0);
    errorSpy.mockRestore();
  });

  it("führt die übrigen Cron-Schritte aus, auch wenn purgeUsers wirft", async () => {
    await seedUser(fx, "g1", 1); // abgelaufener Gast, expires_at in der Vergangenheit
    await fx.db.run(
      "INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES ('s_old', 'bob', ?, ?)",
      [fx.now - 10_000, fx.now - 1]
    );
    await fx.db.run(
      "INSERT INTO magic_links (token_hash, email, created_at, expires_at) VALUES ('ml_old', 'x@example.test', ?, ?)",
      [fx.now - 10_000, fx.now - 1]
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: DatabaseAdapter = {
      ...fx.db,
      execBatch: async () => {
        throw new Error("D1 nicht erreichbar");
      }
    };

    const metrics = await runScheduledCleanup({ db: broken, mediaBucket: fx.bucket, now: fx.now });

    expect(metrics.failedSteps).toBe(1);
    expect(metrics.deletedGuests).toBe(0);
    expect(metrics.deletedSessions).toBe(1);
    expect(metrics.deletedMagicLinks).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE id = 'g1'")).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"scheduled_cleanup_step_failed"')
    );

    // Nächster Lauf mit funktionierender Datenbank holt den Gast nach
    const retry = await runScheduledCleanup({ db: fx.db, mediaBucket: fx.bucket, now: fx.now });
    expect(retry.failedSteps).toBe(0);
    expect(retry.deletedGuests).toBe(1);
    errorSpy.mockRestore();
  });

  it("meldet im Cron einen Fehlschritt, wenn vorgemerkte R2-Präfixe nicht geleert werden können", async () => {
    await fx.db.run(
      "INSERT INTO pending_r2_purge (prefix, created_at) VALUES ('users/alice/', ?)",
      [fx.now]
    );
    fx.bucket.failDeletes = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const metrics = await runScheduledCleanup({ db: fx.db, mediaBucket: fx.bucket, now: fx.now });

    expect(metrics.failedSteps).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM pending_r2_purge")).toBe(1);
    errorSpy.mockRestore();
  });

  it("arbeitet ohne execBatch-Unterstützung des Adapters nacheinander", async () => {
    const sequential: DatabaseAdapter = {
      exec: fx.db.exec,
      query: fx.db.query,
      queryOne: fx.db.queryOne,
      run: fx.db.run
    };

    const res = await purgeUsers(sequential, fx.bucket, ["alice"], fx.now);

    expect(res.deletedUsers).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE id = 'alice'")).toBe(0);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notes WHERE user_id = 'user_deleted'")).toBe(1);
  });

  it("ist nach einem Abbruch erneut aufrufbar (idempotent)", async () => {
    await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);
    const again = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);
    expect(again.deletedUsers).toBe(0);
    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE id = 'user_deleted'")).toBe(1);
  });
});

describe("purgeUsers: Nachfolger eines Arbeitsbereichs", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await createFixture();
  });

  afterEach(() => {
    fx.sqlite.close();
    rmSync(fx.dataDir, { recursive: true, force: true });
  });

  const ownerOf = (workspace: string): string =>
    (
      fx.sqlite.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspace) as {
        owner_id: string;
      }
    ).owner_id;

  it("nimmt einen Gast nur, wenn es kein anderes Mitglied gibt", async () => {
    await seedUser(fx, "alice");
    await seedUser(fx, "carol");
    await seedUser(fx, "gast", 1);
    await seedWorkspace(fx, "ws_a", "alice");
    // Gast ist früher und Admin, trotzdem geht der Bereich an das Nicht-Gast-Mitglied
    await seedMember(fx, "ws_a", "gast", "owner", fx.now - 100);
    await seedMember(fx, "ws_a", "carol", "viewer", fx.now + 100);

    await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(ownerOf("ws_a")).toBe("carol");
  });

  it("nimmt den Gast, wenn er das einzige weitere Mitglied ist", async () => {
    await seedUser(fx, "alice");
    await seedUser(fx, "gast", 1);
    await seedWorkspace(fx, "ws_a", "alice");
    await seedMember(fx, "ws_a", "gast", "editor", fx.now + 1);

    const res = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(res.transferredWorkspaces).toBe(1);
    expect(ownerOf("ws_a")).toBe("gast");
  });

  it("bevorzugt den Admin mit der längsten Zugehörigkeit vor einem älteren Nicht-Admin", async () => {
    for (const id of ["alice", "carol", "dave", "erin"]) {
      await seedUser(fx, id);
    }
    await seedWorkspace(fx, "ws_a", "alice");
    await seedMember(fx, "ws_a", "carol", "editor", fx.now + 1);
    await seedMember(fx, "ws_a", "erin", "owner", fx.now + 30);
    await seedMember(fx, "ws_a", "dave", "owner", fx.now + 20);

    await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now);

    expect(ownerOf("ws_a")).toBe("dave");
  });

  it("schließt alle im selben Lauf gelöschten Konten aus, auch aus anderen Blöcken", async () => {
    const batch = Array.from({ length: 60 }, (_, i) => `u${String(i).padStart(2, "0")}`);
    for (const id of batch) {
      await seedUser(fx, id);
    }
    await seedUser(fx, "keeper");
    await seedWorkspace(fx, "ws_x", "u00");
    // u59 liegt im zweiten Block, ist Admin und am längsten dabei, wird aber im selben Lauf gelöscht
    await seedMember(fx, "ws_x", "u59", "owner", fx.now - 500);
    await seedMember(fx, "ws_x", "keeper", "viewer", fx.now + 500);
    expect(batch.length).toBeGreaterThan(D1_MAX_BOUND_IDS);

    const res = await purgeUsers(fx.db, fx.bucket, batch, fx.now);

    expect(res.deletedUsers).toBe(60);
    expect(ownerOf("ws_x")).toBe("keeper");
    expect(count(fx, "SELECT COUNT(*) AS n FROM users WHERE id GLOB 'u[0-9][0-9]'")).toBe(0);
  });

  it("löscht den Arbeitsbereich, wenn alle weiteren Mitglieder im selben Lauf gelöscht werden", async () => {
    await seedUser(fx, "alice");
    await seedUser(fx, "bob");
    await seedWorkspace(fx, "ws_a", "alice");
    await seedMember(fx, "ws_a", "bob", "owner", fx.now + 1);
    await seedNotebook(fx, "nb_a", "ws_a", "bob");

    const res = await purgeUsers(fx.db, fx.bucket, ["alice", "bob"], fx.now);

    expect(res.deletedNotebooks).toBe(1);
    expect(count(fx, "SELECT COUNT(*) AS n FROM workspaces")).toBe(0);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notebooks")).toBe(0);
  });
});

describe("purgeUsers: Durable-Object-Zustand (Art. 17 DSGVO)", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await createFixture();
    await seedUser(fx, "alice");
    await seedUser(fx, "bob");
    await seedWorkspace(fx, "ws_a", "alice");
    await seedNotebook(fx, "nb_one", "ws_a", "alice");
    await seedNotebook(fx, "nb_two", "ws_a", "alice");
    await seedWorkspace(fx, "ws_b", "bob");
    await seedNotebook(fx, "nb_alice_in_bob", "ws_b", "alice");
  });

  afterEach(() => {
    fx.sqlite.close();
    rmSync(fx.dataDir, { recursive: true, force: true });
  });

  const pending = (): string[] =>
    (
      fx.sqlite.prepare("SELECT prefix FROM pending_r2_purge ORDER BY prefix").all() as {
        prefix: string;
      }[]
    ).map((row) => row.prefix);

  it("leert den Zustand der gelöschten Notebooks und lässt erhaltene Notebooks in Ruhe", async () => {
    const purge = vi.fn(async (_id: string) => {});

    const res = await purgeUsers(fx.db, fx.bucket, ["alice"], fx.now, purge);

    expect(res.deletedNotebooks).toBe(2);
    expect(purge.mock.calls.map(([id]) => id).sort()).toEqual(["nb_one", "nb_two"]);
    expect(pending()).toEqual([]);
  });

  it("merkt fehlgeschlagene DO-Löschungen vor, der Cron holt sie nach", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async (id: string) => {
      if (id === "nb_two") {
        throw new Error("DO nicht erreichbar");
      }
    });

    const res = await purgeUsers(fx.db, null, ["alice"], fx.now, failing);

    expect(res.deletedUsers).toBe(1);
    expect(res.pendingR2Prefixes).toBe(1);
    expect(pending()).toEqual(["notebook-state:nb_two"]);

    const ok = vi.fn(async (_id: string) => {});
    const metrics = await runScheduledCleanup({ db: fx.db, purgeNotebookState: ok, now: fx.now });

    expect(metrics.failedSteps).toBe(0);
    expect(ok).toHaveBeenCalledExactlyOnceWith("nb_two");
    expect(pending()).toEqual([]);
    errorSpy.mockRestore();
  });

  it("meldet im Cron einen Fehlschritt, wenn die DO-Löschung weiter scheitert", async () => {
    await fx.db.run("INSERT INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)", [
      "notebook-state:nb_gone",
      fx.now
    ]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = vi.fn(async () => {
      throw new Error("DO nicht erreichbar");
    });

    const metrics = await runScheduledCleanup({
      db: fx.db,
      purgeNotebookState: broken,
      now: fx.now
    });

    expect(metrics.failedSteps).toBe(1);
    expect(pending()).toEqual(["notebook-state:nb_gone"]);
    errorSpy.mockRestore();
  });

  it("leert nie den Zustand eines Notebooks, das noch existiert, und verwirft den Eintrag", async () => {
    await fx.db.run("INSERT INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)", [
      "notebook-state:nb_alice_in_bob",
      fx.now
    ]);
    const purge = vi.fn(async (_id: string) => {});

    const metrics = await runScheduledCleanup({
      db: fx.db,
      purgeNotebookState: purge,
      now: fx.now
    });

    expect(metrics.failedSteps).toBe(0);
    expect(purge).not.toHaveBeenCalled();
    expect(pending()).toEqual([]);
  });

  it("lässt Einträge ohne passenden Handler stehen (ohne R2-Bucket, ohne Purger)", async () => {
    await fx.db.run("INSERT INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)", [
      "notebook-state:nb_gone",
      fx.now
    ]);
    await fx.db.run("INSERT INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)", [
      "notebooks/nb_gone/",
      fx.now
    ]);

    // nur R2: der DO-Eintrag bleibt
    const onlyBucket = await drainPendingR2(fx.db, fx.bucket);
    expect(onlyBucket).toEqual({ deletedObjects: 0, failed: 0 });
    expect(pending()).toEqual(["notebook-state:nb_gone"]);

    // nur Purger: ein neuer R2-Eintrag bleibt, der DO-Eintrag wird abgearbeitet
    await fx.db.run("INSERT INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)", [
      "notebooks/nb_gone/",
      fx.now
    ]);
    const purge = vi.fn(async (_id: string) => {});
    await drainPendingR2(fx.db, null, undefined, 100, purge);
    expect(purge).toHaveBeenCalledExactlyOnceWith("nb_gone");
    expect(pending()).toEqual(["notebooks/nb_gone/"]);

    // ohne Bucket und ohne Purger tut der Cron nichts
    const metrics = await runScheduledCleanup({ db: fx.db, now: fx.now });
    expect(metrics.failedSteps).toBe(0);
    expect(pending()).toEqual(["notebooks/nb_gone/"]);
  });

  it("räumt beim Ablauf von Demo-Notebooks auch den DO-Zustand ab", async () => {
    await fx.db.run("UPDATE notebooks SET expires_at = ? WHERE id = 'nb_one'", [fx.now - 1]);
    const purge = vi.fn(async (_id: string) => {});

    const metrics = await runScheduledCleanup({
      db: fx.db,
      purgeNotebookState: purge,
      now: fx.now
    });

    expect(metrics.deletedNotebooks).toBe(1);
    expect(purge).toHaveBeenCalledExactlyOnceWith("nb_one");
    expect(pending()).toEqual([]);
    expect(count(fx, "SELECT COUNT(*) AS n FROM notebooks WHERE id = 'nb_one'")).toBe(0);
  });
});

describe("createNotebookStatePurger", () => {
  it("liefert ohne Namespace keinen Rückruf", () => {
    expect(createNotebookStatePurger(undefined)).toBeUndefined();
  });

  it("ruft POST /purge am Durable Object des Notebooks auf und meldet Fehler", async () => {
    const calls: { name: string; url: string; method: string | undefined }[] = [];
    let status = 200;
    const namespace = {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        fetch: async (url: string, init?: RequestInit) => {
          calls.push({ name: id, url, method: init?.method });
          return new Response("{}", { status });
        }
      })
    } as unknown as Env["NOTEBOOK_DO"];
    const purge = createNotebookStatePurger(namespace);

    await purge?.("nb_1");
    expect(calls).toEqual([{ name: "nb_1", url: "http://internal/purge", method: "POST" }]);

    status = 500;
    await expect(purge?.("nb_2")).rejects.toThrow("nb_2");
  });
});
