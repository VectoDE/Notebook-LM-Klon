/**
 * Sprachvarianten der Diagramme und des Hero-Banners (Issue #354).
 *
 * Quelle sind die deutschen SVGs unter docs/assets/src, die Texte liegen als Schlüssel mit
 * Deutsch und Englisch in docs/assets/i18n/strings.json. Daraus entstehen je Quelldatei:
 * - <name>-de…svg und <name>-en…svg für die manuelle Wahl der Sprache,
 * - <name>…svg mit <switch>/systemLanguage, das der Browser nach seiner Sprache auflöst
 *   (Deutsch bei systemLanguage "de", sonst Englisch).
 *
 * Erzeugen: node apps/web/scripts/build-diagrams.ts, prüfen: … --check
 */

export type DiagramLanguage = "de" | "en";

export interface Phrase {
  readonly de: string;
  readonly en: string;
}

export interface DiagramStrings {
  readonly title: Phrase;
  readonly desc: Phrase;
  /** Texte in Dokumentreihenfolge; leer, wenn die Quelle die Sprachen selbst per <switch> trägt. */
  readonly texts: Readonly<Record<string, Phrase>>;
}

const XML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};

/** Textinhalt für XML maskieren (&, <, >). */
export function encodeXml(text: string): string {
  return text.replace(/[&<>]/g, (c) => XML_ESCAPES[c] as string);
}

/** Benannte und numerische XML-Entitäten auflösen. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    }
    if (ref.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    }
    return XML_ENTITIES[ref] ?? match;
  });
}

const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;

/** Alle Textinhalte (dekodiert) in Dokumentreihenfolge. */
export function extractTexts(svg: string): string[] {
  return [...svg.matchAll(TEXT_RE)].map((m) => decodeXml(m[2] as string));
}

function replaceElement(
  svg: string,
  tag: "title" | "desc",
  phrase: Phrase,
  render: (phrase: Phrase) => string
): string {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`);
  const match = re.exec(svg);
  if (!match) {
    throw new Error(`<${tag}> fehlt`);
  }
  if (decodeXml(match[2] as string) !== phrase.de) {
    throw new Error(`<${tag}> weicht vom Katalog ab: ${match[2]}`);
  }
  return svg.replace(re, `<${tag}$1>${encodeXml(render(phrase))}</${tag}>`);
}

function replaceTexts(
  svg: string,
  strings: DiagramStrings,
  render: (attrs: string, p: Phrase) => string
): string {
  const phrases = Object.values(strings.texts);
  if (phrases.length === 0) {
    return svg;
  }
  const found = extractTexts(svg).length;
  if (found !== phrases.length) {
    throw new Error(`Katalog hat ${phrases.length} Texte, Quelle ${found}`);
  }
  let index = 0;
  return svg.replace(TEXT_RE, (_match, attrs: string, content: string) => {
    const phrase = phrases[index++] as Phrase;
    if (decodeXml(content) !== phrase.de) {
      throw new Error(`Text ${index} weicht vom Katalog ab: ${content}`);
    }
    return render(attrs, phrase);
  });
}

/** Direkte <g>-Kinder eines <switch>-Inhalts mit ihren Attributen. */
export function switchChildren(inner: string): { attrs: string; raw: string }[] {
  const children: { attrs: string; raw: string }[] = [];
  const tag = /<(\/?)g\b([^>]*)>/g;
  let depth = 0;
  let start = 0;
  let attrs = "";
  for (const m of inner.matchAll(tag)) {
    const closing = m[1] === "/";
    const selfClosing = !closing && (m[2] as string).endsWith("/");
    if (!closing && !selfClosing) {
      if (depth === 0) {
        start = m.index;
        attrs = m[2] as string;
      }
      depth++;
    } else if (closing) {
      depth--;
      if (depth === 0) {
        children.push({ attrs, raw: inner.slice(start, m.index + m[0].length) });
      }
    }
  }
  return children;
}

/** Jedes <switch> auf den Zweig der gewünschten Sprache reduzieren (ohne systemLanguage). */
export function resolveSwitches(svg: string, lang: DiagramLanguage): string {
  return svg.replace(/<switch>([\s\S]*?)<\/switch>/g, (_m, inner: string) => {
    const children = switchChildren(inner);
    const wanted = children.find((c) => c.attrs.includes(`systemLanguage="${lang}"`));
    const fallback = children.find((c) => !c.attrs.includes("systemLanguage="));
    const pick = wanted ?? fallback;
    if (!pick) {
      throw new Error(`<switch> ohne Zweig für ${lang}`);
    }
    return pick.raw.replace(/\s+systemLanguage="[^"]*"/, "");
  });
}

function setRootLanguage(svg: string, lang: DiagramLanguage): string {
  return svg.replace(/<svg\b/, `<svg lang="${lang}"`);
}

/** Einsprachige Fassung für die manuelle Umschaltung. */
export function localizeSvg(svg: string, strings: DiagramStrings, lang: DiagramLanguage): string {
  let out = replaceElement(svg, "title", strings.title, (p) => p[lang]);
  out = replaceElement(out, "desc", strings.desc, (p) => p[lang]);
  out = replaceTexts(out, strings, (attrs, p) => `<text${attrs}>${encodeXml(p[lang])}</text>`);
  return setRootLanguage(resolveSwitches(out, lang), lang);
}

const both = (p: Phrase): string => (p.de === p.en ? p.de : `${p.en} / ${p.de}`);

/** Zweisprachige Fassung: der Browser wählt per systemLanguage, Rückfall Englisch. */
export function autoLanguageSvg(svg: string, strings: DiagramStrings): string {
  let out = replaceElement(svg, "title", strings.title, both);
  out = replaceElement(out, "desc", strings.desc, both);
  return replaceTexts(out, strings, (attrs, p) =>
    p.de === p.en
      ? `<text${attrs}>${encodeXml(p.de)}</text>`
      : `<switch><text systemLanguage="de"${attrs}>${encodeXml(p.de)}</text><text${attrs}>${encodeXml(p.en)}</text></switch>`
  );
}

/** Dateiname einer Ausgabe aus dem Quellnamen, z. B. rag-pipeline-dark.svg → rag-pipeline-en-dark.svg. */
export function variantFileName(
  source: string,
  diagrams: readonly string[],
  lang: DiagramLanguage | "auto"
): string {
  const name = diagrams.find((d) => source === `${d}.svg` || source.startsWith(`${d}-`));
  if (!name) {
    throw new Error(`Unbekannte Quelldatei: ${source}`);
  }
  const suffix = source.slice(name.length);
  return lang === "auto" ? `${name}${suffix}` : `${name}-${lang}${suffix}`;
}

/** Alle Ausgaben (Dateiname → Inhalt) aus Quellen und Katalog. */
export function buildDiagramVariants(
  sources: Readonly<Record<string, string>>,
  catalog: Readonly<Record<string, DiagramStrings>>
): Map<string, string> {
  const diagrams = Object.keys(catalog);
  const out = new Map<string, string>();
  for (const [file, svg] of Object.entries(sources)) {
    const name = diagrams.find((d) => file === `${d}.svg` || file.startsWith(`${d}-`)) ?? "";
    const strings = catalog[name];
    if (!strings) {
      throw new Error(`Kein Katalogeintrag für ${file}`);
    }
    out.set(variantFileName(file, diagrams, "de"), localizeSvg(svg, strings, "de"));
    out.set(variantFileName(file, diagrams, "en"), localizeSvg(svg, strings, "en"));
    out.set(variantFileName(file, diagrams, "auto"), autoLanguageSvg(svg, strings));
  }
  return out;
}
