/**
 * Baut kleine ZIP-Archive für Tests (DOCX-Attrappen, Zip-Bomben, gefälschte Kopfdaten).
 * Nur node:zlib, keine weitere Abhängigkeit. Größenangaben lassen sich gezielt fälschen.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipFixtureEntry {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** 8 = Deflate (Standard), 0 = gespeichert, andere Werte für Fehlerfälle. */
  readonly method?: number;
  /** Überschreibt die angegebene unkomprimierte Größe im Zentralverzeichnis. */
  readonly declaredUncompressedSize?: number;
  /** Überschreibt die angegebene komprimierte Größe im Zentralverzeichnis. */
  readonly declaredCompressedSize?: number;
  /** Ersetzt die gespeicherten Bytes (z. B. kaputte Deflate-Daten). */
  readonly bodyOverride?: Uint8Array;
}

const encoder = new TextEncoder();

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}
function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

export function buildZip(entries: readonly ZipFixtureEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const method = entry.method ?? 8;
    const body = entry.bodyOverride ?? (method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw);
    const name = encoder.encode(entry.name);
    const crc = crc32(raw);
    const uncompressed = entry.declaredUncompressedSize ?? raw.byteLength;
    const compressed = entry.declaredCompressedSize ?? body.byteLength;

    const local = new Uint8Array(30 + name.byteLength + body.byteLength);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 8, method);
    u32(lv, 14, crc);
    u32(lv, 18, compressed);
    u32(lv, 22, uncompressed);
    u16(lv, 26, name.byteLength);
    local.set(name, 30);
    local.set(body, 30 + name.byteLength);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 10, method);
    u32(cv, 16, crc);
    u32(cv, 20, compressed);
    u32(cv, 24, uncompressed);
    u16(cv, 28, name.byteLength);
    u32(cv, 42, offset);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.byteLength;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);

  const out = new Uint8Array(offset + centralSize + eocd.byteLength);
  let pos = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, pos);
    pos += part.byteLength;
  }
  return out;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** document.xml mit je einem Absatz pro Eintrag. */
export function documentXml(paragraphs: readonly string[]): string {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/** Minimale, gültige DOCX-Datei mit den angegebenen Absätzen und optionalen Zusatzteilen. */
export function buildDocx(
  paragraphs: readonly string[],
  extra: readonly ZipFixtureEntry[] = []
): Uint8Array {
  return buildZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/document.xml", data: documentXml(paragraphs) },
    ...extra
  ]);
}

/** Standard-Teile einer DOCX ohne document.xml (für eigene, z. B. aufgeblähte Hauptteile). */
export const DOCX_FRAME: readonly ZipFixtureEntry[] = [
  { name: "[Content_Types].xml", data: CONTENT_TYPES },
  { name: "_rels/.rels", data: ROOT_RELS }
];
