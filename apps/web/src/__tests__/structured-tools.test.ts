import {
  DataTableSchema,
  InfographicFactSchema,
  TimelineEntrySchema,
  locateQuote,
  normalizeDataTable,
  normalizeInfographic,
  normalizeTimeline,
  setReviewStatus
} from "@notebook-lm/shared";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { DataTableViewer, InfographicViewer, TimelineViewer } from "../StructuredTools.js";
import { StudioPanel, type StudioTool } from "../StudioPanel.js";
import { DEFAULT_SOURCES } from "../WorkspaceLayout.js";
import { preloadStudioViewers } from "../lazy-viewers.js";
import {
  DEMO_INFOGRAPHIC_RAW,
  DEMO_TABLE_RAW,
  DEMO_TIMELINE_RAW,
  buildStructuredDemo
} from "../structured-demo.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

beforeAll(() => preloadStudioViewers());

const DEMO = buildStructuredDemo(DEFAULT_SOURCES);
const TEXTS = DEFAULT_SOURCES.map((s) => ({ id: s.id, text: s.rawText ?? "" }));
const noop = () => undefined;
const common = {
  title: "Demo",
  sources: DEFAULT_SOURCES,
  contentLang: "en",
  onStatus: noop
};

function renderEn(child: ReactNode): string {
  return renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, child)
  );
}

describe("Demo-Daten für Timeline, Tabelle, Infografik (Issue #239)", () => {
  it("jeder Demo-Vorschlag besteht die Zitat- und Wertprüfung, nichts fällt weg", () => {
    expect(normalizeTimeline(DEMO_TIMELINE_RAW, TEXTS).dropped).toEqual([]);
    expect(normalizeDataTable(DEMO_TABLE_RAW, TEXTS).dropped).toEqual([]);
    expect(normalizeInfographic(DEMO_INFOGRAPHIC_RAW, TEXTS).dropped).toEqual([]);
    expect(DEMO.timeline.map((e) => e.date)).toEqual(["Migration 0002"]);
    expect(DataTableSchema.parse(DEMO.table)).toEqual(DEMO.table);
    expect(DEMO.table.rows).toHaveLength(3);
    expect(DEMO.infographic.map((f) => f.value)).toEqual(["int8", "0002", "BM25"]);
    for (const e of DEMO.timeline) expect(TimelineEntrySchema.parse(e)).toEqual(e);
    for (const f of DEMO.infographic) expect(InfographicFactSchema.parse(f)).toEqual(f);
    // Jedes Zitat steht wörtlich in seiner Quelle (für die Markierung beim Sprung)
    for (const item of [...DEMO.timeline, ...DEMO.table.rows, ...DEMO.infographic]) {
      const text = TEXTS.find((s) => s.id === item.evidence.sourceId)?.text ?? "";
      expect(locateQuote(text, item.evidence.quote)).toBeDefined();
      expect(text.includes(item.evidence.quote)).toBe(true);
      expect(item.status).toBe("suggested");
    }
  });

  it("ohne Quelltext bleibt die Demo leer", () => {
    const empty = buildStructuredDemo([{ id: "src_1" }, { id: "src_2", rawText: "" }]);
    expect(empty.timeline).toEqual([]);
    expect(empty.table.rows).toEqual([]);
    expect(empty.infographic).toEqual([]);
  });
});

