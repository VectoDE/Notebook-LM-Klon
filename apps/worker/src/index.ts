import {
  HealthResponseSchema,
  type ServiceStatus,
  createProblemDetails
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { registerAudioRoutes } from "./audio-routes.js";
import {
  csrfProtection,
  requireAuth,
  requireNotebookRole,
  sessionMiddleware
} from "./auth-middleware.js";
import { registerBYOKRoutes } from "./byok-routes.js";
import { registerChatRoutes } from "./chat-routes.js";
import { registerChunkIngestionRoutes } from "./chunk-ingestion.js";
import { runScheduledCleanup } from "./cleanup.js";
import { resolveAppConfig } from "./config.js";
import { CoreRepository } from "./core-repository.js";
import { createD1DatabaseAdapter } from "./d1-adapter.js";
import { createDemoRoutes } from "./demo-routes.js";
import { createGuestAndMagicLinkRoutes } from "./guest-magic-link-routes.js";
import { registerJobRoutes } from "./job-routes.js";
import { createKeyVaultFromEnv } from "./key-vault.js";
import {
  CloudflareMailAdapter,
  type CloudflareSendEmailBinding,
  HttpMailAdapter,
  type MailAdapter
} from "./mail-adapter.js";
import { createPasskeyRoutes } from "./passkey-routes.js";
import { PasskeyService } from "./passkey-service.js";
import { registerProviderRoutes } from "./provider-routes.js";
import { type QuotaAction, quotaGuardMiddleware } from "./quota-guard.js";
import { RagRepository } from "./rag-repository.js";
import { rateLimiterMiddleware } from "./rate-limiter.js";
import {
  getConfiguredSessionSalt,
  hasConfiguredKek,
  recordQuotaUsage,
  requireConfiguredKek,
  requireConfiguredSessionSalt,
  requireNotebookRoleFromQuery,
  requireSourceRole,
  resolveAddSourceAction
} from "./route-guards.js";
import { registerSearchRoutes } from "./search-routes.js";
import { applySecurityHeaders } from "./security-headers.js";
import { SessionManager } from "./session.js";
import { registerSourcesUploadRoutes } from "./sources-upload.js";
import { registerUrlImportRoutes } from "./url-importer.js";
import { WORKER_VERSION } from "./version.js";

declare module "hono" {
  interface ContextVariableMap {
    /** Mirror of sessionUser for rate-limiter and quota-guard, which read "user". */
    user?: { id: string };
  }
}

type ApiEnv = { Bindings: Env; Variables: { sessionUser?: { id: string } } };

/** Optional secrets and bindings that are not part of the generated Env type. */
export interface OptionalSecrets {
  readonly SESSION_SALT_SECRET?: string;
  readonly TURNSTILE_SECRET_KEY?: string;
  readonly RESEND_API_KEY?: string;
  readonly MAIL_FROM?: string;
  readonly SEND_EMAIL?: CloudflareSendEmailBinding;
}

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

function notFoundProblem(path: string) {
  return createProblemDetails({
    status: 404,
    title: "Not Found",
    detail: `Endpunkt '${path}' wurde nicht gefunden.`,
    instance: path,
    code: "NOT_FOUND"
  });
}

export function createMailAdapter(secrets: OptionalSecrets): MailAdapter {
  if (secrets.RESEND_API_KEY && secrets.MAIL_FROM) {
    return new HttpMailAdapter("resend", secrets.RESEND_API_KEY, secrets.MAIL_FROM);
  }
  // Without a configured binding the adapter reports a delivery error (no silent success).
  return new CloudflareMailAdapter(secrets.SEND_EMAIL);
}

function registerHealthAndDemoRoutes(app: Hono<ApiEnv>): void {
  // Demo routes: /api/v1/demo/info and /api/v1/demo/seed
  app.all("/api/v1/demo/*", async (c) => {
    const db = createD1DatabaseAdapter(c.env.DB);
    const demoKey = c.env.DEMO_GEMINI_KEY ?? process.env.DEMO_GEMINI_KEY;
    const dynamicRoutes = createDemoRoutes({ db, demoGeminiKey: demoKey });
    const subPath = c.req.path.slice("/api/v1/demo".length);
    const subUrl = new URL(subPath, "https://local.worker");
    const subReq = new Request(subUrl.toString(), c.req.raw);
    return dynamicRoutes.fetch(subReq, c.env, safeExecutionCtx(c));
  });

  app.get("/api/v1/health", async (c) => {
    const config = resolveAppConfig(c.env);

    let d1Status: ServiceStatus = "ok";
    try {
      await c.env.DB.prepare("SELECT 1 AS ok").first();
    } catch {
      d1Status = "down";
    }

    const r2Status: ServiceStatus = c.env.MEDIA ? "ok" : "down";
    const doStatus: ServiceStatus = c.env.NOTEBOOK_DO && c.env.JOB_DO ? "ok" : "down";

    const overallStatus: ServiceStatus =
      d1Status === "ok" && r2Status === "ok" && doStatus === "ok" ? "ok" : "degraded";

    const payload = HealthResponseSchema.parse({
      status: overallStatus,
      version: WORKER_VERSION,
      profile: config.profile,
      timestamp: new Date().toISOString(),
      services: {
        d1: d1Status,
        r2: r2Status,
        durableObjects: doStatus
      }
    });

    return c.json(payload, overallStatus === "ok" ? 200 : 503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });
}

function safeExecutionCtx(c: { readonly executionCtx: unknown }): never {
  try {
    return c.executionCtx as never;
  } catch {
    return undefined as never;
  }
}

/**
 * Builds the complete API for one environment. Repositories and services are bound
 * to env.DB, so the app is built once per env object and cached (see createApp).
 *
 * Order: CSRF -> Session -> Rate-Limit -> route guards (auth, RBAC, quota) -> handler.
 * Security headers are applied to every response by the outer app in createApp().
 */
export function buildApiApp(env: Env): Hono<ApiEnv> {
  const config = resolveAppConfig(env);
  const secrets = env as unknown as OptionalSecrets;
  const isProduction = config.origin.startsWith("https://");

  const dbAdapter = createD1DatabaseAdapter(env.DB);
  const coreRepo = new CoreRepository(dbAdapter);
  const ragRepo = new RagRepository(dbAdapter);
  // No fallback salt: without SESSION_SALT_SECRET every session-creating route answers 503.
  const saltSecret = getConfiguredSessionSalt(env);
  const sessionManager = new SessionManager({ repo: coreRepo, saltSecret });
  const keyVault = hasConfiguredKek(env) ? createKeyVaultFromEnv(env) : undefined;

  const app = new Hono<ApiEnv>();

  // 1. Global API security chain
  app.use("*", csrfProtection({ allowedOrigins: [config.origin], isProduction }));
  app.use("*", sessionMiddleware(sessionManager));
  app.use("*", async (c, next) => {
    const sessionUser = c.get("sessionUser");
    if (sessionUser) {
      c.set("user", { id: sessionUser.id });
    }
    await next();
  });
  app.use("*", rateLimiterMiddleware());

  // 2. Public infrastructure routes
  registerHealthAndDemoRoutes(app);

  // 3. Auth (public, rate-limit category "auth")
  // Guest login, magic-link and passkey registration fail closed (503) when
  // TURNSTILE_SECRET_KEY is missing.
  // Every route that creates a session fails closed (503) when SESSION_SALT_SECRET is missing.
  const requireSalt = requireConfiguredSessionSalt();
  app.use("/api/v1/auth/guest", requireSalt);
  app.use("/api/v1/auth/magic-link", requireSalt);
  app.use("/api/v1/auth/magic-link/*", requireSalt);
  app.use("/api/v1/auth/passkey/login/*", requireSalt);
  app.route(
    "/api/v1/auth",
    createGuestAndMagicLinkRoutes({
      repo: coreRepo,
      sessionManager,
      mailAdapter: createMailAdapter(secrets),
      turnstileSecretKey: secrets.TURNSTILE_SECRET_KEY,
      appBaseUrl: config.origin,
      isProduction
    })
  );
  app.route(
    "/api/v1/auth/passkey",
    createPasskeyRoutes({
      repo: coreRepo,
      passkeyService: new PasskeyService({
        repo: coreRepo,
        rpName: "RelationNotes",
        rpID: new URL(config.origin).hostname,
        expectedOrigin: config.origin
      }),
      sessionManager,
      turnstileSecretKey: secrets.TURNSTILE_SECRET_KEY,
      isProduction
    })
  );

  // 4. Chat, search, audio (session + notebook role, LLM quota)
  const llmQuota = (): QuotaAction => ({ type: "llm_call" });

  app.use(
    "/api/v1/notebooks/:id/chat",
    requireAuth(),
    requireNotebookRole(coreRepo, "viewer", "id"),
    quotaGuardMiddleware(llmQuota),
    recordQuotaUsage(llmQuota)
  );
  app.use("/api/v1/chats/:id/messages", requireAuth());
  registerChatRoutes(app, { ragRepo, coreRepo, keyVault });

  app.use(
    "/api/v1/notebooks/:id/search",
    requireAuth(),
    requireNotebookRole(coreRepo, "viewer", "id")
  );
  registerSearchRoutes(app, { ragRepo, coreRepo });

  app.use(
    "/api/v1/notebooks/:id/audio-interject",
    requireAuth(),
    requireNotebookRole(coreRepo, "viewer", "id"),
    quotaGuardMiddleware(llmQuota),
    recordQuotaUsage(llmQuota)
  );
  registerAudioRoutes(app, { ragRepo, coreRepo, keyVault });

  // 5. Sources (editor for writes, viewer for download)
  app.use(
    "/api/v1/notebooks/:id/sources",
    requireAuth(),
    requireNotebookRole(coreRepo, "editor", "id"),
    quotaGuardMiddleware(resolveAddSourceAction),
    recordQuotaUsage(resolveAddSourceAction)
  );
  app.use(
    "/api/v1/notebooks/:id/sources/url",
    requireAuth(),
    requireNotebookRole(coreRepo, "editor", "id")
  );
  app.use("/api/v1/sources/:id/upload", requireSourceRole(coreRepo, ragRepo, "editor"));
  app.use("/api/v1/sources/:id/upload/complete", requireSourceRole(coreRepo, ragRepo, "editor"));
  app.use("/api/v1/sources/:id/file", requireSourceRole(coreRepo, ragRepo, "viewer"));
  // Chunk ingestion and source deletion change notebook content: editor role required.
  app.use("/api/v1/sources/:id/chunks", requireSourceRole(coreRepo, ragRepo, "editor"));
  app.on("DELETE", "/api/v1/sources/:id", requireSourceRole(coreRepo, ragRepo, "editor"));
  registerUrlImportRoutes(app, { ragRepo });
  registerSourcesUploadRoutes(app, { coreRepo, ragRepo });
  registerChunkIngestionRoutes(app, { ragRepo, coreRepo });

  // 6. Providers: catalog and routing decision are public, the network probe needs a session
  app.use("/api/v1/providers/ollama/probe", requireAuth());
  registerProviderRoutes(app, { ragRepo, keyVault });

  // 7. Jobs: status and cancel live under the notebook, so the notebook role is checked
  // and the job must belong to that notebook (IDOR protection, see fetchNotebookJob).
  app.use("/api/v1/jobs/enqueue", requireAuth());
  app.get("/api/v1/jobs", requireNotebookRoleFromQuery(coreRepo, "viewer"));
  app.get(
    "/api/v1/notebooks/:id/jobs/:jobId",
    requireAuth(),
    requireNotebookRole(coreRepo, "viewer", "id")
  );
  app.post(
    "/api/v1/notebooks/:id/jobs/:jobId/cancel",
    requireAuth(),
    requireNotebookRole(coreRepo, "editor", "id")
  );
  registerJobRoutes(app, { coreRepo });

  // 8. BYOK key management (last: its router adds its own same-origin CSRF check)
  app.use("/api/v1/keys", requireAuth(), requireConfiguredKek(), requireSalt);
  app.use("/api/v1/keys/*", requireAuth(), requireConfiguredKek(), requireSalt);
  registerBYOKRoutes(app, { ragRepo, coreRepo, keyVault, saltSecret });

  app.notFound((c) => c.json(notFoundProblem(c.req.path), 404, PROBLEM_HEADERS));

  return app;
}

const apiAppCache = new WeakMap<object, Hono<ApiEnv>>();

function getApiApp(env: Env): Hono<ApiEnv> {
  let api = apiAppCache.get(env);
  if (!api) {
    api = buildApiApp(env);
    apiAppCache.set(env, api);
  }
  return api;
}

export function createApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // Security headers on every response. The response is rebuilt because responses from
  // Durable Object stubs or fetch() can carry immutable headers.
  app.use("*", async (c, next) => {
    await next();
    const secured = new Response(c.res.body, c.res);
    applySecurityHeaders(secured.headers);
    c.res = undefined;
    c.res = secured;
  });

  app.all("/api/*", (c) => getApiApp(c.env).fetch(c.req.raw, c.env, safeExecutionCtx(c)));

  app.notFound((c) => c.json(notFoundProblem(c.req.path), 404, PROBLEM_HEADERS));

  return app;
}

const app = createApp();

export const scheduled = async (
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> => {
  const dbAdapter = createD1DatabaseAdapter(env.DB);

  const cleanupPromise = runScheduledCleanup({
    db: dbAdapter,
    mediaBucket: env.MEDIA
  }).then((metrics) => {
    console.info(
      JSON.stringify({
        event: "scheduled_cleanup_completed",
        metrics
      })
    );
  });

  ctx.waitUntil(cleanupPromise);
};

export default {
  fetch: app.fetch,
  scheduled
};
export {
  JobDO,
  NotebookDO,
  type DurableObjectHealthReport,
  type JobExecutor,
  type SqliteDurableObjectState
} from "./durable-objects.js";
