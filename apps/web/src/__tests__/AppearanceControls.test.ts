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
    expect(MODE_OPTIONS.map((o) => o.id)).toEqual(["light", "dark", "aaa-contrast"]);
  });

  it("nutzt beschriftete Felder und echte Radiogruppen", () => {
    const html = render();
    expect(html).toContain('<label for="t-role" class="rn-appearance-label">Rolle</label>');
    expect(html).toContain('<legend class="rn-appearance-label">Design</legend>');
    expect(html).toContain('<legend class="rn-appearance-label">Farbschema</legend>');
    expect(html.match(/name="t-theme"/g)?.length).toBe(4);
    expect(html.match(/name="t-mode"/g)?.length).toBe(3);
    expect(html.match(/type="radio"/g)?.length).toBe(7);
  });

  it("markiert die aktuelle Wahl", () => {
    const html = render();
    expect(html).toMatch(/data-testid="theme-option-fusion"[^>]*checked=""/);
    expect(html).toMatch(/data-testid="mode-option-dark"[^>]*checked=""/);
    expect(html).toMatch(/<option value="editor" selected="">Bearbeiter<\/option>/);
    expect(html.match(/checked=""/g)?.length).toBe(2);
  });
});
