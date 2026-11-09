import { describe, expect, it } from "vitest";
import {
  SsrSecurityError,
  StreamTooLargeError,
  isPrivateOrLocalHost,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  parseIpv4ToUint32,
  parseIpv6,
  safeFetchWithGuard,
  validateSafeUrl
} from "../ssrf-guard.js";

describe("SSRF Guard - parseIpv4ToUint32", () => {
  it("covers error branch in constructor for custom errors", () => {
    const customSec = new SsrSecurityError("custom message", "CUSTOM_CODE");
    expect(customSec.code).toBe("CUSTOM_CODE");
    const customStream = new StreamTooLargeError("large", 100);
    expect(customStream.limit).toBe(100);
  });

  it("parses valid dotted IPv4 addresses correctly", () => {
    expect(parseIpv4ToUint32("127.0.0.1")).toBe(0x7f000001);
    expect(parseIpv4ToUint32("192.168.1.1")).toBe(0xc0a80101);
    expect(parseIpv4ToUint32("0.0.0.0")).toBe(0);
    expect(parseIpv4ToUint32("255.255.255.255")).toBe(0xffffffff);
  });

  it("parses 3-part and 2-part dotted IPv4 addresses", () => {
    // 127.0.1 -> 127.0.0.1
    expect(parseIpv4ToUint32("127.0.1")).toBe(0x7f000001);
    // 10.1 -> 10.0.0.1
    expect(parseIpv4ToUint32("10.1")).toBe(0x0a000001);

    // Invalid high values for 3-part and 2-part
    expect(parseIpv4ToUint32("300.0.1")).toBeNull();
    expect(parseIpv4ToUint32("127.300.1")).toBeNull();
    expect(parseIpv4ToUint32("300.1")).toBeNull();
  });

  it("parses integer, hex, and octal IPv4 formats", () => {
    // 2130706433 is 127.0.0.1
    expect(parseIpv4ToUint32("2130706433")).toBe(0x7f000001);
    // 0x7f000001 is 127.0.0.1
    expect(parseIpv4ToUint32("0x7f000001")).toBe(0x7f000001);
    // 0177.0.0.1 (octal first byte 0177 = 127)
    expect(parseIpv4ToUint32("0177.0.0.1")).toBe(0x7f000001);
    // octal single integer 017700000001
    expect(parseIpv4ToUint32("017700000001")).toBe(0x7f000001);
    // hex parts: 0x7f.0.0.1
    expect(parseIpv4ToUint32("0x7f.0.0.1")).toBe(0x7f000001);
  });

  it("returns null for non-IPv4 strings or out of range values", () => {
    expect(parseIpv4ToUint32("example.com")).toBeNull();
    expect(parseIpv4ToUint32("256.0.0.1")).toBeNull();
    expect(parseIpv4ToUint32("1.2.3.4.5")).toBeNull();
    expect(parseIpv4ToUint32("1.2..4")).toBeNull();
    expect(parseIpv4ToUint32("")).toBeNull();
    expect(parseIpv4ToUint32("0xzzzz")).toBeNull();
    expect(parseIpv4ToUint32("0xffffffffff")).toBeNull();
    expect(parseIpv4ToUint32("999999999999999")).toBeNull();
    expect(parseIpv4ToUint32("127.0.0.999")).toBeNull();
    expect(parseIpv4ToUint32("127.0.999999")).toBeNull();
    expect(parseIpv4ToUint32("127.999999999")).toBeNull();
    expect(parseIpv4ToUint32("not-an-ip")).toBeNull();
    expect(parseIpv4ToUint32("127.0.0.invalid")).toBeNull();
    expect(parseIpv4ToUint32("-5")).toBeNull();
  });
});

