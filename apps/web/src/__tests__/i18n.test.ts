import { describe, expect, it } from "vitest";
import {
  type CatalogMap,
  DEFAULT_FALLBACK,
  createI18n,
  directionOf,
  fill,
  parentLocales
} from "../i18n.js";
import {
  LOCALE_LOADERS,
  buildI18n,
  createLocaleRegistry,
  localeFromPath
} from "../locale-registry.js";
import { LANGUAGES } from "../theme-preferences.js";
import { LOCALES, TRANSLATIONS, translate } from "../useTheme.js";

/** Test-Locales: zusätzliche Sprachen nur als Daten, ohne dass i18n.ts davon weiß (Issue #351). */
const catalogs: CatalogMap = {
  de: {
    hello: "Hallo",
    onlyDe: "Nur Deutsch",
    "files.one": "{n} Datei",
    "files.other": "{n} Dateien"
  },
  en: {
    hello: "Hello",
    onlyEn: "Only English",
    "files.one": "{n} file",
    "files.other": "{n} files"
  },
  // unvollständig: nur ein Teil der Schlüssel, Plural mit one/few/many/other
  pl: {
    hello: "Cześć",
    "files.one": "{n} plik",
    "files.few": "{n} pliki",
    "files.many": "{n} plików",
    "files.other": "{n} pliku"
  },
  // Variante: Leichte Sprache baut auf Deutsch auf (Issue #349)
  "de-x-ls": { hello: "Hallo. Schön, dass Sie da sind." },
  // Sprache mit nur einer Pluralkategorie
  ja: { "files.other": "{n}個のファイル" },
  // Sprache mit Rückfall auf Englisch laut Metadaten
  ar: { hello: "مرحبا" }
};

const i18n = createI18n({ catalogs, meta: { ar: { fallback: ["en"] }, "pt-BR": { dir: "rtl" } } });

describe("Rückfallkette pro Schlüssel (Issue #351)", () => {
  it("leitet Eltern-Tags und private Varianten ab", () => {
    expect(parentLocales("de")).toEqual([]);
    expect(parentLocales("pt-BR")).toEqual(["pt"]);
    expect(parentLocales("zh-Hant-TW")).toEqual(["zh-Hant", "zh"]);
    expect(parentLocales("de-x-ls")).toEqual(["de"]);
  });

  it("bildet die Kette Locale, Eltern, Meta-Rückfall, Deutsch, Englisch ohne Doppelte", () => {
    expect(DEFAULT_FALLBACK).toEqual(["de", "en"]);
    expect(i18n.chain("pl")).toEqual(["pl", "de", "en"]);
    expect(i18n.chain("de-x-ls")).toEqual(["de-x-ls", "de", "en"]);
    expect(i18n.chain("ar")).toEqual(["ar", "en", "de"]);
    expect(i18n.chain("en")).toEqual(["en", "de"]);
  });

  it("nimmt den Text der Locale, sonst Eltern, sonst Rückfall je Schlüssel, zuletzt den Schlüssel", () => {
    expect(i18n.translate("pl", "hello")).toBe("Cześć");
    expect(i18n.translate("pl", "onlyDe")).toBe("Nur Deutsch");
    expect(i18n.translate("pl", "onlyEn")).toBe("Only English");
    expect(i18n.translate("de-x-ls", "hello")).toBe("Hallo. Schön, dass Sie da sind.");
    expect(i18n.translate("de-x-ls", "onlyDe")).toBe("Nur Deutsch");
    expect(i18n.translate("ar", "onlyEn")).toBe("Only English");
    expect(i18n.translate("pl", "gibtEsNicht")).toBe("gibtEsNicht");
  });

  it("kennt die Locales mit Katalog und misst die Vollständigkeit ohne Rückfall", () => {
    expect(i18n.locales()).toEqual(["de", "en", "pl", "de-x-ls", "ja", "ar"]);
    expect(i18n.coverage("de", "de")).toBe(1);
    expect(i18n.coverage("pl", "de")).toBeCloseTo(3 / 4);
    expect(i18n.coverage("nirgends", "de")).toBe(0);
    expect(i18n.coverage("de", "nirgends")).toBe(1);
  });
});

