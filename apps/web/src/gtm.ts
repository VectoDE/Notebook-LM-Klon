import { readGtmId } from "./analytics-config.js";
import type { ConsentState } from "./consent.js";

/**
 * Google Tag Manager nur nach Einwilligung (Issue #260).
 *
 * - Ohne gültige VITE_GTM_ID passiert nichts: kein dataLayer, kein Skript, keine Anfrage.
 * - Ohne Einwilligung wird gtm.js nie geladen.
 * - Vor dem Laden setzt Consent Mode v2 alle vier Signale auf "denied"; erst danach
 *   erlaubt ein Update analytics_storage. Werbesignale bleiben immer "denied", weil die
 *   App keine Werbung ausspielt und keine Einwilligung dafür einholt.
 * - Widerruf: analytics_storage zurück auf "denied" und _ga-Cookies löschen.
 */
export const GTM_SCRIPT_ORIGIN = "https://www.googletagmanager.com";

export const CONSENT_DEFAULTS = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  wait_for_update: 500
} as const;

type DataLayer = unknown[];

export interface GtmScript {
  async: boolean;
  src: string;
  id: string;
}

export interface GtmDocument {
  cookie: string;
  readonly location: { readonly hostname: string };
  getElementById(id: string): unknown;
  createElement(tag: "script"): GtmScript;
  readonly head: { appendChild(node: GtmScript): unknown };
}

export interface GtmGlobal {
  dataLayer?: DataLayer;
  gtag?: (...args: unknown[]) => void;
  readonly document?: GtmDocument;
}

const SCRIPT_ID = "rn-gtm";

function ensureGtag(win: GtmGlobal): (...args: unknown[]) => void {
  if (win.gtag) return win.gtag;
  const layer: DataLayer = win.dataLayer ?? [];
  win.dataLayer = layer;
  // gtag.js erwartet das arguments-Objekt, kein Array
  win.gtag = function gtag() {
    // biome-ignore lint/style/noArguments: Google Consent Mode verlangt das arguments-Objekt
    layer.push(arguments);
  };
  win.gtag("consent", "default", { ...CONSENT_DEFAULTS });
  return win.gtag;
}

/** Löscht die Analytics-Cookies (_ga, _ga_<ID>, _gid) für Host und übergeordnete Domain. */
export function removeAnalyticsCookies(doc: GtmDocument): string[] {
  const names = doc.cookie
    .split(";")
    .map((part) => part.trim().split("=", 1).join(""))
    .filter((name) => /^_ga($|_)|^_gid$/.test(name));
  const host = doc.location.hostname;
  const parent = host.split(".").slice(-2).join(".");
  for (const name of names) {
    const expired = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    doc.cookie = expired;
    doc.cookie = `${expired}; domain=${host}`;
    doc.cookie = `${expired}; domain=.${parent}`;
  }
  return names;
}

/**
 * Liefert den Handler für PrivacyCenter.onConsentChange oder undefined, wenn keine
 * gültige Container-ID gesetzt ist oder kein Dokument existiert (SSR, Tests).
 */
export function gtmConsentHandler(
  rawGtmId: string | undefined,
  win: GtmGlobal,
  now: () => number = Date.now
): ((state: ConsentState) => void) | undefined {
  const gtmId = readGtmId(rawGtmId);
  const doc = win.document;
  if (!gtmId || !doc) return undefined;

  return (state) => {
    if (!state.analytics) {
      // Nur aktualisieren, wenn Google schon geladen wurde; sonst bleibt alles unberührt
      if (win.gtag) win.gtag("consent", "update", { analytics_storage: "denied" });
      removeAnalyticsCookies(doc);
      return;
    }
    const gtag = ensureGtag(win);
    gtag("consent", "update", { analytics_storage: "granted" });
    if (doc.getElementById(SCRIPT_ID)) return;
    win.dataLayer?.push({ "gtm.start": now(), event: "gtm.js" });
    const script = doc.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `${GTM_SCRIPT_ORIGIN}/gtm.js?id=${encodeURIComponent(gtmId)}`;
    doc.head.appendChild(script);
  };
}
