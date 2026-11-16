import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { LANGUAGE_NAMES, SettingsDrawer } from "../SettingsDrawer.js";
import { COMMENTS_DE, COMMENTS_EN, commentTexts } from "../translations-comments.js";
import {
  OFFLINE_CHAT_DE,
  OFFLINE_CHAT_EN,
  offlineChatTexts
} from "../translations-offline-chat.js";
import {
  LOCALES,
  TRANSLATIONS,
  ThemeProvider,
  type ThemeProviderProps,
  translate
} from "../useTheme.js";

/**
 * Leichte Sprache (Issue #349): Der Katalog locales/de-x-ls.json übersetzt jeden Schlüssel der
 * Oberfläche. Der Rückfall auf Deutsch ist nur Sicherheitsnetz. Je Schlüssel wird geprüft, dass
 * er vorhanden ist, die Platzhalter stimmen und prüfbare Regeln eingehalten sind (Netzwerk
 * Leichte Sprache, DIN SPEC 33429:2025-03; Checkliste in docs/leichte-sprache.md).
 */

const raw = JSON.parse(
  readFileSync(new URL("../locales/de-x-ls.json", import.meta.url), "utf8")
) as Record<string, unknown>;
const { $meta, ...ls } = raw as { $meta: unknown } & Record<string, string>;

/** Alle Oberflächentexte auf Deutsch: Hauptkatalog und nachgeladene Kataloge (Kommentare, Offline-Chat). */
const GERMAN: Readonly<Record<string, string>> = {
  ...TRANSLATIONS.de,
  ...COMMENTS_DE,
  ...OFFLINE_CHAT_DE
};
const KEYS = Object.keys(GERMAN);

/** Markennamen, die länger als 16 Buchstaben sein dürfen, ohne Mediopunkt. */
const BRANDS = new Set(["RelationNotes", "RelationFlow", "NotebookLM"]);

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");
const sentences = (s: string) =>
  s.split(/(?<=[.!?:])\s+|\n+/).filter((x) => /[\p{L}\p{N}]/u.test(x));
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

