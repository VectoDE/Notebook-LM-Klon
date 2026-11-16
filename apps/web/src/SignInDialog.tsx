import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import { trapTabKey } from "./focus-trap.js";
import { type PasskeyCredentials, registerPasskey } from "./passkey-client.js";
import {
  type AuthCallResult,
  type SiteKeyResolution,
  type TurnstileApi,
  authErrorKey,
  loadTurnstileScript,
  requestGuestSession,
  requestMagicLink,
  resolveTurnstileSiteKey
} from "./turnstile-client.js";
import { useReturnFocus } from "./useReturnFocus.js";
import { useTheme } from "./useTheme.js";

export interface SignInDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** Ziel für den Fokus, wenn der Auslöser nicht mehr erreichbar ist (z. B. im Menü-Sheet). */
  readonly returnFocusFallback?: (() => HTMLElement | null | undefined) | undefined;
  /** Nur für Tests: Site-Key statt Build-Umgebung. */
  readonly siteKey?: SiteKeyResolution | undefined;
  /** Nur für Tests: eigenes fetch. */
  readonly fetchFn?: typeof fetch | undefined;
  /** Nur für Tests: eigenes navigator.credentials. */
  readonly credentials?: PasskeyCredentials | undefined;
}

type WidgetState = "loading" | "ready" | "failed";
type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "success"; readonly key: string }
  | { readonly kind: "error"; readonly key: string };

function defaultSiteKey(): SiteKeyResolution {
  return resolveTurnstileSiteKey({
    VITE_TURNSTILE_SITE_KEY: import.meta.env.VITE_TURNSTILE_SITE_KEY,
    DEV: import.meta.env.DEV
  });
}

/**
 * Anmelden (Issue #233): Gastzugang und Magic-Link, beide mit Cloudflare Turnstile.
 * Passkey einrichten (Issue #343): ebenfalls nur mit bestätigter Bot-Prüfung.
 * Das Turnstile-Skript wird erst geladen, wenn dieser Dialog offen ist. Ohne Site-Key
 * zeigt der Dialog einen sichtbaren Fehler und schickt nichts ab.
 */
