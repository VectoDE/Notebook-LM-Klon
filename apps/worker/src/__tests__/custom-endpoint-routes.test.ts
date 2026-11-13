import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import {
  type CustomEndpointRoutesDependencies,
  EndpointRepository,
  loadCustomProvider,
  registerCustomEndpointRoutes,
  resolveAllowlist
} from "../custom-endpoint-routes.js";
import { KeyVault, serializeEncryptedPayload } from "../key-vault.js";
import { RagRepository } from "../rag-repository.js";

const KEK = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY = "rf_live_0123456789abcdef";
const ALLOW = ["api.relationflow.example"];

function createDb(): { adapter: DatabaseAdapter; close: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of [
    "0001_initial_core.sql",
    "0002_rag_and_studio.sql",
    "0003_custom_endpoints.sql"
  ]) {
    sqlite.exec(readFileSync(resolve(process.cwd(), "apps/worker/migrations", file), "utf-8"));
  }
  type P = (string | number | bigint | null)[];
  return {
    adapter: {
      async query<T>(q: string, p: unknown[] = []) {
        return sqlite.prepare(q).all(...(p as P)) as T[];
      },
      async queryOne<T>(q: string, p: unknown[] = []) {
        return (sqlite.prepare(q).get(...(p as P)) as T) ?? null;
      },
      async run(q: string, p: unknown[] = []) {
        return { changes: Number(sqlite.prepare(q).run(...(p as P)).changes) };
      },
      async exec(sql: string) {
        sqlite.exec(sql);
      }
    },
    close: () => sqlite.close()
  };
}

type AppT = Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

