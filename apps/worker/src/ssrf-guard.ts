export interface SafeUrlResult {
  readonly valid: boolean;
  readonly url?: URL;
  readonly reason?: string;
}

/**
 * Checks if a string is a standard or integer/octal/hex representation of IPv4.
 * Returns the numeric 32-bit unsigned integer if valid IPv4, or null otherwise.
 */
export function parseIpv4ToUint32(host: string): number | null {
  const trimmed = host.trim().toLowerCase();

  // 1. Single integer / hex / octal format (e.g. 2130706433, 0x7f000001, 0177.0.0.1)
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    const val = Number.parseInt(trimmed, 16);
    return val > 0xffffffff ? null : val >>> 0;
  }

  if (/^\d+$/.test(trimmed)) {
    const val =
      trimmed.startsWith("0") && trimmed.length > 1
        ? Number.parseInt(trimmed, 8)
        : Number.parseInt(trimmed, 10);
    return val > 0xffffffff ? null : val >>> 0;
  }

  // 2. Dotted format (1 to 4 parts)
  const parts = trimmed.split(".");
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }

  if (parts.length === 1) {
    return null;
  }

  const values: number[] = [];
  for (const part of parts) {
    if (!part) return null;
    let num: number;
    if (part.startsWith("0x") || part.startsWith("0X")) {
      num = Number.parseInt(part.slice(2), 16);
    } else if (part.startsWith("0") && part.length > 1) {
      num = Number.parseInt(part, 8);
    } else if (/^\d+$/.test(part)) {
      num = Number.parseInt(part, 10);
    } else {
      return null;
    }
    values.push(num);
  }

  const v0 = values[0] as number;
  const v1 = values[1] as number;
  const v2 = values[2] as number;
  const v3 = values[3] as number;

  if (values.length === 4) {
    if (v0 > 255 || v1 > 255 || v2 > 255 || v3 > 255) {
      return null;
    }
    return ((v0 << 24) | (v1 << 16) | (v2 << 8) | v3) >>> 0;
  }

  if (values.length === 3) {
    if (v0 > 255 || v1 > 255 || v2 > 0xffff) {
      return null;
    }
    return ((v0 << 24) | (v1 << 16) | v2) >>> 0;
  }

  // values.length === 2
  if (v0 > 255 || v1 > 0xffffff) {
    return null;
  }
  return ((v0 << 24) | v1) >>> 0;
}

/**
 * Checks if a 32-bit IPv4 address belongs to a private, loopback, link-local, or reserved range.
 */
export function isPrivateOrReservedIpv4(ipNum: number): boolean {
  const b0 = (ipNum >>> 24) & 0xff;
  const b1 = (ipNum >>> 16) & 0xff;

  // 0.0.0.0/8 (Current network / default route)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private-Use RFC 1918)
  if (b0 === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-Local, AWS/Cloud Metadata 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private-Use RFC 1918: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && ((ipNum >>> 8) & 0xff) === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 0 && ((ipNum >>> 8) & 0xff) === 2) return true;

  // 192.168.0.0/16 (Private-Use RFC 1918)
  if (b0 === 192 && b1 === 168) return true;

  // 198.18.0.0/15 (Benchmarking)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 198 && b1 === 51 && ((ipNum >>> 8) & 0xff) === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (b0 === 203 && b1 === 0 && ((ipNum >>> 8) & 0xff) === 113) return true;

  // 224.0.0.0/4 (Multicast 224-239)
  if (b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future Use / 255.255.255.255 Broadcast)
  if (b0 >= 240) return true;

  return false;
}

/**
 * Parses an IPv6 address string into 8 16-bit segments, or returns null if invalid.
 */
