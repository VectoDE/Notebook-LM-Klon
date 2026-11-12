import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AppearanceControls,
  MODE_OPTIONS,
  ROLE_OPTIONS,
  THEME_OPTIONS
} from "../AppearanceControls.js";

const noop = () => {};
const render = () =>
  renderToStaticMarkup(
    createElement(AppearanceControls, {
      role: "editor",
      onRoleChange: noop,
      theme: "fusion",
      onThemeChange: noop,
      colorMode: "dark",
      onColorModeChange: noop,
      idPrefix: "t"
    })
  );

describe("AppearanceControls", () => {
  it("bietet alle Rollen, Designs und Farbschemata an", () => {
    expect(ROLE_OPTIONS.map((o) => o.id)).toEqual(["owner", "editor", "viewer"]);
    expect(THEME_OPTIONS.map((o) => o.id)).toEqual([
      "pure",
      "editorial-calm",
      "immersive-cinema",
      "fusion"
    ]);
    expect(MODE_OPTIONS.map((o) => o.id)).toEqual(["system", "light", "dark", "aaa-contrast"]);
  });

  it("nimmt Namen aus dem Sprachkatalog (eine Quelle für alle Stellen)", () => {
    const html = render();
    for (const name of ["Pure", "Editorial", "Cinema", "Fusion", "Ruhige Klarheit"]) {
      expect(html).toContain(name);
    }
    for (const name of ["Automatisch (wie Gerät)", "Hell", "Dunkel", "Hoher Kontrast (AAA)"]) {
      expect(html).toContain(`<span class="rn-choice-title">${name}</span>`);
    }
    expect(html).not.toContain("Hochkontrast");
    // Farbschema als Liste wie „Design“: gleich hohe, einzeilige Optionen (Issue #315)
    expect(html).toContain('class="rn-choices rn-choices--compact"');
    expect(html).not.toContain("rn-segment");
    expect(html).toContain("Design und Farbschema werden auf diesem Gerät gespeichert.");
  });

  it("nutzt beschriftete Felder und echte Radiogruppen", () => {
    const html = render();
    expect(html).toContain('<label for="t-role" class="rn-appearance-label">Rolle</label>');
    expect(html).toContain('<legend class="rn-appearance-label">Design</legend>');
    expect(html).toContain('<legend class="rn-appearance-label">Farbschema</legend>');
    expect(html.match(/name="t-theme"/g)?.length).toBe(4);
    expect(html.match(/name="t-mode"/g)?.length).toBe(4);
    expect(html.match(/type="radio"/g)?.length).toBe(8);
  });

  it("lässt die Rolle weg, wenn keine übergeben wird", () => {
    const html = renderToStaticMarkup(
      createElement(AppearanceControls, {
        theme: "pure",
        onThemeChange: noop,
        colorMode: "light",
        onColorModeChange: noop,
        idPrefix: "s"
      })
    );
    expect(html).not.toContain("role-switcher-select");
    expect(html).not.toContain("Rolle");
    expect(html.match(/type="radio"/g)?.length).toBe(8);
  });

  it("markiert die aktuelle Wahl", () => {
    const html = render();
    expect(html).toMatch(/data-testid="theme-option-fusion"[^>]*checked=""/);
    expect(html).toMatch(/data-testid="mode-option-dark"[^>]*checked=""/);
    expect(html).toMatch(/<option value="editor" selected="">Bearbeiter<\/option>/);
    expect(html.match(/checked=""/g)?.length).toBe(2);
  });

  it("markiert Automatisch, wenn der Farbmodus dem Gerät folgt", () => {
    const html = renderToStaticMarkup(
      createElement(AppearanceControls, {
        theme: "pure",
        onThemeChange: noop,
        colorMode: "system",
        onColorModeChange: noop,
        idPrefix: "a"
      })
    );
    expect(html).toMatch(/data-testid="mode-option-system"[^>]*checked=""/);
  });
});
