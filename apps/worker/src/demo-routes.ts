/**
 * Demo API Routes:
 * - POST /api/v1/demo/seed (Trigger idempotent seeding for current session or system)
 * - GET /api/v1/demo/info (Get status of demo datasets & DEMO_GEMINI_KEY availability)
 *
 * Implements Sub-Issue #109 (Decision #45, #63).
 */

import {
  ALL_DEMO_NOTEBOOKS,
  CLOUDFLARE_ARCH_NOTEBOOK_ID,
  RELATIONFLOW_NOTEBOOK_ID,
  createProblemDetails
} from "@notebook-lm/shared";
import { Hono } from "hono";
import type { DatabaseAdapter } from "./core-repository.js";
import { DEMO_DISCLAIMER_TEXT, DEMO_HEADER_DISCLAIMER_KEY } from "./demo-key-guard.js";
import { DEMO_WORKSPACE_ID, seedDemoNotebooks } from "./demo-seeder.js";

export interface DemoRoutesDependencies {
  readonly db?: DatabaseAdapter | undefined;
  readonly demoGeminiKey?: string | undefined;
}

export function createDemoRoutes(deps: DemoRoutesDependencies = {}): Hono<{
  Bindings: Env;
  Variables: { sessionUser?: { id: string } };
}> {
  const router = new Hono<{
    Bindings: Env;
    Variables: { sessionUser?: { id: string } };
  }>();

  /**
   * GET /api/v1/demo/info
   * Returns list of available demo notebooks, their metadata and demo-key availability.
   */
  router.get("/info", async (c) => {
    const envDemoKey = deps.demoGeminiKey ?? c.env?.DEMO_GEMINI_KEY ?? process.env.DEMO_GEMINI_KEY;
    const hasDemoKey = Boolean(envDemoKey && envDemoKey.length > 5);

    const notebooks = ALL_DEMO_NOTEBOOKS.map((nb) => ({
      id: nb.id,
      title: nb.title,
      emoji: nb.emoji,
      description: nb.description,
      sourceCount: nb.sources.length,
      artifactCount: nb.artifacts.length,
      chatCount: nb.chats.length
    }));

    c.header(DEMO_HEADER_DISCLAIMER_KEY, DEMO_DISCLAIMER_TEXT);

    return c.json(
      {
        workspaceId: DEMO_WORKSPACE_ID,
        notebooks,
        hasDemoKey,
        disclaimer: DEMO_DISCLAIMER_TEXT
      },
      200,
      {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    );
  });

  /**
   * POST /api/v1/demo/seed
   * Idempotently seeds demo notebooks into D1.
   * If session user is present, grants membership to the user.
   */
  router.post("/seed", async (c) => {
    const dbAdapter = deps.db;
    if (!dbAdapter) {
      return c.json(
        createProblemDetails({
          status: 500,
          title: "Internal Server Error",
          detail: "Datenbank-Adapter ist nicht konfiguriert.",
          instance: c.req.path,
          code: "DB_ADAPTER_MISSING"
        }),
        500,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const sessionUserId = c.get("sessionUser")?.id;

    let body: { role?: "viewer" | "editor" } = {};
    try {
      body = (await c.req.json()) as { role?: "viewer" | "editor" };
    } catch {
      // Body is optional
    }

    const role = body.role ?? "viewer";

    const metrics = await seedDemoNotebooks(dbAdapter, {
      targetUserId: sessionUserId,
      grantAccessRole: role
    });

    c.header(DEMO_HEADER_DISCLAIMER_KEY, DEMO_DISCLAIMER_TEXT);

    return c.json(
      {
        success: true,
        workspaceId: DEMO_WORKSPACE_ID,
        notebookIds: [RELATIONFLOW_NOTEBOOK_ID, CLOUDFLARE_ARCH_NOTEBOOK_ID],
        metrics
      },
      200,
      {
        "content-type": "application/json; charset=utf-8"
      }
    );
  });

  return router;
}

export function registerDemoRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: DemoRoutesDependencies = {}
): void {
  const routes = createDemoRoutes(deps);
  app.route("/api/v1/demo", routes);
}
