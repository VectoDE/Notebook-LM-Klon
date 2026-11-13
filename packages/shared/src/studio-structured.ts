/**
 * Strukturierte Studio-Werkzeuge (Issue #239): Timeline, Datentabelle und Infografik.
 *
 * Gleiche Regel wie im Beziehungsgraphen: Die KI schlägt vor, jeder Eintrag braucht ein
 * wörtliches Zitat aus seiner Quelle, und die Werte (Datum, Zellen, Kennzahl) müssen in
 * diesem Zitat stehen. Was nicht belegt ist, wird verworfen. Der Mensch prüft.
 * Das Modul ist rein (ohne DOM, ohne Netz) und vollständig getestet.
 */

import { z } from "zod";
import {
  EntityEvidenceSchema,
  type EntitySourceText,
  REVIEW_STATUSES,
  type ReviewStatus,
  collapseWhitespace,
  locateQuote
} from "./entity-graph.js";

/** Kommt ein Wert (ohne Groß-/Kleinschreibung, Leerraum tolerant) im Zitat vor? */
export function valueInQuote(value: string, quote: string): boolean {
  const v = collapseWhitespace(value).toLocaleLowerCase("de");
  return v.length > 0 && collapseWhitespace(quote).toLocaleLowerCase("de").includes(v);
}

export type DroppedStructuredReason =
  | "unknownSource"
  | "quoteNotFound"
  | "valueNotInQuote"
  | "empty";

export interface DroppedStructured {
  readonly index: number;
  readonly reason: DroppedStructuredReason;
}

interface Evidence {
  readonly sourceId: string;
  readonly quote: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

/** Sucht das Zitat in der genannten Quelle; liefert Beleg oder Grund des Verwerfens. */
function verifyEvidence(
  textById: ReadonlyMap<string, string>,
  sourceId: string,
  quote: string
): Evidence | DroppedStructuredReason {
  const text = textById.get(sourceId);
  if (text === undefined) return "unknownSource";
  const found = locateQuote(text, quote);
  if (!found) return "quoteNotFound";
  return { sourceId, quote: found.quote, startOffset: found.start, endOffset: found.end };
}

/* --------------------------------------------------------------------------
   Timeline
   -------------------------------------------------------------------------- */

export const TimelineEntrySchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1).max(60),
  event: z.string().min(1).max(240),
  evidence: EntityEvidenceSchema,
  status: z.enum(REVIEW_STATUSES)
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const TimelineExtractionSchema = z.object({
  events: z.array(
    z.object({ date: z.string(), event: z.string(), sourceId: z.string(), quote: z.string() })
  )
});
export type TimelineExtraction = z.infer<typeof TimelineExtractionSchema>;

/**
 * Sortierschlüssel aus einer Datumsangabe: „2024“, „2024-05“, „2024-05-17“, „17.05.2024“,
 * „05/2024“. Unbekannte Formen (z. B. „Phase 2“) liefern undefined und bleiben in der
 * Reihenfolge der Quelle hinter den datierten Einträgen.
 */
export function dateSortKey(date: string): number | undefined {
  const d = collapseWhitespace(date);
  let m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(d);
  if (m) return Number(m[1]) * 10_000 + Number(m[2] ?? 0) * 100 + Number(m[3] ?? 0);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(d);
  if (m) return Number(m[3]) * 10_000 + Number(m[2]) * 100 + Number(m[1]);
  m = /^(\d{1,2})\/(\d{4})$/.exec(d);
  if (m) return Number(m[2]) * 10_000 + Number(m[1]) * 100;
  return undefined;
}

/** Prüft Datums-Ereignis-Paare: Zitat in der Quelle, Datum im Zitat. Sortiert nach Datum. */
export function normalizeTimeline(
  raw: TimelineExtraction,
  sources: readonly EntitySourceText[]
): { readonly entries: TimelineEntry[]; readonly dropped: DroppedStructured[] } {
  const textById = new Map(sources.map((s) => [s.id, s.text]));
  const kept: { entry: Omit<TimelineEntry, "id">; key: number | undefined; order: number }[] = [];
  const dropped: DroppedStructured[] = [];
  raw.events.forEach((item, index) => {
    const date = collapseWhitespace(item.date).slice(0, 60);
    const event = collapseWhitespace(item.event).slice(0, 240);
    if (!date || !event) return void dropped.push({ index, reason: "empty" });
    const evidence = verifyEvidence(textById, item.sourceId, item.quote);
    if (typeof evidence === "string") return void dropped.push({ index, reason: evidence });
    if (!valueInQuote(date, evidence.quote)) {
      return void dropped.push({ index, reason: "valueNotInQuote" });
    }
    kept.push({
      entry: { date, event, evidence, status: "suggested" },
      key: dateSortKey(date),
      order: index
    });
  });
  // Datierte vor undatierten; bei gleichem Schlüssel gilt die Reihenfolge der Quelle
  const rank = (key: number | undefined) => key ?? Number.POSITIVE_INFINITY;
  kept.sort((a, b) => rank(a.key) - rank(b.key) || a.order - b.order);
  return {
    entries: kept.map((k, i) => ({ id: `tl:${i + 1}`, ...k.entry })),
    dropped
  };
}

