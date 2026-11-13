/**
 * Einwilligung für optionale Dienste (Issue #261).
 *
 * Gespeichert wird nur die Entscheidung selbst, im lokalen Speicher des Browsers
 * (technisch notwendig, damit das Banner nicht bei jedem Aufruf erscheint). Ohne
 * Entscheidung gilt: nichts Optionales ist erlaubt.
 */
export const CONSENT_STORAGE_KEY = "rn-consent";
/** Höher setzen, wenn neue Kategorien dazukommen: alte Entscheidungen gelten dann nicht mehr. */
export const CONSENT_VERSION = 1;

/** Öffnet die Cookie-Einstellungen (Fußzeile, Widerruf). */
export const OPEN_CONSENT_SETTINGS_EVENT = "rn:open-consent-settings";
/** Öffnet die Datenschutzhinweise. */
export const OPEN_PRIVACY_NOTICE_EVENT = "rn:open-privacy-notice";
/** Wird nach jeder gespeicherten Entscheidung mit dem neuen Zustand ausgelöst. */
export const CONSENT_CHANGE_EVENT = "rn:consent-change";

export interface ConsentState {
  readonly version: number;
  /** Messung mit Google Tag Manager / Google Analytics 4 (Issue #260). */
  readonly analytics: boolean;
  readonly decidedAt: string;
}

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;
type ClearableStorage = Pick<Storage, "removeItem">;

/** Liest die gespeicherte Entscheidung. Ungültige oder veraltete Einträge zählen als keine. */
export function readConsent(storage: ReadableStorage | undefined): ConsentState | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(CONSENT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const value = parsed as Partial<ConsentState> | null;
  if (
    !value ||
    value.version !== CONSENT_VERSION ||
    typeof value.analytics !== "boolean" ||
    typeof value.decidedAt !== "string"
  ) {
    return null;
  }
  return { version: CONSENT_VERSION, analytics: value.analytics, decidedAt: value.decidedAt };
}

/** Speichert eine Entscheidung. Ist kein Speicher verfügbar, gilt sie nur für diesen Aufruf. */
export function storeConsent(
  storage: WritableStorage | undefined,
  analytics: boolean,
  now: Date = new Date()
): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    analytics,
    decidedAt: now.toISOString()
  };
  try {
    storage?.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Privater Modus oder volles Kontingent: Entscheidung bleibt nur im Speicher der Seite
  }
  return state;
}

/** Entfernt die Entscheidung (danach erscheint das Banner wieder). */
export function clearConsent(storage: ClearableStorage | undefined): void {
  try {
    storage?.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // nichts zu tun
  }
}

/**
 * Das Banner erscheint nur, wenn es etwas zu entscheiden gibt (ein optionaler Dienst ist
 * konfiguriert) und noch keine gültige Entscheidung vorliegt.
 */
export function needsConsentDecision(
  state: ConsentState | null,
  optionalServicesConfigured: boolean
): boolean {
  return optionalServicesConfigured && state === null;
}

/** Darf die Messung laufen? Nur mit ausdrücklicher Einwilligung. */
export function analyticsAllowed(state: ConsentState | null): boolean {
  return state?.analytics === true;
}
