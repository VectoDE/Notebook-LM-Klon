import { describe, expect, it, vi } from "vitest";
import {
  assertHostResolvesPublic,
  createDohResolver,
  guardedEndpointFetch,
  isBlockedIp,
  isHostAllowed,
  parseHostAllowlist,
  ResponseTooLargeError,
  readBodyLimited,
  redactSecret,
  validateUserEndpoint
} from "@/security/endpoint-guard.js";
import { SsrSecurityError } from "@/security/ssrf-guard.js";

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
    ["kein url", ALLOW, "ENDPOINT_INVALID"],
    ["kein url", [], "ENDPOINT_INVALID"],
    ["http://api.example.com/v1", [], "ENDPOINT_NOT_HTTPS"],
    ["ftp://api.example.com/v1", [], "ENDPOINT_NOT_HTTPS"],
    ["https://u:p@api.example.com/v1", [], "ENDPOINT_CREDENTIALS"],
    ["https://u@api.example.com/v1", [], "ENDPOINT_CREDENTIALS"],
    ["https://api.example.com:8443/v1", [], "ENDPOINT_PORT"],
    ["https://api.example.com:80/v1", [], "ENDPOINT_PORT"],
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

  it("ohne Allowlist ist jeder öffentliche HTTPS-Host erlaubt (F247: „Alle“)", () => {
    for (const url of [
      "https://api.example.com/v1",
      "https://API.Example.COM./v1",
      "https://eu.models.example/openai/v1",
      "https://1.1.1.1/v1",
      "https://[2606:4700:4700::1111]/v1",
      "https://[2001:4860:4860::8888]/v1"
    ]) {
      const result = validateUserEndpoint(url, []);
      expect(result, url).toMatchObject({ valid: true });
    }
  });

  it("mit gesetzter Allowlist bleibt sie eine zusätzliche Einschränkung", () => {
    expect(validateUserEndpoint("https://evil.example/v1", ALLOW).code).toBe(
      "ENDPOINT_NOT_ALLOWED"
    );
    // Die Allowlist hebt die Sperre interner Ziele nicht auf.
    expect(validateUserEndpoint("https://intranet/v1", ["intranet"]).code).toBe("SSRF_DETECTED");
    expect(validateUserEndpoint("https://10.0.0.1/v1", ["10.0.0.1"]).code).toBe("SSRF_DETECTED");
  });

  // Ohne Allowlist (alle öffentlichen Hosts erlaubt): diese Ziele bleiben gesperrt.
  it.each([
    // IPv4 in allen Schreibweisen (der URL-Parser normalisiert dezimal/oktal/hex)
    ["https://127.0.0.1/v1"],
    ["https://127.1/v1"],
    ["https://2130706433/v1"],
    ["https://0x7f000001/v1"],
    ["https://0177.0.0.1/v1"],
    ["https://0x7f.0.0.1/v1"],
    ["https://0.0.0.0/v1"],
    ["https://0/v1"],
    ["https://10.0.0.1/v1"],
    ["https://012.0.0.1/v1"],
    ["https://172.16.0.1/v1"],
    ["https://172.31.255.255/v1"],
    ["https://192.168.1.1/v1"],
    ["https://3232235777/v1"],
    ["https://100.64.0.1/v1"],
    ["https://100.127.255.254/v1"],
    ["https://100.100.100.200/v1"],
    ["https://169.254.169.254/v1"],
    ["https://169.254.170.2/v1"],
    ["https://0xa9fea9fe/v1"],
    ["https://192.0.0.192/v1"],
    ["https://192.0.2.1/v1"],
    ["https://192.88.99.1/v1"],
    ["https://198.18.0.1/v1"],
    ["https://198.51.100.1/v1"],
    ["https://203.0.113.1/v1"],
    ["https://224.0.0.1/v1"],
    ["https://239.255.255.250/v1"],
    ["https://240.0.0.1/v1"],
    ["https://255.255.255.255/v1"],
    // IPv6 einschließlich Übergangsformen
    ["https://[::1]/v1"],
    ["https://[::]/v1"],
    ["https://[0:0:0:0:0:0:0:1]/v1"],
    ["https://[::ffff:127.0.0.1]/v1"],
    ["https://[::ffff:7f00:1]/v1"],
    ["https://[::ffff:169.254.169.254]/v1"],
    ["https://[::ffff:10.0.0.1]/v1"],
    ["https://[::127.0.0.1]/v1"],
    ["https://[64:ff9b::a9fe:a9fe]/v1"],
    ["https://[64:ff9b::10.0.0.1]/v1"],
    ["https://[64:ff9b:1::1]/v1"],
    ["https://[2002:7f00:1::1]/v1"],
    ["https://[2002:c0a8:101::1]/v1"],
    ["https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/v1"],
    ["https://[2001:2::1]/v1"],
    ["https://[2001:10::1]/v1"],
    ["https://[2001:20::1]/v1"],
    ["https://[2001:db8::1]/v1"],
    ["https://[3fff::1]/v1"],
    ["https://[5f00::1]/v1"],
    ["https://[100::1]/v1"],
    ["https://[fc00::1]/v1"],
    ["https://[fd00:ec2::254]/v1"],
    ["https://[fe80::1]/v1"],
    ["https://[febf::1]/v1"],
    ["https://[fec0::1]/v1"],
    ["https://[ff02::1]/v1"],
    ["https://[::ffff:0:7f00:1]/v1"],
    ["https://[4000::1]/v1"],
    ["https://[5f01::1]/v1"],
    // Interne Namen
    ["https://localhost/v1"],
    ["https://LOCALHOST/v1"],
    ["https://localhost./v1"],
    ["https://api.localhost/v1"],
    ["https://localhost.localdomain/v1"],
    ["https://printer.local/v1"],
    ["https://printer.local./v1"],
    ["https://metadata.google.internal/v1"],
    ["https://svc.cluster.internal/v1"],
    ["https://nas.home.arpa/v1"],
    ["https://1.0.0.127.in-addr.arpa/v1"],
    ["https://metadata/v1"],
    ["https://instance-data/v1"],
    ["https://intranet/v1"],
    ["https://intranet./v1"],
    ["https://intranet../v1"],
    ["https://localhost../v1"],
    ["https://printer.local../v1"],
    ["https://xn--intrnet-9wa/v1"]
  ])("sperrt %s", (url) => {
    const result = validateUserEndpoint(url, []);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("SSRF_DETECTED");
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

  it.each([
    "0.0.0.0",
    "127.0.0.53",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.0.10",
    "100.64.1.1",
    "169.254.169.254",
    "192.0.0.170",
    "192.88.99.10",
    "224.0.0.251",
    "255.255.255.255",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1",
    "2002:a00:1::1",
    "2001::1",
    "2001:2::5",
    "2001:db8::5",
    "3fff:1::1",
    "5f00::1",
    "fd00:ec2::254",
    "fe80::1%eth0",
    "ff05::1:3",
    "",
    "nicht-ip",
    "1.2.3.4.5"
  ])("DNS-Antwort %s gilt als gesperrt", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.215.14",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.88.98.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2a00:1450:4001::200e",
    "::ffff:1.1.1.1",
    "64:ff9b::808:808",
    "2001:200::1",
    "3fff:1000::1"
  ])("DNS-Antwort %s gilt als öffentlich", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
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

  it("bricht ab, wenn die Header nicht rechtzeitig kommen", async () => {
    const fetchFn = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(
      guardedEndpointFetch(
        "https://api.relationflow.example/v1/models",
        {},
        { allowlist: ALLOW, resolver: publicResolver, fetchFn, timeoutMs: 20 }
      )
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("prüft eingebettete IPv4 in IPv6-Übergangsformen", () => {
    expect(isBlockedIp("::7f00:1")).toBe(true);
    expect(isBlockedIp("::5db8:d70e")).toBe(false);
    expect(isBlockedIp("64:ff9b::a9fe:a9fe")).toBe(true);
    expect(isBlockedIp("64:ff9b::5db8:d70e")).toBe(false);
    expect(isBlockedIp("64:ff9b:1::1")).toBe(true);
    expect(isBlockedIp("2002:a9fe:a9fe::1")).toBe(true);
    expect(isBlockedIp("2002:5db8:d70e::1")).toBe(false);
    expect(isBlockedIp("2001:0:4136:e378::1")).toBe(true);
    expect(isBlockedIp("2001:4860::8888")).toBe(false);
  });

  it("prüft DNS vor jedem Aufruf neu (Rebinding nach dem Speichern)", async () => {
    const answers = [["93.184.215.14"], ["169.254.169.254"]];
    const resolver = vi.fn(async () => answers.shift() ?? []);
    const fetchFn = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    const options = { allowlist: [], resolver, fetchFn };
    await guardedEndpointFetch("https://api.example.com/v1/models", {}, options);
    await expect(
      guardedEndpointFetch("https://api.example.com/v1/models", {}, options)
    ).rejects.toMatchObject({ code: "SSRF_DETECTED" });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
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

describe("endpoint-guard: begrenztes Lesen", () => {
  it("liest kleine Bodys vollständig, auch über mehrere Teile und Mehrbyte-Zeichen", async () => {
    const parts = ["Grü", "ße ", "✓"].map((s) => new TextEncoder().encode(s));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        controller.close();
      }
    });
    expect(await readBodyLimited(new Response(body), 100)).toBe("Grüße ✓");
    expect(await readBodyLimited(new Response(null), 100)).toBe("");
  });

  it("wirft im Modus throw, kürzt im Modus truncate", async () => {
    await expect(readBodyLimited(new Response("x".repeat(50)), 10)).rejects.toBeInstanceOf(
      ResponseTooLargeError
    );
    expect(await readBodyLimited(new Response("x".repeat(50)), 10, "truncate")).toBe(
      "x".repeat(10)
    );
  });

  it("lehnt eine zu große Content-Length nur im Modus throw vorab ab", async () => {
    const declared = new Response(null, { headers: { "content-length": "999" } });
    await expect(readBodyLimited(declared, 10)).rejects.toThrow("zu groß");
    const truncated = new Response("abc", { headers: { "content-length": "999" } });
    expect(await readBodyLimited(truncated, 10, "truncate")).toBe("abc");
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
