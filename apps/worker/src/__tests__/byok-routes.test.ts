import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type BYOKRoutesDependencies,
  defaultTestProviderKey,
  registerBYOKRoutes
} from "../byok-routes.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { KeyVault } from "../key-vault.js";
import { RagRepository } from "../rag-repository.js";

function createMockD1(): { adapter: DatabaseAdapter; close: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  const m1 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql"),
    "utf-8"
  );
  sqlite.exec(m1);
  const m2 = readFileSync(
    resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql"),
    "utf-8"
  );
  sqlite.exec(m2);

  const adapter: DatabaseAdapter = {
    async query<T>(query: string, params: unknown[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(query);
      return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
    },
    async queryOne<T>(query: string, params: unknown[] = []): Promise<T | null> {
      const stmt = sqlite.prepare(query);
      const row = stmt.get(...(params as (string | number | bigint | null)[]));
      return (row as T) ?? null;
    },
    async run(query: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = sqlite.prepare(query);
      const result = stmt.run(...(params as (string | number | bigint | null)[]));
      return { changes: Number(result.changes) };
    },
    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    }
  };

  return { adapter, close: () => sqlite.close() };
}

describe("BYOK Key Management API & Rotation (Sub-Issues #93, #94)", () => {
  const KEK_V1 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const KEK_V2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

  let adapter: DatabaseAdapter;
  let closeDb: () => void;
  let coreRepo: CoreRepository;
  let ragRepo: RagRepository;
  let keyVault: KeyVault;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;
  let currentSessionUser: { id: string } | null;

  beforeEach(async () => {
    const d1 = createMockD1();
    adapter = d1.adapter;
    closeDb = d1.close;
    coreRepo = new CoreRepository(adapter);
    ragRepo = new RagRepository(adapter);
    keyVault = new KeyVault({ keks: { 1: KEK_V1, 2: KEK_V2 }, currentVersion: 1 });

    // Seed test user
    const now = Date.now();
    await coreRepo.createUser({
      id: "usr_alice",
      email: "alice@example.com",
      display_name: "Alice",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    currentSessionUser = { id: "usr_alice" };

    const deps: BYOKRoutesDependencies = {
      ragRepo,
      coreRepo,
      keyVault,
      saltSecret: "test-audit-salt"
    };

    app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      if (currentSessionUser) {
        c.set("sessionUser", currentSessionUser);
      }
      await next();
    });

    // Test registerBYOKRoutes helper
    registerBYOKRoutes(app, deps);
  });

  describe("Authentication & Authorization Guards", () => {
    it("returns 401 Unauthorized when session is missing across all endpoints", async () => {
      currentSessionUser = null;

      // GET /api/v1/keys
      const getRes = await app.request("/api/v1/keys");
      expect(getRes.status).toBe(401);

      // PUT /api/v1/keys/openai
      const putRes = await app.request("/api/v1/keys/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-proj-12345678901234567890" })
      });
      expect(putRes.status).toBe(401);

      // DELETE /api/v1/keys/openai
      const delRes = await app.request("/api/v1/keys/openai", { method: "DELETE" });
      expect(delRes.status).toBe(401);

      // POST /api/v1/keys/openai/test
      const testRes = await app.request("/api/v1/keys/openai/test", { method: "POST" });
      expect(testRes.status).toBe(401);

      // POST /api/v1/keys/rekey
      const rekeyRes = await app.request("/api/v1/keys/rekey", { method: "POST" });
      expect(rekeyRes.status).toBe(401);

      closeDb();
    });
  });

  describe("PUT /api/v1/keys/:provider", () => {
    it("validates provider param and rejects invalid providers with 400", async () => {
      const res = await app.request("/api/v1/keys/unsupported_provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-proj-12345678901234567890" })
      });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { code: string };
      expect(err.code).toBe("INVALID_PROVIDER");
      closeDb();
    });

    it("rejects non-JSON or malformed request body with 400", async () => {
      const res = await app.request("/api/v1/keys/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not-json"
      });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { code: string };
      expect(err.code).toBe("INVALID_JSON");
      closeDb();
    });

    it("rejects short or invalid API keys with 422", async () => {
      const res = await app.request("/api/v1/keys/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "short" })
      });
      expect(res.status).toBe(422);
      const err = (await res.json()) as { code: string };
      expect(err.code).toBe("VALIDATION_ERROR");
      closeDb();
    });

    it("encrypts and stores valid API key, never returning plaintext in response or logs", async () => {
      const rawKey = "sk-ant-api03-abcdef1234567890-validkey";
      const res = await app.request("/api/v1/keys/anthropic", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "198.51.100.1"
        },
        body: JSON.stringify({ apiKey: rawKey })
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        provider: string;
        last4: string;
        masked: string;
        keyVersion: number;
      };

      expect(data.provider).toBe("anthropic");
      expect(data.last4).toBe("dkey");
      expect(data.masked).toBe("••••dkey");
      expect(data.keyVersion).toBe(1);

      // Verify response body does NOT contain rawKey
      expect(JSON.stringify(data)).not.toContain(rawKey);

      // Verify database record
      const stored = await ragRepo.getProviderKey("usr_alice", "anthropic");
      expect(stored).not.toBeNull();
      expect(stored?.encrypted_key).not.toContain(rawKey);
      expect(stored?.last4).toBe("dkey");

      // Verify audit log entry was created
      const audits = await adapter.query<{ action: string; target: string; ip_hash: string }>(
        "SELECT * FROM audit_log WHERE user_id = ?",
        ["usr_alice"]
      );
      expect(audits.length).toBe(1);
      expect(audits[0]?.action).toBe("byok_key_saved");
      expect(audits[0]?.target).toBe("anthropic");
      expect(audits[0]?.ip_hash).not.toBe("198.51.100.1");

      closeDb();
    });
  });

  describe("GET /api/v1/keys (List metadata)", () => {
    it("returns list of configured keys with masked values only", async () => {
      // Seed two keys
      await app.request("/api/v1/keys/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-proj-0123456789abcdef9999" })
      });
      await app.request("/api/v1/keys/google", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "AIzaSyDummyGeminiKeyValid8888" })
      });

      const res = await app.request("/api/v1/keys");
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        keys: { provider: string; last4: string; masked: string; active: boolean }[];
      };

      expect(data.keys).toHaveLength(2);
      expect(data.keys.map((k) => k.provider)).toContain("google");
      expect(data.keys.map((k) => k.provider)).toContain("openai");
      expect(data.keys.find((k) => k.provider === "openai")?.masked).toBe("••••9999");
      expect(data.keys.find((k) => k.provider === "google")?.masked).toBe("••••8888");

      // Ensure no raw secrets leaked
      expect(JSON.stringify(data)).not.toContain("0123456789abcdef");
      expect(JSON.stringify(data)).not.toContain("DummyGeminiKeyValid");

      closeDb();
    });

    it("returns empty list if user has no keys configured", async () => {
      const res = await app.request("/api/v1/keys");
      expect(res.status).toBe(200);
      const data = (await res.json()) as { keys: unknown[] };
      expect(data.keys).toHaveLength(0);
      closeDb();
    });
  });

  describe("DELETE /api/v1/keys/:provider", () => {
    it("returns 400 on invalid provider parameter", async () => {
      const res = await app.request("/api/v1/keys/invalid_provider", { method: "DELETE" });
      expect(res.status).toBe(400);
      closeDb();
    });

    it("returns 404 when deleting a non-existent key", async () => {
      const res = await app.request("/api/v1/keys/deepseek", { method: "DELETE" });
      expect(res.status).toBe(404);
      const err = (await res.json()) as { code: string };
      expect(err.code).toBe("KEY_NOT_FOUND");
      closeDb();
    });

    it("deletes key securely and writes audit log", async () => {
      // Create key first
      await app.request("/api/v1/keys/mistral", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "mistral-valid-sample-key-1234" })
      });

      const delRes = await app.request("/api/v1/keys/mistral", { method: "DELETE" });
      expect(delRes.status).toBe(200);

      // Verify removed from database
      const stored = await ragRepo.getProviderKey("usr_alice", "mistral");
      expect(stored).toBeNull();
      closeDb();
    });

    it("ignores a client-supplied x-forwarded-for header outside a trusted source (#342)", async () => {
      const res = await app.request("/api/v1/keys/anthropic", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.195, 70.41.3.18"
        },
        body: JSON.stringify({ apiKey: "sk-ant-api03-abcdef1234567890-forwarded" })
      });
      expect(res.status).toBe(200);

      const audits = await adapter.query<{ ip_hash: string }>(
        "SELECT * FROM audit_log WHERE user_id = ? AND action = 'byok_key_saved'",
        ["usr_alice"]
      );
      expect(audits.map((a) => a.ip_hash)).toEqual(["unknown-ip"]);
      closeDb();
    });

    it("stores an audit entry without IP hash when no client IP is known (#342)", async () => {
      const res = await app.request("/api/v1/keys/google", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ apiKey: "AIzaSyDummyGeminiKeyValidNoHeader123" })
      });
      expect(res.status).toBe(200);

      const audits = await adapter.query<{ ip_hash: string }>(
        "SELECT * FROM audit_log WHERE user_id = ? AND target = 'google'",
        ["usr_alice"]
      );
      expect(audits.map((a) => a.ip_hash)).toEqual(["unknown-ip"]);
      closeDb();
    });

    it("works without coreRepo configured (skips audit log gracefully)", async () => {
      const customApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
      customApp.use("*", async (c, next) => {
        c.set("sessionUser", { id: "usr_alice" });
        await next();
      });
      registerBYOKRoutes(customApp, {
        ragRepo,
        keyVault
      });

      const res = await customApp.request("/api/v1/keys/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-proj-0123456789abcdefNoCoreRepo" })
      });
      expect(res.status).toBe(200);
      closeDb();
    });
  });

  describe("POST /api/v1/keys/:provider/test", () => {
    it("returns 400 on invalid provider parameter", async () => {
      const res = await app.request("/api/v1/keys/invalid_provider/test", { method: "POST" });
      expect(res.status).toBe(400);
      closeDb();
    });

    it("returns 404 when testing non-existent provider key", async () => {
      const res = await app.request("/api/v1/keys/groq/test", { method: "POST" });
      expect(res.status).toBe(404);
      closeDb();
    });

    it("decrypts and tests valid Google key successfully", async () => {
      await app.request("/api/v1/keys/google", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "AIzaSyDummyGeminiKeyValid123456" })
      });

      const res = await app.request("/api/v1/keys/google/test", { method: "POST" });
      expect(res.status).toBe(200);
      const result = (await res.json()) as { valid: boolean; provider: string; latencyMs: number };
      expect(result.valid).toBe(true);
      expect(result.provider).toBe("google");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      closeDb();
    });

    it("reports 422 when key format does not match provider requirements", async () => {
      // Put a key that fails Google's prefix rule
      await app.request("/api/v1/keys/google", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "invalid-prefix-gemini-key-1234" })
      });

      const res = await app.request("/api/v1/keys/google/test", { method: "POST" });
      expect(res.status).toBe(422);
      const result = (await res.json()) as { valid: boolean; message: string };
      expect(result.valid).toBe(false);
      expect(result.message).toContain("AIzaSy");

      closeDb();
    });

    it("returns 422 when ciphertext was corrupted or tampered with", async () => {
      await app.request("/api/v1/keys/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-proj-0123456789abcdef1234" })
      });

      // Tamper with stored database record
      await adapter.run(
        "UPDATE provider_keys SET encrypted_key = 'corrupted' WHERE user_id = ? AND provider = ?",
        ["usr_alice", "openai"]
      );

      const res = await app.request("/api/v1/keys/openai/test", { method: "POST" });
      expect(res.status).toBe(422);
      const result = (await res.json()) as { valid: boolean; message: string };
      expect(result.valid).toBe(false);
      expect(result.message).toContain("Integritätsverletzung");

      closeDb();
    });
  });

  describe("POST /api/v1/keys/rekey (Key Rotation Sub-Issue #94)", () => {
    it("returns 400 when requested targetVersion does not exist in KeyVault", async () => {
      const res = await app.request("/api/v1/keys/rekey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetVersion: 99 })
      });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { code: string };
      expect(err.code).toBe("KEK_VERSION_NOT_FOUND");
      closeDb();
    });

    it("rotates all user keys from KEK_V1 to KEK_V2 without data loss or downtime", async () => {
      // 1. Store key in v1
      const originalAnthropicKey = "sk-ant-api03-abcdef1234567890-testkey";
      const originalOpenAIKey = "sk-proj-0123456789abcdef12345678";

      await app.request("/api/v1/keys/anthropic", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: originalAnthropicKey })
      });
      await app.request("/api/v1/keys/openai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: originalOpenAIKey })
      });

      const beforeKeys = await ragRepo.listProviderKeysByUser("usr_alice");
      expect(beforeKeys.every((k) => k.key_version === 1)).toBe(true);

      // 2. Perform rekey to version 2
      const rekeyRes = await app.request("/api/v1/keys/rekey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetVersion: 2 })
      });

      expect(rekeyRes.status).toBe(200);
      const rekeyData = (await rekeyRes.json()) as {
        total: number;
        rotated: number;
        failed: number;
        skipped: number;
        newKeyVersion: number;
      };

      expect(rekeyData.total).toBe(2);
      expect(rekeyData.rotated).toBe(2);
      expect(rekeyData.failed).toBe(0);
      expect(rekeyData.skipped).toBe(0);
      expect(rekeyData.newKeyVersion).toBe(2);

      // 3. Verify all DB keys are now v2
      const afterKeys = await ragRepo.listProviderKeysByUser("usr_alice");
      expect(afterKeys.every((k) => k.key_version === 2)).toBe(true);

      // 4. Verify keys can be decrypted using v2
      const testRes = await app.request("/api/v1/keys/anthropic/test", { method: "POST" });
      expect(testRes.status).toBe(200);

      // 5. Subsequent rekey call skips keys already on target version
      const secondRekeyRes = await app.request("/api/v1/keys/rekey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetVersion: 2 })
      });
      const secondRekeyData = (await secondRekeyRes.json()) as {
        total: number;
        rotated: number;
        skipped: number;
      };
      expect(secondRekeyData.skipped).toBe(2);
      expect(secondRekeyData.rotated).toBe(0);

      // Verify audit log has rekey event
      const audits = await adapter.query<{ action: string; target: string }>(
        "SELECT * FROM audit_log WHERE action = 'byok_rekey_completed'"
      );
      expect(audits.length).toBe(2);
      expect(audits[0]?.target).toBe("v2");

      closeDb();
    });

    it("stores no IP hash (no default salt) when saltSecret is not provided in deps", async () => {
      const customApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
      customApp.use("*", async (c, next) => {
        c.set("sessionUser", { id: "usr_alice" });
        await next();
      });
      registerBYOKRoutes(customApp, {
        ragRepo,
        coreRepo,
        keyVault
      });

      const res = await customApp.request("/api/v1/keys/anthropic", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-ant-api03-abcdef1234567890-defaultSalt" })
      });
      expect(res.status).toBe(200);
      const audits = await adapter.query<{ ip_hash: string }>(
        "SELECT ip_hash FROM audit_log WHERE action = 'byok_key_saved'"
      );
      expect(audits.map((a) => a.ip_hash)).toEqual(["unknown-ip"]);
      closeDb();
    });

    it("handles rekey when some keys fail decryption gracefully", async () => {
      // Store one valid key and corrupt another
      await app.request("/api/v1/keys/groq", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "gsk_sample_groq_api_key_12345" })
      });
      await app.request("/api/v1/keys/mistral", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "mistral_valid_sample_key_98765" })
      });

      // Corrupt mistral key in DB
      await adapter.run(
        "UPDATE provider_keys SET encrypted_key = 'bad-data' WHERE provider = 'mistral'"
      );

      const res = await app.request("/api/v1/keys/rekey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetVersion: 2 })
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        total: number;
        rotated: number;
        failed: number;
      };
      expect(data.total).toBe(2);
      expect(data.rotated).toBe(1);
      expect(data.failed).toBe(1);

      closeDb();
    });

    it("handles rekey when body is present but targetVersion is not a number", async () => {
      const res = await app.request("/api/v1/keys/rekey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notTargetVersion: "hello" })
      });
      expect(res.status).toBe(200);
      closeDb();
    });

    it("uses createKeyVaultFromEnv when keyVault dependency is not injected", async () => {
      const customApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
      customApp.use("*", async (c, next) => {
        c.set("sessionUser", { id: "usr_alice" });
        await next();
      });
      registerBYOKRoutes(customApp, {
        ragRepo
      });
      const envWithKek = {
        KEK_V1: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      } as unknown as Env;

      // PUT
      const putRes = await customApp.request(
        "/api/v1/keys/openai",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: "sk-proj-0123456789abcdefDefaultEnv" })
        },
        envWithKek
      );
      expect(putRes.status).toBe(200);

      // TEST
      const testRes = await customApp.request(
        "/api/v1/keys/openai/test",
        { method: "POST" },
        envWithKek
      );
      expect(testRes.status).toBe(200);

      // REKEY
      const rekeyRes = await customApp.request(
        "/api/v1/keys/rekey",
        { method: "POST" },
        envWithKek
      );
      expect(rekeyRes.status).toBe(200);

      closeDb();
    });

    it("fails closed and stores nothing when no KEK is configured in env", async () => {
      const customApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
      customApp.use("*", async (c, next) => {
        c.set("sessionUser", { id: "usr_alice" });
        await next();
      });
      registerBYOKRoutes(customApp, {
        ragRepo
      });

      const putInit = {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "ds-0123456789abcdefNoKekEnv" })
      };

      // No env at all (c.env undefined) and an env without any KEK: both must fail closed
      const putNoEnv = await customApp.request("/api/v1/keys/deepseek", putInit);
      expect(putNoEnv.status).toBe(500);
      const putNoKek = await customApp.request("/api/v1/keys/deepseek", putInit, {
        APP_PROFILE: "full"
      } as unknown as Env);
      expect(putNoKek.status).toBe(500);
      expect(await ragRepo.getProviderKey("usr_alice", "deepseek")).toBeNull();

      // A key stored while a KEK was configured cannot be used once the KEK is gone
      const putWithKek = await customApp.request("/api/v1/keys/deepseek", putInit, {
        KEK_V1: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
      } as unknown as Env);
      expect(putWithKek.status).toBe(200);

      const testNoKek = await customApp.request("/api/v1/keys/deepseek/test", { method: "POST" });
      expect(testNoKek.status).toBe(500);
      const rekeyNoKek = await customApp.request("/api/v1/keys/rekey", { method: "POST" });
      expect(rekeyNoKek.status).toBe(500);

      closeDb();
    });
  });

  describe("defaultTestProviderKey Unit Tests", () => {
    it("tests provider formats across openai, anthropic, google, groq, deepseek, mistral, custom", async () => {
      // Google
      expect(
        (await defaultTestProviderKey("google", "AIzaSyValidGoogleKey123456789012345")).valid
      ).toBe(true);
      expect((await defaultTestProviderKey("google", "short")).valid).toBe(false);

      // OpenAI
      expect(
        (await defaultTestProviderKey("openai", "sk-proj-validOpenAiKey1234567890")).valid
      ).toBe(true);
      expect((await defaultTestProviderKey("openai", "bad-key-without-prefix")).valid).toBe(false);

      // Anthropic
      expect(
        (await defaultTestProviderKey("anthropic", "sk-ant-api03-abcdef12345678901234")).valid
      ).toBe(true);
      expect((await defaultTestProviderKey("anthropic", "bad-key")).valid).toBe(false);

      // Groq
      expect(
        (await defaultTestProviderKey("groq", "gsk_validGroqApiKeySample12345678")).valid
      ).toBe(true);
      expect((await defaultTestProviderKey("groq", "bad-key")).valid).toBe(false);

      // Default (deepseek, mistral, custom)
      expect((await defaultTestProviderKey("deepseek", "sk-valid-deepseek-key")).valid).toBe(true);
      expect((await defaultTestProviderKey("deepseek", "short")).valid).toBe(false);
      expect((await defaultTestProviderKey("mistral", "mistral-valid-key-sample")).valid).toBe(
        true
      );
      expect((await defaultTestProviderKey("custom", "custom-api-key-1234")).valid).toBe(true);

      closeDb();
    });
  });
});
