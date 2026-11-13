import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { createApp } from "./index.js";
import { registerSocketAddress } from "./rate-limiter.js";
import { MAX_SOURCE_BYTE_SIZE_LIMIT } from "./sources-upload.js";

/**
 * Upper bound for a single object written by the local R2 adapter. It matches the
 * per-file size limit (50 MB), so a
 * client that streams without or past its declared size cannot fill the disk.
 */
export const MAX_OBJECT_BYTES = MAX_SOURCE_BYTE_SIZE_LIMIT;

export class ObjectTooLargeError extends Error {
  constructor(limit: number) {
    super(`Objekt überschreitet die Obergrenze von ${limit} Bytes.`);
    this.name = "ObjectTooLargeError";
  }
}

export interface NodeServerOptions {
  port?: number | undefined;
  dataDir?: string | undefined;
  staticDir?: string | undefined;
  appProfile?: "demo" | "full" | undefined;
  appOrigin?: string | undefined;
  /**
   * Header a reverse proxy in front of this server sets to the client IP (e.g. "x-forwarded-for").
   * Defaults to env TRUSTED_PROXY_HEADER. Without it, rate limiting uses the socket address.
   */
  trustedProxyHeader?: string | undefined;
}

export interface NodeServerInstance {
  server: ReturnType<typeof serve>;
  port: number;
  db: DatabaseSync;
  dataDir: string;
  close: () => Promise<void>;
}

export function createSqliteD1Adapter(db: DatabaseSync): D1Database {
  return {
    prepare: (query: string) => {
      const stmt = db.prepare(query);
      return {
        bind: (...params: unknown[]) => ({
          first: async <T = unknown>(colName?: string): Promise<T | null> => {
            const row = stmt.get(...(params as (string | number | bigint | null | Uint8Array)[])) as
              | Record<string, unknown>
              | undefined;
            if (!row) {
              return null;
            }
            if (colName) {
              return (row[colName] as T) ?? null;
            }
            return row as T;
          },
          all: async <T = unknown>() => {
            const rows = stmt.all(...(params as (string | number | bigint | null | Uint8Array)[]));
            return {
              results: rows as T[],
              success: true,
              meta: {
                changes: 0,
                last_row_id: 0,
                duration: 0,
                rows_read: rows.length,
                rows_written: 0
              }
            };
          },
          run: async () => {
            const res = stmt.run(...(params as (string | number | bigint | null | Uint8Array)[]));
            return {
              results: [],
              success: true,
              meta: {
                changes: Number(res.changes),
                last_row_id: Number(res.lastInsertRowid),
                duration: 0,
                rows_read: 0,
                rows_written: Number(res.changes)
              }
            };
          }
        }),
        first: async <T = unknown>(colName?: string): Promise<T | null> => {
          const row = stmt.get() as Record<string, unknown> | undefined;
          if (!row) {
            return null;
          }
          if (colName) {
            return (row[colName] as T) ?? null;
          }
          return row as T;
        },
        all: async <T = unknown>() => {
          const rows = stmt.all();
          return {
            results: rows as T[],
            success: true,
            meta: {
              changes: 0,
              last_row_id: 0,
              duration: 0,
              rows_read: rows.length,
              rows_written: 0
            }
          };
        },
        run: async () => {
          const res = stmt.run();
          return {
            results: [],
            success: true,
            meta: {
              changes: Number(res.changes),
              last_row_id: Number(res.lastInsertRowid),
              duration: 0,
              rows_read: 0,
              rows_written: Number(res.changes)
            }
          };
        }
      } as unknown as D1PreparedStatement;
    },
    exec: async (sqlStr: string) => {
      db.exec(sqlStr);
      return { count: 1, duration: 0 };
    },
    batch: async (statements: D1PreparedStatement[]) => {
      const results = [];
      for (const st of statements) {
        results.push(await st.all());
      }
      return results;
    },
    dump: async () => new ArrayBuffer(0)
  } as unknown as D1Database;
}

