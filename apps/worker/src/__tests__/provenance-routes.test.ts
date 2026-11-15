import { DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC } from "@notebook-lm/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  type ProvenanceSigner,
  registerProvenanceRoutes,
  signerFromEnv,
  signerUserIdsFromEnv
} from "../provenance-routes.js";
import { WORKER_VERSION } from "../version.js";

type App = Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

function fakeSigner(overrides: Partial<ProvenanceSigner> = {}): ProvenanceSigner & {
  sign: ReturnType<typeof vi.fn>;
} {
  return {
    certificate: "test",
    formats: ["image/png", "video/mp4"],
    sign: vi.fn(async (data: Uint8Array) => new Uint8Array([...data, 0xc2, 0x2a])),
    ...overrides
  } as ProvenanceSigner & { sign: ReturnType<typeof vi.fn> };
}

function buildApp(
  signer: ProvenanceSigner | undefined,
  options: {
    loggedIn?: boolean;
    maxBytes?: number;
    signerIds?: ReadonlySet<string>;
    audit?: (entry: unknown) => void;
    userId?: string;
  } = {}
) {
  const app: App = new Hono();
  if (options.loggedIn !== false) {
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: options.userId ?? "u_1" });
      await next();
    });
  }
  registerProvenanceRoutes(app, {
    resolveSigner: () => signer,
    maxBytes: options.maxBytes,
    signerUserIds: () => options.signerIds ?? new Set(["u_1"]),
    audit: options.audit
  });
  return app;
}

const ENV = {} as Env;

function sign(app: App, body: BodyInit | null, headers: Record<string, string>, query = "") {
  return app.request(`/api/v1/provenance/sign${query}`, { method: "POST", body, headers }, ENV);
}

describe("GET /api/v1/provenance/status (Issue #353)", () => {
  it("meldet Zertifikat und Formate, wenn ein Signierer eingerichtet ist", async () => {
    const res = await buildApp(fakeSigner(), { loggedIn: false }).request(
      "/api/v1/provenance/status",
      {},
      ENV
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      available: true,
      certificate: "test",
      formats: ["image/png", "video/mp4"]
    });
  });

  it("meldet offen, dass ohne Signierer nicht signiert wird", async () => {
    const res = await buildApp(undefined).request("/api/v1/provenance/status", {}, ENV);
    expect(await res.json()).toEqual({ available: false, certificate: null, formats: [] });
  });
});

