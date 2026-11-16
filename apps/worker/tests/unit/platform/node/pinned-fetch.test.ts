import type { LookupAddress } from "node:dns";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createPinnedFetch,
  createPinnedLookup,
  type HttpsRequestFn,
  type LookupAll
} from "@/platform/node/pinned-fetch.js";
import { SsrSecurityError } from "@/security/ssrf-guard.js";

interface LookupResult {
  readonly err: NodeJS.ErrnoException | null;
  readonly address: string | LookupAddress[];
  readonly family: number | undefined;
}

function runLookup(
  lookup: LookupFunction,
  hostname: string,
  options: { all?: boolean } = {}
): Promise<LookupResult> {
  return new Promise((resolve) => {
    lookup(hostname, options, (err, address, family) => resolve({ err, address, family }));
  });
}

const answer =
  (addresses: LookupAddress[], err: NodeJS.ErrnoException | null = null): LookupAll =>
  (_hostname, callback) =>
    callback(err, addresses);

describe("createPinnedLookup (DNS-Rebinding-Schutz im Node-Betrieb)", () => {
  it("gibt öffentliche Adressen als Liste zurück, wenn der Socket alle verlangt", async () => {
    const addresses = [
      { address: "93.184.215.14", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 }
    ];
    const result = await runLookup(createPinnedLookup(answer(addresses)), "api.example", {
      all: true
    });
    expect(result.err).toBeNull();
    expect(result.address).toEqual(addresses);
  });

  it("gibt sonst die erste öffentliche Adresse mit Familie zurück", async () => {
    const lookup = createPinnedLookup(answer([{ address: "2606:4700:4700::1111", family: 6 }]));
    const result = await runLookup(lookup, "api.example");
    expect(result).toEqual({ err: null, address: "2606:4700:4700::1111", family: 6 });
  });

  it("sperrt, sobald eine einzige Adresse privat oder reserviert ist", async () => {
    const lookup = createPinnedLookup(
      answer([
        { address: "93.184.215.14", family: 4 },
        { address: "169.254.169.254", family: 4 }
      ])
    );
    const result = await runLookup(lookup, "rebind.example", { all: true });
    expect(result.err).toBeInstanceOf(SsrSecurityError);
    expect((result.err as SsrSecurityError).code).toBe("SSRF_DETECTED");
  });

  it("sperrt bei leerer Antwort", async () => {
    const result = await runLookup(createPinnedLookup(answer([])), "leer.example");
    expect(result.err).toBeInstanceOf(SsrSecurityError);
  });

  it("reicht Fehler der Auflösung durch (fail-closed)", async () => {
    const failure = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    const result = await runLookup(createPinnedLookup(answer([], failure)), "fehlt.example");
    expect(result.err).toBe(failure);
  });

  it("nutzt ohne Vorgabe den System-Resolver und sperrt localhost", async () => {
    const result = await runLookup(createPinnedLookup(), "localhost", { all: true });
    expect(result.err).toBeInstanceOf(SsrSecurityError);
  });
});

class FakeRequest extends EventEmitter {
  readonly written: string[] = [];
  ended = false;
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
  end(): this {
    this.ended = true;
    return this;
  }
}

interface FakeServer {
  readonly requestFn: HttpsRequestFn;
  readonly calls: { url: URL; options: RequestOptions; req: FakeRequest }[];
}

function fakeServer(status: number, body: string, rawHeaders: string[] = []): FakeServer {
  const calls: FakeServer["calls"] = [];
  const requestFn: HttpsRequestFn = (url, options, callback) => {
    const req = new FakeRequest();
    calls.push({ url, options, req });
    setImmediate(() => {
      const res = Object.assign(Readable.from([Buffer.from(body)]), {
        statusCode: status,
        rawHeaders
      });
      callback(res as unknown as IncomingMessage);
    });
    return req as unknown as ClientRequest;
  };
  return { requestFn, calls };
}

const fixedLookup: LookupFunction = createPinnedLookup(
  answer([{ address: "93.184.215.14", family: 4 }])
);

describe("createPinnedFetch", () => {
  it("sendet Text-Body mit Länge, Kopfzeilen, Signal und der prüfenden lookup-Funktion", async () => {
    const server = fakeServer(200, '{"ok":true}', ["Content-Type", "application/json"]);
    const pinned = createPinnedFetch({ lookup: fixedLookup, requestFn: server.requestFn });
    const controller = new AbortController();

    const res = await pinned("https://api.example/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer test", "content-type": "application/json" },
      body: '{"a":"ä"}',
      signal: controller.signal
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
    const call = server.calls[0];
    expect(call?.url.toString()).toBe("https://api.example/v1/chat/completions");
    expect(call?.options.method).toBe("POST");
    expect(call?.options.lookup).toBe(fixedLookup);
    expect(call?.options.signal).toBe(controller.signal);
    expect(call?.options.headers).toEqual({
      authorization: "Bearer test",
      "content-type": "application/json",
      "content-length": "10"
    });
    expect(call?.req.written).toEqual(['{"a":"ä"}']);
    expect(call?.req.ended).toBe(true);
  });

  it("nutzt GET ohne Body und liefert bei 204 eine Antwort ohne Body", async () => {
    const server = fakeServer(204, "");
    const pinned = createPinnedFetch({ lookup: fixedLookup, requestFn: server.requestFn });

    const res = await pinned(new URL("https://api.example/v1/models"));

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    const call = server.calls[0];
    expect(call?.options.method).toBe("GET");
    expect(call?.options.signal).toBeUndefined();
    expect(call?.options.headers).toEqual({});
    expect(call?.req.written).toEqual([]);
  });

  it("lehnt andere Protokolle als HTTPS ab, ohne eine Verbindung aufzubauen", async () => {
    const server = fakeServer(200, "");
    const pinned = createPinnedFetch({ lookup: fixedLookup, requestFn: server.requestFn });
    await expect(pinned("http://api.example/v1")).rejects.toThrow(TypeError);
    expect(server.calls).toHaveLength(0);
  });

  it("lehnt Bodys ab, die kein Text sind", async () => {
    const server = fakeServer(200, "");
    const pinned = createPinnedFetch({ lookup: fixedLookup, requestFn: server.requestFn });
    await expect(
      pinned("https://api.example/v1", { method: "POST", body: new Uint8Array([1, 2]) })
    ).rejects.toThrow(TypeError);
    expect(server.calls).toHaveLength(0);
  });

  it("reicht Verbindungsfehler als abgelehnte Zusage weiter", async () => {
    const failing: HttpsRequestFn = () => {
      const req = new FakeRequest();
      setImmediate(() => req.emit("error", new Error("ECONNRESET")));
      return req as unknown as ClientRequest;
    };
    const pinned = createPinnedFetch({ lookup: fixedLookup, requestFn: failing });
    await expect(pinned("https://api.example/v1")).rejects.toThrow("ECONNRESET");
  });

  it("baut mit den Standardwerten keine Verbindung zu localhost auf", async () => {
    const pinned = createPinnedFetch();
    await expect(pinned("https://localhost/v1/models")).rejects.toBeInstanceOf(SsrSecurityError);
  });
});
