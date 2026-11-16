import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  C2PA_ENV_VARS,
  DEFAULT_SIGN_TIMEOUT_MS,
  ProvenanceSignError,
  c2paSignerFromVars,
  createC2paToolSigner
} from "../node/c2pa-signer.js";
import { PASSTHROUGH_VARS } from "../node/config.js";

/**
 * Der Signierer startet c2patool als eigenen Prozess. Hier ersetzt ein kleines Node-Skript das
 * Werkzeug: Es liest dieselben Argumente, schreibt die Eingabe samt Manifest in die Ausgabe
 * und scheitert bei dem Titel "fail". Die echte Signatur prüft c2pa-integration.test.ts.
 */
const FAKE_TOOL = `
const fs = require("node:fs");
const [input, , manifestPath, , output] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.title === "fail") process.exit(3);
fs.writeFileSync(output, JSON.stringify({ input, manifest, data: [...fs.readFileSync(input)] }));
`;

let dir: string;
let script: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "c2pa-fake-"));
  script = join(dir, "fake-c2patool.cjs");
  await writeFile(script, FAKE_TOOL);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function signer(options: Partial<Parameters<typeof createC2paToolSigner>[0]> = {}) {
  return createC2paToolSigner({
    command: process.execPath,
    commandArgs: [script],
    certPath: "certs/chain.pem",
    keyPath: "certs/key.pem",
    certificate: "test",
    ...options
  });
}

function decode(bytes: Uint8Array): {
  input: string;
  manifest: Record<string, unknown>;
  data: number[];
} {
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("createC2paToolSigner (Issue #353)", () => {
  it("ruft das Werkzeug mit Manifest, absoluten Schlüsselpfaden und Endung auf", async () => {
    const out = decode(
      await signer({ timeoutMs: 20_000 }).sign(new Uint8Array([7, 8]), "video/mp4;codecs=avc1", {
        title: "Video",
        claim_generator_info: [{ name: "RelationNotes", version: "1" }]
      })
    );
    expect(out.data).toEqual([7, 8]);
    expect(out.input.endsWith("input.mp4")).toBe(true);
    expect(out.manifest).toEqual({
      title: "Video",
      claim_generator_info: [{ name: "RelationNotes", version: "1" }],
      alg: "es256",
      sign_cert: resolve("certs/chain.pem"),
      private_key: resolve("certs/key.pem")
    });
    // Der Arbeitsordner mit der Kopie der Datei wird wieder gelöscht.
    expect(existsSync(out.input)).toBe(false);
  });

  it("übernimmt Algorithmus und Zeitstempeldienst", async () => {
    const out = decode(
      await signer({ algorithm: "ps256", timestampUrl: "http://timestamp.example" }).sign(
        new Uint8Array([1]),
        "image/svg+xml",
        { title: "Mindmap" }
      )
    );
    expect(out.input.endsWith("input.svg")).toBe(true);
    expect(out.manifest).toMatchObject({ alg: "ps256", ta_url: "http://timestamp.example" });
  });

  it("meldet Formate und Zertifikatsart", () => {
    const s = signer({ certificate: "production" });
    expect(s.certificate).toBe("production");
    expect(s.formats).toContain("video/mp4");
    expect(s.formats).not.toContain("video/webm");
    expect(DEFAULT_SIGN_TIMEOUT_MS).toBe(60_000);
  });

  it("lehnt nicht signierbare Formate vor dem Werkzeugaufruf ab", async () => {
    await expect(signer().sign(new Uint8Array([1]), "video/webm", {})).rejects.toThrow(
      ProvenanceSignError
    );
  });

  it("verbirgt Pfade, wenn das Werkzeug scheitert, und räumt auf", async () => {
    const error = await signer()
      .sign(new Uint8Array([1]), "image/png", { title: "fail" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProvenanceSignError);
    expect((error as Error).name).toBe("ProvenanceSignError");
    expect((error as Error).message).toBe("c2patool konnte die Datei nicht signieren.");
    expect((error as Error).message).not.toContain(dir);
  });
});

describe("c2paSignerFromVars", () => {
  it("braucht Werkzeug, Zertifikat und Schlüssel", () => {
    expect(c2paSignerFromVars({})).toBeUndefined();
    expect(c2paSignerFromVars({ C2PATOOL_PATH: "c2patool", C2PA_SIGN_CERT: "a" })).toBeUndefined();
    expect(c2paSignerFromVars({ C2PA_SIGN_CERT: "a", C2PA_PRIVATE_KEY: "b" })).toBeUndefined();
  });

  it("gilt ohne C2PA_CERT_KIND=production als Testzertifikat", () => {
    const vars = { C2PATOOL_PATH: "c2patool", C2PA_SIGN_CERT: "a", C2PA_PRIVATE_KEY: "b" };
    expect(c2paSignerFromVars(vars)?.certificate).toBe("test");
    expect(c2paSignerFromVars({ ...vars, C2PA_CERT_KIND: "prod" })?.certificate).toBe("test");
    expect(c2paSignerFromVars({ ...vars, C2PA_CERT_KIND: "production" })?.certificate).toBe(
      "production"
    );
  });

  it("startet das konfigurierte Programm ohne Zusatzargumente", async () => {
    // node als "c2patool": node versucht input.png als Skript auszuführen und scheitert.
    const s = c2paSignerFromVars({
      C2PATOOL_PATH: process.execPath,
      C2PA_SIGN_CERT: "a",
      C2PA_PRIVATE_KEY: "b",
      C2PA_TSA_URL: "http://timestamp.example"
    });
    await expect(s?.sign(new Uint8Array([0x89]), "image/png", {})).rejects.toThrow(
      ProvenanceSignError
    );
  });

  it("reicht alle C2PA-Variablen an die Node-Laufzeit durch", () => {
    for (const name of C2PA_ENV_VARS) {
      expect(PASSTHROUGH_VARS).toContain(name);
    }
  });
});
