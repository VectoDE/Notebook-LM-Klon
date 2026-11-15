/**
 * SEO und GEO der öffentlichen Seite (Issue #263).
 *
 * Die App ist eine Single-Page-Application mit genau einer öffentlichen Seite ("/").
 * Deutsch ist die Standardsprache, Englisch erreicht man über "?lang=en".
 * Absolute URLs (Canonical, hreflang, Open Graph, Sitemap) entstehen nur, wenn beim Build
 * VITE_PUBLIC_BASE_URL gesetzt ist. Ohne Basis-URL werden sie weggelassen statt erfunden.
 */

export type SeoLanguage = "de" | "en";

export const SEO_LANGUAGES: readonly SeoLanguage[] = ["de", "en"];

/** Alternativtext des Vorschaubilds (public/og-image.png). */
const OG_IMAGE_ALT = "RelationNotes: Quellen, Chat mit Belegstellen und Studio-Werkzeuge";

export const REPOSITORY_URL = "https://github.com/VectoDE/Notebook-LM-Klon";

export const SEO_TEXT: Record<
  SeoLanguage,
  { readonly title: string; readonly description: string; readonly locale: string }
> = {
  de: {
    title: "RelationNotes – Quellen verstehen, mit Belegen chatten",
    description:
      "Quellen hochladen, Antworten mit Belegstellen bekommen und daraus Audio, Video, Mindmap, Lernkarten, Quiz und Briefing machen. Datensparsam und quelloffen.",
    locale: "de_DE"
  },
  en: {
    title: "RelationNotes – Understand your sources, chat with citations",
    description:
      "Upload sources, get answers with citations and turn them into audio, video, a mind map, flashcards, quizzes and a briefing. Privacy-first and open source.",
    locale: "en_US"
  }
};

/** Prüft und normalisiert die Basis-URL; ungültige Werte ergeben undefined. */
export function normalizePublicBaseUrl(raw: string | undefined): string | undefined {
  if (!raw || raw.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;
}

/** URL der Seite in einer Sprache (Deutsch ohne Parameter). */
export function languageUrl(baseUrl: string, language: SeoLanguage): string {
  return language === "de" ? baseUrl : `${baseUrl}?lang=en`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildJsonLd(baseUrl: string | undefined): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "RelationNotes",
    alternateName: "Notebook-LM-Klon",
    description: SEO_TEXT.de.description,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    browserRequirements: "Aktueller Browser mit JavaScript",
    inLanguage: ["de", "en"],
    license: "https://opensource.org/licenses/MIT",
    ...(baseUrl ? { url: baseUrl, image: `${baseUrl}og-image.png` } : {}),
    author: {
      "@type": "Organization",
      name: "VectoDE",
      url: "https://github.com/VectoDE"
    },
    sameAs: [REPOSITORY_URL]
  };
}

/** Kopfbereich für index.html (deutsche Standardtexte, Sprachvarianten per hreflang). */
export function buildHeadTags(baseUrl: string | undefined): string {
  const de = SEO_TEXT.de;
  const tags = [
    `<meta name="description" content="${escapeHtml(de.description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="RelationNotes" />`,
    `<meta property="og:title" content="${escapeHtml(de.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(de.description)}" />`,
    `<meta property="og:locale" content="${de.locale}" />`,
    `<meta property="og:locale:alternate" content="${SEO_TEXT.en.locale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(de.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(de.description)}" />`
  ];
  if (baseUrl) {
    const base = escapeHtml(baseUrl);
    tags.push(
      `<link rel="canonical" href="${base}" />`,
      ...SEO_LANGUAGES.map(
        (lang) =>
          `<link rel="alternate" hreflang="${lang}" href="${escapeHtml(languageUrl(baseUrl, lang))}" />`
      ),
      `<link rel="alternate" hreflang="x-default" href="${base}" />`,
      `<meta property="og:url" content="${base}" />`,
      `<meta property="og:image" content="${base}og-image.png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:type" content="image/png" />`,
      `<meta property="og:image:alt" content="${OG_IMAGE_ALT}" />`,
      `<meta name="twitter:image" content="${base}og-image.png" />`,
      `<meta name="twitter:image:alt" content="${OG_IMAGE_ALT}" />`
    );
  }
  const jsonLd = JSON.stringify(buildJsonLd(baseUrl)).replace(/</g, "\\u003c");
  tags.push(`<script type="application/ld+json">${jsonLd}</script>`);
  return tags.join("\n    ");
}

