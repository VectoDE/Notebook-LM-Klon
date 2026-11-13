import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { JobDO, NotebookDO } from "./durable-objects.js";
import { createApp } from "./index.js";
import { c2paSignerFromVars } from "./node/c2pa-signer.js";
import {
  type EnvSource,
  NodeConfigError,
  PASSTHROUGH_VARS,
  loadNodeConfig
} from "./node/config.js";
import { type InProcessNamespace, createInProcessNamespace } from "./node/do-namespace.js";
import { createLocalR2Adapter } from "./node/fs-r2.js";
import { type CleanupScheduler, runCleanupOnce, startCleanupScheduler } from "./node/scheduler.js";
import { type SmtpSettings, createSmtpBinding } from "./node/smtp.js";
import { createSqliteD1Adapter, openNodeDatabase, runSqliteMigrations } from "./node/sqlite-d1.js";
import { registerSocketAddress } from "./rate-limiter.js";

export { MAX_OBJECT_BYTES, ObjectTooLargeError, createLocalR2Adapter } from "./node/fs-r2.js";
export {
  createSqliteD1Adapter,
  openNodeDatabase,
  runSqliteMigrations
} from "./node/sqlite-d1.js";
export { NodeConfigError, loadNodeConfig } from "./node/config.js";
export { createInProcessNamespace } from "./node/do-namespace.js";

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
  /** Overrides CLEANUP_INTERVAL_MINUTES (0 disables the in-process cleanup). */
  cleanupIntervalMinutes?: number | undefined;
}

