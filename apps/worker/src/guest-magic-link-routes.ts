import { createProblemDetails } from "@notebook-lm/shared";
import { type Context, Hono } from "hono";
import type { CoreRepository } from "./core-repository.js";
import { seedDemoNotebooks } from "./demo-seeder.js";
import type { MailAdapter } from "./mail-adapter.js";
import { resolveClientIp } from "./rate-limiter.js";
import {
  type SessionManager,
  buildSessionCookie,
  generateSessionToken,
  sha256Hex
} from "./session.js";
import { requireTurnstile } from "./turnstile.js";

export const GUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

export const DEMO_WORKSPACE_ID = "ws_demo_relationflow";
export const DEMO_WORKSPACE_NAME = "RelationFlow & KI im Mittelstand";

export interface GuestAndMagicLinkRoutesOptions {
  repo: CoreRepository;
  sessionManager: SessionManager;
  mailAdapter: MailAdapter;
  /**
   * Turnstile secret (TURNSTILE_SECRET_KEY). Without it, guest login and magic-link
   * requests are rejected with 503 (fail-closed). There is no fallback to a test key.
   */
  turnstileSecretKey?: string | undefined;
  appBaseUrl: string;
  isProduction?: boolean;
  customFetch?: typeof fetch;
}

function generateSecureSuffix(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 5);
}