describe("Pluralregeln über Intl.PluralRules", () => {
  it("wählt die Kategorie der Sprache und setzt {n} ein", () => {
    expect(i18n.plural("de", "files", 1)).toBe("1 Datei");
    expect(i18n.plural("de", "files", 3)).toBe("3 Dateien");
    expect(i18n.plural("pl", "files", 1)).toBe("1 plik");
    expect(i18n.plural("pl", "files", 3)).toBe("3 pliki");
    expect(i18n.plural("pl", "files", 5)).toBe("5 plików");
    expect(i18n.plural("pl", "files", 1.5)).toBe("1.5 pliku");
    expect(i18n.plural("ja", "files", 1)).toBe("1個のファイル");
  });

  it("fällt bei fehlender Kategorie auf other, dann auf den Rückfall je Schlüssel", () => {
    expect(i18n.plural("de-x-ls", "files", 1)).toBe("1 Datei");
    expect(i18n.plural("ja", "files", 2)).toBe("2個のファイル");
    // ar hat keine Pluraltexte: Englisch aus der Kette
    expect(i18n.plural("ar", "files", 1)).toBe("1 file");
    expect(i18n.plural("ar", "files", 7)).toBe("7 files");
  });

  it("nimmt den Grundschlüssel ohne Kategorie und sonst den Schlüssel, Werte überschreiben {n}", () => {
    const own = createI18n({ catalogs: { de: { plain: "Es sind {n} (Rest: {rest})" } } });
    expect(own.plural("de", "plain", 4, { rest: "x" })).toBe("Es sind 4 (Rest: x)");
    expect(own.plural("de", "fehlt", 4)).toBe("fehlt");
    expect(own.plural("de", "plain", 4, { n: "vier", rest: "x" })).toBe("Es sind vier (Rest: x)");
  });

  it("nennt die Pluralkategorien je Sprache", () => {
    expect(i18n.categories("de")).toEqual(["one", "other"]);
    expect([...i18n.categories("pl")].sort()).toEqual(["few", "many", "one", "other"]);
    expect(i18n.categories("ja")).toEqual(["other"]);
    expect(i18n.categories("de-x-ls")).toEqual(["one", "other"]);
  });
});

describe("Formate über Intl und Schreibrichtung", () => {
  it("formatiert Zahl, Datum und Relativzeit nach der Locale", () => {
    expect(i18n.formatNumber("de", 1234.5)).toBe("1.234,5");
    expect(i18n.formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(i18n.formatNumber("de-x-ls", 1234.5)).toBe("1.234,5");
    const day = new Date(Date.UTC(2026, 10, 13, 12));
    const opts = { timeZone: "UTC", dateStyle: "long" } as const;
    expect(i18n.formatDate("de", day, opts)).toBe("13. November 2026");
    expect(i18n.formatDate("en", day, opts)).toBe("November 13, 2026");
    expect(i18n.formatRelative("de", -2, "day")).toBe("vor 2 Tagen");
    expect(i18n.formatRelative("en", 1, "day", { numeric: "auto" })).toBe("tomorrow");
  });

  it("nimmt für unbekannte Sprachen die Intl-fähige Stufe der Kette, sonst Englisch", () => {
    expect(i18n.formatNumber("xx", 1234.5)).toBe("1.234,5");
    const bare = createI18n({ catalogs: {}, defaultFallback: [] });
    expect(bare.formatNumber("xx", 1234.5)).toBe("1,234.5");
  });

  it("erkennt rechts-nach-links aus der Schrift und achtet Angaben in den Metadaten", () => {
    expect(directionOf("de")).toBe("ltr");
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("he")).toBe("rtl");
    expect(directionOf("fa")).toBe("rtl");
    expect(directionOf("ur-Arab")).toBe("rtl");
    expect(directionOf("zh-Hant-TW")).toBe("ltr");
    expect(directionOf("xx")).toBe("ltr");
    expect(i18n.direction("ar")).toBe("rtl");
    expect(i18n.direction("de-x-ls")).toBe("ltr");
    expect(i18n.direction("pt-BR")).toBe("rtl");
  });

  it("ersetzt Platzhalter und lässt unbekannte stehen", () => {
    expect(fill("{a} und {b}", { a: 1 })).toBe("1 und {b}");
  });
});