export function createLocalR2Adapter(
  mediaDir: string,
  maxObjectBytes: number = MAX_OBJECT_BYTES
): R2Bucket {
  if (!existsSync(mediaDir)) {
    mkdirSync(mediaDir, { recursive: true });
  }
  const rootDir = resolve(mediaDir);

  // Keys come from callers (R2 keys are opaque strings). Resolve them against the
  // media root and refuse anything that lands outside it (`../`, absolute paths,
  // other drives) or on the root itself.
  const getFilePath = (key: string): string => {
    const safeKey = key.replace(/^[/\\]+/, "");
    const target = resolve(rootDir, safeKey);
    if (!target.startsWith(`${rootDir}${sep}`)) {
      throw new RangeError(`Ungültiger Objektschlüssel: '${key}'.`);
    }
    return target;
  };

  return {
    get: async (key: string) => {
      const filePath = getFilePath(key);
      if (!existsSync(filePath)) {
        return null;
      }
      const data = readFileSync(filePath);
      return {
        key,
        size: data.byteLength,
        etag: `"${data.byteLength}"`,
        httpEtag: `"${data.byteLength}"`,
        arrayBuffer: async () =>
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        text: async () => data.toString("utf8"),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          }
        })
      } as unknown as R2ObjectBody;
    },
    put: async (
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
    ) => {
      const filePath = getFilePath(key);
      const fileDir = dirname(filePath);
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true });
      }

      // Request bodies arrive as web ReadableStreams: stream the raw bytes to disk
      // (no text decoding, no full buffering in memory). A counting transform aborts
      // once the object exceeds the cap; the partial file is removed on any failure.
      if (value instanceof ReadableStream) {
        let received = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.byteLength;
            if (received > maxObjectBytes) {
              callback(new ObjectTooLargeError(maxObjectBytes));
              return;
            }
            callback(null, chunk);
          }
        });
        try {
          await pipeline(
            Readable.fromWeb(value as unknown as NodeWebReadableStream<Uint8Array>),
            limiter,
            createWriteStream(filePath)
          );
        } catch (err) {
          rmSync(filePath, { force: true, maxRetries: 5, retryDelay: 50 });
          throw err;
        }
        const size = statSync(filePath).size;
        return {
          key,
          size,
          etag: `"${size}"`,
          httpEtag: `"${size}"`
        } as unknown as R2Object;
      }

      let buf: Buffer;
      if (typeof value === "string") {
        buf = Buffer.from(value, "utf8");
      } else if (ArrayBuffer.isView(value)) {
        buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      } else if (value instanceof ArrayBuffer) {
        buf = Buffer.from(value);
      } else if (typeof (value as Blob).arrayBuffer === "function") {
        const ab = await (value as Blob).arrayBuffer();
        buf = Buffer.from(ab);
      } else {
        buf = Buffer.from(String(value), "utf8");
      }

      if (buf.byteLength > maxObjectBytes) {
        throw new ObjectTooLargeError(maxObjectBytes);
      }
      writeFileSync(filePath, buf);
      return {
        key,
        size: buf.byteLength,
        etag: `"${buf.byteLength}"`,
        httpEtag: `"${buf.byteLength}"`
      } as unknown as R2Object;
    },
    delete: async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        const filePath = getFilePath(k);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      }
    },
    list: async (options?: {
      prefix?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    }) => {
      const prefix = options?.prefix ?? "";
      const matchedObjects: Array<{ key: string; size: number }> = [];

      const walk = (currentDir: string, currentRel: string) => {
        const entries = readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const entryRel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
          const entryFull = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walk(entryFull, entryRel);
          } else {
            if (entryRel.startsWith(prefix)) {
              const stat = statSync(entryFull);
              matchedObjects.push({ key: entryRel, size: stat.size });
            }
          }
        }
      };

      walk(mediaDir, "");
      return {
        objects: matchedObjects,
        truncated: false,
        cursor: undefined
      };
    },
    head: async (key: string) => {
      const filePath = getFilePath(key);
      if (!existsSync(filePath)) {
        return null;
      }
      const stat = statSync(filePath);
      return {
        key,
        size: stat.size,
        etag: `"${stat.size}"`,
        httpEtag: `"${stat.size}"`
      } as unknown as R2Object;
    }
  } as unknown as R2Bucket;
}

export function createMockDurableObjectNamespace(namePrefix: string) {
  return {
    idFromName: (name: string) => ({
      toString: () => `${namePrefix}-${name}`,
      equals: () => false,
      name
    }),
    newUniqueId: () => ({
      toString: () => `${namePrefix}-${Date.now()}`,
      equals: () => false
    }),
    idFromString: (idStr: string) => ({
      toString: () => idStr,
      equals: () => false
    }),
    get: (_id: unknown) => ({
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ ok: true, className: namePrefix }), {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" }
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }
    })
  } as unknown as DurableObjectNamespace;
}

export function runSqliteMigrations(db: DatabaseSync, migrationsDir: string): void {
  if (!existsSync(migrationsDir)) {
    return;
  }
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const fullPath = join(migrationsDir, file);
    const sql = readFileSync(fullPath, "utf8");
    db.exec(sql);
  }
}

