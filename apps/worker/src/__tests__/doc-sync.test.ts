import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { CoreRepository } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import {
  DocSyncError,
  EMPTY_STATE,
  MAX_DOC_BYTES,
  MAX_UPDATE_BYTES,
  diffFromState,
  fromBase64Url,
  mergeIntoState,
  toBase64Url,
  validateUpdate
} from "../doc-sync.js";
import { NotebookDO, type SqliteDurableObjectState, createApp } from "../index.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import { clearRateLimitMemory } from "../rate-limiter.js";
import { SessionManager } from "../session.js";

const ORIGIN = "http://localhost:8787";
const SALT = "test-only-salt-doc-sync";

function titleUpdate(title: string, clientID?: number): Uint8Array {
  const doc = new Y.Doc();
  if (clientID !== undefined) doc.clientID = clientID;
  doc.getMap("meta").set("title", title);
  return Y.encodeStateAsUpdate(doc);
}

function titleOf(update: Uint8Array): unknown {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc.getMap("meta").get("title");
}

describe("doc-sync: Konstanten", () => {
  it("EMPTY_STATE entspricht dem Update eines leeren Dokuments", () => {
    expect(EMPTY_STATE).toEqual(Y.encodeStateAsUpdate(new Y.Doc()));
  });
});

describe("doc-sync: Hilfsfunktionen (Issue #347)", () => {
  it("base64url hin und zurück, ungültige Kodierung ist 400", () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(fromBase64Url("")).toEqual(new Uint8Array());
    for (const bad of ["a+b", "a/b", "abcde", "a=="]) {
      expect(() => fromBase64Url(bad)).toThrow(DocSyncError);
    }
  });

  it("validateUpdate prüft leer, Größe und Aufbau", () => {
    expect(() => validateUpdate(new Uint8Array())).toThrow(/Leeres/);
    expect(() => validateUpdate(new Uint8Array(MAX_UPDATE_BYTES + 1))).toThrowError(
      expect.objectContaining({ status: 413 })
    );
    expect(() => validateUpdate(new Uint8Array([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: "INVALID_UPDATE" })
    );
    expect(() => validateUpdate(titleUpdate("ok"))).not.toThrow();
  });

  it("mergeIntoState ist idempotent und kommutativ", () => {
    const a = titleUpdate("A", 1);
    const b = titleUpdate("B", 2);
    const ab = mergeIntoState(mergeIntoState(null, a), b);
    const ba = mergeIntoState(mergeIntoState(null, b), a);
    const twice = mergeIntoState(ab, a);
    expect(titleOf(ab)).toBe(titleOf(ba));
    expect(titleOf(twice)).toBe(titleOf(ab));
  });

  it("mergeIntoState: kaputter Stand 400, zu großer Stand 413", () => {
    expect(() => mergeIntoState(new Uint8Array([1, 2, 3]), titleUpdate("x"))).toThrowError(
      expect.objectContaining({ status: 400, code: "INVALID_UPDATE" })
    );
    const big = new Y.Doc();
    big.getText("t").insert(0, "x".repeat(MAX_DOC_BYTES));
    expect(() => mergeIntoState(Y.encodeStateAsUpdate(big), titleUpdate("x"))).toThrowError(
      expect.objectContaining({ status: 413, code: "DOC_TOO_LARGE" })
    );
  });

  it("diffFromState liefert nur Fehlendes, ungültiger Vektor ist 400", () => {
    const empty = diffFromState(null);
    expect(titleOf(empty.update)).toBeUndefined();
    const state = titleUpdate("S");
    const full = diffFromState(state);
    const none = diffFromState(state, full.stateVector);
    expect(titleOf(full.update)).toBe("S");
    expect(none.update.byteLength).toBeLessThan(full.update.byteLength);
    expect(() => diffFromState(state, new Uint8Array([9, 9, 9]))).toThrowError(
      expect.objectContaining({ code: "INVALID_STATE_VECTOR" })
    );
  });
});

