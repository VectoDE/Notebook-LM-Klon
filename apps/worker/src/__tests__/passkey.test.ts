import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { sessionMiddleware } from "../auth-middleware.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { createPasskeyRoutes } from "../passkey-routes.js";
import { PasskeyService, type WebAuthnEngine } from "../passkey-service.js";
import { DEV_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, SessionManager } from "../session.js";

function createSqliteAdapter(): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  const migrationPath = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  db.exec(sql);

  const adapter: DatabaseAdapter = {
    async exec(sqlStr: string): Promise<void> {
      db.exec(sqlStr);
    },
    async query<T>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(sqlStr);
      return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
    },
    async queryOne<T>(sqlStr: string, params: unknown[] = []): Promise<T | null> {
      const stmt = db.prepare(sqlStr);
      const row = stmt.get(...(params as (string | number | bigint | null)[]));
      return (row as T) ?? null;
    },
    async run(sqlStr: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = db.prepare(sqlStr);
      const info = stmt.run(...(params as (string | number | bigint | null)[]));
      return { changes: Number(info.changes) };
    }
  };

  return { adapter, close: () => db.close() };
}

describe("PasskeyService & Passkey Routes (Issue #8: Sub-Issues #68, #69, #70)", () => {
  it("handles challenge lifecycle, single-use consumption and expiration", () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const service = new PasskeyService({
      repo,
      rpName: "RelationNotes",
      rpID: "localhost",
      expectedOrigin: "http://localhost:5173"
    });

    service.storeChallenge("c1", "challenge_value_1", "usr_1");
    // Single use
    const c1 = service.consumeChallenge("c1");
    expect(c1?.challenge).toBe("challenge_value_1");
    expect(service.consumeChallenge("c1")).toBeNull();

    // Expired challenge
    service.storeChallenge("c2", "challenge_value_2", "usr_2");
    // Artificially age the challenge
    // @ts-expect-error accessing private for unit testing expiration branch
    const c2Entry = service.challenges.get("c2");
    if (c2Entry) {
      c2Entry.createdAt = Date.now() - 6 * 60 * 1000;
    }
    expect(service.consumeChallenge("c2")).toBeNull();

    // Challenge cleanup trigger
    service.storeChallenge("c3", "challenge_value_3");
    // @ts-expect-error accessing private
    const c3Entry = service.challenges.get("c3");
    if (c3Entry) {
      c3Entry.createdAt = Date.now() - 6 * 60 * 1000;
    }
    service.storeChallenge("c4", "challenge_value_4");
    // @ts-expect-error accessing private
    expect(service.challenges.has("c3")).toBe(false);

    close();
  });

  it("generates registration options with excluded existing credentials", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const service = new PasskeyService({
      repo,
      rpName: "RelationNotes",
      rpID: "localhost",
      expectedOrigin: "http://localhost:5173"
    });

    const now = Date.now();
    await repo.createUser({
      id: "usr_reg",
      email: "reg@example.com",
      display_name: "Reg User",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    // Create existing passkey with transports
    await repo.createPasskey({
      id: "cred_existing_1",
      user_id: "usr_reg",
      public_key: new Uint8Array([1, 2, 3]),
      sign_count: 5,
      transports: "internal,hybrid",
      aaguid: null,
      created_at: now,
      last_used_at: null
    });

    // Create existing passkey without transports
    await repo.createPasskey({
      id: "cred_existing_2",
      user_id: "usr_reg",
      public_key: new Uint8Array([4, 5, 6]),
      sign_count: 10,
      transports: null,
      aaguid: null,
      created_at: now,
      last_used_at: null
    });

    const user = await repo.getUserById("usr_reg");
    expect(user).not.toBeNull();
    if (!user) throw new Error("user not found");
    const options = await service.generateRegistrationOptions(user);
    expect(options.challenge).toBeDefined();
    expect(options.excludeCredentials?.length).toBe(2);

    close();
  });

  it("performs full HTTP passkey endpoints integration flow with upgrade from guest to permanent", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const sessionManager = new SessionManager({ repo, saltSecret: "passkey-salt" });
    const passkeyService = new PasskeyService({
      repo,
      rpName: "RelationNotes",
      rpID: "localhost",
      expectedOrigin: "http://localhost:5173"
    });

    const app = new Hono<{ Bindings: Env }>();
    app.use("*", sessionMiddleware(sessionManager));
    app.route(
      "/api/v1/auth/passkey",
      createPasskeyRoutes({
        repo,
        passkeyService,
        sessionManager,
        isProduction: false
      })
    );

    const now = Date.now();
    // 1. Create a guest user
    await repo.createUser({
      id: "usr_guest_01",
      email: null,
      display_name: "Gast-Nutzer",
      locale: "de",
      is_guest: 1,
      created_at: now,
      expires_at: now + 86400_000,
      deleted_at: null
    });

    const { rawToken: guestToken } = await sessionManager.createSession(
      "usr_guest_01",
      "127.0.0.1",
      "TestAgent"
    );

    // 2. Request registration options as guest -> 200
    const regOptionsRes = await app.request(
      "https://api.example.com/api/v1/auth/passkey/register/options",
      {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${guestToken}` }
      }
    );
    expect(regOptionsRes.status).toBe(200);
    const regOptions = (await regOptionsRes.json()) as { challenge: string };
    expect(regOptions.challenge).toBeDefined();

    // Test invalid json in verify
    const badJsonRes = await app.request(
      "https://api.example.com/api/v1/auth/passkey/register/verify",
      {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${guestToken}`,
          "content-type": "application/json"
        },
        body: "not-json"
      }
    );
    expect(badJsonRes.status).toBe(400);

    // Mock verifyRegistration on service to test HTTP route and upgrade
    const originalVerifyReg = passkeyService.verifyRegistration.bind(passkeyService);
    passkeyService.verifyRegistration = async (user, _response) => {
      // Simulate successful passkey creation and guest upgrade
      await repo.createPasskey({
        id: "cred_mock_passkey_01",
        user_id: user.id,
        public_key: new Uint8Array([1, 2, 3]),
        sign_count: 0,
        transports: "internal",
        aaguid: null,
        created_at: Date.now(),
        last_used_at: null
      });
      await repo.db.run("UPDATE users SET is_guest = 0, expires_at = NULL WHERE id = ?", [user.id]);
      return { verified: true, upgradedToPermanent: true };
    };

    const verifyRegRes = await app.request(
      "https://api.example.com/api/v1/auth/passkey/register/verify",
      {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${guestToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ id: "cred_mock_passkey_01", response: {} })
      }
    );
    expect(verifyRegRes.status).toBe(200);
    const verifyRegJson = (await verifyRegRes.json()) as {
      verified: boolean;
      upgradedToPermanent: boolean;
    };
    expect(verifyRegJson.verified).toBe(true);
    expect(verifyRegJson.upgradedToPermanent).toBe(true);

    // Verify user in DB is now permanent (is_guest = 0, expires_at = null)
    const upgradedUser = await repo.getUserById("usr_guest_01");
    expect(upgradedUser?.is_guest).toBe(0);
    expect(upgradedUser?.expires_at).toBeNull();

    // 3. Login options (public) -> 200
    const loginOptionsRes = await app.request(
      "https://api.example.com/api/v1/auth/passkey/login/options",
      {
        method: "POST"
      }
    );
    expect(loginOptionsRes.status).toBe(200);
    const loginOptions = (await loginOptionsRes.json()) as { challenge: string };
    expect(loginOptions.challenge).toBeDefined();

    // Test invalid json in login verify
    const badLoginJson = await app.request(
      "https://api.example.com/api/v1/auth/passkey/login/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json"
      }
    );
    expect(badLoginJson.status).toBe(400);

    // Mock verifyLogin for HTTP route test
    passkeyService.verifyLogin = async (_body) => {
      if (!upgradedUser) throw new Error("user not found");
      return { verified: true, user: upgradedUser, signCountUpdated: true };
    };

    const loginVerifyRes = await app.request(
      "https://api.example.com/api/v1/auth/passkey/login/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "VitestBrowser",
          "cf-connecting-ip": "1.2.3.4"
        },
        body: JSON.stringify({ id: "cred_mock_passkey_01", response: {} })
      }
    );
    expect(loginVerifyRes.status).toBe(200);
    expect(loginVerifyRes.headers.get("set-cookie")).toContain(DEV_SESSION_COOKIE_NAME);

    // Error branch tests in passkey-routes
    passkeyService.verifyRegistration = async () => ({
      verified: false,
      upgradedToPermanent: false
    });
    const failedRegVerify = await app.request(
      "https://api.example.com/api/v1/auth/passkey/register/verify",
      {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${guestToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ id: "cred_fail", response: {} })
      }
    );
    expect(failedRegVerify.status).toBe(400);

    passkeyService.verifyRegistration = async () => {
      throw new Error("Simulated registration error");
    };
    const errRegVerify = await app.request(
      "https://api.example.com/api/v1/auth/passkey/register/verify",
      {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${guestToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ id: "cred_err", response: {} })
      }
    );
    expect(errRegVerify.status).toBe(400);

    passkeyService.verifyLogin = async () => {
      if (!upgradedUser) throw new Error("user not found");
      return {
        verified: false,
        user: upgradedUser,
        signCountUpdated: false
      };
    };
    const failedLoginVerify = await app.request(
      "https://api.example.com/api/v1/auth/passkey/login/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cred_fail", response: {} })
      }
    );
    expect(failedLoginVerify.status).toBe(400);

    passkeyService.verifyLogin = async () => {
      throw new Error("Simulated clone detection");
    };
    const cloneLoginVerify = await app.request(
      "https://api.example.com/api/v1/auth/passkey/login/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cred_clone", response: {} })
      }
    );
    expect(cloneLoginVerify.status).toBe(400);

    // Unauthenticated access to register options & verify -> 401
    const unauthOptions = await app.request(
      "https://api.example.com/api/v1/auth/passkey/register/options",
      {
        method: "POST"
      }
    );
    expect(unauthOptions.status).toBe(401);

    const unauthVerify = await app.request(
      "https://api.example.com/api/v1/auth/passkey/register/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }
    );
    expect(unauthVerify.status).toBe(401);

    // Call login verify with missing cf-connecting-ip and user-agent
    passkeyService.verifyLogin = async () => {
      if (!upgradedUser) throw new Error("user not found");
      return {
        verified: true,
        user: upgradedUser,
        signCountUpdated: true
      };
    };
    const noHeadersLoginRes = await app.request(
      "https://api.example.com/api/v1/auth/passkey/login/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cred_mock_passkey_01", response: {} })
      }
    );
    expect(noHeadersLoginRes.status).toBe(200);

    // Restore original verifyReg
    passkeyService.verifyRegistration = originalVerifyReg;

    close();
  });

  it("handles verifyRegistration and verifyLogin edge cases, error conditions and clone detection in PasskeyService", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const service = new PasskeyService({
      repo,
      rpName: "RelationNotes",
      rpID: "localhost",
      expectedOrigin: "http://localhost:5173"
    });

    const now = Date.now();
    await repo.createUser({
      id: "usr_edge",
      email: "edge@example.com",
      display_name: "Edge",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    const user = await repo.getUserById("usr_edge");
    expect(user).not.toBeNull();
    if (!user) throw new Error("user not found");

    // 1. Missing / expired challenge in verifyRegistration throws Error
    await expect(
      service.verifyRegistration(user, {
        id: "c",
        rawId: "c",
        type: "public-key",
        response: {}
      } as unknown as RegistrationResponseJSON)
    ).rejects.toThrow("Challenge expired or invalid.");

    // 2. Missing challenge in verifyLogin throws Error
    await expect(
      service.verifyLogin({
        id: "c",
        rawId: "c",
        type: "public-key",
        response: {}
      } as unknown as AuthenticationResponseJSON)
    ).rejects.toThrow("Challenge expired or invalid.");

    // 3. Storing challenge for login and testing passkey not found
    const clientDataJSON = btoa(JSON.stringify({ challenge: "valid_login_challenge" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    service.storeChallenge("login:valid_login_challenge", "valid_login_challenge");

    await expect(
      service.verifyLogin({
        id: "non_existent_passkey",
        rawId: "c",
        type: "public-key",
        response: { clientDataJSON }
      } as unknown as AuthenticationResponseJSON)
    ).rejects.toThrow("Passkey not found.");

    // 4. Passkey exists but user is deleted
    await repo.createUser({
      id: "usr_orphan",
      email: "orphan@example.com",
      display_name: "Orphan",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: now
    });
    await repo.createPasskey({
      id: "pk_orphan",
      user_id: "usr_orphan",
      public_key: new Uint8Array([1, 2, 3]),
      sign_count: 5,
      transports: null,
      aaguid: null,
      created_at: now,
      last_used_at: null
    });
    service.storeChallenge("login:orphan_challenge", "orphan_challenge");

    // 5. Direct verification tests with mocked webauthn engine to achieve 100% coverage
    const mockWebAuthnSuccess = {
      generateRegistrationOptions: async () => ({ challenge: "mock_reg_c" }),
      verifyRegistrationResponse: async () => ({
        verified: true,
        registrationInfo: {
          credential: {
            id: "pk_direct_01",
            publicKey: new Uint8Array([7, 8, 9]),
            counter: 1
          },
          credentialDeviceType: "singleDevice"
        }
      }),
      generateAuthenticationOptions: async () => ({ challenge: "mock_auth_c" }),
      verifyAuthenticationResponse: async () => ({
        verified: true,
        authenticationInfo: {
          newCounter: 2
        }
      })
    };

    const directService = new PasskeyService(
      { repo, rpName: "Test", rpID: "localhost", expectedOrigin: "http://localhost:5173" },
      mockWebAuthnSuccess as unknown as WebAuthnEngine
    );

    // Test verifyRegistration with upgraded guest = true
    const guestUser = { ...user, id: "usr_guest_upg", email: "guest_upg@example.com", is_guest: 1 };
    await repo.createUser(guestUser);
    directService.storeChallenge("reg:usr_guest_upg", "c_edge", "usr_guest_upg");
    const regResult = await directService.verifyRegistration(guestUser, {
      id: "pk_direct_01",
      rawId: "pk_direct_01",
      type: "public-key",
      response: { transports: ["internal"] }
    } as unknown as RegistrationResponseJSON);
    expect(regResult.verified).toBe(true);
    expect(regResult.upgradedToPermanent).toBe(true);

    // Test verifyRegistration with permanent user (is_guest = 0, no upgrade needed)
    const permanentUser = {
      ...user,
      id: "usr_perm_reg",
      email: "perm_reg@example.com",
      is_guest: 0
    };
    await repo.createUser(permanentUser);
    directService.storeChallenge("reg:usr_perm_reg", "c_perm", "usr_perm_reg");
    // Mock different credential ID for permanent user to satisfy UNIQUE(id)
    directService.webauthn.verifyRegistrationResponse = (async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: "pk_perm_02",
          publicKey: new Uint8Array([7, 8, 9]),
          counter: 1
        },
        credentialDeviceType: "singleDevice"
      }
    })) as unknown as typeof directService.webauthn.verifyRegistrationResponse;
    const permRegResult = await directService.verifyRegistration(permanentUser, {
      id: "pk_perm_02",
      rawId: "pk_perm_02",
      type: "public-key",
      response: {}
    } as unknown as RegistrationResponseJSON);
    expect(permRegResult.verified).toBe(true);
    expect(permRegResult.upgradedToPermanent).toBe(false);

    // Passkey exists but user is soft deleted with deleted_at !== null
    await repo.createUser({
      id: "usr_soft_del",
      email: "soft@example.com",
      display_name: "Soft",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: now
    });
    await repo.createPasskey({
      id: "pk_soft_deleted",
      user_id: "usr_soft_del",
      public_key: new Uint8Array([1, 2, 3]),
      sign_count: 5,
      transports: null,
      aaguid: null,
      created_at: now,
      last_used_at: null
    });
    directService.storeChallenge("login:soft_c", "soft_c");
    const softClientData = btoa(JSON.stringify({ challenge: "soft_c" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await expect(
      directService.verifyLogin({
        id: "pk_soft_deleted",
        rawId: "pk_soft_deleted",
        type: "public-key",
        response: { clientDataJSON: softClientData }
      } as unknown as AuthenticationResponseJSON)
    ).rejects.toThrow("User associated with passkey not found or deleted.");

    // Test verifyRegistration failure
    const mockWebAuthnFail = {
      ...mockWebAuthnSuccess,
      verifyRegistrationResponse: async () => ({ verified: false }),
      verifyAuthenticationResponse: async () => ({ verified: false })
    };
    const failService = new PasskeyService(
      { repo, rpName: "Test", rpID: "localhost", expectedOrigin: "http://localhost:5173" },
      mockWebAuthnFail as unknown as WebAuthnEngine
    );
    failService.storeChallenge("reg:usr_edge", "c_edge_fail", "usr_edge");
    const failReg = await failService.verifyRegistration(user, {
      id: "pk_fail",
      rawId: "pk_fail",
      type: "public-key",
      response: {}
    } as unknown as RegistrationResponseJSON);
    expect(failReg.verified).toBe(false);

    // Test verifyLogin success
    directService.storeChallenge("login:valid_login_c", "valid_login_c");
    const directLoginClientData = btoa(JSON.stringify({ challenge: "valid_login_c" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const directLoginResult = await directService.verifyLogin({
      id: "pk_direct_01",
      rawId: "pk_direct_01",
      type: "public-key",
      response: { clientDataJSON: directLoginClientData }
    } as unknown as AuthenticationResponseJSON);
    expect(directLoginResult.verified).toBe(true);
    expect(directLoginResult.signCountUpdated).toBe(true);

    // Test verifyLogin failure
    failService.storeChallenge("login:fail_login_c", "fail_login_c");
    const failLoginClientData = btoa(JSON.stringify({ challenge: "fail_login_c" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const failLoginResult = await failService.verifyLogin({
      id: "pk_direct_01",
      rawId: "pk_direct_01",
      type: "public-key",
      response: { clientDataJSON: failLoginClientData }
    } as unknown as AuthenticationResponseJSON);
    expect(failLoginResult.verified).toBe(false);

    // Test clone detection (counter <= existing sign_count)
    const mockWebAuthnClone = {
      ...mockWebAuthnSuccess,
      verifyAuthenticationResponse: async () => ({
        verified: true,
        authenticationInfo: {
          newCounter: 1 // Existing is 2!
        }
      })
    };
    const cloneService = new PasskeyService(
      { repo, rpName: "Test", rpID: "localhost", expectedOrigin: "http://localhost:5173" },
      mockWebAuthnClone as unknown as WebAuthnEngine
    );
    cloneService.storeChallenge("login:clone_c", "clone_c");
    const cloneClientData = btoa(JSON.stringify({ challenge: "clone_c" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await expect(
      cloneService.verifyLogin({
        id: "pk_direct_01",
        rawId: "pk_direct_01",
        type: "public-key",
        response: { clientDataJSON: cloneClientData }
      } as unknown as AuthenticationResponseJSON)
    ).rejects.toThrow("Potential authenticator cloning detected");

    // Test invalid clientDataJSON fallback in extractChallengeFromClientData
    await expect(
      directService.verifyLogin({
        id: "pk_direct_01",
        rawId: "pk_direct_01",
        type: "public-key",
        response: { clientDataJSON: "invalid!!!base64" }
      } as unknown as AuthenticationResponseJSON)
    ).rejects.toThrow("Challenge expired or invalid.");

    close();
  });
});
