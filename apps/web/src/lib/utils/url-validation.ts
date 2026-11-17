/**
 * Prüfung der Link-Adresse im Import-Dialog (Issue #323).
 *
 * Der Dialog meldet Fehler selbst unter dem Feld (aria-invalid, aria-describedby) statt
 * über die Blase des Browsers. Erlaubt sind nur vollständige http- und https-Adressen.
 */

/** Schlüssel der Fehlermeldung im Sprachkatalog, oder null, wenn die Adresse passt. */
export type SourceUrlError = "srcUrlRequired" | "srcUrlInvalid";

export function validateSourceUrl(value: string): SourceUrlError | null {
  const trimmed = value.trim();
  if (!trimmed) return "srcUrlRequired";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "srcUrlInvalid";
  }
  // http und https verlangen nach WHATWG immer einen Host, sonst wirft new URL()
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? null : "srcUrlInvalid";
}