describe("GET/POST /api/v1/notebooks/:id/doc", () => {
  const app = createApp();
  let env: Env;
  let sqlite: DatabaseSync;
  let dataDir: string;
  let close: () => void;
  const cookies = { alice: "", bob: "", mallory: "" };

  beforeEach(async () => {
    clearRateLimitMemory();
    dataDir = mkdtempSync(join(tmpdir(), "doc-sync-"));
    sqlite = new DatabaseSync(":memory:");
    runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
    const handle = createNodeEnv({ db: sqlite, dataDir, sessionSaltSecret: SALT });
    env = handle.env as Env;
    close = handle.close;
    const repo = new CoreRepository(createD1DatabaseAdapter(env.DB));
    const now = Date.now();
    for (const id of ["alice", "bob", "mallory"]) {
      await repo.createUser({
        id,
        email: `${id}@example.test`,
        display_name: id,
        locale: "de",
        is_guest: 0,
        created_at: now,
        expires_at: null,
        deleted_at: null
      });
    }
    await repo.createWorkspace({ id: "ws_a", name: "A", owner_id: "alice", created_at: now });
    await repo.db.run(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'viewer', ?)",
      ["ws_a", "bob", now]
    );
    await repo.createNotebook({
      id: "nb_a",
      workspace_id: "ws_a",
      title: "Notebook A",
      emoji: "book",
      created_by: "alice",
      created_at: now,
      updated_at: now,
      expires_at: null
    });
    const sessions = new SessionManager({ repo, saltSecret: SALT });
    for (const id of ["alice", "bob", "mallory"] as const) {
      cookies[id] = `sid=${(await sessions.createSession(id, null, null)).rawToken}`;
    }
  });

  afterEach(() => {
    close();
    sqlite.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = (
    path: string,
    init: {
      method?: string;
      cookie?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {},
    useEnv: Env = env
  ) =>
    Promise.resolve(
      app.request(
        `${ORIGIN}${path}`,
        {
          method: init.method ?? "GET",
          headers: {
            ...(init.cookie ? { cookie: init.cookie } : {}),
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...init.headers
          },
          ...(init.body ? { body: init.body } : {})
        },
        useEnv
      )
    );

  const push = (cookie: string, update: Uint8Array) =>
    call("/api/v1/notebooks/nb_a/doc", {
      method: "POST",
      cookie,
      body: JSON.stringify({ update: toBase64Url(update) })
    });

  it("schreibt als editor, liest als viewer, nur was fehlt", async () => {
    const res = await push(cookies.alice, titleUpdate("Vom Laptop"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const sv = ((await res.json()) as { stateVector: string }).stateVector;

    const read = await call("/api/v1/notebooks/nb_a/doc", { cookie: cookies.bob });
    expect(read.status).toBe(200);
    const body = (await read.json()) as { update: string; stateVector: string };
    expect(titleOf(fromBase64Url(body.update))).toBe("Vom Laptop");
    expect(body.stateVector).toBe(sv);

    const diff = await call(`/api/v1/notebooks/nb_a/doc?sv=${sv}`, { cookie: cookies.bob });
    const nothing = (await diff.json()) as { update: string };
    expect(titleOf(fromBase64Url(nothing.update))).toBeUndefined();
  });

  it("gleichzeitige Offline-Änderungen konvergieren auf dem Server", async () => {
    await push(cookies.alice, titleUpdate("Gerät 1", 11));
    await push(cookies.alice, titleUpdate("Gerät 2", 22));
    await push(cookies.alice, titleUpdate("Gerät 1", 11));
    const read = await call("/api/v1/notebooks/nb_a/doc", { cookie: cookies.alice });
    const title = titleOf(fromBase64Url(((await read.json()) as { update: string }).update));
    const local = new Y.Doc();
    Y.applyUpdate(local, titleUpdate("Gerät 2", 22));
    Y.applyUpdate(local, titleUpdate("Gerät 1", 11));
    expect(title).toBe(local.getMap("meta").get("title"));
  });

  it("Rechte: ohne Sitzung 401, viewer darf nicht schreiben, Fremde nichts", async () => {
    expect((await call("/api/v1/notebooks/nb_a/doc")).status).toBe(401);
    expect((await push(cookies.bob, titleUpdate("x"))).status).toBe(403);
    const foreign = await call("/api/v1/notebooks/nb_a/doc", { cookie: cookies.mallory });
    expect([403, 404]).toContain(foreign.status);
  });

  it("lehnt kaputte Eingaben ab", async () => {
    const alice = cookies.alice;
    const bad = async (body: string, status: number, code: string) => {
      const res = await call("/api/v1/notebooks/nb_a/doc", { method: "POST", cookie: alice, body });
      expect(res.status).toBe(status);
      expect(((await res.json()) as { code: string }).code).toBe(code);
    };
    await bad("{kaputt", 400, "INVALID_JSON");
    await bad("{}", 400, "INVALID_BODY");
    await bad(JSON.stringify({ update: "a+b" }), 400, "INVALID_ENCODING");
    await bad(
      JSON.stringify({ update: toBase64Url(new Uint8Array([1, 2, 3])) }),
      400,
      "INVALID_UPDATE"
    );

    const huge = await call("/api/v1/notebooks/nb_a/doc", {
      method: "POST",
      cookie: alice,
      body: "{}",
      headers: { "content-length": String(MAX_UPDATE_BYTES * 3) }
    });
    expect(huge.status).toBe(413);

    // Ohne Content-Length: die Grenze greift beim Lesen des Streams.
    const streamed = await app.request(
      `${ORIGIN}/api/v1/notebooks/nb_a/doc`,
      {
        method: "POST",
        headers: { cookie: alice, "content-type": "application/json" },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_UPDATE_BYTES * 2 + 1));
            controller.close();
          }
        }),
        duplex: "half"
      } as RequestInit,
      env
    );
    expect(streamed.status).toBe(413);

    const sv = await call("/api/v1/notebooks/nb_a/doc?sv=a+b", { cookie: alice });
    expect(sv.status).toBe(400);
    const badVector = await call(
      `/api/v1/notebooks/nb_a/doc?sv=${toBase64Url(new Uint8Array([9, 9, 9]))}`,
      {
        cookie: alice
      }
    );
    expect(badVector.status).toBe(400);
    expect(((await badVector.json()) as { code: string }).code).toBe("INVALID_STATE_VECTOR");
  });

  it("ohne NotebookDO-Bindung: 503", async () => {
    const noDo = { ...env, NOTEBOOK_DO: undefined } as unknown as Env;
    const get = await call("/api/v1/notebooks/nb_a/doc", { cookie: cookies.alice }, noDo);
    expect(get.status).toBe(503);
    const post = await call(
      "/api/v1/notebooks/nb_a/doc",
      { method: "POST", cookie: cookies.alice, body: "{}" },
      noDo
    );
    expect(post.status).toBe(503);
  });
});