describe("Katalogdateien ohne Codeänderung", () => {
  it("liest den Locale-Code aus dem Dateipfad", () => {
    expect(localeFromPath("./locales/pt-BR.json")).toBe("pt-BR");
    expect(localeFromPath("de.json")).toBe("de");
  });

  it("nimmt eine zusätzliche Locale mit unvollständigem Katalog allein aus Daten auf", () => {
    const built = buildI18n(
      {
        de: { a: "Eins", b: "Zwei", "n.one": "{n} Stück", "n.other": "{n} Stücke" },
        en: { a: "One" }
      },
      {
        "./locales/cs.json": {
          $meta: { fallback: ["en"] },
          a: "Jedna",
          "n.one": "{n} kus",
          "n.few": "{n} kusy",
          "n.many": "{n} kusu",
          "n.other": "{n} kusů",
          ignoriert: 42
        },
        "./locales/ar.json": { $meta: { dir: "rtl" }, a: "واحد" },
        "./locales/sv.json": { a: "Ett" }
      }
    );
    expect(built.locales()).toEqual(["de", "en", "cs", "ar", "sv"]);
    expect(built.translate("cs", "a")).toBe("Jedna");
    // fehlender Schlüssel: Rückfall je Schlüssel
    expect(built.translate("cs", "b")).toBe("Zwei");
    expect(built.translate("sv", "b")).toBe("Zwei");
    // Nicht-Texte in der Datei werden ignoriert
    expect(built.translate("cs", "ignoriert")).toBe("ignoriert");
    // Pluralregeln der neuen Sprache
    expect(built.plural("cs", "n", 1)).toBe("1 kus");
    expect(built.plural("cs", "n", 3)).toBe("3 kusy");
    expect(built.plural("cs", "n", 1.5)).toBe("1.5 kusu");
    expect(built.plural("cs", "n", 5)).toBe("5 kusů");
    expect(built.plural("sv", "n", 2)).toBe("2 Stücke");
    expect([...built.categories("cs")].sort()).toEqual(["few", "many", "one", "other"]);
    // Schreibrichtung
    expect(built.direction("ar")).toBe("rtl");
    expect(built.direction("cs")).toBe("ltr");
    expect(built.coverage("cs", "de")).toBeCloseTo(3 / 4);
  });

  it("lädt die Katalogdateien dieses Builds ohne Fehler und mit Text je Schlüssel", async () => {
    expect(Object.keys(LOCALE_LOADERS).length).toBeGreaterThan(0);
    for (const [path, load] of Object.entries(LOCALE_LOADERS)) {
      const locale = localeFromPath(path);
      expect(LOCALES.available(), path).toContain(locale);
      const file = await load();
      for (const [key, value] of Object.entries(file)) {
        if (key !== "$meta") expect(typeof value, `${locale}.${key}`).toBe("string");
      }
    }
  });
});

describe("Nachgeladene Kataloge (Issue #349)", () => {
  const builtin: CatalogMap = { de: { a: "Eins", b: "Zwei" }, en: { a: "One", b: "Two" } };

  it("lädt einen Katalog erst bei Bedarf, einmal, und fällt bis dahin je Schlüssel zurück", async () => {
    let calls = 0;
    const registry = createLocaleRegistry(builtin, {
      "./locales/de-x-ls.json": async () => {
        calls++;
        return { $meta: { fallback: ["de"] }, a: "Eins. Leicht." };
      }
    });
    expect(registry.available()).toEqual(["de", "en", "de-x-ls"]);
    expect(registry.isLoaded("de-x-ls")).toBe(false);
    expect(registry.texts("de-x-ls")).toEqual({});
    expect(registry.i18n.translate("de-x-ls", "a")).toBe("Eins");
    const [first, second] = await Promise.all([registry.load("de-x-ls"), registry.load("de-x-ls")]);
    expect([first, second, calls]).toEqual([true, true, 1]);
    expect(registry.isLoaded("de-x-ls")).toBe(true);
    expect(registry.i18n.translate("de-x-ls", "a")).toBe("Eins. Leicht.");
    expect(registry.i18n.translate("de-x-ls", "b")).toBe("Zwei");
    expect(registry.texts("de-x-ls")).toEqual({ a: "Eins. Leicht." });
    expect(await registry.load("de-x-ls")).toBe(true);
    expect(calls).toBe(1);
  });

  it("meldet eingebaute Sprachen als geladen und unbekannte als nicht ladbar", async () => {
    const registry = createLocaleRegistry(builtin, {});
    expect(await registry.load("de")).toBe(true);
    expect(await registry.load("xx")).toBe(false);
    expect(registry.isLoaded("xx")).toBe(false);
  });

  it("erlaubt nach einem Ladefehler einen neuen Versuch", async () => {
    let fail = true;
    const registry = createLocaleRegistry(builtin, {
      "./locales/cs.json": async () => {
        if (fail) throw new Error("offline");
        return { a: "Jedna" };
      }
    });
    expect(await registry.load("cs")).toBe(false);
    expect(registry.i18n.translate("cs", "a")).toBe("Eins");
    fail = false;
    expect(await registry.load("cs")).toBe(true);
    expect(registry.i18n.translate("cs", "a")).toBe("Jedna");
  });
});

describe("Sichtbare Sprachauswahl (Issue #349)", () => {
  it("bietet Deutsch, Leichte Sprache und Englisch an; eingebaut bleiben nur de und en", () => {
    expect(LANGUAGES).toEqual(["de", "de-x-ls", "en"]);
    expect(Object.keys(TRANSLATIONS).sort()).toEqual(["de", "en"]);
  });

  it("übersetzt mit Rückfall auf Deutsch und den Schlüssel, Leichte Sprache vor dem Laden deutsch", () => {
    expect(translate("en", "skipToContent")).toBe("Skip to content");
    expect(translate("de", "skipToContent")).toBe("Zum Inhalt springen");
    expect(translate("en", "unbekannt")).toBe("unbekannt");
    expect(translate("de-x-ls", "skipToContent")).toBe("Zum Inhalt springen");
  });
});
