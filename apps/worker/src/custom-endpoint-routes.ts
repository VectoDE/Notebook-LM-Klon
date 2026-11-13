/**
 * Eigener OpenAI-kompatibler Endpunkt je Nutzer (BYOM, Issue #247).
 *
 * - GET    /api/v1/providers/custom        gespeicherte Adresse und Modelle (ohne Schlüssel)
 * - PUT    /api/v1/providers/custom        Adresse und Modelle speichern (HTTPS + Allowlist)
 * - DELETE /api/v1/providers/custom        Adresse und zugehörigen Schlüssel löschen
 * - POST   /api/v1/providers/custom/test   Verbindungstest (GET /models am Endpunkt)
 *
 * Der Schlüssel selbst wird über `PUT /api/v1/keys/custom` verschlüsselt gespeichert und
 * verlässt den Server nie, auch nicht in Fehlermeldungen.
 */

import { createProblemDetails, z } from "@notebook-lm/shared";
import { type Context, Hono } from "hono";
import { csrfProtection } from "./auth-middleware.js";
import type { DatabaseAdapter } from "./core-repository.js";
import {
  BYOM_ALLOWLIST_ENV,
  type HostResolver,
  parseHostAllowlist,
  validateUserEndpoint
} from "./endpoint-guard.js";
import { type KeyVault, deserializeEncryptedPayload } from "./key-vault.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import type { RagRepository } from "./rag-repository.js";

export interface ProviderEndpointRow {
  readonly user_id: string;
  readonly provider: "custom";
  readonly base_url: string;
  readonly chat_model: string;
  readonly embed_model: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

/** Zugriff auf die Tabelle provider_endpoints (Migration 0003). */
export class EndpointRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  async get(userId: string): Promise<ProviderEndpointRow | null> {
    return this.db.queryOne<ProviderEndpointRow>(
      "SELECT * FROM provider_endpoints WHERE user_id = ? AND provider = 'custom'",
      [userId]
    );
  }

  async upsert(row: ProviderEndpointRow): Promise<void> {
    await this.db.run(
      `INSERT INTO provider_endpoints (user_id, provider, base_url, chat_model, embed_model, created_at, updated_at)
       VALUES (?, 'custom', ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         base_url = excluded.base_url,
         chat_model = excluded.chat_model,
         embed_model = excluded.embed_model,
         updated_at = excluded.updated_at`,
      [row.user_id, row.base_url, row.chat_model, row.embed_model, row.created_at, row.updated_at]
    );
  }

  async delete(userId: string): Promise<void> {
    await this.db.run("DELETE FROM provider_endpoints WHERE user_id = ? AND provider = 'custom'", [
      userId
    ]);
  }
}

const ModelNameSchema = z
  .string()
  .trim()
  .min(1, "Modellname fehlt.")
  .max(200, "Modellname ist zu lang.")
  .regex(/^[\w.:/@-]+$/, "Modellname enthält unzulässige Zeichen.");

export const CustomEndpointBodySchema = z.object({
  baseUrl: z.string().trim().min(1, "Adresse fehlt.").max(500, "Adresse ist zu lang."),
  chatModel: ModelNameSchema,
  embedModel: ModelNameSchema.optional()
});

export interface CustomEndpointRoutesDependencies {
  readonly ragRepo: RagRepository;
  readonly endpointRepo: EndpointRepository;
  readonly keyVault?: KeyVault | undefined;
  /** Überschreibt die Allowlist aus `BYOM_ALLOWED_HOSTS` (Tests). */
  readonly allowlist?: readonly string[] | undefined;
  readonly resolver?: HostResolver | undefined;
  readonly fetchFn?: typeof fetch | undefined;
}

type RouteEnv = { Bindings: Env; Variables: { sessionUser?: { id: string } } };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
} as const;
const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

function problem(
  c: Context<RouteEnv>,
  status: 400 | 401 | 404 | 422,
  code: string,
  detail: string
) {
  const titles = {
    400: "Bad Request",
    401: "Unauthorized",
    404: "Not Found",
    422: "Unprocessable Content"
  } as const;
  return c.json(
    createProblemDetails({ status, title: titles[status], detail, instance: c.req.path, code }),
    status,
    PROBLEM_HEADERS
  );
}

/** Löst die Allowlist auf: Abhängigkeit vor Umgebungsvariable. */
export function resolveAllowlist(
  deps: Pick<CustomEndpointRoutesDependencies, "allowlist">,
  env: unknown
): readonly string[] {
  if (deps.allowlist) return deps.allowlist;
  const record = (env ?? {}) as Record<string, unknown>;
  return parseHostAllowlist(record[BYOM_ALLOWLIST_ENV]);
}

/**
 * Baut einen Provider für den gespeicherten Endpunkt eines Nutzers. Liefert null, wenn kein
 * Endpunkt hinterlegt ist. Der Schlüssel ist optional (manche Endpunkte brauchen keinen).
 */
