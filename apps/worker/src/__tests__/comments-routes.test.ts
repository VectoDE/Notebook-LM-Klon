import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NotebookComment } from "@notebook-lm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMENT_LIST_LIMIT, MENTION_LIST_LIMIT } from "../comments-routes.js";
import { CoreRepository } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import { createApp } from "../index.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import {
  RATE_LIMIT_RULES,
  clearRateLimitMemory,
  resolveCategoryFromPath
} from "../rate-limiter.js";
import { SessionManager } from "../session.js";

/**
 * Kommentare an Quellen und Notizen mit Erwähnungen (Issue #353), über die echte
 * Sicherheitskette aus index.ts (CSRF, Sitzung, Ratenbegrenzung, Rollenprüfung).
 *
 * alice: Eigentümerin (owner) von ws_a/nb_a, bob: viewer im Workspace,
 * carol: editor über Freigabe auf nb_a, mallory: kein Zugriff.
 */

const ORIGIN = "http://localhost:8787";
const SALT = "test-only-session-salt-comments";
type Person = "alice" | "bob" | "carol" | "mallory";

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  cookies: Record<Person, string>;
  dataDir: string;
  closeEnv: () => void;
}

async function createFixture(): Promise<Fixture> {
  const dataDir = mkdtempSync(join(tmpdir(), "comments-"));
  const sqlite = new DatabaseSync(":memory:");
  runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
  const handle = createNodeEnv({ db: sqlite, dataDir, sessionSaltSecret: SALT });
  const env = handle.env;
  const repo = new CoreRepository(createD1DatabaseAdapter(env.DB));
  const now = Date.now();
  const names: Record<Person, string> = {
    alice: "Alice Adler",
    bob: "Bob Berg",
    carol: "Carol Conrad",
    mallory: "Mallory"
  };
  for (const id of Object.keys(names) as Person[]) {
    await repo.createUser({
      id,
      email: `${id}@example.test`,
      display_name: names[id],
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });
  }
  await repo.createWorkspace({ id: "ws_a", name: "A", owner_id: "alice", created_at: now });
  await repo.createWorkspace({ id: "ws_m", name: "M", owner_id: "mallory", created_at: now });
  await repo.db.run(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('ws_a', 'bob', 'viewer', ?)",
    [now]
  );
  for (const [id, ws, owner] of [
    ["nb_a", "ws_a", "alice"],
    ["nb_m", "ws_m", "mallory"]
  ] as const) {
    await repo.createNotebook({
      id,
      workspace_id: ws,
      title: id,
      emoji: "",
      created_by: owner,
      created_at: now,
      updated_at: now,
      expires_at: null
    });
  }
  await repo.db.run(
    "INSERT INTO notebook_shares (notebook_id, user_id, role, created_at) VALUES ('nb_a', 'carol', 'editor', ?)",
    [now]
  );
  for (const [id, nb] of [
    ["src_a", "nb_a"],
    ["src_m", "nb_m"]
  ]) {
    await repo.db.run(
      `INSERT INTO sources (id, notebook_id, title, original_name, mime_type, source_type, created_at, updated_at)
       VALUES (?, ?, 'Quelle', 'q.txt', 'text/plain', 'txt', ?, ?)`,
      [id, nb, now, now]
    );
  }
  await repo.db.run(
    `INSERT INTO notes (id, notebook_id, user_id, title, content, created_at, updated_at)
     VALUES ('note_a', 'nb_a', 'alice', 'Notiz', 'Inhalt', ?, ?)`,
    [now, now]
  );

  const sessions = new SessionManager({ repo, saltSecret: SALT });
  const cookies = {} as Record<Person, string>;
  for (const id of Object.keys(names) as Person[]) {
    cookies[id] = `sid=${(await sessions.createSession(id, null, null)).rawToken}`;
  }
  return { env, sqlite, cookies, dataDir, closeEnv: handle.close };
}

