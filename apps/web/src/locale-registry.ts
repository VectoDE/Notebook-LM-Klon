/**
 * Sammelt zusätzliche Sprachkataloge aus `locales/<locale>.json` (Issue #351).
 * Deutsch und Englisch liegen weiterhin in useTheme.tsx; jede weitere Sprache braucht nur ihre Datei.
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

/** Katalogdateien dieses Builds; leer, solange nur Deutsch und Englisch vorhanden sind. */
export const LOCALE_FILES: Readonly<Record<string, CatalogFile>> = import.meta.glob<CatalogFile>(
  "./locales/*.json",
  { eager: true, import: "default" }
);
