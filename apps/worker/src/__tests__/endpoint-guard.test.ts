import { describe, expect, it, vi } from "vitest";
import {
  assertHostResolvesPublic,
  createDohResolver,
  guardedEndpointFetch,
  isBlockedIp,
  isHostAllowed,
  parseHostAllowlist,
  redactSecret,
  validateUserEndpoint
} from "../endpoint-guard.js";
import { SsrSecurityError } from "../ssrf-guard.js";

const ALLOW = ["api.relationflow.example", "*.models.example"];
const publicResolver = async () => ["93.184.215.14"];

describe("endpoint-guard: Allowlist (Issue #247)", () => {
  it("liest kommagetrennte Einträge und ignoriert Leeres und Nicht-Strings", () => {
    expect(parseHostAllowlist(" A.example , ,*.B.example ")).toEqual(["a.example", "*.b.example"]);
    expect(parseHostAllowlist(undefined)).toEqual([]);
    expect(parseHostAllowlist(42)).toEqual([]);
  });

  it("prüft exakte Hosts und Subdomain-Platzhalter", () => {
    expect(isHostAllowed("api.relationflow.example", ALLOW)).toBe(true);
    expect(isHostAllowed("API.relationflow.example.", ALLOW)).toBe(true);
    expect(isHostAllowed("eu.models.example", ALLOW)).toBe(true);
    expect(isHostAllowed("models.example", ALLOW)).toBe(false);
    expect(isHostAllowed(".models.example", ALLOW)).toBe(false);
    expect(isHostAllowed("evilmodels.example", ALLOW)).toBe(false);
    expect(isHostAllowed("other.example", ALLOW)).toBe(false);
  });
});

describe("endpoint-guard: statische URL-Prüfung", () => {
  it.each([
    ["https://api.relationflow.example/v1", [], "BYOM_DISABLED"],
    ["kein url", ALLOW, "ENDPOINT_INVALID"],
    ["http://api.relationflow.example/v1", ALLOW, "ENDPOINT_NOT_HTTPS"],
    ["https://u:p@api.relationflow.example/v1", ALLOW, "ENDPOINT_CREDENTIALS"],
    ["https://api.relationflow.example/v1?x=1", ALLOW, "ENDPOINT_INVALID"],
    ["https://api.relationflow.example/v1#a", ALLOW, "ENDPOINT_INVALID"],
    ["https://api.relationflow.example:8443/v1", ALLOW, "ENDPOINT_PORT"],
    ["https://127.0.0.1/v1", ["127.0.0.1"], "SSRF_DETECTED"],
    ["https://localhost/v1", ["localhost"], "SSRF_DETECTED"],
    ["https://[::1]/v1", ["[::1]"], "SSRF_DETECTED"],
    ["https://evil.example/v1", ALLOW, "ENDPOINT_NOT_ALLOWED"]
  ])("lehnt %s ab", (url, allowlist, code) => {
    const result = validateUserEndpoint(url, allowlist);
    expect(result.valid).toBe(false);
    expect(result.code).toBe(code);
    expect(result.reason).toBeTruthy();
  });

  it("akzeptiert HTTPS auf erlaubtem Host, auch mit explizitem Port 443", () => {
    expect(validateUserEndpoint("https://api.relationflow.example/v1", ALLOW).valid).toBe(true);
    const withPort = validateUserEndpoint("https://api.relationflow.example:443/v1", ALLOW);
    expect(withPort.valid).toBe(true);
    expect(withPort.url?.port).toBe("");
  });
});

