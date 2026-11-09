import {
  BYOKKeyMetadataSchema,
  BYOKKeyResponseListSchema,
  BYOKKeyTestResultSchema,
  BYOKProviderSchema,
  BYOKPutKeyBodySchema,
  BYOKRekeyResultSchema,
  createProblemDetails,
  extractLast4,
  maskApiKey
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { csrfProtection } from "./auth-middleware.js";
import type { CoreRepository } from "./core-repository.js";
import {
  type KeyVault,
  createKeyVaultFromEnv,
  deserializeEncryptedPayload,
  serializeEncryptedPayload
} from "./key-vault.js";
import type { RagRepository } from "./rag-repository.js";
import { computeDailySaltedHash } from "./session.js";

export interface BYOKRoutesDependencies {
  ragRepo: RagRepository;
  coreRepo?: CoreRepository | undefined;
  keyVault?: KeyVault | undefined;
  saltSecret?: string | undefined;
  /**
   * Optional custom validator callback for live provider verification testing.
   * Useful in integration tests or custom mocking environments.
   */
  testProviderKeyFn?: (
    provider: string,
    decryptedKey: string
  ) => Promise<{ valid: boolean; message: string }>;
}

/**
 * Default live validation tester for BYOK keys.
 * Performs format checks, provider-specific prefixes, or basic provider connectivity.
 */
export async function defaultTestProviderKey(
  provider: string,
  decryptedKey: string
): Promise<{ valid: boolean; message: string }> {
  const trimmed = decryptedKey.trim();

  switch (provider) {
    case "google": {
      // Google API Keys typically start with AIzaSy and are ~39 characters
      if (trimmed.startsWith("AIzaSy") && trimmed.length >= 30) {
        return { valid: true, message: "Google Gemini API-Key format valid." };
      }
      return {
        valid: false,
        message: "Ungültiges Format für Google Gemini API-Key (erwartet Präfix 'AIzaSy')."
      };
    }
    case "openai": {
      // OpenAI API Keys start with sk- or sk-proj-
      if (trimmed.startsWith("sk-") && trimmed.length >= 20) {
        return { valid: true, message: "OpenAI API-Key format valid." };
      }
      return {
        valid: false,
        message: "Ungültiges Format für OpenAI API-Key (erwartet Präfix 'sk-')."
      };
    }
    case "anthropic": {
      // Anthropic API Keys start with sk-ant-
      if (trimmed.startsWith("sk-ant-") && trimmed.length >= 25) {
        return { valid: true, message: "Anthropic Claude API-Key format valid." };
      }
      return {
        valid: false,
        message: "Ungültiges Format für Anthropic API-Key (erwartet Präfix 'sk-ant-')."
      };
    }
    case "groq": {
      if (trimmed.startsWith("gsk_") && trimmed.length >= 25) {
        return { valid: true, message: "Groq API-Key format valid." };
      }
      return {
        valid: false,
        message: "Ungültiges Format für Groq API-Key (erwartet Präfix 'gsk_')."
      };
    }
    default: {
      // deepseek, mistral, custom - accept non-empty keys meeting minimum length
      if (trimmed.length >= 10) {
        return { valid: true, message: `API-Key for provider '${provider}' format valid.` };
      }
      return {
        valid: false,
        message: `API-Key for provider '${provider}' must be at least 10 characters.`
      };
    }
  }
}

/**
 * Helper to write GDPR-compliant audit log entry if coreRepo is available.
 */
async function auditKeyAction(
  deps: BYOKRoutesDependencies,
  c: { req: { header: (name: string) => string | undefined } },
  userId: string,
  action: string,
  target: string
): Promise<void> {
  if (!deps.coreRepo) return;

  const clientIp =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";
  const salt = deps.saltSecret ?? "byok-audit-salt";
  const ipHash = await computeDailySaltedHash(clientIp, salt);
  /* v8 ignore next */
  const finalIpHash = ipHash ?? "unknown-ip";

  await deps.coreRepo.logAudit({
    id: crypto.randomUUID(),
    user_id: userId,
    action,
    target,
    ip_hash: finalIpHash,
    created_at: Date.now()
  });
}

/**
 * Creates and registers BYOK Key Management API routes:
 * - GET /api/v1/keys
 * - PUT /api/v1/keys/:provider
 * - DELETE /api/v1/keys/:provider
 * - POST /api/v1/keys/:provider/test
 * - POST /api/v1/keys/rekey (Key rotation)
 */
export function createBYOKRoutes(
  deps: BYOKRoutesDependencies
): Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }> {
  const router = new Hono<{
    Bindings: Env;
    Variables: { sessionUser?: { id: string } };
  }>();

  // Apply CSRF protection on mutating endpoints
  router.use("*", csrfProtection({}));

  // ---------------------------------------------------------------------------
  // 1. GET /api/v1/keys (List user's configured provider keys with masked last4)
  // ---------------------------------------------------------------------------
  router.get("/api/v1/keys", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Authentifizierung erforderlich.",
          instance: c.req.path,
          code: "UNAUTHORIZED"
        }),
        401,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const keyRows = await deps.ragRepo.listProviderKeysByUser(sessionUser.id);
    const keys = keyRows.map((row) =>
      BYOKKeyMetadataSchema.parse({
        provider: row.provider,
        keyVersion: row.key_version,
        last4: row.last4,
        masked: maskApiKey(row.last4),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        active: true
      })
    );

    const payload = BYOKKeyResponseListSchema.parse({ keys });
    return c.json(payload, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  // ---------------------------------------------------------------------------
  // 2. PUT /api/v1/keys/:provider (Store / update encrypted API key)
  // ---------------------------------------------------------------------------
  router.put("/api/v1/keys/:provider", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Authentifizierung erforderlich.",
          instance: c.req.path,
          code: "UNAUTHORIZED"
        }),
        401,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const providerParam = c.req.param("provider");
    const parsedProvider = BYOKProviderSchema.safeParse(providerParam);
    if (!parsedProvider.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: `Nicht unterstützter Provider '${providerParam}'.`,
          instance: c.req.path,
          code: "INVALID_PROVIDER"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }
    const provider = parsedProvider.data;

    let bodyJson: unknown;
    try {
      bodyJson = await c.req.json();
    } catch {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiger JSON-Body.",
          instance: c.req.path,
          code: "INVALID_JSON"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const parsedBody = BYOKPutKeyBodySchema.safeParse(bodyJson);
    if (!parsedBody.success) {
      return c.json(
        createProblemDetails({
          status: 422,
          title: "Unprocessable Content",
          detail: parsedBody.error.issues[0]?.message as string,
          instance: c.req.path,
          code: "VALIDATION_ERROR"
        }),
        422,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }
    const { apiKey } = parsedBody.data;

    // Resolve KeyVault (use injected vault or construct from Worker env)
    const vault = deps.keyVault ?? createKeyVaultFromEnv(c.env ?? {});
    const now = Date.now();
    const last4 = extractLast4(apiKey);

    // Encrypt with deterministic AAD binding
    const encryptedPayload = await vault.encrypt(apiKey, {
      userId: sessionUser.id,
      provider
    });

    const serialized = serializeEncryptedPayload(encryptedPayload);

    // Persist into database
    await deps.ragRepo.setProviderKey({
      id: crypto.randomUUID(),
      user_id: sessionUser.id,
      provider,
      encrypted_key: serialized,
      key_version: encryptedPayload.version,
      last4,
      created_at: now,
      updated_at: now
    });

    // Write audit log entry
    await auditKeyAction(deps, c, sessionUser.id, "byok_key_saved", provider);

    const metadata = BYOKKeyMetadataSchema.parse({
      provider,
      keyVersion: encryptedPayload.version,
      last4,
      masked: maskApiKey(last4),
      createdAt: now,
      updatedAt: now,
      active: true
    });

    return c.json(metadata, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  // ---------------------------------------------------------------------------
  // 3. DELETE /api/v1/keys/:provider (Safely delete provider key)
  // ---------------------------------------------------------------------------
  router.delete("/api/v1/keys/:provider", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Authentifizierung erforderlich.",
          instance: c.req.path,
          code: "UNAUTHORIZED"
        }),
        401,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const providerParam = c.req.param("provider");
    const parsedProvider = BYOKProviderSchema.safeParse(providerParam);
    if (!parsedProvider.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: `Nicht unterstützter Provider '${providerParam}'.`,
          instance: c.req.path,
          code: "INVALID_PROVIDER"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }
    const provider = parsedProvider.data;

    const existing = await deps.ragRepo.getProviderKey(sessionUser.id, provider);
    if (!existing) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Kein Schlüssel für Provider '${provider}' hinterlegt.`,
          instance: c.req.path,
          code: "KEY_NOT_FOUND"
        }),
        404,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    await deps.ragRepo.deleteProviderKey(sessionUser.id, provider);

    // Write audit log entry
    await auditKeyAction(deps, c, sessionUser.id, "byok_key_deleted", provider);

    return c.json({ success: true, message: `Key for provider '${provider}' deleted.` }, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  // ---------------------------------------------------------------------------
  // 4. POST /api/v1/keys/:provider/test (Test key decryptability & validity)
  // ---------------------------------------------------------------------------
  router.post("/api/v1/keys/:provider/test", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Authentifizierung erforderlich.",
          instance: c.req.path,
          code: "UNAUTHORIZED"
        }),
        401,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const providerParam = c.req.param("provider");
    const parsedProvider = BYOKProviderSchema.safeParse(providerParam);
    if (!parsedProvider.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: `Nicht unterstützter Provider '${providerParam}'.`,
          instance: c.req.path,
          code: "INVALID_PROVIDER"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }
    const provider = parsedProvider.data;

    const existing = await deps.ragRepo.getProviderKey(sessionUser.id, provider);
    if (!existing) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Kein Schlüssel für Provider '${provider}' hinterlegt.`,
          instance: c.req.path,
          code: "KEY_NOT_FOUND"
        }),
        404,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const startTime = performance.now();
    const vault = deps.keyVault ?? createKeyVaultFromEnv(c.env ?? {});

    let decryptedKey: string;
    try {
      const payload = deserializeEncryptedPayload(existing.encrypted_key);
      decryptedKey = await vault.decrypt(payload, {
        userId: sessionUser.id,
        provider
      });
    } catch {
      const latencyMs = Math.round(performance.now() - startTime);
      return c.json(
        BYOKKeyTestResultSchema.parse({
          provider,
          valid: false,
          message: "Kryptografische Entschlüsselung fehlgeschlagen (Integritätsverletzung).",
          latencyMs
        }),
        422,
        { "content-type": "application/json; charset=utf-8" }
      );
    }

    // Live validation against provider interface or format validator
    const tester = deps.testProviderKeyFn ?? defaultTestProviderKey;
    const testResult = await tester(provider, decryptedKey);
    const latencyMs = Math.round(performance.now() - startTime);

    const responsePayload = BYOKKeyTestResultSchema.parse({
      provider,
      valid: testResult.valid,
      message: testResult.message,
      latencyMs
    });

    return c.json(responsePayload, testResult.valid ? 200 : 422, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  // ---------------------------------------------------------------------------
  // 5. POST /api/v1/keys/rekey (Batch re-encryption on KEK rotation)
  // ---------------------------------------------------------------------------
  router.post("/api/v1/keys/rekey", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Authentifizierung erforderlich.",
          instance: c.req.path,
          code: "UNAUTHORIZED"
        }),
        401,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const vault = deps.keyVault ?? createKeyVaultFromEnv(c.env ?? {});
    const targetVersion = vault.getCurrentVersion();

    // Check optional targetVersion in request body
    let requestedTargetVersion = targetVersion;
    try {
      const body = (await c.req.json()) as { targetVersion?: number } | null;
      if (typeof body?.targetVersion === "number") {
        requestedTargetVersion = body.targetVersion;
      }
    } catch {
      // Body is optional
    }

    if (!vault.hasVersion(requestedTargetVersion)) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: `Ziel-KEK-Version ${requestedTargetVersion} ist im KeyVault nicht hinterlegt.`,
          instance: c.req.path,
          code: "KEK_VERSION_NOT_FOUND"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const userKeys = await deps.ragRepo.listProviderKeysByUser(sessionUser.id);
    let rotated = 0;
    let failed = 0;
    let skipped = 0;

    for (const keyRow of userKeys) {
      if (keyRow.key_version === requestedTargetVersion) {
        skipped++;
        continue;
      }

      try {
        const payload = deserializeEncryptedPayload(keyRow.encrypted_key);
        const rekeyedPayload = await vault.rekey(
          payload,
          {
            userId: sessionUser.id,
            provider: keyRow.provider
          },
          requestedTargetVersion
        );

        await deps.ragRepo.setProviderKey({
          ...keyRow,
          encrypted_key: serializeEncryptedPayload(rekeyedPayload),
          key_version: rekeyedPayload.version,
          updated_at: Date.now()
        });
        rotated++;
      } catch {
        failed++;
      }
    }

    await auditKeyAction(
      deps,
      c,
      sessionUser.id,
      "byok_rekey_completed",
      `v${requestedTargetVersion}`
    );

    const rekeyResponse = BYOKRekeyResultSchema.parse({
      total: userKeys.length,
      rotated,
      failed,
      skipped,
      newKeyVersion: requestedTargetVersion
    });

    return c.json(rekeyResponse, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  return router;
}

/**
 * Convenience helper to register BYOK routes into an existing Hono app.
 */
export function registerBYOKRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: BYOKRoutesDependencies
): void {
  const routes = createBYOKRoutes(deps);
  app.route("/", routes);
}
