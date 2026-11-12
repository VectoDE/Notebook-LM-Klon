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

  it("renders modal dialog with languages, model router and compliance notices when open", () => {
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
    // Design und Farbschema stehen im Kopfmenü bzw. Menü-Sheet (Issue #319)
    expect(html).not.toContain("theme-option-");
    expect(html).not.toContain("mode-option-");
    expect(html).not.toContain('data-testid="reduce-motion-toggle"');
    // „Bewegung reduzieren“ zusätzlich in den Einstellungen (Issue #328)
    expect(html).toContain('data-testid="settings-reduce-motion-toggle"');
    expect(html).toContain('<legend class="rn-drawer-section-title">Bewegung</legend>');
    expect(html).toContain('aria-describedby="settings-reduce-motion-hint"');
    expect(html).toContain("Design und Farbschema stellen Sie unter „Darstellung“ ein.");
    expect(html).toContain('data-testid="lang-option-de"');
    expect(html).toContain('data-testid="lang-option-en"');
    expect(html).toContain('data-testid="model-router-select"');
    expect(html).toContain("Eigene API-Schlüssel (BYOK)");
    expect(html).toContain('data-testid="byok-status">In Vorbereitung</span>');
    expect(html).not.toContain("AES-256-GCM");
    expect(html).toContain("EU AI Act");
    expect(html).toContain("DSGVO &amp; Datenschutz");
    // Reihenfolge: Sprache, KI-Modell, eigene Schlüssel, EU AI Act
    const order = [
      "lang-section-title",
      "model-section-title",
      "byok-section-title",
      "compliance-section-title"
    ].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((pos) => pos > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("BYOK steht für „Bring Your Own Key“");
    expect(html).toContain("Gilt für neue Antworten.");
    expect(html).toContain("Gilt für die Oberfläche und wird auf diesem Gerät gespeichert.");
    expect(html).toContain('<span lang="en">English</span>');
  });
});