describe("endpoint-guard: DNS-Prüfung gegen Rebinding", () => {
  it("erkennt private und öffentliche Adressen", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("93.184.215.14")).toBe(false);
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("2606:4700::1111")).toBe(false);
    expect(isBlockedIp("kein-ip")).toBe(true);
  });

  it("überspringt die Auflösung bei IP-Literalen", async () => {
    const resolver = vi.fn(publicResolver);
    await assertHostResolvesPublic("93.184.215.14", resolver);
    await assertHostResolvesPublic("[2606:4700::1111]", resolver);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("blockiert fehlgeschlagene, leere und private Auflösungen", async () => {
    await expect(
      assertHostResolvesPublic("a.example", async () => {
        throw new Error("down");
      })
    ).rejects.toMatchObject({ code: "DNS_FAILED" });
    await expect(assertHostResolvesPublic("a.example", async () => [])).rejects.toMatchObject({
      code: "DNS_FAILED"
    });
    await expect(
      assertHostResolvesPublic("a.example", async () => ["93.184.215.14", "192.168.1.5"])
    ).rejects.toMatchObject({ code: "SSRF_DETECTED" });
    await expect(assertHostResolvesPublic("a.example", publicResolver)).resolves.toBeUndefined();
  });

  it("DoH-Resolver liest A- und AAAA-Einträge und ignoriert CNAME", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      expect(u).toContain("name=a.example");
      if (u.endsWith("type=A")) {
        return Response.json({
          Answer: [
            { type: 5, data: "alias.example." },
            { type: 1, data: "93.184.215.14" }
          ]
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;
    const resolver = createDohResolver(fetchFn);
    expect(await resolver("a.example")).toEqual(["93.184.215.14"]);
    const v6 = createDohResolver((async () =>
      Response.json({
        Answer: [{ type: 28, data: "2606:4700::1111" }]
      })) as unknown as typeof fetch);
    expect(await v6("b.example")).toEqual(["2606:4700::1111", "2606:4700::1111"]);
  });

  it("DoH-Resolver wirft bei HTTP-Fehler", async () => {
    const resolver = createDohResolver(
      (async () => new Response("x", { status: 502 })) as unknown as typeof fetch
    );
    await expect(resolver("a.example")).rejects.toThrow("502");
  });

  it("nutzt ohne Angabe das globale fetch", () => {
    expect(typeof createDohResolver()).toBe("function");
  });
});

describe("endpoint-guard: geschützter Aufruf", () => {
  it("wirft bei unzulässiger URL, bevor ein Aufruf passiert", async () => {
    const fetchFn = vi.fn();
    await expect(
      guardedEndpointFetch(
        "http://api.relationflow.example/v1/models",
        {},
        { allowlist: ALLOW, resolver: publicResolver, fetchFn: fetchFn as unknown as typeof fetch }
      )
    ).rejects.toBeInstanceOf(SsrSecurityError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("lehnt Weiterleitungen ab und setzt redirect=manual", async () => {
    let seen: RequestInit | undefined;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    }) as unknown as typeof fetch;
    await expect(
      guardedEndpointFetch(
        "https://api.relationflow.example/v1/models",
        { signal: new AbortController().signal },
        { allowlist: ALLOW, resolver: publicResolver, fetchFn, timeoutMs: 1000 }
      )
    ).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });
    expect(seen?.redirect).toBe("manual");
  });

  it("liefert die Antwort bei erlaubtem Ziel", async () => {
    const fetchFn = (async () => new Response("ok")) as unknown as typeof fetch;
    const res = await guardedEndpointFetch(
      "https://api.relationflow.example/v1/models",
      {},
      { allowlist: ALLOW, resolver: publicResolver, fetchFn }
    );
    expect(await res.text()).toBe("ok");
  });
});

describe("endpoint-guard: Schlüssel in Fehlertexten", () => {
  it("entfernt den Schlüssel und typische Formen", () => {
    const key = "rf_live_abcdefghijk";
    const out = redactSecret(`bad key ${key} and sk-proj-12345678901 Bearer xyz`, key);
    expect(out).not.toContain(key);
    expect(out).not.toContain("sk-proj-12345678901");
    expect(out).not.toContain("xyz");
    expect(out).toContain("[redacted]");
  });

  it("lässt kurze oder fehlende Schlüssel aus und kürzt lange Texte", () => {
    expect(redactSecret("abc", "ab")).toBe("abc");
    expect(redactSecret("abc", undefined)).toBe("abc");
    const long = redactSecret("x".repeat(300), undefined, 10);
    expect(long).toBe(`${"x".repeat(10)}…`);
  });
});