describe("Ansichten (Issue #239)", () => {
  it("Timeline: geordnete Liste, Datum, Ereignis, Zitat, Quelle und Prüfknöpfe", () => {
    const html = renderToStaticMarkup(
      createElement(TimelineViewer, { ...common, entries: DEMO.timeline })
    );
    expect(html).toContain('data-testid="timeline-viewer"');
    expect(html).toContain('<ol class="rn-st-timeline">');
    expect(html).toContain("Migration 0002");
    expect(html).toContain("1 Einträge, 1 zu prüfen");
    expect(html).toContain(
      '<blockquote lang="en">D1 Migration 0002 introduces FTS5 tables with BM25 ranking for hybrid lexical and vector search.</blockquote>'
    );
    expect(html).toContain("Beleg aus „D1 SQLite Relational &amp; FTS5 Hybrid Search“");
    expect(html).toContain(
      'aria-label="Migration 0002: FTS5 tables with BM25 ranking introduced bestätigen"'
    );
    expect(html).toContain("Im Quelltext zeigen");
    const empty = renderToStaticMarkup(createElement(TimelineViewer, { ...common, entries: [] }));
    expect(empty).toContain("Keine datierten Ereignisse");
  });

  it("Datentabelle: Kopfzellen mit scope, Zeilenkopf, Quellenspalte, CSV-Knopf", () => {
    const html = renderToStaticMarkup(
      createElement(DataTableViewer, { ...common, table: DEMO.table })
    );
    expect(html).toContain('<th scope="col" lang="en">Component</th>');
    expect(html).toContain('<th scope="col">Quelle</th>');
    expect(html).toContain('<th scope="row" lang="en">Cloudflare Worker</th>');
    expect(html).toMatch(/<caption id="[^"]+" class="rn-visually-hidden">Datentabelle<\/caption>/);
    expect(html).toContain('aria-label="Datentabelle als CSV herunterladen"');
    expect(html).toContain("3 Einträge, 3 zu prüfen");
    const rejected = setReviewStatus(DEMO.table.rows, "row:1", "rejected");
    const after = renderToStaticMarkup(
      createElement(DataTableViewer, { ...common, table: { ...DEMO.table, rows: rejected } })
    );
    expect(after).toContain('data-status="rejected"');
    expect(after).toContain("Wiederherstellen");
    const empty = renderToStaticMarkup(
      createElement(DataTableViewer, { ...common, table: { columns: ["–"], rows: [] } })
    );
    expect(empty).toContain("Keine Tabellenzeilen");
  });

  it("Infografik: Bild mit Alternativtext aus den Kennzahlen, Export SVG und PNG", () => {
    const html = renderToStaticMarkup(
      createElement(InfographicViewer, { ...common, facts: DEMO.infographic })
    );
    expect(html).toContain('src="data:image/svg+xml;charset=utf-8,%3Csvg');
    expect(html).toContain(
      'alt="Infografik Demo: Vector quantization: int8; D1 migration: 0002; Ranking: BM25"'
    );
    expect(html).toContain('aria-label="Infografik als SVG herunterladen"');
    expect(html).toContain('aria-label="Infografik als PNG herunterladen"');
    const rejected = setReviewStatus(DEMO.infographic, "fact:1", "rejected");
    const after = renderToStaticMarkup(
      createElement(InfographicViewer, { ...common, facts: rejected })
    );
    expect(after).toContain('alt="Infografik Demo: D1 migration: 0002; Ranking: BM25"');
    const empty = renderToStaticMarkup(createElement(InfographicViewer, { ...common, facts: [] }));
    expect(empty).toContain('alt="Infografik Demo: Keine Kennzahlen in den ausgewählten Quellen."');
  });

  it("englische Oberfläche", () => {
    const html = renderEn(createElement(DataTableViewer, { ...common, table: DEMO.table }));
    expect(html).toContain('<th scope="col">Source</th>');
    expect(html).toContain("Download the data table as CSV");
    expect(html).toContain("Evidence from “Cloudflare Worker &amp; DO Architecture”");
    const tl = renderEn(createElement(TimelineViewer, { ...common, entries: DEMO.timeline }));
    expect(tl).toContain("1 entries, 1 to review");
    const ig = renderEn(createElement(InfographicViewer, { ...common, facts: DEMO.infographic }));
    expect(ig).toContain("Download the infographic as PNG");
  });
});

describe("Studio: drei Werkzeuge neben den anderen (Issue #239)", () => {
  const panel = (activeTool: StudioTool, withData = true) =>
    renderToStaticMarkup(
      createElement(StudioPanel, {
        activeTool,
        structuredData: withData ? DEMO : undefined,
        structuredSources: DEFAULT_SOURCES,
        structuredLang: "en"
      })
    );

  it("Übersicht listet Timeline, Infografik und Tabelle nur mit Daten", () => {
    const html = panel("overview");
    for (const id of ["timeline", "infographic", "table"]) {
      expect(html).toContain(`data-testid="tool-card-${id}"`);
      expect(html).toContain(`data-testid="btn-open-${id}-tool"`);
    }
    expect(html).toContain('data-testid="tool-card-quiz"');
    const without = panel("overview", false);
    expect(without).not.toContain("tool-card-timeline");
  });

  it("jedes Werkzeug öffnet seine eigene Ansicht (nachgeladen)", () => {
    expect(panel("timeline")).toContain('data-testid="timeline-viewer"');
    expect(panel("table")).toContain('data-testid="datatable-viewer"');
    expect(panel("infographic")).toContain('data-testid="infographic-viewer"');
    expect(panel("table", false)).not.toContain("datatable-viewer");
  });
});
