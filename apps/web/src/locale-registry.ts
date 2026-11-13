/**
 * Sammelt zusätzliche Sprachkataloge aus `locales/<locale>.json` (Issue #351).
 * Deutsch und Englisch liegen weiterhin in useTheme.tsx; jede weitere Sprache braucht nur ihre Datei.
 * Die Dateien werden nachgeladen (createLocaleRegistry), nicht ins Start-Bundle gelegt.
 */

import {
  type CatalogMap,
  type I18n,
  type LocaleMeta,
  type MetaMap,
  type TranslationDictionary,
  createI18n
} from "./i18n.js";

/** Rohinhalt einer Katalogdatei: Texte und optional `$meta`. */
export type CatalogFile = Readonly<Record<string, unknown>>;

export const META_KEY = "$meta";

/** Dateipfad `./locales/pt-BR.json` zum Locale-Code `pt-BR`. */
export function localeFromPath(path: string): string {
  return (path.split("/").pop() as string).replace(/\.json$/, "");
}

function splitCatalog(file: CatalogFile): { texts: TranslationDictionary; meta: LocaleMeta } {
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(file)) {
    if (key !== META_KEY && typeof value === "string") texts[key] = value;
  }
  return { texts, meta: (file[META_KEY] ?? {}) as LocaleMeta };
}

/** Baut die i18n-Maschine aus den eingebauten Katalogen und den Katalogdateien (Pfad -> Inhalt). */
export function buildI18n(builtin: CatalogMap, files: Readonly<Record<string, CatalogFile>>): I18n {
  const catalogs: Record<string, TranslationDictionary> = { ...builtin };
  const meta: Record<string, LocaleMeta> = {};
  for (const [path, file] of Object.entries(files)) {
    const locale = localeFromPath(path);
    const parsed = splitCatalog(file);
    catalogs[locale] = parsed.texts;
    meta[locale] = parsed.meta;
  }
  return createI18n({ catalogs, meta: meta as MetaMap });
}

/** Lädt eine Katalogdatei bei Bedarf (dynamischer Import, eigener Chunk). */
export type CatalogLoader = () => Promise<CatalogFile>;

/** Maschine mit nachladbaren Katalogen: eingebaute Sprachen sofort, weitere bei Bedarf. */
export interface LocaleRegistry {
  readonly i18n: I18n;
  /** Locales mit Katalogdatei, ob geladen oder nicht. */
  readonly available: () => string[];
  /** Katalog ist eingebaut oder bereits geladen. */
  readonly isLoaded: (locale: string) => boolean;
  /** Lädt den Katalog (einmal); true, wenn er danach bereitsteht. Fehler: false, späterer Versuch möglich. */
  readonly load: (locale: string) => Promise<boolean>;
  /** Eigene Texte der Locale ohne Rückfall (leer, solange nicht geladen). */
  readonly texts: (locale: string) => TranslationDictionary;
}

/**
 * Wie buildI18n, aber die Katalogdateien kommen erst beim ersten Bedarf (Issue #349): Sie
 * landen nicht im Start-Bundle. Bis dahin gilt der Rückfall je Schlüssel (de-x-ls -> de).
 */
export function createLocaleRegistry(
  builtin: CatalogMap,
  loaders: Readonly<Record<string, CatalogLoader>>
): LocaleRegistry {
  const catalogs: Record<string, TranslationDictionary> = { ...builtin };
  const meta: Record<string, LocaleMeta> = {};
  const byLocale = new Map(
    Object.entries(loaders).map(([path, load]) => [localeFromPath(path), load])
  );
  const pending = new Map<string, Promise<boolean>>();
  const i18n = createI18n({ catalogs, meta: meta as MetaMap });

  const load = (locale: string): Promise<boolean> => {
    if (locale in catalogs) return Promise.resolve(true);
    const loader = byLocale.get(locale);
    if (!loader) return Promise.resolve(false);
    const running = pending.get(locale);
    if (running) return running;
    const task = loader().then(
      (file) => {
        const parsed = splitCatalog(file);
        catalogs[locale] = parsed.texts;
        meta[locale] = parsed.meta;
        pending.delete(locale);
        return true;
      },
      () => {
        pending.delete(locale);
        return false;
      }
    );
    pending.set(locale, task);
    return task;
  };

  return {
    i18n,
    available: () => [...new Set([...Object.keys(builtin), ...byLocale.keys()])],
    isLoaded: (locale) => locale in catalogs,
    load,
    texts: (locale) => catalogs[locale] ?? {}
  };
}

/**
 * Katalogdateien dieses Builds als Lader (nicht eager): Vite legt jede Datei in einen eigenen
 * Chunk, der erst bei Wahl der Sprache geladen wird (Skript-Budget, Issue #349).
 */
export const LOCALE_LOADERS: Readonly<Record<string, CatalogLoader>> =
  import.meta.glob<CatalogFile>("./locales/*.json", { import: "default" });