describe("SSRF Guard - isPrivateOrReservedIpv4", () => {
  it("identifies private and reserved IPv4 blocks", () => {
    // 0.0.0.0/8
    expect(isPrivateOrReservedIpv4(0x00000000)).toBe(true);
    // 10.0.0.0/8
    expect(isPrivateOrReservedIpv4(0x0a000001)).toBe(true);
    // 100.64.0.0/10 (CGNAT)
    expect(isPrivateOrReservedIpv4((100 << 24) | (64 << 16) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4((100 << 24) | (127 << 16) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4((100 << 24) | (128 << 16) | 1)).toBe(false);
    // 127.0.0.0/8 (Loopback)
    expect(isPrivateOrReservedIpv4(0x7f000001)).toBe(true);
    // 169.254.0.0/16 (Link-Local / AWS Metadata 169.254.169.254)
    expect(isPrivateOrReservedIpv4((169 << 24) | (254 << 16) | (169 << 8) | 254)).toBe(true);
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    expect(isPrivateOrReservedIpv4((172 << 24) | (16 << 16) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4((172 << 24) | (31 << 16) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4((172 << 24) | (32 << 16) | 1)).toBe(false);
    // 192.0.0.0/24 & 192.0.2.0/24
    expect(isPrivateOrReservedIpv4((192 << 24) | (0 << 16) | (0 << 8) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4((192 << 24) | (0 << 16) | (2 << 8) | 1)).toBe(true);
    // 192.168.0.0/16
    expect(isPrivateOrReservedIpv4((192 << 24) | (168 << 16) | (1 << 8) | 1)).toBe(true);
    // 198.18.0.0/15
    expect(isPrivateOrReservedIpv4((198 << 24) | (18 << 16) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4((198 << 24) | (19 << 16) | 1)).toBe(true);
    // 198.51.100.0/24
    expect(isPrivateOrReservedIpv4((198 << 24) | (51 << 16) | (100 << 8) | 1)).toBe(true);
    // 203.0.113.0/24
    expect(isPrivateOrReservedIpv4((203 << 24) | (0 << 16) | (113 << 8) | 1)).toBe(true);
    // 224.0.0.0/4 Multicast
    expect(isPrivateOrReservedIpv4((224 << 24) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4((239 << 24) | 1)).toBe(true);
    // 240.0.0.0/4 Reserved
    expect(isPrivateOrReservedIpv4((240 << 24) | 1)).toBe(true);
    expect(isPrivateOrReservedIpv4(0xffffffff)).toBe(true);

    // Public IP: 8.8.8.8, 1.1.1.1, 142.250.180.206
    expect(isPrivateOrReservedIpv4((8 << 24) | (8 << 16) | (8 << 8) | 8)).toBe(false);
    expect(isPrivateOrReservedIpv4((1 << 24) | (1 << 16) | (1 << 8) | 1)).toBe(false);
  });
});

describe("SSRF Guard - parseIpv6 & isPrivateOrReservedIpv6", () => {
  it("parses 8-part uncompressed IPv6", () => {
    expect(parseIpv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6("1:2:3:4:5:6:7")).toBeNull();
  });

  it("parses standard and compressed IPv6 addresses", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("2001:db8::1")).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("fe80::1ff:fe23:4567:890a")).toEqual([
      0xfe80, 0, 0, 0, 0x01ff, 0xfe23, 0x4567, 0x890a
    ]);
  });

  it("parses IPv4-mapped IPv6 addresses", () => {
    // ::ffff:127.0.0.1
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
    // [::ffff:192.168.1.1] with brackets and zone
    expect(parseIpv6("[::ffff:192.168.1.1%eth0]")).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101]);
  });

  it("handles malformed IPv6 strings gracefully", () => {
    expect(parseIpv6(":::")).toBeNull();
    expect(parseIpv6("::1::2")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7:gggg")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7:8:9:10")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7::8:9")).toBeNull();
    expect(parseIpv6("::ffff:999.999.999.999")).toBeNull();
    expect(parseIpv6("1:2:3")).toBeNull();
  });

  it("identifies private/reserved IPv6 ranges", () => {
    // ::1 loopback
    expect(isPrivateOrReservedIpv6([0, 0, 0, 0, 0, 0, 0, 1])).toBe(true);
    // :: unspecified
    expect(isPrivateOrReservedIpv6([0, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
    // ULA fc00::/7 (fc00:: and fd00::)
    expect(isPrivateOrReservedIpv6([0xfc00, 0, 0, 0, 0, 0, 0, 1])).toBe(true);
    expect(isPrivateOrReservedIpv6([0xfd12, 0x3456, 0, 0, 0, 0, 0, 1])).toBe(true);
    // Link-local fe80::/10
    expect(isPrivateOrReservedIpv6([0xfe80, 0, 0, 0, 0, 0, 0, 1])).toBe(true);
    // Site-local fec0::/10
    expect(isPrivateOrReservedIpv6([0xfec0, 0, 0, 0, 0, 0, 0, 1])).toBe(true);
    // Multicast ff00::/8
    expect(isPrivateOrReservedIpv6([0xff02, 0, 0, 0, 0, 0, 0, 1])).toBe(true);
    // Discard 100::/64
    expect(isPrivateOrReservedIpv6([0x0100, 0, 0, 0, 0, 0, 0, 1])).toBe(true);
    // Documentation 2001:db8::/32
    expect(isPrivateOrReservedIpv6([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1])).toBe(true);
    // IPv4-mapped private
    expect(isPrivateOrReservedIpv6([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1])).toBe(true);
    // IPv4-mapped public IP
    expect(isPrivateOrReservedIpv6([0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808])).toBe(false);
    // IPv4-compatible 0:0:0:0:0:0:0:0
    expect(isPrivateOrReservedIpv6([0, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
    // Empty / short segments
    expect(isPrivateOrReservedIpv6([])).toBe(true);

    // Public IPv6
    expect(isPrivateOrReservedIpv6([0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111])).toBe(false);
  });
});

describe("SSRF Guard - isPrivateOrLocalHost", () => {
  it("blocks localhost, hostnames and internal cloud metadata", () => {
    expect(isPrivateOrLocalHost("localhost")).toBe(true);
    expect(isPrivateOrLocalHost("localhost.localdomain")).toBe(true);
    expect(isPrivateOrLocalHost("app.localhost")).toBe(true);
    expect(isPrivateOrLocalHost("service.local")).toBe(true);
    expect(isPrivateOrLocalHost("database.internal")).toBe(true);
    expect(isPrivateOrLocalHost("metadata.google.internal")).toBe(true);
    expect(isPrivateOrLocalHost("metadata")).toBe(true);
    expect(isPrivateOrLocalHost("instance-data")).toBe(true);
  });

  it("blocks IPv4 addresses in various notations", () => {
    expect(isPrivateOrLocalHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHost("127.0.0.1:8080")).toBe(true);
    expect(isPrivateOrLocalHost("10.0.0.5")).toBe(true);
    expect(isPrivateOrLocalHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrLocalHost("192.168.1.100")).toBe(true);
    expect(isPrivateOrLocalHost("169.254.169.254")).toBe(true);
    expect(isPrivateOrLocalHost("0.0.0.0")).toBe(true);
    expect(isPrivateOrLocalHost("2130706433")).toBe(true); // 127.0.0.1 int
    expect(isPrivateOrLocalHost("0x7f000001")).toBe(true); // 127.0.0.1 hex
    expect(isPrivateOrLocalHost("0177.0.0.1")).toBe(true); // 127.0.0.1 octal
  });

  it("blocks IPv6 addresses", () => {
    expect(isPrivateOrLocalHost("::1")).toBe(true);
    expect(isPrivateOrLocalHost("[::1]")).toBe(true);
    expect(isPrivateOrLocalHost("[::1]:8080")).toBe(true);
    expect(isPrivateOrLocalHost("fe80::1")).toBe(true);
    expect(isPrivateOrLocalHost("fd00::1")).toBe(true);
  });

  it("allows legitimate public domains and public IPs", () => {
    expect(isPrivateOrLocalHost("example.com")).toBe(false);
    expect(isPrivateOrLocalHost("docs.google.com")).toBe(false);
    expect(isPrivateOrLocalHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalHost("1.1.1.1")).toBe(false);
  });
});

describe("SSRF Guard - validateSafeUrl", () => {
  it("rejects non-strings or empty URLs", () => {
    expect(validateSafeUrl("").valid).toBe(false);
    expect(validateSafeUrl("   ").valid).toBe(false);
    // @ts-expect-error test non-string
    expect(validateSafeUrl(null).valid).toBe(false);
  });

  it("rejects invalid URL schemas and malicious protocols", () => {
    expect(validateSafeUrl("file:///etc/passwd").valid).toBe(false);
    expect(validateSafeUrl("ftp://ftp.example.com").valid).toBe(false);
    expect(validateSafeUrl("javascript:alert(1)").valid).toBe(false);
    expect(validateSafeUrl("data:text/html,<h1>test</h1>").valid).toBe(false);
    expect(validateSafeUrl("gopher://localhost").valid).toBe(false);
    expect(validateSafeUrl("not-a-url").valid).toBe(false);
  });

  it("rejects URLs containing embedded credentials", () => {
    const res = validateSafeUrl("https://admin:password@example.com/secret");
    expect(res.valid).toBe(false);
    expect(res.reason).toContain("Benutzerauthentifizierung");
  });

  it("rejects SSRF target URLs", () => {
    expect(validateSafeUrl("http://localhost:3000").valid).toBe(false);
    expect(validateSafeUrl("http://127.0.0.1/admin").valid).toBe(false);
    expect(validateSafeUrl("http://0x7f000001/admin").valid).toBe(false);
    expect(validateSafeUrl("http://169.254.169.254/latest/meta-data").valid).toBe(false);
    expect(validateSafeUrl("http://[::1]:8080").valid).toBe(false);
    expect(validateSafeUrl("http://10.0.0.1/").valid).toBe(false);
    expect(validateSafeUrl("http://172.16.5.5/").valid).toBe(false);
    expect(validateSafeUrl("http://192.168.1.1/").valid).toBe(false);
  });

  it("approves valid public HTTPS and HTTP URLs", () => {
    const res1 = validateSafeUrl("https://example.com/article");
    expect(res1.valid).toBe(true);
    expect(res1.url?.hostname).toBe("example.com");

    const res2 = validateSafeUrl("http://8.8.8.8/dns");
    expect(res2.valid).toBe(true);
  });
});

describe("SSRF Guard - safeFetchWithGuard", () => {
  it("fetches URL successfully with custom fetch mock", async () => {
    const mockFetch = async () =>
      new Response("<html><head><title>Test</title></head><body>Content</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });

    const result = await safeFetchWithGuard("https://example.com/test", {
      customFetch: mockFetch as typeof fetch
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toContain("text/html");
    const text = new TextDecoder().decode(result.buffer);
    expect(text).toContain("Content");
  });

  it("blocks SSRF target before sending request", async () => {
    await expect(safeFetchWithGuard("http://127.0.0.1:8080/admin")).rejects.toThrow(
      SsrSecurityError
    );

    await expect(safeFetchWithGuard("http://169.254.169.254/metadata")).rejects.toThrow(
      SsrSecurityError
    );

    const errorMockFetch = async () => {
      throw new SsrSecurityError("Inner SSRF");
    };
    await expect(
      safeFetchWithGuard("https://example.com/check", {
        customFetch: errorMockFetch as typeof fetch
      })
    ).rejects.toThrow(SsrSecurityError);

    const largeMockFetch = async () => {
      throw new StreamTooLargeError("Inner too large", 100);
    };
    await expect(
      safeFetchWithGuard("https://example.com/check2", {
        customFetch: largeMockFetch as typeof fetch
      })
    ).rejects.toThrow(StreamTooLargeError);
  });

  it("follows redirects up to limit and validates each hop against SSRF", async () => {
    let callCount = 0;
    const mockFetch = async (input: RequestInfo | URL) => {
      callCount++;
      const urlStr = input.toString();
      if (urlStr === "https://example.com/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "/next" }
        });
      }
      if (urlStr === "https://example.com/next") {
        return new Response("Final Content", {
          status: 200,
          headers: { "content-type": "text/plain" }
        });
      }
      return new Response(null, { status: 404 });
    };

    const res = await safeFetchWithGuard("https://example.com/start", {
      customFetch: mockFetch as typeof fetch
    });

    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe("https://example.com/next");
    expect(callCount).toBe(2);
  });

  it("blocks redirects to internal/private targets (SSRF via redirect)", async () => {
    const mockFetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:3000/internal" }
      });

    await expect(
      safeFetchWithGuard("https://example.com/redirect-ssrf", {
        customFetch: mockFetch as typeof fetch
      })
    ).rejects.toThrow(SsrSecurityError);
  });

  it("aborts when max redirects are exceeded", async () => {
    const mockFetch = async (input: RequestInfo | URL) => {
      const u = new URL(input.toString());
      const step = Number.parseInt(u.searchParams.get("step") ?? "0", 10);
      return new Response(null, {
        status: 302,
        headers: { location: `https://example.com/loop?step=${step + 1}` }
      });
    };

    await expect(
      safeFetchWithGuard("https://example.com/loop?step=0", {
        maxRedirects: 3,
        customFetch: mockFetch as typeof fetch
      })
    ).rejects.toThrow(/Maximale Anzahl von 3 Redirects überschritten/);
  });

  it("throws on redirect without location header or invalid location", async () => {
    const mockFetchNoLoc = async () => new Response(null, { status: 301 });
    await expect(
      safeFetchWithGuard("https://example.com/no-loc", {
        customFetch: mockFetchNoLoc as typeof fetch
      })
    ).rejects.toThrow(/Redirect ohne Location-Header/);

    const mockFetchBadLoc = async () =>
      new Response(null, {
        status: 301,
        headers: { location: "http://[invalid-ipv6" }
      });
    await expect(
      safeFetchWithGuard("https://example.com/bad-loc", {
        customFetch: mockFetchBadLoc as typeof fetch
      })
    ).rejects.toThrow(/Ungültige Redirect-URL/);
  });

  it("enforces Content-Length and streaming body byte limits", async () => {
    // 1. Content-Length header limit
    const mockFetchHeader = async () =>
      new Response("some data", {
        status: 200,
        headers: { "content-length": "20971520" } // 20 MB
      });

    await expect(
      safeFetchWithGuard("https://example.com/large-header", {
        maxByteSize: 10 * 1024 * 1024,
        customFetch: mockFetchHeader as typeof fetch
      })
    ).rejects.toThrow(StreamTooLargeError);

    // 1b. Content-length header within limit
    const mockFetchHeaderOk = async () =>
      new Response("hello world", {
        status: 200,
        headers: { "content-length": "11" }
      });
    const headerOkRes = await safeFetchWithGuard("https://example.com/small-header", {
      maxByteSize: 10 * 1024 * 1024,
      customFetch: mockFetchHeaderOk as typeof fetch
    });
    expect(new TextDecoder().decode(headerOkRes.buffer)).toBe("hello world");

    // 2. Streaming reader limit exceeded without Content-Length
    const largeChunk = new Uint8Array(1024 * 1024); // 1 MB
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(largeChunk);
        controller.enqueue(largeChunk);
        controller.enqueue(largeChunk);
        controller.close();
      }
    });

    const mockFetchStream = async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "application/octet-stream" }
      });

    await expect(
      safeFetchWithGuard("https://example.com/stream-large", {
        maxByteSize: 2 * 1024 * 1024, // 2 MB limit
        customFetch: mockFetchStream as typeof fetch
      })
    ).rejects.toThrow(StreamTooLargeError);
  });

  it("handles non-OK HTTP responses", async () => {
    const mockFetch404 = async () =>
      new Response("Not Found", { status: 404, statusText: "Not Found" });
    await expect(
      safeFetchWithGuard("https://example.com/missing", {
        customFetch: mockFetch404 as typeof fetch
      })
    ).rejects.toThrow(/Status 404/);
  });

  it("handles empty body gracefully", async () => {
    const mockEmpty = async () => new Response(null, { status: 200 });
    const res = await safeFetchWithGuard("https://example.com/empty", {
      customFetch: mockEmpty as typeof fetch
    });
    expect(res.buffer.length).toBe(0);
  });

  it("handles request timeout and AbortError", async () => {
    const mockTimeout = async () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    };

    await expect(
      safeFetchWithGuard("https://example.com/slow", {
        timeoutMs: 100,
        customFetch: mockTimeout as typeof fetch
      })
    ).rejects.toThrow(/Zeitüberschreitung beim Laden der URL/);
  });

  it("re-throws unexpected errors", async () => {
    const mockNetworkErr = async () => {
      throw new Error("DNS resolution failed");
    };

    await expect(
      safeFetchWithGuard("https://example.com/network-err", {
        customFetch: mockNetworkErr as typeof fetch
      })
    ).rejects.toThrow("DNS resolution failed");
  });
});
