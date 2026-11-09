export interface ExtractedArticle {
  readonly title: string;
  readonly content: string;
  readonly textLength: number;
}

/**
 * Decodes common HTML entities into their character equivalents.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return String.fromCharCode(code);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return String.fromCharCode(code);
    });
}

/**
 * Sanitizes and extracts clean readable text and title from HTML markup.
 * - Strips `<script>`, `<style>`, `<noscript>`, `<template>`, `<svg>`, `<canvas>`, `<iframe>` tags and their inner content
 * - Strips non-content structural elements: `<header>`, `<footer>`, `<nav>`, `<aside>`
 * - Strips elements with common advertising, tracker, modal, and banner class/id keywords
 * - Preserves semantic headings, paragraphs, and list linebreaks
 * - Extracts document title from `<title>` or OpenGraph `<meta property="og:title">` or first `<h1>`
 */
export function extractArticleFromHtml(html: string): ExtractedArticle {
  if (!html || !html.trim()) {
    return {
      title: "Unbenannt",
      content: "",
      textLength: 0
    };
  }

  let cleaned = html;

  // 1. Extract title before stripping tags
  let title = "";
  const ogTitleMatch =
    cleaned.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    cleaned.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i);
  if (ogTitleMatch?.[1]) {
    title = decodeHtmlEntities(ogTitleMatch[1].trim());
  } else {
    const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
      const rawTitle = titleMatch[1].replace(/<[^>]+>/g, "").trim();
      title = decodeHtmlEntities(rawTitle);
    } else {
      const h1Match = cleaned.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (h1Match?.[1]) {
        const rawH1 = h1Match[1].replace(/<[^>]+>/g, "").trim();
        title = decodeHtmlEntities(rawH1);
      }
    }
  }

  // 2. Remove title tag and head tag contents if any
  cleaned = cleaned.replace(/<title\b[^<]*(?:(?!<\/title>)<[^<]*)*<\/title>/gi, " ");

  // 3. Remove script, style, noscript, template, svg, canvas, iframe and their contents
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  cleaned = cleaned.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");
  cleaned = cleaned.replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, " ");
  cleaned = cleaned.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");
  cleaned = cleaned.replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, " ");
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ");

  // 4. Remove navigation, header, footer, aside blocks
  cleaned = cleaned.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ");
  cleaned = cleaned.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ");
  cleaned = cleaned.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ");
  cleaned = cleaned.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ");

  // 4. Remove elements matching typical ad/cookie/banner markers (class/id contains ad, banner, cookie, popup, newsletter)
  cleaned = cleaned.replace(
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:advertisement|ad-container|ad-box|banner-ad|cookie-banner|cookie-consent|popup-modal|newsletter-signup)[^"']*["'][^<]*(?:(?!<\/div>)<[^<]*)*<\/div>/gi,
    " "
  );

  // 5. Convert block elements to newlines
  cleaned = cleaned.replace(/<\/(p|div|article|section|li|tr|blockquote)>/gi, "\n\n");
  cleaned = cleaned.replace(/<(br|hr)\s*\/?>/gi, "\n");
  cleaned = cleaned.replace(/<\/(h[1-6])>/gi, "\n\n");

  // 6. Strip all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // 7. Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // 8. Normalize whitespace and empty lines
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const content = lines.join("\n\n");

  return {
    title: title.trim() || "Unbenannt",
    content,
    textLength: content.length
  };
}
