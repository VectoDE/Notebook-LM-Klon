import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC } from "@notebook-lm/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { c2paSignerFromVars } from "../node/c2pa-signer.js";
import { registerProvenanceRoutes } from "../provenance-routes.js";

/**
 * Echte C2PA-Signatur mit dem offiziellen c2patool (Issue #353).
 *
 * Läuft nur, wenn C2PATOOL_PATH, C2PA_SIGN_CERT, C2PA_PRIVATE_KEY und C2PA_TRUST_ANCHORS
 * gesetzt sind (CI-Job "C2PA-Herkunftsnachweis"). Zertifikat und Schlüssel sind das
 * öffentliche Testzertifikat aus contentauth/c2pa-rs, die Vertrauensanker liegen dem
 * c2patool-Release bei. Nichts davon liegt im Repository.
 */
const env = process.env;
const configured = Boolean(
  env.C2PATOOL_PATH && env.C2PA_SIGN_CERT && env.C2PA_PRIVATE_KEY && env.C2PA_TRUST_ANCHORS
);
const FIXTURES = resolve(process.cwd(), "apps/worker/src/__tests__/fixtures/c2pa");

interface ToolResult {
  code: number;
  stdout: string;
  stderr: string;
}

function tool(args: string[], cwd?: string): Promise<ToolResult> {
  return new Promise((done) => {
    execFile(
      env.C2PATOOL_PATH as string,
      args,
      { cwd, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        done({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
      }
    );
  });
}

describe.skipIf(!configured)("C2PA mit c2patool (Issue #353)", () => {
  let work: string;
  const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "c2pa-it-"));
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "u_ci" });
      await next();
    });
    registerProvenanceRoutes(app, {
      resolveSigner: () => c2paSignerFromVars(env),
      signerUserIds: () => new Set(["u_ci"])
    });
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  async function signViaRoute(file: string, mimeType: string): Promise<Response> {
    return app.request(
      "/api/v1/provenance/sign?title=RelationNotes%20Export",
      {
        method: "POST",
        body: readFileSync(join(FIXTURES, file)),
        headers: { "content-type": mimeType }
      },
      {} as Env
    );
  }

  /** Liest das Manifest und prüft gegen die Vertrauensanker des c2patool-Releases. */
  async function verify(path: string): Promise<Record<string, unknown>> {
    const anchors = resolve(env.C2PA_TRUST_ANCHORS as string);
    // c2patool hält "C:/…" für eine URL; deshalb relativ aus dem Ordner der Anker aufrufen.
    const result = await tool(
      [path, "trust", "--trust_anchors", basename(anchors)],
      dirname(anchors)
    );
    expect(result.code, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }

  it.each([
    ["sample.png", "image/png"],
    ["sample.svg", "image/svg+xml"],
    ["sample.wav", "audio/wav"],
    ["sample.mp4", "video/mp4"]
  ])("signiert %s und c2patool bestätigt Vertrauen und KI-Herkunft", async (file, mimeType) => {
    const res = await signViaRoute(file, mimeType);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-c2pa-certificate")).toBe("test");
    const signed = join(work, `signed-${file}`);
    await writeFile(signed, new Uint8Array(await res.arrayBuffer()));

    const report = await verify(signed);
    expect(report.validation_state).toBe("Trusted");
    const manifests = report.manifests as Record<string, Record<string, unknown>>;
    const active = manifests[report.active_manifest as string] as Record<string, unknown>;
    expect(active.title).toBe("RelationNotes Export");
    expect(active.claim_generator_info).toEqual([
      expect.objectContaining({ name: "RelationNotes" })
    ]);
    expect(JSON.stringify(active.assertions)).toContain(DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC);
    expect(active.signature_info).toMatchObject({ issuer: "C2PA Test Signing Cert" });
  });

  it("weist WebM ab; c2patool selbst kann WebM weder einbetten noch als Sidecar signieren", async () => {
    const res = await signViaRoute("sample.webm", "video/webm");
    expect(res.status).toBe(415);

    const manifest = join(work, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        alg: "es256",
        sign_cert: resolve(env.C2PA_SIGN_CERT as string),
        private_key: resolve(env.C2PA_PRIVATE_KEY as string),
        title: "WebM"
      })
    );
    const input = join(FIXTURES, "sample.webm");
    const embedded = await tool([input, "-m", manifest, "-o", join(work, "x.webm"), "-f"]);
    expect(embedded.code).not.toBe(0);
    const sidecar = await tool([input, "-m", manifest, "-s", "-o", join(work, "x.c2pa"), "-f"]);
    expect(sidecar.code).not.toBe(0);
  });

  it("lässt eine signierte Datei nach einer Änderung durchfallen", async () => {
    const res = await signViaRoute("sample.wav", "audio/wav");
    const bytes = new Uint8Array(await res.arrayBuffer());
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] as number) ^ 0xff;
    const tampered = join(work, "tampered.wav");
    await writeFile(tampered, bytes);
    const anchors = resolve(env.C2PA_TRUST_ANCHORS as string);
    const result = await tool(
      [tampered, "trust", "--trust_anchors", basename(anchors)],
      dirname(anchors)
    );
    const report = JSON.parse(result.stdout || "{}") as { validation_state?: string };
    expect(report.validation_state).not.toBe("Trusted");
  });
});
