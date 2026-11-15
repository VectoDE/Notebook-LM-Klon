import { describe, expect, it } from "vitest";
import {
  C2PA_SIGNABLE_FORMATS,
  C2PA_UNSUPPORTED_FORMATS,
  DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC,
  MANIFEST_TITLE_MAX_LENGTH,
  PROVENANCE_GENERATOR_NAME,
  baseMimeType,
  buildManifestDefinition,
  c2paExtensionFor,
  isC2paSignable
} from "../provenance.js";

describe("C2PA-Formate (Issue #353)", () => {
  it("normalisiert Medienarten ohne Parameter und in Kleinschrift", () => {
    expect(baseMimeType("video/MP4; codecs=avc1")).toBe("video/mp4");
    expect(baseMimeType("  image/png ")).toBe("image/png");
    expect(baseMimeType("")).toBe("");
  });

  it("kennt die Dateiendung signierbarer Formate", () => {
    expect(c2paExtensionFor("video/mp4;codecs=avc1.42E01E")).toBe("mp4");
    expect(c2paExtensionFor("image/svg+xml")).toBe("svg");
    expect(c2paExtensionFor("audio/x-wav")).toBe("wav");
    expect(c2paExtensionFor("text/plain")).toBeNull();
  });

  it("signiert WebM, Ogg und Opus nicht", () => {
    for (const mime of C2PA_UNSUPPORTED_FORMATS) {
      expect(isC2paSignable(mime)).toBe(false);
      expect(C2PA_SIGNABLE_FORMATS[mime]).toBeUndefined();
    }
    expect(isC2paSignable("video/webm;codecs=vp9")).toBe(false);
    expect(isC2paSignable("image/png")).toBe(true);
  });
});

describe("buildManifestDefinition", () => {
  it("hält Erzeuger, Titel, Format und KI-Herkunft fest", () => {
    expect(
      buildManifestDefinition({
        title: "Mindmap Klima",
        mimeType: "image/svg+xml; charset=utf-8",
        generatorVersion: "1.5.2",
        aiGenerated: true
      })
    ).toEqual({
      claim_generator_info: [{ name: PROVENANCE_GENERATOR_NAME, version: "1.5.2" }],
      title: "Mindmap Klima",
      format: "image/svg+xml",
      assertions: [
        {
          label: "c2pa.actions.v2",
          data: {
            actions: [
              {
                action: "c2pa.created",
                digitalSourceType: DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC
              }
            ]
          }
        }
      ]
    });
  });

  it("kennzeichnet nicht KI-erzeugte Dateien als digital erstellt", () => {
    const manifest = buildManifestDefinition({
      title: "x",
      mimeType: "image/png",
      generatorVersion: "1",
      aiGenerated: false
    }) as { assertions: { data: { actions: { digitalSourceType: string }[] } }[] };
    expect(manifest.assertions[0]?.data.actions[0]?.digitalSourceType).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation"
    );
  });

  it("entfernt Steuerzeichen, kürzt lange Titel und setzt einen Ersatztitel", () => {
    const base = { mimeType: "image/png", generatorVersion: "1", aiGenerated: true };
    expect(buildManifestDefinition({ ...base, title: "a\u0000b\nc" }).title).toBe("a b c");
    expect(buildManifestDefinition({ ...base, title: "\u0007  " }).title).toBe("Export");
    expect(
      (buildManifestDefinition({ ...base, title: "x".repeat(500) }).title as string).length
    ).toBe(MANIFEST_TITLE_MAX_LENGTH);
  });
});
