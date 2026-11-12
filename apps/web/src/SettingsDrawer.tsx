/**
 * Einstellungen (Settings Drawer).
 *
 * Implements Sub-Issue #129 (Decisions #78, #80):
 * - Keeps the main relation workspace uncluttered by housing technical configurations:
 *   - Model Router & BYOK (OpenAI, Anthropic, Google, Groq, DeepSeek, Mistral, Ollama)
 *   - EU AI Act Article 50 transparency status
 *   - EU GDPR data processing guarantees (zero model training)
 *   - Live Theme, Color Mode and Language
 *
 * Modaler <dialog>: Desktop als Seitenblatt rechts, Telefon als Blatt von unten.
 * Fokusfalle, Escape schließt, Klick auf den Hintergrund schließt.
 */

import { useEffect, useRef } from "react";
import { AppearanceControls } from "./AppearanceControls.js";
import { Icon } from "./Icon.js";
import { trapTabKey } from "./focus-trap.js";
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

const MODELS: readonly { readonly id: string; readonly label: string }[] = [
  { id: "gemini-2.5-flash", label: "Google Gemini 2.5 Flash (Standard)" },
  { id: "gemini-2.5-pro", label: "Google Gemini 2.5 Pro" },
  { id: "claude-3-7-sonnet", label: "Anthropic Claude 3.7 Sonnet" },
  { id: "gpt-4o", label: "OpenAI GPT-4o" },
  { id: "deepseek-r1", label: "DeepSeek R1 (Groq Fast Inference)" },
  { id: "ollama-local", label: "Ollama Local (100% On-Device)" }
];

export function SettingsDrawer({
  isOpen,
  onClose,
  activeModel = "gemini-2.5-flash",
  onModelChange,
  returnFocusFallback
}: SettingsDrawerProps) {
  const { theme, colorMode, language, setTheme, setColorMode, setLanguage, t } = useTheme();
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
          <section className="rn-drawer-section" aria-labelledby="theme-section-title">
            <h3 id="theme-section-title" className="rn-drawer-section-title">
              {t("appearanceTitle")}
            </h3>
            <AppearanceControls
              idPrefix="settings"
              theme={theme}
              onThemeChange={setTheme}
              colorMode={colorMode}
              onColorModeChange={setColorMode}
            />
          </section>

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
                className="rn-control-input"
                data-testid="model-router-select"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={16} className="rn-control-chevron" />
            </div>
            <p className="rn-setting-hint">{t("modelHint")}</p>
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
        </div>
      </div>
    </dialog>
  );
}