describe("Kommentare an Quellen und Notizen (Issue #353)", () => {
  const app = createApp();
  let fx: Fixture;

  function call(
    path: string,
    init: { method?: string; as?: Person; json?: unknown; body?: string } = {}
  ): Promise<Response> {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (init.as) headers.cookie = fx.cookies[init.as];
    let body = init.body;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const req: RequestInit = { method: init.method ?? "GET", headers };
    if (body !== undefined) req.body = body;
    return Promise.resolve(app.request(`${ORIGIN}${path}`, req, fx.env));
  }

  const listUrl = (targetType: string, targetId: string, nb = "nb_a") =>
    `/api/v1/notebooks/${nb}/comments?targetType=${targetType}&targetId=${targetId}`;

  async function create(
    as: Person,
    json: Record<string, unknown>,
    nb = "nb_a"
  ): Promise<{ status: number; data: NotebookComment & { code?: string } }> {
    const res = await call(`/api/v1/notebooks/${nb}/comments`, { method: "POST", as, json });
    return { status: res.status, data: (await res.json()) as NotebookComment & { code?: string } };
  }

  async function list(as: Person, targetType = "source", targetId = "src_a") {
    const res = await call(listUrl(targetType, targetId), { as });
    expect(res.status).toBe(200);
    return ((await res.json()) as { comments: NotebookComment[] }).comments;
  }

  beforeEach(async () => {
    clearRateLimitMemory();
    fx = await createFixture();
  });

  afterEach(() => {
    fx.closeEnv();
    fx.sqlite.close();
    rmSync(fx.dataDir, { recursive: true, force: true });
  });

  it("lists the people with access as mention candidates, without e-mail addresses", async () => {
    const res = await call("/api/v1/notebooks/nb_a/members", { as: "bob" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { members: { id: string; displayName: string }[] };
    expect(body.members).toEqual([
      { id: "alice", displayName: "Alice Adler" },
      { id: "bob", displayName: "Bob Berg" },
      { id: "carol", displayName: "Carol Conrad" }
    ]);
    expect(JSON.stringify(body)).not.toContain("@example.test");

    expect((await call("/api/v1/notebooks/nb_a/members")).status).toBe(401);
    expect((await call("/api/v1/notebooks/nb_a/members", { as: "mallory" })).status).toBe(404);
  });

  it("creates a comment on a source with a mention and returns it with rights", async () => {
    const { status, data } = await create("carol", {
      targetType: "source",
      targetId: "src_a",
      body: "  Bitte prüfen, @Alice Adler  ",
      mentions: ["alice", "alice"]
    });
    expect(status).toBe(201);
    expect(data.id).toMatch(/^cmt_/);
    expect(data.body).toBe("Bitte prüfen, @Alice Adler");
    expect(data.author).toEqual({ id: "carol", displayName: "Carol Conrad" });
    expect(data.mentions).toEqual([{ id: "alice", displayName: "Alice Adler" }]);
    expect(data).toMatchObject({ edited: false, canEdit: true, canDelete: true });

    const asOwner = await list("alice");
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0]).toMatchObject({ canEdit: false, canDelete: true });
    const asViewer = await list("bob");
    expect(asViewer[0]).toMatchObject({ canEdit: false, canDelete: false });
  });

  it("comments on notes and keeps threads per target apart", async () => {
    expect(
      (await create("alice", { targetType: "note", targetId: "note_a", body: "Notiz-Kommentar" }))
        .status
    ).toBe(201);
    expect(await list("alice", "source", "src_a")).toEqual([]);
    const notes = await list("alice", "note", "note_a");
    expect(notes.map((c) => c.body)).toEqual(["Notiz-Kommentar"]);
    expect(notes[0]?.mentions).toEqual([]);
  });

  it("enforces roles: viewers read only, strangers see nothing", async () => {
    const viewer = await create("bob", { targetType: "source", targetId: "src_a", body: "Hallo" });
    expect(viewer.status).toBe(403);
    expect(viewer.data.code).toBe("INSUFFICIENT_ROLE");
    const stranger = await create("mallory", {
      targetType: "source",
      targetId: "src_a",
      body: "x"
    });
    expect(stranger.status).toBe(404);
    expect((await call(listUrl("source", "src_a"), { as: "mallory" })).status).toBe(404);
    expect((await call(listUrl("source", "src_a"))).status).toBe(401);
  });

  it("validates input: JSON, body, control characters, mention limit and query", async () => {
    const badJson = await call("/api/v1/notebooks/nb_a/comments", {
      method: "POST",
      as: "carol",
      body: "{nope",
      json: undefined
    });
    expect(badJson.status).toBe(400);

    const notObject = await create("carol", "x" as unknown as Record<string, unknown>);
    expect(notObject.status).toBe(422);
    expect((notObject.data as unknown as { errors: { field: string }[] }).errors[0]?.field).toBe(
      "body"
    );

    for (const json of [
      { targetType: "source", targetId: "src_a", body: "   " },
      { targetType: "source", targetId: "src_a", body: "a".repeat(4001) },
      { targetType: "source", targetId: "src_a", body: "Hallo\u0000Welt" },
      { targetType: "chat", targetId: "src_a", body: "x" },
      {
        targetType: "source",
        targetId: "src_a",
        body: "x",
        mentions: Array.from({ length: 21 }, (_, i) => `u${i}`)
      }
    ]) {
      const res = await create("carol", json);
      expect(res.status, JSON.stringify(json).slice(0, 60)).toBe(422);
      expect(res.data.code).toBe("VALIDATION_ERROR");
    }
    expect(
      (
        await create("carol", {
          targetType: "source",
          targetId: "src_a",
          body: "Zeile 1\nZeile 2\tok"
        })
      ).status
    ).toBe(201);

    const badQuery = await call("/api/v1/notebooks/nb_a/comments?targetType=chat", { as: "bob" });
    expect(badQuery.status).toBe(422);
  });

  it("rejects targets outside the notebook and mentions of people without access", async () => {
    const foreignSource = await create("carol", {
      targetType: "source",
      targetId: "src_m",
      body: "x"
    });
    expect(foreignSource.status).toBe(404);
    expect(foreignSource.data.code).toBe("COMMENT_TARGET_NOT_FOUND");
    const missingNote = await create("carol", { targetType: "note", targetId: "nope", body: "x" });
    expect(missingNote.status).toBe(404);

    const mention = await create("carol", {
      targetType: "source",
      targetId: "src_a",
      body: "@Mallory",
      mentions: ["mallory"]
    });
    expect(mention.status).toBe(422);
    expect(mention.data.code).toBe("INVALID_MENTION");
  });

  it("lists the comments that mention the signed-in person", async () => {
    await create("carol", {
      targetType: "source",
      targetId: "src_a",
      body: "@Bob Berg",
      mentions: ["bob"]
    });
    await create("carol", { targetType: "note", targetId: "note_a", body: "ohne Erwähnung" });
    const res = await call("/api/v1/notebooks/nb_a/mentions", { as: "bob" });
    expect(res.status).toBe(200);
    const { comments } = (await res.json()) as { comments: NotebookComment[] };
    expect(comments.map((c) => c.body)).toEqual(["@Bob Berg"]);
    const none = await call("/api/v1/notebooks/nb_a/mentions", { as: "alice" });
    expect(((await none.json()) as { comments: unknown[] }).comments).toEqual([]);
    expect(MENTION_LIST_LIMIT).toBe(50);
    expect(COMMENT_LIST_LIMIT).toBe(200);
  });

  it("lets only the author edit, replaces mentions and marks the comment as edited", async () => {
    const { data } = await create("carol", {
      targetType: "source",
      targetId: "src_a",
      body: "Erst",
      mentions: ["alice"]
    });
    const url = `/api/v1/notebooks/nb_a/comments/${data.id}`;

    const notAuthor = await call(url, { method: "PATCH", as: "alice", json: { body: "x" } });
    expect(notAuthor.status).toBe(403);
    expect(((await notAuthor.json()) as { code: string }).code).toBe("NOT_COMMENT_AUTHOR");
    expect((await call(url, { method: "PATCH", as: "bob", json: { body: "x" } })).status).toBe(403);

    expect((await call(url, { method: "PATCH", as: "carol", body: "{" })).status).toBe(400);
    expect((await call(url, { method: "PATCH", as: "carol", json: { body: "" } })).status).toBe(
      422
    );
    const badMention = await call(url, {
      method: "PATCH",
      as: "carol",
      json: { body: "x", mentions: ["mallory"] }
    });
    expect(badMention.status).toBe(422);

    const ok = await call(url, {
      method: "PATCH",
      as: "carol",
      json: { body: "Neu @Bob Berg", mentions: ["bob"] }
    });
    expect(ok.status).toBe(200);
    const updated = (await ok.json()) as NotebookComment;
    expect(updated.body).toBe("Neu @Bob Berg");
    expect(updated.edited).toBe(true);
    expect(updated.mentions).toEqual([{ id: "bob", displayName: "Bob Berg" }]);

    const missing = await call("/api/v1/notebooks/nb_a/comments/cmt_missing", {
      method: "PATCH",
      as: "carol",
      json: { body: "x" }
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe("COMMENT_NOT_FOUND");
  });

  it("does not reach comments of another notebook through a foreign path (IDOR)", async () => {
    const foreign = await create(
      "mallory",
      { targetType: "source", targetId: "src_m", body: "geheim" },
      "nb_m"
    );
    expect(foreign.status).toBe(201);
    const viaOwnNotebook = await call(`/api/v1/notebooks/nb_a/comments/${foreign.data.id}`, {
      method: "DELETE",
      as: "alice"
    });
    expect(viaOwnNotebook.status).toBe(404);
    expect(await list("alice", "source", "src_m")).toEqual([]);
  });

  it("lets the author or the notebook owner delete, nobody else", async () => {
    const first = (await create("carol", { targetType: "source", targetId: "src_a", body: "1" }))
      .data;
    const second = (await create("carol", { targetType: "source", targetId: "src_a", body: "2" }))
      .data;

    const byViewer = await call(`/api/v1/notebooks/nb_a/comments/${first.id}`, {
      method: "DELETE",
      as: "bob"
    });
    expect(byViewer.status).toBe(403);
    const byOwner = await call(`/api/v1/notebooks/nb_a/comments/${first.id}`, {
      method: "DELETE",
      as: "alice"
    });
    expect(byOwner.status).toBe(204);
    const byAuthor = await call(`/api/v1/notebooks/nb_a/comments/${second.id}`, {
      method: "DELETE",
      as: "carol"
    });
    expect(byAuthor.status).toBe(204);
    const again = await call(`/api/v1/notebooks/nb_a/comments/${second.id}`, {
      method: "DELETE",
      as: "carol"
    });
    expect(again.status).toBe(404);
    expect(await list("alice")).toEqual([]);
  });

  it("keeps delete rights for an author demoted to viewer, but no edit rights", async () => {
    const { data } = await create("carol", { targetType: "source", targetId: "src_a", body: "x" });
    fx.sqlite.exec("UPDATE notebook_shares SET role = 'viewer' WHERE user_id = 'carol'");
    const [own] = await list("carol");
    expect(own).toMatchObject({ canEdit: false, canDelete: true });
    const res = await call(`/api/v1/notebooks/nb_a/comments/${data.id}`, {
      method: "DELETE",
      as: "carol"
    });
    expect(res.status).toBe(204);
  });

  it("removes comments with their source or note and hides deleted accounts", async () => {
    await create("carol", {
      targetType: "source",
      targetId: "src_a",
      body: "@Bob Berg",
      mentions: ["bob"]
    });
    await create("alice", { targetType: "note", targetId: "note_a", body: "n" });

    fx.sqlite.exec("UPDATE users SET deleted_at = 1 WHERE id IN ('carol', 'bob')");
    const [orphan] = await list("alice");
    expect(orphan?.author).toEqual({ id: "carol", displayName: "" });
    expect(orphan?.mentions).toEqual([]);

    fx.sqlite.exec("DELETE FROM sources WHERE id = 'src_a'");
    fx.sqlite.exec("DELETE FROM notes WHERE id = 'note_a'");
    const count = fx.sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get() as { n: number };
    expect(count.n).toBe(0);
    const mentions = fx.sqlite.prepare("SELECT COUNT(*) AS n FROM comment_mentions").get() as {
      n: number;
    };
    expect(mentions.n).toBe(0);
  });

  it("uses an own rate-limit bucket for comment routes", async () => {
    expect(resolveCategoryFromPath("/api/v1/notebooks/nb_a/comments")).toBe("comments");
    expect(resolveCategoryFromPath("/api/v1/notebooks/nb_a/comments/cmt_1")).toBe("comments");
    expect(resolveCategoryFromPath("/api/v1/notebooks/nb_a/mentions")).toBe("comments");
    expect(resolveCategoryFromPath("/api/v1/notebooks/nb_a/members")).toBe("comments");
    const res = await call(listUrl("source", "src_a"), { as: "alice" });
    expect(res.headers.get("x-ratelimit-limit")).toBe(String(RATE_LIMIT_RULES.comments.limit));

    for (let i = 1; i < RATE_LIMIT_RULES.comments.limit; i++) {
      await call(listUrl("source", "src_a"), { as: "alice" });
    }
    const limited = await create("alice", { targetType: "source", targetId: "src_a", body: "x" });
    expect(limited.status).toBe(429);
  });

  it("rejects a database-level body over the limit (CHECK constraint)", () => {
    expect(() =>
      fx.sqlite.exec(
        `INSERT INTO comments (id, notebook_id, target_type, target_id, author_id, body, created_at, updated_at)
         VALUES ('c', 'nb_a', 'source', 'src_a', 'alice', '', 1, 1)`
      )
    ).toThrow(/CHECK/);
  });
});
