/**
 * Locale-neutrale i18n-Maschine (Issue #351).
 *
 * Neue Sprachen kommen ohne Codeänderung dazu: eine Datei `locales/<code>.json` genügt
 * (siehe locale-registry.ts und docs/i18n.md). Dieses Modul kennt keine feste Sprachliste.
 *
 * - Katalog je Locale: flache Schlüssel/Text-Tabelle, darf unvollständig sein.
 * - Rückfall pro Schlüssel über eine feste Kette: Locale, Eltern-Tags (de-x-ls -> de, pt-BR -> pt),
 *   die in den Metadaten genannten Rückfall-Locales, danach der Standardrückfall (Deutsch, Englisch).
 * - Plural über Intl.PluralRules: Schlüssel `<key>.<kategorie>` (zero, one, two, few, many, other).
 * - Zahlen, Datum und Relativzeit über Intl, Schreibrichtung über Intl.Locale.
 */

export interface TranslationDictionary {
  readonly [key: string]: string;
}

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/** Zusatzangaben je Locale; alles optional. */
export interface LocaleMeta {
  /** Rückfall-Locales vor dem Standardrückfall, in dieser Reihenfolge. */
  readonly fallback?: readonly string[];
  /** Schreibrichtung; fehlt sie, wird sie aus der Sprache abgeleitet. */
  readonly dir?: "ltr" | "rtl";
}

export type CatalogMap = Readonly<Record<string, TranslationDictionary>>;
export type MetaMap = Readonly<Record<string, LocaleMeta>>;

export interface I18nOptions {
  readonly catalogs: CatalogMap;
  readonly meta?: MetaMap | undefined;
  /** Letzte Stufen der Rückfallkette für jede Locale. Standard: Deutsch, dann Englisch. */
  readonly defaultFallback?: readonly string[] | undefined;
}

export const DEFAULT_FALLBACK: readonly string[] = ["de", "en"] as const;

/** Eltern-Tags einer Locale, vom spezifischen zum allgemeinen: "de-x-ls" -> ["de"], "zh-Hant-TW" -> ["zh-Hant", "zh"]. */
export function parentLocales(locale: string): string[] {
  const base = locale.split("-x-")[0] as string;
  const parts = base.split("-");
  const parents: string[] = [];
  for (let n = parts.length; n >= 1; n--) {
    const tag = parts.slice(0, n).join("-");
    if (tag !== locale) parents.push(tag);
  }
  return parents;
}

const RTL_SCRIPTS: ReadonlySet<string> = new Set(["Arab", "Hebr", "Thaa", "Syrc", "Nkoo", "Adlm"]);
/** Schreibrichtung aus der Schrift der Locale (bei Bedarf über die wahrscheinlichste Schrift der Sprache). */
export function directionOf(locale: string): "ltr" | "rtl" {
  const loc = new Intl.Locale(locale);
  const script = loc.script ?? loc.maximize().script;
  return script !== undefined && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
}

/** Setzt Werte für Platzhalter wie {n} ein; unbekannte Platzhalter bleiben stehen. */
export function fill(text: string, vars: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}

export interface I18n {
  /** Locales, die einen Katalog haben. */
  readonly locales: () => string[];
  /** Rückfallkette einer Locale, ohne Doppelte, beginnend mit der Locale selbst. */
  readonly chain: (locale: string) => string[];
  /** Text zum Schlüssel; fehlt er in der ganzen Kette, der Schlüssel selbst. */
  readonly translate: (locale: string, key: string) => string;
  /** Plural: wählt `<key>.<kategorie>` nach Intl.PluralRules, sonst `.other`, sonst den Rückfall. */
  readonly plural: (
    locale: string,
    key: string,
    count: number,
    vars?: Readonly<Record<string, string | number>>
  ) => string;
  /** Pluralkategorien, die die Sprache kennt (z. B. pl: one, few, many, other). */
  readonly categories: (locale: string) => PluralCategory[];
  readonly direction: (locale: string) => "ltr" | "rtl";
  /** Anteil der Schlüssel der Bezugs-Locale, die die Locale selbst (ohne Rückfall) übersetzt. */
  readonly coverage: (locale: string, reference: string) => number;
  readonly formatNumber: (
    locale: string,
    value: number,
    options?: Intl.NumberFormatOptions
  ) => string;
  readonly formatDate: (
    locale: string,
    value: Date | number,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  readonly formatRelative: (
    locale: string,
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions
  ) => string;
}

export function createI18n(options: I18nOptions): I18n {
  const { catalogs } = options;
  const meta = options.meta ?? {};
  const defaults = options.defaultFallback ?? DEFAULT_FALLBACK;

  const chain = (locale: string): string[] => {
    const own = [locale, ...parentLocales(locale)];
    const extra = own.flatMap((l) => meta[l]?.fallback ?? []);
    const all = [...own, ...extra, ...defaults];
    return all.filter((l, i) => all.indexOf(l) === i);
  };

  const lookup = (locale: string, key: string): string | undefined => {
    for (const l of chain(locale)) {
      const text = catalogs[l]?.[key];
      if (text !== undefined) return text;
    }
    return undefined;
  };

  /** Intl-taugliche Locale: die erste der Kette, die Intl kennt, sonst Englisch. */
  const intlLocale = (locale: string): string =>
    chain(locale).find((l) => Intl.NumberFormat.supportedLocalesOf(l).length > 0) ?? "en";

  const categories = (locale: string): PluralCategory[] =>
    new Intl.PluralRules(intlLocale(locale)).resolvedOptions().pluralCategories as PluralCategory[];

  return {
    locales: () => Object.keys(catalogs),
    chain,
    translate: (locale, key) => lookup(locale, key) ?? key,
    plural: (locale, key, count, vars = {}) => {
      const category = new Intl.PluralRules(intlLocale(locale)).select(count);
      const text =
        lookup(locale, `${key}.${category}`) ??
        lookup(locale, `${key}.other`) ??
        lookup(locale, key);
      return fill(text ?? key, { n: count, ...vars });
    },
    categories,
    direction: (locale) =>
      chain(locale)
        .map((l) => meta[l]?.dir)
        .find((d) => d !== undefined) ?? directionOf(intlLocale(locale)),
    coverage: (locale, reference) => {
      const keys = Object.keys(catalogs[reference] ?? {});
      if (keys.length === 0) return 1;
      const own = catalogs[locale] ?? {};
      return keys.filter((k) => k in own).length / keys.length;
    },
    formatNumber: (locale, value, opts) =>
      new Intl.NumberFormat(intlLocale(locale), opts).format(value),
    formatDate: (locale, value, opts) =>
      new Intl.DateTimeFormat(intlLocale(locale), opts).format(value),
    formatRelative: (locale, value, unit, opts) =>
      new Intl.RelativeTimeFormat(intlLocale(locale), opts).format(value, unit)
  };
}