export function parseIpv6(host: string): number[] | null {
  let cleanHost = host.trim().toLowerCase();
  if (cleanHost.startsWith("[") && cleanHost.endsWith("]")) {
    cleanHost = cleanHost.slice(1, -1);
  }

  // Zone identifiers (e.g. %eth0)
  const zoneIndex = cleanHost.indexOf("%");
  if (zoneIndex !== -1) {
    cleanHost = cleanHost.slice(0, zoneIndex);
  }

  // Check for IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
  const lastColon = cleanHost.lastIndexOf(":");
  const afterLastColon = cleanHost.slice(lastColon + 1);
  if (afterLastColon.includes(".")) {
    const embeddedIpv4Val = parseIpv4ToUint32(afterLastColon);
    if (embeddedIpv4Val === null) {
      return null;
    }
    const high16 = ((embeddedIpv4Val >>> 16) & 0xffff).toString(16);
    const low16 = (embeddedIpv4Val & 0xffff).toString(16);
    cleanHost = `${cleanHost.slice(0, lastColon)}:${high16}:${low16}`;
  }

  const parts = cleanHost.split("::");
  if (parts.length > 2) {
    return null;
  }

  const leftSegments: number[] = [];
  const rightSegments: number[] = [];

  if (parts[0]) {
    const leftStrings = parts[0].split(":");
    for (const s of leftStrings) {
      if (!s || !/^[0-9a-f]{1,4}$/i.test(s)) return null;
      leftSegments.push(Number.parseInt(s, 16));
    }
  }

  if (parts.length === 2 && parts[1]) {
    const rightStrings = parts[1].split(":");
    for (const s of rightStrings) {
      if (!s || !/^[0-9a-f]{1,4}$/i.test(s)) return null;
      rightSegments.push(Number.parseInt(s, 16));
    }
  }

  if (parts.length === 1) {
    if (leftSegments.length !== 8) return null;
    return leftSegments;
  }

  const totalSpecified = leftSegments.length + rightSegments.length;
  if (totalSpecified > 7) return null;

  const zeroesToInsert = 8 - totalSpecified;
  const full: number[] = [...leftSegments, ...new Array(zeroesToInsert).fill(0), ...rightSegments];

  return full;
}

/**
 * Checks if parsed 8-word IPv6 segments belong to private, loopback, or reserved range.
 */
export function isPrivateOrReservedIpv6(segments: number[]): boolean {
  if (segments.length !== 8) return true;

  const s0 = segments[0] as number;
  const s1 = segments[1] as number;
  const s2 = segments[2] as number;
  const s3 = segments[3] as number;
  const s4 = segments[4] as number;
  const s5 = segments[5] as number;
  const s6 = segments[6] as number;
  const s7 = segments[7] as number;

  // ::1 (Loopback)
  if (
    s0 === 0 &&
    s1 === 0 &&
    s2 === 0 &&
    s3 === 0 &&
    s4 === 0 &&
    s5 === 0 &&
    s6 === 0 &&
    s7 === 1
  ) {
    return true;
  }

  // :: (Unspecified address 0::0)
  if (
    s0 === 0 &&
    s1 === 0 &&
    s2 === 0 &&
    s3 === 0 &&
    s4 === 0 &&
    s5 === 0 &&
    s6 === 0 &&
    s7 === 0
  ) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:0:0/96 or ::ffff:a.b.c.d)
  if (s0 === 0 && s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0 && s5 === 0xffff) {
    const ipv4Val = ((s6 << 16) | s7) >>> 0;
    return isPrivateOrReservedIpv4(ipv4Val);
  }

  // IPv4-compatible (deprecated, ::a.b.c.d): embedded IPv4 decides
  if (s0 === 0 && s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0 && s5 === 0) {
    return isPrivateOrReservedIpv4(((s6 << 16) | s7) >>> 0);
  }

  // NAT64 well-known prefix 64:ff9b::/96: embedded IPv4 decides
  if (s0 === 0x64 && s1 === 0xff9b && s2 === 0 && s3 === 0 && s4 === 0 && s5 === 0) {
    return isPrivateOrReservedIpv4(((s6 << 16) | s7) >>> 0);
  }

  // NAT64 local-use 64:ff9b:1::/48 (RFC 8215)
  if (s0 === 0x64 && s1 === 0xff9b && s2 === 1) {
    return true;
  }

  // 6to4 2002::/16: embedded IPv4 in segments 1 and 2
  if (s0 === 0x2002) {
    return isPrivateOrReservedIpv4(((s1 << 16) | s2) >>> 0);
  }

  // Teredo 2001:0::/32 tunnels to arbitrary IPv4 targets
  if (s0 === 0x2001 && s1 === 0) {
    return true;
  }

  // Unique Local Address (ULA) fc00::/7 (fc00::/8 and fd00::/8)
  if ((s0 & 0xfe00) === 0xfc00) {
    return true;
  }

  // Link-Local Unicast fe80::/10 (fe80:: to febf::)
  if ((s0 & 0xffc0) === 0xfe80) {
    return true;
  }

  // Site-Local Unicast fec0::/10 (Deprecated RFC 3879)
  if ((s0 & 0xffc0) === 0xfec0) {
    return true;
  }

  // Multicast ff00::/8
  if ((s0 & 0xff00) === 0xff00) {
    return true;
  }

  // Discard Prefix 100::/64
  if (s0 === 0x0100 && s1 === 0 && s2 === 0 && s3 === 0) {
    return true;
  }

  // Documentation 2001:db8::/32
  if (s0 === 0x2001 && s1 === 0x0db8) {
    return true;
  }

  return false;
}