describe("Eigener Endpunkt: Routen (Issue #247)", () => {
  let db: ReturnType<typeof createDb>;
  let ragRepo: RagRepository;
  let endpointRepo: EndpointRepository;
  let keyVault: KeyVault;
  let user: { id: string } | null;
  let fetchCalls: string[];
  let fetchResponse: () => Response;

  const fakeFetch = (async (url: string | URL | Request) => {
    fetchCalls.push(String(url));
    return fetchResponse();
  }) as unknown as typeof fetch;

  function buildApp(overrides: Partial<CustomEndpointRoutesDependencies> = {}): AppT {
    const app: AppT = new Hono();
    app.use("*", async (c, next) => {
      if (user) c.set("sessionUser", user);
      await next();
    });
    registerCustomEndpointRoutes(app, {
      ragRepo,
      endpointRepo,
      keyVault,
      allowlist: ALLOW,
      resolver: async () => ["93.184.215.14"],
      fetchFn: fakeFetch,
      ...overrides
    });
    return app;
  }

  const put = (app: AppT, body: unknown) =>
    app.request("/api/v1/providers/custom", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });

  async function storeKey(): Promise<void> {
    const payload = await keyVault.encrypt(KEY, { userId: "usr_a", provider: "custom" });
    await ragRepo.setProviderKey({
      id: "k1",
      user_id: "usr_a",
      provider: "custom",
      encrypted_key: serializeEncryptedPayload(payload),
      key_version: payload.version,
      last4: KEY.slice(-4),
      created_at: 1,
      updated_at: 1
    });
  }

  beforeEach(async () => {
    db = createDb();
    ragRepo = new RagRepository(db.adapter);
    endpointRepo = new EndpointRepository(db.adapter);
    keyVault = new KeyVault({ keks: { 1: KEK }, currentVersion: 1 });
    await new CoreRepository(db.adapter).createUser({
      id: "usr_a",
      email: "a@example.com",
      display_name: "A",
      locale: "de",
      is_guest: 0,
      created_at: 1,
      expires_at: null,
      deleted_at: null
    });
    user = { id: "usr_a" };
    fetchCalls = [];
    fetchResponse = () => Response.json({ data: [{ id: "rf-auto" }] });
  });

  afterEach(() => db.close());

  it("verlangt eine Sitzung auf allen Routen", async () => {
    user = null;
    const app = buildApp();
    expect((await app.request("/api/v1/providers/custom")).status).toBe(401);
    expect((await put(app, {})).status).toBe(401);
    expect((await app.request("/api/v1/providers/custom", { method: "DELETE" })).status).toBe(401);
    expect((await app.request("/api/v1/providers/custom/test", { method: "POST" })).status).toBe(
      401
    );
  });

  it("zeigt den leeren Zustand und die Allowlist aus der Umgebung", async () => {
    const app = buildApp({ allowlist: undefined });
    const off = await (await app.request("/api/v1/providers/custom")).json();
    expect(off).toEqual({
      enabled: false,
      configured: false,
      baseUrl: null,
      chatModel: null,
      embedModel: null,
      hasKey: false
    });
    const on = (await (
      await app.request("/api/v1/providers/custom", {}, {
        BYOM_ALLOWED_HOSTS: "api.relationflow.example"
      } as unknown as Env)
    ).json()) as { enabled: boolean };
    expect(on.enabled).toBe(true);
    expect(resolveAllowlist({}, undefined)).toEqual([]);
  });

  it("prüft den Body beim Speichern", async () => {
    const app = buildApp();
    expect((await put(app, "{kaputt")).status).toBe(400);
    const bad = await put(app, {
      baseUrl: "https://api.relationflow.example/v1",
      chatModel: "a b"
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["http://api.relationflow.example/v1", "ENDPOINT_NOT_HTTPS"],
    ["https://10.0.0.1/v1", "SSRF_DETECTED"],
    ["https://evil.example/v1", "ENDPOINT_NOT_ALLOWED"]
  ])("lehnt %s ab", async (baseUrl, code) => {
    const res = await put(buildApp(), { baseUrl, chatModel: "rf-auto" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe(code);
  });

  it("speichert, aktualisiert und löscht den Endpunkt samt Schlüssel", async () => {
    const app = buildApp();
    const first = await put(app, {
      baseUrl: "https://api.relationflow.example/v1/",
      chatModel: "rf-auto"
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      configured: true,
      baseUrl: "https://api.relationflow.example/v1",
      chatModel: "rf-auto",
      embedModel: null
    });
    const created = (await endpointRepo.get("usr_a"))?.created_at;

    await put(app, {
      baseUrl: "https://api.relationflow.example/v2",
      chatModel: "rf-pro",
      embedModel: "rf-embed"
    });
    const row = await endpointRepo.get("usr_a");
    expect(row).toMatchObject({
      base_url: "https://api.relationflow.example/v2",
      embed_model: "rf-embed"
    });
    expect(row?.created_at).toBe(created);

    await storeKey();
    const state = await (await app.request("/api/v1/providers/custom")).json();
    expect(state).toMatchObject({ configured: true, hasKey: true, chatModel: "rf-pro" });
    expect(JSON.stringify(state)).not.toContain(KEY);

    const del = await app.request("/api/v1/providers/custom", { method: "DELETE" });
    expect(await del.json()).toEqual({ configured: false });
    expect(await endpointRepo.get("usr_a")).toBeNull();
    expect(await ragRepo.getProviderKey("usr_a", "custom")).toBeNull();
  });

  it("Verbindungstest: 404 ohne Endpunkt, Erfolg mit Modellliste", async () => {
    const app = buildApp();
    expect((await app.request("/api/v1/providers/custom/test", { method: "POST" })).status).toBe(
      404
    );
    await put(app, { baseUrl: "https://api.relationflow.example/v1", chatModel: "rf-auto" });
    await storeKey();
    const res = await app.request("/api/v1/providers/custom/test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, models: ["rf-auto"] });
    expect(fetchCalls).toEqual(["https://api.relationflow.example/v1/models"]);
  });

  it("Verbindungstest: Fehler des Endpunkts ohne Schlüssel in der Antwort", async () => {
    fetchResponse = () => Response.json({ error: `bad ${KEY}` }, { status: 401 });
    const app = buildApp();
    await put(app, { baseUrl: "https://api.relationflow.example/v1", chatModel: "rf-auto" });
    await storeKey();
    const res = await app.request("/api/v1/providers/custom/test", { method: "POST" });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).toContain("401");
    expect(text).not.toContain(KEY);
  });

  it("Verbindungstest: nicht entschlüsselbarer Schlüssel", async () => {
    const app = buildApp({
      keyVault: new KeyVault({
        keks: { 1: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" },
        currentVersion: 1
      })
    });
    await put(app, { baseUrl: "https://api.relationflow.example/v1", chatModel: "rf-auto" });
    await storeKey();
    const res = await app.request("/api/v1/providers/custom/test", { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toContain("entschlüsseln");
  });

  it("baut den Provider auch ohne Schlüssel oder ohne Tresor", async () => {
    await endpointRepo.upsert({
      user_id: "usr_a",
      provider: "custom",
      base_url: "https://api.relationflow.example/v1",
      chat_model: "rf-auto",
      embed_model: "rf-embed",
      created_at: 1,
      updated_at: 1
    });
    const deps = { ragRepo, endpointRepo, keyVault: undefined, fetchFn: fakeFetch };
    expect(await loadCustomProvider(deps, "usr_a", ALLOW)).not.toBeNull();
    await storeKey();
    expect(await loadCustomProvider(deps, "usr_a", ALLOW)).not.toBeNull();
    expect(await loadCustomProvider(deps, "usr_x", ALLOW)).toBeNull();
  });
});
