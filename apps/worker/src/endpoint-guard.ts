/**
 * Schutz für nutzereigene KI-Endpunkte (BYOM, Issue #247).
 *
 * Nutzer können einen OpenAI-kompatiblen Endpunkt (z. B. RelationFlow) hinterlegen. Der Worker
 * ruft diese Adresse serverseitig auf, deshalb gelten strengere Regeln als beim URL-Import:
 *
 * 1. Nur `https:`, keine Zugangsdaten in der URL, kein Query-String, kein Fragment, nur Port 443.
 * 2. Der Host muss auf der Allowlist des Betreibers stehen (`BYOM_ALLOWED_HOSTS`, kommagetrennt,
 *    `*.example.com` erlaubt Subdomains). Leere Allowlist = Funktion gesperrt (fail closed).
 * 3. Host darf keine private, lokale oder reservierte Adresse sein (bestehender SSRF-Schutz).
 * 4. DNS-Prüfung vor jedem Aufruf: alle A/AAAA-Einträge müssen öffentlich sein (gegen
 *    DNS-Rebinding auf interne Adressen). Schlägt die Auflösung fehl, wird blockiert.
 * 5. Weiterleitungen werden nie verfolgt (`redirect: "manual"`, jede 3xx-Antwort = Fehler).
 * 6. Zeitlimit je Aufruf.
 *
 * Restrisiko: Zwischen DNS-Prüfung und eigentlichem Verbindungsaufbau kann sich die Auflösung
 * theoretisch ändern (TOCTOU). Die Allowlist begrenzt das auf Domains, denen der Betreiber vertraut;
 * auf Cloudflare Workers sind private Netze zudem nicht über `fetch` erreichbar.
 */

import {
  SsrSecurityError,
  isPrivateOrLocalHost,
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  parseIpv4ToUint32,
  parseIpv6
} from "./ssrf-guard.js";

export const BYOM_ALLOWLIST_ENV = "BYOM_ALLOWED_HOSTS";
export const DEFAULT_ENDPOINT_TIMEOUT_MS = 30_000;
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

/** Löst einen Hostnamen in IP-Adressen auf. */
export type HostResolver = (host: string) => Promise<readonly string[]>;

export interface EndpointValidation {
  readonly valid: boolean;
  readonly url?: URL;
  readonly reason?: string;
  readonly code?: string;
}

/** Liest die Allowlist aus einem kommagetrennten Wert (Groß-/Kleinschreibung egal). */
export function parseHostAllowlist(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Prüft einen Host gegen die Allowlist. `*.example.com` passt nur auf echte Subdomains. */
export function isHostAllowed(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowlist.some((entry) => {
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      return h.endsWith(suffix) && h.length > suffix.length;
    }
    return h === entry;
  });
}

/** Statische Prüfung einer Endpunkt-Basis-URL (ohne Netzwerkzugriff). */
export function validateUserEndpoint(
  rawUrl: string,
  allowlist: readonly string[]
): EndpointValidation {
  if (allowlist.length === 0) {
    return {
      valid: false,
      code: "BYOM_DISABLED",
      reason: "Eigene Endpunkte sind auf diesem Server nicht freigeschaltet (Allowlist leer)."
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, code: "ENDPOINT_INVALID", reason: "Ungültiges URL-Format." };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, code: "ENDPOINT_NOT_HTTPS", reason: "Nur HTTPS-Adressen sind erlaubt." };
  }
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      code: "ENDPOINT_CREDENTIALS",
      reason: "Zugangsdaten in der URL sind nicht erlaubt."
    };
  }
  if (parsed.search || parsed.hash) {
    return {
      valid: false,
      code: "ENDPOINT_INVALID",
      reason: "Query-Parameter und Fragmente sind nicht erlaubt."
    };
  }
  // URL normalisiert ":443" bei https zu "", jeder gesetzte Port ist also ein anderer.
  if (parsed.port) {
    return {
      valid: false,
      code: "ENDPOINT_PORT",
      reason: "Nur der HTTPS-Standardport 443 ist erlaubt."
    };
  }
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return {
      valid: false,
      code: "SSRF_DETECTED",
      reason: "Private, lokale und reservierte Adressen sind gesperrt (SSRF-Schutz)."
    };
  }
  if (!isHostAllowed(parsed.hostname, allowlist)) {
    return {
      valid: false,
      code: "ENDPOINT_NOT_ALLOWED",
      reason: `Host '${parsed.hostname}' steht nicht auf der Allowlist.`
    };
  }
  return { valid: true, url: parsed };
}