/* --------------------------------------------------------------------------
   Datentabelle
   -------------------------------------------------------------------------- */

export const DATA_TABLE_MAX_COLUMNS = 8;

export const DataTableRowSchema = z.object({
  id: z.string().min(1),
  cells: z.array(z.string()),
  evidence: EntityEvidenceSchema,
  status: z.enum(REVIEW_STATUSES)
});
export type DataTableRow = z.infer<typeof DataTableRowSchema>;

export const DataTableSchema = z.object({
  columns: z.array(z.string().min(1)).min(1).max(DATA_TABLE_MAX_COLUMNS),
  rows: z.array(DataTableRowSchema)
});
export type DataTable = z.infer<typeof DataTableSchema>;

export const DataTableExtractionSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.object({ cells: z.array(z.string()), sourceId: z.string(), quote: z.string() }))
});
export type DataTableExtraction = z.infer<typeof DataTableExtractionSchema>;

/**
 * Prüft Tabellenzeilen: Zitat in der Quelle, jede gefüllte Zelle steht im Zitat.
 * Spalten ohne Namen fallen weg; Zellen werden auf die Spaltenzahl gebracht.
 */
export function normalizeDataTable(
  raw: DataTableExtraction,
  sources: readonly EntitySourceText[]
): { readonly table: DataTable; readonly dropped: DroppedStructured[] } {
  const columns = raw.columns
    .map((c) => collapseWhitespace(c))
    .filter(Boolean)
    .slice(0, DATA_TABLE_MAX_COLUMNS);
  const textById = new Map(sources.map((s) => [s.id, s.text]));
  const rows: DataTableRow[] = [];
  const dropped: DroppedStructured[] = [];
  raw.rows.forEach((row, index) => {
    const cells = columns.map((_, i) => collapseWhitespace(row.cells[i] ?? ""));
    if (cells.every((c) => !c)) return void dropped.push({ index, reason: "empty" });
    const evidence = verifyEvidence(textById, row.sourceId, row.quote);
    if (typeof evidence === "string") return void dropped.push({ index, reason: evidence });
    if (cells.some((c) => c && !valueInQuote(c, evidence.quote))) {
      return void dropped.push({ index, reason: "valueNotInQuote" });
    }
    rows.push({ id: `row:${rows.length + 1}`, cells, evidence, status: "suggested" });
  });
  return { table: { columns: columns.length > 0 ? columns : ["–"], rows }, dropped };
}

/** Eine CSV-Zelle nach RFC 4180; Formel-Anfänge werden entschärft (CSV-Injection). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV mit Quellenspalte und Zitatspalte, UTF-8 mit BOM (Excel), Trenner Komma, Zeilenende
 * CRLF. Abgelehnte Zeilen werden nicht exportiert.
 */
