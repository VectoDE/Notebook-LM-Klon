import type { CoreRepository } from "./core-repository.js";

export const SESSION_COOKIE_NAME = "__Host-sid";
export const DEV_SESSION_COOKIE_NAME = "sid";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days sliding

export interface SessionContextUser {
  id: string;
  email: string | null;
  displayName: string;
  locale: string;
  isGuest: boolean;
}

export interface SessionContextData {
  sessionIdHash: string;
  user: SessionContextUser;
}

declare module "hono" {
  interface ContextVariableMap {
    sessionUser?: SessionContextUser;
    sessionIdHash?: string;
  }
}

/**
 * Computes standard SHA-256 hex string using Web Crypto API.
 */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Computes privacy-preserving daily salted hash for IP or User-Agent.
 */
export async function computeDailySaltedHash(
  value: string | null | undefined,
  saltSecret: string,
  dateStr?: string
): Promise<string | null> {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const day = dateStr ?? new Date().toISOString().slice(0, 10);
  return sha256Hex(`${day}:${saltSecret}:${value}`);
}

/**
 * Generates high-entropy 32-byte opaque session token (base64url).
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Generates secure CSPRNG random hex string of given byte length.
 */
export function generateSecureRandomId(byteLength = 8): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Formats Set-Cookie header for session.
 */
export function buildSessionCookie(
  token: string,
  isSecure: boolean,
  maxAgeSeconds: number
): string {
  const cookieName = isSecure ? SESSION_COOKIE_NAME : DEV_SESSION_COOKIE_NAME;
  const secureFlag = isSecure ? "; Secure" : "";
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/${secureFlag}; Max-Age=${maxAgeSeconds}`;
}

/**
 * Formats Set-Cookie header to clear the session cookie.
 */
export function buildClearSessionCookie(isSecure: boolean): string {
  const cookieName = isSecure ? SESSION_COOKIE_NAME : DEV_SESSION_COOKIE_NAME;
  const secureFlag = isSecure ? "; Secure" : "";
  return `${cookieName}=; HttpOnly; SameSite=Lax; Path=/${secureFlag}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Extracts session token from Cookie header.
 */
export function extractSessionToken(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return cookie.substring(SESSION_COOKIE_NAME.length + 1);
    }
    if (cookie.startsWith(`${DEV_SESSION_COOKIE_NAME}=`)) {
      return cookie.substring(DEV_SESSION_COOKIE_NAME.length + 1);
    }
  }
  return null;
}

export interface SessionManagerOptions {
  repo: CoreRepository;
  saltSecret: string;
}

export class SessionManager {
  constructor(private readonly opts: SessionManagerOptions) {}

  async createSession(
    userId: string,
    ip: string | null,
    userAgent: string | null
  ): Promise<{ rawToken: string; expiresAt: number; idHash: string }> {
    const rawToken = generateSessionToken();
    const idHash = await sha256Hex(rawToken);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    const [ipHash, uaHash] = await Promise.all([
      computeDailySaltedHash(ip, this.opts.saltSecret),
      computeDailySaltedHash(userAgent, this.opts.saltSecret)
    ]);

    await this.opts.repo.createSession({
      id_hash: idHash,
      user_id: userId,
      created_at: now,
      expires_at: expiresAt,
      ip_hash: ipHash,
      ua_hash: uaHash
    });

    return { rawToken, expiresAt, idHash };
  }

  async validateAndSlideSession(rawToken: string): Promise<SessionContextData | null> {
    const idHash = await sha256Hex(rawToken);
    const session = await this.opts.repo.getSession(idHash);
    if (!session) {
      return null;
    }

    const user = await this.opts.repo.getUserById(session.user_id);
    if (!user || user.deleted_at !== null) {
      await this.opts.repo.deleteSession(idHash);
      return null;
    }

    // Slide expiration if half of TTL has passed
    const now = Date.now();
    if (session.expires_at - now < SESSION_TTL_MS / 2) {
      const newExpiresAt = now + SESSION_TTL_MS;
      await this.opts.repo.db.run("UPDATE sessions SET expires_at = ? WHERE id_hash = ?", [
        newExpiresAt,
        idHash
      ]);
    }

    return {
      sessionIdHash: idHash,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        locale: user.locale,
        isGuest: Boolean(user.is_guest)
      }
    };
  }

  async rotateSession(
    oldToken: string,
    ip: string | null,
    userAgent: string | null
  ): Promise<{ rawToken: string; expiresAt: number; idHash: string } | null> {
    const validated = await this.validateAndSlideSession(oldToken);
    if (!validated) {
      return null;
    }
    await this.opts.repo.deleteSession(validated.sessionIdHash);
    return this.createSession(validated.user.id, ip, userAgent);
  }

  async revokeSession(rawToken: string): Promise<void> {
    const idHash = await sha256Hex(rawToken);
    await this.opts.repo.deleteSession(idHash);
  }
}