export async function loadCustomProvider(
  deps: CustomEndpointRoutesDependencies,
  userId: string,
  allowlist: readonly string[]
): Promise<OpenAiCompatibleProvider | null> {
  const endpoint = await deps.endpointRepo.get(userId);
  if (!endpoint) return null;

  let apiKey: string | undefined;
  const stored = await deps.ragRepo.getProviderKey(userId, "custom");
  if (stored && deps.keyVault) {
    apiKey = await deps.keyVault.decrypt(deserializeEncryptedPayload(stored.encrypted_key), {
      userId,
      provider: "custom"
    });
  }

  return new OpenAiCompatibleProvider({
    baseUrl: endpoint.base_url,
    apiKey,
    chatModel: endpoint.chat_model,
    embedModel: endpoint.embed_model ?? undefined,
    allowlist,
    resolver: deps.resolver,
    fetchFn: deps.fetchFn
  });
}

export function createCustomEndpointRoutes(deps: CustomEndpointRoutesDependencies): Hono<RouteEnv> {
  const router = new Hono<RouteEnv>();
  router.use("*", csrfProtection({}));

  router.get("/api/v1/providers/custom", async (c) => {
    const user = c.get("sessionUser");
    if (!user) return problem(c, 401, "UNAUTHORIZED", "Authentifizierung erforderlich.");

    const allowlist = resolveAllowlist(deps, c.env);
    const endpoint = await deps.endpointRepo.get(user.id);
    const key = await deps.ragRepo.getProviderKey(user.id, "custom");
    return c.json(
      {
        enabled: allowlist.length > 0,
        configured: endpoint !== null,
        baseUrl: endpoint?.base_url ?? null,
        chatModel: endpoint?.chat_model ?? null,
        embedModel: endpoint?.embed_model ?? null,
        hasKey: key !== null
      },
      200,
      JSON_HEADERS
    );
  });

  router.put("/api/v1/providers/custom", async (c) => {
    const user = c.get("sessionUser");
    if (!user) return problem(c, 401, "UNAUTHORIZED", "Authentifizierung erforderlich.");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, "INVALID_JSON", "Ungültiger JSON-Body.");
    }
    const parsed = CustomEndpointBodySchema.safeParse(body);
    if (!parsed.success) {
      return problem(c, 422, "VALIDATION_ERROR", parsed.error.issues[0]?.message as string);
    }

    const allowlist = resolveAllowlist(deps, c.env);
    const check = validateUserEndpoint(parsed.data.baseUrl, allowlist);
    if (!check.valid || !check.url) {
      return problem(c, 422, check.code as string, check.reason as string);
    }

    const now = Date.now();
    const existing = await deps.endpointRepo.get(user.id);
    const baseUrl = check.url.toString().replace(/\/+$/, "");
    await deps.endpointRepo.upsert({
      user_id: user.id,
      provider: "custom",
      base_url: baseUrl,
      chat_model: parsed.data.chatModel,
      embed_model: parsed.data.embedModel ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now
    });

    return c.json(
      {
        configured: true,
        baseUrl,
        chatModel: parsed.data.chatModel,
        embedModel: parsed.data.embedModel ?? null
      },
      200,
      JSON_HEADERS
    );
  });

  router.delete("/api/v1/providers/custom", async (c) => {
    const user = c.get("sessionUser");
    if (!user) return problem(c, 401, "UNAUTHORIZED", "Authentifizierung erforderlich.");

    await deps.endpointRepo.delete(user.id);
    await deps.ragRepo.deleteProviderKey(user.id, "custom");
    return c.json({ configured: false }, 200, JSON_HEADERS);
  });

  router.post("/api/v1/providers/custom/test", async (c) => {
    const user = c.get("sessionUser");
    if (!user) return problem(c, 401, "UNAUTHORIZED", "Authentifizierung erforderlich.");

    const allowlist = resolveAllowlist(deps, c.env);
    let provider: OpenAiCompatibleProvider | null;
    try {
      provider = await loadCustomProvider(deps, user.id, allowlist);
    } catch {
      return c.json(
        {
          ok: false,
          latencyMs: 0,
          message: "Gespeicherter Schlüssel ließ sich nicht entschlüsseln."
        },
        422,
        JSON_HEADERS
      );
    }
    if (!provider) {
      return problem(c, 404, "ENDPOINT_NOT_FOUND", "Kein eigener Endpunkt gespeichert.");
    }

    const result = await provider.probeHealth();
    return c.json(result, result.ok ? 200 : 422, JSON_HEADERS);
  });

  return router;
}

export function registerCustomEndpointRoutes(
  app: Hono<RouteEnv>,
  deps: CustomEndpointRoutesDependencies
): void {
  app.route("/", createCustomEndpointRoutes(deps));
}