export function dataTableToCsv(
  table: DataTable,
  sourceTitle: (sourceId: string) => string,
  labels: { readonly source: string; readonly quote: string }
): string {
  const lines = [[...table.columns, labels.source, labels.quote].map(csvCell).join(",")];
  for (const row of table.rows) {
    if (row.status === "rejected") continue;
    lines.push(
      [...row.cells, sourceTitle(row.evidence.sourceId), row.evidence.quote].map(csvCell).join(",")
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/* --------------------------------------------------------------------------
   Infografik (statisches SVG)
   -------------------------------------------------------------------------- */

export const InfographicFactSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(40),
  evidence: EntityEvidenceSchema,
  status: z.enum(REVIEW_STATUSES)
});
export type InfographicFact = z.infer<typeof InfographicFactSchema>;

export const InfographicExtractionSchema = z.object({
  facts: z.array(
    z.object({ label: z.string(), value: z.string(), sourceId: z.string(), quote: z.string() })
  )
});
export type InfographicExtraction = z.infer<typeof InfographicExtractionSchema>;

/** Prüft Kennzahlen: Zitat in der Quelle, Wert im Zitat. */
export function normalizeInfographic(
  raw: InfographicExtraction,
  sources: readonly EntitySourceText[]
): { readonly facts: InfographicFact[]; readonly dropped: DroppedStructured[] } {
  const textById = new Map(sources.map((s) => [s.id, s.text]));
  const facts: InfographicFact[] = [];
  const dropped: DroppedStructured[] = [];
  raw.facts.forEach((fact, index) => {
    const label = collapseWhitespace(fact.label).slice(0, 80);
    const value = collapseWhitespace(fact.value).slice(0, 40);
    if (!label || !value) return void dropped.push({ index, reason: "empty" });
    const evidence = verifyEvidence(textById, fact.sourceId, fact.quote);
    if (typeof evidence === "string") return void dropped.push({ index, reason: evidence });
    if (!valueInQuote(value, evidence.quote)) {
      return void dropped.push({ index, reason: "valueNotInQuote" });
    }
    facts.push({ id: `fact:${facts.length + 1}`, label, value, evidence, status: "suggested" });
  });
  return { facts, dropped };
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface InfographicOptions {
  readonly title: string;
  /** Sprache der Inhalte (BCP 47) für xml:lang. */
  readonly lang: string;
  readonly sourceTitle: (sourceId: string) => string;
  /** Beschriftung der Fußzeile, z. B. „Quellen“. */
  readonly sourcesLabel: string;
  /** Text bei leerer Grafik. */
  readonly emptyText: string;
}

export const INFOGRAPHIC_WIDTH = 800;
const CARD_W = 360;
const CARD_H = 132;
const GAP = 24;
const MARGIN = 28;
const HEADER_H = 84;

/** Bricht Text an Wortgrenzen um (für SVG ohne automatischen Umbruch). */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Statische Infografik als SVG: Titel, je Kennzahl eine Karte (Wert groß, Bezeichnung
 * darunter, Fußnotennummer), Fußzeile mit Quellen. Abgelehnte Kennzahlen fehlen.
 * Barrierefrei: role="img", title und desc mit allen Werten als Text. Farben fest
 * (Kontrast über 7:1), damit Export und Druck gleich aussehen.
 */
export function renderInfographicSvg(
  facts: readonly InfographicFact[],
  options: InfographicOptions
): string {
  const shown = facts.filter((f) => f.status !== "rejected");
  const sourceIds = [...new Set(shown.map((f) => f.evidence.sourceId))];
  const rowsCount = Math.ceil(shown.length / 2);
  const cardsH = shown.length > 0 ? rowsCount * CARD_H + (rowsCount - 1) * GAP : 40;
  const footerTop = HEADER_H + cardsH + GAP;
  const height = footerTop + 28 + sourceIds.length * 22 + MARGIN;
  const desc = shown.map((f) => `${f.label}: ${f.value}`).join("; ") || options.emptyText;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${INFOGRAPHIC_WIDTH}" height="${height}" viewBox="0 0 ${INFOGRAPHIC_WIDTH} ${height}" role="img" aria-labelledby="ig-title ig-desc" xml:lang="${escapeXml(options.lang)}" font-family="Inter, Arial, sans-serif">`,
    `<title id="ig-title">${escapeXml(options.title)}</title>`,
    `<desc id="ig-desc">${escapeXml(desc)}</desc>`,
    `<rect width="${INFOGRAPHIC_WIDTH}" height="${height}" fill="#ffffff"/>`,
    `<text x="${MARGIN}" y="${MARGIN + 28}" font-size="28" font-weight="700" fill="#111827">${escapeXml(options.title)}</text>`
  ];
  if (shown.length === 0) {
    parts.push(
      `<text x="${MARGIN}" y="${HEADER_H + 24}" font-size="16" fill="#374151">${escapeXml(options.emptyText)}</text>`
    );
  }
  shown.forEach((fact, i) => {
    const x = MARGIN + (i % 2) * (CARD_W + GAP + 8);
    const y = HEADER_H + Math.floor(i / 2) * (CARD_H + GAP);
    const note = sourceIds.indexOf(fact.evidence.sourceId) + 1;
    parts.push(
      `<g transform="translate(${x} ${y})">`,
      `<rect width="${CARD_W}" height="${CARD_H}" rx="14" fill="#f3f4f6" stroke="#4b5563" stroke-width="1.5"/>`,
      `<text x="20" y="54" font-size="36" font-weight="700" fill="#111827">${escapeXml(fact.value)}</text>`,
      ...wrapText(fact.label, 34)
        .slice(0, 2)
        .map(
          (line, l) =>
            `<text x="20" y="${86 + l * 22}" font-size="16" fill="#1f2937">${escapeXml(line)}</text>`
        ),
      `<text x="${CARD_W - 20}" y="30" font-size="14" fill="#374151" text-anchor="end">[${note}]</text>`,
      "</g>"
    );
  });
  if (sourceIds.length > 0) {
    parts.push(
      `<text x="${MARGIN}" y="${footerTop + 14}" font-size="14" font-weight="700" fill="#111827">${escapeXml(options.sourcesLabel)}</text>`
    );
    sourceIds.forEach((id, i) => {
      parts.push(
        `<text x="${MARGIN}" y="${footerTop + 36 + i * 22}" font-size="14" fill="#374151">[${i + 1}] ${escapeXml(options.sourceTitle(id))}</text>`
      );
    });
  }
  parts.push("</svg>");
  return parts.join("\n");
}

/** Status eines Eintrags setzen (Timeline, Tabelle, Kennzahlen gleichermaßen). */
export function setReviewStatus<T extends { readonly id: string; readonly status: ReviewStatus }>(
  items: readonly T[],
  id: string,
  status: ReviewStatus
): T[] {
  return items.map((item) => (item.id === id ? { ...item, status } : item));
}
