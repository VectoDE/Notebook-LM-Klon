/**
 * Settings & Compliance Drawer Component.
 *
 * Implements Sub-Issue #129 (Decisions #78, #80):
 * - Keeps the main relation workspace uncluttered by housing technical configurations:
 *   - Model Router & BYOK (OpenAI, Anthropic, Google, Groq, DeepSeek, Mistral, Ollama)
 *   - EU AI Act Article 50 transparency status
 *   - EU GDPR data processing guarantees (zero model training)
 *   - Live Theme, Color Mode, Language, and Reduced Motion toggles
 */

import { useEffect, useRef } from "react";
import { COLOR_MODES, LANGUAGES, THEMES, useTheme } from "./useTheme.jsx";

export interface SettingsDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly activeModel?: string | undefined;
  readonly onModelChange?: ((model: string) => void) | undefined;
}

export function SettingsDrawer({
  isOpen,
  onClose,
  activeModel = "gemini-2.5-flash",
  onModelChange
}: SettingsDrawerProps) {
  const { theme, colorMode, language, setTheme, setColorMode, setLanguage, t } = useTheme();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      open
      aria-labelledby="settings-drawer-title"
      className="rn-settings-backdrop"
      data-testid="settings-drawer"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        backgroundColor: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        justifyContent: "flex-end",
        border: "none",
        padding: 0,
        width: "100%",
        height: "100%"
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="rn-settings-content"
        style={{
          width: "100%",
          maxWidth: "440px",
          height: "100%",
          backgroundColor: "var(--rn-color-panel)",
          color: "var(--rn-color-text-primary)",
          padding: "24px",
          boxShadow: "-4px 0 24px rgba(0, 0, 0, 0.2)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "24px"
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="settings-drawer-title" style={{ margin: 0, fontSize: "1.25rem" }}>
            {t("settingsTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rn-touch-target"
            aria-label={t("settingsClose")}
            data-testid="close-settings-btn"
            style={{
              cursor: "pointer",
              borderRadius: "8px",
              border: "1px solid var(--rn-color-panel-border)",
              background: "transparent",
              color: "inherit",
              padding: "6px 12px"
            }}
          >
            {t("settingsClose")}
          </button>
        </header>

        {/* Theme & Design Selection */}
        <section aria-labelledby="theme-section-title">
          <h3 id="theme-section-title" style={{ fontSize: "1rem", marginBottom: "8px" }}>
            {t("themeLabel")}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {THEMES.map((th) => (
              <button
                key={th}
                type="button"
                onClick={() => setTheme(th)}
                aria-pressed={theme === th}
                data-testid={`theme-option-${th}`}
                className="rn-touch-target"
                style={{
                  padding: "8px 12px",
                  borderRadius: "12px",
                  border:
                    theme === th
                      ? "2px solid var(--rn-color-accent)"
                      : "1px solid var(--rn-color-panel-border)",
                  background: theme === th ? "var(--rn-color-accent)" : "transparent",
                  color: theme === th ? "var(--rn-color-accent-text)" : "inherit",
                  cursor: "pointer",
                  fontWeight: theme === th ? 600 : 400
                }}
              >
                {t(
                  `theme${th === "pure" ? "Pure" : th === "immersive-cinema" ? "Cinema" : th === "editorial-calm" ? "Editorial" : "Fusion"}`
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Color Mode Selection */}
        <section aria-labelledby="mode-section-title">
          <h3 id="mode-section-title" style={{ fontSize: "1rem", marginBottom: "8px" }}>
            {t("colorModeLabel")}
          </h3>
          <div style={{ display: "flex", gap: "8px" }}>
            {COLOR_MODES.map((cm) => (
              <button
                key={cm}
                type="button"
                onClick={() => setColorMode(cm)}
                aria-pressed={colorMode === cm}
                data-testid={`mode-option-${cm}`}
                className="rn-touch-target"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: "12px",
                  border:
                    colorMode === cm
                      ? "2px solid var(--rn-color-accent)"
                      : "1px solid var(--rn-color-panel-border)",
                  background: colorMode === cm ? "var(--rn-color-accent)" : "transparent",
                  color: colorMode === cm ? "var(--rn-color-accent-text)" : "inherit",
                  cursor: "pointer",
                  fontWeight: colorMode === cm ? 600 : 400
                }}
              >
                {t(`mode${cm === "light" ? "Light" : cm === "dark" ? "Dark" : "AAA"}`)}
              </button>
            ))}
          </div>
        </section>

        {/* Language Selection */}
        <section aria-labelledby="lang-section-title">
          <h3 id="lang-section-title" style={{ fontSize: "1rem", marginBottom: "8px" }}>
            {t("languageLabel")}
          </h3>
          <div style={{ display: "flex", gap: "8px" }}>
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                aria-pressed={language === lang}
                data-testid={`lang-option-${lang}`}
                className="rn-touch-target"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: "12px",
                  border:
                    language === lang
                      ? "2px solid var(--rn-color-accent)"
                      : "1px solid var(--rn-color-panel-border)",
                  background: language === lang ? "var(--rn-color-accent)" : "transparent",
                  color: language === lang ? "var(--rn-color-accent-text)" : "inherit",
                  cursor: "pointer",
                  fontWeight: language === lang ? 600 : 400
                }}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
        </section>

        {/* Model Router */}
        <section aria-labelledby="model-section-title">
          <h3 id="model-section-title" style={{ fontSize: "1rem", marginBottom: "8px" }}>
            {t("modelRouter")}
          </h3>
          <select
            value={activeModel}
            onChange={(e) => onModelChange?.(e.target.value)}
            className="rn-touch-target"
            aria-label={t("modelRouter")}
            data-testid="model-router-select"
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "12px",
              border: "1px solid var(--rn-color-panel-border)",
              background: "var(--rn-color-canvas)",
              color: "inherit"
            }}
          >
            <option value="gemini-2.5-flash">Google Gemini 2.5 Flash (Standard)</option>
            <option value="gemini-2.5-pro">Google Gemini 2.5 Pro</option>
            <option value="claude-3-7-sonnet">Anthropic Claude 3.7 Sonnet</option>
            <option value="gpt-4o">OpenAI GPT-4o</option>
            <option value="deepseek-r1">DeepSeek R1 (Groq Fast Inference)</option>
            <option value="ollama-local">Ollama Local (100% On-Device)</option>
          </select>
        </section>

        {/* BYOK Status */}
        <section aria-labelledby="byok-section-title">
          <h3 id="byok-section-title" style={{ fontSize: "1rem", marginBottom: "8px" }}>
            {t("byokTitle")}
          </h3>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--rn-color-text-secondary)",
              margin: 0
            }}
          >
            Eigene API-Keys werden mit AES-256-GCM und versionsgeführtem KEK im Cloudflare Worker
            KeyVault verschlüsselt gespeichert.
          </p>
        </section>

        {/* Compliance: EU AI Act & DSGVO */}
        <section
          aria-labelledby="compliance-section-title"
          style={{
            marginTop: "auto",
            padding: "16px",
            borderRadius: "12px",
            background: "var(--rn-color-canvas)",
            border: "1px solid var(--rn-color-panel-border)",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <h3 id="compliance-section-title" style={{ fontSize: "0.95rem", margin: 0 }}>
            {t("aiActTitle")}
          </h3>
          <p
            style={{
              fontSize: "0.875rem",
              margin: 0,
              color: "var(--rn-color-text-secondary)"
            }}
          >
            {t("aiActBadge")}
          </p>
          <div style={{ fontSize: "0.875rem", color: "var(--rn-color-text-secondary)" }}>
            <strong>{t("gdprTitle")}: </strong>
            {t("gdprText")}
          </div>
        </section>
      </div>
    </dialog>
  );
}