export interface NodeServerInstance {
  server: ReturnType<typeof serve>;
  port: number;
  db: DatabaseSync;
  dataDir: string;
  warnings: readonly string[];
  env: Env;
  /** In-process cron replacement, undefined when CLEANUP_INTERVAL_MINUTES=0. */
  scheduler: CleanupScheduler | undefined;
  close: () => Promise<void>;
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

export interface NodeEnvHandle {
  env: Env;
  db: DatabaseSync;
  dataDir: string;
  notebookNamespace: InProcessNamespace;
  jobNamespace: InProcessNamespace;
  /** Stops alarm timers and closes the Durable Object databases (not `db`). */
  close: () => void;
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
  /** SMTP delivery. When set it is used for all mail and Resend stays unused. */
  smtp?: SmtpSettings | undefined;
}): NodeEnvHandle {
  const dataDir = options?.dataDir ?? resolve(".data");
  const db = options?.db ?? openNodeDatabase(join(dataDir, "local.sqlite"));
  const { RESEND_API_KEY, ...vars } = options?.vars ?? pickPassthroughVars(process.env);

  const env: Record<string, unknown> = {
    ...vars,
    DB: createSqliteD1Adapter(db),
    MEDIA: createLocalR2Adapter(join(dataDir, "media")),
    APP_PROFILE: options?.appProfile ?? vars.APP_PROFILE ?? "demo",
    APP_ORIGIN: options?.appOrigin ?? vars.APP_ORIGIN ?? "http://localhost:8787",
    SESSION_SALT_SECRET: options?.sessionSaltSecret ?? vars.SESSION_SALT_SECRET,
    TRUSTED_PROXY_HEADER: options?.trustedProxyHeader ?? vars.TRUSTED_PROXY_HEADER,
    ASSETS: {
      fetch: async () => new Response("Not Found", { status: 404 })
    } as unknown as Fetcher
  };
  if (options?.smtp) {
    // Handed over as the SEND_EMAIL binding: the app sends through it as on Cloudflare,
    // and because RESEND_API_KEY is left out, SMTP is the only mail path.
    env.SEND_EMAIL = createSmtpBinding(options.smtp);
  } else if (RESEND_API_KEY !== undefined) {
    env.RESEND_API_KEY = RESEND_API_KEY;
  }

  // C2PA signing of exports (Issue #353): only when tool, certificate and key are configured.
  const provenanceSigner = c2paSignerFromVars(vars);
  if (provenanceSigner) {
    env.PROVENANCE_SIGNER = provenanceSigner;
  }

  // The real Durable Object classes, run in this process (see node/do-namespace.ts).
  const notebookNamespace = createInProcessNamespace(
    "NotebookDO",
    join(dataDir, "do", "NotebookDO"),
    (ctx) => new NotebookDO(ctx, env as unknown as Env)
  );
  const jobNamespace = createInProcessNamespace(
    "JobDO",
    join(dataDir, "do", "JobDO"),
    (ctx) => new JobDO(ctx, env as unknown as Env)
  );
  env.NOTEBOOK_DO = notebookNamespace;
  env.JOB_DO = jobNamespace;

  return {
    env: env as unknown as Env,
    db,
    dataDir,
    notebookNamespace,
    jobNamespace,
    close: () => {
      notebookNamespace.close();
      jobNamespace.close();
    }
  };
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

  const handle = createNodeEnv({
    db,
    dataDir,
    appProfile: options?.appProfile ?? config.appProfile,
    appOrigin: options?.appOrigin ?? config.appOrigin,
    trustedProxyHeader: options?.trustedProxyHeader ?? config.trustedProxyHeader,
    vars: config.vars,
    smtp: config.smtp
  });
  const { env } = handle;
  // Jobs that were waiting for their alarm when the previous process stopped run again.
  handle.jobNamespace.restoreAlarms();
  handle.notebookNamespace.restoreAlarms();

  const intervalMinutes = options?.cleanupIntervalMinutes ?? config.cleanupIntervalMinutes;
  const scheduler =
    intervalMinutes > 0
      ? startCleanupScheduler({ env, intervalMs: intervalMinutes * 60_000 })
      : undefined;

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
          env,
          scheduler,
          close: () =>
            new Promise<void>((res) => {
              scheduler?.stop();
              server.close(() => {
                handle.close();
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
 * One cleanup run for an external cron (host cron, Kubernetes CronJob): the same
 * runScheduledCleanup() as the Cloudflare cron trigger and the in-process scheduler.
 */
export async function runCleanupCommand(
  options: { env?: EnvSource | undefined; dataDir?: string | undefined } = {},
  log: Pick<Console, "info" | "error"> = console
): Promise<void> {
  const { config } = loadNodeConfig(options.env ?? process.env);
  const dataDir = options.dataDir ?? config.dataDir;
  const db = openNodeDatabase(join(dataDir, "local.sqlite"));
  const handle = createNodeEnv({ db, dataDir, vars: config.vars });
  try {
    runSqliteMigrations(db, resolve(dirname(fileURLToPath(import.meta.url)), "../migrations"));
    await runCleanupOnce(handle.env, undefined, log);
  } finally {
    handle.close();
    db.close();
  }
}

/**
 * CLI entry: `node-server.js` starts the server, `node-server.js cleanup` runs one cleanup.
 * Configuration problems are printed and give exit code 1. Returns the exit code, so it can
 * be tested without exiting the process.
 */
export async function runNodeServerCli(
  args: readonly string[] = process.argv.slice(2),
  deps: {
    start?: () => Promise<NodeServerInstance>;
    cleanup?: () => Promise<void>;
    log?: Pick<Console, "info" | "error">;
  } = {}
): Promise<number> {
  const log = deps.log ?? console;
  const command = args[0] ?? "serve";
  try {
    if (command === "cleanup") {
      await (deps.cleanup ?? (() => runCleanupCommand({}, log)))();
      return 0;
    }
    if (command !== "serve") {
      log.error(`[node-server] Unbekannter Befehl "${command}". Erlaubt: serve, cleanup.`);
      return 2;
    }
    const instance = await (deps.start ?? (() => startNodeServer()))();
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
    if (code !== 0 || process.argv[2] === "cleanup") {
      process.exit(code);
    }
  });
}
/* v8 ignore stop */
