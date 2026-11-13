import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { createApp } from "./index.js";
import {
  type EnvSource,
  NodeConfigError,
  PASSTHROUGH_VARS,
  loadNodeConfig
} from "./node/config.js";
import { createLocalR2Adapter } from "./node/fs-r2.js";
import { createSqliteD1Adapter, openNodeDatabase, runSqliteMigrations } from "./node/sqlite-d1.js";
import { registerSocketAddress } from "./rate-limiter.js";

export { MAX_OBJECT_BYTES, ObjectTooLargeError, createLocalR2Adapter } from "./node/fs-r2.js";
export {
  createSqliteD1Adapter,
  openNodeDatabase,
  runSqliteMigrations
} from "./node/sqlite-d1.js";
export { NodeConfigError, loadNodeConfig } from "./node/config.js";

export interface NodeServerOptions {
  /** Environment to read the configuration from. Defaults to process.env. */
  env?: EnvSource | undefined;
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
  /** Receives startup warnings (missing optional features). Defaults to console.warn. */
  onWarning?: ((message: string) => void) | undefined;
}

export interface NodeServerInstance {
  server: ReturnType<typeof serve>;
  port: number;
  db: DatabaseSync;
  dataDir: string;
  warnings: readonly string[];
  close: () => Promise<void>;
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

/** Picks the PASSTHROUGH_VARS from an environment source, dropping blank values. */
export function pickPassthroughVars(source: EnvSource): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of PASSTHROUGH_VARS) {
    const value = source[name];
    if (typeof value === "string" && value.trim().length > 0) {
      vars[name] = value.trim();
    }
  }
  return vars;
}

export function createNodeEnv(options?: {
  db?: DatabaseSync | undefined;
  dataDir?: string | undefined;
  appProfile?: "demo" | "full" | undefined;
  appOrigin?: string | undefined;
  /** Defaults to vars.SESSION_SALT_SECRET. No fallback: missing means login is blocked (503). */
  sessionSaltSecret?: string | undefined;
  trustedProxyHeader?: string | undefined;
  /**
   * Secrets and settings with their Cloudflare names (SESSION_SALT_SECRET, TURNSTILE_SECRET_KEY,
   * KEK_V1 …). Defaults to the matching entries of process.env.
   */
  vars?: Readonly<Record<string, string>> | undefined;
}): { env: Env; db: DatabaseSync; dataDir: string } {
  const dataDir = options?.dataDir ?? resolve(".data");
  const db = options?.db ?? openNodeDatabase(join(dataDir, "local.sqlite"));
  const vars = options?.vars ?? pickPassthroughVars(process.env);

  const env = {
    ...vars,
    DB: createSqliteD1Adapter(db),
    MEDIA: createLocalR2Adapter(join(dataDir, "media")),
    APP_PROFILE: options?.appProfile ?? vars.APP_PROFILE ?? "demo",
    APP_ORIGIN: options?.appOrigin ?? vars.APP_ORIGIN ?? "http://localhost:8787",
    SESSION_SALT_SECRET: options?.sessionSaltSecret ?? vars.SESSION_SALT_SECRET,
    TRUSTED_PROXY_HEADER: options?.trustedProxyHeader ?? vars.TRUSTED_PROXY_HEADER,
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

/**
 * Starts the Node server. Reads and validates the configuration first and throws
 * NodeConfigError (nothing is opened or bound) when a mandatory secret is missing.
 */
export function startNodeServer(options?: NodeServerOptions): Promise<NodeServerInstance> {
  const { config, warnings } = loadNodeConfig(options?.env ?? process.env);
  const onWarning = options?.onWarning ?? ((message: string) => console.warn(message));
  for (const warning of warnings) {
    onWarning(`[node-server] Warnung: ${warning}`);
  }

  const port = options?.port ?? config.port;
  const dataDir = options?.dataDir ?? config.dataDir;
  const staticDir = options?.staticDir ?? config.staticDir;

  const db = openNodeDatabase(join(dataDir, "local.sqlite"));
  const currentDir = dirname(fileURLToPath(import.meta.url));
  runSqliteMigrations(db, resolve(currentDir, "../migrations"));

  const { env } = createNodeEnv({
    db,
    dataDir,
    appProfile: options?.appProfile ?? config.appProfile,
    appOrigin: options?.appOrigin ?? config.appOrigin,
    trustedProxyHeader: options?.trustedProxyHeader ?? config.trustedProxyHeader,
    vars: config.vars
  });

  const rootApp = new Hono();
  rootApp.route("/", createApp());

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
        return c.html(readFileSync(indexHtmlPath, "utf8"));
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
        resolvePromise({
          server,
          port: info.port,
          db,
          dataDir,
          warnings,
          close: () =>
            new Promise<void>((res) => {
              server.close(() => {
                db.close();
                res();
              });
            })
        });
      }
    );
  });
}

/**
 * CLI entry: start the server, or print the configuration problems and exit with code 1.
 * Returns the exit code instead of exiting, so it can be tested.
 */
export async function runNodeServerCli(
  start: () => Promise<NodeServerInstance> = () => startNodeServer(),
  log: Pick<Console, "info" | "error"> = console
): Promise<number> {
  try {
    const instance = await start();
    log.info(`[node-server] RelationNotes läuft auf http://localhost:${instance.port}`);
    return 0;
  } catch (err) {
    if (err instanceof NodeConfigError) {
      log.error(err.message);
    } else {
      log.error("[node-server] Start fehlgeschlagen:", err);
    }
    return 1;
  }
}

// Auto-run if executed directly as entrypoint
/* v8 ignore start */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("node-server.ts") || process.argv[1].endsWith("node-server.js"));

if (isDirectRun) {
  runNodeServerCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  });
}
/* v8 ignore stop */
