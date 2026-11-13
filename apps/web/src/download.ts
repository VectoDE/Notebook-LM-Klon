/** Download-Helfer ohne Abhängigkeiten, früh ladbar (Issue #257, LCP mobil). */

/**
 * Maskiert HTML-Sonderzeichen für Text, der in Markdown-Exporte geht. Markdown-Leser stellen
 * rohes HTML dar; ein Titel wie „<img onerror=…>“ (frei bearbeitbar, Issue #325) bleibt so
 * reiner Text.
 */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Längster Dateiname für Downloads (Zeichen, ohne Pfad). */
export const DOWNLOAD_FILENAME_MAX_LENGTH = 120;

/**
 * Macht aus beliebigem Text einen sicheren Dateinamen: nur Buchstaben, Ziffern, Punkt,
 * Bindestrich und Unterstrich; alles andere (Pfadtrenner, Steuer- und Markup-Zeichen,
 * Leerraum) wird zu „_“. Der Notebook-Titel ist frei bearbeitbar (Issue #325) und fließt
 * in Exportnamen ein.
 */
export function toSafeFilename(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|_+$/g, "")
    .slice(0, DOWNLOAD_FILENAME_MAX_LENGTH);
  return cleaned || "download";
}

/**
 * Triggers a file download in the browser. Safe for SSR or environments without DOM.
 */
export function triggerBrowserDownload(
  filename: string,
  content: string | Blob,
  mimeType: string
): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }

  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = toSafeFilename(filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}
