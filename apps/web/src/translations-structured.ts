/**
 * Bedientexte für Timeline, Infografik und Datentabelle (Issue #239), als Tripel
 * [Schlüssel, Deutsch, Englisch]. Eigene Datei, damit parallele Arbeiten nicht kollidieren.
 * Prüfknöpfe, Status und Belegzeile teilen sich die Schlüssel des Beziehungsgraphen (eg*).
 */

type Entry = readonly [key: string, de: string, en: string];

const ENTRIES: readonly Entry[] = [
  ["toolTimelineTitle", "Timeline", "Timeline"],
  [
    "toolTimelineDesc",
    "Daten und Ereignisse aus den Quellen, zeitlich geordnet, jedes mit Zitat.",
    "Dates and events from your sources in order, each with a quote."
  ],
  ["toolTimelineOpen", "Timeline öffnen", "Open timeline"],
  ["toolInfographicTitle", "Infografik", "Infographic"],
  [
    "toolInfographicDesc",
    "Kennzahlen aus den Quellen als Grafik, Export als SVG oder PNG.",
    "Key figures from your sources as a graphic, export as SVG or PNG."
  ],
  ["toolInfographicOpen", "Infografik öffnen", "Open infographic"],
  ["toolTableTitle", "Datentabelle", "Data table"],
  [
    "toolTableDesc",
    "Strukturierte Tabelle mit Quellenspalte, Export als CSV.",
    "Structured table with a source column, export as CSV."
  ],
  ["toolTableOpen", "Tabelle öffnen", "Open table"],
  ["stCount", "{n} Einträge, {open} zu prüfen", "{n} entries, {open} to review"],
  [
    "stReviewHint",
    "Die KI schlägt jeden Eintrag mit wörtlichem Zitat vor. Abgelehnte Einträge fehlen in Anzeige und Export.",
    "The AI suggests every entry with a verbatim quote. Rejected entries are left out of the view and the export."
  ],
  [
    "stTimelineEmpty",
    "Keine datierten Ereignisse in den ausgewählten Quellen.",
    "No dated events in the selected sources."
  ],
  [
    "stTableEmpty",
    "Keine Tabellenzeilen in den ausgewählten Quellen.",
    "No table rows in the selected sources."
  ],
  [
    "stInfographicEmpty",
    "Keine Kennzahlen in den ausgewählten Quellen.",
    "No key figures in the selected sources."
  ],
  ["stColSource", "Quelle", "Source"],
  ["stColQuote", "Zitat", "Quote"],
  ["stSourcesLabel", "Quellen", "Sources"],
  ["stExportCsv", "CSV", "CSV"],
  ["stExportCsvAria", "Datentabelle als CSV herunterladen", "Download the data table as CSV"],
  ["stExportSvgAria", "Infografik als SVG herunterladen", "Download the infographic as SVG"],
  ["stExportPngAria", "Infografik als PNG herunterladen", "Download the infographic as PNG"],
  ["stInfographicAlt", "Infografik {title}: {facts}", "Infographic {title}: {facts}"],
  [
    "stShowQuoteAria",
    "Zitat in der Quelle {title} zeigen: {name}",
    "Show the quote in source {title}: {name}"
  ]
];

function pick(index: 1 | 2): Record<string, string> {
  return Object.fromEntries(ENTRIES.map((entry) => [entry[0], entry[index] as string]));
}

export const STRUCTURED_DE: Readonly<Record<string, string>> = pick(1);
export const STRUCTURED_EN: Readonly<Record<string, string>> = pick(2);
