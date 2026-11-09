import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalR2Adapter,
  createMockDurableObjectNamespace,
  createNodeEnv,
  createSqliteD1Adapter,
  runSqliteMigrations,
  startNodeServer
} from "../node-server.js";

const TEST_DATA_DIR = join(tmpdir(), `data-test-node-server-${process.pid}`);

function safeCleanDir(dir: string): void {
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Best-effort cleanup on Windows
    }
  }
}

describe("Node.js Runtime & Adapters (Decision #111)", () => {
  beforeEach(() => {
    safeCleanDir(TEST_DATA_DIR);
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    safeCleanDir(TEST_DATA_DIR);
  });

  describe("createSqliteD1Adapter", () => {
    it("executes migrations, queries rows, runs updates, and executes statements", async () => {
      const db = new DatabaseSync(":memory:");
      const d1 = createSqliteD1Adapter(db);

      await d1.exec("CREATE TABLE test_users (id TEXT PRIMARY KEY, name TEXT);");

      // prepare().run()
      const insertStmt = d1.prepare("INSERT INTO test_users VALUES (?, ?)");
      const runRes = await insertStmt.bind("user-1", "Alice").run();
      expect(runRes.meta.changes).toBe(1);

      // prepare().first()
      const firstRow = await d1
        .prepare("SELECT * FROM test_users WHERE id = ?")
        .bind("user-1")
        .first<{ id: string; name: string }>();
      expect(firstRow?.name).toBe("Alice");

      // prepare().first(colName)
      const nameCol = await d1
        .prepare("SELECT * FROM test_users WHERE id = ?")
        .bind("user-1")
        .first<string>("name");
      expect(nameCol).toBe("Alice");

      const nullCol = await d1
        .prepare("SELECT * FROM test_users WHERE id = ?")
        .bind("user-1")
        .first<string>("nonexistent");
      expect(nullCol).toBeNull();

      // prepare().first() returns null if row not found
      const emptyRow = await d1
        .prepare("SELECT * FROM test_users WHERE id = ?")
        .bind("non-existent")
        .first();
      expect(emptyRow).toBeNull();

      // prepare().all()
      const allRes = await d1
        .prepare("SELECT * FROM test_users")
        .bind()
        .all<{ id: string; name: string }>();
      expect(allRes.results).toHaveLength(1);

      // parameterless prepare() methods
      const noParamFirst = await d1
        .prepare("SELECT name FROM test_users LIMIT 1")
        .first<{ name: string }>();
      expect(noParamFirst?.name).toBe("Alice");

      const noParamCol = await d1
        .prepare("SELECT name FROM test_users LIMIT 1")
        .first<string>("name");
      expect(noParamCol).toBe("Alice");

      const noParamNullCol = await d1
        .prepare("SELECT name FROM test_users LIMIT 1")
        .first<string>("nonexistent");
      expect(noParamNullCol).toBeNull();

      const noParamAll = await d1
        .prepare("SELECT * FROM test_users")
        .all<{ id: string; name: string }>();
      expect(noParamAll.results).toHaveLength(1);

      const noParamRun = await d1.prepare("UPDATE test_users SET name = 'Bob'").run();
      expect(noParamRun.meta.changes).toBe(1);

      // batch & dump
      const batchRes = await d1.batch([d1.prepare("SELECT * FROM test_users")]);
      expect(batchRes).toHaveLength(1);

      const dumpBuffer = await d1.dump();
      expect(dumpBuffer.byteLength).toBe(0);

      db.close();
    });

    it("returns null when no rows match parameterless first()", async () => {
      const db = new DatabaseSync(":memory:");
      const d1 = createSqliteD1Adapter(db);
      await d1.exec("CREATE TABLE empty_table (id TEXT);");
      const res = await d1.prepare("SELECT * FROM empty_table").first();
      expect(res).toBeNull();
      db.close();
    });
  });

  describe("createLocalR2Adapter", () => {
    it("handles put, get, head, list and delete across buffer, string, blob and Uint8Array types", async () => {
      const mediaDir = join(TEST_DATA_DIR, "media");
      const r2 = createLocalR2Adapter(mediaDir);

      // get on non-existent key
      const missing = await r2.get("missing.txt");
      expect(missing).toBeNull();

      // head on non-existent key
      const missingHead = await r2.head("missing.txt");
      expect(missingHead).toBeNull();

      // put string
      const strPut = await r2.put("nested/test.txt", "hello text");
      expect(strPut?.size).toBe(10);

      // head existing
      const headRes = await r2.head("nested/test.txt");
      expect(headRes?.size).toBe(10);

      // get existing
      const getRes = await r2.get("nested/test.txt");
      expect(getRes).not.toBeNull();
      expect(await getRes?.text()).toBe("hello text");
      const ab = await getRes?.arrayBuffer();
      expect(ab?.byteLength).toBe(10);

      // read stream
      const stream = getRes?.body;
      const reader = stream?.getReader();
      const chunk = await reader?.read();
      expect(chunk?.value).toBeDefined();

      // put Uint8Array
      const u8 = new Uint8Array([1, 2, 3, 4]);
      await r2.put("binary/data.bin", u8);

      // put ArrayBuffer
      const abVal = new ArrayBuffer(8);
      await r2.put("binary/buffer.bin", abVal);

      // put Blob
      const blob = new Blob(["blob content"], { type: "text/plain" });
      await r2.put("blob/file.txt", blob);

      // put other fallback
      await r2.put("other/val.txt", 12345 as unknown as string);

      // list with prefix
      const listRes = await r2.list({ prefix: "nested" });
      expect(listRes.objects).toHaveLength(1);
      expect(listRes.objects[0]?.key).toBe("nested/test.txt");

      // list without prefix
      const listAll = await r2.list();
      expect(listAll.objects.length).toBeGreaterThanOrEqual(4);

      // delete single key
      await r2.delete("nested/test.txt");
      expect(await r2.get("nested/test.txt")).toBeNull();

      // delete multiple keys (including non-existent)
      await r2.delete(["binary/data.bin", "binary/buffer.bin", "non-existent.bin"]);
      expect(await r2.get("binary/data.bin")).toBeNull();
    });
  });

  describe("createMockDurableObjectNamespace", () => {
    it("provides IDs and fetches /health or generic DO routes", async () => {
      const doNamespace = createMockDurableObjectNamespace("TestDO");

      const idByName = doNamespace.idFromName("notebook-123");
      expect(idByName.toString()).toBe("TestDO-notebook-123");
      expect(idByName.equals(idByName)).toBe(false);

      const uniqueId = doNamespace.newUniqueId();
      expect(uniqueId.toString()).toContain("TestDO-");

      const idFromStr = doNamespace.idFromString("custom-id");
      expect(idFromStr.toString()).toBe("custom-id");
      expect(idFromStr.equals(idFromStr)).toBe(false);
      expect(uniqueId.equals(uniqueId)).toBe(false);

      const stub = doNamespace.get(uniqueId);
      const healthRes = await stub.fetch("http://localhost/health");
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as { ok: boolean };
      expect(healthJson.ok).toBe(true);

      const otherRes = await stub.fetch(new Request("http://localhost/other"));
      expect(otherRes.status).toBe(200);
    });
  });

  describe("runSqliteMigrations", () => {
    it("gracefully returns if migrations directory does not exist", () => {
      const db = new DatabaseSync(":memory:");
      expect(() => runSqliteMigrations(db, "non-existent-dir")).not.toThrow();
      db.close();
    });
  });

  describe("createNodeEnv", () => {
    it("creates environment bindings with default or custom options", async () => {
      const { env, db } = createNodeEnv({
        dataDir: TEST_DATA_DIR,
        appProfile: "full",
        appOrigin: "http://127.0.0.1:8787"
      });
      expect(env.APP_PROFILE).toBe("full");
      expect(env.APP_ORIGIN).toBe("http://127.0.0.1:8787");
      expect(env.DB).toBeDefined();
      expect(env.MEDIA).toBeDefined();
      expect(env.NOTEBOOK_DO).toBeDefined();
      expect(env.JOB_DO).toBeDefined();
      const assetRes = await env.ASSETS.fetch("http://localhost/asset.png");
      expect(assetRes.status).toBe(404);
      db.close();
    });

    it("creates default data directory when not provided", () => {
      const customDb = new DatabaseSync(":memory:");
      const { env } = createNodeEnv({ db: customDb });
      expect(env.APP_PROFILE).toBe("demo");
      customDb.close();
    });
  });

  describe("startNodeServer integration", () => {
    it("boots HTTP server on ephemeral port, serves health check and handles static fallback", async () => {
      const staticDir = join(TEST_DATA_DIR, "static");
      mkdirSync(staticDir, { recursive: true });
      writeFileSync(join(staticDir, "index.html"), "<html><body>App Loaded</body></html>");
      writeFileSync(join(staticDir, "style.css"), "body { margin: 0; }");

      const serverInstance = await startNodeServer({
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data"),
        staticDir,
        appProfile: "demo",
        appOrigin: "http://localhost:8787"
      });

      const port = serverInstance.port;
      expect(port).toBeGreaterThan(0);

      // 1. Check /api/v1/health
      const healthRes = await fetch(`http://localhost:${port}/api/v1/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as {
        status: string;
        services: { d1: string; r2: string };
      };
      expect(healthJson.status).toBe("ok");
      expect(healthJson.services.d1).toBe("ok");
      expect(healthJson.services.r2).toBe("ok");

      // 2. Check static file serve
      const cssRes = await fetch(`http://localhost:${port}/style.css`);
      expect(cssRes.status).toBe(200);

      // 3. Check SPA html fallback on unknown route
      const spaRes = await fetch(`http://localhost:${port}/unknown/route`);
      expect(spaRes.status).toBe(200);
      const spaHtml = await spaRes.text();
      expect(spaHtml).toContain("App Loaded");

      await serverInstance.close();
    }, 15000);

    it("serves 404 when static directory has no index.html and route is unknown", async () => {
      const emptyStaticDir = join(TEST_DATA_DIR, "empty-static");
      mkdirSync(emptyStaticDir, { recursive: true });

      const serverInstance = await startNodeServer({
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data-empty"),
        staticDir: emptyStaticDir
      });

      const port = serverInstance.port;
      const res = await fetch(`http://localhost:${port}/random-unknown-page`);
      expect(res.status).toBe(404);

      await serverInstance.close();
    });

    it("boots with default options when no parameters given", async () => {
      // Temporarily mock process.env.PORT
      process.env.PORT = "0";
      const serverInstance = await startNodeServer();
      expect(serverInstance.port).toBeGreaterThan(0);
      await serverInstance.close();
      process.env.PORT = undefined;
    });

    it("boots without static directory configured or existing", async () => {
      const nonExistentStatic = join(TEST_DATA_DIR, "does-not-exist-dir");
      const serverInstance = await startNodeServer({
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data-nostatic"),
        staticDir: nonExistentStatic
      });

      const port = serverInstance.port;
      const healthRes = await fetch(`http://localhost:${port}/api/v1/health`);
      expect(healthRes.status).toBe(200);

      await serverInstance.close();
    });
  });
});
