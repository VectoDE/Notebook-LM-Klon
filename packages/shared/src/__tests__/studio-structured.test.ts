import { describe, expect, it } from "vitest";
import {
  type DataTable,
  DataTableSchema,
  INFOGRAPHIC_WIDTH,
  type InfographicFact,
  InfographicFactSchema,
  TimelineEntrySchema,
  csvCell,
  dataTableToCsv,
  dateSortKey,
  escapeXml,
  normalizeDataTable,
  normalizeInfographic,
  normalizeTimeline,
  renderInfographicSvg,
  setReviewStatus,
  valueInQuote,
  wrapText
} from "../studio-structured.js";

const SOURCES = [
  {
    id: "a",
    text: "Am 17.05.2024 startete das Projekt. Im Juni 2023 begann die Planung.\nPhase 2 folgte später. Die Quote liegt bei 75 % laut Bericht."
  },
  { id: "b", text: "2022 gründete das Team die Firma. Kosten: 1.200 EUR pro Monat." }
];

describe("Timeline (Issue #239)", () => {
  it("Sortierschlüssel für Datumsformen", () => {
    expect(dateSortKey("2024")).toBe(20240000);
    expect(dateSortKey("2024-05")).toBe(20240500);
    expect(dateSortKey("2024-05-17")).toBe(20240517);
    expect(dateSortKey("17.05.2024")).toBe(20240517);
    expect(dateSortKey("06/2023")).toBe(20230600);
    expect(dateSortKey("Phase 2")).toBeUndefined();
  });

  it("prüft Zitat und Datum im Zitat, sortiert datierte vor undatierten", () => {
    const { entries, dropped } = normalizeTimeline(
      {
        events: [
          { date: "Phase 2", event: "Ausbau", sourceId: "a", quote: "Phase 2 folgte später." },
          {
            date: "17.05.2024",
            event: "Projektstart",
            sourceId: "a",
            quote: "Am 17.05.2024 startete das Projekt."
          },
          {
            date: "2022",
            event: "Gründung",
            sourceId: "b",
            quote: "2022 gründete das Team die Firma."
          },
          { date: "Phase 1", event: "Vorlauf", sourceId: "a", quote: "Phase 2 folgte später." },
          { date: "2021", event: "Erfunden", sourceId: "b", quote: "2021 gab es nichts" },
          { date: "2020", event: "x", sourceId: "zz", quote: "x" },
          { date: " ", event: "leer", sourceId: "a", quote: "Phase" },
          {
            date: "Phase 3",
            event: "Später",
            sourceId: "a",
            quote: "Die Quote liegt bei 75 % laut Bericht."
          },
          {
            date: "2024",
            event: "Gleiches Jahr",
            sourceId: "a",
            quote: "Am 17.05.2024 startete das Projekt."
          },
          { date: "2024", event: "Zweites gleiches Jahr", sourceId: "a", quote: "Am 17.05.2024" }
        ]
      },
      SOURCES
    );
    expect(entries.map((e) => [e.id, e.date, e.event])).toEqual([
      ["tl:1", "2022", "Gründung"],
      ["tl:2", "2024", "Gleiches Jahr"],
      ["tl:3", "2024", "Zweites gleiches Jahr"],
      ["tl:4", "17.05.2024", "Projektstart"],
      ["tl:5", "Phase 2", "Ausbau"]
    ]);
    for (const entry of entries) expect(TimelineEntrySchema.parse(entry)).toEqual(entry);
    expect(entries[3]?.evidence).toEqual({
      sourceId: "a",
      quote: "Am 17.05.2024 startete das Projekt.",
      startOffset: 0,
      endOffset: 35
    });
    expect(dropped).toEqual([
      { index: 3, reason: "valueNotInQuote" },
      { index: 4, reason: "quoteNotFound" },
      { index: 5, reason: "unknownSource" },
      { index: 6, reason: "empty" },
      { index: 7, reason: "valueNotInQuote" }
    ]);
  });

  it("undatierte Einträge behalten die Reihenfolge der Quelle", () => {
    const { entries } = normalizeTimeline(
      {
        events: [
          { date: "Phase 2", event: "B", sourceId: "a", quote: "Phase 2 folgte" },
          { date: "2022", event: "A", sourceId: "b", quote: "2022 gründete" },
          { date: "Phase 2", event: "C", sourceId: "a", quote: "Phase 2 folgte später." }
        ]
      },
      SOURCES
    );
    expect(entries.map((e) => e.event)).toEqual(["A", "B", "C"]);
  });
});

