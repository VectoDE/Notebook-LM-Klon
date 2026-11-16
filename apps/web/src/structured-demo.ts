/**
 * Demo-Daten für Timeline, Datentabelle und Infografik (Issue #239).
 *
 * Wie eine KI-Antwort: Rohvorschläge mit wörtlichem Zitat. buildStructuredDemo prüft sie mit
 * denselben normalize-Funktionen wie die echte Extraktion gegen die Demo-Quellen. So kann die
 * Demo nichts zeigen, was nicht in den Quellen steht. Die Demo-Quellen nennen kaum Daten;
 * die Timeline hat deshalb nur einen Eintrag (eine Migrationsphase).
 */

import {
  type DataTable,
  type DataTableExtraction,
  type InfographicExtraction,
  type InfographicFact,
  type TimelineEntry,
  type TimelineExtraction,
  normalizeDataTable,
  normalizeInfographic,
  normalizeTimeline
} from "@notebook-lm/shared";

export interface StructuredData {
  readonly timeline: readonly TimelineEntry[];
  readonly table: DataTable;
  readonly infographic: readonly InfographicFact[];
}

const ENTRY_POINT = "Cloudflare Worker serves as the single unified entry point.";
const VECTORS = "In-Memory vectors are managed inside NotebookDO with int8 quantization.";
const MIGRATION =
  "D1 Migration 0002 introduces FTS5 tables with BM25 ranking for hybrid lexical and vector search.";

export const DEMO_TIMELINE_RAW: TimelineExtraction = {
  events: [
    {
      date: "Migration 0002",
      event: "FTS5 tables with BM25 ranking introduced",
      sourceId: "src_2",
      quote: MIGRATION
    }
  ]
};

export const DEMO_TABLE_RAW: DataTableExtraction = {
  columns: ["Component", "Role"],
  rows: [
    {
      cells: ["Cloudflare Worker", "single unified entry point"],
      sourceId: "src_1",
      quote: ENTRY_POINT
    },
    { cells: ["NotebookDO", "In-Memory vectors"], sourceId: "src_1", quote: VECTORS },
    { cells: ["FTS5", "BM25 ranking"], sourceId: "src_2", quote: MIGRATION }
  ]
};

export const DEMO_INFOGRAPHIC_RAW: InfographicExtraction = {
  facts: [
    { label: "Vector quantization", value: "int8", sourceId: "src_1", quote: VECTORS },
    { label: "D1 migration", value: "0002", sourceId: "src_2", quote: MIGRATION },
    { label: "Ranking", value: "BM25", sourceId: "src_2", quote: MIGRATION }
  ]
};

/** Prüft die Demo-Vorschläge gegen die Quelltexte, genau wie bei einer echten KI-Antwort. */
export function buildStructuredDemo(
  sources: readonly { readonly id: string; readonly rawText?: string | undefined }[]
): StructuredData {
  const texts = sources.map((s) => ({ id: s.id, text: s.rawText ?? "" }));
  return {
    timeline: normalizeTimeline(DEMO_TIMELINE_RAW, texts).entries,
    table: normalizeDataTable(DEMO_TABLE_RAW, texts).table,
    infographic: normalizeInfographic(DEMO_INFOGRAPHIC_RAW, texts).facts
  };
}
