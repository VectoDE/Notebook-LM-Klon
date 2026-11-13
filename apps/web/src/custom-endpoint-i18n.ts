/**
 * Texte für die Einstellung „Eigener Endpunkt“ (BYOM, Issue #247), Deutsch und Englisch.
 * Eigene Datei, damit die gemeinsamen Sprachkataloge unberührt bleiben.
 */

export type EndpointLanguage = "de" | "en";

type Entry = readonly [key: string, de: string, en: string];

const ENTRIES: readonly Entry[] = [
  ["title", "Eigener Endpunkt (OpenAI-kompatibel)", "Own endpoint (OpenAI-compatible)"],
  [
    "intro",
    "Zum Beispiel RelationFlow. Der Server ruft nur HTTPS-Adressen auf, die der Betreiber freigegeben hat.",
    "For example RelationFlow. The server only calls HTTPS addresses the operator has allowed."
  ],
  [
    "disabled",
    "Auf diesem Server nicht freigeschaltet. Der Betreiber muss den Host in BYOM_ALLOWED_HOSTS eintragen.",
    "Not enabled on this server. The operator has to add the host to BYOM_ALLOWED_HOSTS."
  ],
  ["baseUrl", "Basis-Adresse", "Base URL"],
  ["baseUrlHint", "z. B. https://api.example.com/v1", "e.g. https://api.example.com/v1"],
  ["chatModel", "Chat-Modell", "Chat model"],
  ["embedModel", "Embedding-Modell (optional)", "Embedding model (optional)"],
  ["apiKey", "API-Schlüssel", "API key"],
  [
    "apiKeyStored",
    "Ein Schlüssel ist gespeichert. Leer lassen, um ihn zu behalten.",
    "A key is stored. Leave empty to keep it."
  ],
  [
    "apiKeyHint",
    "Wird verschlüsselt gespeichert und nie wieder angezeigt.",
    "Stored encrypted and never shown again."
  ],
  ["save", "Speichern", "Save"],
  ["test", "Verbindung testen", "Test connection"],
  ["remove", "Entfernen", "Remove"],
  ["loading", "Wird geladen …", "Loading …"],
  ["saving", "Wird gespeichert …", "Saving …"],
  ["testing", "Verbindung wird geprüft …", "Checking connection …"],
  ["saved", "Gespeichert.", "Saved."],
  ["removed", "Endpunkt und Schlüssel entfernt.", "Endpoint and key removed."],
  [
    "testOk",
    "Verbindung steht ({ms} ms, {n} Modelle gefunden).",
    "Connected ({ms} ms, {n} models found)."
  ],
  ["testFail", "Verbindung fehlgeschlagen: {msg}", "Connection failed: {msg}"],
  [
    "signInNeeded",
    "Bitte melde dich an, um einen eigenen Endpunkt zu nutzen.",
    "Please sign in to use your own endpoint."
  ],
  ["error", "Fehler: {msg}", "Error: {msg}"],
  ["required", "Bitte Adresse und Chat-Modell ausfüllen.", "Please fill in the URL and chat model."]
];

const CATALOG: Readonly<Record<EndpointLanguage, Readonly<Record<string, string>>>> = {
  de: Object.fromEntries(ENTRIES.map(([k, de]) => [k, de])),
  en: Object.fromEntries(ENTRIES.map(([k, , en]) => [k, en]))
};

/** Liefert den Text in der Sprache, Platzhalter `{name}` werden ersetzt. Unbekannt = Schlüssel. */
export function endpointText(
  language: EndpointLanguage,
  key: string,
  vars: Readonly<Record<string, string | number>> = {}
): string {
  const template = CATALOG[language][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export const ENDPOINT_TEXT_KEYS: readonly string[] = ENTRIES.map(([k]) => k);