export function buildRobotsTxt(baseUrl: string | undefined): string {
  const lines = [
    "# RelationNotes – Suchmaschinen und KI-Suchdienste sind willkommen.",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    "# KI-Crawler ausdrücklich zugelassen (Sichtbarkeit in KI-Antworten).",
    ...[
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "PerplexityBot",
      "Google-Extended",
      "Applebot-Extended",
      "CCBot"
    ].flatMap((bot) => [`User-agent: ${bot}`, "Allow: /", "Disallow: /api/", ""])
  ];
  if (baseUrl) lines.push(`Sitemap: ${baseUrl}sitemap.xml`, "");
  return lines.join("\n");
}

export function buildSitemapXml(baseUrl: string, lastModified: string): string {
  const alternates = [
    ...SEO_LANGUAGES.map(
      (lang) =>
        `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeHtml(languageUrl(baseUrl, lang))}" />`
    ),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(baseUrl)}" />`
  ].join("\n");
  const urls = SEO_LANGUAGES.map(
    (lang) =>
      `  <url>\n    <loc>${escapeHtml(languageUrl(baseUrl, lang))}</loc>\n    <lastmod>${lastModified}</lastmod>\n${alternates}\n  </url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

export function buildLlmsTxt(baseUrl: string | undefined): string {
  const app = baseUrl ?? "(Adresse wird beim Deploy festgelegt)";
  return [
    "# RelationNotes",
    "",
    `> ${SEO_TEXT.en.description}`,
    "",
    "RelationNotes (Repository: Notebook-LM-Klon) runs as a single Cloudflare Worker with D1, R2 and Durable Objects. Answers cite the passages of the uploaded sources they are based on. The interface is available in German and English.",
    "",
    "## App",
    "",
    `- [RelationNotes (Deutsch)](${baseUrl ? languageUrl(baseUrl, "de") : app})`,
    `- [RelationNotes (English)](${baseUrl ? languageUrl(baseUrl, "en") : app})`,
    "",
    "## Docs",
    "",
    `- [README](${REPOSITORY_URL}#readme): features, setup and limits`,
    `- [Architecture](${REPOSITORY_URL}/blob/main/docs/architecture.md): Worker, D1, R2, Durable Objects`,
    `- [RAG and vectors](${REPOSITORY_URL}/blob/main/docs/rag-and-vectors.md): chunking, search and citations`,
    `- [Platform limits](${REPOSITORY_URL}/blob/main/docs/platform-limits.md): quotas and source limits`,
    `- [Security and compliance](${REPOSITORY_URL}/blob/main/docs/security-and-compliance.md)`,
    "",
    "## Optional",
    "",
    `- [Source code (MIT)](${REPOSITORY_URL})`,
    ""
  ].join("\n");
}

export interface SeoElement {
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
}

/** Minimaler DOM-Ausschnitt, damit die Funktion ohne Browser testbar ist. */
export interface SeoDocument {
  title: string;
  querySelector(selector: string): SeoElement | null;
}

/**
 * Passt Titel, Beschreibung, Open Graph und Canonical an die gewählte Sprache an.
 * Die Canonical-URL wird aus dem hreflang-Eintrag der Sprache gelesen, falls vorhanden.
 */
export function applySeoLanguage(doc: SeoDocument, language: string): void {
  const lang: SeoLanguage = language === "en" ? "en" : "de";
  const text = SEO_TEXT[lang];
  doc.title = text.title;
  const set = (selector: string, attr: string, value: string) =>
    doc.querySelector(selector)?.setAttribute(attr, value);
  set('meta[name="description"]', "content", text.description);
  set('meta[property="og:title"]', "content", text.title);
  set('meta[property="og:description"]', "content", text.description);
  set('meta[property="og:locale"]', "content", text.locale);
  set(
    'meta[property="og:locale:alternate"]',
    "content",
    SEO_TEXT[lang === "de" ? "en" : "de"].locale
  );
  set('meta[name="twitter:title"]', "content", text.title);
  set('meta[name="twitter:description"]', "content", text.description);
  const href = doc.querySelector(`link[rel="alternate"][hreflang="${lang}"]`)?.getAttribute("href");
  if (href) {
    set('link[rel="canonical"]', "href", href);
    set('meta[property="og:url"]', "content", href);
  }
}

/** Sprache aus "?lang=" der Adresse, sonst undefined. */
export function languageFromSearch(search: string): SeoLanguage | undefined {
  const value = new URLSearchParams(search).get("lang");
  return value === "de" || value === "en" ? value : undefined;
}
