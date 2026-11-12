import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MODE_OPTIONS, THEME_OPTIONS } from "../AppearanceControls.js";
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

  it("ersetzt Platzhalter und fällt auf Deutsch bzw. den Schlüssel zurück", () => {
    expect(translate("en", "navSourcesAria", { count: 3 })).toBe("Sources (3)");
    expect(translate("de", "navSourcesAria", { count: 2 })).toBe("Quellen (2)");
    expect(translate("de", "navSourcesAria")).toBe("Quellen ({count})");
    expect(translate("en", "navSourcesAria", { other: 1 })).toBe("Sources ({count})");
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
    expect(html).toContain('<span class="rn-topnav-label">Settings</span>');
    expect(html).toContain('<span class="rn-appearance-button-label">Appearance</span>');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('aria-label="Sources (2)"');
    expect(html).toContain('aria-label="Chat &amp; citations"');
    expect(html).toContain('aria-label="Studio (6 tools)"');
    expect(html).not.toContain("Einstellungen");
    expect(html).not.toContain("Menü öffnen");
  });

  it("übersetzt die Einstellungen samt Darstellung", () => {
    const html = renderEn(createElement(SettingsDrawer, { isOpen: true, onClose: () => {} }));
    expect(html).toContain(">Settings</h2>");
    expect(html).toContain('aria-label="Close settings"');
    for (const text of [
      "Appearance",
      "Color scheme",
      "Automatic (match device)",
      "High contrast (AAA)",
      "Calm clarity",
      "Applies to new answers.",
      "Coming soon",
      "Design and color scheme are saved on this device."
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("Darstellung");
    expect(html).not.toContain("Farbschema");
  });
});