describe("Datentabelle (Issue #239)", () => {
  it("prüft Zellen gegen das Zitat und bringt Zeilen auf Spaltenzahl", () => {
    const { table, dropped } = normalizeDataTable(
      {
        columns: ["Posten", " ", "Wert"],
        rows: [
          { cells: ["Kosten", "1.200 EUR"], sourceId: "b", quote: "Kosten: 1.200 EUR pro Monat." },
          { cells: ["Quote"], sourceId: "a", quote: "Die Quote liegt bei 75 % laut Bericht." },
          {
            cells: ["Quote", "80 %"],
            sourceId: "a",
            quote: "Die Quote liegt bei 75 % laut Bericht."
          },
          { cells: ["", ""], sourceId: "a", quote: "x" },
          { cells: ["x"], sourceId: "zz", quote: "x" },
          { cells: ["x"], sourceId: "a", quote: "nicht vorhanden" }
        ]
      },
      SOURCES
    );
    expect(DataTableSchema.parse(table)).toEqual(table);
    expect(table.columns).toEqual(["Posten", "Wert"]);
    expect(table.rows.map((r) => [r.id, r.cells])).toEqual([
      ["row:1", ["Kosten", "1.200 EUR"]],
      ["row:2", ["Quote", ""]]
    ]);
    expect(dropped.map((d) => d.reason)).toEqual([
      "valueNotInQuote",
      "empty",
      "unknownSource",
      "quoteNotFound"
    ]);
    expect(normalizeDataTable({ columns: [], rows: [] }, SOURCES).table.columns).toEqual(["–"]);
    expect(
      normalizeDataTable(
        { columns: Array.from({ length: 12 }, (_, i) => `S${i}`), rows: [] },
        SOURCES
      ).table.columns
    ).toHaveLength(8);
  });

  it("CSV: Quellen- und Zitatspalte, Maskierung, Formelschutz, ohne Abgelehntes", () => {
    expect(csvCell("einfach")).toBe("einfach");
    expect(csvCell('mit "Anführung", Komma')).toBe('"mit ""Anführung"", Komma"');
    expect(csvCell("Zeile\numbruch")).toBe('"Zeile\numbruch"');
    expect(csvCell("=SUMME(A1)")).toBe("'=SUMME(A1)");
    expect(csvCell("-1;2")).toBe('"\'-1;2"');
    const table: DataTable = {
      columns: ["Posten", "Wert"],
      rows: [
        {
          id: "row:1",
          cells: ["Kosten", "1.200 EUR"],
          status: "confirmed",
          evidence: { sourceId: "b", quote: "Kosten: 1.200 EUR pro Monat." }
        },
        {
          id: "row:2",
          cells: ["weg", "x"],
          status: "rejected",
          evidence: { sourceId: "a", quote: "x" }
        }
      ]
    };
    const csv = dataTableToCsv(table, (id) => (id === "b" ? "Bericht B" : "?"), {
      source: "Quelle",
      quote: "Zitat"
    });
    expect(csv).toBe(
      "﻿Posten,Wert,Quelle,Zitat\r\nKosten,1.200 EUR,Bericht B,Kosten: 1.200 EUR pro Monat.\r\n"
    );
  });
});

describe("Infografik (Issue #239)", () => {
  const facts = normalizeInfographic(
    {
      facts: [
        {
          label: "Quote laut Bericht",
          value: "75 %",
          sourceId: "a",
          quote: "Die Quote liegt bei 75 % laut Bericht."
        },
        {
          label: "Kosten pro Monat",
          value: "1.200 EUR",
          sourceId: "b",
          quote: "Kosten: 1.200 EUR pro Monat."
        },
        {
          label: "Erfunden",
          value: "99 %",
          sourceId: "a",
          quote: "Die Quote liegt bei 75 % laut Bericht."
        },
        { label: "", value: "1", sourceId: "a", quote: "x" },
        { label: "Fehlt", value: "1", sourceId: "zz", quote: "x" },
        {
          label: 'Gründung <Firma> & "Team"',
          value: "2022",
          sourceId: "b",
          quote: "2022 gründete das Team die Firma."
        }
      ]
    },
    SOURCES
  );

  it("prüft Kennzahlen: Wert muss im Zitat stehen", () => {
    expect(facts.facts.map((f) => [f.id, f.value])).toEqual([
      ["fact:1", "75 %"],
      ["fact:2", "1.200 EUR"],
      ["fact:3", "2022"]
    ]);
    for (const f of facts.facts) expect(InfographicFactSchema.parse(f)).toEqual(f);
    expect(facts.dropped.map((d) => d.reason)).toEqual([
      "valueNotInQuote",
      "empty",
      "unknownSource"
    ]);
  });

  const options = {
    title: "Kennzahlen & Fakten",
    lang: "de",
    sourceTitle: (id: string) => (id === "a" ? "Bericht A" : "Bericht B"),
    sourcesLabel: "Quellen",
    emptyText: "Keine Kennzahlen."
  };

  it("SVG: barrierefrei, maskiert, Fußnoten je Quelle, Abgelehntes fehlt", () => {
    const list: InfographicFact[] = setReviewStatus(facts.facts, "fact:2", "rejected");
    const svg = renderInfographicSvg(list, options);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${INFOGRAPHIC_WIDTH}"`);
    expect(svg).toContain('role="img" aria-labelledby="ig-title ig-desc" xml:lang="de"');
    expect(svg).toContain('<title id="ig-title">Kennzahlen &amp; Fakten</title>');
    expect(svg).toContain(
      '<desc id="ig-desc">Quote laut Bericht: 75 %; Gründung &lt;Firma&gt; &amp; &quot;Team&quot;: 2022</desc>'
    );
    expect(svg).not.toContain("1.200 EUR");
    expect(svg).toContain("[1] Bericht A");
    expect(svg).toContain("[2] Bericht B");
    expect(svg.match(/<g transform/g)).toHaveLength(2);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("leere Infografik zeigt einen Hinweis, lange Bezeichnungen brechen um", () => {
    const svg = renderInfographicSvg([], options);
    expect(svg).toContain("Keine Kennzahlen.");
    expect(svg).toContain('<desc id="ig-desc">Keine Kennzahlen.</desc>');
    expect(svg).not.toContain("Quellen</text>");
    const long = renderInfographicSvg(
      [
        {
          ...(facts.facts[0] as InfographicFact),
          label:
            "Eine sehr lange Bezeichnung für eine Kennzahl, die umbrechen muss, damit sie passt"
        }
      ],
      options
    );
    expect(long.match(/font-size="16" fill="#1f2937"/g)).toHaveLength(2);
    expect(wrapText("a b c", 3)).toEqual(["a b", "c"]);
    expect(escapeXml("<&>\"'")).toBe("&lt;&amp;&gt;&quot;&#39;");
    expect(valueInQuote(" ", "x")).toBe(false);
  });
});
