import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPOSITORY_URL,
  SEO_TEXT,
  type SeoDocument,
  type SeoElement,
  applySeoLanguage,
  buildHeadTags,
  buildJsonLd,
  buildLlmsTxt,
  buildRobotsTxt,
  buildSitemapXml,
  languageFromSearch,
  languageUrl,
  normalizePublicBaseUrl
} from "../seo.js";

const BASE = "https://relationnotes.example.dev/";

function fakeDocument(withAlternates: boolean) {
  const attrs = new Map<string, Map<string, string>>();
  const element = (selector: string): SeoElement => ({
    setAttribute(name, value) {
      const entry = attrs.get(selector) ?? new Map<string, string>();
      entry.set(name, value);
      attrs.set(selector, entry);
    },
    getAttribute(name) {
      return attrs.get(selector)?.get(name) ?? null;
    }
  });
  const known = new Set([
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:locale"]',
    'meta[property="og:locale:alternate"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]'
  ]);
  if (withAlternates) {
    for (const sel of [
      'link[rel="canonical"]',
      'meta[property="og:url"]',
      'link[rel="alternate"][hreflang="de"]',
      'link[rel="alternate"][hreflang="en"]'
    ]) {
      known.add(sel);
    }
  }
  const doc: SeoDocument = {
    title: "",
    querySelector: (selector) => (known.has(selector) ? element(selector) : null)
  };
  if (withAlternates) {
    element('link[rel="alternate"][hreflang="de"]').setAttribute("href", BASE);
    element('link[rel="alternate"][hreflang="en"]').setAttribute("href", `${BASE}?lang=en`);
  }
  const get = (selector: string, name: string) => attrs.get(selector)?.get(name);
  return { doc, get };
}

