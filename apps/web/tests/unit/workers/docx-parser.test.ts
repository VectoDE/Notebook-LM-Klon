import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DOCX_LIMITS,
  DOCX_MIME_TYPE,
  DocxLimitError,
  extractDocxText,
  inspectDocxArchive,
  readZipDirectory
} from "@/workers/docx-parser.js";
import { buildDocx, buildZip, DOCX_FRAME, documentXml } from "../../fixtures/zip-fixture.js";

// mammoth beim ersten Import kalt zu laden dauert auf ausgelasteten Rechnern mehrere Sekunden
beforeAll(async () => {
  await import("mammoth");
}, 120_000);

const MiB = 1024 * 1024;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(DocxLimitError);
  return (error as DocxLimitError).code;
}

describe("DOCX-Grenzwerte (benannte Konstanten)", () => {
  it("entsprechen der Upload-Grenze und den Schutzregeln gegen Zip-Bomben", () => {
    expect(DOCX_MIME_TYPE).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(DOCX_LIMITS).toEqual({
      maxFileBytes: 50 * MiB,
      maxEntries: 2_000,
      maxTotalUncompressedBytes: 256 * MiB,
      maxXmlBytes: 64 * MiB,
      maxCompressionRatio: 100,
      ratioMinBytes: 1 * MiB,
      maxTextChars: 5_000_000
    });
    expect(Object.isFrozen(DOCX_LIMITS)).toBe(true);
  });
});

describe("DOCX lesen mit mammoth (extractRawText)", () => {
  it("liefert die Absätze als Text, mit Leerzeile getrennt", async () => {
    const docx = buildDocx(["Die Elbe fließt durch Dresden.", "Größe < 5 MB & „Anführung“."]);
    const text = await extractDocxText(docx);
    expect(text).toBe("Die Elbe fließt durch Dresden.\n\nGröße < 5 MB & „Anführung“.");
  });

  it("ignoriert Bilder und eingebettete Objekte", async () => {
    const image = new Uint8Array(3 * MiB).map((_, i) => (i * 31) % 251);
    const docx = buildDocx(
      ["Nur Text zählt."],
      [
        { name: "word/media/image1.png", data: image, method: 0 },
        { name: "word/embeddings/oleObject1.bin", data: image, method: 0 }
      ]
    );
    expect(await extractDocxText(docx)).toBe("Nur Text zählt.");
  });

  it("gibt den Text ohne überzählige Leerzeilen und Leerraum am Rand zurück", async () => {
    const extract = vi.fn(async () => "\n\nA\n\n\n\n\nB\n\n");
    expect(await extractDocxText(buildDocx(["x"]), { extractRawText: extract })).toBe("A\n\nB");
    expect(extract).toHaveBeenCalledOnce();
  });

  it("lehnt Text über der Zeichengrenze ab", async () => {
    const docx = buildDocx(["sechs!"]);
    expect(await codeOf(extractDocxText(docx, { limits: { maxTextChars: 5 } }))).toBe(
      "TEXT_TOO_LONG"
    );
  });

  it("reicht Fehler von mammoth bei kaputtem XML weiter", async () => {
    const docx = buildZip([...DOCX_FRAME, { name: "word/document.xml", data: "<w:document" }]);
    await expect(extractDocxText(docx)).rejects.toThrow();
  });
});

