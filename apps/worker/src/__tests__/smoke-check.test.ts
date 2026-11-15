import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../index.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import { clearRateLimitMemory } from "../rate-limiter.js";
import { formatSmokeReport, normalizeBaseUrl, runSmokeCheck } from "../smoke-check.js";

const BASE = "http://localhost:8787";
const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';

function createLocalFetch(extraEnv: Record<string, string | undefined>) {
  const dataDir = mkdtempSync(join(tmpdir(), "nlk-smoke-"));
  const db = new DatabaseSync(":memory:");
  runSqliteMigrations(db, join(import.meta.dirname, "../../migrations"));
  const handle = createNodeEnv({
    db,
    dataDir,
    appOrigin: BASE,
    sessionSaltSecret: extraEnv.SESSION_SALT_SECRET
  });
  const { env } = handle;
  Object.assign(env, extraEnv);
  const app = createApp();
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (!url.pathname.startsWith("/api/")) {
      // Statische Assets liefert Cloudflare vor dem Worker aus.
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return app.fetch(new Request(input, init), env);
  };
  return {
    fetchFn,
    close: () => {
      handle.close();
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

describe("Smoke-Check nach dem Deploy (#264)", () => {
  afterEach(() => clearRateLimitMemory());

  it("besteht gegen eine vollständig konfigurierte Instanz", async () => {
    const local = createLocalFetch({
      SESSION_SALT_SECRET: "smoke-test-salt-0123456789abcdef0123456789",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
    });
    const result = await runSmokeCheck(`${BASE}/`, local.fetchFn);
    local.close();

    expect(result.steps.map((s) => [s.name, s.ok])).toEqual([
      ["health", true],
      ["web", true],
      ["gastzugang", true],
      ["chat", true]
    ]);
    expect(result.ok).toBe(true);
    expect(formatSmokeReport(result)).toContain("Smoke-Check bestanden.");
  });

  it("schlägt fehl, wenn Turnstile- oder Salt-Secret fehlen (Anmeldung gesperrt)", async () => {
    const local = createLocalFetch({});
    const result = await runSmokeCheck(BASE, local.fetchFn);
    local.close();

    const guest = result.steps.find((s) => s.name === "gastzugang");
    expect(guest?.ok).toBe(false);
    expect(guest?.detail).toContain("Status 503");
    expect(result.ok).toBe(false);
    expect(formatSmokeReport(result)).toContain("FEHL gastzugang");
    expect(formatSmokeReport(result)).toContain("Smoke-Check fehlgeschlagen.");
  });

  it("meldet Netzwerkfehler und Antworten ohne JSON als Fehlschlag", async () => {
    const failing = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };
    const down = await runSmokeCheck(BASE, failing);
    expect(down.ok).toBe(false);
    expect(down.steps.every((s) => s.detail.includes("ECONNREFUSED"))).toBe(true);

    const notJson = async (): Promise<Response> => new Response("kaputt", { status: 502 });
    const broken = await runSmokeCheck(BASE, notJson);
    expect(broken.steps.map((s) => s.ok)).toEqual([false, false, false, false]);
    expect(broken.steps[0]?.detail).toBe("Status 502, status=undefined, version=undefined");
    expect(broken.steps[1]?.detail).toBe("Status 502, content-type=text/plain;charset=UTF-8");

    const empty = async (): Promise<Response> => new Response(null, { status: 500 });
    const noType = await runSmokeCheck(BASE, empty);
    expect(noType.steps[1]?.detail).toBe("Status 500, content-type=");
    expect(noType.steps[3]?.detail).toBe("Status 500, content-type=");
  });

  it("prüft die Basis-URL", () => {
    expect(normalizeBaseUrl(" https://example.workers.dev/ ")).toBe("https://example.workers.dev");
    expect(normalizeBaseUrl("http://localhost:8787/app//")).toBe("http://localhost:8787/app");
    expect(() => normalizeBaseUrl(undefined)).toThrow("Basis-URL fehlt");
    expect(() => normalizeBaseUrl("  ")).toThrow("Basis-URL fehlt");
    expect(() => normalizeBaseUrl("ftp://example.com")).toThrow("Nicht unterstütztes Protokoll");
  });
});
