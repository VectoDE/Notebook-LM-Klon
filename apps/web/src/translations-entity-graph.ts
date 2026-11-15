/**
 * Bedientexte des Beziehungsgraphen (Issue #238), als Tripel [Schlüssel, Deutsch, Englisch].
 * Eigene Datei, damit parallele Arbeiten an translations-areas.ts nicht kollidieren.
 * Namen, Beziehungen und Zitate stammen aus den Quellen und gehören nicht hierher.
 */

type Entry = readonly [key: string, de: string, en: string];

const ENTRIES: readonly Entry[] = [
  ["egModeLabel", "Art des Graphen", "Graph type"],
  ["egModeConcepts", "Begriffe und Quellen", "Concepts and sources"],
  ["egModeEntities", "Personen, Organisationen, Themen", "People, organizations, topics"],
  [
    "egSub",
    "{entities} Einträge, {relations} Beziehungen, {open} zu prüfen",
    "{entities} entries, {relations} relations, {open} to review"
  ],
  [
    "egIntro",
    "Die KI schlägt Einträge mit wörtlichem Zitat vor. Prüfen Sie jeden Vorschlag: bestätigen, berichtigen oder ablehnen.",
    "The AI suggests entries with a verbatim quote. Review each suggestion: confirm, correct or reject it."
  ],
  ["egKindPerson", "Person", "Person"],
  ["egKindOrganization", "Organisation", "Organization"],
  ["egKindTopic", "Thema", "Topic"],
  ["egKindsPerson", "Personen", "People"],
  ["egKindsOrganization", "Organisationen", "Organizations"],
  ["egKindsTopic", "Themen", "Topics"],
  ["egKindCount", "{label} ({n})", "{label} ({n})"],
  ["egFilterLegend", "Filter", "Filter"],
  ["egFilterKinds", "Arten", "Types"],
  ["egFilterStatus", "Prüfstatus", "Review status"],
  ["egStatusOpen", "Alle außer abgelehnten", "All except rejected"],
  ["egStatusSuggested", "Zu prüfen", "To review"],
  ["egStatusConfirmed", "Bestätigt", "Confirmed"],
  ["egStatusRejected", "Abgelehnt", "Rejected"],
  ["egSvgLabel", "Beziehungsgraph als Grafik", "Relationship graph as a graphic"],
  [
    "egVisualHint",
    "Pfeiltasten wechseln zwischen den Einträgen, Eingabe oder Leertaste zeigt Beziehungen und Zitate. Die Liste enthält denselben Inhalt als Text und die Prüfung.",
    "Arrow keys move between entries, Enter or Space shows relations and quotes. The list holds the same content as text, plus the review."
  ],
  [
    "egNodeAria",
    "{name}, {kind}, {status}, {n} Beziehungen",
    "{name}, {kind}, {status}, {n} relations"
  ],
  ["egLegendPerson", "Rund: Person", "Round: person"],
  ["egLegendOrganization", "Eckig: Organisation", "Square: organization"],
  ["egLegendTopic", "Leicht abgerundet: Thema", "Slightly rounded: topic"],
  ["egLegendConfirmed", "Durchgezogen: bestätigt", "Solid: confirmed"],
  ["egLegendSuggested", "Gestrichelt: zu prüfen", "Dashed: to review"],
  [
    "egDetailsEmpty",
    "Wählen Sie einen Eintrag, um seine Beziehungen und Belege zu sehen.",
    "Select an entry to see its relations and evidence."
  ],
  ["egRelations", "Beziehungen", "Relations"],
  ["egNoRelations", "Keine sichtbare Beziehung.", "No visible relation."],
  ["egEvidence", "Beleg aus „{title}“", "Evidence from “{title}”"],
  ["egShowQuote", "Im Quelltext zeigen", "Show in source"],
  [
    "egShowQuoteAria",
    "Zitat in der Quelle {title} zeigen: {relation}",
    "Show the quote in source {title}: {relation}"
  ],
  ["egUnknownSource", "unbekannte Quelle", "unknown source"],
  ["egConfirm", "Bestätigen", "Confirm"],
  ["egReject", "Ablehnen", "Reject"],
  ["egRestore", "Wiederherstellen", "Restore"],
  ["egEdit", "Berichtigen", "Correct"],
  ["egSave", "Speichern", "Save"],
  ["egCancel", "Abbrechen", "Cancel"],
  ["egConfirmAria", "{name} bestätigen", "Confirm {name}"],
  ["egRejectAria", "{name} ablehnen", "Reject {name}"],
  ["egRestoreAria", "{name} wiederherstellen", "Restore {name}"],
  ["egEditAria", "{name} berichtigen", "Correct {name}"],
  ["egNameLabel", "Name", "Name"],
  ["egKindLabel", "Art", "Type"],
  ["egRelationLabel", "Beziehung", "Relation"],
  ["egAnnounceConfirmed", "Bestätigt: {name}", "Confirmed: {name}"],
  ["egAnnounceRejected", "Abgelehnt: {name}", "Rejected: {name}"],
  ["egAnnounceRestored", "Wiederhergestellt: {name}", "Restored: {name}"],
  ["egAnnounceSaved", "Berichtigt: {name}", "Corrected: {name}"],
  ["egListRelations", "Beziehungen mit Beleg", "Relations with evidence"],
  [
    "egEmpty",
    "Keine Einträge für diesen Filter. Ändern Sie Arten oder Prüfstatus.",
    "No entries for this filter. Change the types or review status."
  ],
  ["egSelected", "Ausgewählt: {name}", "Selected: {name}"]
];

function pick(index: 1 | 2): Record<string, string> {
  return Object.fromEntries(ENTRIES.map((entry) => [entry[0], entry[index] as string]));
}

export const ENTITY_GRAPH_DE: Readonly<Record<string, string>> = pick(1);
export const ENTITY_GRAPH_EN: Readonly<Record<string, string>> = pick(2);