export function SignInDialog({
  isOpen,
  onClose,
  returnFocusFallback,
  siteKey,
  fetchFn,
  credentials
}: SignInDialogProps) {
  const { t, language } = useTheme();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<TurnstileApi | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [widgetState, setWidgetState] = useState<WidgetState>("loading");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const titleId = useId();
  const introId = useId();
  const statusId = useId();
  const passkeyTitleId = useId();
  const resolution = siteKey ?? defaultSiteKey();
  const configuredKey = resolution.status === "configured" ? resolution.siteKey : null;

  useReturnFocus(isOpen, returnFocusFallback);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    }
    if (!isOpen) {
      setToken("");
      setStatus({ kind: "idle" });
      setWidgetState("loading");
    }
  }, [isOpen]);

  // Widget erst rendern, wenn der Dialog offen ist und ein Site-Key vorliegt
  useEffect(() => {
    if (!isOpen || !configuredKey) return;
    let cancelled = false;
    loadTurnstileScript(document, window as { turnstile?: TurnstileApi })
      .then((api) => {
        const container = widgetRef.current;
        if (cancelled || !container) return;
        apiRef.current = api;
        widgetIdRef.current = api.render(container, {
          sitekey: configuredKey,
          language,
          theme: "auto",
          callback: (value) => setToken(value),
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setWidgetState("failed");
          }
        });
        setWidgetState("ready");
      })
      .catch(() => {
        if (!cancelled) setWidgetState("failed");
      });
    return () => {
      cancelled = true;
      apiRef.current?.remove(widgetIdRef.current);
      apiRef.current = null;
      widgetIdRef.current = undefined;
    };
  }, [isOpen, configuredKey, language]);

  if (!isOpen) return null;

  // Ein Token gilt genau einmal: nach jedem Aufruf neu anfordern
  const consumeToken = (): string => {
    const current = token;
    setToken("");
    apiRef.current?.reset(widgetIdRef.current);
    return current;
  };

  const run = async (call: (value: string) => Promise<AuthCallResult>, successKey: string) => {
    if (!configuredKey) {
      setStatus({ kind: "error", key: "signInErrorNoSiteKey" });
      return;
    }
    if (!token) {
      setStatus({ kind: "error", key: "signInNeedCheck" });
      return;
    }
    setStatus({ kind: "busy" });
    const result = await call(consumeToken());
    setStatus(
      result.ok
        ? { kind: "success", key: successKey }
        : { kind: "error", key: authErrorKey(result.code) }
    );
  };

  const doFetch = fetchFn ?? ((input, init) => fetch(input, init));
  const busy = status.kind === "busy";
  const unavailable = !configuredKey || !token || busy;

  const handleGuest = () => {
    void run((value) => requestGuestSession(doFetch, value, language), "signInGuestSuccess");
  };

  const handlePasskey = () => {
    const container =
      credentials ?? (typeof navigator !== "undefined" ? navigator.credentials : undefined);
    void run((value) => registerPasskey(doFetch, container, value), "signInPasskeySuccess");
  };

  const handleMagicLink = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus({ kind: "error", key: "signInErrorEmail" });
      return;
    }
    void run(
      (value) => requestMagicLink(doFetch, trimmed, value, language),
      "signInMagicLinkSuccess"
    );
  };

  const statusText =
    status.kind === "success" || status.kind === "error"
      ? t(status.key)
      : status.kind === "busy"
        ? t("signInBusy")
        : "";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={introId}
      data-testid="sign-in-dialog"
      className="rn-dialog rn-signin"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (dialogRef.current) trapTabKey(event, dialogRef.current, document.activeElement);
      }}
    >
      <div className="rn-dialog-card rn-signin-card">
        <div className="rn-share-head">
          <h2 id={titleId} className="rn-share-title">
            {t("signInTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("signInClose")}
            data-testid="btn-close-sign-in"
            className="rn-icon-btn rn-dialog-close"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <p id={introId} className="rn-dialog-text">
          {t("signInIntro")}
        </p>

        {resolution.status === "missing" ? (
          <div role="alert" className="rn-signin-alert" data-testid="sign-in-no-site-key">
            <p className="rn-signin-alert-title">{t("signInNoSiteKeyTitle")}</p>
            <p>{t("signInErrorNoSiteKey")}</p>
          </div>
        ) : (
          <div className="rn-signin-check">
            {resolution.isTestKey && (
              <p className="rn-signin-test" data-testid="sign-in-test-key">
                {t("signInTestKey")}
              </p>
            )}
            <div ref={widgetRef} className="rn-signin-widget" data-testid="turnstile-widget" />
            {widgetState === "loading" && (
              <p className="rn-dialog-text">{t("signInCheckLoading")}</p>
            )}
            {widgetState === "failed" && (
              <p role="alert" className="rn-signin-alert" data-testid="sign-in-widget-failed">
                {t("signInCheckFailed")}
              </p>
            )}
          </div>
        )}

        <output
          id={statusId}
          aria-live="polite"
          data-testid="sign-in-status"
          className={
            statusText ? `rn-signin-status rn-signin-status--${status.kind}` : "rn-visually-hidden"
          }
        >
          {statusText}
        </output>

        <section aria-labelledby="sign-in-guest-title" className="rn-signin-section">
          <h3 id="sign-in-guest-title" className="rn-share-people-title">
            {t("signInGuestTitle")}
          </h3>
          <p className="rn-dialog-text">{t("signInGuestText")}</p>
          <button
            type="button"
            onClick={handleGuest}
            aria-disabled={unavailable}
            aria-describedby={statusId}
            data-testid="btn-sign-in-guest"
            className={`rn-btn rn-btn--primary rn-btn--block${unavailable ? " rn-btn--unavailable" : ""}`}
          >
            {t("signInGuestButton")}
          </button>
        </section>

        <form onSubmit={handleMagicLink} className="rn-form rn-signin-section" noValidate>
          <h3 className="rn-share-people-title">{t("signInMagicTitle")}</h3>
          <div className="rn-field">
            <label htmlFor="sign-in-email-input">{t("signInEmailLabel")}</label>
            <input
              id="sign-in-email-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="sign-in-email-input"
              className="rn-input"
            />
          </div>
          <button
            type="submit"
            aria-disabled={unavailable}
            aria-describedby={statusId}
            data-testid="btn-sign-in-magic"
            className={`rn-btn rn-btn--secondary rn-btn--block${unavailable ? " rn-btn--unavailable" : ""}`}
          >
            {t("signInMagicButton")}
          </button>
        </form>

        <section aria-labelledby={passkeyTitleId} className="rn-signin-section">
          <h3 id={passkeyTitleId} className="rn-share-people-title">
            {t("signInPasskeyTitle")}
          </h3>
          <p className="rn-dialog-text">{t("signInPasskeyText")}</p>
          <button
            type="button"
            onClick={handlePasskey}
            aria-disabled={unavailable}
            aria-describedby={statusId}
            data-testid="btn-register-passkey"
            className={`rn-btn rn-btn--secondary rn-btn--block${unavailable ? " rn-btn--unavailable" : ""}`}
          >
            {t("signInPasskeyButton")}
          </button>
        </section>
      </div>
    </dialog>
  );
}
