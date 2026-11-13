import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  convertDocxWithMammoth,
  decodeHtmlEntities,
  docxBlocksToMarkdown,
  docxHtmlToBlocks,
  extractDocx
} from "../workers/docx-extract.js";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("DOCX-Auszug mit mammoth (#152)", { timeout: 180_000 }, () => {
  it("extrahiert Überschriften, Listen, Tabellen und Absätze aus einer echten .docx-Datei", async () => {
    const { blocks, markdown } = await extractDocx(fixture("structured.docx"));

    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Projektbericht Quellen" },
      {
        kind: "paragraph",
        level: 0,
        text: "Dieser Bericht beschreibt die Verarbeitung von Word-Dateien im Browser."
      },
      { kind: "heading", level: 2, text: "Ziele" },
      { kind: "list-item", level: 0, ordered: false, text: "Absätze bleiben erhalten" },
      { kind: "list-item", level: 0, ordered: false, text: "Listen werden erkannt" },
      { kind: "heading", level: 2, text: "Schritte" },
      { kind: "list-item", level: 0, ordered: true, text: "Datei hochladen" },
      { kind: "list-item", level: 0, ordered: true, text: "Text extrahieren" },
      { kind: "table-row", level: 0, cells: ["Format", "Werkzeug"], text: "Format | Werkzeug" },
      { kind: "table-row", level: 0, cells: ["DOCX", "mammoth & Co"], text: "DOCX | mammoth & Co" },
      {
        kind: "paragraph",
        level: 0,
        text: "Abschluss mit Sonderzeichen: Größe < 5 MB & „Anführung“."
      }
    ]);

    expect(markdown).toBe(
      [
        "# Projektbericht Quellen",
        "",
        "Dieser Bericht beschreibt die Verarbeitung von Word-Dateien im Browser.",
        "",
        "## Ziele",
        "",
        "- Absätze bleiben erhalten",
        "- Listen werden erkannt",
        "",
        "## Schritte",
        "",
        "1. Datei hochladen",
        "2. Text extrahieren",
        "",
        "| Format | Werkzeug |",
        "| DOCX | mammoth & Co |",
        "",
        "Abschluss mit Sonderzeichen: Größe < 5 MB & „Anführung“."
      ].join("\n")
    );
  });

  it("liefert mammoths HTML unverändert über den Standard-Konverter", async () => {
    const html = await convertDocxWithMammoth(fixture("structured.docx"));
    expect(html).toContain("<h1>Projektbericht Quellen</h1>");
    expect(html).toContain("<ol><li>Datei hochladen</li>");
  });

  it("lehnt Dateien ohne lesbaren Text ab", async () => {
    await expect(extractDocx(new Uint8Array([1]), async () => "<p> </p>")).rejects.toThrow(
      /keinen lesbaren Text/
    );
  });

  it("weist kaputte Dateien mit einem Fehler zurück", async () => {
    await expect(extractDocx(new Uint8Array([0x50, 0x4b, 0x00]))).rejects.toThrow();
  });
});

describe("docxHtmlToBlocks Randfälle (#152)", () => {
  it("ordnet verschachtelte Listen, Inline-Auszeichnung und Absätze in Listenpunkten zu", () => {
    const blocks = docxHtmlToBlocks(
      "<ul><li>Außen <strong>fett</strong><ul><li><p>Innen</p></li></ul></li></ul>" +
        "<ol><li>Eins</li></ol><h3>Titel <em>kursiv</em></h3><p></p>"
    );
    expect(blocks).toEqual([
      { kind: "list-item", level: 0, ordered: false, text: "Außen fett" },
      { kind: "list-item", level: 0, ordered: false, text: "Innen" },
      { kind: "list-item", level: 0, ordered: true, text: "Eins" },
      { kind: "heading", level: 3, text: "Titel kursiv" }
    ]);
  });

  it("überspringt leere Tabellenzeilen und verkraftet verwaiste Tags", () => {
    const blocks = docxHtmlToBlocks(
      "</tr></td><td>los</td><table><tr><th>Kopf</th><td></td></tr>" +
        "<tr><td> </td></tr></table><li>ohne Liste</li></p>"
    );
    expect(blocks).toEqual([
      { kind: "table-row", level: 0, cells: ["Kopf", ""], text: "Kopf | " },
      { kind: "list-item", level: 0, ordered: false, text: "ohne Liste" }
    ]);
  });

  it("beginnt bei einem neuen Listenpunkt ohne schließendes Tag einen neuen Block", () => {
    expect(docxHtmlToBlocks("<ul><li>A<li>B</ul>")).toEqual([
      { kind: "list-item", level: 0, ordered: false, text: "A" },
      { kind: "list-item", level: 0, ordered: false, text: "B" }
    ]);
  });

  it("dekodiert benannte und numerische Entitäten, unbekannte bleiben stehen", () => {
    expect(decodeHtmlEntities("&amp;&lt;&gt;&quot;&apos;&nbsp;&#228;&#xE4;&#XE4;&unbekannt;")).toBe(
      "&<>\"' äää&unbekannt;"
    );
  });

  it("zählt nummerierte Listen nach einer Unterbrechung neu", () => {
    const md = docxBlocksToMarkdown([
      { kind: "list-item", level: 0, ordered: true, text: "a" },
      { kind: "list-item", level: 0, ordered: true, text: "b" },
      { kind: "list-item", level: 0, ordered: false, text: "c" },
      { kind: "list-item", level: 0, ordered: true, text: "d" },
      { kind: "paragraph", level: 0, text: "Absatz" },
      { kind: "list-item", level: 0, ordered: true, text: "e" }
    ]);
    expect(md).toBe("1. a\n2. b\n- c\n1. d\n\nAbsatz\n\n1. e");
  });
});