describe("Schutz vor Zip-Bomben und kaputten Archiven", () => {
  const neverCalled = () => vi.fn(async () => "darf nicht laufen");

  it("prüft die Dateigröße vor dem Entpacken", async () => {
    const extract = neverCalled();
    const docx = buildDocx(["x"]);
    expect(
      await codeOf(
        extractDocxText(docx, { limits: { maxFileBytes: 100 }, extractRawText: extract })
      )
    ).toBe("DOCX_TOO_LARGE");
    expect(extract).not.toHaveBeenCalled();
  });

  it("Zip-Bombe: hohes Kompressionsverhältnis wird vor mammoth abgelehnt", async () => {
    const extract = neverCalled();
    const filler = "A".repeat(20 * MiB);
    const bomb = buildZip([
      ...DOCX_FRAME,
      { name: "word/document.xml", data: documentXml([filler]) }
    ]);
    expect(bomb.byteLength).toBeLessThan(MiB);
    expect(await codeOf(extractDocxText(bomb, { extractRawText: extract }))).toBe(
      "DOCX_TOO_COMPLEX"
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it("Zip-Bombe mit gefälschter Größenangabe: echtes Entpacken bricht an der Grenze ab", async () => {
    const extract = neverCalled();
    const bomb = buildZip([
      ...DOCX_FRAME,
      {
        name: "word/document.xml",
        data: documentXml(["B".repeat(20 * MiB)]),
        declaredUncompressedSize: 1_000
      }
    ]);
    expect(await codeOf(extractDocxText(bomb, { extractRawText: extract }))).toBe(
      "DOCX_TOO_COMPLEX"
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it("begrenzt die angegebene Gesamtgröße aller Einträge", async () => {
    const docx = buildDocx(["x"], [{ name: "word/media/a.png", data: "12345678", method: 0 }]);
    expect(
      await codeOf(inspectDocxArchive(docx, { ...DOCX_LIMITS, maxTotalUncompressedBytes: 600 }))
    ).toBe("DOCX_TOO_COMPLEX");
  });

  it("begrenzt die tatsächlich entpackten XML-Bytes", async () => {
    const docx = buildDocx(["x".repeat(2_000)]);
    expect(await codeOf(inspectDocxArchive(docx, { ...DOCX_LIMITS, maxXmlBytes: 1_000 }))).toBe(
      "DOCX_TOO_COMPLEX"
    );
  });

  it("begrenzt auch gespeicherte (unkomprimierte) XML-Teile", async () => {
    const docx = buildZip([
      ...DOCX_FRAME,
      { name: "word/document.xml", data: documentXml(["x".repeat(2_000)]), method: 0 }
    ]);
    expect(await codeOf(inspectDocxArchive(docx, { ...DOCX_LIMITS, maxXmlBytes: 1_000 }))).toBe(
      "DOCX_TOO_COMPLEX"
    );
  });

  it("lehnt einen lokalen Kopf hinter dem Dateiende ab", async () => {
    const docx = buildDocx(["x"]);
    const view = new DataView(docx.buffer);
    const centralOffset = view.getUint32(docx.byteLength - 22 + 16, true);
    // Erster Eintrag ist [Content_Types].xml: lokaler Kopf zeigt weit hinter das Ende
    view.setUint32(centralOffset + 42, 0x7fffffff, true);
    expect(await codeOf(inspectDocxArchive(docx, DOCX_LIMITS))).toBe("DOCX_INVALID");
  });

  it("begrenzt die Zahl der Einträge", async () => {
    const docx = buildDocx(["x"]);
    expect(await codeOf(inspectDocxArchive(docx, { ...DOCX_LIMITS, maxEntries: 2 }))).toBe(
      "DOCX_TOO_COMPLEX"
    );
  });

  it("lehnt ZIP64-Markierungen ab (eine DOCX bis 50 MB braucht sie nicht)", async () => {
    const docx = buildDocx(
      ["x"],
      [{ name: "word/media/a.png", data: "x", method: 0, declaredUncompressedSize: 0xffffffff }]
    );
    expect(await codeOf(inspectDocxArchive(docx, DOCX_LIMITS))).toBe("DOCX_TOO_COMPLEX");
  });

  it("lehnt Dateien ab, die kein ZIP sind", async () => {
    expect(await codeOf(extractDocxText(new TextEncoder().encode("kein zip")))).toBe(
      "DOCX_INVALID"
    );
    expect(await codeOf(extractDocxText(new Uint8Array(4_000)))).toBe("DOCX_INVALID");
  });

  it("lehnt ein ZIP ohne word/document.xml ab", async () => {
    const zip = buildZip([{ name: "hallo.txt", data: "Hallo" }]);
    expect(await codeOf(extractDocxText(zip))).toBe("DOCX_INVALID");
  });

  it("lehnt unbekannte Kompressionsverfahren in XML-Teilen ab", async () => {
    const zip = buildZip([...DOCX_FRAME, { name: "word/document.xml", data: "x", method: 12 }]);
    expect(await codeOf(extractDocxText(zip))).toBe("DOCX_INVALID");
  });

  it("lehnt kaputte Deflate-Daten ab", async () => {
    const zip = buildZip([
      ...DOCX_FRAME,
      {
        name: "word/document.xml",
        data: documentXml(["x"]),
        bodyOverride: new Uint8Array([0xff, 0xff, 0xff, 0xff])
      }
    ]);
    expect(await codeOf(extractDocxText(zip))).toBe("DOCX_INVALID");
  });

  it("lehnt gespeicherte Teile mit widersprüchlicher Größe ab", async () => {
    const zip = buildZip([
      ...DOCX_FRAME,
      {
        name: "word/document.xml",
        data: documentXml(["x"]),
        method: 0,
        declaredUncompressedSize: 5
      }
    ]);
    expect(await codeOf(extractDocxText(zip))).toBe("DOCX_INVALID");
  });

  it("lehnt Einträge ab, deren Daten hinter dem Dateiende lägen", async () => {
    const zip = buildZip([
      ...DOCX_FRAME,
      { name: "word/document.xml", data: documentXml(["x"]), declaredCompressedSize: 10 * MiB }
    ]);
    expect(await codeOf(extractDocxText(zip))).toBe("DOCX_INVALID");
  });
});

describe("readZipDirectory", () => {
  it("liest Namen und Größen aus dem Zentralverzeichnis", () => {
    const zip = buildZip([
      { name: "a.txt", data: "Hallo", method: 0 },
      { name: "b.xml", data: "<x/>".repeat(100) }
    ]);
    const entries = readZipDirectory(zip);
    expect(entries.map((e) => [e.name, e.method, e.uncompressedSize])).toEqual([
      ["a.txt", 0, 5],
      ["b.xml", 8, 400]
    ]);
    expect(entries[1]?.compressedSize).toBeLessThan(400);
  });

  it("findet das Verzeichnisende auch hinter einem Archiv-Kommentar", () => {
    const zip = buildZip([{ name: "a.txt", data: "Hallo", method: 0 }]);
    const withComment = new Uint8Array(zip.byteLength + 7);
    withComment.set(zip);
    new DataView(withComment.buffer).setUint16(zip.byteLength - 2, 7, true);
    expect(readZipDirectory(withComment)).toHaveLength(1);
  });

  it("erkennt ein beschädigtes Zentralverzeichnis", () => {
    const zip = buildZip([{ name: "a.txt", data: "Hallo", method: 0 }]);
    const view = new DataView(zip.buffer);
    const eocd = zip.byteLength - 22;
    const centralOffset = view.getUint32(eocd + 16, true);

    const badSignature = zip.slice();
    badSignature[centralOffset] = 0;
    expect(() => readZipDirectory(badSignature)).toThrow(DocxLimitError);

    const badOffset = zip.slice();
    new DataView(badOffset.buffer).setUint32(eocd + 16, zip.byteLength, true);
    expect(() => readZipDirectory(badOffset)).toThrow(DocxLimitError);

    const badCount = zip.slice();
    new DataView(badCount.buffer).setUint16(eocd + 10, 5, true);
    expect(() => readZipDirectory(badCount)).toThrow(DocxLimitError);
  });

  it("erkennt einen beschädigten lokalen Kopf eines XML-Teils", async () => {
    const docx = buildDocx(["x"]);
    const offset = readZipDirectory(docx).find(
      (e) => e.name === "word/document.xml"
    )?.localHeaderOffset;
    const broken = docx.slice();
    broken[offset as number] = 0;
    expect(await codeOf(inspectDocxArchive(broken, DOCX_LIMITS))).toBe("DOCX_INVALID");
  });
});