export function createNodeEnv(options?: {
  db?: DatabaseSync | undefined;
  dataDir?: string | undefined;
  appProfile?: "demo" | "full" | undefined;
  appOrigin?: string | undefined;
  /** Defaults to process.env.SESSION_SALT_SECRET. No fallback: missing means login is blocked (503). */
  sessionSaltSecret?: string | undefined;
  trustedProxyHeader?: string | undefined;
}): { env: Env; db: DatabaseSync; dataDir: string } {
  const dataDir = options?.dataDir ?? resolve(".data");
  const mediaDir = join(dataDir, "media");

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = options?.db ?? new DatabaseSync(join(dataDir, "local.sqlite"));
  const d1 = createSqliteD1Adapter(db);
  const r2 = createLocalR2Adapter(mediaDir);

  const env = {
    DB: d1,
    MEDIA: r2,
    APP_PROFILE: options?.appProfile ?? "demo",
    APP_ORIGIN: options?.appOrigin ?? "http://localhost:8787",
    SESSION_SALT_SECRET: options?.sessionSaltSecret ?? process.env.SESSION_SALT_SECRET,
    TRUSTED_PROXY_HEADER: options?.trustedProxyHeader,
    ASSETS: {
      fetch: async () => new Response("Not Found", { status: 404 })
    } as unknown as Fetcher,
    NOTEBOOK_DO: createMockDurableObjectNamespace("NotebookDO"),
    JOB_DO: createMockDurableObjectNamespace("JobDO")
  } as unknown as Env;

  return { env, db, dataDir };
}

/**
 * Cache-Regel für statische Dateien: gehashte Build-Dateien unter /assets/ ändern nie ihren
 * Inhalt (ein Jahr, immutable), alles andere (index.html, robots.txt, sitemap.xml, llms.txt)
 * wird bei jedem Aufruf per ETag neu validiert.
 */
export function staticCacheControl(path: string): string {
  return path.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}

export function startNodeServer(options?: NodeServerOptions): Promise<NodeServerInstance> {
  const port = options?.port !== undefined ? options.port : Number(process.env.PORT);
  const dataDir = options?.dataDir !== undefined ? options.dataDir : resolve(".data");
  const staticDir = options?.staticDir !== undefined ? options.staticDir : resolve("apps/web/dist");

  const envOpts: {
    dataDir: string;
    appProfile?: "demo" | "full";
    appOrigin?: string;
    trustedProxyHeader?: string | undefined;
  } = {
    dataDir,
    trustedProxyHeader: options?.trustedProxyHeader ?? process.env.TRUSTED_PROXY_HEADER
  };
  if (options?.appProfile !== undefined) {
    envOpts.appProfile = options.appProfile;
  }
  if (options?.appOrigin !== undefined) {
    envOpts.appOrigin = options.appOrigin;
  }

  const { env, db } = createNodeEnv(envOpts);

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(currentDir, "../migrations");
  runSqliteMigrations(db, migrationsDir);

  const rootApp = new Hono();
  const workerApp = createApp();

  rootApp.use("*", async (c, next) => {
    (c.env as unknown as { env: Env }).env = env;
    await next();
  });

  rootApp.route("/", workerApp);

  if (existsSync(staticDir)) {
    // ETag (304 bei If-None-Match) und Cache-Control für statische Dateien (Issue #263).
    rootApp.use("/*", etag());
    rootApp.use("/*", async (c, next) => {
      await next();
      if (c.res.status === 200 || c.res.status === 304) {
        c.header("cache-control", staticCacheControl(c.req.path));
      }
    });
    rootApp.use("/*", serveStatic({ root: staticDir }));
    rootApp.get("*", (c) => {
      const indexHtmlPath = join(staticDir, "index.html");
      if (existsSync(indexHtmlPath)) {
        const html = readFileSync(indexHtmlPath, "utf8");
        return c.html(html);
      }
      return c.text("Not Found", 404);
    });
  }

  return new Promise((resolvePromise) => {
    const server = serve(
      {
        fetch: (request, bindings) => {
          // The socket address is the only client IP a plain Node server can trust.
          registerSocketAddress(request, bindings.incoming.socket.remoteAddress);
          return rootApp.fetch(request, env);
        },
        port
      },
      (info) => {
        const instance: NodeServerInstance = {
          server,
          port: info.port,
          db,
          dataDir,
          close: () =>
            new Promise<void>((res) => {
              server.close(() => {
                try {
                  db.close();
                } catch {
                  // already closed or in-memory
                }
                res();
              });
            })
        };
        resolvePromise(instance);
      }
    );
  });
}

// Auto-run if executed directly as entrypoint
/* v8 ignore start */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("node-server.ts") || process.argv[1].endsWith("node-server.js"));

if (isDirectRun) {
  startNodeServer()
    .then((instance) => {
      console.log(`[node-server] Server listening on http://localhost:${instance.port}`);
    })
    .catch((err) => {
      console.error("[node-server] Failed to start:", err);
      process.exit(1);
    });
}
/* v8 ignore stop */
