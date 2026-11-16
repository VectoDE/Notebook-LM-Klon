/**
 * `fetch` für eigene KI-Endpunkte im Node-Betrieb (BYOM, Issue #247) mit Schutz vor DNS-Rebinding.
 *
 * `guardedEndpointFetch` prüft den Namen vorab per DNS. Das Standard-`fetch` löst danach selbst noch
 * einmal auf; mit kurzer TTL kann ein Angreifer dazwischen auf eine interne Adresse umschalten
 * (TOCTOU). Hier läuft die Auflösung über die `lookup`-Option von `https.request`: Der Socket
 * verbindet sich nur mit den Adressen, die eben geprüft wurden. Liefert der Name auch nur eine
 * private, lokale oder reservierte Adresse, wird keine Verbindung aufgebaut.
 *
 * Weiterleitungen folgt `https.request` nicht; `guardedEndpointFetch` lehnt 3xx ab. Unterstützt
 * werden nur Text-Bodys, mehr braucht der OpenAI-kompatible Adapter nicht.
 */

import { type LookupAddress, lookup as dnsLookup } from "node:dns";
import type { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from "node:http";
import { type RequestOptions, request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { isBlockedIp } from "../endpoint-guard.js";
import { SsrSecurityError } from "../ssrf-guard.js";

/** Löst einen Namen in alle Adressen auf (Signatur wie `dns.lookup` mit `all: true`). */
export type LookupAll = (
  hostname: string,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
) => void;

/** Baut eine Anfrage auf (Signatur wie `https.request(url, options, callback)`). */
export type HttpsRequestFn = (
  url: URL,
  options: RequestOptions,
  callback: (res: IncomingMessage) => void
) => ClientRequest;

const systemLookupAll: LookupAll = (hostname, callback) => {
  dnsLookup(hostname, { all: true }, callback);
};

/** Statuswerte, deren Antwort laut Fetch-Standard keinen Body hat. */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * `lookup` für Sockets: löst auf, prüft jede Adresse und gibt nur dann Adressen zurück, wenn alle
 * öffentlich sind. Fehler der Auflösung werden durchgereicht (fail-closed).
 */
export function createPinnedLookup(lookupAll: LookupAll = systemLookupAll): LookupFunction {
  return (hostname, options, callback) => {
    lookupAll(hostname, (err, addresses) => {
      if (err) {
        callback(err, "", 0);
        return;
      }
      if (addresses.length === 0 || addresses.some((entry) => isBlockedIp(entry.address))) {
        callback(
          new SsrSecurityError(
            "Host löst auf eine private oder reservierte Adresse auf (DNS-Rebinding-Schutz).",
            "SSRF_DETECTED"
          ),
          "",
          0
        );
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0] as LookupAddress;
      callback(null, first.address, first.family);
    });
  };
}

export interface PinnedFetchOptions {
  readonly lookup?: LookupFunction | undefined;
  readonly requestFn?: HttpsRequestFn | undefined;
}

/** Liefert ein `fetch`, das nur HTTPS spricht und die Verbindung an geprüfte Adressen bindet. */
export function createPinnedFetch(options: PinnedFetchOptions = {}): typeof fetch {
  const lookup = options.lookup ?? createPinnedLookup();
  const requestFn: HttpsRequestFn = options.requestFn ?? httpsRequest;

  const pinnedFetch = (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    if (url.protocol !== "https:") {
      return Promise.reject(new TypeError("Nur HTTPS-Adressen sind erlaubt."));
    }
    const body = init.body ?? null;
    if (body !== null && typeof body !== "string") {
      return Promise.reject(new TypeError("Nur Text-Bodys werden unterstützt."));
    }

    const headers: OutgoingHttpHeaders = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    if (body !== null) {
      headers["content-length"] = String(Buffer.byteLength(body));
    }
    const requestOptions: RequestOptions = { method: init.method ?? "GET", headers, lookup };
    if (init.signal) {
      requestOptions.signal = init.signal as unknown as AbortSignal;
    }

    return new Promise<Response>((resolve, reject) => {
      const req = requestFn(url, requestOptions, (res) => {
        const responseHeaders = new Headers();
        for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
          responseHeaders.append(res.rawHeaders[i] as string, res.rawHeaders[i + 1] as string);
        }
        const status = res.statusCode as number;
        if (NULL_BODY_STATUS.has(status)) {
          res.resume();
          resolve(new Response(null, { status, headers: responseHeaders }));
          return;
        }
        const stream = Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>;
        resolve(new Response(stream, { status, headers: responseHeaders }));
      });
      req.on("error", reject);
      if (body !== null) {
        req.write(body);
      }
      req.end();
    });
  };

  return pinnedFetch as unknown as typeof fetch;
}
