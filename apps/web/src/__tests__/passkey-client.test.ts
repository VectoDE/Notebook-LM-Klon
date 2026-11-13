import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AttestationCredential,
  type CreationOptionsJSON,
  type PasskeyCredentials,
  base64UrlToBytes,
  bytesToBase64Url,
  registerPasskey,
  toCreationOptions,
  toRegistrationJSON
} from "../passkey-client.js";
import { authErrorKey } from "../turnstile-client.js";

const OPTIONS: CreationOptionsJSON = {
  challenge: "AQID",
  rp: { name: "RelationNotes", id: "localhost" },
  user: { id: "dXNyXzE", name: "anna@example.com", displayName: "Anna" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  timeout: 60000,
  excludeCredentials: [{ id: "BAUG", transports: ["internal"] }, { id: "Bwg" }],
  authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  attestation: "none"
};

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function fakeCredential(withTransports = true): AttestationCredential {
  return {
    id: "cred-1",
    rawId: bytes(1, 2, 3),
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: bytes(4, 5),
      attestationObject: bytes(6),
      ...(withTransports ? { getTransports: () => ["internal"] } : {})
    },
    getClientExtensionResults: () => ({})
  };
}

interface Call {
  readonly url: string;
  readonly body: unknown;
}

function fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    if (!next) throw new Error("no response left");
    return next;
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