/** true, wenn die IP-Adresse privat, lokal oder reserviert ist (oder nicht parsebar). */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseIpv4ToUint32(ip);
  if (v4 !== null) return isPrivateOrReservedIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6 !== null) return isPrivateOrReservedIpv6(v6);
  return true;
}

interface DohAnswer {
  readonly type: number;
  readonly data: string;
}

/** Standard-Resolver über DNS-over-HTTPS (JSON-API), liefert A- und AAAA-Einträge. */
export function createDohResolver(fetchFn: typeof fetch = fetch): HostResolver {
  return async (host: string) => {
    const addresses: string[] = [];
    for (const type of ["A", "AAAA"]) {
      const res = await fetchFn(`${DOH_ENDPOINT}?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (!res.ok) throw new Error(`DNS-Abfrage fehlgeschlagen (${res.status}).`);
      const body = (await res.json()) as { Answer?: DohAnswer[] };
      for (const answer of body.Answer ?? []) {
        if (answer.type === 1 || answer.type === 28) addresses.push(answer.data);
      }
    }
    return addresses;
  };
}

/** Löst den Host auf und wirft, wenn keine oder eine nicht öffentliche Adresse dabei ist. */
export async function assertHostResolvesPublic(
  host: string,
  resolver: HostResolver
): Promise<void> {
  // IP-Literale wurden statisch geprüft; nur Namen werden aufgelöst.
  if (parseIpv4ToUint32(host) !== null || parseIpv6(host) !== null) return;

  let addresses: readonly string[];
  try {
    addresses = await resolver(host);
  } catch {
    throw new SsrSecurityError("DNS-Auflösung fehlgeschlagen.", "DNS_FAILED");
  }
  if (addresses.length === 0) {
    throw new SsrSecurityError("Host hat keine DNS-Einträge.", "DNS_FAILED");
  }
  if (addresses.some(isBlockedIp)) {
    throw new SsrSecurityError(
      "Host löst auf eine private oder reservierte Adresse auf (DNS-Rebinding-Schutz).",
      "SSRF_DETECTED"
    );
  }
}

export interface GuardedFetchOptions {
  readonly allowlist: readonly string[];
  readonly resolver: HostResolver;
  readonly fetchFn: typeof fetch;
  readonly timeoutMs?: number | undefined;
}

/**
 * Ruft eine Adresse unterhalb eines geprüften Endpunkts auf. Jede Prüfung läuft bei jedem Aufruf
 * erneut, Weiterleitungen werden abgelehnt.
 */
export async function guardedEndpointFetch(
  url: string,
  init: RequestInit,
  options: GuardedFetchOptions
): Promise<Response> {
  const validation = validateUserEndpoint(url, options.allowlist);
  if (!validation.valid || !validation.url) {
    throw new SsrSecurityError(validation.reason as string, validation.code);
  }
  await assertHostResolvesPublic(validation.url.hostname, options.resolver);

  // Zeitlimit nur bis die Antwort-Header da sind; das Lesen des Bodys (Streams) begrenzt der
  // Aufrufer über sein eigenes Signal bzw. ein Leerlauf-Limit je Chunk.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Zeitüberschreitung beim Endpunkt.", "TimeoutError")),
    options.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS
  );
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  let response: Response;
  try {
    response = await options.fetchFn(validation.url.toString(), {
      ...init,
      redirect: "manual",
      signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new SsrSecurityError(
      "Weiterleitungen sind für eigene Endpunkte gesperrt.",
      "REDIRECT_BLOCKED"
    );
  }
  return response;
}

/**
 * Entfernt einen Schlüssel aus Fehlertexten und kürzt sie. Manche Anbieter wiederholen den
 * gesendeten Schlüssel in Fehlermeldungen; der darf nie in Logs oder Antworten landen.
 */
export function redactSecret(text: string, secret: string | undefined, maxLength = 200): string {
  let out = text;
  if (secret && secret.length >= 4) {
    out = out.split(secret).join("[redacted]");
  }
  // Typische Schlüsselformen zusätzlich entfernen (sk-…, Bearer …)
  out = out.replace(/\b(sk|gsk|rf)[-_][A-Za-z0-9_-]{8,}/g, "[redacted]");
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}
