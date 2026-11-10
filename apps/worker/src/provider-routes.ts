import type { ProvidersListResponse, RouteModelDecision } from "@notebook-lm/shared";
import { Hono } from "hono";
import { AutoRouter } from "./auto-router.js";
import { GeminiProvider } from "./gemini-provider.js";
import type { KeyVault } from "./key-vault.js";
import { OllamaLocalProvider } from "./ollama-provider.js";
import type { RagRepository } from "./rag-repository.js";

export interface ProviderRoutesDependencies {
  readonly autoRouter?: AutoRouter | undefined;
  readonly keyVault?: KeyVault | undefined;
  readonly ragRepo?: RagRepository | undefined;
  readonly defaultGeminiKey?: string | undefined;
  readonly demoGeminiKey?: string | undefined;
  readonly ollamaBaseUrl?: string | undefined;
}

export function createProviderRoutes(deps: ProviderRoutesDependencies = {}): Hono<{
  Bindings: Env;
  Variables: { sessionUser?: { id: string } };
}> {
  const router = new Hono<{
    Bindings: Env;
    Variables: { sessionUser?: { id: string } };
  }>();

  const routerInstance = deps.autoRouter ?? new AutoRouter();

  // Ensure default providers are registered in router if not already present
  if (!routerInstance.getProvider("google")) {
    const effectiveGeminiKey = deps.defaultGeminiKey ?? deps.demoGeminiKey;
    routerInstance.registerProvider(
      new GeminiProvider(effectiveGeminiKey ? { apiKey: effectiveGeminiKey } : {})
    );
  }
  if (!routerInstance.getProvider("ollama")) {
    routerInstance.registerProvider(
      new OllamaLocalProvider(deps.ollamaBaseUrl ? { baseUrl: deps.ollamaBaseUrl } : {})
    );
  }

  /**
   * GET /api/v1/providers
   * Returns all available providers, capabilities, training policies and the default auto decision.
   */
  router.get("/providers", async (c) => {
    const userId = c.get("sessionUser")?.id;
    let configuredKeys: string[] = ["google", "ollama"];

    if (userId && deps.ragRepo) {
      const activeKeys = await deps.ragRepo.listProviderKeysByUser(userId);
      const userConfigured = activeKeys.map((k) => k.provider);
      configuredKeys = Array.from(new Set([...configuredKeys, ...userConfigured]));
    }

    const providers = routerInstance.getCatalog(configuredKeys);
    const autoDecisionDefault = routerInstance.route({});

    const responsePayload: ProvidersListResponse = {
      providers,
      autoDecisionDefault
    };

    return c.json(responsePayload, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  /**
   * POST /api/v1/providers/route
   * Evaluate model routing decision for a given task, privacy mode or token estimate.
   */
  router.post("/providers/route", async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      // Empty body is acceptable
    }

    const userId = c.get("sessionUser")?.id;
    let availableKeys = (body.availableKeys as string[]) ?? ["google", "ollama"];

    if (userId && deps.ragRepo && !body.availableKeys) {
      const activeKeys = await deps.ragRepo.listProviderKeysByUser(userId);
      availableKeys = Array.from(new Set([...availableKeys, ...activeKeys.map((k) => k.provider)]));
    }

    const routeReq = {
      privacyMode: Boolean(body.privacyMode),
      forceLocal: Boolean(body.forceLocal),
      availableKeys,
      ...(typeof body.task === "string"
        ? { task: body.task as "chat" | "tts" | "coding" | "embedding" | "analysis" }
        : {}),
      ...(typeof body.estimatedTokens === "number"
        ? { estimatedTokens: body.estimatedTokens }
        : {}),
      ...(typeof body.preferredModel === "string" ? { preferredModel: body.preferredModel } : {})
    };

    const decision: RouteModelDecision = routerInstance.route(routeReq);

    return c.json(decision, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  /**
   * GET /api/v1/providers/ollama/probe
   * Probes Ollama reachability and reports latency.
   */
  router.get("/providers/ollama/probe", async (c) => {
    const provider = routerInstance.getProvider("ollama");
    if (!provider || !provider.probeHealth) {
      return c.json({ ok: false, message: "Ollama Provider nicht registriert", latencyMs: 0 }, 503);
    }

    const result = await provider.probeHealth();
    return c.json(result, result.ok ? 200 : 503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  return router;
}

export function registerProviderRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: ProviderRoutesDependencies = {}
): void {
  const routes = createProviderRoutes(deps);
  app.route("/api/v1", routes);
}
