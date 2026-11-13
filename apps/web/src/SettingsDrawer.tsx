/**
 * Einstellungen (Settings Drawer).
 *
 * Implements Sub-Issue #129 (Decisions #78, #80):
 * - Keeps the main relation workspace uncluttered by housing technical configurations:
 *   - Model Router & BYOK (OpenAI, Anthropic, Google, Groq, DeepSeek, Mistral, Ollama)
 *   - EU AI Act Article 50 transparency status
 *   - Training-Angabe je Modell mit Quelle (Issue #302, model-data-policy.ts)
 *   - Language
 *
 * Reihenfolge (Issue #319, #328): Sprache, KI-Modell, Bewegung, eigene Schlüssel, Rechtliches.
 * Design, Farbschema und Rolle stehen im Kopfmenü bzw. Menü-Sheet; der Schalter „Bewegung
 * reduzieren“ steht in beiden (Entscheidung des Inhabers, Issue #328), mit gleichem Zustand.
 *
 * Modaler <dialog>: ab 600 px zentriertes Fenster, darunter Vollbild (Issue #329).
 * Fokusfalle, Escape schließt, Klick auf den Hintergrund schließt.
 */

import { useEffect, useRef } from "react";
import { MotionSetting } from "./AppearanceControls.js";
import { Icon } from "./Icon.js";
import { trapTabKey } from "./focus-trap.js";
import { CONNECTION_KEYS, POLICY_RETRIEVED, STATUS_KEYS, policyFor } from "./model-data-policy.js";
import { DEFAULT_MODEL, MODEL_IDS, type ModelId } from "./theme-preferences.js";
import { useReturnFocus } from "./useReturnFocus.js";
import { LANGUAGES, useTheme } from "./useTheme.jsx";

export interface SettingsDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly activeModel?: string | undefined;
  readonly onModelChange?: ((model: string) => void) | undefined;
  /** Ziel für den Fokus nach dem Schließen, wenn der Auslöser ihn nicht mehr annimmt. */
  readonly returnFocusFallback?: (() => HTMLElement | null | undefined) | undefined;
}

/**
 * Anzeigenamen der Modelle; die Liste der erlaubten Werte steht in theme-preferences.
 * `key` verweist auf den Sprachkatalog, `text` ist ein Eigenname ohne Übersetzung.
 */
const MODEL_LABELS: Readonly<Record<ModelId, { key: string } | { text: string }>> = {
  "gemini-2.5-flash": { key: "modelGeminiFlash" },
  "gemini-2.5-pro": { text: "Google Gemini 2.5 Pro" },
  "claude-3-7-sonnet": { text: "Anthropic Claude 3.7 Sonnet" },
  "gpt-4o": { text: "OpenAI GPT-4o" },
  "deepseek-r1": { text: "DeepSeek R1 (Groq)" },
  "ollama-local": { key: "modelOllama" }
};

/** Datum der Anbieterangaben in der Schreibweise der Sprache (UTC, damit es nicht verrutscht). */
function formatRetrieved(language: string): string {
  return new Date(`${POLICY_RETRIEVED}T00:00:00Z`).toLocaleDateString(
    language === "de" ? "de-DE" : "en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
  );
}

/** Trainingsangabe des Anbieters zum gewählten Modell mit Quelle (Issue #302). */
function ModelDataPolicyNote({ model }: { readonly model: string }) {
  const { language, t } = useTheme();
  const policy = policyFor(model);
  return (
    <div className="rn-model-policy" data-testid="model-policy" data-status={policy.status}>
      <p id="settings-model-policy" className="rn-drawer-text">
        <strong>{t("policyTitle")}: </strong>
        <span data-testid="model-policy-status">{t(STATUS_KEYS[policy.status])}.</span>{" "}
        {t(policy.noteKey)}
      </p>
      {policy.connection !== "connected" && (
        <p className="rn-drawer-text" data-testid="model-policy-connection">
          {t(CONNECTION_KEYS[policy.connection])}
        </p>
      )}
      <ul className="rn-model-policy-sources">
        {policy.sources.map((source) => (
          <li key={source.url}>
            {t("policySource")}:{" "}
            <a href={source.url} target="_blank" rel="noopener noreferrer" lang="en">
              {source.label}
            </a>{" "}
            <span className="rn-visually-hidden">{t("policyNewWindow")}</span>
          </li>
        ))}
      </ul>
      <p className="rn-setting-hint" data-testid="model-policy-retrieved">
        {t("policyRetrieved")} {formatRetrieved(language)}. {t("policyDisclaimer")}
      </p>
    </div>
  );
}

