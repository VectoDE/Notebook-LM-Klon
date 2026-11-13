import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icon.js";
import {
  CONSENT_CHANGE_EVENT,
  type ConsentState,
  OPEN_CONSENT_SETTINGS_EVENT,
  OPEN_PRIVACY_NOTICE_EVENT,
  needsConsentDecision,
  readConsent,
  storeConsent
} from "./consent.js";
import { trapTabKey } from "./focus-trap.js";
import { privacyTexts } from "./privacy-texts.js";
import { useReturnFocus } from "./useReturnFocus.js";
import { useTheme } from "./useTheme.js";
import "./privacy.css";

export interface PrivacyCenterProps {
  /** Ist ein Dienst eingerichtet, der eine Einwilligung braucht (z. B. VITE_GTM_ID)? */
  readonly optionalServicesConfigured: boolean;
  /** Speicher für die Entscheidung; Standard: localStorage des Browsers. */
  readonly storage?: Storage | undefined;
  /** Wird nach jeder gespeicherten Entscheidung aufgerufen (z. B. Tag Manager laden). */
  readonly onConsentChange?: ((state: ConsentState) => void) | undefined;
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Einwilligungsbanner, Cookie-Einstellungen und Datenschutzhinweise (Issue #261).
 *
 * - Drei gleichwertige Knöpfe in fester Reihenfolge, gleiche Klasse, gleiche Größe,
 *   keine Vorauswahl und keine Hervorhebung.
 * - Das Banner ist nicht modal und blockiert die App nicht; es steht im DOM vor der App,
 *   damit Tastatur und Screenreader es zuerst erreichen.
 * - Widerruf jederzeit über die Fußzeile (Ereignis OPEN_CONSENT_SETTINGS_EVENT).
 */
export function PrivacyCenter({
  optionalServicesConfigured,
  storage,
  onConsentChange
}: PrivacyCenterProps) {
  const { language } = useTheme();
  const texts = privacyTexts(language);
  const store = storage ?? browserStorage();
  const [consent, setConsent] = useState<ConsentState | null>(() => readConsent(store));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [status, setStatus] = useState("");
  const titleId = useId();
  const textId = useId();

  const bannerVisible = needsConsentDecision(consent, optionalServicesConfigured);

  // Gespeicherte Entscheidung beim Start melden (z. B. Tag Manager nach Einwilligung laden)
  const initialConsent = useRef(consent);
  useEffect(() => {
    if (initialConsent.current) onConsentChange?.(initialConsent.current);
  }, [onConsentChange]);

  const decide = useCallback(
    (analytics: boolean) => {
      const next = storeConsent(store, analytics && optionalServicesConfigured);
      setConsent(next);
      setSettingsOpen(false);
      setStatus(next.analytics ? texts.savedAnalyticsOn : texts.savedAnalyticsOff);
      onConsentChange?.(next);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: next }));
      }
    },
    [store, optionalServicesConfigured, texts, onConsentChange]
  );

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    const openNotice = () => setNoticeOpen(true);
    window.addEventListener(OPEN_CONSENT_SETTINGS_EVENT, openSettings);
    window.addEventListener(OPEN_PRIVACY_NOTICE_EVENT, openNotice);
    return () => {
      window.removeEventListener(OPEN_CONSENT_SETTINGS_EVENT, openSettings);
      window.removeEventListener(OPEN_PRIVACY_NOTICE_EVENT, openNotice);
    };
  }, []);

  return (
    <>
      {bannerVisible && (
        <section
          className="rn-consent-banner"
          aria-labelledby={titleId}
          aria-describedby={textId}
          data-testid="consent-banner"
        >
          <h2 id={titleId} className="rn-consent-title">
            {texts.bannerTitle}
          </h2>
          <p id={textId} className="rn-consent-text">
            {texts.bannerText}{" "}
            <button
              type="button"
              className="rn-consent-link"
              onClick={() => setNoticeOpen(true)}
              data-testid="consent-notice-link"
            >
              {texts.bannerNoticeLink}
            </button>
          </p>
          <div className="rn-consent-actions">
            <button
              type="button"
              className="rn-btn rn-consent-choice"
              onClick={() => decide(true)}
              data-testid="consent-accept-all"
            >
              {texts.acceptAll}
            </button>
            <button
              type="button"
              className="rn-btn rn-consent-choice"
              onClick={() => decide(false)}
              data-testid="consent-necessary-only"
            >
              {texts.necessaryOnly}
            </button>
            <button
              type="button"
              className="rn-btn rn-consent-choice"
              onClick={() => setSettingsOpen(true)}
              data-testid="consent-customize"
            >
              {texts.customize}
            </button>
          </div>
        </section>
      )}

      <output aria-live="polite" className="rn-visually-hidden" data-testid="consent-status">
        {status}
      </output>

      <ConsentSettingsDialog
        isOpen={settingsOpen}
        analyticsAvailable={optionalServicesConfigured}
        analyticsChecked={consent?.analytics === true}
        onSave={decide}
        onClose={() => setSettingsOpen(false)}
        texts={texts}
      />
      <PrivacyNoticeDialog isOpen={noticeOpen} onClose={() => setNoticeOpen(false)} texts={texts} />
    </>
  );
}

