import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isPrivateOrLocalHost, parseIpv4ToUint32, validateSafeUrl } from "../ssrf-guard.js";

/** Fixed seed and 1,000 runs per property, so failures are reproducible in CI. */
const RUNS = { numRuns: 1000, seed: 20261113 } as const;

/** Private, loopback, link-local and CGNAT ranges as [first address, prefix length]. */
const BLOCKED_V4: ReadonlyArray<readonly [number, number]> = [
  [0x0a000000, 8], // 10.0.0.0/8
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16 (cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0x64400000, 10], // 100.64.0.0/10
  [0x00000000, 8] // 0.0.0.0/8
];

const blockedIpv4 = fc
  .tuple(fc.constantFrom(...BLOCKED_V4), fc.nat())
  .map(([[base, prefix], rnd]) => (base + (rnd % 2 ** (32 - prefix))) >>> 0);

const toDotted = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 0xff).join(".");
const toHex = (n: number) => `0x${n.toString(16)}`;
const toOctalDotted = (n: number) =>
  [24, 16, 8, 0].map((s) => `0${((n >>> s) & 0xff).toString(8)}`).join(".");

describe("fuzz: SSRF guard", () => {
  it("blocks every private IPv4 address in dotted, integer, hex and octal notation", () => {
    fc.assert(
      fc.property(
        blockedIpv4,
        fc.constantFrom(toDotted, (n: number) => String(n), toHex, toOctalDotted),
        fc.constantFrom("http", "https"),
        fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
        (ip, notation, scheme, port) => {
          const host = notation(ip);
          expect(parseIpv4ToUint32(host)).toBe(ip);
          expect(isPrivateOrLocalHost(host)).toBe(true);
          const url = `${scheme}://${host}${port ? `:${port}` : ""}/pfad`;
          expect(validateSafeUrl(url).valid).toBe(false);
        }
      ),
      RUNS
    );
  });

  it("rejects every scheme other than http and https", () => {
    const scheme = fc
      .stringMatching(/^[a-z][a-z0-9+.-]{0,10}$/)
      .filter((s) => s !== "http" && s !== "https");
    fc.assert(
      fc.property(scheme, (s) => {
        expect(validateSafeUrl(`${s}://example.com/datei`).valid).toBe(false);
      }),
      RUNS
    );
  });

  it("rejects credentials in the URL", () => {
    const part = fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/);
    fc.assert(
      fc.property(part, fc.option(part, { nil: undefined }), (user, pass) => {
        const auth = pass ? `${user}:${pass}` : user;
        expect(validateSafeUrl(`https://${auth}@example.com/`).valid).toBe(false);
      }),
      RUNS
    );
  });

  it("never throws and only accepts http(s) URLs for arbitrary input", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.webUrl({ withQueryParameters: true })), (raw) => {
        const result = validateSafeUrl(raw);
        if (result.valid) {
          expect(["http:", "https:"]).toContain(result.url?.protocol);
          expect(isPrivateOrLocalHost(result.url?.hostname ?? "")).toBe(false);
        } else {
          expect(typeof result.reason).toBe("string");
        }
      }),
      RUNS
    );
  });
});
