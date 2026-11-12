import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsDrawer } from "../SettingsDrawer.js";
import { ThemeProvider } from "../useTheme.js";

describe("SettingsDrawer Component (Sub-Issue #129)", () => {
  it("renders nothing when isOpen is false", () => {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(SettingsDrawer, { isOpen: false, onClose }))
    );
    expect(html).toBe("");
  });

  it("renders modal dialog with theme options, color modes, languages, model router and compliance notices when open", () => {
    const onClose = vi.fn();
    const onModelChange = vi.fn();
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(SettingsDrawer, {
          isOpen: true,
          onClose,
          activeModel: "gemini-2.5-flash",
          onModelChange
        })
      )
    );

    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="settings-drawer-title"');
    expect(html).toContain(">Einstellungen</h2>");
    expect(html).not.toContain("Compliance</h2>");
    expect(html).not.toContain("Arbeitsbereich");
    expect(html).toContain('data-testid="close-settings-btn"');
    expect(html).toContain('aria-label="Einstellungen schließen"');
    expect(html).toMatch(/class="rn-icon-btn rn-dialog-close"/);
    expect(html).toContain('data-testid="theme-option-pure"');
    expect(html).toContain('data-testid="theme-option-immersive-cinema"');
    expect(html).toContain('data-testid="theme-option-editorial-calm"');
    expect(html).toContain('data-testid="theme-option-fusion"');
    expect(html).toContain('data-testid="mode-option-light"');
    expect(html).toContain('data-testid="mode-option-dark"');
    expect(html).toContain('data-testid="mode-option-aaa-contrast"');
    expect(html).toContain('data-testid="mode-option-system"');
    expect(html).toContain('data-testid="lang-option-de"');
    expect(html).toContain('data-testid="lang-option-en"');
    expect(html).toContain('data-testid="model-router-select"');
    expect(html).toContain("Eigene API-Schlüssel (BYOK)");
    expect(html).toContain('data-testid="byok-status">In Vorbereitung</span>');
    expect(html).not.toContain("AES-256-GCM");
    expect(html).toContain("EU AI Act");
    expect(html).toContain("DSGVO &amp; Datenschutz");
    // Abschnitte in Satzschreibung und Hinweise, wann und wo eine Einstellung gilt
    expect(html).toContain(
      'id="theme-section-title" class="rn-drawer-section-title">Darstellung</h3>'
    );
    expect(html).toContain("Gilt für neue Antworten.");
    expect(html).toContain("Design und Farbschema werden auf diesem Gerät gespeichert.");
    expect(html).toContain("Gilt für die Oberfläche und wird auf diesem Gerät gespeichert.");
    expect(html).toContain('<span lang="en">English</span>');
  });
});