/** Prüfbare Regeln; was nur ein Mensch beurteilen kann, steht in der Checkliste der Doku. */
function ruleProblems(german: string, easy: string): string[] {
  const problems: string[] = [];
  if (easy.trim() === "") return ["leer"];
  if (placeholders(german) !== placeholders(easy)) problems.push("Platzhalter weichen ab");
  if (easy.includes(";")) problems.push("Semikolon");
  if (
    /(^|[\s(])(z\. ?B\.|d\. ?h\.|bzw\.|ggf\.|usw\.|u\. ?a\.|inkl\.|ca\.|evtl\.|etc\.)/i.test(easy)
  )
    problems.push("Abkürzung");
  if (/\b(würden?|könnten?|hätten?|wären?|müssten?|sollten?)\b/i.test(easy))
    problems.push("Konjunktiv");
  if (/\bweder\b/i.test(easy)) problems.push("weder/noch");
  if (/,\s*(weil|dass|damit|obwohl|falls|nachdem|sodass|wenn|welche[rsmn]?)\b/i.test(easy))
    problems.push("Neben-Satz");
  for (const sentence of sentences(easy)) {
    const count = words(sentence).length;
    if (count > 15) problems.push(`Satz mit ${count} Wörtern: ${sentence}`);
    const negations = sentence.match(/\b(nicht|kein\w*|nie|niemals|nichts)\b/gi) ?? [];
    if (negations.length > 1) problems.push(`Verneinungskette: ${sentence}`);
  }
  for (const word of easy.split(/[^\p{L}·-]+/u)) {
    for (const part of word.split("-")) {
      if (part.length > 16 && !part.includes("·") && !BRANDS.has(part))
        problems.push(`langes Wort ohne Mediopunkt: ${part}`);
    }
  }
  const isLabel = german.length <= 25 && !/[.!?]$/.test(german.trim());
  if (isLabel && easy.length > Math.max(Math.ceil(german.length * 1.6), 20))
    problems.push(`Beschriftung zu lang (${easy.length} statt ${german.length} Zeichen)`);
  return problems;
}

describe("Katalog Leichte Sprache: Aufbau", () => {
  it("fällt laut Metadaten auf Deutsch zurück", () => {
    expect($meta).toEqual({ fallback: ["de"] });
  });

  it("enthält keine Schlüssel, die es auf Deutsch nicht gibt", () => {
    expect(Object.keys(ls).filter((key) => !(key in GERMAN))).toEqual([]);
  });

  it("deckt jeden deutschen Schlüssel ab (Abdeckung 100 %)", () => {
    expect(KEYS.filter((key) => !(key in ls))).toEqual([]);
    expect(KEYS.length).toBeGreaterThan(500);
  });
});

describe("Katalog Leichte Sprache: je Schlüssel", () => {
  it.each(KEYS)("%s: übersetzt, Platzhalter gleich, prüfbare Regeln erfüllt", (key) => {
    const easy = ls[key];
    expect(typeof easy, key).toBe("string");
    expect(ruleProblems(GERMAN[key] as string, easy as string), key).toEqual([]);
  });
});

describe("Prüfregeln erkennen Verstöße", () => {
  it.each([
    ["Datei", "Datei;", "Semikolon"],
    ["Text", "Zum Beispiel z. B. so", "Abkürzung"],
    ["Text", "Das würde gehen.", "Konjunktiv"],
    ["Text", "Weder heute noch morgen.", "weder/noch"],
    ["Text", "Es geht, weil es geht.", "Neben-Satz"],
    ["{n} Quellen", "Quellen", "Platzhalter weichen ab"],
    ["Text", "Das ist nicht kein Fehler.", "Verneinungskette: Das ist nicht kein Fehler."],
    [
      "Text",
      "Die Bundesgleichstellungsgesetze",
      "langes Wort ohne Mediopunkt: Bundesgleichstellungsgesetze"
    ],
    [
      "Quelle",
      "Eine sehr lange Beschriftung für den Knopf",
      "Beschriftung zu lang (42 statt 6 Zeichen)"
    ],
    ["Text", " ", "leer"]
  ])("%s -> %s", (german, easy, expected) => {
    expect(ruleProblems(german, easy)).toContain(expected);
  });

  it("lässt kurze, aktive Sätze, Mediopunkte und Markennamen zu", () => {
    expect(ruleProblems("Lernkarten", "Lern·karten")).toEqual([]);
    expect(
      ruleProblems("Text.", "RelationNotes speichert die Bundes·gleichstellungs·gesetze.")
    ).toEqual([]);
    const long =
      "Eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn.";
    expect(ruleProblems("Text.", long)[0]).toMatch(/^Satz mit 16 Wörtern/);
  });
});

describe("Leichte Sprache in der Oberfläche", () => {
  beforeAll(async () => {
    expect(await LOCALES.load("de-x-ls")).toBe(true);
  });

  it("liefert nach dem Laden die Texte in Leichter Sprache", () => {
    expect(translate("de-x-ls", "settingsTitle")).toBe(ls.settingsTitle);
    expect(translate("de-x-ls", "languageHint")).toBe(ls.languageHint);
    expect(translate("de-x-ls", "languageHint")).not.toBe(TRANSLATIONS.de.languageHint);
  });

  it("zeigt die drei Sprachen in den Einstellungen, jeweils mit lang der Dokumentsprache", () => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { defaultLanguage: "de-x-ls" } as ThemeProviderProps,
        createElement(SettingsDrawer, { isOpen: true, onClose: () => {} })
      )
    );
    for (const lang of ["de", "de-x-ls", "en"]) {
      expect(html).toContain(`data-testid="lang-option-${lang}"`);
    }
    expect(html).toContain('<span lang="de">Deutsch – Leichte Sprache</span>');
    expect(html).toContain('<span lang="de">Deutsch</span>');
    expect(html).toContain('<span lang="en">English</span>');
    expect(html).toMatch(/name="settings-language" checked="" value="de-x-ls"/);
    expect(html).toContain(ls.languageHint as string);
    expect(LANGUAGE_NAMES).toEqual({
      de: "Deutsch",
      "de-x-ls": "Deutsch – Leichte Sprache",
      en: "English"
    });
  });

  it("nimmt für Kommentare die Texte in Leichter Sprache, Englisch bleibt Englisch", () => {
    const texts = commentTexts("de-x-ls", LOCALES.texts("de-x-ls"));
    expect(Object.keys(texts).sort()).toEqual(Object.keys(COMMENTS_DE).sort());
    for (const key of Object.keys(COMMENTS_DE)) expect(texts[key], key).toBe(ls[key]);
    expect(commentTexts("de")).toEqual(COMMENTS_DE);
    expect(commentTexts("en", LOCALES.texts("de-x-ls"))).toBe(COMMENTS_EN);
  });

  it("nimmt für den Offline-Chat die Texte in Leichter Sprache, Englisch bleibt Englisch (#346)", () => {
    const texts = offlineChatTexts("de-x-ls", LOCALES.texts("de-x-ls"));
    expect(Object.keys(texts).sort()).toEqual(Object.keys(OFFLINE_CHAT_DE).sort());
    for (const key of Object.keys(OFFLINE_CHAT_DE)) expect(texts[key], key).toBe(ls[key]);
    expect(offlineChatTexts("de")).toBe(OFFLINE_CHAT_DE);
    expect(offlineChatTexts("en", LOCALES.texts("de-x-ls"))).toBe(OFFLINE_CHAT_EN);
  });
});
