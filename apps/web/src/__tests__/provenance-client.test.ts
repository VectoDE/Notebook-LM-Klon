import { DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC, PROVENANCE_MAX_BYTES } from "@notebook-lm/shared";
import { describe, expect, it, vi } from "vitest";
import {
  type FetchLike,
  PROVENANCE_SIGN_URL,
  type ProvenanceOutcome,
  addSvgProvenanceMetadata,
  provenanceNoteKey,
  signExport
} from "../provenance-client.js";
import { AREA_DE, AREA_EN } from "../translations-areas.js";

const svgBlob = () => new Blob(["<svg/>"], { type: "image/svg+xml" });

function respond(status: number, body: BodyInit | null = null, headers: HeadersInit = {}) {
  return vi.fn<FetchLike>(async () => new Response(body, { status, headers }));
}

describe("signExport (Issue #353)", () => {
  it("schickt die Datei mit Medienart und Titel und übernimmt die signierte Fassung", async () => {
    const fetchFn = respond(200, "signed", { "x-c2pa-certificate": "test" });
    const outcome = await signExport(fetchFn, svgBlob(), {
      mimeType: "image/svg+xml;charset=utf-8",
      title: "Klima – Mindmap"
    });
    expect(outcome).toMatchObject({ signed: true, certificate: "test" });
    expect(await outcome.blob.text()).toBe("signed");
    expect(outcome.blob.type).toBe("image/svg+xml");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PROVENANCE_SIGN_URL}?title=Klima+%E2%80%93+Mindmap`);
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "image/svg+xml" }
    });
  });

  it("erkennt ein eigenes Zertifikat und markiert nicht KI-erzeugte Dateien", async () => {
    const fetchFn = respond(200, "x", { "x-c2pa-certificate": "production" });
    const outcome = await signExport(fetchFn, svgBlob(), {
      mimeType: "image/png",
      title: "t",
      aiGenerated: false
    });
    expect(outcome).toMatchObject({ signed: true, certificate: "production" });
    expect(fetchFn.mock.calls[0]?.[0]).toContain("ai=0");
  });

  it("fragt bei WebM und zu großen Dateien gar nicht erst an", async () => {
    const fetchFn = respond(200);
    const webm = await signExport(fetchFn, svgBlob(), { mimeType: "video/webm", title: "v" });
    expect(webm).toMatchObject({ signed: false, reason: "unsupported-format" });
    const big = { size: PROVENANCE_MAX_BYTES + 1 } as Blob;
    expect(await signExport(fetchFn, big, { mimeType: "video/mp4", title: "v" })).toEqual({
      signed: false,
      reason: "too-large",
      blob: big
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [413, "too-large"],
    [415, "unsupported-format"],
    [503, "not-configured"],
    [502, "failed"],
    [429, "failed"]
  ])("lädt bei HTTP %i unsigniert (%s)", async (status, reason) => {
    const blob = svgBlob();
    const outcome = await signExport(respond(status), blob, { mimeType: "image/png", title: "" });
    expect(outcome).toEqual({ signed: false, reason, blob });
  });

  it("lädt bei Netzfehlern und unlesbarer Antwort unsigniert", async () => {
    const offline = vi.fn<FetchLike>(async () => {
      throw new TypeError("offline");
    });
    expect(
      await signExport(offline, svgBlob(), { mimeType: "image/png", title: "" })
    ).toMatchObject({ signed: false, reason: "failed" });
    const broken = vi.fn<FetchLike>(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          blob: async () => {
            throw new Error("abgebrochen");
          }
        }) as unknown as Response
    );
    expect(await signExport(broken, svgBlob(), { mimeType: "image/png", title: "" })).toMatchObject(
      { signed: false, reason: "failed" }
    );
  });
});

describe("provenanceNoteKey", () => {
  const blob = svgBlob();
  const cases: [ProvenanceOutcome, string][] = [
    [{ signed: true, certificate: "test", blob }, "provSignedTest"],
    [{ signed: true, certificate: "production", blob }, "provSignedProduction"],
    [{ signed: false, reason: "unsupported-format", blob }, "provUnsignedFormat"],
    [{ signed: false, reason: "too-large", blob }, "provUnsignedTooLarge"],
    [{ signed: false, reason: "not-configured", blob }, "provUnsignedNotConfigured"],
    [{ signed: false, reason: "unauthorized", blob }, "provUnsignedSignIn"],
    [{ signed: false, reason: "failed", blob }, "provUnsignedFailed"]
  ];

  it.each(cases)("hat für jedes Ergebnis einen deutschen und englischen Hinweis", (o, key) => {
    expect(provenanceNoteKey(o)).toBe(key);
    expect(AREA_DE[key]).toMatch(/C2PA/);
    expect(AREA_EN[key]).toMatch(/C2PA/);
  });

  it("nennt das Testzertifikat ehrlich als nicht vertrauenswürdig", () => {
    expect(AREA_DE.provSignedTest).toContain("nicht vertrauenswürdig");
    expect(AREA_EN.provSignedTest).toContain("untrusted");
  });
});

describe("addSvgProvenanceMetadata", () => {
  it("schreibt Erzeuger und IPTC-Herkunft als XMP direkt hinter das svg-Tag", () => {
    const svg =
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><text>a</text></svg>';
    const out = addSvgProvenanceMetadata(svg);
    expect(out).toMatch(/^<\?xml version="1.0"\?>\n<svg [^>]+><metadata><rdf:RDF /);
    expect(out).toContain('xmp:CreatorTool="RelationNotes"');
    expect(out).toContain(
      `Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC}"`
    );
    expect(out.endsWith("</metadata><text>a</text></svg>")).toBe(true);
    // Zweimal angewendet bleibt es bei einem Eintrag.
    expect(addSvgProvenanceMetadata(out)).toBe(out);
  });

  it("kennzeichnet nicht KI-erzeugte Grafiken als digital erstellt", () => {
    expect(addSvgProvenanceMetadata("<svg>", false)).toContain("digitalsourcetype/digitalCreation");
  });

  it("lässt Text ohne svg-Tag unverändert", () => {
    expect(addSvgProvenanceMetadata("kein svg")).toBe("kein svg");
  });
});