/**
 * Checks if a hostname or IP string represents a private / local / loopback / metadata target.
 */
export function isPrivateOrLocalHost(host: string): boolean {
  let cleanHost = host.trim().toLowerCase();

  // Strip brackets and port if IPv6 literal like [::1]:8080 or [::1]
  if (cleanHost.startsWith("[")) {
    const closingBracket = cleanHost.indexOf("]");
    cleanHost = cleanHost.slice(1, closingBracket);
  } else if (cleanHost.includes(":") && !cleanHost.includes("::")) {
    // Strip port if IPv4 or hostname with port (e.g. 127.0.0.1:8080, localhost:3000)
    const lastColon = cleanHost.lastIndexOf(":");
    cleanHost = cleanHost.slice(0, lastColon);
  }

  // 1. Known localhost names & cloud metadata hostnames
  if (
    cleanHost === "localhost" ||
    cleanHost === "localhost.localdomain" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost === "metadata.google.internal" ||
    cleanHost === "metadata" ||
    cleanHost === "instance-data"
  ) {
    return true;
  }

  // 2. Check if host is an IPv4 address (standard, hex, octal, or integer)
  const ipv4Num = parseIpv4ToUint32(cleanHost);
  if (ipv4Num !== null) {
    return isPrivateOrReservedIpv4(ipv4Num);
  }

  // 3. Check if host is an IPv6 address
  const ipv6Segments = parseIpv6(cleanHost);
  if (ipv6Segments !== null) {
    return isPrivateOrReservedIpv6(ipv6Segments);
  }

  return false;
}

/**
 * Validates a URL against SSRF vulnerabilities:
 * - Only http: and https: protocols allowed
 * - Blocks file:, ftp:, gopher:, javascript:, data:, etc.
 * - Disallows credentials (username / password in URL)
 * - Blocks localhost, private IPv4/IPv6, metadata endpoints (169.254.169.254, ::1, etc.)
 */
export function validateSafeUrl(rawUrl: string): SafeUrlResult {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { valid: false, reason: "URL darf nicht leer sein." };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: "Ungültiges URL-Format." };
  }

  // Protocol check
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      reason: `Protokoll '${parsed.protocol}' ist nicht erlaubt. Nur 'http:' und 'https:' sind zulässig.`
    };
  }

  // Credentials check (no user:pass@host)
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      reason: "URLs mit Benutzerauthentifizierung (Benutzername/Passwort) sind nicht erlaubt."
    };
  }

  // Host SSRF check
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return {
      valid: false,
      reason: `Zugriff auf Host '${parsed.hostname}' ist aus Sicherheitsgründen blockiert (SSRF-Schutz).`
    };
  }

  return { valid: true, url: parsed };
}