interface DialogBaseProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly texts: ReturnType<typeof privacyTexts>;
}

function useModal(isOpen: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useReturnFocus(isOpen);
  useEffect(() => {
    const dialog = ref.current;
    if (isOpen && dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    }
  }, [isOpen]);
  return ref;
}

function ConsentSettingsDialog({
  isOpen,
  onClose,
  texts,
  analyticsAvailable,
  analyticsChecked,
  onSave
}: DialogBaseProps & {
  readonly analyticsAvailable: boolean;
  readonly analyticsChecked: boolean;
  readonly onSave: (analytics: boolean) => void;
}) {
  const ref = useModal(isOpen);
  const titleId = useId();
  const [analytics, setAnalytics] = useState(analyticsChecked);

  useEffect(() => {
    if (isOpen) setAnalytics(analyticsChecked);
  }, [isOpen, analyticsChecked]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="rn-dialog rn-privacy-dialog"
      data-testid="consent-settings"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (ref.current) trapTabKey(event, ref.current, document.activeElement);
      }}
    >
      <div className="rn-dialog-card rn-privacy-card">
        <div className="rn-privacy-head">
          <h2 id={titleId} className="rn-privacy-title">
            {texts.settingsTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={texts.close}
            className="rn-icon-btn rn-dialog-close"
            data-testid="consent-settings-close"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <p className="rn-privacy-text">{texts.settingsIntro}</p>
        <form
          className="rn-privacy-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(analytics);
          }}
        >
          <label className="rn-privacy-option">
            <input type="checkbox" checked disabled data-testid="consent-necessary" />
            <span>
              <span className="rn-privacy-option-label">{texts.necessaryLabel}</span>
              <span className="rn-privacy-option-desc">{texts.necessaryDesc}</span>
            </span>
          </label>
          <label className="rn-privacy-option">
            <input
              type="checkbox"
              checked={analytics}
              disabled={!analyticsAvailable}
              onChange={(event) => setAnalytics(event.target.checked)}
              data-testid="consent-analytics"
            />
            <span>
              <span className="rn-privacy-option-label">{texts.analyticsLabel}</span>
              <span className="rn-privacy-option-desc">
                {analyticsAvailable ? texts.analyticsDesc : texts.analyticsUnavailable}
              </span>
            </span>
          </label>
          <div className="rn-privacy-actions">
            <button type="submit" className="rn-btn rn-btn--secondary" data-testid="consent-save">
              {texts.save}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function PrivacyNoticeDialog({ isOpen, onClose, texts }: DialogBaseProps) {
  const ref = useModal(isOpen);
  const titleId = useId();
  if (!isOpen) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="rn-dialog rn-privacy-dialog"
      data-testid="privacy-notice"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (ref.current) trapTabKey(event, ref.current, document.activeElement);
      }}
    >
      <div className="rn-dialog-card rn-privacy-card">
        <div className="rn-privacy-head">
          <h2 id={titleId} className="rn-privacy-title">
            {texts.noticeTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={texts.close}
            className="rn-icon-btn rn-dialog-close"
            data-testid="privacy-notice-close"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <p className="rn-privacy-text rn-privacy-disclaimer">{texts.noticeDisclaimer}</p>
        {texts.noticeSections.map((section) => (
          <section key={section.heading} className="rn-privacy-section">
            <h3 className="rn-privacy-section-title">{section.heading}</h3>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="rn-privacy-text">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </dialog>
  );
}

/** Fußzeile mit Datenschutz und Widerruf; jederzeit erreichbar (Issue #261). */
export function LegalFooter() {
  const { language } = useTheme();
  const texts = privacyTexts(language);
  return (
    <footer className="rn-legal-footer" aria-label={texts.footerLabel} data-testid="legal-footer">
      <button
        type="button"
        className="rn-legal-link"
        onClick={() => window.dispatchEvent(new Event(OPEN_PRIVACY_NOTICE_EVENT))}
        data-testid="footer-privacy"
      >
        {texts.footerPrivacy}
      </button>
      <button
        type="button"
        className="rn-legal-link"
        onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_SETTINGS_EVENT))}
        data-testid="footer-cookie-settings"
      >
        {texts.footerCookies}
      </button>
    </footer>
  );
}
