import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NodeConfigError,
  createMockDurableObjectNamespace,
  createNodeEnv,
  pickPassthroughVars,
  runNodeServerCli,
  startNodeServer
} from "../node-server.js";
import { clearRateLimitMemory } from "../rate-limiter.js";

let TEST_DATA_DIR = "";

/** Minimal valid configuration: the mandatory secrets (test values only). */
const SECRETS = {
  SESSION_SALT_SECRET: "test-only-session-salt-0123456789abcdef",
  KEK_V1: "test-only-kek-0123456789abcdef0123456789"
} as const;

function safeCleanDir(dir: string): void {
  if (dir && existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Best-effort cleanup on Windows
    }
  }
}

describe("Node.js Runtime & Adapters (Decision #111)", () => {
  beforeEach(() => {
    TEST_DATA_DIR = mkdtempSync(join(tmpdir(), "data-test-node-server-"));
  });

  afterEach(() => {
    safeCleanDir(TEST_DATA_DIR);
  });

  describe("createMockDurableObjectNamespace", () => {
    it("provides IDs and fetches /health or generic DO routes", async () => {
      const doNamespace = createMockDurableObjectNamespace("TestDO");

      const idByName = doNamespace.idFromName("notebook-123");
      expect(idByName.toString()).toBe("TestDO-notebook-123");
      expect(idByName.equals(idByName)).toBe(false);

      const uniqueId = doNamespace.newUniqueId();
      expect(uniqueId.toString()).toContain("TestDO-");

      const idFromStr = doNamespace.idFromString("custom-id");
      expect(idFromStr.toString()).toBe("custom-id");
      expect(idFromStr.equals(idFromStr)).toBe(false);
      expect(uniqueId.equals(uniqueId)).toBe(false);

      const stub = doNamespace.get(uniqueId);
      const healthRes = await stub.fetch("http://localhost/health");
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as { ok: boolean };
      expect(healthJson.ok).toBe(true);

      const otherRes = await stub.fetch(new Request("http://localhost/other"));
      expect(otherRes.status).toBe(200);
    });
  });

  describe("createNodeEnv", () => {
    it("creates environment bindings with default or custom options", async () => {
      const { env, db } = createNodeEnv({
        dataDir: TEST_DATA_DIR,
        appProfile: "full",
        appOrigin: "http://127.0.0.1:8787"
      });
      expect(env.APP_PROFILE).toBe("full");
      expect(env.APP_ORIGIN).toBe("http://127.0.0.1:8787");
      expect(env.DB).toBeDefined();
      expect(env.MEDIA).toBeDefined();
      expect(env.NOTEBOOK_DO).toBeDefined();
      expect(env.JOB_DO).toBeDefined();
      const assetRes = await env.ASSETS.fetch("http://localhost/asset.png");
      expect(assetRes.status).toBe(404);
      db.close();
    });

    it("creates default data directory when not provided", () => {
      const customDb = new DatabaseSync(":memory:");
      const { env } = createNodeEnv({ db: customDb });
      expect(env.APP_PROFILE).toBe("demo");
      customDb.close();
    });

    it("takes SESSION_SALT_SECRET from options or process.env and never invents one", () => {
      const customDb = new DatabaseSync(":memory:");
      const read = (e: Env) => (e as unknown as Record<string, unknown>).SESSION_SALT_SECRET;
      vi.stubEnv("SESSION_SALT_SECRET", "from-process-env");
      try {
        expect(read(createNodeEnv({ db: customDb }).env)).toBe("from-process-env");
        expect(read(createNodeEnv({ db: customDb, sessionSaltSecret: "explicit" }).env)).toBe(
          "explicit"
        );
        vi.stubEnv("SESSION_SALT_SECRET", undefined);
        expect(read(createNodeEnv({ db: customDb }).env)).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
        customDb.close();
      }
    });
  });

  describe("startNodeServer integration", () => {
    it("boots HTTP server on ephemeral port, serves health check and handles static fallback", async () => {
      const staticDir = join(TEST_DATA_DIR, "static");
      mkdirSync(staticDir, { recursive: true });
      writeFileSync(join(staticDir, "index.html"), "<html><body>App Loaded</body></html>");
      writeFileSync(join(staticDir, "style.css"), "body { margin: 0; }");

      const serverInstance = await startNodeServer({
        env: SECRETS,
        onWarning: () => {},
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data"),
        staticDir,
        appProfile: "demo",
        appOrigin: "http://localhost:8787"
      });

      const port = serverInstance.port;
      expect(port).toBeGreaterThan(0);

      // 1. Check /api/v1/health
      const healthRes = await fetch(`http://localhost:${port}/api/v1/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as {
        status: string;
        services: { d1: string; r2: string };
      };
      expect(healthJson.status).toBe("ok");
      expect(healthJson.services.d1).toBe("ok");
      expect(healthJson.services.r2).toBe("ok");

      // 2. Check static file serve
      const cssRes = await fetch(`http://localhost:${port}/style.css`);
      expect(cssRes.status).toBe(200);

      // 3. Check SPA html fallback on unknown route
      const spaRes = await fetch(`http://localhost:${port}/unknown/route`);
      expect(spaRes.status).toBe(200);
      const spaHtml = await spaRes.text();
      expect(spaHtml).toContain("App Loaded");

      await serverInstance.close();
    }, 15000);

    it("serves 404 when static directory has no index.html and route is unknown", async () => {
      const emptyStaticDir = join(TEST_DATA_DIR, "empty-static");
      mkdirSync(emptyStaticDir, { recursive: true });

      const serverInstance = await startNodeServer({
        env: SECRETS,
        onWarning: () => {},
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data-empty"),
        staticDir: emptyStaticDir
      });

      const port = serverInstance.port;
      const res = await fetch(`http://localhost:${port}/random-unknown-page`);
      expect(res.status).toBe(404);

      await serverInstance.close();
    });

    it("boots with defaults from process.env and reports warnings via console.warn", async () => {
      vi.stubEnv("PORT", "0");
      vi.stubEnv("DATA_DIR", join(TEST_DATA_DIR, "srv-data-default"));
      vi.stubEnv("STATIC_DIR", join(TEST_DATA_DIR, "no-static"));
      vi.stubEnv("SESSION_SALT_SECRET", SECRETS.SESSION_SALT_SECRET);
      vi.stubEnv("KEK_V1", SECRETS.KEK_V1);
      vi.stubEnv("TURNSTILE_SECRET_KEY", "");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const serverInstance = await startNodeServer();
        expect(serverInstance.port).toBeGreaterThan(0);
        expect(serverInstance.dataDir).toBe(join(TEST_DATA_DIR, "srv-data-default"));
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/TURNSTILE_SECRET_KEY fehlt/));
        await serverInstance.close();
      } finally {
        warn.mockRestore();
        vi.unstubAllEnvs();
      }
    });

    it("refuses to start without mandatory secrets and opens nothing", async () => {
      const dataDir = join(TEST_DATA_DIR, "srv-data-refused");
      expect(() => startNodeServer({ env: {}, port: 0, dataDir })).toThrow(NodeConfigError);
      expect(existsSync(dataDir)).toBe(false);
    });

    it("boots without static directory configured or existing", async () => {
      const nonExistentStatic = join(TEST_DATA_DIR, "does-not-exist-dir");
      const serverInstance = await startNodeServer({
        env: SECRETS,
        onWarning: () => {},
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data-nostatic"),
        staticDir: nonExistentStatic
      });

      const port = serverInstance.port;
      const healthRes = await fetch(`http://localhost:${port}/api/v1/health`);
      expect(healthRes.status).toBe(200);

      await serverInstance.close();
    });

    it("reaches every API router over HTTP on the Node path (wiring, not 404)", async () => {
      clearRateLimitMemory();
      // Explicit test salt: without SESSION_SALT_SECRET the login routes answer 503.
      vi.stubEnv("SESSION_SALT_SECRET", "test-only-session-salt-node-wiring");
      const serverInstance = await startNodeServer({
        env: SECRETS,
        onWarning: () => {},
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data-routers"),
        staticDir: join(TEST_DATA_DIR, "no-static"),
        appOrigin: "http://localhost:8787"
      });
      const base = `http://localhost:${serverInstance.port}`;
      const json = { "content-type": "application/json" };
      const probe = async (method: string, path: string, body?: unknown) => {
        const init: RequestInit = { method, headers: json };
        if (body !== undefined) init.body = JSON.stringify(body);
        const res = await fetch(`${base}${path}`, init);
        const payload = (await res.json()) as { code?: string };
        return { status: res.status, code: payload.code };
      };

      try {
        // Protected routers answer from their guard (401), proving the route exists.
        const protectedRoutes: Array<[string, string, unknown?]> = [
          ["POST", "/api/v1/notebooks/nb_x/chat", { message: "Hallo" }],
          ["GET", "/api/v1/chats/c_x/messages"],
          ["POST", "/api/v1/notebooks/nb_x/search", { query: "x" }],
          ["POST", "/api/v1/notebooks/nb_x/audio-interject", { question: "x" }],
          ["POST", "/api/v1/notebooks/nb_x/sources", { filename: "a.pdf" }],
          ["POST", "/api/v1/notebooks/nb_x/sources/url", { url: "https://example.org" }],
          ["PUT", "/api/v1/sources/s_x/upload", "x"],
          ["POST", "/api/v1/sources/s_x/chunks", { chunks: [] }],
          ["DELETE", "/api/v1/sources/s_x"],
          ["POST", "/api/v1/jobs/enqueue", { type: "briefing" }],
          ["GET", "/api/v1/keys"],
          ["GET", "/api/v1/providers/ollama/probe"],
          ["POST", "/api/v1/auth/passkey/register/options", {}]
        ];
        for (const [method, path, body] of protectedRoutes) {
          const res = await probe(method, path, body);
          expect({ method, path, ...res }).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
        }

        // Public routers answer with their own result.
        expect((await probe("GET", "/api/v1/providers")).status).toBe(200);
        expect((await probe("POST", "/api/v1/auth/passkey/login/options", {})).status).toBe(200);
        // Guest login fails closed without TURNSTILE_SECRET_KEY (route reached, not 404).
        expect(await probe("POST", "/api/v1/auth/guest", {})).toEqual({
          status: 503,
          code: "TURNSTILE_NOT_CONFIGURED"
        });
        expect((await probe("GET", "/api/v1/demo/info")).status).toBe(200);

        // Unknown API paths stay 404, so the 401s above are real routes.
        expect(await probe("GET", "/api/v1/does-not-exist")).toEqual({
          status: 404,
          code: "NOT_FOUND"
        });
      } finally {
        await serverInstance.close();
        vi.unstubAllEnvs();
      }
    }, 15000);

    it("rate-limits by socket address and ignores spoofed IP headers (#334)", async () => {
      clearRateLimitMemory();
      const serverInstance = await startNodeServer({
        env: SECRETS,
        onWarning: () => {},
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data-ratelimit"),
        staticDir: join(TEST_DATA_DIR, "no-static")
      });
      const url = `http://localhost:${serverInstance.port}/api/v1/health`;

      const first = await fetch(url, {
        headers: { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "198.51.100.1" }
      });
      const second = await fetch(url, {
        headers: { "cf-connecting-ip": "198.51.100.2", "x-forwarded-for": "198.51.100.2" }
      });

      // Same socket, same bucket: rotating the spoofed headers does not reset the counter
      expect(first.headers.get("X-RateLimit-Remaining")).toBe("119");
      expect(second.headers.get("X-RateLimit-Remaining")).toBe("118");

      await serverInstance.close();
    });

    it("uses the configured trusted proxy header when TRUSTED_PROXY_HEADER is set (#334)", async () => {
      clearRateLimitMemory();
      const serverInstance = await startNodeServer({
        env: { ...SECRETS, TRUSTED_PROXY_HEADER: "X-Forwarded-For" },
        onWarning: () => {},
        port: 0,
        dataDir: join(TEST_DATA_DIR, "srv-data-proxy"),
        staticDir: join(TEST_DATA_DIR, "no-static")
      });
      const url = `http://localhost:${serverInstance.port}/api/v1/health`;

      const a1 = await fetch(url, { headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.1" } });
      const a2 = await fetch(url, { headers: { "x-forwarded-for": "7.7.7.7, 198.51.100.1" } });
      const b1 = await fetch(url, { headers: { "x-forwarded-for": "198.51.100.2" } });

      // The proxy-appended last entry identifies the client; client-prepended entries do not
      expect(a1.headers.get("X-RateLimit-Remaining")).toBe("119");
      expect(a2.headers.get("X-RateLimit-Remaining")).toBe("118");
      expect(b1.headers.get("X-RateLimit-Remaining")).toBe("119");

      await serverInstance.close();
    });
  });

  it("passes trustedProxyHeader from options into the environment", () => {
    const customDb = new DatabaseSync(":memory:");
    const { env } = createNodeEnv({ db: customDb, trustedProxyHeader: "x-real-ip" });
    expect((env as unknown as { TRUSTED_PROXY_HEADER?: string }).TRUSTED_PROXY_HEADER).toBe(
      "x-real-ip"
    );
    customDb.close();
  });

  describe("runNodeServerCli", () => {
    it("returns 0 and logs the address when the server starts", async () => {
      const info = vi.fn();
      const code = await runNodeServerCli(
        async () => ({ port: 1234 }) as unknown as Awaited<ReturnType<typeof startNodeServer>>,
        { info, error: vi.fn() }
      );
      expect(code).toBe(0);
      expect(info).toHaveBeenCalledWith(expect.stringContaining("http://localhost:1234"));
    });

    it("prints the configuration problems and returns 1", async () => {
      const error = vi.fn();
      const code = await runNodeServerCli(
        async () => {
          throw new NodeConfigError(["SESSION_SALT_SECRET fehlt."]);
        },
        { info: vi.fn(), error }
      );
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/Start abgebrochen[\s\S]*SESSION_SALT_SECRET fehlt/)
      );
    });

    it("returns 1 for other startup errors", async () => {
      const error = vi.fn();
      const code = await runNodeServerCli(
        async () => {
          throw new Error("EADDRINUSE");
        },
        { info: vi.fn(), error }
      );
      expect(code).toBe(1);
      expect(error).toHaveBeenCalledWith("[node-server] Start fehlgeschlagen:", expect.any(Error));
    });

    it("uses startNodeServer and console by default", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("SESSION_SALT_SECRET", "");
      try {
        expect(await runNodeServerCli()).toBe(1);
        expect(error).toHaveBeenCalledWith(expect.stringMatching(/SESSION_SALT_SECRET fehlt/));
      } finally {
        error.mockRestore();
        vi.unstubAllEnvs();
      }
    });
  });

  describe("environment passthrough (#338)", () => {
    it("pickPassthroughVars keeps known, non-blank variables only", () => {
      expect(
        pickPassthroughVars({
          TURNSTILE_SECRET_KEY: " 1x0000000000000000000000000000000AA ",
          KEK_V2: "k",
          MAIL_FROM: "",
          PATH: "/usr/bin"
        })
      ).toEqual({ TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", KEK_V2: "k" });
    });

    it("createNodeEnv copies TURNSTILE_SECRET_KEY and KEKs into env (from vars or process.env)", () => {
      const customDb = new DatabaseSync(":memory:");
      const record = (e: Env) => e as unknown as Record<string, unknown>;
      try {
        const fromVars = createNodeEnv({
          db: customDb,
          dataDir: TEST_DATA_DIR,
          vars: { TURNSTILE_SECRET_KEY: "turnstile-secret", KEK_V1: "kek", APP_PROFILE: "full" }
        }).env;
        expect(record(fromVars).TURNSTILE_SECRET_KEY).toBe("turnstile-secret");
        expect(record(fromVars).KEK_V1).toBe("kek");
        expect(fromVars.APP_PROFILE).toBe("full");

        vi.stubEnv("TURNSTILE_SECRET_KEY", "from-process");
        const fromProcess = createNodeEnv({ db: customDb, dataDir: TEST_DATA_DIR }).env;
        expect(record(fromProcess).TURNSTILE_SECRET_KEY).toBe("from-process");
        vi.stubEnv("TURNSTILE_SECRET_KEY", "");
        const withoutSecret = createNodeEnv({ db: customDb, dataDir: TEST_DATA_DIR }).env;
        expect(record(withoutSecret).TURNSTILE_SECRET_KEY).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
        customDb.close();
      }
    });

    it("guest login over HTTP: 201 with the Turnstile test secret, 503 without secret", async () => {
      const realFetch = globalThis.fetch;
      const siteverify = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://challenges.cloudflare.com/")) {
          const body = init?.body as FormData;
          // Behaviour of the official always-passes test secret, as documented by Cloudflare.
          const ok = body.get("secret") === "1x0000000000000000000000000000000AA";
          return new Response(JSON.stringify({ success: ok }), {
            headers: { "content-type": "application/json" }
          });
        }
        return realFetch(input, init);
      });
      const guest = async (name: string, env: Record<string, string>) => {
        clearRateLimitMemory();
        const instance = await startNodeServer({
          env,
          onWarning: () => {},
          port: 0,
          dataDir: join(TEST_DATA_DIR, `srv-guest-${name}`),
          staticDir: join(TEST_DATA_DIR, "no-static")
        });
        try {
          const res = await realFetch(`http://localhost:${instance.port}/api/v1/auth/guest`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://localhost:8787" },
            body: JSON.stringify({ turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" })
          });
          return { status: res.status, body: (await res.json()) as { code?: string } };
        } finally {
          await instance.close();
        }
      };
      try {
        const withSecret = await guest("with", {
          ...SECRETS,
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
        });
        expect(withSecret.status).toBe(201);
        const without = await guest("without", { ...SECRETS });
        expect(without).toEqual({
          status: 503,
          body: expect.objectContaining({ code: "TURNSTILE_NOT_CONFIGURED" })
        });
      } finally {
        siteverify.mockRestore();
      }
    }, 20000);
  });
});