export interface SafeFetchOptions {
  readonly maxRedirects?: number;
  readonly maxByteSize?: number;
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
  readonly customFetch?: typeof fetch;
}

export interface SafeFetchResponse {
  readonly status: number;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly buffer: Uint8Array;
}

export class SsrSecurityError extends Error {
  constructor(
    message: string,
    readonly code = "SSRF_DETECTED"
  ) {
    super(message);
    this.name = "SsrSecurityError";
  }
}

export class StreamTooLargeError extends Error {
  constructor(
    message: string,
    readonly limit: number
  ) {
    super(message);
    this.name = "StreamTooLargeError";
  }
}

/**
 * Safe fetch function that:
 * - Validates the initial URL against SSRF
 * - Follows redirects manually (up to maxRedirects, default 3), validating every hop
 * - Enforces streaming response size limit (e.g. max 10 MB)
 * - Enforces timeout
 */
export async function safeFetchWithGuard(
  targetUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const maxRedirects = options.maxRedirects ?? 3;
  const maxByteSize = options.maxByteSize ?? 10 * 1024 * 1024; // 10 MB
  const timeoutMs = options.timeoutMs ?? 15000; // 15 seconds
  const fetchFn = options.customFetch ?? fetch;

  let currentUrl = targetUrl;
  let redirectCount = 0;

  while (true) {
    const validation = validateSafeUrl(currentUrl);
    if (!validation.valid || !validation.url) {
      throw new SsrSecurityError(validation.reason as string);
    }

    const controller = new AbortController();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await fetchFn(validation.url.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "NotebookLM-Clone-URLImporter/1.0",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          ...(options.headers ?? {})
        },
        redirect: "manual",
        signal: AbortSignal.any([controller.signal, timeoutSignal])
      });
    } catch (err: unknown) {
      if (err instanceof SsrSecurityError || err instanceof StreamTooLargeError) {
        throw err;
      }
      throw new Error(
        (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError"
          ? `Zeitüberschreitung beim Laden der URL (${timeoutMs}ms).`
          : (err as Error).message
      );
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (isRedirect) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new SsrSecurityError(
          `Maximale Anzahl von ${maxRedirects} Redirects überschritten.`,
          "MAX_REDIRECTS_EXCEEDED"
        );
      }

      const location = response.headers.get("location");
      if (!location) {
        throw new SsrSecurityError("Redirect ohne Location-Header empfangen.");
      }

      try {
        const nextUrl = new URL(location, currentUrl);
        currentUrl = nextUrl.toString();
      } catch {
        throw new SsrSecurityError(`Ungültige Redirect-URL empfangen: '${location}'`);
      }
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `HTTP-Anfrage fehlgeschlagen mit Status ${response.status} (${response.statusText}).`
      );
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredLength = Number.parseInt(contentLengthHeader, 10);
      if (declaredLength > maxByteSize) {
        throw new StreamTooLargeError(
          `Dateigröße (${Math.round(declaredLength / 1024 / 1024)} MB) überschreitet das Limit von ${Math.round(maxByteSize / 1024 / 1024)} MB.`,
          maxByteSize
        );
      }
    }

    const body = response.body;
    let buffer: Uint8Array;

    if (!body) {
      buffer = new Uint8Array(0);
    } else {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (totalBytes > maxByteSize) {
            await reader.cancel("Size limit exceeded");
            throw new StreamTooLargeError(
              `Dateigröße überschreitet das Limit von ${Math.round(maxByteSize / 1024 / 1024)} MB.`,
              maxByteSize
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      buffer = combined;
    }

    const contentType = response.headers.get("content-type") ?? "text/html";

    return {
      status: response.status,
      finalUrl: currentUrl,
      contentType,
      buffer
    };
  }
}