export function createGuestAndMagicLinkRoutes(
  opts: GuestAndMagicLinkRoutesOptions
): Hono<{ Bindings: Env }> {
  const router = new Hono<{ Bindings: Env }>();

  /** Fail-closed bot check (503 without secret, 403 without or with a rejected token). */
  const checkTurnstile = (c: Context, token: unknown): Promise<Response | null> =>
    requireTurnstile(c, token, {
      secretKey: opts.turnstileSecretKey,
      customFetch: opts.customFetch
    });

  // Helper to ensure demo workspace exists
  const ensureDemoWorkspace = async (now: number): Promise<void> => {
    const existing = await opts.repo.db.queryOne<{ id: string }>(
      "SELECT id FROM workspaces WHERE id = ?",
      [DEMO_WORKSPACE_ID]
    );
    if (!existing) {
      const demoSystemUserId = "usr_system_demo";
      await opts.repo.createUser({
        id: demoSystemUserId,
        email: "system-demo@relationnotes.local",
        display_name: "RelationNotes Demo System",
        locale: "de",
        is_guest: 0,
        created_at: now,
        expires_at: null,
        deleted_at: null
      });
      await opts.repo.createWorkspace({
        id: DEMO_WORKSPACE_ID,
        name: DEMO_WORKSPACE_NAME,
        owner_id: demoSystemUserId,
        created_at: now
      });
    }
  };

  // 1. 1-Click Guest Login Endpoint (Turnstile Protected)
  router.post("/guest", async (c) => {
    let body: { turnstileToken?: string; locale?: string };
    try {
      body = (await c.req.json()) as { turnstileToken?: string; locale?: string };
    } catch {
      body = {};
    }

    const botCheck = await checkTurnstile(c, body.turnstileToken);
    if (botCheck) {
      return botCheck;
    }
    const ip = resolveClientIp(c) ?? null;

    const now = Date.now();
    const guestId = `usr_guest_${now.toString(36)}_${generateSecureSuffix()}`;
    const guestExpiresAt = now + GUEST_TTL_MS;

    // Create guest user in D1
    await opts.repo.createUser({
      id: guestId,
      email: null,
      display_name: "Gast-Nutzer",
      locale: body.locale ?? "de",
      is_guest: 1,
      created_at: now,
      expires_at: guestExpiresAt,
      deleted_at: null
    });

    // Create default workspace for guest: "Mein Gast-Arbeitsbereich"
    const defaultWorkspaceId = `ws_guest_${guestId}`;
    await opts.repo.createWorkspace({
      id: defaultWorkspaceId,
      name: "Mein Gast-Arbeitsbereich",
      owner_id: guestId,
      created_at: now
    });

    // Ensure demo workspace exists and grant guest viewer access
    await ensureDemoWorkspace(now);
    await seedDemoNotebooks(opts.repo.db, {
      targetUserId: guestId,
      grantAccessRole: "viewer",
      now
    });
    await opts.repo.db.run(
      "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'viewer', ?)",
      [DEMO_WORKSPACE_ID, guestId, now]
    );

    // Seed demo notebook with read/write access for guest in their workspace
    const demoNotebookId = `nb_demo_${guestId}`;
    await opts.repo.createNotebook({
      id: demoNotebookId,
      workspace_id: defaultWorkspaceId,
      title: "Willkommen zu RelationNotes",
      emoji: "open_book",
      created_by: guestId,
      created_at: now,
      updated_at: now,
      expires_at: guestExpiresAt
    });

    // Create active session
    const ua = c.req.header("user-agent") || null;
    const session = await opts.sessionManager.createSession(guestId, ip, ua);

    const cookieHeader = buildSessionCookie(
      session.rawToken,
      opts.isProduction === true,
      Math.floor(GUEST_TTL_MS / 1000)
    );

    return c.json(
      {
        user: {
          id: guestId,
          email: null,
          displayName: "Gast-Nutzer",
          locale: body.locale ?? "de",
          isGuest: true,
          expiresAt: guestExpiresAt
        },
        defaultWorkspaceId,
        demoWorkspaceId: DEMO_WORKSPACE_ID,
        demoNotebookId
      },
      201,
      {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": cookieHeader
      }
    );
  });

  // 2. Request Magic-Link (POST /api/v1/auth/magic-link)
  router.post("/magic-link", async (c) => {
    let body: { email?: string; turnstileToken?: string; locale?: string };
    try {
      body = (await c.req.json()) as { email?: string; turnstileToken?: string; locale?: string };
    } catch {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiges JSON im Request-Body.",
          instance: c.req.path,
          code: "INVALID_JSON"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const email = body.email?.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Gültige E-Mail-Adresse erforderlich.",
          instance: c.req.path,
          code: "INVALID_EMAIL"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const botCheck = await checkTurnstile(c, body.turnstileToken);
    if (botCheck) {
      return botCheck;
    }

    const rawToken = generateSessionToken();
    const tokenHash = await sha256Hex(rawToken);
    const now = Date.now();
    const expiresAt = now + MAGIC_LINK_TTL_MS;

    // Save token hash to D1 magic_links table
    await opts.repo.db.run(
      "INSERT INTO magic_links (token_hash, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
      [tokenHash, email, now, expiresAt]
    );

    let baseUrl = opts.appBaseUrl;
    while (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    const callbackUrl = `${baseUrl}/api/v1/auth/magic-link/callback?token=${rawToken}`;

    const sendRes = await opts.mailAdapter.send({
      to: email,
      subject: "Ihr Anmeldelink für RelationNotes",
      html: `<p>Klicken Sie auf den folgenden Link, um sich bei RelationNotes anzumelden: <a href="${callbackUrl}">${callbackUrl}</a>. Der Link ist 15 Minuten gültig.</p>`,
      text: `Ihr Anmeldelink für RelationNotes: ${callbackUrl} (15 Minuten gültig).`
    });

    if (!sendRes.success) {
      return c.json(
        createProblemDetails({
          status: 500,
          title: "Internal Server Error",
          detail: `E-Mail-Zustellung fehlgeschlagen: ${sendRes.error}`,
          instance: c.req.path,
          code: "EMAIL_DELIVERY_FAILED"
        }),
        500,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    return c.json(
      {
        message: "Anmeldelink wurde an Ihre E-Mail-Adresse versendet.",
        expiresInSeconds: Math.floor(MAGIC_LINK_TTL_MS / 1000)
      },
      200,
      { "content-type": "application/json; charset=utf-8" }
    );
  });

  // 3. Magic-Link Callback (GET /api/v1/auth/magic-link/callback?token=...)
  router.get("/magic-link/callback", async (c) => {
    const rawToken = c.req.query("token");
    if (!rawToken) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Parameter 'token' fehlt.",
          instance: c.req.path,
          code: "MISSING_TOKEN"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const tokenHash = await sha256Hex(rawToken);
    const now = Date.now();

    const magicRow = await opts.repo.db.queryOne<{
      token_hash: string;
      email: string;
      created_at: number;
      expires_at: number;
      used_at: number | null;
    }>("SELECT * FROM magic_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", [
      tokenHash,
      now
    ]);

    if (!magicRow) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Der Anmeldelink ist ungültig, abgelaufen oder wurde bereits verwendet.",
          instance: c.req.path,
          code: "MAGIC_LINK_EXPIRED_OR_USED"
        }),
        401,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    // Mark as used immediately (single-use guarantee)
    await opts.repo.db.run("UPDATE magic_links SET used_at = ? WHERE token_hash = ?", [
      now,
      tokenHash
    ]);

    // Lookup or create permanent user for email
    let user = await opts.repo.getUserByEmail(magicRow.email);
    if (!user) {
      const newUserId = `usr_${now.toString(36)}_${generateSecureSuffix()}`;
      const displayName = magicRow.email.slice(0, magicRow.email.indexOf("@"));
      await opts.repo.createUser({
        id: newUserId,
        email: magicRow.email,
        display_name: displayName,
        locale: "de",
        is_guest: 0,
        created_at: now,
        expires_at: null,
        deleted_at: null
      });

      // Default workspace
      await opts.repo.createWorkspace({
        id: `ws_${newUserId}`,
        name: "Mein Arbeitsbereich",
        owner_id: newUserId,
        created_at: now
      });

      // Seed and grant access to demo workspace
      await ensureDemoWorkspace(now);
      await seedDemoNotebooks(opts.repo.db, {
        targetUserId: newUserId,
        grantAccessRole: "viewer",
        now
      });
      await opts.repo.db.run(
        "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'viewer', ?)",
        [DEMO_WORKSPACE_ID, newUserId, now]
      );

      user = await opts.repo.getUserById(newUserId);
    }

    /* v8 ignore next 3 */
    if (!user) {
      throw new Error("Fehler beim Erstellen des Nutzers.");
    }

    const ip = resolveClientIp(c) ?? null;
    const ua = c.req.header("user-agent") || null;
    const session = await opts.sessionManager.createSession(user.id, ip, ua);

    const cookieHeader = buildSessionCookie(
      session.rawToken,
      opts.isProduction === true,
      7 * 24 * 60 * 60
    );

    return c.json(
      {
        verified: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          locale: user.locale,
          isGuest: Boolean(user.is_guest)
        }
      },
      200,
      {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": cookieHeader
      }
    );
  });

  return router;
}
