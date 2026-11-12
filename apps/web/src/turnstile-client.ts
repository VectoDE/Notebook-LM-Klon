/**
 * Cloudflare Turnstile im Browser (Issue #233): Site-Key, Skript laden, Anmelde-Aufrufe.
 *
 * Der Worker prüft jedes Token serverseitig (fail-closed). Hier steht nur, was die Web-App
 * braucht, um ein Token zu holen und mit Gastzugang bzw. Magic-Link mitzuschicken.
 */

/** Offizieller Pfad laut Cloudflare-Doku; das Skript darf nicht gespiegelt oder gecacht werden. */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Offizieller TEST-Site-Key von Cloudflare (sichtbares Widget, besteht immer).
 * Nur für die lokale Entwicklung. Er schützt nichts und wird in der Oberfläche als Test markiert.
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

export type SiteKeyResolution =
  | { readonly status: "configured"; readonly siteKey: string; readonly isTestKey: boolean }
  | { readonly status: "missing" };

export interface SiteKeyEnv {
  readonly VITE_TURNSTILE_SITE_KEY?: string | undefined;
  readonly DEV?: boolean | undefined;
}

/**
 * Site-Key aus der Build-Umgebung (VITE_TURNSTILE_SITE_KEY). Fehlt er, gilt in der
 * Entwicklung der Test-Key; im Produktions-Build bleibt er "missing", damit die Oberfläche
 * einen sichtbaren Fehler zeigt statt still zu scheitern.
 */
export function resolveTurnstileSiteKey(env: SiteKeyEnv): SiteKeyResolution {
  const configured = env.VITE_TURNSTILE_SITE_KEY?.trim();
  if (configured) {
    return {
      status: "configured",
      siteKey: configured,
      isTestKey: configured === TURNSTILE_TEST_SITE_KEY
    };
  }
  if (env.DEV === true) {
    return { status: "configured", siteKey: TURNSTILE_TEST_SITE_KEY, isTestKey: true };
  }
  return { status: "missing" };
}

/** Ausschnitt der Turnstile-API, den die Web-App nutzt. */
export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      language?: string;
      theme?: "auto" | "light" | "dark";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

type TurnstileWindow = { turnstile?: TurnstileApi };

/**
 * Lädt das Turnstile-Skript genau einmal und liefert die API. Erst beim Öffnen der
 * Anmeldung aufrufen: vorher wird nichts von Cloudflare geladen.
 */
export function loadTurnstileScript(doc: Document, win: TurnstileWindow): Promise<TurnstileApi> {
  if (win.turnstile) return Promise.resolve(win.turnstile);

  return new Promise<TurnstileApi>((resolve, reject) => {
    const finish = () => {
      if (win.turnstile) resolve(win.turnstile);
      else reject(new Error("turnstile-unavailable"));
    };
    const fail = () => reject(new Error("turnstile-script-failed"));

    const existing = doc.querySelector<HTMLScriptElement>("script[data-turnstile-script]");
    const script = existing ?? doc.createElement("script");
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.dataset.turnstileScript = "true";
      doc.head.appendChild(script);
    }
  });
}

/** Ergebnis eines Anmelde-Aufrufs; code stammt aus den Problem Details des Workers. */
export type AuthCallResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

async function postJson(
  fetchFn: typeof fetch,
  path: string,
  body: Record<string, unknown>
): Promise<AuthCallResult> {
  let res: Response;
  try {
    res = await fetchFn(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }
  if (res.ok) return { ok: true };
  try {
    const problem = (await res.json()) as { code?: unknown };
    if (typeof problem.code === "string") return { ok: false, code: problem.code };
  } catch {
    // kein JSON: unten mit dem Status melden
  }
  return { ok: false, code: `HTTP_${res.status}` };
}

/** POST /api/v1/auth/guest mit Turnstile-Token. */
export function requestGuestSession(
  fetchFn: typeof fetch,
  turnstileToken: string,
  locale: string
): Promise<AuthCallResult> {
  return postJson(fetchFn, "/api/v1/auth/guest", { turnstileToken, locale });
}

/** POST /api/v1/auth/magic-link mit Turnstile-Token. */
export function requestMagicLink(
  fetchFn: typeof fetch,
  email: string,
  turnstileToken: string,
  locale: string
): Promise<AuthCallResult> {
  return postJson(fetchFn, "/api/v1/auth/magic-link", { email, turnstileToken, locale });
}

/** Übersetzungsschlüssel für die Fehlermeldung zu einem Fehlercode. */
export function authErrorKey(code: string): string {
  switch (code) {
    case "TURNSTILE_NOT_CONFIGURED":
      return "signInErrorServerConfig";
    case "BOT_VERIFICATION_REQUIRED":
    case "BOT_VERIFICATION_FAILED":
      return "signInErrorBot";
    case "INVALID_EMAIL":
      return "signInErrorEmail";
    case "RATE_LIMIT_EXCEEDED":
    case "HTTP_429":
      return "signInErrorRateLimit";
    case "EMAIL_DELIVERY_FAILED":
      return "signInErrorMail";
    case "NETWORK_ERROR":
      return "signInErrorNetwork";
    default:
      return "signInErrorGeneric";
  }
}
