import type { ModelId } from "./theme-preferences.js";

/**
 * Angaben der Anbieter, ob Eingaben zum Training genutzt werden, je wählbarem Modell (Issue #302).
 *
 * Grundlage sind die offiziellen Bedingungen der Anbieter, abgerufen am POLICY_RETRIEVED.
 * Dieselben Quellen stehen mit Wortlaut-Auszügen in docs/datenschutz-modelle.md; ein Test hält
 * beide Listen gleich. Die Angaben sind eine Zusammenfassung, keine Rechtsberatung.
 *
 * Maßgeblich ist der Weg, den eine Anfrage in dieser Installation tatsächlich nimmt: der Worker
 * bindet derzeit nur Google Gemini (Gemini Developer API) und Ollama an. Für nicht angebundene
 * Modelle sagt `connection`, was mit einer Anfrage passiert.
 */

/**
 * - `noTraining`: Anbieter schließt Training mit API-Eingaben standardmäßig aus (Ausnahmen nur mit
 *   Zustimmung oder Feedback).
 * - `conditional`: Training ist nur unter Bedingungen ausgeschlossen (Region, kostenpflichtige Stufe).
 * - `local`: Kein externer KI-Anbieter; das Modell läuft auf dem Server dieser Installation.
 */
export type TrainingStatus = "noTraining" | "conditional" | "local";

/**
 * - `connected`: Anfragen gehen an diesen Anbieter.
 * - `fails`: Anbieter noch nicht angebunden, Anfragen schlagen fehl (es werden keine Daten gesendet).
 * - `routedToGemini`: noch nicht angebunden, der Server leitet Anfragen an Gemini 2.5 Flash weiter.
 */
export type ConnectionState = "connected" | "fails" | "routedToGemini";

export interface PolicySource {
  /** Anzeigename der Quelle (Eigenname des Dokuments, nicht übersetzt). */
  readonly label: string;
  readonly url: string;
}

export interface ModelDataPolicy {
  readonly status: TrainingStatus;
  /** Schlüssel im Sprachkatalog für die Zusammenfassung der Anbieterangabe. */
  readonly noteKey: string;
  readonly connection: ConnectionState;
  readonly sources: readonly PolicySource[];
}

/** Abrufdatum aller Quellen (ISO 8601). */
export const POLICY_RETRIEVED = "2026-11-13";

export const SOURCES = {
  geminiTerms: {
    label: "Gemini API Additional Terms of Service",
    url: "https://aistudio.google.com/docs/terms"
  },
  anthropicTraining: {
    label: "Anthropic Privacy Center: Is my data used for model training?",
    url: "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training"
  },
  openaiYourData: {
    label: "OpenAI API: Data controls (Your data)",
    url: "https://developers.openai.com/api/docs/guides/your-data"
  },
  groqServices: {
    label: "GroqCloud Services Agreement, 4.2",
    url: "https://console.groq.com/docs/legal/services-agreement"
  },
  ollamaFaq: {
    label: "Ollama FAQ",
    url: "https://docs.ollama.com/faq"
  }
} as const satisfies Record<string, PolicySource>;

export const MODEL_DATA_POLICIES: Readonly<Record<ModelId, ModelDataPolicy>> = {
  "gemini-2.5-flash": {
    status: "conditional",
    noteKey: "policyGemini",
    connection: "connected",
    sources: [SOURCES.geminiTerms]
  },
  "gemini-2.5-pro": {
    status: "conditional",
    noteKey: "policyGemini",
    connection: "connected",
    sources: [SOURCES.geminiTerms]
  },
  "claude-3-7-sonnet": {
    status: "noTraining",
    noteKey: "policyAnthropic",
    connection: "fails",
    sources: [SOURCES.anthropicTraining]
  },
  "gpt-4o": {
    status: "noTraining",
    noteKey: "policyOpenai",
    connection: "fails",
    sources: [SOURCES.openaiYourData]
  },
  // Bis zur Anbindung landet die Anfrage bei Gemini: maßgeblich sind dann Googles Bedingungen.
  "deepseek-r1": {
    status: "conditional",
    noteKey: "policyGroq",
    connection: "routedToGemini",
    sources: [SOURCES.groqServices, SOURCES.geminiTerms]
  },
  "ollama-local": {
    status: "local",
    noteKey: "policyOllama",
    connection: "connected",
    sources: [SOURCES.ollamaFaq]
  }
};

/** Sprachschlüssel für den Status. */
export const STATUS_KEYS: Readonly<Record<TrainingStatus, string>> = {
  noTraining: "policyStatusNoTraining",
  conditional: "policyStatusConditional",
  local: "policyStatusLocal"
};

/** Sprachschlüssel für den Anbindungsstand (ohne Hinweis bei `connected`). */
export const CONNECTION_KEYS: Readonly<Record<Exclude<ConnectionState, "connected">, string>> = {
  fails: "policyNotConnected",
  routedToGemini: "policyRoutedToGemini"
};

/** Angaben zum Modell; unbekannte Werte fallen auf das Standardmodell zurück. */
export function policyFor(model: string): ModelDataPolicy {
  return (
    (MODEL_DATA_POLICIES as Readonly<Record<string, ModelDataPolicy>>)[model] ??
    MODEL_DATA_POLICIES["gemini-2.5-flash"]
  );
}
