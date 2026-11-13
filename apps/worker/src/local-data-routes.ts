import { createProblemDetails } from "@notebook-lm/shared";
import type { Hono } from "hono";
import { requireAuth } from "./auth-middleware.js";
import { type SessionManager, buildClearSessionCookie, extractSessionToken } from "./session.js";

/**
 * Schlüssel für die verschlüsselte lokale Ablage im Browser (Issue #348).
 *
 * Der Browser bekommt je Sitzung 32 Byte Schlüsselmaterial. Der Server speichert davon
 * nichts: Das Material wird bei jedem Abruf per HKDF-SHA-256 aus SESSION_SALT_SECRET
 * und dem Hash der Sitzung abgeleitet. Endet die Sitzung (Abmelden, Ablauf, Rotation),
 * lässt sich dasselbe Material nie wieder abrufen; lokal liegengebliebene Chiffrate
 * sind damit kryptografisch unlesbar (Crypto-Shredding).
 */
export const LOCAL_KEY_VERSION = 1;
export const LOCAL_KEY_BYTES = 32;
const HKDF_SALT = new TextEncoder().encode("relationnotes/local-idb-key/v1");

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache"
} as const;

const PROBLEM_HEADERS = {
  "content-type": "application/problem+json; charset=utf-8",
  ...NO_STORE_HEADERS
} as const;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Leitet das lokale Schlüsselmaterial einer Sitzung ab. Deterministisch für dieselbe
 * Sitzung (der Browser kann nach einem Neuladen weiterlesen), verschieden für jede
 * andere Sitzung und jeden anderen Nutzer (info bindet beides).
 */
export async function deriveLocalKeyMaterial(
  saltSecret: string,
  userId: string,
  sessionIdHash: string
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(saltSecret),
    "HKDF",
    false,
    ["deriveBits"]
  );
  const info = new TextEncoder().encode(JSON.stringify(["local-idb", userId, sessionIdHash]));
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info },
    base,
    LOCAL_KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

export interface LocalDataRoutesOptions {
  sessionManager: SessionManager;
  /** SESSION_SALT_SECRET; ohne ihn antwortet der Schlüsselabruf mit 503. */
  saltSecret: string | undefined;
  isProduction: boolean;
}

/**
 * GET  /api/v1/auth/local-key  Schlüsselmaterial der aktuellen Sitzung (nur angemeldet).
 * POST /api/v1/auth/logout     Sitzung serverseitig löschen und Cookie entwerten.
 */
// biome-ignore lint/suspicious/noExplicitAny: shared with differently typed Hono apps
export function registerLocalDataRoutes(app: Hono<any>, opts: LocalDataRoutesOptions): void {
  app.get("/api/v1/auth/local-key", requireAuth(), async (c) => {
    const user = c.get("sessionUser");
    const sessionIdHash = c.get("sessionIdHash");
    const salt = opts.saltSecret;
    if (!salt || !user || !sessionIdHash) {
      return c.json(
        createProblemDetails({
          status: 503,
          title: "Service Unavailable",
          detail: "Lokale Verschlüsselung ist nicht konfiguriert (SESSION_SALT_SECRET fehlt).",
          instance: c.req.path,
          code: "LOCAL_KEY_UNAVAILABLE"
        }),
        503,
        PROBLEM_HEADERS
      );
    }
    const material = await deriveLocalKeyMaterial(salt, user.id, sessionIdHash);
    const body = { version: LOCAL_KEY_VERSION, keyMaterial: toBase64Url(material) };
    material.fill(0);
    return c.json(body, 200, NO_STORE_HEADERS);
  });

  app.post("/api/v1/auth/logout", async (c) => {
    const token = extractSessionToken(c.req.header("cookie"));
    if (token) await opts.sessionManager.revokeSession(token);
    return c.body(null, 204, {
      ...NO_STORE_HEADERS,
      "set-cookie": buildClearSessionCookie(opts.isProduction)
    });
  });
}
