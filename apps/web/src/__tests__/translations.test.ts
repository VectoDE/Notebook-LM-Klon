import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppearanceControls, MODE_OPTIONS, THEME_OPTIONS } from "../AppearanceControls.js";
import { SettingsDrawer } from "../SettingsDrawer.js";
import { WorkspaceLayout } from "../WorkspaceLayout.js";
import { TRANSLATIONS, ThemeProvider, type ThemeProviderProps, translate } from "../useTheme.js";

describe("Sprachkatalog (Issue #301)", () => {
  it("führt in Deutsch und Englisch dieselben Schlüssel, keiner ist leer", () => {
    const de = Object.keys(TRANSLATIONS.de).sort();
    const en = Object.keys(TRANSLATIONS.en).sort();
    expect(en).toEqual(de);
    for (const lang of ["de", "en"] as const) {
      for (const key of de) expect(TRANSLATIONS[lang][key]?.trim(), `${lang}.${key}`).toBeTruthy();
    }
  });

  it("kennt alle Schlüssel der Design- und Farbmodus-Auswahl", () => {
    const keys = [
      ...THEME_OPTIONS.flatMap((o) => [o.labelKey, o.hintKey]),
      ...MODE_OPTIONS.map((o) => o.labelKey)
    ];
    for (const key of keys) {
      expect(TRANSLATIONS.de[key], key).toBeDefined();
      expect(TRANSLATIONS.en[key], key).toBeDefined();
    }
  });

  it("liefert die Sprache und fällt sonst auf den Schlüssel zurück", () => {
    expect(translate("en", "skipToContent")).toBe("Skip to content");
    expect(translate("de", "skipToContent")).toBe("Zum Inhalt springen");
    expect(translate("en", "unbekannt")).toBe("unbekannt");
  });
});

describe("Oberfläche auf Englisch", () => {
  const renderEn = (node: ReactNode) =>
    renderToStaticMarkup(
      createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, node)
    );

  it("übersetzt Kopfzeile und Navigation", () => {
    const html = renderEn(createElement(WorkspaceLayout));
    expect(html).toContain('<nav aria-label="Sections" class="rn-topnav" data-testid="top-nav">');
    expect(html).toContain('<span class="rn-topnav-label">Sources</span>');
    expect(html).toContain('<span class="rn-settings-button-label">Settings</span>');
    expect(html).toContain('<span class="rn-appearance-button-label">Appearance</span>');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain("Skip to content");
    expect(html).toContain('<span class="rn-tab-label">Sources</span>');
    expect(html).toContain('aria-label="Chat &amp; citations"');
    expect(html).toContain('aria-label="Studio (6 tools)"');
    expect(html).not.toContain("Einstellungen");
    expect(html).not.toContain("Menü öffnen");
  });

  it("übersetzt die Einstellungen", () => {
    const html = renderEn(createElement(SettingsDrawer, { isOpen: true, onClose: () => {} }));
    expect(html).toContain(">Settings</h2>");
    expect(html).toContain('aria-label="Close settings"');
    for (const text of [
      "Language",
      "AI model",
      "Applies to new answers.",
      "Coming soon",
      "BYOK stands for",
      "Design, color scheme and motion are set under “Appearance”."
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("Darstellung");
    expect(html).not.toContain("Sprache");
  });

  it("übersetzt die Darstellung samt Bewegung und Rolle", () => {
    const html = renderEn(
      createElement(AppearanceControls, {
        idPrefix: "x",
        role: "viewer",
        onRoleChange: () => {},
        theme: "pure",
        onThemeChange: () => {},
        colorMode: "system",
        onColorModeChange: () => {}
      })
    );
    for (const text of [
      "Color scheme",
      "Automatic (match device)",
      "High contrast (AAA)",
      "Calm clarity",
      "Reduce motion",
      ">Role</label>",
      ">Viewer</option>",
      "Design and color scheme are saved on this device."
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("Rolle");
    expect(html).not.toContain("Betrachter");
  });

  it("übersetzt die Glossarbegriffe in Chat und Studio", () => {
    expect(translate("de", "chatSummaryLabel")).toBe("Zusammenfassung");
    expect(translate("de", "studioAudioCard")).toBe("Audio-Überblick");
    expect(translate("de", "studioVideoCard")).toBe("Video-Überblick");
    expect(translate("de", "studioAudioOpen")).toBe("Anhören");
    expect(translate("en", "studioAudioCard")).toBe("Audio overview");
    // Kürzel werden erklärt (de und en)
    for (const lang of ["de", "en"] as const) {
      expect(translate(lang, "byokText").toLowerCase()).toContain("bring your own key");
      expect(translate(lang, "studioFlashcardsDesc")).toMatch(/SM-2.*Anki/);
      expect(translate(lang, "studioVideoDesc")).toContain("WebM");
    }
    for (const key of [
      "studioAudioCard",
      "studioVideoCard",
      "studioAudioOpen",
      "chatSummaryLabel"
    ]) {
      expect(translate("de", key)).not.toMatch(/Overview|Player|Executive/);
    }
  });
});