describe("NotebookDO /doc Fehlerfälle", () => {
  function stateWith(exec: (query: string, ...b: unknown[]) => Record<string, unknown>[]) {
    return {
      id: { toString: () => "nb" },
      storage: {
        sql: { exec: (q: string, ...b: unknown[]) => ({ toArray: () => exec(q, ...b) }) },
        getAlarm: async () => null,
        setAlarm: async () => {},
        deleteAlarm: async () => {}
      },
      acceptWebSocket: () => {},
      getWebSockets: () => []
    } as unknown as SqliteDurableObjectState;
  }

  it("zu großer Stand: 413 mit passendem Titel", async () => {
    const big = new Y.Doc();
    big.getText("t").insert(0, "x".repeat(MAX_DOC_BYTES));
    const bigState = Y.encodeStateAsUpdate(big);
    const instance = new NotebookDO(
      stateWith((q) => (q.startsWith("SELECT state") ? [{ state: bigState }] : [])),
      {} as Env
    );
    const res = await instance.fetch(
      new Request("http://internal/doc", { method: "POST", body: titleUpdate("x") })
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { title: string }).title).toBe("Payload Too Large");
  });

  it("Speicherfehler: 500 ohne Details", async () => {
    const instance = new NotebookDO(
      stateWith((q) => {
        if (q.startsWith("SELECT state")) throw new Error("disk I/O error");
        return [];
      }),
      {} as Env
    );
    const res = await instance.fetch(new Request("http://internal/doc"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; detail: string };
    expect(body.code).toBe("DOC_SYNC_FAILED");
    expect(body.detail).not.toContain("disk");
  });

  it("GET mit gültigem Vektor und Stand als ArrayBuffer (Cloudflare-Form)", async () => {
    const state = titleUpdate("CF");
    const instance = new NotebookDO(
      stateWith((q) => (q.startsWith("SELECT state") ? [{ state: state.slice().buffer }] : [])),
      {} as Env
    );
    const empty = Y.encodeStateVector(new Y.Doc());
    const res = await instance.fetch(new Request(`http://internal/doc?sv=${toBase64Url(empty)}`));
    const body = (await res.json()) as { update: string };
    expect(titleOf(fromBase64Url(body.update))).toBe("CF");
  });
});
