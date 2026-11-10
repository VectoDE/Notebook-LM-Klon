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
    expect(html).toContain("Einstellungen &amp; Compliance");
    expect(html).toContain('data-testid="close-settings-btn"');
    expect(html).toContain('data-testid="theme-option-pure-notebooklm"');
    expect(html).toContain('data-testid="theme-option-immersive-cinema"');
    expect(html).toContain('data-testid="theme-option-editorial-calm"');
    expect(html).toContain('data-testid="theme-option-fusion"');
    expect(html).toContain('data-testid="mode-option-light"');
    expect(html).toContain('data-testid="mode-option-oled-dark"');
    expect(html).toContain('data-testid="mode-option-aaa-contrast"');
    expect(html).toContain('data-testid="lang-option-de"');
    expect(html).toContain('data-testid="lang-option-en"');
    expect(html).toContain('data-testid="model-router-select"');
    expect(html).toContain("BYOK (Bring Your Own Key)");
    expect(html).toContain("EU AI Act Compliance");
    expect(html).toContain("DSGVO &amp; Datenschutz");
  });
});
