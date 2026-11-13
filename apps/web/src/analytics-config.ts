/**
 * Konfiguration der optionalen Messung (Issues #260, #261).
 *
 * Container-ID und Search-Console-Token kommen ausschließlich aus Umgebungsvariablen
 * des Builds (VITE_GTM_ID, VITE_GSC_VERIFICATION). Im Code steht keine ID. Fehlt die
 * Variable oder hat sie ein ungültiges Format, wird nichts geladen und kein Banner gezeigt.
 */
const GTM_ID_PATTERN = /^GTM-[A-Z0-9]{4,12}$/;
const SITE_VERIFICATION_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

/** Gibt die geprüfte GTM-Container-ID zurück oder null. */
export function readGtmId(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  return GTM_ID_PATTERN.test(value) ? value : null;
}

/** Gibt das geprüfte Search-Console-Token (google-site-verification) zurück oder null. */
export function readSiteVerification(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  return SITE_VERIFICATION_PATTERN.test(value) ? value : null;
}

/**
 * Fügt das Search-Console-Meta-Tag in den <head> ein, wenn VITE_GSC_VERIFICATION gültig
 * ist (Issue #260). Ohne gültiges Token bleibt das HTML unverändert.
 */
export function injectSiteVerification(html: string, raw: string | undefined): string {
  const token = readSiteVerification(raw);
  if (!token) return html;
  return html.replace(
    "</head>",
    `  <meta name="google-site-verification" content="${token}" />\n  </head>`
  );
}