function creds(result: Credential | null | Error): PasskeyCredentials {
  return {
    create: async () => {
      if (result instanceof Error) throw result;
      return result;
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("base64url helpers (#343)", () => {
  it("round-trips bytes without padding", () => {
    const encoded = bytesToBase64Url(new Uint8Array([251, 255, 0, 1]));
    expect(encoded).toBe("-_8AAQ");
    expect([...base64UrlToBytes(encoded)]).toEqual([251, 255, 0, 1]);
    expect(bytesToBase64Url(bytes(1, 2, 3))).toBe("AQID");
    expect(bytesToBase64Url(new Uint8Array([9, 1, 2, 3]).subarray(1))).toBe("AQID");
  });
});

describe("toCreationOptions (#343)", () => {
  it("decodes challenge, user id and excluded credentials", () => {
    const options = toCreationOptions(OPTIONS);
    expect([...(options.challenge as Uint8Array)]).toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(options.user.id as Uint8Array)).toBe("usr_1");
    expect(options.excludeCredentials).toHaveLength(2);
    expect(options.excludeCredentials?.[0]?.transports).toEqual(["internal"]);
    expect(options.excludeCredentials?.[1]).not.toHaveProperty("transports");
    expect(options.timeout).toBe(60000);
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection?.residentKey).toBe("preferred");
  });

  it("leaves optional fields out when the server omits them", () => {
    const options = toCreationOptions({
      challenge: "AQID",
      rp: { name: "RelationNotes" },
      user: OPTIONS.user,
      pubKeyCredParams: OPTIONS.pubKeyCredParams
    });
    expect(options.excludeCredentials).toEqual([]);
    expect(options).not.toHaveProperty("timeout");
    expect(options).not.toHaveProperty("attestation");
    expect(options).not.toHaveProperty("authenticatorSelection");
  });
});

describe("toRegistrationJSON (#343)", () => {
  it("encodes the attestation for the worker", () => {
    expect(toRegistrationJSON(fakeCredential())).toEqual({
      id: "cred-1",
      rawId: "AQID",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: { clientDataJSON: "BAU", attestationObject: "Bg", transports: ["internal"] }
    });
  });

  it("copes with browsers without getTransports or attachment", () => {
    const credential = { ...fakeCredential(false), authenticatorAttachment: null };
    const result = toRegistrationJSON(credential);
    expect(result.authenticatorAttachment).toBeUndefined();
    expect((result.response as { transports: string[] }).transports).toEqual([]);
  });
});

describe("registerPasskey (#343)", () => {
  const supported = () => vi.stubGlobal("PublicKeyCredential", class {});

  it("reports missing browser support without calling the server", async () => {
    const { fetch, calls } = fakeFetch([]);
    expect(await registerPasskey(fetch, creds(null), "tok")).toEqual({
      ok: false,
      code: "PASSKEY_NOT_SUPPORTED"
    });
    supported();
    expect(await registerPasskey(fetch, undefined, "tok")).toEqual({
      ok: false,
      code: "PASSKEY_NOT_SUPPORTED"
    });
    expect(calls).toHaveLength(0);
  });

  it("sends the Turnstile token with the options request and verifies the credential", async () => {
    supported();
    const { fetch, calls } = fakeFetch([json(OPTIONS), json({ verified: true })]);
    const result = await registerPasskey(
      fetch,
      creds(fakeCredential() as unknown as Credential),
      "tok-1"
    );
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toEqual({
      url: "/api/v1/auth/passkey/register/options",
      body: { turnstileToken: "tok-1" }
    });
    expect(calls[1]?.url).toBe("/api/v1/auth/passkey/register/verify");
    expect((calls[1]?.body as { id: string }).id).toBe("cred-1");
  });

  it.each([
    [json({ code: "BOT_VERIFICATION_REQUIRED" }, 403), "BOT_VERIFICATION_REQUIRED"],
    [json({ code: "TURNSTILE_NOT_CONFIGURED" }, 503), "TURNSTILE_NOT_CONFIGURED"],
    [json({ detail: "no code" }, 401), "HTTP_401"],
    [new Response("not json", { status: 500 }), "HTTP_500"],
    [new Response("not json", { status: 200 }), "HTTP_200"]
  ])("stops at the options request on %#", async (response, code) => {
    supported();
    const create = vi.fn();
    const { fetch, calls } = fakeFetch([response]);
    expect(await registerPasskey(fetch, { create }, "tok")).toEqual({ ok: false, code });
    expect(create).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it("reports a network error", async () => {
    supported();
    const failing = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await registerPasskey(failing, creds(null), "tok")).toEqual({
      ok: false,
      code: "NETWORK_ERROR"
    });
  });

  it.each([
    [Object.assign(new Error("x"), { name: "NotAllowedError" }), "PASSKEY_CANCELLED"],
    [Object.assign(new Error("x"), { name: "AbortError" }), "PASSKEY_CANCELLED"],
    [new Error("boom"), "PASSKEY_FAILED"],
    [null, "PASSKEY_CANCELLED"]
  ])("maps a failed browser ceremony (%#)", async (outcome, code) => {
    supported();
    const { fetch, calls } = fakeFetch([json(OPTIONS)]);
    expect(await registerPasskey(fetch, creds(outcome), "tok")).toEqual({ ok: false, code });
    expect(calls).toHaveLength(1);
  });

  it("maps a non-object rejection to PASSKEY_FAILED", async () => {
    supported();
    const { fetch } = fakeFetch([json(OPTIONS)]);
    const create = async () => {
      throw null;
    };
    expect(await registerPasskey(fetch, { create }, "tok")).toEqual({
      ok: false,
      code: "PASSKEY_FAILED"
    });
  });

  it("returns the verify error code", async () => {
    supported();
    const { fetch } = fakeFetch([
      json(OPTIONS),
      json({ code: "WEBAUTHN_VERIFICATION_FAILED" }, 400)
    ]);
    expect(
      await registerPasskey(fetch, creds(fakeCredential() as unknown as Credential), "tok")
    ).toEqual({ ok: false, code: "WEBAUTHN_VERIFICATION_FAILED" });
  });
});

describe("authErrorKey for passkey codes (#343)", () => {
  it.each([
    ["UNAUTHORIZED", "signInErrorPasskeySession"],
    ["PASSKEY_NOT_SUPPORTED", "signInErrorPasskeySupport"],
    ["PASSKEY_CANCELLED", "signInErrorPasskeyCancelled"],
    ["PASSKEY_FAILED", "signInErrorPasskey"],
    ["WEBAUTHN_VERIFICATION_FAILED", "signInErrorPasskey"],
    ["REGISTRATION_ERROR", "signInErrorPasskey"]
  ])("maps %s to %s", (code, key) => {
    expect(authErrorKey(code)).toBe(key);
  });
});
