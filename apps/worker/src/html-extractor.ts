export interface ExtractedArticle {
  readonly title: string;
  readonly content: string;
  readonly textLength: number;
}

/**
 * Decodes common HTML entities into their character equivalents.
 * Note: &amp; must be decoded last to avoid double unescaping (e.g. &amp;lt; -> &lt; -> <).
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
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
    })
    .replace(/&amp;/g, "&");
}

/**
 * Strips HTML tags matching regex in a loop until the string is stable,
 * completely preventing incomplete multi-character sanitization issues.
 */
function stripTagsRepeatedly(text: string, regex: RegExp): string {
  let prev = "";
  let curr = text;
  while (curr !== prev) {
    prev = curr;
    curr = curr.replace(regex, " ");
  }
  return curr;
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
      const rawTitle = stripTagsRepeatedly(titleMatch[1], /<[^>]+>/g).trim();
      title = decodeHtmlEntities(rawTitle);
    } else {
      const h1Match = cleaned.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (h1Match?.[1]) {
        const rawH1 = stripTagsRepeatedly(h1Match[1], /<[^>]+>/g).trim();
        title = decodeHtmlEntities(rawH1);
      }
    }
  }

  // 2. Remove title tag and head tag contents if any
  cleaned = stripTagsRepeatedly(cleaned, /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi);

  // 3. Remove script, style, noscript, template, svg, canvas, iframe and their contents
  cleaned = stripTagsRepeatedly(cleaned, /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<template\b[^>]*>[\s\S]*?<\/template\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<canvas\b[^>]*>[\s\S]*?<\/canvas\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi);

  // 4. Remove navigation, header, footer, aside blocks
  cleaned = stripTagsRepeatedly(cleaned, /<header\b[^>]*>[\s\S]*?<\/header\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<footer\b[^>]*>[\s\S]*?<\/footer\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi);
  cleaned = stripTagsRepeatedly(cleaned, /<aside\b[^>]*>[\s\S]*?<\/aside\s*>/gi);

  // 4. Remove elements matching typical ad/cookie/banner markers (class/id contains ad, banner, cookie, popup, newsletter)
  cleaned = stripTagsRepeatedly(
    cleaned,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:advertisement|ad-container|ad-box|banner-ad|cookie-banner|cookie-consent|popup-modal|newsletter-signup)[^"']*["'][^<]*(?:(?!<\/div>)<[^<]*)*<\/div\s*>/gi
  );

  // 5. Convert block elements to newlines
  cleaned = cleaned.replace(/<\/(p|div|article|section|li|tr|blockquote)>/gi, "\n\n");
  cleaned = cleaned.replace(/<(br|hr)\s*\/?>/gi, "\n");
  cleaned = cleaned.replace(/<\/(h[1-6])>/gi, "\n\n");

  // 6. Strip all remaining HTML tags
  cleaned = stripTagsRepeatedly(cleaned, /<[^>]+>/g);

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