describe("SEO und GEO der öffentlichen Seite (#263)", () => {
  it("normalisiert die Basis-URL und erfindet keine", () => {
    expect(normalizePublicBaseUrl(undefined)).toBeUndefined();
    expect(normalizePublicBaseUrl("  ")).toBeUndefined();
    expect(normalizePublicBaseUrl("kein url")).toBeUndefined();
    expect(normalizePublicBaseUrl("ftp://example.com")).toBeUndefined();
    expect(normalizePublicBaseUrl("https://relationnotes.example.dev")).toBe(BASE);
    expect(normalizePublicBaseUrl("http://localhost:4173/app//")).toBe(
      "http://localhost:4173/app/"
    );
    expect(languageUrl(BASE, "de")).toBe(BASE);
    expect(languageUrl(BASE, "en")).toBe(`${BASE}?lang=en`);
  });

  it("schreibt Description, Open Graph, Twitter und JSON-LD auch ohne Basis-URL", () => {
    const head = buildHeadTags(undefined);
    expect(head).toContain('<meta name="description" content="Quellen hochladen');
    expect(head).toContain('<meta property="og:title"');
    expect(head).toContain('<meta property="og:locale:alternate" content="en_US" />');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(head).toContain('<script type="application/ld+json">');
    expect(head).not.toContain("canonical");
    expect(head).not.toContain("hreflang");
    expect(head).not.toContain("og:url");
    expect(buildJsonLd(undefined)).not.toHaveProperty("url");
  });

  it("ergänzt mit Basis-URL Canonical, hreflang DE/EN/x-default und absolute Bild-URLs", () => {
    const head = buildHeadTags(BASE);
    expect(head).toContain(`<link rel="canonical" href="${BASE}" />`);
    expect(head).toContain(`<link rel="alternate" hreflang="de" href="${BASE}" />`);
    expect(head).toContain(`<link rel="alternate" hreflang="en" href="${BASE}?lang=en" />`);
    expect(head).toContain(`<link rel="alternate" hreflang="x-default" href="${BASE}" />`);
    expect(head).toContain(`<meta property="og:image" content="${BASE}og-image.png" />`);
    expect(head).toContain('<meta property="og:image:type" content="image/png" />');
    expect(head).toContain('<meta name="twitter:image:alt" content="RelationNotes: Quellen,');
    for (const lang of ["de", "en"] as const) {
      expect(SEO_TEXT[lang].description.length).toBeLessThanOrEqual(160);
    }

    const jsonLd = head.slice(head.indexOf(">{") + 1, head.lastIndexOf("</script>"));
    const data = JSON.parse(jsonLd) as Record<string, unknown>;
    expect(data["@type"]).toBe("WebApplication");
    expect(data.url).toBe(BASE);
    expect(data.inLanguage).toEqual(["de", "en"]);
    expect(data.sameAs).toEqual([REPOSITORY_URL]);
  });

  it("maskiert HTML in Texten und spitze Klammern im JSON-LD", () => {
    const head = buildHeadTags('https://example.com/a"<b>&');
    expect(head).not.toContain('"<b>');
    expect(normalizePublicBaseUrl('https://example.com/a"<b>&')).toBe(
      "https://example.com/a%22%3Cb%3E&/"
    );
    expect(buildHeadTags(undefined)).not.toMatch(/<\/script>.*<\/script>/s);
  });

  it("erlaubt Suchmaschinen und KI-Crawler, sperrt die API und nennt die Sitemap nur mit Basis-URL", () => {
    const robots = buildRobotsTxt(BASE);
    expect(robots).toContain("User-agent: *\nAllow: /\nDisallow: /api/");
    for (const bot of [
      "GPTBot",
      "OAI-SearchBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended"
    ]) {
      expect(robots).toContain(`User-agent: ${bot}\nAllow: /\nDisallow: /api/`);
    }
    expect(robots).toContain(`Sitemap: ${BASE}sitemap.xml`);
    expect(buildRobotsTxt(undefined)).not.toContain("Sitemap:");
  });

  it("baut eine Sitemap mit beiden Sprachvarianten und hreflang-Verweisen", () => {
    const xml = buildSitemapXml(BASE, "2026-11-13");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<loc>${BASE}</loc>`);
    expect(xml).toContain(`<loc>${BASE}?lang=en</loc>`);
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml.match(/hreflang="x-default"/g)).toHaveLength(2);
    expect(xml).toContain("<lastmod>2026-11-13</lastmod>");
  });

  it("liefert llms.txt nach dem llmstxt.org-Format", () => {
    const withBase = buildLlmsTxt(BASE);
    expect(withBase.startsWith("# RelationNotes\n\n> ")).toBe(true);
    expect(withBase).toContain(`- [RelationNotes (English)](${BASE}?lang=en)`);
    expect(withBase).toContain("## Docs");
    expect(withBase).toContain(`${REPOSITORY_URL}/blob/main/docs/architecture.md`);
    const without = buildLlmsTxt(undefined);
    expect(without).toContain("(Adresse wird beim Deploy festgelegt)");
    expect(without).not.toContain("undefined");
  });

  it("verweist in llms.txt nur auf Doku-Dateien, die es gibt", () => {
    const root = join(import.meta.dirname, "../../../..");
    for (const match of buildLlmsTxt(BASE).matchAll(/blob\/main\/(docs\/[a-z-]+\.md)/g)) {
      expect(() => readFileSync(join(root, match[1] ?? ""), "utf-8")).not.toThrow();
    }
  });

  it("stellt Titel, Beschreibung, Open Graph und Canonical auf die gewählte Sprache um", () => {
    const { doc, get } = fakeDocument(true);
    applySeoLanguage(doc, "en");
    expect(doc.title).toBe(SEO_TEXT.en.title);
    expect(get('meta[name="description"]', "content")).toBe(SEO_TEXT.en.description);
    expect(get('meta[property="og:locale"]', "content")).toBe("en_US");
    expect(get('meta[property="og:locale:alternate"]', "content")).toBe("de_DE");
    expect(get('link[rel="canonical"]', "href")).toBe(`${BASE}?lang=en`);
    expect(get('meta[property="og:url"]', "content")).toBe(`${BASE}?lang=en`);

    applySeoLanguage(doc, "de");
    expect(doc.title).toBe(SEO_TEXT.de.title);
    expect(get('meta[name="twitter:title"]', "content")).toBe(SEO_TEXT.de.title);
    expect(get('link[rel="canonical"]', "href")).toBe(BASE);
  });

  it("fällt bei unbekannter Sprache auf Deutsch zurück und lässt Canonical ohne hreflang weg", () => {
    const { doc, get } = fakeDocument(false);
    applySeoLanguage(doc, "fr");
    expect(doc.title).toBe(SEO_TEXT.de.title);
    expect(get('link[rel="canonical"]', "href")).toBeUndefined();
  });

  it("liest die Sprache aus ?lang=", () => {
    expect(languageFromSearch("?lang=en")).toBe("en");
    expect(languageFromSearch("?x=1&lang=de")).toBe("de");
    expect(languageFromSearch("?lang=fr")).toBeUndefined();
    expect(languageFromSearch("")).toBeUndefined();
  });

  it("enthält im index.html den Platzhalter für den SEO-Kopf", () => {
    const html = readFileSync(join(import.meta.dirname, "../../index.html"), "utf-8");
    expect(html).toContain("<!-- seo-head -->");
    expect(html).toContain(`<title>${SEO_TEXT.de.title}</title>`);
  });
});