export function SettingsDrawer({
  isOpen,
  onClose,
  activeModel = DEFAULT_MODEL,
  onModelChange,
  returnFocusFallback
}: SettingsDrawerProps) {
  const { language, setLanguage, t } = useTheme();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // Vor showModal(): Auslöser merken, nach dem Schließen dorthin zurück
  useReturnFocus(isOpen, returnFocusFallback);

  // Als Modal öffnen: Hintergrund inert, Fokus im Dialog, Escape löst "cancel" aus.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-drawer-title"
      className="rn-drawer"
      data-testid="settings-drawer"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (dialogRef.current) trapTabKey(e, dialogRef.current, document.activeElement);
      }}
    >
      <div className="rn-drawer-panel">
        <header className="rn-drawer-head">
          <h2 id="settings-drawer-title" className="rn-drawer-title">
            {t("settingsTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rn-icon-btn rn-dialog-close"
            aria-label={t("settingsClose")}
            data-testid="close-settings-btn"
          >
            <Icon name="close" size={22} />
          </button>
        </header>

        <div className="rn-drawer-body">
          <section className="rn-drawer-section" aria-labelledby="lang-section-title">
            <fieldset className="rn-appearance-group">
              <legend id="lang-section-title" className="rn-drawer-section-title">
                {t("languageLabel")}
              </legend>
              <div className="rn-segmented rn-segmented--grid">
                {LANGUAGES.map((lang) => (
                  <label key={lang} className="rn-segment">
                    <input
                      type="radio"
                      name="settings-language"
                      value={lang}
                      checked={language === lang}
                      onChange={() => setLanguage(lang)}
                      data-testid={`lang-option-${lang}`}
                      className="rn-segment-input"
                    />
                    <span lang={lang}>{lang === "de" ? "Deutsch" : "English"}</span>
                  </label>
                ))}
              </div>
              <p className="rn-setting-hint">{t("languageHint")}</p>
            </fieldset>
          </section>

          <section className="rn-drawer-section" aria-labelledby="model-section-title">
            <h3 id="model-section-title" className="rn-drawer-section-title">
              <label htmlFor="settings-model">{t("modelRouter")}</label>
            </h3>
            <div className="rn-control rn-control--block">
              <select
                id="settings-model"
                value={activeModel}
                onChange={(e) => onModelChange?.(e.target.value)}
                aria-describedby="settings-model-hint settings-model-policy"
                className="rn-control-input"
                data-testid="model-router-select"
              >
                {MODEL_IDS.map((id) => {
                  const label = MODEL_LABELS[id];
                  return (
                    <option key={id} value={id}>
                      {"key" in label ? t(label.key) : label.text}
                    </option>
                  );
                })}
              </select>
              <Icon name="chevron" size={16} className="rn-control-chevron" />
            </div>
            <p id="settings-model-hint" className="rn-setting-hint">
              {t("modelHint")}
            </p>
            <ModelDataPolicyNote model={activeModel} />
          </section>

          {/* Bewegung auch hier (Issue #328), gleicher Zustand wie in der Darstellung */}
          <section className="rn-drawer-section">
            <MotionSetting
              idPrefix="settings"
              testId="settings-reduce-motion-toggle"
              legendClassName="rn-drawer-section-title"
            />
          </section>

          <section className="rn-drawer-section" aria-labelledby="byok-section-title">
            <h3
              id="byok-section-title"
              className="rn-drawer-section-title rn-drawer-section-title--status"
            >
              {t("byokTitle")}
              <span className="rn-status-badge" data-testid="byok-status">
                {t("byokStatus")}
              </span>
            </h3>
            <p className="rn-drawer-text">{t("byokText")}</p>
          </section>

          <section className="rn-drawer-notice" aria-labelledby="compliance-section-title">
            <h3 id="compliance-section-title" className="rn-drawer-section-title">
              {t("aiActTitle")}
            </h3>
            <p className="rn-drawer-text">{t("aiActBadge")}</p>
            <p className="rn-drawer-text">
              <strong>{t("gdprTitle")}: </strong>
              {t("gdprText")}
            </p>
          </section>

          <p className="rn-setting-hint" data-testid="settings-appearance-hint">
            {t("settingsAppearanceHint")}
          </p>
        </div>
      </div>
    </dialog>
  );
}