describe("POST /api/v1/provenance/sign (Issue #353)", () => {
  it("verlangt eine Anmeldung", async () => {
    const res = await sign(buildApp(fakeSigner(), { loggedIn: false }), "x", {
      "content-type": "image/png"
    });
    expect(res.status).toBe(401);
  });

  it("antwortet 503, wenn kein Zertifikat eingerichtet ist (Workers)", async () => {
    const res = await sign(buildApp(undefined), "x", { "content-type": "image/png" });
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "PROVENANCE_NOT_CONFIGURED" });
  });

  it("lehnt WebM und fehlende Medienarten mit 415 ab", async () => {
    const signer = fakeSigner();
    const webm = await sign(buildApp(signer), "x", { "content-type": "video/webm;codecs=vp9" });
    expect(webm.status).toBe(415);
    const body = (await webm.json()) as { code: string; detail: string };
    expect(body.code).toBe("C2PA_FORMAT_UNSUPPORTED");
    expect(body.detail).toContain("'video/webm'");

    const none = await buildApp(signer).request("/api/v1/provenance/sign", { method: "POST" }, ENV);
    expect(none.status).toBe(415);
    expect(((await none.json()) as { detail: string }).detail).toContain("'unbekannt'");
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("lehnt zu große Dateien nach angegebener und tatsächlicher Größe ab", async () => {
    const signer = fakeSigner();
    const app = buildApp(signer, { maxBytes: 4 });
    const declared = await sign(app, "abc", {
      "content-type": "image/png",
      "content-length": "99"
    });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });

    const actual = await sign(app, new Uint8Array(5), { "content-type": "image/png" });
    expect(actual.status).toBe(413);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("nennt das Standardlimit von 64 MB", async () => {
    const res = await sign(buildApp(fakeSigner()), "x", {
      "content-type": "image/png",
      "content-length": String(65 * 1024 * 1024)
    });
    expect(((await res.json()) as { detail: string }).detail).toContain("64 MB");
  });

  it("lehnt leere Dateien ab", async () => {
    const res = await sign(buildApp(fakeSigner()), new Uint8Array(0), {
      "content-type": "image/png"
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "EMPTY_BODY" });
  });

  it("meldet 502 ohne interne Details, wenn das Signieren scheitert", async () => {
    const signer = fakeSigner({
      sign: vi.fn(async () => {
        throw new Error("/srv/keys/c2pa.key kaputt");
      })
    });
    const res = await sign(buildApp(signer), "x", { "content-type": "image/png" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("PROVENANCE_SIGN_FAILED");
    expect(text).not.toContain("/srv/keys");
  });

  it("gibt die signierte Datei mit Zertifikatsart zurück und baut das Manifest", async () => {
    const signer = fakeSigner({ certificate: "production" });
    const res = await sign(
      buildApp(signer),
      new Uint8Array([1, 2, 3]),
      { "content-type": "video/MP4; codecs=avc1" },
      "?title=Video%20Overview&ai=0"
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-c2pa-certificate")).toBe("production");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3, 0xc2, 0x2a]);
    const [data, mime, manifest] = signer.sign.mock.calls[0] as [
      Uint8Array,
      string,
      Record<string, unknown>
    ];
    expect([...data]).toEqual([1, 2, 3]);
    expect(mime).toBe("video/mp4");
    expect(manifest).toMatchObject({
      title: "Video Overview",
      format: "video/mp4",
      claim_generator_info: [{ name: "RelationNotes", version: WORKER_VERSION }]
    });
    expect(JSON.stringify(manifest)).toContain(DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC);
  });

  it("kennzeichnet ohne ai-Parameter als KI-erzeugt und setzt einen Ersatztitel", async () => {
    const signer = fakeSigner();
    await sign(buildApp(signer), "x", { "content-type": "image/png" });
    const manifest = signer.sign.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(manifest.title).toBe("Export");
    expect(JSON.stringify(manifest)).toContain(DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC);
  });
});

describe("POST /api/v1/provenance/sign: Freigabe, Protokoll, Größe (Sicherheitsbefund)", () => {
  it("verweigert Konten, die nicht auf der Freigabeliste stehen (403), ohne zu signieren", async () => {
    const signer = fakeSigner();
    const res = await sign(buildApp(signer, { signerIds: new Set(["u_other"]) }), "x", {
      "content-type": "image/png"
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PROVENANCE_FORBIDDEN" });
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("verweigert allen, wenn die Freigabeliste leer ist (fail closed)", async () => {
    const signer = fakeSigner();
    const res = await sign(buildApp(signer, { signerIds: new Set() }), "x", {
      "content-type": "image/png"
    });
    expect(res.status).toBe(403);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("protokolliert jede Signatur mit Konto, Format, Größe und Zertifikat", async () => {
    const entries: unknown[] = [];
    const signer = fakeSigner({ certificate: "production" });
    const res = await sign(
      buildApp(signer, { userId: "u_1", audit: (e) => entries.push(e) }),
      new Uint8Array([1, 2, 3]),
      { "content-type": "image/png" }
    );
    expect(res.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      event: "provenance.sign",
      userId: "u_1",
      mimeType: "image/png",
      bytes: 3,
      certificate: "production"
    });
  });

  it("kennzeichnet jede Signatur als KI-erzeugt, auch mit ai=0 vom Client", async () => {
    const signer = fakeSigner();
    await sign(buildApp(signer), "x", { "content-type": "image/png" }, "?ai=0");
    const manifest = signer.sign.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(JSON.stringify(manifest)).toContain(DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC);
  });

  it("begrenzt den Körper beim Lesen, auch ohne Content-Length", async () => {
    const signer = fakeSigner();
    const app = buildApp(signer, { maxBytes: 4 });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
        controller.close();
      }
    });
    const res = await app.request(
      "/api/v1/provenance/sign",
      {
        method: "POST",
        body: stream,
        headers: { "content-type": "image/png" },
        duplex: "half"
      } as RequestInit,
      ENV
    );
    expect(res.status).toBe(413);
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it("schreibt je Aufruf einen eigenen Audit-Eintrag", async () => {
    const entries: unknown[] = [];
    const app = buildApp(fakeSigner(), { audit: (e) => entries.push(e) });
    await sign(app, new Uint8Array([9]), { "content-type": "image/png" });
    await sign(app, new Uint8Array([9, 9]), { "content-type": "image/png" });
    expect(entries).toHaveLength(2);
  });
});

describe("signerUserIdsFromEnv", () => {
  it("liest die kommagetrennte Freigabeliste und ignoriert Leerzeichen", () => {
    expect([
      ...signerUserIdsFromEnv({ PROVENANCE_SIGN_USER_IDS: " u_1, u_2 ,," } as unknown as Env)
    ]).toEqual(["u_1", "u_2"]);
    expect(signerUserIdsFromEnv({} as Env).size).toBe(0);
    expect(signerUserIdsFromEnv({ PROVENANCE_SIGN_USER_IDS: 5 } as unknown as Env).size).toBe(0);
  });
});

describe("signerFromEnv", () => {
  it("nimmt nur einen Signierer mit sign-Funktion aus der Umgebung", () => {
    const signer = fakeSigner();
    expect(signerFromEnv({ PROVENANCE_SIGNER: signer } as unknown as Env)).toBe(signer);
    expect(signerFromEnv({} as Env)).toBeUndefined();
    expect(signerFromEnv({ PROVENANCE_SIGNER: { sign: "x" } } as unknown as Env)).toBeUndefined();
  });

  it("nutzt ohne Abhängigkeiten den Signierer der Umgebung", async () => {
    const app: App = new Hono();
    registerProvenanceRoutes(app);
    const res = await app.request("/api/v1/provenance/status", {}, {
      PROVENANCE_SIGNER: fakeSigner()
    } as unknown as Env);
    expect(((await res.json()) as { available: boolean }).available).toBe(true);
  });
});
